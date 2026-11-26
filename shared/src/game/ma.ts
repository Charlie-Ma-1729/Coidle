/**
 * 併購與入股的純規則（型別＋純函式）。設計說明見 docs/group-ma.md。
 *
 * 本檔只有：
 * - 持股門檻與「這個比例到哪一級」的判斷（`holdingTier`、`disclosureRequired`）；
 * - 法人入股（商場用公司資金買虛構集團股票）的上限計算（`corporateCap`）；
 * - 公開收購（TOB）的狀態型別與合法轉移（`nextTenderState`），以及反壟斷審查的判定。
 *
 * 不碰資料庫、不碰時間、不接任何服務；TOB 本身本輪不實作，這裡只是把約定寫成可測試的程式，
 * 日後實作時服務層必須只能透過 `nextTenderState` 改狀態。
 *
 * 比例一律用 0–1 的小數（和 equity.ts 的 `stakeFraction`、`RELATED_STAKE_PCT` 一致）；
 * 邊界判斷先換成「百萬分率」整數再比，避免 0.1、0.334 這類小數的浮點誤差。
 */

import { TICKS_PER_DAY } from "./data";
import { RELATED_STAKE_PCT, CONTROL_PCT } from "./equity";

/* ───────────────────────── 持股門檻 ───────────────────────── */

/** 持股「超過」這個比例要公開「大量持有」消息（日本：大量保有報告書，超過 5%）。不含剛好 5%。 */
export const DISCLOSURE_PCT = 0.05;
/** 法人（商場用公司資金）持有單一標的的上限：流通股的 10%（含剛好 10%）。本輪的入股規則 */
export const CORPORATE_STAKE_CAP_PCT = 0.1;
/** 持股 ≥ 這個比例可以否決特別決議（> 1/3，取 33.4%，整數股下不會讓兩邊同時過不了） */
export const VETO_PCT = 0.334;
/** 持股 ≥ 這個比例可以單獨通過特別決議（2/3，取 66.7%） */
export const SPECIAL_RESOLUTION_PCT = 0.667;
/** 持股 ≥ 這個比例可以簡易合併／強制收購剩餘股份（擠出，squeeze-out） */
export const SQUEEZE_OUT_PCT = 0.9;
/** 全部法人投資的市值上限：買進前商場現金的這個比例 */
export const CORPORATE_TOTAL_CAP_PCT = 0.4;
/** 金融操作（法人入股、將來的 TOB）的落後門檻：落後伺服器超過 1 遊戲日就不能發起（一般互動是 5 遊戲日），避免用舊資訊套利 */
export const FINANCE_MAX_LAG_TICKS = TICKS_PER_DAY;
/** 能不能發起金融操作？可以回傳 null，否則回傳原因（前後端共用同一套說明；比 `interactBlocker` 更嚴） */
export function financeBlocker(lag: number): string | null {
  if (lag > FINANCE_MAX_LAG_TICKS) return "你的商場落後伺服器時間超過 1 個遊戲日，金融操作要先把時間追上來（避免用舊資訊套利）";
  return null;
}
/** 法人買賣手續費率（和個人股市相同的 0.5%；刻意不 import market，避免股市改版時連動）。測試鎖定兩者相等 */
export const CORPORATE_FEE_RATE = 0.005;

/** 持股所在的級距，由低到高；每一級都包含前面各級的權利與義務 */
export type HoldingTier =
  /** < 5%：沒有任何義務與權利 */
  | "none"
  /** > 5%：要公開「大量持有」消息 */
  | "disclosed"
  /** ≥ 10%：商場（法人）入股的上限；個人沒有這條限制 */
  | "cap"
  /** ≥ 20%：關係企業（`isBigStake`、`repo.areRelated`） */
  | "related"
  /** ≥ 33.4%：特別決議否決權 */
  | "veto"
  /** > 50%：實際控制人／子公司（`isControlling`），併入集團 */
  | "controlling"
  /** ≥ 66.7%：可單獨通過特別決議 */
  | "special"
  /** ≥ 90%：可簡易合併／擠出 */
  | "squeeze";

/** 所有級距（由低到高），畫面與測試用 */
export const HOLDING_TIERS: readonly HoldingTier[] = ["none", "disclosed", "cap", "related", "veto", "controlling", "special", "squeeze"];

export interface HoldingTierInfo {
  tier: HoldingTier;
  /** 進入這一級的比例（0–1）；`strict` 表示要「超過」而不是「達到」 */
  at: number;
  strict: boolean;
  label: string;
  note: string;
}

