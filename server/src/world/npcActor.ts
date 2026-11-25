import { NPC_BY_ID, PERSONAS, afterFee, categoryHasStock, CATEGORY_BY_ID, JOINT_PROMO_COOLDOWN_MS, internalKey, npcAcceptsAlliance, npcIdFromNumeric, npcNumericId, publicKey, type DirectoryEntry, type MallState } from "@coidle/shared";
import type { Repo } from "../db/repo";
import { ServiceError } from "../services/errors";
import { createRng, hash32, type Rng } from "../sim/rng";
import type { AllianceService } from "./alliances";
import type { CompeteService } from "./compete";
import type { WorldService } from "./world";

// NPC 商場的自動出手。NPC 是名錄裡的商場，所以做的事和玩家一樣、守一樣的規則：
// 搶客（對方可以反擊）、邀請聯名、辦聯名活動、對缺貨的商場送貨救援、結束舊協議，
// 也會回覆玩家送來的聯名邀請，並偶爾回敬玩家的搶客。每個 NPC 每個真實小時擲一次骰，機率很低
// （預設大約每 3 天出手一次），Overseer 可以調整頻率、全部關掉，或手動叫某個 NPC 出手。

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 每個 NPC 每個真實小時出手的基本機率（約每 72 小時一次） */
export const NPC_BASE_P = 1 / 72;
/** 玩家搶 NPC 的客之後，NPC 回敬的機率 */
export const NPC_RETALIATE_P = 0.15;
/** 玩家邀請 NPC 聯名時，NPC 在條件符合的情況下答應的機率 */
export const NPC_ACCEPT_P = 0.85;

export type NpcActionKind = "poach" | "propose" | "joint" | "rescue" | "end" | "respond" | "retaliate";

export interface NpcActorHost {
  /** 把商場推進到現在並回傳狀態（唯讀） */
  peek(mallId: number): MallState;
  deliver(mallId: number): void;
}

export interface NpcActionLog {
  npcId: string;
  action: NpcActionKind;
  /** 對外代號（和玩家看到的一樣） */
  target: string;
  manual: boolean;
}

export interface ManualAction {
  action: NpcActionKind;
  /** 目標商場的代號（對外或內部都行） */
  target?: string;
  persona?: string;
  allianceId?: number;
  accept?: boolean;
  ignoreLimits?: boolean;
}

const strHash = (s: string): number => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const keyToId = (key: string): number | null => (/^m:\d+$/.test(key) ? Number(key.slice(2)) : null);

