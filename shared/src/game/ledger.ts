import { CATEGORY_BY_ID, CLEANING_COST_PER_DAY, MAINTENANCE_COST_PER_DAY, UTILITIES_PER_DAY } from "./data";
import { facilityScale } from "./helpers";
import { isHourOpen } from "./hours";
import { RESERVE_UPKEEP_PER_DAY } from "./regulars";
import { laborCostFactor } from "./tax";
import { techFx } from "./tech";
import type { MallState, Shop } from "./types";

type CostInput = Pick<MallState, "shops" | "hours" | "tech" | "cleaningLevel" | "maintenanceLevel">;

/** 一間直營店一天的薪資（深夜與長時間營業有加成；出租店沒有） */
export function shopWagePerDay(s: Pick<MallState, "hours" | "tech">, shop: Pick<Shop, "mode" | "category" | "level">): number {
  if (shop.mode === "lease") return 0;
  const cat = CATEGORY_BY_ID[shop.category];
  return cat ? cat.wage * shop.level * laborCostFactor(s.hours.open, s.hours.close) * techFx(s.tech.done).wageMult : 0;
}

/** 一天的薪資（深夜與長時間營業有加成） */
export function dailyWages(s: Pick<MallState, "shops" | "hours" | "tech">): number {
  let c = 0;
  for (const shop of s.shops) c += shopWagePerDay(s, shop);
  return c;
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

// ───────── 各店損益：誰賺、誰賠、為什麼 ─────────
export interface ShopReason {
  tone: "bad" | "warn" | "info";
  text: string;
}

export interface ShopLedger {
  id: string;
  name: string;
  /** 業態名稱 */
  category: string;
  mode: Shop["mode"];
  /** 直營＝今天的營收；出租＝今天的抽成 */
  revenue: number;
  /** 賣出的貨（或服務耗材）的成本 */
  cost: number;
  /** 這間店今天到現在累計的薪資（整天均攤） */
  wage: number;
  net: number;
  verdict: "profit" | "loss" | "even";
  /** 賠錢（或賺得少）的原因與建議；賺錢的店只放毛利說明 */
  reasons: ShopReason[];
}

const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

/**
 * 一間店今天到現在的損益。
 * 店面損益 ＝ 營收 − 賣出成本 − 薪資。水電、清潔維護是整個商場共用的，不分攤到各店（見 mallBreakdown）。
 * 薪資是整天均攤的（營業或打烊都在累計），所以開門前或還沒有客人時，店面損益本來就是負的。
 * dayFraction：今天已經過了幾分之幾（0–1）。
 */
export function shopLedger(s: Pick<MallState, "hours" | "tech" | "tick">, shop: Shop, dayFraction: number): ShopLedger {
  const cat = CATEGORY_BY_ID[shop.category];
  const base = { id: shop.id, name: shop.name, category: cat?.name ?? shop.category, mode: shop.mode };
  const verdictOf = (net: number): ShopLedger["verdict"] => (net > 0 ? "profit" : net < 0 ? "loss" : "even");

  if (shop.mode === "lease") {
    const income = shop.day.revenue * shop.commission;
    const reasons: ShopReason[] = [{ tone: "info", text: `出租店：賺租客營收的抽成，另有日租 ${money(shop.rent)} 每天結算時入帳；不用進貨、不用發薪。` }];
    return { ...base, revenue: income, cost: 0, wage: 0, net: income, verdict: verdictOf(income), reasons };
  }

  const revenue = shop.day.revenue;
  const cost = shop.day.cost ?? 0;
  const wage = shopWagePerDay(s, shop) * Math.max(0, Math.min(1, dayFraction));
  const net = revenue - cost - wage;
  const reasons: ShopReason[] = [];

  if (net >= 0) {
    const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
    reasons.push({ tone: "info", text: `今天賣出 ${shop.day.units} 份，扣掉成本剩 ${margin}%，付完薪資還有賺。` });
    return { ...base, revenue, cost, wage, net, verdict: verdictOf(net), reasons };
  }

  const unitCost = cat ? cat.refPrice * cat.costRatio : 0;
  const hour = Math.floor(dayFraction * 24);
  if (shop.closedUntilTick > s.tick) reasons.push({ tone: "bad", text: "設備故障，暫停營業中：沒有營收，但薪資照付。" });
  if (cat && shop.price < unitCost) reasons.push({ tone: "bad", text: `標價 ${money(shop.price)} 低於每份成本約 ${money(unitCost)}，賣越多賠越多，快調高。` });
  if (shop.day.stockouts > 0) reasons.push({ tone: "bad", text: `缺貨 ${shop.day.stockouts} 次，客人跑去別家或直接走了（補貨量或預算不夠）。` });
  if ((shop.day.priceWalks ?? 0) >= 3 && cat) reasons.push({ tone: "bad", text: `${shop.day.priceWalks} 組客人嫌太貴走掉（標價是參考價的 ${(shop.price / cat.refPrice).toFixed(2)} 倍，超過約 1.2 倍客人會嫌貴）。` });
  if (shop.day.lost >= 3) reasons.push({ tone: "warn", text: `${shop.day.lost} 組客人排不到位子（店太小或人手不足，可以升級）。` });
  if (shop.freshness < 50) reasons.push({ tone: "warn", text: `新鮮感只剩 ${Math.round(shop.freshness)}，客人覺得老氣，換新菜單或做活動可以補回來。` });
  if (reasons.length === 0) {
    if (revenue === 0 && hour < s.hours.open && !isHourOpen(s.hours.open, s.hours.close, hour)) reasons.push({ tone: "info", text: "還沒開門，但薪資整天均攤，已經先累計了。" });
    else if (revenue > cost) reasons.push({ tone: "warn", text: `每份都有賺，但客人還不夠多，攤不平這間店每天 ${money(shopWagePerDay(s, shop))} 的薪資。${dayFraction < 0.9 ? "今天還沒結束，營收還在累積。" : "可以考慮促銷、換菜單或調整營業時間。"}` });
    else reasons.push({ tone: "info", text: "今天客人還少，營收還沒蓋過薪資。" });
  }
  return { ...base, revenue, cost, wage, net, verdict: "loss", reasons: reasons.slice(0, 4) };
}

export interface MallBreakdown {
  /** 各店損益，賺最多的在前面 */
  shops: ShopLedger[];
  /** 各店損益合計 */
  shopsNet: number;
  /** 共用成本：水電、清潔維護、專屬座位（固定成本扣掉各店薪資） */
  publicCosts: number;
  /** 其他支出：研發、活動、客訴賠償、科技、貿易、維修罰款… 以及租金入帳的時間差（讓總數對得上上方的營運損益） */
  otherCosts: number;
  operating: number;
}

/** 把今天的營運損益拆成「各店損益 − 共用成本 − 其他支出」，加起來剛好等於營運損益 */
export function mallBreakdown(s: Pick<MallState, "hours" | "tech" | "tick" | "shops">, d: DayLedgerInput, dayFraction: number): MallBreakdown {
  const shops = s.shops.map((sh) => shopLedger(s, sh, dayFraction)).sort((a, b) => b.net - a.net);
  const shopsNet = shops.reduce((a, x) => a + x.net, 0);
  const wages = shops.reduce((a, x) => a + x.wage, 0);
  const operating = dayLedger(d).operating;
  const publicCosts = Math.max(0, d.fixed - wages);
  return { shops, shopsNet, publicCosts, otherCosts: shopsNet - publicCosts - operating, operating };
}
