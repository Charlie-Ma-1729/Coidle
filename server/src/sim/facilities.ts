import {
  BOOKING_POLICIES,
  CINEMA_CONCESSION_COST,
  CINEMA_CONCESSION_PRICE,
  CINEMA_HOUR_WEIGHT,
  CINEMA_SHOWS_PER_DAY,
  CINEMA_TICKET,
  CINEMA_UPKEEP_PER_SCREEN_DAY,
  CINEMA_VAR_COST,
  CONDITION_DECAY_PER_DAY,
  CONSUMPTION_STANDARD,
  EXTRA_DEFS,
  FACILITY_BY_KIND,
  FACILITY_DEFS,
  FILM_BY_ID,
  LEASE_TERMS,
  LOW_SAT,
  LOW_SAT_DAYS,
  MAINT_COOLDOWN_DAYS,
  CANDIDATE_TTL,
  OFFER_MAX,
  PARKING_OPERATORS,
  PARKING_POLICIES,
  PRICE_MULT_MAX,
  PRICE_MULT_MIN,
  RESERVE_HEAT_PER_OWN_SLOT,
  BOOKING_BASE_FILL,
  BOOKING_CLIENTS,
  BOOKING_FEE,
  BOOKING_HORIZON,
  BOOKING_SLOT_HOURS,
  COUNTER_STEPS,
  OWN_SLOT_REVENUE,
  RENEWAL_TTL,
  isBookable,
  type FacilityBooking,
  TERMINATE_PENALTY,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  brandsOfCategory,
  bookingPolicy,
  cinemaBaseViewers,
  conditionFactor,
  conditionOf,
  consumptionRate,
  facilityAmount,
  facilityBaselineRevenue,
  facilityOf,
  isHourOpen,
  isLeased,
  leaseEnabled,
  leaseRemainingRent,
  maintenanceCost,
  nextFacilityUnit,
  operatorFactor,
  parkingDailyIncome,
  parkingPolicy,
  priceFactor,
  priceMultOf,
  programmeEffect,
  taxPortion,
  techFx,
  timeInfo,
  venueDailyVisitors,
  type CategoryId,
  type Facility,
  type FacilityDef,
  type FacilityOffer,
  type MallState,
  type Tenant,
  type TimeInfo,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import { createRng, hash32 } from "./rng";
import { addLog, demandMult } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

/** 開始蓋設施的下一個單位。回傳錯誤訊息；成功回傳 null（已扣款） */
export function startFacilityBuild(s: MallState, kind: string): string | null {
  const def = FACILITY_BY_KIND[kind];
  if (!def) return "沒有這種設施";
  const next = nextFacilityUnit(s, kind);
  if (!next.canBuy || !next.def) return next.reason ?? "目前不能興建";
  s.funds -= next.def.cost;
  const fac = ensureFacility(s, kind);
  fac.building = { completeTick: s.tick + next.def.ticks, cost: next.def.cost };
  addLog(s, "build", `開始興建「${def.name}」第 ${next.index + 1} ${def.unit}。`);
  return null;
}

function ensureFacility(s: MallState, kind: string): Facility {
  s.facilities ??= [];
  let f = s.facilities.find((x) => x.kind === kind);
  if (!f) {
    f = { kind, units: 0 };
    s.facilities.push(f);
  }
  return f;
}

/**
 * 每 tick：施工中的單位到期就落成；順便把舊版當成店面開的設施（停車場）轉成設施。
 * 轉換是冪等的：店面不在了就什麼都不做；熱更新後第一個 tick 就會處理舊存檔。
 */
export function stepFacilities(s: MallState): void {
  if (s.facilities) {
    for (const f of s.facilities) {
      if (f.building && f.building.completeTick <= s.tick) {
        const def = FACILITY_BY_KIND[f.kind];
        f.units += 1;
        delete f.building;
        if (def) addLog(s, "build", `「${def.name}」第 ${f.units} ${def.unit}落成了！`);
      }
    }
  }
  convertLegacyShops(s);
}

function convertLegacyShops(s: MallState): void {
  for (const def of FACILITY_DEFS) {
    const cat = def.legacyCategory;
    if (!cat) continue;
    const legacy = s.shops.filter((x) => x.category === cat);
    if (legacy.length === 0) continue;
    const fac = ensureFacility(s, def.kind);
    for (const shop of legacy) {
      // 店升級過幾級，就當作蓋了幾個單位（不退錢、不補錢）
      fac.units = Math.min(def.units.length, Math.max(fac.units, shop.level));
      const slot = s.slots[shop.slot];
      if (slot && slot.shopId === shop.id) slot.shopId = null;
      // 這間店的翻新工程：把已付的錢還回來（不憑空生錢，只是退還沒做完的工程款）
      for (const b of s.builds) if (b.shopId === shop.id) s.funds += b.cost;
      s.builds = s.builds.filter((b) => b.shopId !== shop.id);
      s.leasing.renewals = s.leasing.renewals.filter((r) => r.shopId !== shop.id);
      s.workshop.jobs = s.workshop.jobs.filter((j) => j.shopId !== shop.id);
      s.shops = s.shops.filter((x) => x.id !== shop.id);
      addLog(s, "info", `「${shop.name}」改制為「${def.name}」設施，不再占用店面格；原店面已空出。`);
    }
  }
}

// ───────── 營運結算（每 tick） ─────────

/** 自營：收入進營收與消費稅，變動成本進進貨 */
function settleOwn(s: MallState, f: Facility, category: string, revenue: number, varCost: number, visitors: number): void {
  s.funds += revenue - varCost;
  s.today.revenue += revenue;
  s.totalRevenue += revenue;
  s.today.purchases += varCost;
  s.today.outTax += taxPortion(revenue, consumptionRate(category));
  s.today.inTax += taxPortion(varCost, CONSUMPTION_STANDARD);
  if (f.today) {
    f.today.viewers += visitors;
    f.today.revenue += revenue;
  }
}

/** 招商：營運商賺的營收不進我們的帳，只收抽成（比照出租店）；今日營收只記在設施上給畫面看 */
function settleLeased(s: MallState, f: Facility, revenue: number, visitors: number): void {
  const op = f.ops?.operator;
  if (!op) return;
  const c = revenue * op.commission;
  s.funds += c;
  s.today.rentIncome += c;
  s.today.outTax += taxPortion(c, CONSUMPTION_STANDARD);
  s.totalRevenue += c;
  if (f.today) {
    f.today.viewers += visitors;
    f.today.revenue += revenue;
  }
}

function payUpkeep(s: MallState, amount: number, open: boolean): void {
  s.funds -= amount;
  s.today.fixed += amount;
  if (!open) s.today.fixedClosed = (s.today.fixedClosed ?? 0) + amount;
}

function openHourWeights(s: MallState, weights: (h: number) => number): number {
  let sum = 0;
  for (let h = 0; h < 24; h++) if (isHourOpen(s.hours.open, s.hours.close, h)) sum += weights(h);
  return sum;
}

function startDay(f: Facility, time: TimeInfo): void {
  if (!f.today || f.today.day !== time.day) f.today = { day: time.day, viewers: 0, revenue: 0 };
}

/**
 * 影城的每 tick 營運（決定性：只看狀態，不抽亂數）。
 * 一天的觀影人次 = 基準（廳數^0.7、商場等級）× 日曆／天氣／事件／概念的 cinema 需求 × 片熱度 × 票價接受度 × 設備狀態，
 * 依小時熱度分到營業時段，再受座位上限（座位 × 每日場次）限制。
 * 自營：票房進營收；授權費（排的片決定）與耗材進進貨；賣品另計。招商：營運商經營，只收抽成。
 * 每廳每日固定成本自營才付，不論營業與否。
 */
export function runCinema(s: MallState, time: TimeInfo, open: boolean): void {
  const f = facilityOf(s, "cinema");
  if (!f || f.units <= 0) return;
  const screens = f.units;
  const leased = isLeased(f);
  if (!leased) {
    const concession = f.ops?.extra ? screens * EXTRA_DEFS.cinema!.upkeepPerUnit : 0;
    payUpkeep(s, ((screens * CINEMA_UPKEEP_PER_SCREEN_DAY + concession) / TICKS_PER_DAY), open);
  }
  startDay(f, time);
  if (!open) return;

  const weightSum = openHourWeights(s, (h) => CINEMA_HOUR_WEIGHT[h] ?? 0);
  if (weightSum <= 0) return;
  const w = CINEMA_HOUR_WEIGHT[time.hour] ?? 0;
  const op = f.ops?.operator;
  const mult = leased ? 1 : priceMultOf(f);
  const prog = leased ? { heat: 1, licensePct: 0.1 } : programmeEffect(f, time.day);
  const quality = (leased && op ? operatorFactor(op.quality, op.fame) : 1) * (leased ? 1 : conditionFactor(conditionOf(f)));
  const daily = cinemaBaseViewers(screens, s.level) * demandMult(s, "cinema", s.tick) * prog.heat * (leased ? 1 : priceFactor(mult)) * quality;
  const perTick = (daily * w) / weightSum / TICKS_PER_HOUR;
  const capPerTick = (facilityAmount(s, "cinema") * CINEMA_SHOWS_PER_DAY * w) / weightSum / TICKS_PER_HOUR;
  const viewers = Math.min(perTick, capPerTick);
  if (viewers <= 0) return;

  if (leased) {
    settleLeased(s, f, viewers * CINEMA_TICKET * 1.25, viewers); // 營運商含賣品的人均營收
    return;
  }
  const ticket = viewers * CINEMA_TICKET * mult;
  const conc = f.ops?.extra ? viewers * CINEMA_CONCESSION_PRICE : 0;
  // 變動成本：基準 35% 內含平均片 10% 的授權費；換片就換授權費率
  const varCost = ticket * (CINEMA_VAR_COST - 0.1 + prog.licensePct) + conc * CINEMA_CONCESSION_COST;
  settleOwn(s, f, "cinema", ticket + conc, varCost, viewers);
}

/**
 * 其他設施（保齡球館、旅館、膠囊旅館、會議中心、活動場地）的每 tick 營運：和影城同一套算法，參數在各設施的 econ（shared/venues.ts）。
 * 一天人次 = 基準（單位數^exp、商場等級）× 該業態的日曆／天氣／事件／概念需求 × 價格接受度 × 設備狀態，依小時熱度分到營業時段，再受容量限制。
 * 加值服務多收營收、多付成本與固定費；活動場地／會議中心「保留自辦檔期」外租收入少一成五。招商時只收抽成。
 */
export function runVenues(s: MallState, time: TimeInfo, open: boolean): void {
  if (!s.facilities) return;
  for (const f of s.facilities) {
    const def = FACILITY_BY_KIND[f.kind];
    const e = def?.econ;
    if (!def || !e || f.units <= 0) continue;
    const leased = isLeased(f);
    const extra = !leased && !!f.ops?.extra ? EXTRA_DEFS[f.kind] : undefined;
    if (!leased) payUpkeep(s, (f.units * (e.upkeepPerUnitDay + (extra?.upkeepPerUnit ?? 0))) / TICKS_PER_DAY, open);
    startDay(f, time);
    // 會議中心與活動場地：有預約才有收入（營運商經營時仍用人次模型估算營運商的營收）
    if (isBookable(f.kind) && !leased) {
      ensureBookings(s, f, def, time.day);
      settleBookings(s, f, e.category, e.varCost, time, open, extra);
      continue;
    }
    if (!open) continue;

    const weightSum = openHourWeights(s, (h) => e.hourWeight[h] ?? 0);
    const w = e.hourWeight[time.hour] ?? 0;
    if (weightSum <= 0 || w <= 0) continue;
    const op = f.ops?.operator;
    const mult = leased ? 1 : priceMultOf(f);
    const quality = (leased && op ? operatorFactor(op.quality, op.fame) : 1) * (leased ? 1 : conditionFactor(conditionOf(f)));
    const daily = venueDailyVisitors(f.kind, f.units, s.level) * demandMult(s, e.category, s.tick) * (leased ? 1 : priceFactor(mult)) * quality;
    const perTick = (daily * w) / weightSum / TICKS_PER_HOUR;
    const capPerTick = (facilityAmount(s, f.kind) * e.turns * w) / weightSum / TICKS_PER_HOUR;
    const visitors = Math.min(perTick, capPerTick);
    if (visitors <= 0) continue;

    if (leased) {
      settleLeased(s, f, visitors * e.price, visitors);
      continue;
    }
    const revenue = visitors * e.price * mult * (1 + (extra?.gain ?? 0));
    const varCost = revenue * (e.varCost + (extra?.cost ?? 0));
    settleOwn(s, f, e.category, revenue, varCost, visitors);
  }
}

/** 停車場收費：營業時段內平均攤到每個 tick。免費＝沒有收入；招商＝營運商收費、我方收抽成 */
export function runParking(s: MallState, time: TimeInfo, open: boolean): void {
  const f = facilityOf(s, "parking");
  if (!f || f.units <= 0) return;
  startDay(f, time);
  if (!open) return;
  const hours = openHourWeights(s, () => 1);
  if (hours <= 0) return;
  if (isLeased(f)) {
    const op = f.ops!.operator!;
    const def = FACILITY_BY_KIND.parking!;
    const base = facilityBaselineRevenue(s, def) * operatorFactor(op.quality, op.fame);
    settleLeased(s, f, base / hours / TICKS_PER_HOUR, 0);
    return;
  }
  const income = parkingDailyIncome(s) / hours / TICKS_PER_HOUR;
  if (income <= 0) return;
  settleOwn(s, f, "parking", income, 0, 0);
}

// ───────── 玩家指令 ─────────

type Err = string | null;
const builtFacility = (s: MallState, kind: string): { f: Facility; def: FacilityDef } | string => {
  const def = FACILITY_BY_KIND[kind];
  if (!def) return "沒有這種設施";
  const f = facilityOf(s, kind);
  if (!f || f.units <= 0) return `還沒有蓋好「${def.name}」`;
  return { f, def };
};

export function setFacilityOps(s: MallState, cmd: { kind: string; priceMult?: number; policy?: string; extra?: boolean; films?: string[] }): Err {
  const r = builtFacility(s, cmd.kind);
  if (typeof r === "string") return r;
  const { f, def } = r;
  if (isLeased(f)) return `「${def.name}」正由營運商經營，要收回自營才能調整`;
  const ops = (f.ops ??= {});
  if (cmd.priceMult !== undefined) {
    if (typeof cmd.priceMult !== "number" || !Number.isFinite(cmd.priceMult)) return "價格倍率無效";
    ops.priceMult = Math.round(clamp(cmd.priceMult, PRICE_MULT_MIN, PRICE_MULT_MAX) * 20) / 20;
  }
  if (cmd.policy !== undefined) {
    const okParking = def.kind === "parking" && cmd.policy in PARKING_POLICIES;
    const okBooking = (def.kind === "conference" || def.kind === "event_space") && cmd.policy in BOOKING_POLICIES;
    if (!okParking && !okBooking) return "這個設施沒有這種政策";
    ops.policy = cmd.policy;
  }
  if (cmd.extra !== undefined) {
    if (!EXTRA_DEFS[def.kind]) return "這個設施沒有加值服務";
    ops.extra = !!cmd.extra;
  }
  if (cmd.films !== undefined) {
    if (def.kind !== "cinema") return "只有影城能排片";
    if (!Array.isArray(cmd.films) || cmd.films.length > f.units) return "排片清單無效";
    for (const id of cmd.films) if (id !== "" && !FILM_BY_ID[id]) return "沒有這部片";
    ops.films = cmd.films.slice();
  }
  return null;
}

export function maintainFacility(s: MallState, kind: string): Err {
  const r = builtFacility(s, kind);
  if (typeof r === "string") return r;
  const { f, def } = r;
  if (isLeased(f)) return "營運商負責維護，不用你出錢";
  const ops = (f.ops ??= {});
  if (conditionOf(f) >= 100) return "設備狀態良好，不需要維護";
  if (ops.lastMaintTick !== undefined && s.tick - ops.lastMaintTick < MAINT_COOLDOWN_DAYS * TICKS_PER_DAY) return `剛維護過，${MAINT_COOLDOWN_DAYS} 遊戲日後才能再維護`;
  const cost = maintenanceCost(def, f);
  if (s.funds < cost) return `資金不足（維護費 ${money(cost)}）`;
  s.funds -= cost;
  s.today.repairs += cost;
  ops.condition = 100;
  ops.lastMaintTick = s.tick;
  addLog(s, "info", `維護了「${def.name}」的設備，花費 ${money(cost)}。`);
  return null;
}

export function acceptFacilityOffer(s: MallState, kind: string, offerId: string): Err {
  if (!leaseEnabled(s)) return "招商功能尚未開放（商場 Lv.3）";
  const r = builtFacility(s, kind);
  if (typeof r === "string") return r;
  const { f, def } = r;
  if (isLeased(f)) return "已經有營運商了";
  const o = f.ops?.offers?.find((x) => x.id === offerId);
  if (!o) return "這個營運商已經不在洽談名單了";
  const tenant: Tenant = {
    brand: o.brand,
    quality: o.quality,
    fame: o.fame,
    rent: o.rent,
    commission: o.commission,
    startTick: s.tick,
    endTick: s.tick + o.termDays * TICKS_PER_DAY,
    satisfaction: 60,
    lowDays: 0,
  };
  const ops = (f.ops ??= {});
  ops.operator = tenant;
  ops.offers = [];
  addLog(s, "info", `🏪 「${def.name}」交給「${o.brand}」經營 ${o.termDays} 天：每日租金 ${money(o.rent)}、抽成 ${Math.round(o.commission * 100)}%。`);
  return null;
}

export function declineFacilityOffer(s: MallState, kind: string, offerId: string): Err {
  const f = facilityOf(s, kind);
  const o = f?.ops?.offers?.find((x) => x.id === offerId);
  if (!f || !o) return "這個營運商已經不在洽談名單了";
  f.ops!.offers = f.ops!.offers!.filter((x) => x.id !== offerId);
  return null;
}

export function endFacilityLease(s: MallState, kind: string): Err {
  const f = facilityOf(s, kind);
  const def = FACILITY_BY_KIND[kind];
  const t = f?.ops?.operator;
  if (!f || !def || !t) return "這座設施不是招商中";
  const penalty = Math.round(leaseRemainingRent(t.rent, t.endTick, s.tick) * TERMINATE_PENALTY);
  if (s.funds < penalty) return `資金不足（違約金 ${money(penalty)}）`;
  s.funds -= penalty;
  s.today.repairs += penalty;
  delete f.ops!.operator;
  addLog(s, "info", `🏪 提前結束與「${t.brand}」的合約，「${def.name}」收回自營${penalty > 0 ? `，付違約金 ${money(penalty)}` : ""}。`);
  return null;
}

// ───────── 每日 ─────────

function makeOffer(s: MallState, def: FacilityDef, f: Facility, rng: ReturnType<typeof createRng>): FacilityOffer | null {
  const taken = new Set([...(f.ops?.offers ?? []).map((o) => o.brand)]);
  let brand = "";
  let blurb: string | undefined;
  let fame = clamp(Math.round(25 + rng.next() * 55), 0, 100);
  let quality = Math.round(clamp(0.55 + rng.next() * 0.3, 0.5, 0.95) * 100) / 100;
  if (def.kind === "parking") {
    const names = PARKING_OPERATORS.filter((n) => !taken.has(n));
    if (names.length === 0) return null;
    brand = names[rng.int(0, names.length - 1)]!;
  } else {
    const pool = brandsOfCategory(def.kind as CategoryId).filter((b) => !taken.has(b.name));
    if (pool.length === 0) return null;
    const b = pool[rng.int(0, pool.length - 1)]!;
    brand = b.name;
    blurb = b.blurb;
    fame = b.fame;
    quality = Math.round(clamp(b.quality + techFx(s.tech.done).candidateQuality, 0.5, 0.95) * 100) / 100;
  }
  const base = facilityBaselineRevenue(s, def);
  if (base <= 0) return null;
  const rent = Math.max(1000, Math.round((base * 0.2 * (1.1 - 0.3 * (fame / 100)) * (0.9 + 0.2 * rng.next())) / 100) * 100);
  return {
    id: `fo_${def.kind}_${s.tick}`, // 不動全域的 id 計數器（避免擾動其他系統的決定性）
    brand,
    ...(blurb ? { blurb } : {}),
    quality,
    fame,
    rent,
    commission: Math.round((0.05 + 0.03 * rng.next()) * 100) / 100,
    termDays: LEASE_TERMS[rng.int(0, LEASE_TERMS.length - 1)]!,
    expireTick: s.tick + CANDIDATE_TTL,
    eagerness: Math.round((0.3 + rng.next() * 0.6) * 100) / 100,
    countered: false,
  };
}

/** 日結算（要在各店當日統計重置之前呼叫）：設備損耗、營運商租金與滿意度、新營運商上門、保留檔期的口碑 */
export function facilityDaily(s: MallState): void {
  if (!s.facilities) return;
  const time = timeInfo(s.tick);
  let fameIdx = 0;
  for (const f of s.facilities) {
    const def = FACILITY_BY_KIND[f.kind];
    if (!def || f.units <= 0) continue;
    const op = f.ops?.operator;
    if (op) {
      // 租金每日結算（比照出租店）
      s.funds += op.rent;
      s.today.rentIncome += op.rent;
      s.today.outTax += taxPortion(op.rent, CONSUMPTION_STANDARD);
      s.totalRevenue += op.rent;
      const rev = f.today?.revenue ?? 0;
      const burden = rev > 0 ? (op.rent + op.commission * rev) / rev : 1;
      const env = ((s.localRep + s.touristHeat) / 2 - 50) * 0.2;
      const target = clamp(55 - clamp((burden - 0.35) * 60, 0, 60) + env + techFx(s.tech.done).tenantSat, 0, 100);
      op.satisfaction = Math.round((op.satisfaction * 0.8 + target * 0.2) * 10) / 10;
      op.lowDays = op.satisfaction < LOW_SAT ? op.lowDays + 1 : Math.max(0, op.lowDays - 1);
      fameIdx += (op.fame / 100) * 0.02;
      if (op.lowDays >= LOW_SAT_DAYS) {
        delete f.ops!.operator;
        applyIndexDelta(s, "localRep", -0.3);
        addLog(s, "info", `🏪 「${op.brand}」對「${def.name}」的經營環境很不滿意，提前退出了！（口碑小幅下滑）`);
      } else if (op.endTick <= s.tick) {
        if (op.satisfaction >= 40) {
          // 滿意的營運商來談續約；沒處理到期限就自動續約
          if (!f.ops!.renewal) {
            const rent = Math.max(1000, Math.round((op.rent * (1 + clamp((op.satisfaction - 55) / 300, -0.05, 0.1))) / 100) * 100);
            f.ops!.renewal = { rent, termDays: 60, deadlineTick: s.tick + RENEWAL_TTL };
            addLog(s, "info", `🏪 「${op.brand}」對「${def.name}」的合約到期了，來談續約（每日租金 ${money(rent)}）。`);
          } else if (f.ops!.renewal.deadlineTick <= s.tick) {
            resolveFacilityRenewal(s, f.kind, "renew");
          }
        } else {
          delete f.ops!.operator;
          addLog(s, "info", `🏪 「${op.brand}」的合約到期，不再續約，「${def.name}」回到自營。`);
        }
      }
    } else {
      // 自營：設備損耗
      const ops = (f.ops ??= {});
      ops.condition = Math.max(0, conditionOf(f) - CONDITION_DECAY_PER_DAY);
      if (ops.condition < 30 && ops.condition > 0 && s.today.systemNotes.length < 8) s.today.systemNotes.push(`「${def.name}」設備老舊，需要維護`);
    }

    // 營運商邀約：過期的清掉；還沒有營運商時偶爾有新的上門
    const ops = f.ops;
    if (ops?.offers) ops.offers = ops.offers.filter((o) => o.expireTick > s.tick);
    if (!f.ops?.operator && leaseEnabled(s) && (f.ops?.offers?.length ?? 0) < OFFER_MAX) {
      const rng = createRng(hash32(s.seed ^ 0x7ac3, s.tick + def.kind.length * 131));
      if (rng.chance(0.3)) {
        const o = makeOffer(s, def, f, rng);
        if (o) {
          (f.ops ??= {}).offers = [...(f.ops.offers ?? []), o];
          addLog(s, "info", `🏪 營運商「${o.brand}」想經營「${def.name}」，來洽談了。`);
        }
      }
    }
  }
  if (fameIdx > 0) applyIndexDelta(s, "touristHeat", Math.min(0.3, fameIdx));
  void time;
}

// ───────── 預約（會議中心／活動場地） ─────────

function bookingFill(s: MallState, f: Facility, category: string, dayOffset: number): number {
  const mult = priceMultOf(f);
  const demand = demandMult(s, category, s.tick + dayOffset * TICKS_PER_DAY);
  return clamp(BOOKING_BASE_FILL * (1 + 0.04 * (s.level - 1)) * demand * priceFactor(mult) * conditionFactor(conditionOf(f)), 0, 0.95);
}

/** 把預約補到未來 BOOKING_HORIZON 天（決定性：只看存檔與當時的需求）。保留自辦檔期時，每週四、五的最後一場留給自己辦。 */
function ensureBookings(s: MallState, f: Facility, def: FacilityDef, today: number): void {
  const hours = BOOKING_SLOT_HOURS[f.kind];
  const e = def.econ;
  if (!hours || !e) return;
  const ops = (f.ops ??= {});
  const from = Math.max(today, (ops.bookedDay ?? today - 1) + 1);
  const to = today + BOOKING_HORIZON - 1;
  if (from > to && ops.bookings) return;
  const list = (ops.bookings ??= []);
  const reserve = bookingPolicy(f) === "reserve";
  const fee = Math.round((BOOKING_FEE[f.kind]! * priceMultOf(f)) / 100) * 100;
  for (let d = from; d <= to; d++) {
    const p = bookingFill(s, f, e.category, d - today);
    for (let u = 0; u < f.units; u++) {
      for (let j = 0; j < hours.length; j++) {
        const h = hash32(s.seed ^ 0xb00c, d * 1009 + u * 31 + j * 7 + f.kind.length);
        const roll = (h % 10_000) / 10_000;
        const dow = ((d % 7) + 7) % 7;
        let b: FacilityBooking | null = null;
        if (reserve && j === hours.length - 1 && (dow === 3 || dow === 4)) b = { day: d, unit: u, slot: j, kind: "own", client: "自辦活動", fee: Math.round((fee * OWN_SLOT_REVENUE) / 100) * 100 };
        else if (roll < p) b = { day: d, unit: u, slot: j, kind: "rent", client: BOOKING_CLIENTS[(h >>> 8) % BOOKING_CLIENTS.length]!, fee };
        if (b) list.push(b);
      }
    }
  }
  ops.bookedDay = to;
  // 昨天以前的預約清掉
  ops.bookings = list.filter((b) => b.day >= today - 1);
}

/** 開場那一小時結算場租：沒打烊才算；場次落在打烊時段就取消 */
function settleBookings(s: MallState, f: Facility, category: string, varRate: number, time: TimeInfo, open: boolean, extra: { gain: number; cost: number } | undefined): void {
  const hours = BOOKING_SLOT_HOURS[f.kind];
  const list = f.ops?.bookings;
  if (!hours || !list || !open) return;
  for (const b of list) {
    if (b.paid || b.day !== time.day) continue;
    const hour = hours[b.slot];
    if (hour === undefined || time.hour < hour) continue;
    b.paid = true;
    if (!isHourOpen(s.hours.open, s.hours.close, hour)) continue;
    const fee = b.fee * (1 + (extra?.gain ?? 0));
    settleOwn(s, f, category, fee, fee * (varRate + (extra?.cost ?? 0)), 1);
    if (b.kind === "own") applyIndexDelta(s, "touristHeat", RESERVE_HEAT_PER_OWN_SLOT);
  }
}

// ───────── 營運商洽談：還價與續約 ─────────

/** 還價：把租金加 10–30%。越想經營的營運商越可能答應；不答應就轉身離開。只能還一次。 */
export function counterFacilityOffer(s: MallState, kind: string, offerId: string, mult: number): Err {
  const f = facilityOf(s, kind);
  const o = f?.ops?.offers?.find((x) => x.id === offerId);
  if (!f || !o) return "這個營運商已經不在洽談名單了";
  if (o.countered) return "已經還過價了，只能還一次";
  if (!(COUNTER_STEPS as readonly number[]).includes(mult)) return "還價幅度無效";
  o.countered = true;
  const p = clamp((o.eagerness ?? 0.5) * 1.15 - (mult - 1) * 2.2 + 0.2, 0.05, 0.95);
  const roll = (hash32(s.seed ^ 0x2c1b, s.tick + offerId.length * 977 + Math.round(mult * 100)) % 1000) / 1000;
  if (roll < p) {
    o.rent = Math.round((o.rent * mult) / 100) * 100;
    addLog(s, "info", `🏪 「${o.brand}」答應了，租金調到每日 ${money(o.rent)}。`);
    return null;
  }
  f.ops!.offers = f.ops!.offers!.filter((x) => x.id !== offerId);
  addLog(s, "info", `🏪 「${o.brand}」覺得租金太高，轉身去找別的設施了。`);
  return null;
}

/** 租約到期的續約：renew＝照來談的條件；raise＝要求加租 10%（營運商滿意度夠才肯，不然走人）；release＝不續約 */
export function resolveFacilityRenewal(s: MallState, kind: string, action: "renew" | "raise" | "release"): Err {
  const f = facilityOf(s, kind);
  const def = FACILITY_BY_KIND[kind];
  const r = f?.ops?.renewal;
  const t = f?.ops?.operator;
  if (!f || !def || !r || !t) return "這份續約已經處理過了";
  delete f.ops!.renewal;
  if (action === "release") {
    delete f.ops!.operator;
    addLog(s, "info", `🏪 不再與「${t.brand}」續約，「${def.name}」回到自營。`);
    return null;
  }
  if (action === "raise") {
    if (t.satisfaction < 65) {
      delete f.ops!.operator;
      addLog(s, "info", `🏪 「${t.brand}」不接受加租，退出了「${def.name}」。`);
      return null;
    }
    t.rent = Math.round((r.rent * 1.1) / 100) * 100;
  } else {
    t.rent = r.rent;
  }
  t.startTick = s.tick;
  t.endTick = s.tick + r.termDays * TICKS_PER_DAY;
  addLog(s, "info", `🏪 與「${t.brand}」續約 ${r.termDays} 天，每日租金 ${money(t.rent)}。`);
  return null;
}
