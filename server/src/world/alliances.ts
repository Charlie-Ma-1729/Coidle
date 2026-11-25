import {
  ALLIANCE_GAME_DAYS,
  ALLIANCE_INVITE_MS,
  ALLIANCE_MAX_ACTIVE,
  ALLIANCE_MAX_PENDING,
  ALLIANCE_REAL_MS,
  JOINT_PROMO_COOLDOWN_MS,
  RELATED_BLOCK_TEXT,
  RELATED_ENDED_TEXT,
  jointPromoCost,
  publicKey,
  type DirectoryEntry,
} from "@coidle/shared";
import type { Repo } from "../db/repo";
import { ServiceError } from "../services/errors";
import type { WorldService } from "./world";

// 聯名協議（跨商場合作）。協議本身存在伺服器層的資料庫；
// 對商場的影響一律透過信箱送達（見 sim/mail.ts），所以每座商場照自己的時鐘消化，決定論不受影響。

export interface AllianceView {
  id: number;
  status: "pending" | "active";
  /** in＝對方邀請你、out＝你邀請對方、both＝已生效 */
  direction: "in" | "out" | "both";
  partnerKey: string;
  partnerName: string;
  partnerKind: "player" | "npc";
  /** pending：回覆期限；active：預計結束時間 */
  until: number;
  /** 下一次可以辦聯名活動的時間（0＝現在就可以） */
  jointReadyAt: number;
}

export interface AllianceHost {
  /** 把商場推進到現在並回傳目前的公開數字 */
  snapshot(mallId: number): { level: number; score: number; funds: number };
  /** 從商場扣款（同步、原子）；錢不夠回傳 false */
  spend(mallId: number, amount: number): boolean;
  /** 讓商場立刻收下剛寄到的信（讓玩家馬上看到結果） */
  deliver(mallId: number): void;
  /** 發起方落後伺服器基準時間太多時丟出 ServiceError（沒給就不檢查） */
  assertCanInteract?(mallId: number): void;
  /** 兩座真人商場是不是關係企業（有共同的經營者）；沒給就不檢查 */
  related?(a: number, b: number): boolean;
}

const mallKey = (id: number) => `m:${id}`;
const mallIdOf = (key: string): number | null => (key.startsWith("m:") ? Number(key.slice(2)) : null);

interface Row {
  id: number;
  a_key: string;
  b_key: string;
  status: string;
  created_at: number;
  expires_at: number;
  started_at: number | null;
  ends_at: number | null;
  last_joint_at: number;
}

export class AllianceService {
  constructor(
    private readonly repo: Repo,
    private readonly world: WorldService,
    private readonly now: () => number,
    private readonly host: AllianceHost,
  ) {}

  private find(id: number): Row | undefined {
    return this.repo.allianceById(id) as Row | undefined;
  }

  private entryOf(key: string): DirectoryEntry | undefined {
    return this.world.entries().find((e) => e.key === key);
  }

  private nameOf(key: string): string {
    return this.entryOf(key)?.name ?? "（已不存在的商場）";
  }

  private activeOf(key: string): number {
    return this.repo.alliancesOf(key, ["active"]).length;
  }

  private mailTo(key: string, kind: string, payload: Record<string, unknown>): void {
    const id = mallIdOf(key);
    if (id === null) return; // NPC 不收信
    const t = this.now();
    // 有持續時間的效果（聯名開始／結束、聯名活動）從「伺服器基準時間的現在」起算；
    // 商場自己的時鐘模擬到那個 tick 才收到，落後的商場不會把效果套在自己的過去。純通知馬上收。
    this.repo.addMail(id, kind, payload, t, t, kind === "notice" ? null : this.repo.serverTick(t));
  }

  private startMail(row: Row): void {
    for (const [mine, theirs] of [[row.a_key, row.b_key], [row.b_key, row.a_key]] as const) {
      this.mailTo(mine, "alliance_start", { id: row.id, partner: this.nameOf(theirs), days: ALLIANCE_GAME_DAYS });
    }
  }

