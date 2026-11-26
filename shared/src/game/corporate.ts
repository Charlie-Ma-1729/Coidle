// 法人投資的畫面型別：商場用「公司資金」買賣虛構上市集團的股票（股市 v2 的第一步入股）。
// 規則（上限、門檻、落後門檻）在 ma.ts：單一標的 ≤ 流通股 10%、全部法人投資市值 ≤ 商場現金 40%、
// 落後伺服器 > 1 遊戲日不能下單、持股超過 5% 公開「大量持有報告」。這是 equity.md「錢進出商場只有四條路」之外
// 的第五條路，所以全部受上限約束；手續費與賣出獲利的稅與個人相同（離開遊戲），配息同樣扣稅。
import { CORPORATE_TOTAL_CAP_PCT } from "./ma";

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
