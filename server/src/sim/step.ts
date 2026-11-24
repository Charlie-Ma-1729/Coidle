import {
  CATEGORY_BY_ID,
  CLEANING_COST_PER_DAY,
  CONSUMPTION_STANDARD,
  ROYALTY_CATEGORIES,
  consumptionRate,
  purchaseRate,
  supplierCreditRate,
  taxPortion,
  CLEANING_RESTORE_PER_TICK,
  FRESHNESS_DECAY_PER_DAY,
  FRESHNESS_FLOOR,
  MENU_APPEAL_WEIGHT,
  INDEX_FLOOR_ABS,
  INDEX_FLOOR_RATIO,
  INDEX_MAX_DAILY_DROP,
  LEVELS,
  MAINTENANCE_COST_PER_DAY,
  MAINTENANCE_RESTORE_PER_TICK,
  MAX_REPORTS,
  PERSONAS,
  PERSONA_BY_ID,
  RESERVE_UPKEEP_PER_DAY,
  SHOP_QUALITY,
  SUPPLY_FAMILIES,
  facilityScale,
  familyOf,
  menuAppeal,
  rivalMult,
  supplierQualityFactor,
  SUPPLY_LEAD_TICKS,
  SUPPLY_LOT,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  UTILITIES_PER_DAY,
  categoryHasStock,
  type CategoryDef,
  type ComplaintCause,
  type IndexId,
  type MallState,
  type PersonaDef,
  type Shop,
} from "@coidle/shared";
import { expireModifiers, maybeSpawnEvent, resolveDeadlines } from "./events";
import { generateDailyReviews, noteGrievance, resolveInboxDeadlines } from "./guests";
import { inspectionAtRisk, maybeSpawnInspection, runDueInspections } from "./inspections";
import { effectivePrice, endPromos, noteSale, promoFatigueDaily, promoSatBonus, promoTraffic, startDuePromos } from "./promos";
import { regularsDaily, runRegulars } from "./regulars";
import { rivalsDaily, rivalsTick } from "./rivals";
import { deliveryTerms, quoteOrder, recordOrder, suppliersTick, warnSupplyTrouble } from "./suppliers";
import { buildReport } from "./report";
import { dailyOverhead, dailyWages, taxDaily } from "./tax";
import { syncWorkshop, workshopDaily, workshopTick } from "./workshop";
import { rngForTick, type Rng } from "./rng";
import {
  addLog,
  demandMult,
  makeShop,
  newDayStats,
  newShopDayStats,
  shopCapacity,
  shopQuality,
  supplyMult,
  trafficMult,
  unitCost,
} from "./state";
import { timeInfo, type TimeInfo } from "./time";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 客人感受到的人氣變化速度（每個樣本） */
const INDEX_ALPHA = 0.0012;
/** 「不買」的基礎權重；越大代表客人越容易嫌貴／嫌選擇少而離開 */
const OUTSIDE_WEIGHT = 0.12;

// ───────── 主迴圈：推進一個 tick（就地修改 s） ─────────
export interface StepContext {
  /** 目前沒有任何成員在場（沒有連線、也沒有最近的操作） */
  nobodyPresent: boolean;
}

/**
 * 推進一個 tick（就地修改 s）。
 * 回傳 true 代表時鐘因「重要事件」被攔下：呼叫端應該停止繼續推進，
 * 等玩家處理（s.clock.holds.events 已加入該事件）。
 */
export function stepTick(s: MallState, ctx: StepContext = { nobodyPresent: false }): boolean {
  const t = s.tick;
  const time = timeInfo(t);
  const rng = rngForTick(s.seed, t);

  if (s.today.day !== time.day) rollover(s, time);

  completeBuilds(s);
  receiveDeliveries(s);
  expireModifiers(s);
  endPromos(s);
  startDuePromos(s);
  suppliersTick(s);
  rivalsTick(s, rng);
  resolveDeadlines(s, rng);
  resolveInboxDeadlines(s);
  workshopTick(s, rng);
  runDueInspections(s);
  const spawned = maybeSpawnEvent(s, time, rng);
  const notice = maybeSpawnInspection(s, rng);
  if (t % 6 === 0) autoRestock(s);
  if (t % TICKS_PER_HOUR === 0) syncWorkshop(s);

  for (const shop of s.shops) shop.served = 0;
  const units = isOpen(s, time) ? runCustomers(s, time, rng) : 0;
  upkeep(s, units, rng);

  s.tick = t + 1;

  // 沒人在場時遇到「放著會吃大虧」的事件或稽查預告：時鐘停在這裡等人處理
  let halt = false;
  if (spawned?.uid && spawned.def.attention === "pause" && ctx.nobodyPresent && s.clock.pauseOnEvents) {
    s.clock.holds.events.push(spawned.uid);
    halt = true;
  }
  if (notice && ctx.nobodyPresent && s.clock.pauseOnEvents && inspectionAtRisk(s, notice.kind)) {
    s.clock.holds.events.push(notice.uid);
    halt = true;
  }
  return halt;
}