  private endMails(row: Row, text: (partnerName: string) => string): void {
    for (const [mine, theirs] of [[row.a_key, row.b_key], [row.b_key, row.a_key]] as const) {
      this.mailTo(mine, "alliance_end", { id: row.id, text: text(this.nameOf(theirs)) });
    }
  }

  private deliverBoth(row: Row): void {
    for (const k of [row.a_key, row.b_key]) {
      const id = mallIdOf(k);
      if (id !== null) this.host.deliver(id);
    }
  }

  /** 對象是真人商場而且和自己是關係企業就擋下（NPC 商場沒有經營者，不受影響） */
  private assertNotRelated(mallId: number, otherKey: string): void {
    const other = mallIdOf(otherKey);
    if (other !== null && this.host.related?.(mallId, other)) throw new ServiceError(400, RELATED_BLOCK_TEXT);
  }

  /**
   * 這座商場剛多了一位經營者（加入、管理員加人）：和它成為關係企業的商場，既有的聯名協議與邀請一律結束，
   * 雙方各收到一封通知。回傳結束了幾份。
   */
  endRelated(mallId: number): number {
    const me = mallKey(mallId);
    let n = 0;
    for (const r of this.repo.alliancesOf(me, ["pending", "active"]) as Row[]) {
      const partner = r.a_key === me ? r.b_key : r.a_key;
      const pid = mallIdOf(partner);
      if (pid === null || !this.host.related?.(mallId, pid)) continue;
      const was = r.status;
      this.repo.setAllianceStatus(r.id, "ended");
      if (was === "active") this.endMails(r, () => RELATED_ENDED_TEXT);
      else for (const k of [r.a_key, r.b_key]) this.mailTo(k, "notice", { text: RELATED_ENDED_TEXT });
      this.deliverBoth(r);
      n++;
    }
    return n;
  }

  /** 這座商場的協議：邀請中與生效中 */
  list(mallId: number): AllianceView[] {
    const me = mallKey(mallId);
    const t = this.now();
    const out: AllianceView[] = [];
    for (const r of this.repo.alliancesOf(me, ["pending", "active"]) as Row[]) {
      const partnerKey = r.a_key === me ? r.b_key : r.a_key;
      const e = this.entryOf(partnerKey);
      if (r.status === "pending" && r.expires_at <= t) continue;
      out.push({
        id: r.id,
        status: r.status as "pending" | "active",
        direction: r.status === "active" ? "both" : r.a_key === me ? "out" : "in",
        partnerKey: publicKey(partnerKey), // NPC 商場對外的代號和真人商場一樣
        partnerName: e?.name ?? "（已不存在的商場）",
        partnerKind: "player", // 介面不區分真人與 NPC（欄位為舊版相容而保留）
        until: r.status === "pending" ? r.expires_at : r.ends_at ?? 0,
        jointReadyAt: Math.max(0, r.last_joint_at + JOINT_PROMO_COOLDOWN_MS),
      });
    }
    return out;
  }

