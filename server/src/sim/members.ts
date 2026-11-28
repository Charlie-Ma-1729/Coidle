import {
  MEMBER_RATES,
  MEMBER_TIERS,
  POINT_EXPIRE_PER_DAY,
  POINT_REDEEM_PER_DAY,
  memberShare,
  memberTier,
  newMemberState,
  signupRate,
  techFx,
  type MallState,
  type MemberState,
} from "@coidle/shared";
import { addLog } from "./state";


export type MemberResult = { ok: true; note: string } | { ok: false; error: string };

export function membersOf(s: MallState): MemberState {
  if (!s.members) s.members = newMemberState();
  return s.members;
}

/** 每筆直營店成交：會員消費依回饋率累積點數（點數是負債，兌換時才算成本） */
export function earnPoints(s: MallState, revenue: number): void {
  const m = s.members;
  if (!m || m.rate <= 0 || revenue <= 0) return;
  const pts = revenue * memberShare(m.count) * (m.rate / 100);
  m.points += pts;
  m.totalIssued += pts;
  s.today.memberIssued = (s.today.memberIssued ?? 0) + pts;
}

export function setMembership(s: MallState, rate: number): MemberResult {
  if (!(MEMBER_RATES as readonly number[]).includes(rate)) return { ok: false, error: "回饋率無效" };
  // 要先研發「會員與點數系統」；已經在發點數或有會員的舊存檔照舊可用
  const cur = s.members;
  if (!techFx(s.tech.done).memberCard && !((cur?.rate ?? 0) > 0 || (cur?.count ?? 0) > 0)) return { ok: false, error: "要先研發「會員與點數系統」科技" };
  const m = membersOf(s);
  if (m.rate === rate) return { ok: false, error: "已經是這個回饋率了" };
  const was = m.rate;
  m.rate = rate;
  addLog(s, "info", rate === 0 ? "🪪 會員點數停止發放（已發出的點數仍然可以使用）。" : `🪪 會員點數回饋率${was === 0 ? "開始" : "調整為"} ${rate}%。`);
  return { ok: true, note: rate === 0 ? "停止發放點數了。" : `點數回饋率 ${rate}%。` };
}

/** 每日：新入會、兌換點數（成本）、點數慢慢失效、會員升級 */
export function membersDaily(s: MallState): void {
  const m = s.members;
  if (!m) return;
  const tierBefore = memberTier(m.count).id;
  if (m.rate > 0) {
    const n = Math.round(s.today.groups * signupRate(m.rate) * (1 - memberShare(m.count)));
    m.count += n;
  } else {
    m.count = Math.floor(m.count * 0.997); // 不發點數，會員慢慢流失
  }
  const redeem = Math.min(m.points, Math.round(m.points * POINT_REDEEM_PER_DAY));
  if (redeem > 0) {
    s.funds -= redeem;
    s.today.repairs += redeem;
    s.today.memberCost = (s.today.memberCost ?? 0) + redeem;
    m.points -= redeem;
    m.totalRedeemed += redeem;
  }
  const expire = Math.round(m.points * POINT_EXPIRE_PER_DAY);
  if (expire > 0) {
    m.points -= expire;
    m.totalExpired += expire;
  }
  m.lastDayIssued = Math.round(s.today.memberIssued ?? 0);
  m.lastDayRedeemed = redeem;
  const tier = memberTier(m.count);
  if (tier.id !== tierBefore && MEMBER_TIERS.findIndex((t) => t.id === tier.id) > MEMBER_TIERS.findIndex((t) => t.id === tierBefore)) {
    addLog(s, "info", `🪪 會員數達 ${m.count.toLocaleString("en-US")} 人，升到「${tier.name}」！${tier.perk}`);
    if (s.today.systemNotes.length < 8) s.today.systemNotes.push(`會員升到「${tier.name}」。`);
  }
}
