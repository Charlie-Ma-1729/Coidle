import { CATEGORY_BY_ID, TICKS_PER_DAY } from "./data";
import type { MallState, Obligation, ObligationKind, SupplierDef } from "./types";

// 日本的稅務與法規。
// 原則：真實的名稱與邏輯（消費稅、法人稅等、固定資產稅、社會保險、許認可），但全部自動處理、
// 只在「現金要夠」這件事上需要玩家留意；沒有任何需要每月手動操作的繁瑣流程。
// 稅率依 2026 年度的制度整理，僅供遊戲使用，並非稅務建議。

// ───────── 消費稅 ─────────
export const CONSUMPTION_STANDARD = 0.1;
/** 輕減稅率（外帶食品、飲料；不含酒類與店內用餐） */
export const CONSUMPTION_REDUCED = 0.08;

/** 這個業態賣出的東西適用的稅率。診所（保險診療）與認可托育是非課稅 */
export function consumptionRate(category: string): number {
  if (["grocery", "bubble_tea", "sweets"].includes(category)) return CONSUMPTION_REDUCED;
  if (["clinic", "daycare"].includes(category)) return 0;
  return CONSUMPTION_STANDARD;
}

/** 進貨（含稅價）裡的稅率：食材 8%，商品與其他 10% */
export function purchaseRate(family: string | null): number {
  return family && family !== "goods" ? CONSUMPTION_REDUCED : CONSUMPTION_STANDARD;
}

/** 含稅金額中的稅額 */
export function taxPortion(gross: number, rate: number): number {
  return rate <= 0 ? 0 : (gross * rate) / (1 + rate);
}

/**
 * 發票制度（インボイス）：跟「沒登錄」的小型供應商進貨，進項稅額只能部分扣抵。
 * 過渡措施（2026 年度稅制改正後）：～2026/9 80%、2026/10～2028/9 70%、～2030/9 50%、～2031/9 30%、之後 0%。
 */
export function invoiceCreditRate(date: string): number {
  if (date <= "2026-09-30") return 0.8;
  if (date <= "2028-09-30") return 0.7;
  if (date <= "2030-09-30") return 0.5;
  if (date <= "2031-09-30") return 0.3;
  return 0;
}

export function supplierCreditRate(def: Pick<SupplierDef, "invoice"> | undefined, date: string): number {
  return def?.invoice === false ? invoiceCreditRate(date) : 1;
}

// ───────── 法人稅等 ─────────
export const SME_LOW_BRACKET = 8_000_000;
export const CORP_RATE_LOW = 0.15; // 中小法人 年所得 800 萬圓以下
export const CORP_RATE_STD = 0.232;
export const LOCAL_CORP_RATE = 0.103; // 地方法人稅（法人稅額的 10.3%）
export const INHABITANT_RATE = 0.104; // 法人住民稅 法人稅割（法人稅額的 10.4%）
export const DEFENSE_RATE = 0.04; // 防衛特別法人稅（法人稅額超過 500 萬圓的部分 × 4%，2026 年度起）
export const DEFENSE_DEDUCTION = 5_000_000;
export const PER_CAPITA_LEVY = 180_000; // 法人住民稅 均等割（每年）
export const LOSS_CARRY_LIMIT = 1; // 中小法人：虧損可全額結轉扣抵

export interface CorporateTax {
  income: number;
  national: number;
  local: number;
  inhabitant: number;
  defense: number;
  business: number;
  levy: number;
  total: number;
  /** 實質稅率（占所得） */
  effective: number;
}

/** 事業稅（含特別法人事業稅）：年所得 400 萬以下 3.5%、～800 萬 5.3%、以上 7.0% */
function businessTax(income: number): number {
  return Math.min(income, 4_000_000) * 0.035 + Math.max(0, Math.min(income, 8_000_000) - 4_000_000) * 0.053 + Math.max(0, income - 8_000_000) * 0.07;
}

export function corporateTax(income: number): CorporateTax {
  const i = Math.max(0, Math.round(income));
  const national = Math.min(i, SME_LOW_BRACKET) * CORP_RATE_LOW + Math.max(0, i - SME_LOW_BRACKET) * CORP_RATE_STD;
  const local = national * LOCAL_CORP_RATE;
  const inhabitant = national * INHABITANT_RATE;
  const defense = Math.max(0, national - DEFENSE_DEDUCTION) * DEFENSE_RATE;
  const business = businessTax(i);
  const levy = PER_CAPITA_LEVY;
  const total = Math.round(national + local + inhabitant + defense + business + levy);
  return { income: i, national: Math.round(national), local: Math.round(local), inhabitant: Math.round(inhabitant), defense: Math.round(defense), business: Math.round(business), levy, total, effective: i > 0 ? total / i : 0 };
}

// ───────── 固定資產稅、社會保險、獎金 ─────────
/** 商場大樓本體（土地與建物）的評價額；店面的投資另外加上去 */
export const BUILDING_BASE_VALUE = 1_500_000_000;
/** 固定資產稅 1.4% ＋ 都市計畫稅 0.3% */
export const PROPERTY_TAX_RATE = 0.017;
/** 每年 6、9、12、2 月各繳四分之一 */
export const PROPERTY_MONTHS = [6, 9, 12, 2] as const;
/** 雇主負擔的社會保險：健保＋育兒支援金≈5.1%、厚生年金 9.15%、雇用保險≈0.9%、勞災≈0.3%、兒童津貼拠出金 0.36%（約 15.8%） */
export const EMPLOYER_SOCIAL_RATE = 0.158;
/** 夏季（6 月）與冬季（12 月）獎金：各 0.4 個月的薪資 */
export const BONUS_MONTHS = [6, 12] as const;
export const BONUS_FACTOR = 0.4;
/** 逾期未繳：每日加收（約年率 7.3% 的延滯稅） */
export const LATE_FEE_PER_DAY = 0.0002;