  propose(mallId: number, targetKey: string): AllianceView[] {
    const me = mallKey(mallId);
    if (typeof targetKey !== "string" || targetKey === me) throw new ServiceError(400, "請選擇另一座商場");
    this.host.assertCanInteract?.(mallId);
    const target = this.entryOf(targetKey);
    if (!target) throw new ServiceError(404, "找不到這座商場");
    this.assertNotRelated(mallId, targetKey);
    const t = this.now();

    const existing = (this.repo.alliancesOf(me, ["pending", "active"]) as Row[]).filter((r) => (r.status === "active" || r.expires_at > t) && (r.a_key === targetKey || r.b_key === targetKey));
    if (existing.length > 0) throw new ServiceError(400, "你們已經有聯名協議或邀請了");
    if (this.activeOf(me) >= ALLIANCE_MAX_ACTIVE) throw new ServiceError(400, `聯名協議最多同時 ${ALLIANCE_MAX_ACTIVE} 份`);
    const outgoing = (this.repo.alliancesOf(me, ["pending"]) as Row[]).filter((r) => r.a_key === me && r.expires_at > t).length;
    if (outgoing >= ALLIANCE_MAX_PENDING) throw new ServiceError(400, "送出的邀請太多了，等對方回覆再說");

    // NPC 商場和真人商場走同一條路：先是「邀請中」，對方（NPC 由排程）過一陣子才回覆
    if (this.activeOf(targetKey) >= ALLIANCE_MAX_ACTIVE) throw new ServiceError(400, "對方的聯名名額已經滿了");
    this.repo.addAlliance(me, targetKey, "pending", t, t + ALLIANCE_INVITE_MS, null, null);
    this.mailTo(targetKey, "notice", { text: `「${this.nameOf(me)}」想和你們簽聯名協議。到「世界 → 名錄與榜單」回覆（24 小時內有效，沒回覆視為婉拒）。` });
    return this.list(mallId);
  }

  respond(mallId: number, id: number, accept: boolean): AllianceView[] {
    const me = mallKey(mallId);
    const row = this.find(id);
    const t = this.now();
    if (!row || row.status !== "pending" || row.b_key !== me) throw new ServiceError(404, "找不到這份邀請");
    if (row.expires_at <= t) throw new ServiceError(400, "邀請已經過期了");
    if (!accept) {
      this.repo.setAllianceStatus(id, "declined");
      this.mailTo(row.a_key, "notice", { text: `「${this.nameOf(me)}」婉拒了你們的聯名邀請。` });
      return this.list(mallId);
    }
    this.host.assertCanInteract?.(mallId);
    this.assertNotRelated(mallId, row.a_key);
    if (this.activeOf(me) >= ALLIANCE_MAX_ACTIVE || this.activeOf(row.a_key) >= ALLIANCE_MAX_ACTIVE) throw new ServiceError(400, "有一方的聯名名額已經滿了");
    this.repo.activateAlliance(id, t, t + ALLIANCE_REAL_MS);
    const active = this.find(id)!;
    this.startMail(active);
    this.deliverBoth(active);
    return this.list(mallId);
  }

  end(mallId: number, id: number): AllianceView[] {
    const me = mallKey(mallId);
    const row = this.find(id);
    if (!row || (row.a_key !== me && row.b_key !== me) || (row.status !== "active" && row.status !== "pending")) throw new ServiceError(404, "找不到這份協議");
    const was = row.status;
    this.repo.setAllianceStatus(id, "ended");
    if (was === "active") {
      const myName = this.nameOf(me);
      for (const k of [row.a_key, row.b_key]) {
        const partner = k === me ? row.b_key : row.a_key;
        this.mailTo(k, "alliance_end", { id, text: k === me ? `你們結束了和「${this.nameOf(partner)}」的聯名協議。` : `「${myName}」結束了和你們的聯名協議。` });
      }
      this.deliverBoth(row);
    } else {
      this.mailTo(row.a_key === me ? row.b_key : row.a_key, "notice", { text: `「${this.nameOf(me)}」取消了聯名邀請。` });
    }
    return this.list(mallId);
  }

