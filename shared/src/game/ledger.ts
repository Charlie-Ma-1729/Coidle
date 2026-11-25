import { CATEGORY_BY_ID, CLEANING_COST_PER_DAY, MAINTENANCE_COST_PER_DAY, UTILITIES_PER_DAY } from "./data";
import { facilityScale } from "./helpers";
import { RESERVE_UPKEEP_PER_DAY } from "./regulars";
import { laborCostFactor } from "./tax";
import { techFx } from "./tech";
import type { MallState } from "./types";

type CostInput = Pick<MallState, "shops" | "hours" | "tech" | "cleaningLevel" | "maintenanceLevel">;

/** 一天的薪資（深夜與長時間營業有加成） */
export function dailyWages(s: Pick<MallState, "shops" | "hours" | "tech">): number {
  let c = 0;
  for (const shop of s.shops) {
    if (shop.mode === "lease") continue;
    const cat = CATEGORY_BY_ID[shop.category];
    if (cat) c += cat.wage * shop.level;
  }
  return c * laborCostFactor(s.hours.open, s.hours.close) * techFx(s.tech.done).wageMult;
}

/** 一天的營運支出（水電、清潔、維護）：可扣抵進項稅 */
export function dailyOverhead(s: Pick<MallState, "shops" | "tech" | "cleaningLevel" | "maintenanceLevel">): number {
  return (UTILITIES_PER_DAY + (CLEANING_COST_PER_DAY[s.cleaningLevel] + MAINTENANCE_COST_PER_DAY[s.maintenanceLevel]) * facilityScale(s)) * techFx(s.tech.done).overheadMult;
}

export interface FixedCostBreakdown {
  /** 水電（含科技折減） */
  utilities: number;
  /** 清潔＋維護團隊 */
  upkeep: number;
  /** 員工薪資（直營店的店員，含深夜／加班加成） */
  wages: number;
  /** 常客專屬座位的維持費 */
  reserved: number;
  /** 每天合計（不含下雨加派清潔的加班費） */
  perDay: number;
  /** 每小時（成本整天均攤，營業或打烊都一樣） */
  perHour: number;
  /** 一天裡打烊的小時數 */
  closedHours: number;
  /** 打烊時段一天會花掉多少 */
  closedPerDay: number;
}

/** 固定成本的每日明細：給畫面說明「打烊了為什麼還在花錢」。算式與模擬一致（成本整天均攤到每個 tick）。 */
export function fixedCostBreakdown(s: CostInput & { regulars: { reserved?: boolean }[] }): FixedCostBreakdown {
  const overhead = dailyOverhead(s);
  const mult = techFx(s.tech.done).overheadMult;
  const utilities = UTILITIES_PER_DAY * mult;
  const upkeep = overhead - utilities;
  const wages = dailyWages(s);
  const reserved = s.regulars.filter((r) => r.reserved).length * RESERVE_UPKEEP_PER_DAY;
  const perDay = overhead + wages + reserved;
  const openHours = Math.max(0, Math.min(24, s.hours.close - s.hours.open));
  const closedHours = 24 - openHours;
  return { utilities, upkeep, wages, reserved, perDay, perHour: perDay / 24, closedHours, closedPerDay: (perDay / 24) * closedHours };
}

/**
 * 當日損益明細。
 *
 * 現金損益 ＝ 營收＋租金抽成 − 所有支出（進貨整筆算在買的那天）。
 * 進貨買的是「之後要賣的貨」，不是當天的虧損，所以另外算「營運損益」：
 * 把進貨換成「今天賣掉的那些貨的成本」，其餘支出照舊。
 * 打烊前補了一大批貨時，現金損益會是負的，營運損益才反映今天到底賺不賺。
 */
export interface DayLedgerInput {
  revenue: number;
  rentIncome: number;
  purchases: number;
  fixed: number;
  repairs: number;
  stockBought?: number;
  stockCost?: number;
  fixedClosed?: number;
}

export interface DayLedger {
  /** 直營營收 */
  revenue: number;
  /** 出租的租金與抽成 */
  rentIncome: number;
  /** 賣出商品的成本（估計值：份數 × 單位成本） */
  stockCost: number;
  /** 其他變動與一次性支出：服務耗材、研發、活動、客訴賠償、科技、貿易匯款… */
  otherCosts: number;
  /** 固定成本：水電、薪資、清潔維護… */
  fixed: number;
  /** 其中打烊時段花掉的部分（水電、薪資照常按天攤） */
  fixedClosed: number;
  /** 維修與罰款 */
  repairs: number;
  /** 今天進貨花的錢（現金流出；變成庫存） */
  stockBought: number;
  /** 庫存變化：進貨 − 賣出成本（正＝庫存增加） */
  stockChange: number;
  /** 營運損益：營收 − 賣出成本 − 其他支出 − 固定 − 維修 */
  operating: number;
  /** 現金損益：營收 − 全部支出（含整筆進貨） */
  cash: number;
}

export function dayLedger(d: DayLedgerInput): DayLedger {
  const stockBought = Math.min(d.stockBought ?? 0, d.purchases);
  const stockCost = d.stockCost ?? 0;
  const otherCosts = d.purchases - stockBought;
  const income = d.revenue + d.rentIncome;
  return {
    revenue: d.revenue,
    rentIncome: d.rentIncome,
    stockCost,
    otherCosts,
    fixed: d.fixed,
    fixedClosed: Math.min(d.fixedClosed ?? 0, d.fixed),
    repairs: d.repairs,
    stockBought,
    stockChange: stockBought - stockCost,
    operating: income - stockCost - otherCosts - d.fixed - d.repairs,
    cash: income - d.purchases - d.fixed - d.repairs,
  };
}