export class NpcActor {
  /** 每次 NPC 做了一件事就呼叫（營運指標用） */
  onAction: ((e: NpcActionLog) => void) | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly world: WorldService,
    private readonly alliances: AllianceService,
    private readonly compete: CompeteService,
    private readonly now: () => number,
    private readonly host: NpcActorHost,
  ) {}

  // ───────── 排程 ─────────
  /** 每次 tickAll 都會呼叫：回覆邀請、回敬搶客、擲骰決定要不要出手 */
  tick(): void {
    try {
      this.answerInvites();
      this.retaliate();
      if (this.world.npc.auto()) this.roll();
    } catch (e) {
      console.error("npc tick failed", e);
    }
  }

  private log(npcId: string, action: NpcActionKind, targetKey: string, detail: string, manual: boolean): void {
    this.repo.addNpcAction({ ts: this.now(), npcId, action, targetKey, detail, manual });
    this.onAction?.({ npcId, action, target: publicKey(targetKey), manual });
  }

  // ───────── 玩家邀請 NPC：過一陣子才回覆 ─────────
  /** 這份邀請 NPC 要等多久才回覆：10 分鐘到 4 小時之間，由邀請編號決定 */
  answerDelayMs(allianceId: number): number {
    return 10 * 60_000 + (hash32(allianceId, 17) % (3 * HOUR + 50 * 60_000));
  }

  /** NPC 會不會答應：分數落差要在範圍內，再加一點個性（由邀請編號決定，不用擲骰） */
  wouldAccept(allianceId: number, npc: DirectoryEntry, mall: DirectoryEntry | undefined): boolean {
    if (!mall || !npcAcceptsAlliance(npc.score, mall.score)) return false;
    return hash32(allianceId, 91) % 100 < NPC_ACCEPT_P * 100;
  }

  private answerInvites(): void {
    const t = this.now();
    const players = this.world.playerEntries();
    for (const p of this.alliances.pendingForNpc()) {
      if (t < p.createdAt + this.answerDelayMs(p.id)) continue;
      const npcId = p.npcKey.slice(2);
      const npc = this.world.npc.entryAny(npcId, t);
      if (!npc || this.world.npc.isHidden(npcId)) continue;
      const accept = this.wouldAccept(p.id, npc, players.find((e) => e.key === p.mallKey));
      try {
        this.alliances.npcRespond(p.id, accept);
        this.log(npcId, "respond", p.mallKey, accept ? "接受聯名" : "婉拒聯名", false);
      } catch {
        // 邀請剛好被取消或過期
      }
    }
  }

  // ───────── 玩家搶 NPC 的客：偶爾回敬 ─────────
  private retaliate(): void {
    const last = Number(this.repo.getMeta("npc_react_last") ?? 0);
    const rows = this.repo.attacksAgainstNpcs(last);
    if (rows.length === 0) return;
    this.repo.setMeta("npc_react_last", String(rows[rows.length - 1]!.id));
    if (!this.world.npc.auto()) return;
    const t = this.now();
    for (const r of rows) {
      const npcId = r.target_key.slice(2);
      const ov = this.world.npc.overrides()[npcId];
      const npc = this.world.npc.entryAny(npcId, t);
      if (!npc || ov?.hidden || r.attacker <= 0) continue;
      if (hash32(r.id, 33) % 1000 >= NPC_RETALIATE_P * 1000 * Math.min(1, (ov?.activity ?? 1) * this.world.npc.activity())) continue;
      const target = this.world.playerEntries().find((e) => e.key === `m:${r.attacker}`);
      if (!target) continue;
      try {
        const delay = (1 + (hash32(r.id, 44) % 5)) * HOUR;
        this.compete.npcAttack(npc, target, r.persona, { deliverAt: r.ts + delay });
        this.log(npcId, "retaliate", target.key, `回敬 ${r.persona}`, false);
      } catch {
        // 規則擋下來就算了（冷卻、保護期、等級…）
      }
    }
  }

  // ───────── 擲骰 ─────────
  private roll(): void {
    const t = this.now();
    const bucket = Math.floor(t / HOUR);
    for (const npc of this.world.npc.entries(t)) {
      const id = npc.key.slice(2);
      const metaKey = `npc_b:${id}`;
      if (Number(this.repo.getMeta(metaKey) ?? 0) >= bucket) continue;
      this.repo.setMeta(metaKey, String(bucket));
      const p = NPC_BASE_P * this.world.npc.activity() * (this.world.npc.overrides()[id]?.activity ?? 1);
      if (p <= 0) continue;
      const rng = createRng(hash32(strHash(id), bucket));
      if (!rng.chance(Math.min(1, p))) continue;
      this.autoAct(npc, rng);
    }
  }

  private autoAct(npc: DirectoryEntry, rng: Rng): void {
    const t = this.now();
    const players = this.world.playerEntries();
    const pick = <T>(list: T[]): T => list[rng.int(0, list.length - 1)]!;
    const cands: { w: number; run: () => void }[] = [];

    const hit = players.filter((p) => !this.compete.npcBlocker(npc, p));
    if (hit.length > 0) cands.push({ w: 30, run: () => this.doPoach(npc, pick(hit), pick(PERSONAS).id, false) });

    const live = (this.repo.alliancesOf(npc.key, ["pending", "active"]) as { a_key: string; b_key: string; status: string; expires_at: number }[]).filter((r) => r.status === "active" || r.expires_at > t);
    const known = new Set(live.flatMap((r) => [r.a_key, r.b_key]));
    const friends = players.filter((p) => !known.has(p.key) && npcAcceptsAlliance(npc.score, p.score));
    if (friends.length > 0 && live.length < 3) cands.push({ w: 25, run: () => this.doPropose(npc, pick(friends), false) });

    const mine = this.alliances.activeWithNpc().filter((a) => a.npcKey === npc.key);
    const jointReady = mine.filter((a) => t - a.lastJointAt >= JOINT_PROMO_COOLDOWN_MS);
    if (jointReady.length > 0) cands.push({ w: 20, run: () => this.doJoint(npc, pick(jointReady).id, false) });

    const needy = players.filter((p) => p.stockouts > 0 && this.repo.tradeSince(npcNumericId(npc.key.slice(2)), keyToId(p.key)!, "goods", t - DAY).n === 0);
    if (needy.length > 0) cands.push({ w: 15, run: () => this.doRescue(npc, pick(needy), false) });

    const old = mine.filter((a) => t - a.startedAt > 3 * DAY);
    if (old.length > 0) cands.push({ w: 5, run: () => this.doEnd(npc, pick(old).id, false) });

    const i = rng.weighted(cands.map((c) => c.w));
    if (i < 0) return;
    try {
      cands[i]!.run();
    } catch (e) {
      if (!(e instanceof ServiceError)) console.error("npc action failed", e);
    }
  }

  // ───────── 動作（自動與手動共用） ─────────
  private doPoach(npc: DirectoryEntry, target: DirectoryEntry, persona: string, manual: boolean, ignoreLimits = false): void {
    this.compete.npcAttack(npc, target, persona, { ignoreLimits });
    this.log(npc.key.slice(2), "poach", target.key, `搶 ${persona}${ignoreLimits ? "（忽略上限）" : ""}`, manual);
  }

  private doPropose(npc: DirectoryEntry, target: DirectoryEntry, manual: boolean): void {
    this.alliances.npcPropose(npc.key, target.key);
    this.log(npc.key.slice(2), "propose", target.key, "邀請聯名", manual);
  }

  private doJoint(npc: DirectoryEntry, allianceId: number, manual: boolean): void {
    this.alliances.npcJoint(allianceId);
    this.log(npc.key.slice(2), "joint", `#${allianceId}`, "辦聯名活動", manual);
  }

  private doEnd(npc: DirectoryEntry, allianceId: number, manual: boolean): void {
    this.alliances.npcEnd(allianceId);
    this.log(npc.key.slice(2), "end", `#${allianceId}`, "結束聯名", manual);
  }

  /** 對缺貨的真人商場送貨救援：和玩家調貨一樣有手續費（對方收到 95%） */
  private doRescue(npc: DirectoryEntry, target: DirectoryEntry, manual: boolean): void {
    const targetId = keyToId(target.key);
    if (targetId === null) throw new ServiceError(404, "找不到這座商場");
    const s = this.host.peek(targetId);
    const shop = s.shops.find((x) => x.mode === "direct" && x.tenant === null && CATEGORY_BY_ID[x.category] && categoryHasStock(CATEGORY_BY_ID[x.category]!) && x.stock < 1);
    if (!shop) throw new ServiceError(400, "對方現在沒有缺貨");
    const t = this.now();
    const qty = 60 + (hash32(targetId, Math.floor(t / HOUR)) % 100);
    const from = npcNumericId(npc.key.slice(2));
    this.repo.addTrade(t, from, targetId, "goods", qty, `${shop.category} 收到 ${afterFee(qty)}`);
    this.repo.addTrade(t, from, targetId, "rescue", 1);
    this.repo.addMail(targetId, "goods", { category: shop.category, qty: afterFee(qty), from: npc.name }, t, t);
    this.host.deliver(targetId);
    this.log(npc.key.slice(2), "rescue", target.key, `送貨 ${qty}`, manual);
  }

  // ───────── Overseer 手動操控 ─────────
  /** 以 NPC 身分做一件事（規則照常，除非勾選忽略上限）；回傳給人看的結果 */
  manual(npcId: string, a: ManualAction): string {
    if (!NPC_BY_ID[npcId]) throw new ServiceError(404, "找不到這座 NPC 商場");
    const npc = this.world.npc.entryAny(npcId);
    if (!npc) throw new ServiceError(404, "找不到這座 NPC 商場");
    const players = this.world.playerEntries();
    const targetOf = (): DirectoryEntry => {
      const key = internalKey(String(a.target ?? ""));
      const e = players.find((p) => p.key === key);
      if (!e) throw new ServiceError(404, "目標要是名錄裡的真人商場");
      return e;
    };
    switch (a.action) {
      case "poach": {
        const persona = a.persona && PERSONAS.some((p) => p.id === a.persona) ? a.persona : PERSONAS[0]!.id;
        this.doPoach(npc, targetOf(), persona, true, a.ignoreLimits === true);
        return `「${npc.name}」對「${targetOf().name}」辦了搶客促銷`;
      }
      case "propose":
        this.doPropose(npc, targetOf(), true);
        return `「${npc.name}」向「${targetOf().name}」送出了聯名邀請`;
      case "rescue":
        this.doRescue(npc, targetOf(), true);
        return `「${npc.name}」送貨給「${targetOf().name}」`;
      case "joint":
        this.doJoint(npc, Number(a.allianceId), true);
        return `「${npc.name}」辦了一場聯名活動`;
      case "end":
        this.doEnd(npc, Number(a.allianceId), true);
        return `「${npc.name}」結束了一份聯名協議`;
      case "respond": {
        const id = Number(a.allianceId);
        this.alliances.npcRespond(id, a.accept !== false);
        this.log(npcId, "respond", `#${id}`, a.accept !== false ? "接受聯名（Overseer 指定）" : "婉拒聯名（Overseer 指定）", true);
        return `「${npc.name}」${a.accept !== false ? "接受" : "婉拒"}了邀請`;
      }
      default:
        throw new ServiceError(400, "不認得的動作");
    }
  }

  /** NPC 現在有哪些進行中的事（管理畫面用） */
  pendingOf(npcId: string): { allianceId: number; kind: "invite" | "active"; with: string; name: string }[] {
    const key = `n:${npcId}`;
    const t = this.now();
    const name = (k: string) => this.world.entries().find((e) => e.key === k)?.name ?? k;
    const rows = this.repo.alliancesOf(key, ["pending", "active"]) as { id: number; a_key: string; b_key: string; status: string; expires_at: number }[];
    return rows
      .filter((r) => r.status === "active" || r.expires_at > t)
      .map((r) => ({ allianceId: r.id, kind: r.status === "active" ? ("active" as const) : ("invite" as const), with: publicKey(r.a_key === key ? r.b_key : r.a_key), name: name(r.a_key === key ? r.b_key : r.a_key) }));
  }

  /** 紀錄裡的整數商場編號 → NPC id（沒有就是 null） */
  static npcOfNumeric(n: number): string | null {
    return npcIdFromNumeric(n);
  }
}
