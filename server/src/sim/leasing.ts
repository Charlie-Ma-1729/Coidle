import {
  CANDIDATE_MAX,
  CANDIDATE_TTL,
  CATEGORIES,
  CATEGORY_BY_ID,
  COUNTER_STEPS,
  FITOUT_TICKS,
  LEASE_TERMS,
  LOW_SAT,
  LOW_SAT_DAYS,
  MAX_LEASE_LOG,
  RENEWAL_TTL,
  TERMINATE_PENALTY,
  TICKS_PER_DAY,
  baselineRevenue,
  brandName,
  brandsOfCategory,
  isCategoryAvailable,
  isZoneUnlocked,
  leaseEnabled,
  leaseRemainingRent,
  marketRent,
  techFx,
  type CategoryDef,
  type MallState,
  type Shop,
  type Tenant,
  type TenantCandidate,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import type { GuestResult } from "./guests";
import { createRng, hash32, type Rng } from "./rng";
import { bump } from "./meta";
import { flavor } from "./flavor";
import { addLog, nextId } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

export function newLeasingState(startTick: number) {
  return { candidates: [] as TenantCandidate[], renewals: [], nextAt: startTick + 2 * TICKS_PER_DAY, log: [] as { tick: number; text: string }[] };
}

function logLease(s: MallState, text: string): void {
  s.leasing.log.unshift({ tick: s.tick, text });
  if (s.leasing.log.length > MAX_LEASE_LOG) s.leasing.log.length = MAX_LEASE_LOG;
  addLog(s, "info", `🏪 ${text}`);
}

function emptySlots(s: MallState, zone: string): number[] {
  return s.slots.filter((x) => x.zone === zone && !x.shopId && !s.builds.some((b) => b.slot === x.id) && isZoneUnlocked(s, x.zone)).map((x) => x.id);
}

// ───────── 候選品牌 ─────────
function makeCandidate(s: MallState, rng: Rng): TenantCandidate | null {
  const cats = CATEGORIES.filter((c) => isCategoryAvailable(s, c.id) && emptySlots(s, c.zone).length > 0);
  if (cats.length === 0) return null;
  const have = new Set(s.shops.map((x) => x.category));
  const pending = new Set(s.leasing.candidates.map((c) => c.category));
  const weights = cats.map((c) => (pending.has(c.id) ? 0.2 : have.has(c.id) ? 1 : 2.5));
  const cat = cats[rng.weighted(weights)] as CategoryDef | undefined;
  if (!cat) return null;
  const fx = techFx(s.tech.done);
  const taken = new Set([...s.shops.map((x) => x.name), ...s.leasing.candidates.map((c) => c.brand), ...s.builds.map((x) => x.name ?? "")]);
  // 品牌目錄裡這個業態還沒進駐本商場的品牌：七成機率從裡面挑（連鎖品牌，知名度與品質依目錄）
  const catalog = brandsOfCategory(cat.id).filter((x) => !taken.has(x.name));
  const fromCatalog = catalog.length > 0 && rng.chance(0.7) ? catalog[rng.int(0, catalog.length - 1)]! : null;
  const fame = fromCatalog ? fromCatalog.fame : clamp(Math.round(20 + rng.next() * 70), 0, 100);
  const quality = fromCatalog
    ? Math.round(clamp(fromCatalog.quality + fx.candidateQuality, 0.5, 0.95) * 100) / 100
    : Math.round(clamp(0.5 + rng.next() * 0.35 + fx.candidateQuality + s.level * 0.01, 0.5, 0.95) * 100) / 100;
  const rent = Math.max(1000, Math.round((marketRent(cat.id) * (1.15 - 0.35 * (fame / 100)) * (0.9 + 0.2 * rng.next())) / 100) * 100);
  let brand = fromCatalog?.name ?? "";
  let blurb: string | undefined = fromCatalog?.blurb;
  // 內容池裡有 AI 想的品牌名時，一半的機率用它（池子是空的就完全不動亂數，結果和以前一樣）
  const pool = fromCatalog ? [] : (flavor().brands?.(cat.id) ?? []).filter((b) => !taken.has(b.name));
  if (fromCatalog) {
    // 已從品牌目錄決定
  } else if (pool.length > 0 && rng.chance(0.5)) {
    const pick = pool[rng.int(0, pool.length - 1)]!;
    brand = pick.name;
    blurb = pick.blurb;
  } else {
    for (let i = 0; i < 12; i++) {
      brand = brandName(cat.group, rng.int(0, 999), rng.int(0, 999));
      if (!taken.has(brand)) break;
    }
  }
  if (taken.has(brand)) return null;
  return {
    id: nextId(s, "tc"),
    brand,
    ...(blurb ? { blurb } : {}),
    category: cat.id,
    quality,
    fame,
    rent,
    commission: Math.round((0.06 + 0.06 * rng.next()) * 100) / 100,
    termDays: LEASE_TERMS[rng.int(0, LEASE_TERMS.length - 1)]!,
    eagerness: Math.round((0.3 + rng.next() * 0.6) * 100) / 100,
    createdTick: s.tick,
    expireTick: s.tick + CANDIDATE_TTL,
    countered: false,
  };
}

// ───────── 玩家操作 ─────────
export function signTenant(s: MallState, candidateId: string, slotId?: number): GuestResult {
  if (!leaseEnabled(s)) return { ok: false, error: "招商功能尚未開放（商場 Lv.3）" };
  const c = s.leasing.candidates.find((x) => x.id === candidateId);
  const cat = c && CATEGORY_BY_ID[c.category];
  if (!c || !cat) return { ok: false, error: "這個品牌已經不在洽談名單了" };
  const free = emptySlots(s, cat.zone);
  const slot = slotId === undefined ? free[0] : free.find((x) => x === slotId);
  if (slot === undefined) return { ok: false, error: "這個區域沒有空店面了" };
  const start = s.tick + FITOUT_TICKS;
  const tenant: Tenant = { brand: c.brand, quality: c.quality, fame: c.fame, rent: c.rent, commission: c.commission, startTick: start, endTick: start + c.termDays * TICKS_PER_DAY, satisfaction: 60, lowDays: 0 };
  s.builds.push({ id: nextId(s, "bld"), kind: "open", slot, category: c.category, completeTick: start, cost: 0, tenant });
  s.leasing.candidates = s.leasing.candidates.filter((x) => x.id !== c.id);
  bump(s, "tenants");
  logLease(s, `與「${c.brand}」（${cat.name}）簽下 ${c.termDays} 天租約：每日租金 ${money(c.rent)}、抽成 ${Math.round(c.commission * 100)}%。`);
  return { ok: true, note: `簽約完成，「${c.brand}」開始裝修` };
}

/** 還價：把租金加 10–30%。越想進駐的品牌越可能答應；不答應就轉身離開。只能還一次。 */
export function counterTenant(s: MallState, candidateId: string, mult: number): GuestResult {
  if (!leaseEnabled(s)) return { ok: false, error: "招商功能尚未開放（商場 Lv.3）" };
  const c = s.leasing.candidates.find((x) => x.id === candidateId);
  if (!c) return { ok: false, error: "這個品牌已經不在洽談名單了" };
  if (c.countered) return { ok: false, error: "已經還過價了，只能還一次" };
  if (!(COUNTER_STEPS as readonly number[]).includes(mult)) return { ok: false, error: "還價幅度無效" };
  c.countered = true;
  const p = clamp(c.eagerness * 1.15 - (mult - 1) * 2.2 + 0.2, 0.05, 0.95);
  const roll = (hash32(s.seed ^ 0x2c1b, s.tick + candidateId.length * 977 + Math.round(mult * 100)) % 1000) / 1000;
  if (roll < p) {
    c.rent = Math.round((c.rent * mult) / 100) * 100;
    return { ok: true, note: `「${c.brand}」答應了，租金調到每日 ${money(c.rent)}` };
  }
  s.leasing.candidates = s.leasing.candidates.filter((x) => x.id !== c.id);
  logLease(s, `「${c.brand}」覺得租金太高，轉身去找別的商場了。`);
  return { ok: true, note: `「${c.brand}」不接受，離開了` };
}

export function declineTenant(s: MallState, candidateId: string): GuestResult {
  const c = s.leasing.candidates.find((x) => x.id === candidateId);
  if (!c) return { ok: false, error: "這個品牌已經不在洽談名單了" };
  s.leasing.candidates = s.leasing.candidates.filter((x) => x.id !== c.id);
  return { ok: true, note: `婉拒了「${c.brand}」` };
}

export function vacate(s: MallState, shop: Shop): void {
  const slot = s.slots[shop.slot];
  if (slot) slot.shopId = null;
  s.shops = s.shops.filter((x) => x.id !== shop.id);
  s.workshop.jobs = s.workshop.jobs.filter((j) => j.shopId !== shop.id);
}

export function terminateLease(s: MallState, shopId: string): GuestResult {
  const shop = s.shops.find((x) => x.id === shopId);
  if (!shop || shop.mode !== "lease") return { ok: false, error: "這間店不是出租中的店" };
  const t = shop.tenant;
  const penalty = t ? Math.round(leaseRemainingRent(t.rent, t.endTick, s.tick) * TERMINATE_PENALTY) : 0;
  if (s.funds < penalty) return { ok: false, error: `資金不足（違約金 ${money(penalty)}）` };
  s.funds -= penalty;
  s.today.repairs += penalty;
  s.leasing.renewals = s.leasing.renewals.filter((r) => r.shopId !== shopId);
  vacate(s, shop);
  logLease(s, `提前解除與「${t?.brand ?? shop.name}」的租約${penalty > 0 ? `，付違約金 ${money(penalty)}` : ""}，店面空出來了。`);
  return { ok: true, note: "已解約" };
}

export function resolveRenewal(s: MallState, uid: string, action: "renew" | "raise" | "release"): GuestResult {
  const r = s.leasing.renewals.find((x) => x.uid === uid);
  const shop = r && s.shops.find((x) => x.id === r.shopId);
  const t = shop?.tenant;
  if (!r || !shop || !t) return { ok: false, error: "這份續約已經處理過了" };
  s.leasing.renewals = s.leasing.renewals.filter((x) => x.uid !== uid);
  if (action === "release") {
    vacate(s, shop);
    logLease(s, `不再與「${t.brand}」續約，店面空出來了。`);
    return { ok: true, note: "不續約" };
  }
  if (action === "raise") {
    // 要求加租 10%：滿意度夠高才肯，不然乾脆走人
    if (t.satisfaction < 65) {
      vacate(s, shop);
      logLease(s, `「${t.brand}」不接受加租，搬走了。`);
      return { ok: true, note: `「${t.brand}」不接受加租，搬走了` };
    }
    t.rent = Math.round((r.rent * 1.1) / 100) * 100;
  } else {
    t.rent = r.rent;
  }
  t.startTick = s.tick;
  t.endTick = s.tick + r.termDays * TICKS_PER_DAY;
  shop.rent = t.rent;
  logLease(s, `與「${t.brand}」續約 ${r.termDays} 天，每日租金 ${money(t.rent)}。`);
  return { ok: true, note: "續約完成" };
}

// ───────── 每日 ─────────
/** 租戶今天的滿意度目標：有沒有客人、租金會不會太重、館內環境、整體口碑 */
export function tenantTarget(s: MallState, shop: Shop, t: Tenant): number {
  const base = baselineRevenue(shop.category);
  const rev = shop.day.revenue;
  const traffic = base > 0 ? clamp((rev / (base * 0.8) - 1) * 20, -25, 20) : 0;
  const burden = rev > 0 ? (t.rent + t.commission * rev) / rev : 1;
  const burdenTerm = -clamp((burden - 0.2) * 60, 0, 60);
  const env = (s.cleanliness - 60) * 0.15 + (s.equipment - 60) * 0.1 + ((s.localRep + s.touristHeat) / 2 - 50) * 0.2;
  return clamp(55 + traffic + burdenTerm + env + techFx(s.tech.done).tenantSat, 0, 100);
}

/** 日結算（要在各店的當日統計重置之前呼叫） */
export function leasingDaily(s: MallState): void {
  if (!leaseEnabled(s)) return;
  const rng = createRng(hash32(s.seed ^ 0x51d7, s.tick));
  const L = s.leasing;
  L.candidates = L.candidates.filter((c) => c.expireTick > s.tick);

  if (s.tick >= L.nextAt) {
    L.nextAt = s.tick + Math.round(TICKS_PER_DAY * (0.8 + rng.next() * 1.6));
    if (L.candidates.length < CANDIDATE_MAX) {
      const c = makeCandidate(s, rng);
      if (c) {
        L.candidates.push(c);
        logLease(s, `新品牌「${c.brand}」（${CATEGORY_BY_ID[c.category]?.name}）想進駐，來洽談了。`);
      }
    }
  }

  let fameIdx = 0;
  for (const shop of s.shops.slice()) {
    const t = shop.tenant;
    if (shop.mode !== "lease" || !t || t.own || t.startTick > s.tick) continue;
    t.satisfaction = Math.round((t.satisfaction * 0.8 + tenantTarget(s, shop, t) * 0.2) * 10) / 10;
    t.lowDays = t.satisfaction < LOW_SAT ? t.lowDays + 1 : Math.max(0, t.lowDays - 1);
    fameIdx += (t.fame / 100) * 0.02;
    if (t.lowDays >= LOW_SAT_DAYS) {
      vacate(s, shop);
      applyIndexDelta(s, "localRep", -0.3);
      s.leasing.renewals = s.leasing.renewals.filter((r) => r.shopId !== shop.id);
      logLease(s, `「${t.brand}」對經營環境很不滿意，提前撤櫃了！（口碑小幅下滑）`);
      if (s.today.systemNotes.length < 8) s.today.systemNotes.push(`租戶「${t.brand}」撤櫃`);
      continue;
    }
    // 租約到期：先給一份續約洽談
    if (t.endTick <= s.tick && !L.renewals.some((r) => r.shopId === shop.id)) {
      const rent = Math.max(1000, Math.round((t.rent * (1 + clamp((t.satisfaction - 55) / 300, -0.05, 0.1))) / 100) * 100);
      L.renewals.push({ uid: nextId(s, "rn"), shopId: shop.id, brand: t.brand, rent, termDays: 60, deadlineTick: s.tick + RENEWAL_TTL });
      logLease(s, `「${t.brand}」的租約到期了，來談續約（每日租金 ${money(rent)}）。`);
    }
  }
  if (fameIdx > 0) applyIndexDelta(s, "touristHeat", Math.min(0.3, fameIdx));

  // 逾期沒處理的續約：滿意度夠就自動續，不夠就讓他走
  for (const r of L.renewals.slice()) {
    if (r.deadlineTick > s.tick) continue;
    const shop = s.shops.find((x) => x.id === r.shopId);
    resolveRenewal(s, r.uid, shop?.tenant && shop.tenant.satisfaction >= 40 ? "renew" : "release");
  }
}

/** 招商簽約的店面完工：開成租戶的店 */
export function applyTenantToShop(shop: Shop, tenant: Tenant): void {
  shop.mode = "lease";
  shop.tenant = { ...tenant };
  shop.name = tenant.brand;
  shop.rent = tenant.rent;
  shop.commission = tenant.commission;
  shop.stock = 0;
}
