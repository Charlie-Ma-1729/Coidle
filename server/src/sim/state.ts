import {
  CATEGORIES,
  CATEGORY_BY_ID,
  INDEX_START,
  INITIAL_FUNDS,
  INITIAL_SHOPS,
  MAX_LOG,
  PERSONA_IDS,
  SHOP_QUALITY,
  ZONES,
  menuQualityBonus,
  techFx,
  initialRivals,
  initialSupply,
  newClock,
  ZONE_BY_ID,
  type CategoryDef,
  type DayStats,
  type InspectionState,
  type LogEntry,
  type MallState,
  type PersonaId,
  type PromoState,
  type RivalsState,
  type Shop,
  type WorkshopState,
  type ShopDayStats,
  type Slot,
} from "@coidle/shared";
import { initialRegulars } from "./regulars";
import { timeInfo } from "./time";
import { newLeasingState } from "./leasing";
import { initGoals, newMetaState } from "./meta";
import { newTaxState } from "./tax";
import { newTechState } from "./tech";
import { syncWorkshop } from "./workshop";

export function personaRecord(v = 0): Record<PersonaId, number> {
  return Object.fromEntries(PERSONA_IDS.map((p) => [p, v])) as Record<PersonaId, number>;
}

export function newShopDayStats(): ShopDayStats {
  return { revenue: 0, units: 0, groups: 0, stockouts: 0, lost: 0 };
}

export function newDayStats(day: number, idx: { localRep: number; touristHeat: number }): DayStats {
  return {
    day,
    revenue: 0,
    rentIncome: 0,
    purchases: 0,
    fixed: 0,
    repairs: 0,
    groups: 0,
    units: 0,
    walkouts: 0,
    satSum: personaRecord(),
    satN: personaRecord(),
    groupsByPersona: personaRecord(),
    startIndex: { localRep: idx.localRep, touristHeat: idx.touristHeat },
    events: [],
    complaints: 0,
    reviews: 0,
    starsSum: 0,
    regularNotes: [],
    regularVisits: 0,
    systemNotes: [],
    outTax: 0,
    inTax: 0,
    fixedCredit: 0,
  };
}

export function nextId(s: MallState, prefix: string): string {
  return `${prefix}${s.nextId++}`;
}