/** 店面累積的投資額（建造與翻新），當作固定資產稅的課稅基礎 */
export function assessedValue(s: Pick<MallState, "shops">): number {
  let v = BUILDING_BASE_VALUE;
  for (const sh of s.shops) {
    const cat = CATEGORY_BY_ID[sh.category];
    if (cat) v += cat.buildCost * sh.level;
  }
  return v;
}

// ───────── 勞動基準法 ─────────
/** 深夜（22:00–5:00）薪資加成 25%；每日營業超過 14 小時（兩班制）的部分視為加班，加成 25% */
export function laborCostFactor(open: number, close: number): number {
  const total = Math.max(1, close - open);
  const night = Math.max(0, close - 22) + Math.max(0, 5 - open);
  const over = Math.max(0, total - 14);
  return 1 + (0.25 * (night + over)) / total;
}

// ───────── 許認可（開店要先辦的手續） ─────────
export interface LicenseDef {
  name: string;
  law: string;
  /** 規費與代辦費 */
  fee: number;
  /** 審查所需的額外 tick */
  extraTicks: number;
}

const FOOD: LicenseDef = { name: "飲食店營業許可", law: "食品衛生法（保健所許可、需有食品衛生責任者）", fee: 20_000, extraTicks: 24 };
export const LICENSES: Record<string, LicenseDef> = {
  ...Object.fromEntries(
    ["ramen", "takoyaki", "kushikatsu", "kissaten", "udon", "bubble_tea", "sweets", "curry", "brunch", "italian", "fastfood", "yakiniku", "sushi", "hotpot", "fine_dining"].map((c) => [c, FOOD]),
  ),
  grocery: { name: "食品販售許可", law: "食品衛生法（保健所）", fee: 15_000, extraTicks: 24 },
  izakaya: { name: "飲食店營業許可＋深夜酒類提供飲食店營業申報", law: "食品衛生法／風營法（警察署申報）", fee: 35_000, extraTicks: 48 },
  bar: { name: "飲食店營業許可＋深夜酒類提供飲食店營業申報", law: "食品衛生法／風營法（警察署申報）", fee: 35_000, extraTicks: 48 },
  arcade_vr: { name: "風俗營業許可（遊戲中心）", law: "風營法（公安委員會，需審查營業所構造與周邊環境）", fee: 100_000, extraTicks: 576 },
  drugstore: { name: "藥品販售業登錄（登錄販賣者）", law: "藥機法（醫藥品醫療機器等法）", fee: 30_000, extraTicks: 48 },
  clinic: { name: "診所開設申報", law: "醫療法（保健所；開設者須為醫師或醫療法人）", fee: 50_000, extraTicks: 96 },
  spa: { name: "美容所／公共浴場相關申報", law: "美容師法・公共浴場法（保健所檢查）", fee: 25_000, extraTicks: 48 },
  salon: { name: "美容所開設申報", law: "美容師法（保健所檢查、需有美容師）", fee: 25_000, extraTicks: 48 },
  daycare: { name: "認可外保育設施設置申報", law: "兒童福祉法（都道府縣）", fee: 30_000, extraTicks: 96 },
  hotel: { name: "旅館業營業許可", law: "旅館業法（保健所；消防與建築基準合格證明）", fee: 100_000, extraTicks: 144 },
  cinema: { name: "劇場營業的消防與建築檢查", law: "消防法・建築基準法", fee: 60_000, extraTicks: 72 },
  karaoke: { name: "營業申報（含著作權使用費契約）", law: "風營法周邊規範・著作權法（JASRAC 類團體）", fee: 20_000, extraTicks: 24 },
};

export function licenseOf(category: string): LicenseDef | null {
  return LICENSES[category] ?? null;
}

/** 著作權使用費：KTV 營收的 2.5%，每月結算 */
export const ROYALTY_RATE = 0.025;
export const ROYALTY_CATEGORIES = ["karaoke"];

// ───────── 帳單顯示 ─────────
export const OBLIGATION_NAMES: Record<ObligationKind, { name: string; icon: string; law: string }> = {
  consumption: { name: "消費稅", icon: "🧾", law: "消費稅法：銷項稅額 − 進項稅額，每季繳納" },
  corporate: { name: "法人稅等（決算）", icon: "🏛", law: "法人稅・地方法人稅・法人住民稅・事業稅・防衛特別法人稅；會計年度 4–3 月，決算後 2 個月內繳" },
  corporate_interim: { name: "法人稅等（中間申報）", icon: "🏛", law: "會計年度過半時，預繳前一年稅額的一半" },
  property: { name: "固定資產稅・都市計畫稅", icon: "🏢", law: "地方稅法：每年 6、9、12、2 月分四期繳納" },
  social: { name: "社會保險（雇主負擔）", icon: "🧑‍💼", law: "健康保險・厚生年金・雇用保險・勞災保險，次月繳納" },
  bonus: { name: "夏冬獎金", icon: "🎁", law: "慣例的賞與（6、12 月），含社會保險負擔" },
  royalty: { name: "著作權使用費", icon: "🎵", law: "著作權法：播放音樂的 KTV 向管理團體繳納" },
};

/** 還沒繳的金額（含延滯） */
export function billOutstanding(b: Obligation): number {
  return Math.max(0, Math.round(b.amount + b.lateFee - b.paid));
}

export function billsDueWithin(s: Pick<MallState, "tax" | "tick">, ticks: number): number {
  return s.tax.bills.filter((b) => b.dueTick <= s.tick + ticks).reduce((a, b) => a + billOutstanding(b), 0);
}

export const DAY_TICKS = TICKS_PER_DAY;