export function isOpen(s: MallState, time: TimeInfo): boolean {
  return time.hour >= s.hours.open && time.hour < s.hours.close;
}

// ───────── 建造與進貨 ─────────
function completeBuilds(s: MallState): void {
  if (s.builds.length === 0) return;
  const rest = [];
  for (const b of s.builds) {
    if (b.completeTick > s.tick) {
      rest.push(b);
      continue;
    }
    if (b.kind === "open" && b.category) {
      const cat = CATEGORY_BY_ID[b.category];
      const slot = s.slots[b.slot];
      if (cat && slot) {
        const n = s.shops.filter((x) => x.category === b.category).length + 1;
        const shop = makeShop(s, b.category, n > 1 ? `${cat.name}・${n}號店` : `${cat.name}`, slot.id);
        slot.shopId = shop.id;
        s.shops.push(shop);
        addLog(s, "build", `新店開張：「${shop.name}」（${cat.name}）！`);
      }
    } else if (b.kind === "upgrade" && b.shopId) {
      const shop = s.shops.find((x) => x.id === b.shopId);
      if (shop) {
        shop.level += 1;
        addLog(s, "build", `「${shop.name}」翻新完成，升到 Lv.${shop.level}。`);
      }
    }
  }
  s.builds = rest;
}

function receiveDeliveries(s: MallState): void {
  for (const shop of s.shops) {
    if (shop.incoming.length === 0) continue;
    const rest = [];
    for (const d of shop.incoming) {
      if (d.arriveTick <= s.tick) shop.stock += d.qty;
      else rest.push(d);
    }
    shop.incoming = rest;
  }
}

/**
 * 向供應商下單。實際進貨量與送達時間取決於供應商的狀況（缺貨、延遲），
 * 價格取決於供應商、長約、關係與全域行情。買不到就回傳 false。
 */
export function placeOrder(s: MallState, shop: Shop, qty: number): boolean {
  const cat = CATEGORY_BY_ID[shop.category];
  if (!cat || !categoryHasStock(cat) || qty <= 0) return false;
  const quote = quoteOrder(s, shop, supplyMult(s, s.tick));
  if (!quote) {
    const fam = familyOf(shop.category);
    if (fam) warnSupplyTrouble(s, fam, "none", `📦 ${SUPPLY_FAMILIES[fam].name}的主力供應商現在不能出貨，又沒有可用的備援，「${shop.name}」進不到貨！`);
    return false;
  }
  const d = deliveryTerms(s, shop, quote.pick, qty);
  if (d.qty <= 0) return false;
  const cost = quote.unit * d.qty;
  s.funds -= cost;
  shop.spentToday += cost;
  s.today.purchases += cost;
  shop.incoming.push({ arriveTick: s.tick + d.lead, qty: d.qty });
  recordOrder(s, quote.pick);
  const fam = familyOf(shop.category);
  s.today.inTax += taxPortion(cost, purchaseRate(fam)) * supplierCreditRate(quote.pick.def, timeInfo(s.tick).date);
  if (d.qty < qty) {
    const fam = familyOf(shop.category);
    if (fam) warnSupplyTrouble(s, fam, "short", `📦 「${quote.pick.def.name}」出貨吃緊，「${shop.name}」只拿到 ${d.qty}／${qty} 份。`);
  } else if (quote.pick.spot) {
    const fam = familyOf(shop.category);
    if (fam) warnSupplyTrouble(s, fam, "spot", `📦 主力供應商出不了貨，改向「${quote.pick.def.name}」買現貨（貴一成）。`);
  }
  return true;
}