export function addLog(s: MallState, kind: LogEntry["kind"], text: string): void {
  s.log.push({ tick: s.tick, kind, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

export function unitCost(cat: CategoryDef, supplyMultiplier = 1): number {
  return Math.max(1, Math.ceil(cat.refPrice * cat.costRatio * supplyMultiplier));
}

export function makeShop(s: MallState, category: string, name: string, slot: number): Shop {
  const cat = CATEGORY_BY_ID[category];
  if (!cat) throw new Error(`unknown category ${category}`);
  const stocked = cat.group === "food" || cat.group === "retail";
  return {
    id: nextId(s, "shop"),
    slot,
    category,
    name,
    level: 1,
    freshness: 100,
    mode: "direct",
    price: cat.refPrice,
    stock: stocked ? 200 : 0,
    incoming: [],
    restock: {
      enabled: true,
      min: 100,
      target: 350,
      dailyBudget: Math.round((unitCost(cat) * 450) / 1000) * 1000,
    },
    spentToday: 0,
    rent: cat.wage * 3,
    commission: 0.12,
    closedUntilTick: 0,
    served: 0,
    day: newShopDayStats(),
    menu: [],
    tenant: null,
  };
}

export function newWorkshopState(): WorkshopState {
  return { ingredients: [], learned: {}, dishes: [], discovered: [], jobs: [], tastings: [], tried: {}, skill: {}, log: [], clues: [] };
}

export function newPromoState(): PromoState {
  return { active: [], scheduled: [], fatigue: 0, lastEnd: {}, history: [] };
}

/** 對手們各自的第一次動作，大約在開幕後 3～6 個遊戲日 */
export function newRivalsState(level: number, startTick: number): RivalsState {
  const list = initialRivals(level);
  const nextAt: Record<string, number> = {};
  list.forEach((r, i) => (nextAt[r.id] = startTick + (3 + i) * 288 + i * 40));
  return { list, stance: "neutral", news: [], nextAt };
}

/** 第一次稽查大約在開幕後 4～6 個遊戲日 */
export function newInspectionState(startTick: number): InspectionState {
  return { pending: [], compliance: 70, log: [], nextAt: { hygiene: startTick + 4 * 288, fire: startTick + 6 * 288 } };
}

/** nowMs 是建立當下的真實時間，用來設定時鐘錨點（測試可省略） */
export function createInitialState(seed: number, startTick: number, nowMs = 0): MallState {
  const t = timeInfo(startTick);
  const slots: Slot[] = [];
  for (const z of ZONES) {
    for (let i = 0; i < z.slots; i++) slots.push({ id: slots.length, zone: z.id, shopId: null });
  }
  const s: MallState = {
    version: 10,
    clock: newClock(nowMs, startTick),
    seed: seed >>> 0,
    tick: startTick,
    funds: INITIAL_FUNDS,
    totalRevenue: 0,
    level: 1,
    flags: {},
    hours: { open: 10, close: 22 },
    localRep: INDEX_START,
    touristHeat: INDEX_START,
    peakLocal: INDEX_START,
    peakTourist: INDEX_START,
    cleanliness: 80,
    equipment: 90,
    cleaningLevel: 1,
    maintenanceLevel: 1,
    slots,
    shops: [],
    builds: [],
    modifiers: [],
    pending: [],
    cooldowns: {},
    grievances: {},
    inbox: [],
    regulars: initialRegulars(),
    promos: newPromoState(),
    inspections: newInspectionState(startTick),
    supply: initialSupply(),
    rivals: newRivalsState(1, startTick),
    workshop: newWorkshopState(),
    tax: newTaxState(),
    tech: newTechState(),
    leasing: newLeasingState(startTick),
    meta: newMetaState(startTick),
    reviewLog: [],
    guestPrefs: { complaintStance: "balanced", autoReplyReviews: true },
    walk: { nextTick: 0, voices: [] },
    today: newDayStats(t.day, { localRep: INDEX_START, touristHeat: INDEX_START }),
    reports: [],
    log: [],
    nextId: 1,
  };
  INITIAL_SHOPS.forEach((def, i) => {
    const slot = s.slots[i];
    if (!slot) return;
    const shop = makeShop(s, def.category, def.name, slot.id);
    slot.shopId = shop.id;
    s.shops.push(shop);
  });
  syncWorkshop(s);
  initGoals(s);
  addLog(s, "info", "商場開幕了。祝生意興隆！");
  return s;
}

export { isZoneUnlocked } from "@coidle/shared";

export function isFeatureEnabled(s: MallState, name: string): boolean {
  return s.flags[`feature:${name}`] === true;
}

export function categoriesOfZone(zoneId: string): CategoryDef[] {
  return CATEGORIES.filter((c) => c.zone === zoneId);
}

export function supplyMult(s: MallState, tick: number): number {
  let m = 1;
  for (const mod of s.modifiers) if (mod.kind === "supply" && mod.endTick > tick) m *= mod.mult;
  return m;
}

export function demandMult(s: MallState, category: string, tick: number): number {
  let m = 1;
  for (const mod of s.modifiers) {
    if (mod.kind === "demand" && mod.category === category && mod.endTick > tick) m *= mod.mult;
  }
  return m;
}

export function trafficMult(s: MallState, persona: PersonaId, tick: number): number {
  let m = 1;
  for (const mod of s.modifiers) {
    if (mod.kind === "traffic" && mod.endTick > tick && (mod.persona === "all" || mod.persona === persona)) m *= mod.mult;
  }
  return m;
}

/** 有效品質：等級決定上限，新鮮感過低會打折（新鮮感 20 時打 6 折）；菜單上的招牌與新品再加分 */
export function shopQuality(shop: Shop): number {
  // 租戶店的品質取決於品牌本身，而且他們自己會維持店面新鮮
  const base = shop.tenant ? shop.tenant.quality : (SHOP_QUALITY[shop.level] ?? 0.5) + menuQualityBonus(shop);
  const fresh = shop.tenant ? Math.max(shop.freshness, 85) : shop.freshness;
  return base * (0.5 + 0.5 * (fresh / 100));
}

export function shopCapacity(shop: Shop, s?: Pick<MallState, "tech">): number {
  const cat = CATEGORY_BY_ID[shop.category];
  const mult = s ? techFx(s.tech.done).capacityMult : 1;
  return Math.max(1, Math.ceil((cat?.baseCapacity ?? 1) * (1 + 0.3 * (shop.level - 1)) * mult));
}
