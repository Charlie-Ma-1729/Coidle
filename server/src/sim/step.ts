import {
  PRICE_REJECT_RATE,
  PRICE_TOLERANCE,
  WALLET_SD,
  TRAFFIC_COMPENSATION,
  affordability,
  CATEGORY_BY_ID,
  CLEANING_COST_PER_DAY,
  CONSUMPTION_STANDARD,
  techFx,
  isHourOpen,
  techTrafficMult,
  cleaningCrew,
  extraCleaningCostPerTick,
  weatherNow,
  weatherZoneFactor,
  emptyWeatherTicks,
  wetDirt,
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
  SHOP_QUALITY,
  SUPPLY_FAMILIES,
  facilityScale,
  familyOf,
  menuAppeal,
  rivalMult,
  consumableCostMult,
  supplierQualityFactor,
  GAP_PREMIUM,
  RUSH_LEAD_MULT,
  RUSH_PREMIUM,
  restockPlan,
  storageCap,
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
import { mallBookValue, parkingTrafficMult, shopDemand, slotSpan, spanBasket, spanDraw } from "@coidle/shared";
import { facilityDaily, runCinema, runParking, runVenues, stepFacilities } from "./facilities";
import { expireModifiers, maybeSpawnEvent, resolveDeadlines } from "./events";
import { generateDailyReviews, noteGrievance, resolveInboxDeadlines } from "./guests";
import { inspectionAtRisk, maybeSpawnInspection, runDueInspections } from "./inspections";
import { effectivePrice, endPromos, noteSale, promoFatigueDaily, promoSatBonus, promoTraffic, startDuePromos } from "./promos";
import { regularsDaily, runRegulars } from "./regulars";
import { rivalsDaily, rivalsTick } from "./rivals";
import { inventoryDaily } from "./inventory";
import { legalDaily, resolveLegalDeadlines } from "./legal";
import { earnPoints, membersDaily } from "./members";
import { financeDaily, noteClosure } from "./finance";
import { patrolDaily } from "./patrol";
import { deliveryTerms, pickAlternative, quoteOrder, quoteWith, recordOrder, suppliersTick, warnSupplyTrouble, type Quote } from "./suppliers";
import { buildReport } from "./report";
import { applyTenantToShop, leasingDaily } from "./leasing";
import { metaDaily } from "./meta";
import { dailyOverhead, dailyWages, taxDaily } from "./tax";
import { techAutoInspection, techDaily, techTick } from "./tech";
import { syncWorkshop, workshopDaily, workshopTick } from "./workshop";
import { rngForTick, type Rng } from "./rng";
import { categoryNoise, effectStrength, personaNoise } from "./dayNoise";
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

/** 這家店的標價（相對參考價的倍率）客人肯買的機率；常數與理由見 shared 的 PRICE_TOLERANCE */
export { PRICE_TOLERANCE, PRICE_REJECT_RATE };
export function priceAcceptance(sensitivity: number, ratio: number): number {
  return ratio <= PRICE_TOLERANCE ? 1 : Math.exp(-sensitivity * PRICE_REJECT_RATE * (ratio - PRICE_TOLERANCE));
}

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
  stepFacilities(s);
  receiveDeliveries(s);
  expireModifiers(s);
  endPromos(s);
  startDuePromos(s);
  suppliersTick(s);
  rivalsTick(s, rng);
  resolveDeadlines(s, rng);
  resolveInboxDeadlines(s);
  resolveLegalDeadlines(s); // 法律糾紛逾期沒處理：依處理偏好自動應對
  workshopTick(s, rng);
  techTick(s);
  runDueInspections(s);
  const spawned = maybeSpawnEvent(s, time, rng);
  let notice = maybeSpawnInspection(s, rng);
  if (notice && techAutoInspection(s, notice.uid)) notice = null; // 已經自動處理，不需要暫停等人
  if (t % 6 === 0) autoRestock(s);
  if (t % TICKS_PER_HOUR === 0) syncWorkshop(s);

  noteWeather(s);
  for (const shop of s.shops) shop.served = 0;
  const open = isOpen(s, time);
  const units = open ? runCustomers(s, time, rng) : 0;
  runCinema(s, time, open);
  runVenues(s, time, open);
  runParking(s, time, open);
  upkeep(s, units, rng, open);

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
  return isHourOpen(s.hours.open, s.hours.close, time.hour);
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
        if (b.name && !b.tenant) shop.name = b.name;
        if (slotSpan(slot) > 1) {
          shop.span = slotSpan(slot) as 2 | 4; // 大店：容量、人事與評價隨格數放大
          // 補貨規則與起始庫存也隨格數放大（否則大店賣得快、貨補不上，一直缺貨）
          const k = shop.span;
          shop.stock *= k;
          shop.restock.min *= k;
          shop.restock.target *= k;
          shop.restock.dailyBudget *= k;
        }
        slot.shopId = shop.id;
        if (b.tenant) applyTenantToShop(shop, b.tenant);
        s.shops.push(shop);
        addLog(s, "build", b.tenant ? `新租戶開張：「${shop.name}」（${cat.name}）進駐了！` : `新店開張：「${shop.name}」（${cat.name}）！`);
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

export interface OrderOpts {
  /** 急件：貴三成、交期縮短 */
  rush?: boolean;
}

/** 向某位供應商實際下一批單；回傳實際進到的份數（0＝沒下成） */
function buyFrom(s: MallState, shop: Shop, quote: Quote, qty: number, rush: boolean): number {
  const d = deliveryTerms(s, shop, quote.pick, qty);
  if (d.qty <= 0) return 0;
  const unit = rush ? Math.ceil(quote.unit * RUSH_PREMIUM) : quote.unit;
  const cost = unit * d.qty;
  s.funds -= cost;
  shop.spentToday += cost;
  s.today.purchases += cost;
  s.today.stockBought = (s.today.stockBought ?? 0) + cost;
  const lead = rush ? Math.max(6, Math.round(d.lead * RUSH_LEAD_MULT)) : d.lead;
  shop.incoming.push({ arriveTick: s.tick + lead, qty: d.qty });
  recordOrder(s, quote.pick);
  s.today.inTax += taxPortion(cost, purchaseRate(familyOf(shop.category))) * supplierCreditRate(quote.pick.def, timeInfo(s.tick).date);
  return d.qty;
}

/**
 * 向供應商下單。實際進貨量與送達時間取決於供應商的狀況（缺貨、延遲、全服衝擊時的優先序），
 * 價格取決於供應商、長約、關係與全域行情。進貨（含在途）不能超過倉庫容量。
 * 主力湊不齊貨時，自動備援開著就向備用供應商補缺口（貴一成半）。買不到就回傳 false。
 */
export function placeOrder(s: MallState, shop: Shop, qty: number, opts: OrderOpts = {}): boolean {
  const cat = CATEGORY_BY_ID[shop.category];
  if (!cat || !categoryHasStock(cat) || qty <= 0) return false;
  const fam = familyOf(shop.category);
  const have = shop.stock + shop.incoming.reduce((a, b) => a + b.qty, 0);
  const room = storageCap(shop) - have;
  if (room <= 0) {
    if ((s.cooldowns[`full:${shop.id}`] ?? 0) <= s.tick) {
      s.cooldowns[`full:${shop.id}`] = s.tick + TICKS_PER_DAY;
      addLog(s, "warn", `📦 「${shop.name}」的倉庫已滿（容量 ${storageCap(shop)} 份），沒辦法再進貨。升級店面可以擴大倉庫。`);
    }
    return false;
  }
  const want = Math.min(qty, room);
  const rush = !!opts.rush;
  const gm = supplyMult(s, s.tick);
  const quote = quoteOrder(s, shop, gm);
  if (!quote) {
    if (fam) warnSupplyTrouble(s, fam, "none", `📦 ${SUPPLY_FAMILIES[fam].name}的主力供應商現在不能出貨，又沒有可用的備援，「${shop.name}」進不到貨！`);
    return false;
  }
  const got = buyFrom(s, shop, quote, want, rush);
  if (got <= 0) return false;
  let total = got;
  if (got < want) {
    let gap = 0;
    let altName = "";
    if (s.supply.autoFallback && fam) {
      const alt = pickAlternative(s, fam, quote.pick.def.id);
      const q2 = alt ? quoteWith(s, shop, alt, gm, GAP_PREMIUM) : null;
      if (alt && q2) {
        const affordable = Math.floor(s.funds / (rush ? Math.ceil(q2.unit * RUSH_PREMIUM) : q2.unit));
        gap = buyFrom(s, shop, q2, Math.min(want - got, affordable), rush);
        altName = alt.def.name;
      }
    }
    total += gap;
    shop.day.short = (shop.day.short ?? 0) + Math.max(0, want - total);
    if (fam) {
      if (gap > 0) warnSupplyTrouble(s, fam, "short", `📦 「${quote.pick.def.name}」只湊得出 ${got}／${want} 份，缺的 ${gap} 份向「${altName}」補了現貨（貴一成半）。`);
      else warnSupplyTrouble(s, fam, "short", `📦 「${quote.pick.def.name}」出貨吃緊，「${shop.name}」只拿到 ${got}／${want} 份。`);
    }
  } else if (quote.pick.spot && fam) {
    warnSupplyTrouble(s, fam, "spot", `📦 主力供應商出不了貨，改向「${quote.pick.def.name}」買現貨（貴一成）。`);
  }
  return true;
}

/** 資金為負（或剛好 0）時，供應商願意賒帳的額度：這麼多天的固定成本。讓店不至於賣光貨→營收歸零→越陷越深 */
const TRADE_CREDIT_DAYS = 2;

function autoRestock(s: MallState): void {
  // 資金為負時改用「賒帳額度」：額度用完（欠款超過 2 天固定成本）才停。守住最低補貨，避免死亡螺旋
  const fixedDay = dailyFixedCost(s);
  const availNow = () => (s.funds > 0 ? s.funds : Math.max(0, TRADE_CREDIT_DAYS * fixedDay + s.funds));
  if (availNow() <= 0) return;
  const globalMult = supplyMult(s, s.tick);
  for (const shop of s.shops) {
    const cat = CATEGORY_BY_ID[shop.category];
    if (!cat || !categoryHasStock(cat) || shop.mode === "lease" || !shop.restock.enabled) continue;
    const have = shop.stock + shop.incoming.reduce((a, b) => a + b.qty, 0);
    const plan = restockPlan(s, shop); // 固定規則，或智慧補貨算出來的下限與目標
    if (have >= plan.min) continue;
    const quote = quoteOrder(s, shop, globalMult);
    if (!quote) {
      const fam = familyOf(shop.category);
      if (fam) warnSupplyTrouble(s, fam, "none", `📦 ${SUPPLY_FAMILIES[fam].name}的主力供應商現在不能出貨，又沒有可用的備援，「${shop.name}」進不到貨！`);
      continue;
    }
    const uc = quote.unit;
    let qty = Math.ceil((plan.target - have) / SUPPLY_LOT) * SUPPLY_LOT;
    const byBudget = Math.floor((shop.restock.dailyBudget - shop.spentToday) / uc / SUPPLY_LOT) * SUPPLY_LOT;
    const byFunds = Math.floor(availNow() / uc / SUPPLY_LOT) * SUPPLY_LOT;
    const byRoom = Math.floor((storageCap(shop) - have) / SUPPLY_LOT) * SUPPLY_LOT;
    if (byBudget < SUPPLY_LOT && (s.cooldowns[`budget:${shop.id}`] ?? 0) <= s.tick) {
      s.cooldowns[`budget:${shop.id}`] = s.tick + TICKS_PER_DAY;
      addLog(s, "warn", `📦 「${shop.name}」今天的採購預算用完了，庫存只剩 ${have} 份（下限 ${plan.min}）。要不要調高每日預算？`);
    }
    qty = Math.min(qty, byBudget, byFunds, byRoom);
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
  const fx = techFx(s.tech.done);
  const divMult = clamp(0.6 + 0.08 * diversity + fx.diversityBonus, 0.6, 2.2);
  let units = 0;

  for (const p of PERSONAS) {
    const share = (time.offDay ? p.weekendHourShare : p.hourShare)[time.hour] ?? 0;
    const daily = p.dailyBase * (time.offDay ? p.weekendMult : 1);
    const lambda =
      TRAFFIC_COMPENSATION *
      ((daily * share) / TICKS_PER_HOUR) * indexFactor(s, p) * divMult * trafficMult(s, p.id, s.tick) * personaNoise(s, p.id, s.tick) * promoTraffic(s, p.id) * rivalMult(s, p.id) * techTrafficMult(s.tech.done, p.id) * parkingTrafficMult(s, p.id);
    const n = rng.poisson(lambda);
    for (let i = 0; i < n; i++) units += serveGroup(s, rng, p, open);
  }
  units += runRegulars(s, rng, time, open, recordSale);
  return units;
}

/** 店面所在的樓層（區域）：同一個 tick 內只建一次對照表 */
const zoneCache = new WeakMap<MallState, { tick: number; n: number; map: Map<number, string> }>();
function zoneOfSlot(s: MallState, slot: number): string | undefined {
  let c = zoneCache.get(s);
  if (!c || c.tick !== s.tick || c.n !== s.slots.length) {
    c = { tick: s.tick, n: s.slots.length, map: new Map(s.slots.map((x) => [x.id, x.zone])) };
    zoneCache.set(s, c);
  }
  return c.map.get(slot);
}

function pickShop(s: MallState, rng: Rng, p: PersonaDef, shops: Shop[], withOutside: boolean, wallet = 1): Shop | null {
  const weather = weatherNow(s);
  const wealth = (p.wealth ?? 1) * wallet;
  const weights = shops.map((shop) => {
    const cat = CATEGORY_BY_ID[shop.category];
    if (!cat) return 0;
    // 天氣／節慶／事件的影響每天強弱不同（指數抖動），再加上每日業態雜訊；經濟能力決定「付不付得起」
    const situation = Math.pow(demandMult(s, cat.id, s.tick), effectStrength(s, cat.id, s.tick)) * categoryNoise(s, cat.id, s.tick);
    const d = (shop.span ? shopDemand(cat, shop.span, p.id) : cat.demand[p.id] ?? 0) * situation * affordability(wealth, 1, cat) * weatherZoneFactor(weather, zoneOfSlot(s, shop.slot) ?? "");
    if (d <= 0) return 0;
    const priceF = clamp(Math.exp(p.sensitivity * (1 - effectivePrice(s, shop) / cat.refPrice)), 0.15, 1.6);
    const qualityF = 0.6 + 0.8 * shopQuality(shop) * supplierQualityFactor(s, shop.category);
    const queueF = 1 - 0.5 * Math.min(1, shop.served / shopCapacity(shop, s));
    const fameF = shop.tenant ? 1 + 0.004 * shop.tenant.fame : 1;
    return d * priceF * qualityF * queueF * (1 + MENU_APPEAL_WEIGHT * menuAppeal(shop, p.id)) * fameF * (shop.span ? spanDraw(shop.span, shop.category) : 1);
  });
  if (withOutside) weights.push(OUTSIDE_WEIGHT);
  const idx = rng.weighted(weights);
  if (idx < 0 || idx >= shops.length) return null;
  return shops[idx] ?? null;
}

/** 回傳這組客人買走的份數 */
function serveGroup(s: MallState, rng: Rng, p: PersonaDef, open: Shop[]): number {
  const size = rng.int(p.party[0], p.party[1]);
  const wallet = Math.exp(WALLET_SD * rng.gauss() - (WALLET_SD * WALLET_SD) / 2); // 這組客人今天手頭鬆緊
  let shop = pickShop(s, rng, p, open, true, wallet);
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
    const alt = rng.chance(0.5) ? pickShop(s, rng, p, open.filter((x) => x !== shop && (x.mode === "lease" || !categoryHasStock(CATEGORY_BY_ID[x.category]!) || x.stock > 0)), false, wallet) : null;
    if (!alt) return 0;
    shop = alt;
    cat = CATEGORY_BY_ID[shop.category];
    if (!cat) return 0;
  }

  const hasStock = categoryHasStock(cat) && shop.mode === "direct";
  if (shop.mode === "direct") {
    const accept = priceAcceptance(p.sensitivity, effectivePrice(s, shop) / cat.refPrice);
    if (accept < 1 && !rng.chance(accept)) {
      shop.day.priceWalks = (shop.day.priceWalks ?? 0) + 1;
      s.today.priceWalks = (s.today.priceWalks ?? 0) + 1;
      s.today.walkouts++;
      recordSample(s, p, 0.35);
      return 0;
    }
  }
  const cap = shopCapacity(shop, s);
  if (shop.served >= cap) {
    shop.day.lost++;
    s.today.walkouts++;
    recordSample(s, p, 0.35);
    noteGrievance(s, rng, shop, p.id, "wait");
    return 0;
  }
  // 消費習慣：食物與零售每組實際買的份數不一定等於人數（省的合買、愛買的多帶）；隨機進位讓平均不失真
  let want = size;
  if (p.spend && categoryHasStock(cat)) {
    const x = Math.max(0.4, Math.min(2.2, p.spend.mean + p.spend.sd * rng.gauss())) * size * (shop.span ? spanBasket(shop.span) : 1);
    want = Math.max(1, Math.floor(x) + (rng.next() < x - Math.floor(x) ? 1 : 0));
  }
  const qty = Math.min(want, cap - shop.served, hasStock ? shop.stock : want);
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
    earnPoints(s, revenue); // 會員消費累積點數（負債，兌換時才算成本）
    // 服務型業態沒有庫存：耗材成本受供應商價格與供貨衝擊影響（餐飲／零售的成本在進貨時已反映）
    const consumable = categoryHasStock(cat) ? 1 : consumableCostMult(s, shop.category);
    shop.day.cost = (shop.day.cost ?? 0) + Math.round(qty * cat.refPrice * cat.costRatio * consumable); // 各店損益用
    if (hasStock) s.today.stockCost = (s.today.stockCost ?? 0) + Math.round(qty * cat.refPrice * cat.costRatio);
    if (!categoryHasStock(cat)) {
      // 服務型業態沒有庫存，變動成本即時支出
      const varCost = Math.round(qty * cat.refPrice * cat.costRatio * consumable);
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
  const base = 0.16 + 0.62 * q + weight * (value - 0.5) + promoSatBonus(s) + 0.06 * menuAppeal(shop, p.id) + techFx(s.tech.done).satBonus;
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

/** 記下今天各種天氣各出現幾個 tick（日報用） */
function noteWeather(s: MallState): void {
  const w = weatherNow(s);
  const wx = (s.today.wx ??= emptyWeatherTicks());
  wx[w.kind]++;
  s.today.temp = w.temp;
}

// ───────── 維運、固定成本、故障 ─────────
function dailyFixedCost(s: MallState): number {
  let c = dailyOverhead(s) + dailyWages(s);
  return c;
}

function upkeep(s: MallState, units: number, rng: Rng, open: boolean): void {
  const fixed = dailyFixedCost(s) / TICKS_PER_DAY;
  s.funds -= fixed;
  s.today.fixed += fixed;
  if (!open) s.today.fixedClosed = (s.today.fixedClosed ?? 0) + fixed; // 打烊時段照常支出的固定成本（讓玩家看得到它花在哪）
  s.today.fixedCredit += taxPortion(dailyOverhead(s) / TICKS_PER_DAY, CONSUMPTION_STANDARD); // 水電與清潔維護的進項稅

  const scale = facilityScale(s);
  const fx = techFx(s.tech.done);
  // 雨天館內更髒（泥水、滲漏）；有簽清潔就加派清潔員，打掃更快但要付加班費
  const weather = weatherNow(s);
  const dirt = wetDirt(weather);
  const crew = cleaningCrew(s.cleaningLevel, weather);
  const extra = extraCleaningCostPerTick(s.cleaningLevel, weather);
  if (extra > 0) {
    s.funds -= extra;
    s.today.fixed += extra;
    if (!open) s.today.fixedClosed = (s.today.fixedClosed ?? 0) + extra;
    s.today.fixedCredit += taxPortion(extra, CONSUMPTION_STANDARD);
  }
  s.cleanliness = clamp(
    s.cleanliness + CLEANING_RESTORE_PER_TICK[s.cleaningLevel] * scale * fx.cleaningRestoreMult * crew.restoreMult - units * 0.009 * (1 + dirt.tracked) - dirt.leak * scale,
    0,
    100,
  );
  s.equipment = clamp(s.equipment + MAINTENANCE_RESTORE_PER_TICK[s.maintenanceLevel] * scale * fx.equipmentRestoreMult - units * 0.007, 0, 100);

  const breakdownP = (s.equipment < 10 ? 0.012 : s.equipment < 30 ? 0.004 : 0) * fx.breakdownMult;
  if (breakdownP > 0 && s.shops.length > 0 && rng.chance(breakdownP)) {
    const shop = s.shops[rng.int(0, s.shops.length - 1)];
    if (shop) {
      shop.closedUntilTick = Math.max(shop.closedUntilTick, s.tick + 18);
      noteClosure(s, shop, 18);
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
  techDaily(s); // 科技帶來的口碑、AI 副手自動更新菜單
  syncWorkshop(s);
  membersDaily(s); // 會員：新入會、兌換點數（成本）、點數失效、升級
  financeDaily(s); // 金融：營業中斷險保費與理賠、貸款還款與逾期、重整（利息與理賠要算進今天的日報）
  regularsDaily(s); // 熟客：久沒上門的漸漸疏遠、老主顧帶來口碑、意見與人生大事
  generateDailyReviews(s); // 今天客人的感受 → 幾則線上評價（先於日報，才算得進去）
  s.reports.push(buildReport(s));
  if (s.reports.length > MAX_REPORTS) s.reports.splice(0, s.reports.length - MAX_REPORTS);

  metaDaily(s, time); // 目標驗收、團隊事件、成就與線索（也在各店當日統計重置之前）
  leasingDaily(s); // 招商：新品牌來洽談、租戶滿意度、續約（要在各店當日統計重置之前）
  facilityDaily(s); // 設施：設備損耗、營運商租金與滿意度、新營運商上門
  checkLevelUp(s);
  patrolDaily(s); // 巡店：沒處理的問題造成影響、惡化、冒出新問題
  legalDaily(s); // 保險費、管理不善的商場可能收到請求書（要在各店當日統計重置之前）
  inventoryDaily(s); // 日均銷量、放太久的貨會壞（要在各店當日統計重置之前）
  s.valuationAnchor = mallBookValue(s); // 股權估值的收盤錨點（隔天價格最多從這裡浮動 ±10%）
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