export const HOLDING_TIER_INFO: readonly HoldingTierInfo[] = [
  { tier: "none", at: 0, strict: false, label: "一般持股", note: "沒有特別的義務或權利" },
  { tier: "disclosed", at: DISCLOSURE_PCT, strict: true, label: "大量持有", note: "超過 5%：產生一則公開的「大量持有」消息（沒有價格效果）" },
  { tier: "cap", at: CORPORATE_STAKE_CAP_PCT, strict: false, label: "法人持股上限", note: "10%：商場以公司資金入股單一標的的上限" },
  { tier: "related", at: RELATED_STAKE_PCT, strict: false, label: "關係企業", note: "20%：視同經手，與這家公司互相是關係企業，不能互相買賣" },
  { tier: "veto", at: VETO_PCT, strict: false, label: "否決權", note: "33.4%：特別決議（合併、增資、章程）擋得下來" },
  { tier: "controlling", at: CONTROL_PCT, strict: true, label: "實際控制人", note: "超過 50%：子公司，併入集團，管事的是你" },
  { tier: "special", at: SPECIAL_RESOLUTION_PCT, strict: false, label: "特別決議", note: "66.7%：單獨通過特別決議" },
  { tier: "squeeze", at: SQUEEZE_OUT_PCT, strict: false, label: "擠出", note: "90%：可簡易合併、強制收購剩餘股份" },
];

const PPM = 1_000_000;
const toPpm = (fraction: number): number => Math.round(fraction * PPM);

/** 持股所在級距。`pct` 是 0–1 的小數（不是 0–100）；超出範圍的值夾回 0–1。 */
export function holdingTier(pct: number): HoldingTier {
  const p = Number.isFinite(pct) ? Math.min(1, Math.max(0, pct)) : 0;
  return tierOf(toPpm(p), PPM);
}

/** 用整數股數判斷級距（交叉相乘比較，完全沒有浮點；`total` 是流通在外股數） */
export function holdingTierOf(shares: number, total: number): HoldingTier {
  if (!(total > 0) || !(shares > 0)) return "none";
  return tierOf(Math.min(shares, total), total);
}

/** 持股 num/den 在哪一級：num × 1,000,000 與 門檻（ppm）× den 比較，兩邊都是整數 */
function tierOf(num: number, den: number): HoldingTier {
  let tier: HoldingTier = "none";
  for (const info of HOLDING_TIER_INFO) {
    const lhs = num * PPM;
    const rhs = toPpm(info.at) * den;
    if (info.strict ? lhs > rhs : lhs >= rhs) tier = info.tier;
  }
  return tier;
}

/** 這個持股比例是否要公開「大量持有」消息（> 5%） */
export const disclosureRequired = (pct: number): boolean => holdingTier(pct) !== "none";

/**
 * 持股變動有沒有跨過 5% 線：往上跨＝發布「大量持有」，往下跨回 ≤ 5%＝發布「不再大量持有」。
 * 用整數股數算；消息本身沒有價格效果（避免靠公告炒作）。
 */
export function disclosureCrossing(before: number, after: number, total: number): "up" | "down" | null {
  const was = holdingTierOf(before, total) !== "none";
  const now = holdingTierOf(after, total) !== "none";
  if (!was && now) return "up";
  if (was && !now) return "down";
  return null;
}

/** 持股達到擠出門檻（≥ 90%） */
export const canSqueezeOut = (shares: number, total: number): boolean => holdingTierOf(shares, total) === "squeeze";

/* ───────────────────────── 法人入股的上限 ───────────────────────── */

export interface CorporateCapInput {
  /** 標的流通在外股數 */
  outstanding: number;
  /** 這座商場目前已持有這個標的的股數 */
  held: number;
  /** 這一步的成交價（每股，由伺服器定） */
  price: number;
  /** 買進前的商場現金 */
  mallCash: number;
  /** 買進前，這座商場全部法人投資的市值（用現在的價格算） */
  portfolioValue: number;
}

export interface CorporateCapResult {
  /** 這次最多還能買幾股（整數，≥ 0） */
  maxShares: number;
  /** 單一標的上限（流通股 10%）還剩多少股 */
  byStock: number;
  /** 全部法人投資上限（現金 40%）還剩多少股 */
  byTotal: number;
  /** 現金付得起（含手續費）的股數 */
  byCash: number;
  /** 是哪一條在限制；`none` 表示買不到 0 股以上的限制都沒碰到（outstanding 為 0 之類的異常） */
  binding: "stock" | "total" | "cash" | "none";
}

/** 買 `shares` 股要付的股款與手續費（手續費無條件進位，與個人股市同） */
export function corporateCost(shares: number, price: number): { amount: number; fee: number; total: number } {
  const amount = Math.max(0, Math.ceil(shares * price));
  const fee = Math.ceil(amount * CORPORATE_FEE_RATE);
  return { amount, fee, total: amount + fee };
}

/**
 * 商場想買某個標的：現在最多買幾股。取三條上限的最小值——
 * ① 單一標的：買進後持股 ≤ 流通股的 10%；
 * ② 全部法人投資：買進後的投資市值（不含手續費）≤ 買進前商場現金的 40%；
 * ③ 現金：股款加手續費付得起。
 * 只限制「買進」；已經超過上限（股價上漲、現金被花掉）不強制賣出，但不能再買。
 */
