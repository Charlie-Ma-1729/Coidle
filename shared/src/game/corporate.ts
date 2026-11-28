// 法人投資的畫面型別：商場用「公司資金」買賣虛構上市集團的股票（股市 v2 的第一步入股）。
// 規則（上限、門檻、落後門檻）在 ma.ts：單一標的 ≤ 流通股 10%、全部法人投資市值 ≤ 商場現金 40%、
// 落後伺服器 > 1 遊戲日不能下單、持股超過 5% 公開「大量持有報告」。這是 equity.md「錢進出商場只有四條路」之外
// 的第五條路，所以全部受上限約束。手續費離開遊戲；**稅：法人沒有證券分離課稅**（日本），賣出損益與配息不當場扣，
// 併入該會計年度的所得（`DayStats.invest`），年度決算時按法人稅課（虧損可結轉）；配息適用受取配当益金不算入。
import { CORPORATE_TOTAL_CAP_PCT } from "./ma";
import { sellQuote, type SellQuote } from "./market";

/** 受取配当益金不算入（日本）：持股 ≤ 5%（非支配目的）算入 20% 不課稅、> 5% 到 ≤ 10%（其他株式）50% 不課稅 */
export const DIVIDEND_EXEMPT_LOW = 0.2;
export const DIVIDEND_EXEMPT_MID = 0.5;
/** 配息中「益金不算入」的比例（用持股比例，整數比較避免浮點） */
export function dividendExemptRatio(shares: number, outstanding: number): number {
  return shares * 20 > outstanding ? DIVIDEND_EXEMPT_MID : DIVIDEND_EXEMPT_LOW;
}

/** 法人賣出：不當場扣證券所得稅（併入決算），現金＝成交額 − 手續費；gain 是稅前已實現損益（含兩次手續費） */
export function corporateSellQuote(price: number, shares: number, pos: { shares: number; costTotal: number }): SellQuote {
  const q = sellQuote(price, shares, pos);
  return { ...q, tax: 0, net: q.proceeds - q.fee };
}

export interface CorporateHolding {
  key: string;
  name: string;
  sector: string;
  shares: number;
  cost: number;
  price: number;
  value: number;
  pnl: number;
  /** 占流通股的比例（%） */
  pct: number;
}

/** 我管事的一座商場的法人投資帳戶 */
export interface CorporateAccount {
  mallId: number;
  mallName: string;
  /** 公司帳上資金 */
  funds: number;
  holdings: CorporateHolding[];
  /** 投資市值與成本 */
  value: number;
  cost: number;
  /** 全部投資市值還能再增加多少（現金 40% 上限 − 目前投資市值；至少 0） */
  room: number;
  /** 這座商場能不能下單（落後太多為 false，原因在 blocked） */
  canTrade: boolean;
  blocked: string | null;
}

export interface CorporateView {
  accounts: CorporateAccount[];
  singleCap: number;
  totalCap: number;
  disclosurePct: number;
  feeRate: number;
  taxRate: number;
}

/** 全部投資市值還能再增加多少 */
export const corporateRoomValue = (funds: number, value: number): number => Math.max(0, Math.floor(Math.max(0, funds) * CORPORATE_TOTAL_CAP_PCT) - Math.max(0, value));
