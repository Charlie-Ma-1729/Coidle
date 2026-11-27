import { CATEGORIES, CATEGORY_BY_ID, PROMOS, conditionOf, isLeased, nextFacilityUnit, priceMultOf, parkingPolicy, timeInfo, weekFilms, ZONES, expandInfo, ingredientFitsCategory, isCategoryAvailable, TEAM_EVENT_BY_ID, TECHS, TICKS_PER_DAY, spotsOf, isZoneUnlocked, techBlocker, techSlots, type MallState, type SlotKind } from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, createRng, type Command } from "../sim";
import { resolveInbox } from "../sim/guests";

// 機器人玩家：用來在上線前跑長期模擬，檢查經濟平衡與離線懲罰。
// 它們只透過「指令」操作商場，和真人玩家走同一條路。

export type BotKind = "diligent" | "tender" | "periodic" | "lazy" | "chaotic";

export interface DaySample {
  day: number;
  funds: number;
  level: number;
  local: number;
  tourist: number;
  profit: number;
  revenue: number;
  groups: number;
  lostRatio: number;
  stockouts: number;
  shops: number;
  metRegulars: number;
  avgAffinity: number;
  complaints: number;
  dishes: number;
  signatures: number;
  rivalRank: number;
}

export interface BotRun {
  kind: BotKind;
  seed: number;
  samples: DaySample[];
  pauses: number;
  pauseBy: Record<string, number>;
  days: number;
  final: MallState;
  broke: boolean;
}

const PREFERRED = ["takoyaki", "kushikatsu", "ramen", "kissaten", "udon", "bubble_tea", "curry", "sweets", "fashion", "drugstore", "select_shop", "brunch", "italian", "cinema", "arcade_vr", "yakiniku", "sushi", "izakaya", "gym", "spa", "gyoza", "onigiri", "taiyaki", "convenience", "cosmetics", "bowling", "claw", "anime_goods", "camera", "nail", "yoga", "tonkatsu", "craft_beer", "food_truck", "capsule_hotel"];

function tryApply(s: MallState, cmd: Command): MallState {
  const r = applyCommand(s, cmd, { id: "bot", name: "機器人" });
  return r.ok ? r.state : s;
}

/** 勤勞玩家的一天：處理待辦、擴張、研發、促銷 */
export interface Features { expand: boolean; promo: boolean; research: boolean; regulars: boolean; refresh: boolean; upkeep: boolean; tech: boolean; lease: boolean; /** 蓋大型設施：省略／true＝全部種類都蓋；false＝不蓋；陣列＝只蓋這幾種（平衡掃描用） */ facility?: boolean | string[]; /** 大型設施的營運策略（平衡掃描用）：停車政策、價格倍率、加值服務、排最熱的片、是否招商；省略＝預設（免費、原價、不開加值、平均片、自營），但設備老舊時會維護 */ ops?: { parking?: "free" | "validate" | "paid"; price?: number; extra?: boolean; bestFilm?: boolean; leaseAll?: boolean } }
const ALL: Features = { expand: true, promo: true, research: true, regulars: true, refresh: true, upkeep: true, tech: true, lease: true };

