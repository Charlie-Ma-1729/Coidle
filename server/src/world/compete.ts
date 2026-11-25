import {
  COMPETE_COOLDOWN_MS,
  COMPETE_MAX_ON_TARGET_PER_DAY,
  COMPETE_MAX_PER_DAY,
  COMPETE_NEWBIE_MS,
  COMPETE_SELF_MULT,
  COMPETE_SHIELD_MS,
  COMPETE_TARGET_MULT,
  COMPETE_TICKS,
  PERSONA_BY_ID,
  RELATED_BLOCK_TEXT,
  canCompete,
  competeCost,
  npcNumericId,
  publicKey,
  type DirectoryEntry,
  type PersonaId,
} from "@coidle/shared";
import type { Repo } from "../db/repo";
import { ServiceError } from "../services/errors";
import type { WorldService } from "./world";

// 商戰搶客：對任何商場（含 NPC）辦一場針對某類客人的促銷。
// 只能找「等級相差不遠」或「比自己大」的對象——大打小一律不行；
// 效果有界（±8%、約 12 遊戲小時），有發動冷卻、每日次數、被打到後的保護期、每天被針對的上限、新手保護。
// NPC 商場是純函式（不存狀態），所以被搶客時沒有實際損失；它只讓發動方拿到那一類客人的加成。
// NPC 商場也會（低機率）對真人商場出手，守一樣的規則：等級資格、冷卻、每日次數、對方的保護期與每日被針對上限、新手保護。

export interface CompeteHost {
  snapshot(mallId: number): { level: number };
  spend(mallId: number, amount: number): boolean;
  deliver(mallId: number): void;
  /** 發起方落後伺服器基準時間太多時丟出 ServiceError（沒給就不檢查） */
  assertCanInteract?(mallId: number): void;
  /** 兩座真人商場是不是關係企業（有共同的經營者）；沒給就不檢查 */
  related?(a: number, b: number): boolean;
}

export interface CompeteResult {
  cost: number;
  target: string;
  persona: PersonaId;
  /** 對方是真人商場時才有實際損失（對外一律回 true：介面不區分真人與 NPC） */
  hurt: boolean;
}

const keyToId = (key: string): number | null => (/^m:\d+$/.test(key) ? Number(key.slice(2)) : null);

export class CompeteService {
  constructor(
    private readonly repo: Repo,
    private readonly world: WorldService,
    private readonly now: () => number,
    private readonly host: CompeteHost,
  ) {}

  /** 能不能對這座商場發動？回傳 null＝可以，否則回傳原因（前後端共用同一套說明） */
  blocker(attackerMall: number, target: DirectoryEntry, attackerLevel: number): string | null {
    const t = this.now();
    if (target.key === `m:${attackerMall}`) return "不能對自己的商場出手";
    const targetMall = keyToId(target.key);
    if (targetMall !== null && this.host.related?.(attackerMall, targetMall)) return RELATED_BLOCK_TEXT;
    if (!canCompete(attackerLevel, target.level)) return `你們（Lv.${attackerLevel}）比「${target.name}」（Lv.${target.level}）大太多了——商戰只能找等級相近的商場，或是以小打大`;
    const ally = (this.repo.alliancesOf(`m:${attackerMall}`, ["active"]) as { a_key: string; b_key: string }[]).some((r) => r.a_key === target.key || r.b_key === target.key);
    if (ally) return "你們有聯名協議，不能對盟友出手";
    const mine = this.repo.attacksBy(attackerMall, t - 86_400_000);
    if (t - mine.last < COMPETE_COOLDOWN_MS && mine.n > 0) return "剛出過手，還在冷卻中";
    if (mine.n >= COMPETE_MAX_PER_DAY) return "今天出手的次數已經到上限了";
    if (target.kind === "player") {
      const id = keyToId(target.key);
      const row = id === null ? undefined : this.repo.mallById(id);
      if (!row) return "找不到這座商場";
      if (t - row.created_at < COMPETE_NEWBIE_MS) return "對方是剛開張的商場，還在新手保護期";
      const on = this.repo.attacksOn(target.key, t - 86_400_000);
      if (t - on.last < COMPETE_SHIELD_MS && on.n > 0) return "對方剛被針對過，還在保護期";
      if (on.n >= COMPETE_MAX_ON_TARGET_PER_DAY) return "對方今天已經被針對太多次了";
    }
    return null;
  }

