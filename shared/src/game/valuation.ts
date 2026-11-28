/**
 * 商場股權估值（商場內部換股用：注資換股、回購、出價）。
 * 以前只看現金，會被進貨／貸款／囤現金左右。現在：
 *   淨資產 ＝ 現金 ＋ 庫存（含在途）成本 ＋ 店面與設備折舊價值 ＋ 法人持股市價淨值（`holdMark`，扣一次賣出手續費）− 貸款餘額
 *   獲利價值 ＝ 近幾個遊戲日的平均每日利潤 × 倍數
 *   估值 ＝ 淨資產 ＋ 獲利溢價（只加不減：賺錢的商場值得比帳面多，沒賺錢也不低於資產）
 * 單日價格變動再由 `clampToAnchor` 夾在前一個遊戲日收盤估值的 ±PRICE_DAILY_BAND 內（防操作）。
 * 商場持股市價已併入（所以「用現金買股」只會讓估值少一次手續費，不再能靠買股壓低估值去稀釋）。
 * 不含：REIT、IPO 上市價（等做 IPO 時再接，見 docs/group-ma.md §5.5）。
 */

import { CATEGORY_BY_ID } from "./data";
import { debtOf } from "./finance";
import type { MallState } from "./types";

/** 店面／設備折舊係數：帳面＝建造費 × 等級 × （BASE ＋ 設備狀況 0–100% × EQUIP） */
export const ASSET_DEPR_BASE = 0.4;
export const ASSET_DEPR_EQUIP = 0.4;
/** 獲利取近幾個遊戲日的平均 */
export const PROFIT_WINDOW_DAYS = 6;
/** 獲利價值＝平均每日利潤 × 這個倍數（天） */
export const PROFIT_MULTIPLE_DAYS = 30;
/** 獲利價值超過淨資產的部分，只算這個比例進估值 */
export const PROFIT_PREMIUM_SHARE = 0.5;
/** 獲利溢價最多不超過淨資產的這個倍數（估值最多 ≈ 淨資產 × 2） */
export const PROFIT_PREMIUM_CAP = 1;
/** 每遊戲日價格最多從前一日收盤估值上下浮動這個比例 */
export const PRICE_DAILY_BAND = 0.1;

export type ValuationInput = Pick<MallState, "funds" | "shops" | "reports" | "equipment"> & Partial<Pick<MallState, "finance" | "holdMark">>;

/** 庫存（含在途）按進貨成本計 */
export function inventoryValue(s: Pick<ValuationInput, "shops">): number {
  let v = 0;
  for (const sh of s.shops) {
    if (sh.mode !== "direct") continue;
    const cat = CATEGORY_BY_ID[sh.category];
    if (!cat) continue;
    const incoming = (sh.incoming ?? []).reduce((a, i) => a + i.qty, 0);
    v += Math.max(0, sh.stock + incoming) * cat.refPrice * cat.costRatio;
  }
  return v;
}

/** 店面與設備的折舊價值（不含大樓本身） */
export function fixedAssetValue(s: Pick<ValuationInput, "shops" | "equipment">): number {
  const factor = ASSET_DEPR_BASE + (ASSET_DEPR_EQUIP * Math.min(100, Math.max(0, s.equipment ?? 0))) / 100;
  let v = 0;
  for (const sh of s.shops) {
    const cat = CATEGORY_BY_ID[sh.category];
    if (cat) v += cat.buildCost * sh.level * factor;
  }
  return v;
}

/** 淨資產（可為負） */
export function netAssets(s: ValuationInput): number {
  return s.funds + inventoryValue(s) + fixedAssetValue(s) + Math.max(0, s.holdMark ?? 0) - debtOf(s.finance);
}

/** 近 PROFIT_WINDOW_DAYS 日平均每日利潤 × 倍數（不為負；沒有日報＝0）。日報不足時照滿窗口平均，新商場的獲利溢價是逐日爬升，不會第一天就跳 */
export function profitValue(s: Pick<ValuationInput, "reports">): number {
  const rs = s.reports.slice(-PROFIT_WINDOW_DAYS);
  const avg = rs.reduce((a, r) => a + r.profit, 0) / PROFIT_WINDOW_DAYS;
  return Math.max(0, avg * PROFIT_MULTIPLE_DAYS);
}

/** 整座商場的股權價值（整數、不小於 0） */
export function mallBookValue(s: ValuationInput): number {
  const na = Math.max(0, netAssets(s));
  const premium = Math.min(na * PROFIT_PREMIUM_CAP, Math.max(0, profitValue(s) - na) * PROFIT_PREMIUM_SHARE);
  return Math.max(0, Math.round(na + premium));
}

/** 把即時估值夾在錨點（前一遊戲日收盤估值）±PRICE_DAILY_BAND 內；沒有錨點（舊存檔／新商場）就用即時值 */
export function clampToAnchor(live: number, anchor: number | undefined): number {
  if (!anchor || anchor <= 0) return live;
  return Math.round(Math.min(anchor * (1 + PRICE_DAILY_BAND), Math.max(anchor * (1 - PRICE_DAILY_BAND), live)));
}