  /** 聯名活動：花一點錢，雙方客流都變多（NPC 夥伴只有你這邊有效果）。每份協議有冷卻。 */
  joint(mallId: number, id: number): { cost: number; views: AllianceView[] } {
    const me = mallKey(mallId);
    const row = this.find(id);
    const t = this.now();
    if (!row || row.status !== "active" || (row.a_key !== me && row.b_key !== me)) throw new ServiceError(404, "找不到這份協議");
    if (row.last_joint_at + JOINT_PROMO_COOLDOWN_MS > t) throw new ServiceError(400, "聯名活動剛辦過，過一陣子再辦");
    this.host.assertCanInteract?.(mallId);
    this.assertNotRelated(mallId, row.a_key === me ? row.b_key : row.a_key);
    const snap = this.host.snapshot(mallId);
    const cost = jointPromoCost(snap.level);
    if (!this.host.spend(mallId, cost)) throw new ServiceError(400, "資金不足");
    this.repo.setAllianceJoint(id, t);
    const partner = row.a_key === me ? row.b_key : row.a_key;
    this.mailTo(me, "joint_promo", { partner: this.nameOf(partner) });
    this.mailTo(partner, "joint_promo", { partner: this.nameOf(me) });
    this.deliverBoth(row);
    return { cost, views: this.list(mallId) };
  }

  // ── NPC 商場的行動（排程或 Overseer 觸發）：做的事和玩家一樣，只是發動者是名錄裡的 NPC 商場

  /** 等 NPC 回覆的邀請（玩家邀請 NPC） */
  pendingForNpc(): { id: number; mallKey: string; npcKey: string; createdAt: number }[] {
    const t = this.now();
    return (this.repo.alliancesByStatus("pending") as Row[])
      .filter((r) => r.b_key.startsWith("n:") && r.expires_at > t)
      .map((r) => ({ id: r.id, mallKey: r.a_key, npcKey: r.b_key, createdAt: r.created_at }));
  }

  /** NPC 回覆玩家的邀請：接受就生效，婉拒就通知玩家（和真人婉拒的訊息一樣） */
  npcRespond(id: number, accept: boolean): void {
    const row = this.find(id);
    const t = this.now();
    if (!row || row.status !== "pending" || !row.b_key.startsWith("n:") || row.expires_at <= t) throw new ServiceError(404, "找不到這份邀請");
    const full = this.activeOf(row.b_key) >= ALLIANCE_MAX_ACTIVE || this.activeOf(row.a_key) >= ALLIANCE_MAX_ACTIVE;
    if (!accept || full) {
      this.repo.setAllianceStatus(id, "declined");
      this.mailTo(row.a_key, "notice", { text: `「${this.nameOf(row.b_key)}」婉拒了你們的聯名邀請。` });
      this.deliverBoth(row);
      return;
    }
    this.repo.activateAlliance(id, t, t + ALLIANCE_REAL_MS);
    const active = this.find(id)!;
    this.startMail(active);
    this.deliverBoth(active);
  }

  /** NPC 向真人商場送出聯名邀請（條件和玩家邀請玩家一樣）；回傳協議編號 */
  npcPropose(npcKey: string, targetKey: string): number {
    const target = this.entryOf(targetKey);
    if (!target || target.kind !== "player") throw new ServiceError(404, "找不到這座商場");
    const t = this.now();
    const live = (this.repo.alliancesOf(npcKey, ["pending", "active"]) as Row[]).filter((r) => r.status === "active" || r.expires_at > t);
    if (live.some((r) => r.a_key === targetKey || r.b_key === targetKey)) throw new ServiceError(400, "已經有聯名協議或邀請了");
    if (this.activeOf(npcKey) >= ALLIANCE_MAX_ACTIVE || this.activeOf(targetKey) >= ALLIANCE_MAX_ACTIVE) throw new ServiceError(400, "聯名名額已滿");
    if (live.filter((r) => r.status === "pending" && r.a_key === npcKey).length >= ALLIANCE_MAX_PENDING) throw new ServiceError(400, "送出的邀請太多了");
    const incoming = (this.repo.alliancesOf(targetKey, ["pending"]) as Row[]).filter((r) => r.b_key === targetKey && r.expires_at > t).length;
    if (incoming >= ALLIANCE_MAX_PENDING) throw new ServiceError(400, "對方的待回覆邀請太多了");
    const id = this.repo.addAlliance(npcKey, targetKey, "pending", t, t + ALLIANCE_INVITE_MS, null, null);
    this.mailTo(targetKey, "notice", { text: `「${this.nameOf(npcKey)}」想和你們簽聯名協議。到「世界 → 名錄與榜單」回覆（24 小時內有效，沒回覆視為婉拒）。` });
    this.deliverBoth(this.find(id)!);
    return id;
  }