function diligentDay(s0: MallState, rnd: () => number, f: Features = ALL): MallState {
  const expand = f.expand;
  let s = s0;
  if (s.pending.length > 0 || s.inspections.pending.some((p) => p.prep === null)) s = tryApply(s, { type: "resolveAllDefault" });
  for (const it of s.inbox.slice()) {
    const c = structuredClone(s);
    if (resolveInbox(c, it.uid, null).ok) s = c;
  }
  // 客流大了就要加強清潔與維護（總覽警告會提醒）
  if (f.upkeep) s = tryApply(s, { type: "setCleaning", level: s.cleanliness < 70 ? 2 : s.cleanliness > 90 ? 1 : s.cleaningLevel });
  if (f.upkeep) s = tryApply(s, { type: "setMaintenance", level: s.equipment < 70 ? 2 : s.equipment > 92 ? 1 : s.maintenanceLevel });

  // 團隊事件：機器人一個人就認領一項
  if (f.regulars && s.meta.team.event && !s.meta.team.event.contributions.length) {
    const def = TEAM_EVENT_BY_ID[s.meta.team.event.defId];
    if (def) s = tryApply(s, { type: "contribute", taskId: def.tasks[0]!.id });
  }
  // 租戶：有品牌來洽談就簽（挑品質×知名度最高的），續約一律照開價
  if (f.lease) {
    for (const r of s.leasing.renewals.slice()) s = tryApply(s, { type: "resolveRenewal", uid: r.uid, action: "renew" });
    const best = s.leasing.candidates.slice().sort((a, b) => b.quality * b.fame - a.quality * a.fame)[0];
    if (best) s = tryApply(s, { type: "signTenant", candidateId: best.id });
  }
  // 科技：研究室有空、錢夠寬裕就研發最便宜的
  if (f.tech && s.tech.jobs.length < techSlots(s.level)) {
    const next = TECHS.filter((t) => !techBlocker(s, t)).sort((a, b) => a.cost - b.cost)[0];
    if (next && s.funds > next.cost * 3) s = tryApply(s, { type: "startTech", id: next.id });
  }
  // 擴張：資金夠就開下一間（優先常客喜歡的類型）；沒有空店面時，錢很多就擴建
  if (expand && s.funds > 2_500_000 && s.builds.length === 0) {
    const have = new Set(s.shops.map((x) => x.category));
    const open = s.slots.filter((x) => !x.shopId && isZoneUnlocked(s, x.zone));
    const usable = (zone: string, fresh: boolean) =>
      [...PREFERRED.map((id) => CATEGORY_BY_ID[id]), ...CATEGORIES].find((c) => c && c.zone === zone && isCategoryAvailable(s, c.id) && (!fresh || !have.has(c.id)));
    let done = false;
    for (const slot of open) {
      const cat = usable(slot.zone, true) ?? usable(slot.zone, false);
      if (cat && s.funds > cat.buildCost * 1.5) {
        s = tryApply(s, { type: "buildShop", slot: slot.id, category: cat.id });
        done = true;
        break;
      }
    }
    if (!done && open.length === 0) {
      for (const z of ZONES) {
        const info = expandInfo(s, z.id);
        if (isZoneUnlocked(s, z.id) && info.canBuy && s.funds > info.cost * 4) {
          s = tryApply(s, { type: "expandZone", zone: z.id });
          break;
        }
      }
    }
  }
  // 大型設施：影城先、停車場後，錢夠寬裕就蓋下一個單位（一次只蓋一個）
  if (expand && f.facility !== false) {
    for (const kind of ["cinema", "event_space", "conference", "bowling", "parking", "hotel", "capsule_hotel"].filter((k) => !Array.isArray(f.facility) || f.facility.includes(k))) {
      const next = nextFacilityUnit(s, kind);
      if (next.canBuy && next.def && s.funds > next.def.cost * 4) {
        s = tryApply(s, { type: "buildFacility", kind });
        break;
      }
    }
  }
  // 大型設施營運：維護、定價、政策、招商
  if (f.facility !== false) {
    const o = f.ops;
    for (const fac of s.facilities ?? []) {
      if (fac.units <= 0) continue;
      if (o?.leaseAll && !isLeased(fac) && fac.ops?.offers?.length) {
        s = tryApply(s, { type: "acceptFacilityOffer", kind: fac.kind, offerId: fac.ops.offers[0]!.id });
        continue;
      }
      if (isLeased(fac)) continue;
      if (conditionOf(fac) < 65) s = tryApply(s, { type: "maintainFacility", kind: fac.kind });
      if (fac.kind === "parking" && o?.parking && parkingPolicy(fac) !== o.parking) s = tryApply(s, { type: "setFacilityOps", kind: "parking", policy: o.parking });
      if (o?.price !== undefined && priceMultOf(fac) !== o.price) s = tryApply(s, { type: "setFacilityOps", kind: fac.kind, priceMult: o.price });
      if (o?.extra !== undefined && fac.kind !== "parking" && !!fac.ops?.extra !== o.extra) s = tryApply(s, { type: "setFacilityOps", kind: fac.kind, extra: o.extra });
      if (o?.bestFilm && fac.kind === "cinema") {
        const best = weekFilms(timeInfo(s.tick).day).slice().sort((a, b) => b.heat - a.heat)[0]!;
        if (fac.ops?.films?.[0] !== best.id) s = tryApply(s, { type: "setFacilityOps", kind: "cinema", films: Array.from({ length: fac.units }, () => best.id) });
      }
    }
  }
  // 翻新：資金很寬裕時
  for (const shop of s.shops) {
    if (expand && s.funds > 8_000_000 && shop.level < 3 && shop.mode === "direct") s = tryApply(s, { type: "upgradeShop", shopId: shop.id });
    if (f.refresh && shop.freshness < 50 && s.funds > 300_000) s = tryApply(s, { type: "refreshShop", shopId: shop.id });
  }
  // 研發：沒有進行中的就試一個（只用認識的素材）
  for (const shop of f.research ? s.shops : []) {
    if (shop.mode !== "direct" || s.workshop.jobs.some((j) => j.shopId === shop.id) || s.funds < 800_000 || Math.floor(s.tick / TICKS_PER_DAY) % 3 !== 0) continue;
    const pick = (k: SlotKind) => {
      const pool = s.workshop.ingredients.filter((i) => ingredientFitsCategory(i, shop.category) && i.slot === k);
      return pool.length ? pool[Math.floor(rnd() * pool.length)]!.id : undefined;
    };
    s = tryApply(s, { type: "startRnd", shopId: shop.id, picks: { base: pick("base"), season: pick("season"), method: pick("method"), special: rnd() < 0.4 ? pick("special") : undefined } });
  }
  for (const t of s.workshop.tastings.slice()) s = tryApply(s, { type: "tastingAction", uid: t.uid, action: t.dishId ? "list" : "keep" });
  // 促銷：疲勞低時辦一場
  if (f.promo && s.funds > 1_000_000 && s.promos.fatigue < 0.3) {
    const p = PROMOS[Math.floor(rnd() * PROMOS.length)];
    if (p) s = tryApply(s, { type: "schedulePromo", defId: p.id });
  }
  // 常客：招呼、記住喜好
  for (const r of f.regulars ? s.regulars : []) {
    if (!r.met) continue;
    s = tryApply(s, { type: "regularAction", regularId: r.id, action: "greet" });
    if (!r.knowsPrefs) s = tryApply(s, { type: "regularAction", regularId: r.id, action: "remember" });
  }
  return s;
}