function autoRestock(s: MallState): void {
  if (s.funds <= 0) return;
  const globalMult = supplyMult(s, s.tick);
  for (const shop of s.shops) {
    const cat = CATEGORY_BY_ID[shop.category];
    if (!cat || !categoryHasStock(cat) || shop.mode === "lease" || !shop.restock.enabled) continue;
    const have = shop.stock + shop.incoming.reduce((a, b) => a + b.qty, 0);
    if (have >= shop.restock.min) continue;
    const quote = quoteOrder(s, shop, globalMult);
    if (!quote) {
      const fam = familyOf(shop.category);
      if (fam) warnSupplyTrouble(s, fam, "none", `📦 ${SUPPLY_FAMILIES[fam].name}的主力供應商現在不能出貨，又沒有可用的備援，「${shop.name}」進不到貨！`);
      continue;
    }
    const uc = quote.unit;
    let qty = Math.ceil((shop.restock.target - have) / SUPPLY_LOT) * SUPPLY_LOT;
    const byBudget = Math.floor((shop.restock.dailyBudget - shop.spentToday) / uc / SUPPLY_LOT) * SUPPLY_LOT;
    const byFunds = Math.floor(s.funds / uc / SUPPLY_LOT) * SUPPLY_LOT;
    qty = Math.min(qty, byBudget, byFunds);
    if (qty >= SUPPLY_LOT) placeOrder(s, shop, qty);
  }
}

// ───────── 客流與購買 ─────────
function indexFactor(s: MallState, p: PersonaDef): number {
  const x = p.index === "localRep" ? s.localRep : p.index === "touristHeat" ? s.touristHeat : (s.localRep + s.touristHeat) / 2;
  return 0.4 + 1.2 * (x / 100);
}

function runCustomers(s: MallState, time: TimeInfo, rng: Rng): number {
  const open = s.shops.filter((x) => x.closedUntilTick <= s.tick);
  if (open.length === 0) return 0;
  const diversity = new Set(s.shops.map((x) => x.category)).size;
  const divMult = clamp(0.6 + 0.08 * diversity, 0.6, 2);
  let units = 0;

  for (const p of PERSONAS) {
    const share = (time.weekend ? p.weekendHourShare : p.hourShare)[time.hour] ?? 0;
    const daily = p.dailyBase * (time.weekend ? p.weekendMult : 1);
    const lambda =
      ((daily * share) / TICKS_PER_HOUR) * indexFactor(s, p) * divMult * trafficMult(s, p.id, s.tick) * promoTraffic(s, p.id) * rivalMult(s, p.id);
    const n = rng.poisson(lambda);
    for (let i = 0; i < n; i++) units += serveGroup(s, rng, p, open);
  }
  units += runRegulars(s, rng, time, open, recordSale);
  return units;
}

function pickShop(s: MallState, rng: Rng, p: PersonaDef, shops: Shop[], withOutside: boolean): Shop | null {
  const weights = shops.map((shop) => {
    const cat = CATEGORY_BY_ID[shop.category];
    if (!cat) return 0;
    const d = (cat.demand[p.id] ?? 0) * demandMult(s, cat.id, s.tick);
    if (d <= 0) return 0;
    const priceF = clamp(Math.exp(p.sensitivity * (1 - effectivePrice(s, shop) / cat.refPrice)), 0.15, 1.6);
    const qualityF = 0.6 + 0.8 * shopQuality(shop) * supplierQualityFactor(s, shop.category);
    const queueF = 1 - 0.5 * Math.min(1, shop.served / shopCapacity(shop));
    return d * priceF * qualityF * queueF * (1 + MENU_APPEAL_WEIGHT * menuAppeal(shop, p.id));
  });
  if (withOutside) weights.push(OUTSIDE_WEIGHT);
  const idx = rng.weighted(weights);
  if (idx < 0 || idx >= shops.length) return null;
  return shops[idx] ?? null;
}

/** 回傳這組客人買走的份數 */
function serveGroup(s: MallState, rng: Rng, p: PersonaDef, open: Shop[]): number {
  const size = rng.int(p.party[0], p.party[1]);
  let shop = pickShop(s, rng, p, open, true);
  if (!shop) return 0;
  let cat = CATEGORY_BY_ID[shop.category];
  if (!cat) return 0;
  const stocked = categoryHasStock(cat) && shop.mode === "direct";

  if (stocked && shop.stock < 1) {
    shop.day.stockouts++;
    s.today.walkouts++;
    recordSample(s, p, 0.2);
    noteGrievance(s, rng, shop, p.id, "stockout");
    // 一半的客人會改去別家
    const alt = rng.chance(0.5) ? pickShop(s, rng, p, open.filter((x) => x !== shop && (x.mode === "lease" || !categoryHasStock(CATEGORY_BY_ID[x.category]!) || x.stock > 0)), false) : null;
    if (!alt) return 0;
    shop = alt;
    cat = CATEGORY_BY_ID[shop.category];
    if (!cat) return 0;
  }

  const hasStock = categoryHasStock(cat) && shop.mode === "direct";
  const cap = shopCapacity(shop);
  if (shop.served >= cap) {
    shop.day.lost++;
    s.today.walkouts++;
    recordSample(s, p, 0.35);
    noteGrievance(s, rng, shop, p.id, "wait");
    return 0;
  }
  const qty = Math.min(size, cap - shop.served, hasStock ? shop.stock : size);
  if (qty < 1) return 0;
  return recordSale(s, rng, p, shop, cat, qty);
}