export function corporateCap(i: CorporateCapInput): CorporateCapResult {
  const price = i.price > 0 ? i.price : 0;
  if (!(price > 0) || !(i.outstanding > 0)) return { maxShares: 0, byStock: 0, byTotal: 0, byCash: 0, binding: "none" };

  const byStock = Math.max(0, Math.floor((i.outstanding * CORPORATE_STAKE_CAP_PCT) + 1e-9) - Math.max(0, Math.floor(i.held)));
  const roomValue = Math.floor(Math.max(0, i.mallCash) * CORPORATE_TOTAL_CAP_PCT) - Math.max(0, i.portfolioValue);
  const byTotal = roomValue > 0 ? Math.floor(roomValue / price) : 0;

  // 現金：先用除法估一個上界，再往下找到「付得起」的最大整數股
  let byCash = Math.max(0, Math.floor(Math.max(0, i.mallCash) / (price * (1 + CORPORATE_FEE_RATE))) + 1);
  while (byCash > 0 && corporateCost(byCash, price).total > i.mallCash) byCash--;

  const maxShares = Math.min(byStock, byTotal, byCash);
  const binding: CorporateCapResult["binding"] = byStock <= byTotal && byStock <= byCash ? "stock" : byTotal <= byCash ? "total" : "cash";
  return { maxShares, byStock, byTotal, byCash, binding };
}

/* ───────────────────────── 公開收購（TOB） ───────────────────────── */

/** 友好（董事會同意）或敵意（未經同意直接向股東收購） */
export type TenderKind = "friendly" | "hostile";

/** 目標方的防禦手段（設計見 docs/group-ma.md；本輪只列型別） */
export type DefenseKind = "poison_pill" | "white_knight" | "buyback" | "crown_jewel" | "persuasion";

/**
 * 公開收購的狀態：
 * `announced` 宣告（公開收購說明書，之後不得單方面改條件）→
 * `antitrust_review` 反壟斷審查（合併後市占超過門檻才進來）→
 * `open` 收購期間（股東應賣；可延長）→
 * `succeeded` 期滿且達最低收購股數／`failed` 未達／`blocked` 審查不通過／`withdrawn` 撤回 →
 * `squeezing` 擠出中（成立後持股 ≥ 90%）→ `completed` 結算完成。
 */
export type TenderState = "announced" | "antitrust_review" | "open" | "succeeded" | "failed" | "blocked" | "withdrawn" | "squeezing" | "completed";

export type TenderEvent =
  /** 宣告後須要審查 */
  | "review"
  /** 不需審查，或審查通過，開始收購期間 */
  | "open"
  /** 審查不通過 */
  | "block"
  /** 收購期間延長（狀態不變；延長次數與上限由服務層管） */
  | "extend"
  /** 期滿且達到最低收購股數 */
  | "succeed"
  /** 期滿未達最低收購股數 */
  | "fail"
  /** 收購方撤回（要有代價，由服務層決定） */
  | "withdraw"
  /** 成立後直接結算（持股未達 90%） */
  | "settle"
  /** 成立後持股 ≥ 90%，開始擠出 */
  | "squeeze"
  /** 擠出完成 */
  | "finish";

/** 終結狀態：不會再變 */
export const TENDER_TERMINAL: readonly TenderState[] = ["failed", "blocked", "withdrawn", "completed"];

export const isTenderTerminal = (s: TenderState): boolean => TENDER_TERMINAL.includes(s);

const TENDER_TRANSITIONS: Record<TenderState, Partial<Record<TenderEvent, TenderState>>> = {
  announced: { review: "antitrust_review", open: "open", withdraw: "withdrawn" },
  antitrust_review: { open: "open", block: "blocked", withdraw: "withdrawn" },
  open: { extend: "open", succeed: "succeeded", fail: "failed", withdraw: "withdrawn" },
  succeeded: { settle: "completed", squeeze: "squeezing" },
  squeezing: { finish: "completed" },
  failed: {},
  blocked: {},
  withdrawn: {},
  completed: {},
};

/** 合法的狀態轉移：不合法回 `null`（服務層必須把 null 當成錯誤，不可以硬改狀態） */
export function nextTenderState(state: TenderState, event: TenderEvent): TenderState | null {
  return TENDER_TRANSITIONS[state]?.[event] ?? null;
}

/** 這個狀態下還能發生哪些事件 */
export const tenderEventsFrom = (state: TenderState): TenderEvent[] => Object.keys(TENDER_TRANSITIONS[state] ?? {}) as TenderEvent[];

/* ───────── 反壟斷審查（以市占判定） ───────── */

/** 併購後（收購方＋目標方）在同一業態的合計市占超過這個比例，進入審查 */
export const ANTITRUST_REVIEW_SHARE = 0.35;
/** 合計市占超過這個比例，直接不准 */
export const ANTITRUST_BLOCK_SHARE = 0.5;

export type AntitrustVerdict = "clear" | "review" | "blocked";

/** 依併購後合計市占（0–1）判定：不需要審查／需要審查／不准。「市占」怎麼算由服務層定義（見 docs/group-ma.md） */
export function antitrustVerdict(combinedShare: number): AntitrustVerdict {
  const p = toPpm(Number.isFinite(combinedShare) ? combinedShare : 0);
  if (p > toPpm(ANTITRUST_BLOCK_SHARE)) return "blocked";
  if (p > toPpm(ANTITRUST_REVIEW_SHARE)) return "review";
  return "clear";
}