  attack(mallId: number, targetKey: string, persona: string): CompeteResult {
    if (!(persona in PERSONA_BY_ID)) throw new ServiceError(400, "請選擇一種客人");
    const target = this.world.entries().find((e) => e.key === targetKey);
    if (!target) throw new ServiceError(404, "找不到這座商場");
    this.host.assertCanInteract?.(mallId);
    const me = this.host.snapshot(mallId);
    const why = this.blocker(mallId, target, me.level);
    if (why) throw new ServiceError(400, why);
    const cost = competeCost(me.level);
    if (!this.host.spend(mallId, cost)) throw new ServiceError(400, "資金不足");

    const t = this.now();
    // 雙方的效果都從「伺服器基準時間的現在」起算 COMPETE_TICKS，落後的商場模擬到那個 tick 才套用
    const atTick = this.repo.serverTick(t);
    this.repo.addAttack(t, mallId, targetKey, persona);
    const myName = this.repo.mallById(mallId)?.name ?? "對面的商場";
    // 發動的一方拿到加成
    this.repo.addMail(mallId, "poach_gain", { persona, mult: COMPETE_SELF_MULT, ticks: COMPETE_TICKS, who: target.name }, t, t, atTick);
    // 真人商場被搶的一方受到有界的損失
    const targetId = keyToId(targetKey);
    if (targetId !== null) {
      this.repo.addMail(targetId, "poach_hit", { persona, mult: COMPETE_TARGET_MULT, ticks: COMPETE_TICKS, who: myName, key: `m:${mallId}` }, t, t, atTick);
      this.host.deliver(targetId);
    }
    this.host.deliver(mallId);
    return { cost, target: target.name, persona: persona as PersonaId, hurt: true };
  }

  /** NPC 能不能對這座真人商場出手？回傳 null＝可以，否則回傳原因 */
  npcBlocker(npc: DirectoryEntry, target: DirectoryEntry, opts: { ignoreLimits?: boolean } = {}): string | null {
    const t = this.now();
    if (target.kind !== "player") return "只能對真人商場出手";
    if (!canCompete(npc.level, target.level)) return `「${npc.name}」（Lv.${npc.level}）比「${target.name}」（Lv.${target.level}）大太多了`;
    const ally = (this.repo.alliancesOf(npc.key, ["active"]) as { a_key: string; b_key: string }[]).some((r) => r.a_key === target.key || r.b_key === target.key);
    if (ally) return "雙方有聯名協議，不會出手";
    if (opts.ignoreLimits) return null;
    const me = npcNumericId(npc.key.slice(2));
    const mine = this.repo.attacksBy(me, t - 86_400_000);
    if (t - mine.last < COMPETE_COOLDOWN_MS && mine.n > 0) return "剛出過手，還在冷卻中";
    if (mine.n >= COMPETE_MAX_PER_DAY) return "今天出手的次數已經到上限了";
    const id = keyToId(target.key);
    const row = id === null ? undefined : this.repo.mallById(id);
    if (!row) return "找不到這座商場";
    if (t - row.created_at < COMPETE_NEWBIE_MS) return "對方是剛開張的商場，還在新手保護期";
    const on = this.repo.attacksOn(target.key, t - 86_400_000);
    if (t - on.last < COMPETE_SHIELD_MS && on.n > 0) return "對方剛被針對過，還在保護期";
    if (on.n >= COMPETE_MAX_ON_TARGET_PER_DAY) return "對方今天已經被針對太多次了";
    return null;
  }

  /** NPC 對真人商場辦一場搶客促銷：寄一封 poach_hit（效果有界，和玩家出手一樣）；對方可以反擊 */
  npcAttack(npc: DirectoryEntry, target: DirectoryEntry, persona: string, opts: { ignoreLimits?: boolean; deliverAt?: number } = {}): void {
    if (!(persona in PERSONA_BY_ID)) throw new ServiceError(400, "請選擇一種客人");
    const why = this.npcBlocker(npc, target, opts);
    if (why) throw new ServiceError(400, why);
    const targetId = keyToId(target.key)!;
    const t = this.now();
    this.repo.addAttack(t, npcNumericId(npc.key.slice(2)), target.key, persona);
    const at = Math.max(t, opts.deliverAt ?? t);
    this.repo.addMail(targetId, "poach_hit", { persona, mult: COMPETE_TARGET_MULT, ticks: COMPETE_TICKS, who: npc.name, key: publicKey(npc.key) }, t, at, this.repo.serverTick(at));
    if (at <= t) this.host.deliver(targetId);
  }
}