/** 把一筆成交記進帳：營收、庫存、統計、滿意度，以及（可能的）客訴累積。回傳份數。 */
export function recordSale(s: MallState, rng: Rng, p: PersonaDef, shop: Shop, cat: CategoryDef, qty: number): number {
  const hasStock = categoryHasStock(cat) && shop.mode === "direct";
  const revenue = qty * effectivePrice(s, shop); // 活動折扣：客人實際付的錢
  noteSale(s, revenue);
  shop.served += qty;
  shop.day.units += qty;
  shop.day.groups++;
  shop.day.revenue += revenue;
  s.today.groups++;
  s.today.units += qty;
  s.today.groupsByPersona[p.id]++;
  if (hasStock) shop.stock -= qty;

  if (shop.mode === "direct") {
    s.today.outTax += taxPortion(revenue, consumptionRate(shop.category));
    if (ROYALTY_CATEGORIES.includes(shop.category)) s.tax.monthRoyaltyBase += revenue;
    s.funds += revenue;
    s.today.revenue += revenue;
    s.totalRevenue += revenue;
    if (!categoryHasStock(cat)) {
      // 服務型業態沒有庫存，變動成本即時支出
      const varCost = Math.round(qty * cat.refPrice * cat.costRatio);
      s.funds -= varCost;
      s.today.purchases += varCost;
      s.today.inTax += taxPortion(varCost, CONSUMPTION_STANDARD);
    }
  } else {
    const commission = revenue * shop.commission;
    s.today.outTax += taxPortion(commission, CONSUMPTION_STANDARD);
    s.funds += commission;
    s.today.rentIncome += commission;
    s.totalRevenue += commission;
  }

  const sat = satisfaction(s, p, shop, cat.refPrice);
  recordSample(s, p, sat);
  if (sat < 0.45) {
    // 買到了但不開心：把原因記下來，累積夠了就變成客訴
    const cause: ComplaintCause | null =
      s.cleanliness < 45 ? "dirty" : s.equipment < 45 ? "facility" : shop.price > cat.refPrice * 1.25 ? "price" : shop.freshness < 40 ? "quality" : null;
    if (cause) noteGrievance(s, rng, shop, p.id, cause);
  }
  return qty;
}

function satisfaction(s: MallState, p: PersonaDef, shop: Shop, refPrice: number): number {
  const q = shopQuality(shop) * supplierQualityFactor(s, shop.category);
  const value = clamp(refPrice / effectivePrice(s, shop), 0.5, 1.5);
  const weight = 0.1 + 0.08 * p.sensitivity;
  const base = 0.16 + 0.62 * q + weight * (value - 0.5) + promoSatBonus(s) + 0.06 * menuAppeal(shop, p.id);
  return clamp(base * (0.75 + 0.25 * (s.cleanliness / 100)) * (0.75 + 0.25 * (s.equipment / 100)), 0, 1);
}

function recordSample(s: MallState, p: PersonaDef, sat: number): void {
  s.today.satSum[p.id] += sat;
  s.today.satN[p.id]++;
  const target = sat * 100;
  if (p.index === "both") {
    nudgeIndex(s, "localRep", target, INDEX_ALPHA / 2);
    nudgeIndex(s, "touristHeat", target, INDEX_ALPHA / 2);
  } else {
    nudgeIndex(s, p.index, target, INDEX_ALPHA);
  }
}

function nudgeIndex(s: MallState, which: IndexId, target: number, alpha: number): void {
  const cur = s[which];
  let next = cur + (target - cur) * alpha;
  if (next < cur) {
    const peak = which === "localRep" ? s.peakLocal : s.peakTourist;
    const floor = Math.max(INDEX_FLOOR_ABS, INDEX_FLOOR_RATIO * peak, s.today.startIndex[which] - INDEX_MAX_DAILY_DROP);
    next = Math.max(next, Math.min(cur, floor));
  }
  next = clamp(next, 0, 100);
  s[which] = next;
  if (which === "localRep") s.peakLocal = Math.max(s.peakLocal, next);
  else s.peakTourist = Math.max(s.peakTourist, next);
}