  /** NPC 結束一份生效中的協議 */
  npcEnd(id: number): void {
    const row = this.find(id);
    if (!row || row.status !== "active" || !(row.a_key.startsWith("n:") || row.b_key.startsWith("n:"))) throw new ServiceError(404, "找不到這份協議");
    const npc = row.a_key.startsWith("n:") ? row.a_key : row.b_key;
    const other = row.a_key === npc ? row.b_key : row.a_key;
    this.repo.setAllianceStatus(id, "ended");
    this.mailTo(other, "alliance_end", { id, text: `「${this.nameOf(npc)}」結束了和你們的聯名協議。` });
    this.deliverBoth(row);
  }

  /** NPC 辦一場聯名活動（對玩家這邊有效；有一樣的冷卻） */
  npcJoint(id: number): void {
    const row = this.find(id);
    const t = this.now();
    if (!row || row.status !== "active" || !(row.a_key.startsWith("n:") || row.b_key.startsWith("n:"))) throw new ServiceError(404, "找不到這份協議");
    if (row.last_joint_at + JOINT_PROMO_COOLDOWN_MS > t) throw new ServiceError(400, "聯名活動剛辦過");
    const npc = row.a_key.startsWith("n:") ? row.a_key : row.b_key;
    const other = row.a_key === npc ? row.b_key : row.a_key;
    this.repo.setAllianceJoint(id, t);
    this.mailTo(other, "joint_promo", { partner: this.nameOf(npc) });
    this.deliverBoth(row);
  }

  /** 玩家與某 NPC 之間生效中的協議 */
  activeWithNpc(): { id: number; mallKey: string; npcKey: string; lastJointAt: number; startedAt: number }[] {
    return (this.repo.alliancesByStatus("active") as Row[])
      .filter((r) => r.a_key.startsWith("n:") !== r.b_key.startsWith("n:"))
      .map((r) => {
        const npcKey = r.a_key.startsWith("n:") ? r.a_key : r.b_key;
        return { id: r.id, mallKey: r.a_key === npcKey ? r.b_key : r.a_key, npcKey, lastJointAt: r.last_joint_at, startedAt: r.started_at ?? r.created_at };
      });
  }

  /** 排程：過期的邀請視為婉拒；到期的協議結束 */
  tick(): void {
    const t = this.now();
    for (const r of this.repo.alliancesByStatus("pending") as Row[]) {
      if (r.expires_at > t) continue;
      this.repo.setAllianceStatus(r.id, "expired");
      this.mailTo(r.a_key, "notice", { text: `「${this.nameOf(r.b_key)}」沒有回覆你們的聯名邀請，視為婉拒。` });
    }
    for (const r of this.repo.alliancesByStatus("active") as Row[]) {
      if ((r.ends_at ?? 0) > t) continue;
      this.repo.setAllianceStatus(r.id, "ended");
      this.endMails(r, (name) => `和「${name}」的聯名協議到期了。想繼續的話，可以再發一次邀請。`);
    }
  }

  /** 商場被解散或帳號被刪除時，清掉它所有的協議（對方會收到通知） */
  dropMall(mallId: number): void {
    const me = mallKey(mallId);
    for (const r of this.repo.alliancesOf(me, ["pending", "active"]) as Row[]) {
      this.repo.setAllianceStatus(r.id, "ended");
      const partner = r.a_key === me ? r.b_key : r.a_key;
      this.mailTo(partner, "alliance_end", { id: r.id, text: `「${this.nameOf(me)}」已經不在了，聯名協議自動結束。` });
    }
  }
}