/** 勤勞玩家巡店：只看得到「已發現」的問題（不偷看隱藏的），行動點用來查明、處理、再隨機檢查沒看過的點 */
function patrolRoutine(s0: MallState, rnd: () => number): MallState {
  let s = tryApply(s0, { type: "patrolStart" });
  if (!s.patrol?.session) return s;
  const ap = () => s.patrol?.session?.ap ?? 0;
  const settle = () => {
    for (const i of s.patrol!.issues.filter((x) => x.status === "hinted")) {
      if (ap() < 1) break;
      s = tryApply(s, { type: "patrolDeepen", issueId: i.uid });
    }
    for (const i of s.patrol!.issues.filter((x) => x.status === "confirmed")) s = tryApply(s, { type: "patrolFix", issueId: i.uid, option: "now" });
  };
  settle();
  const direct = s.shops.filter((x) => x.mode === "direct" && x.tenant === null);
  for (let tries = 0; ap() > 0 && tries < 30 && direct.length > 0; tries++) {
    const shop = direct[Math.floor(rnd() * direct.length)]!;
    const spots = spotsOf(shop.category);
    s = tryApply(s, { type: "patrolInspect", shopId: shop.id, spot: spots[Math.floor(rnd() * spots.length)]! });
    settle();
  }
  return tryApply(s, { type: "patrolEnd" });
}

/** 亂設定玩家：價格亂調、營業時間怪、不維護 */
function chaoticDay(s0: MallState, rnd: () => number): MallState {
  let s = tryApply(s0, { type: "resolveAllDefault" });
  s = tryApply(s, { type: "setCleaning", level: 0 });
  s = tryApply(s, { type: "setMaintenance", level: 0 });
  const open = Math.floor(rnd() * 8) + 4;
  s = tryApply(s, { type: "setHours", open, close: Math.min(24, open + 4 + Math.floor(rnd() * 8)) });
  for (const shop of s.shops) {
    const cat = CATEGORY_BY_ID[shop.category];
    if (cat) s = tryApply(s, { type: "setPrice", shopId: shop.id, price: cat.refPrice * (0.5 + rnd() * 2) });
    if (rnd() < 0.2) s = tryApply(s, { type: "setRestock", shopId: shop.id, rule: { enabled: false } });
  }
  return s;
}

