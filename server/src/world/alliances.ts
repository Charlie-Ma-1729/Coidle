import {
  ALLIANCE_GAME_DAYS,
  ALLIANCE_INVITE_MS,
  ALLIANCE_MAX_ACTIVE,
  ALLIANCE_MAX_PENDING,
  ALLIANCE_REAL_MS,
  JOINT_PROMO_COOLDOWN_MS,
  jointPromoCost,
  npcAcceptsAlliance,
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
    this.repo.addMail(id, kind, payload, t, t);
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
        partnerKey,
        partnerName: e?.name ?? "（已不存在的商場）",
        partnerKind: partnerKey.startsWith("n:") ? "npc" : "player",
        until: r.status === "pending" ? r.expires_at : r.ends_at ?? 0,
        jointReadyAt: Math.max(0, r.last_joint_at + JOINT_PROMO_COOLDOWN_MS),
      });
    }
    return out;
  }

  propose(mallId: number, targetKey: string): AllianceView[] {
    const me = mallKey(mallId);
    if (typeof targetKey !== "string" || targetKey === me) throw new ServiceError(400, "請選擇另一座商場");
    const target = this.entryOf(targetKey);
    if (!target) throw new ServiceError(404, "找不到這座商場");
    const mine = this.host.snapshot(mallId);
    const t = this.now();

    const existing = (this.repo.alliancesOf(me, ["pending", "active"]) as Row[]).filter((r) => (r.status === "active" || r.expires_at > t) && (r.a_key === targetKey || r.b_key === targetKey));
    if (existing.length > 0) throw new ServiceError(400, "你們已經有聯名協議或邀請了");
    if (this.activeOf(me) >= ALLIANCE_MAX_ACTIVE) throw new ServiceError(400, `聯名協議最多同時 ${ALLIANCE_MAX_ACTIVE} 份`);
    const outgoing = (this.repo.alliancesOf(me, ["pending"]) as Row[]).filter((r) => r.a_key === me && r.expires_at > t).length;
    if (outgoing >= ALLIANCE_MAX_PENDING) throw new ServiceError(400, "送出的邀請太多了，等對方回覆再說");

    if (target.kind === "npc") {
      const myEntry = this.entryOf(me);
      const myScore = myEntry?.score ?? mine.score;
      if (!npcAcceptsAlliance(target.score, myScore)) {
        throw new ServiceError(400, `「${target.name}」覺得現在的你們還不夠格（對方綜合 ${target.score.toFixed(1)} 分，你們 ${myScore.toFixed(1)} 分，要在 8 分以內）`);
      }
      const id = this.repo.addAlliance(me, targetKey, "active", t, t, t, t + ALLIANCE_REAL_MS);
      const row = this.find(id)!;
      this.startMail(row);
      this.host.deliver(mallId);
      return this.list(mallId);
    }

    if (this.activeOf(targetKey) >= ALLIANCE_MAX_ACTIVE) throw new ServiceError(400, "對方的聯名名額已經滿了");
    this.repo.addAlliance(me, targetKey, "pending", t, t + ALLIANCE_INVITE_MS, null, null);
    this.mailTo(targetKey, "notice", { text: `「${this.nameOf(me)}」想和你們簽聯名協議。到「更多 → 名錄」回覆（24 小時內有效，沒回覆視為婉拒）。` });
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