// ───────── 維運、固定成本、故障 ─────────
function dailyFixedCost(s: MallState): number {
  let c = dailyOverhead(s) + dailyWages(s);
  c += s.regulars.filter((r) => r.reserved).length * RESERVE_UPKEEP_PER_DAY; // 專屬座位的維持費
  return c;
}

function upkeep(s: MallState, units: number, rng: Rng): void {
  const fixed = dailyFixedCost(s) / TICKS_PER_DAY;
  s.funds -= fixed;
  s.today.fixed += fixed;
  s.today.fixedCredit += taxPortion(dailyOverhead(s) / TICKS_PER_DAY, CONSUMPTION_STANDARD); // 水電與清潔維護的進項稅

  const scale = facilityScale(s);
  s.cleanliness = clamp(s.cleanliness + CLEANING_RESTORE_PER_TICK[s.cleaningLevel] * scale - units * 0.009, 0, 100);
  s.equipment = clamp(s.equipment + MAINTENANCE_RESTORE_PER_TICK[s.maintenanceLevel] * scale - units * 0.007, 0, 100);

  const breakdownP = s.equipment < 10 ? 0.012 : s.equipment < 30 ? 0.004 : 0;
  if (breakdownP > 0 && s.shops.length > 0 && rng.chance(breakdownP)) {
    const shop = s.shops[rng.int(0, s.shops.length - 1)];
    if (shop) {
      shop.closedUntilTick = Math.max(shop.closedUntilTick, s.tick + 18);
      s.funds -= 30_000;
      s.today.repairs += 30_000;
      addLog(s, "warn", `設備老舊出狀況，「${shop.name}」暫停營業搶修（維修費 30,000）。`);
    }
  }
}

// ───────── 日結算 ─────────
function rollover(s: MallState, time: TimeInfo): void {
  // 出租店的租金每日結算
  for (const shop of s.shops) {
    if (shop.mode === "lease") {
      s.funds += shop.rent;
      s.today.rentIncome += shop.rent;
      s.today.outTax += taxPortion(shop.rent, CONSUMPTION_STANDARD);
      s.totalRevenue += shop.rent;
    }
  }
  // 整天沒人上門：口碑慢慢被淡忘
  if (s.today.groups === 0 && s.shops.length > 0) {
    for (const which of ["localRep", "touristHeat"] as const) {
      const peak = which === "localRep" ? s.peakLocal : s.peakTourist;
      const floor = Math.max(INDEX_FLOOR_ABS, INDEX_FLOOR_RATIO * peak, s.today.startIndex[which] - INDEX_MAX_DAILY_DROP);
      s[which] = Math.max(floor, s[which] - 1.5);
    }
  }

  rivalsDaily(s); // 對手的實力慢慢向相稱的水準靠攏
  promoFatigueDaily(s); // 促銷疲勞慢慢消退
  workshopDaily(s); // 菜單新鮮度退流行、招牌帶來口碑
  syncWorkshop(s);
  regularsDaily(s); // 常客：久沒上門的漸漸疏遠、熟客粉絲帶來口碑
  generateDailyReviews(s); // 今天客人的感受 → 幾則線上評價（先於日報，才算得進去）
  s.reports.push(buildReport(s));
  if (s.reports.length > MAX_REPORTS) s.reports.splice(0, s.reports.length - MAX_REPORTS);

  checkLevelUp(s);
  for (const shop of s.shops) {
    shop.day = newShopDayStats();
    shop.spentToday = 0;
    // 新鮮感慢慢退流行：需要玩家換菜單／做活動才補得回來
    shop.freshness = Math.max(FRESHNESS_FLOOR, shop.freshness - FRESHNESS_DECAY_PER_DAY);
  }
  const closedDay = s.today;
  s.today = newDayStats(time.day, { localRep: s.localRep, touristHeat: s.touristHeat });
  taxDaily(s, time, closedDay); // 稅務：累積損益、依日曆開帳單、到期自動扣款
}

function checkLevelUp(s: MallState): void {
  const avg = (s.localRep + s.touristHeat) / 2;
  for (;;) {
    const next = LEVELS.find((l) => l.level === s.level + 1);
    if (!next || s.totalRevenue < next.minRevenue || avg < next.minIndexAvg) return;
    s.level = next.level;
    addLog(s, "info", `商場升到 Lv.${s.level}！新的區域與業態開放了。`);
  }
}