export function sample(s: MallState): DaySample {
  const last = s.reports[s.reports.length - 1];
  const shops = last?.shops ?? [];
  const lost = shops.reduce((a, x) => a + x.lost, 0);
  const groups = last?.groups ?? 0;
  const met = s.regulars.filter((r) => r.met);
  const me = s.localRep + s.touristHeat;
  const rivals = s.rivals.list.filter((r) => Object.values(r.appeal).reduce((a, b) => a + b, 0) / 6 > me / 2).length;
  return {
    day: Math.floor(s.tick / TICKS_PER_DAY),
    funds: s.funds,
    level: s.level,
    local: s.localRep,
    tourist: s.touristHeat,
    profit: last?.profit ?? 0,
    revenue: last?.revenue ?? 0,
    groups,
    lostRatio: groups > 0 ? lost / (groups + lost) : 0,
    stockouts: shops.reduce((a, x) => a + x.stockouts, 0),
    shops: s.shops.length,
    metRegulars: met.length,
    avgAffinity: met.length ? met.reduce((a, r) => a + r.affinity, 0) / met.length : 0,
    complaints: s.inbox.filter((i) => i.kind === "complaint").length,
    dishes: s.workshop.dishes.length,
    signatures: s.workshop.discovered.length,
    rivalRank: rivals + 1,
  };
}

/** 跑一個機器人 N 個遊戲日。absent 的玩家不在場，遇事暫停會被計數（假設事後有人回來全部採預設處理）。 */
export function runBot(kind: BotKind, seed: number, days: number, opts: { sampleEvery?: number; mutate?: (s: MallState) => void; features?: Partial<Features>; /** 每天開始時呼叫（金融實驗：在指定那天搞砸、或套用借還款策略）；回傳新狀態 */ dailyHook?: (s: MallState, day: number) => MallState } = {}): BotRun {
  const rnd = (() => {
    const r = createRng(seed ^ 0x9e3779b9);
    return () => r.next();
  })();
  let s = createInitialState(seed, 0, 0);
  opts.mutate?.(s);
  const samples: DaySample[] = [];
  let pauses = 0;
  const pauseBy: Record<string, number> = {};
  let broke = false;
  const every = opts.sampleEvery ?? 7;

  for (let d = 0; d < days; d++) {
    if (opts.dailyHook) s = opts.dailyHook(s, d);
    const present = kind === "diligent" || kind === "tender" || (kind === "periodic" && d % 3 === 0) || kind === "chaotic";
    if (kind === "diligent" || (kind === "periodic" && d % 3 === 0)) s = diligentDay(s, rnd, { ...ALL, ...opts.features });
    else if (kind === "tender") s = diligentDay(s, rnd, { ...ALL, expand: false, ...opts.features });
    else if (kind === "chaotic") s = chaoticDay(s, rnd);
    const advance = (target: number) => {
      while (s.tick < target) {
        s = advanceTo(s, target, { nobodyPresent: !present });
        if (s.clock.holds.events.length > 0) {
          pauses++;
          for (const uid of s.clock.holds.events) {
            const def = s.pending.find((p) => p.uid === uid)?.defId ?? (s.inspections.pending.some((n) => n.uid === uid) ? "inspection" : "?");
            pauseBy[def] = (pauseBy[def] ?? 0) + 1;
          }
          s = tryApply(s, { type: "resolveAllDefault" });
          s.clock.holds.events = [];
        }
      }
    };
    // 勤勞玩家中午巡店（商場開著才巡得了）
    if (kind === "diligent" || kind === "tender" || (kind === "periodic" && d % 3 === 0)) {
      advance(d * TICKS_PER_DAY + 150);
      s = patrolRoutine(s, rnd);
    }
    advance((d + 1) * TICKS_PER_DAY);
    if (s.funds < -2_000_000) broke = true;
    if ((d + 1) % every === 0) samples.push(sample(s));
  }
  return { kind, seed, samples, pauses, pauseBy, days, final: s, broke };
}
