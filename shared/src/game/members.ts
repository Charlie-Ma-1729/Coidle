import type { MemberState } from "./types";

// 會員制：商場自己發行的點數卡（日本常見的ポイントカード）。
// 原則：
//  - 點數是「負債」：發出去的點數日後會被兌換，兌換時才算成本（和現實的自家型前払式支付手段一樣）；沒用完的點數會慢慢失效。
//  - 會員越多，回頭客越多；但回饋率越高成本越高，邊際效益遞減，所以最高檔不是最優解。
//  - 會員資料是個資：人數越多，外洩的風險越高（見 legal.ts 的個資外洩糾紛）。
//  - 資金決済法：自家型的點數累計未使用餘額超過一定金額要辦理供託與申報（遊戲裡只用文字提示，不另收費）。

export const MEMBER_RATES = [0, 1, 2, 3, 5] as const;
export type MemberRate = (typeof MEMBER_RATES)[number];

export interface MemberTierDef {
  id: "general" | "silver" | "gold" | "platinum";
  name: string;
  icon: string;
  /** 會員數達到多少升級 */
  min: number;
  perk: string;
}
export const MEMBER_TIERS: MemberTierDef[] = [
  { id: "general", name: "一般會員", icon: "🪪", min: 0, perk: "基本的點數回饋。" },
  { id: "silver", name: "銀級", icon: "🥈", min: 300, perk: "客流小加成；熟客的關係成長更快。" },
  { id: "gold", name: "金級", icon: "🥇", min: 1_500, perk: "客流中加成；會員更願意帶朋友。" },
  { id: "platinum", name: "白金級", icon: "💎", min: 6_000, perk: "客流較大加成；人氣緩慢地自然成長。" },
];

export function newMemberState(): MemberState {
  return { rate: 0, count: 0, points: 0, totalIssued: 0, totalRedeemed: 0, totalExpired: 0, lastDayIssued: 0, lastDayRedeemed: 0 };
}

export function memberTier(count: number): MemberTierDef {
  let t = MEMBER_TIERS[0]!;
  for (const x of MEMBER_TIERS) if (count >= x.min) t = x;
  return t;
}
export function memberTierIndex(count: number): number {
  return MEMBER_TIERS.findIndex((t) => t.id === memberTier(count).id);
}

/** 會員占消費者的比例（0–0.6）：1,500 人時約一半 */
export function memberShare(count: number): number {
  return Math.min(0.6, count / (count + 1_500));
}

/** 每個遊戲日新入會人數占「今日來客組數」的比例（回饋率越高越吸引人，但遞減） */
export function signupRate(rate: number): number {
  return rate <= 0 ? 0 : 0.012 * Math.sqrt(rate);
}

/** 整體客流加成（乘上去）。沒發點數時，會員只剩一小部分慣性 */
export function memberTrafficMult(m: Pick<MemberState, "rate" | "count"> | undefined): number {
  if (!m || m.count <= 0) return 1;
  const share = memberShare(m.count);
  const active = m.rate > 0 ? Math.sqrt(m.rate / 3) : 0.3;
  const tierBonus = 0.01 * memberTierIndex(m.count);
  return 1 + 0.12 * share * active + (m.rate > 0 ? tierBonus : 0);
}

/** 熟客關係成長倍率（會員多、有發點數時，熟客更黏） */
export function memberAffinityMult(m: Pick<MemberState, "rate" | "count"> | undefined): number {
  if (!m || m.rate <= 0) return 1;
  return 1 + 0.5 * memberShare(m.count);
}

/** 每日兌換比例：欠客人的點數，每天有這麼多被用掉 */
export const POINT_REDEEM_PER_DAY = 0.06;
/** 每日失效比例（沒用完的點數慢慢過期） */
export const POINT_EXPIRE_PER_DAY = 0.004;
/** 累計未使用點數超過這個金額，要依資金決済法辦理（文字提示） */
export const POINT_REPORT_LIMIT = 10_000_000;
/** 會員人數達到這個數，開始有個資外洩的風險 */
export const MEMBER_PRIVACY_MIN = 300;
