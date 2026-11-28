import {
  CATEGORY_BY_ID,
  FACILITY_DEFS,
  FAN_AFFINITY,
  FAN_DAILY_IDX,
  GIFT_COOLDOWN_TICKS,
  GIFT_COST,
  GREET_COOLDOWN_TICKS,
  regularIsHere,
  HELP_MIN_AFFINITY,
  FRIEND_MIN_AFFINITY,
  KNOWN_GAIN_MULT,
  KNOWN_VISIT_MULT,
  LIFE_EVENTS,
  MAX_FAN_IDX,
  MAX_OPEN_VOICES,
  PERSONA_BY_ID,
  REGULARS,
  REGULAR_BY_ID,
  REGULAR_DRIFT_AFTER_TICKS,
  REGULAR_KINDS,
  REGULAR_START_AFFINITY,
  RESERVE_FEE,
  TICKS_PER_HOUR,
  VOICE_AFFINITY,
  VOICE_DEADLINE_TICKS,
  VOICE_MIN_AFFINITY,
  VOICE_TOPICS,
  categoryHasStock,
  kindHourMult,
  memberAffinityMult,
  memberTierIndex,
  techFx,
  type CategoryDef,
  type MallState,
  type PersonaDef,
  type RegularContrib,
  type RegularDef,
  type RegularState,
  type RegularVoice,
  type Shop,
  type VoiceTopic,
} from "@coidle/shared";
import { applyPersonaIndex } from "./events";
import { facilityWalkIn } from "./facilities";
import type { GuestResult } from "./guests";
import { promoRegularGain } from "./promos";
import { createRng, hash32, type Rng } from "./rng";
import { RECIPE_REGULAR } from "./recipes";
import { addLog, nextId, shopCapacity } from "./state";
import type { TimeInfo } from "./time";

/** 把一筆成交記進帳（由 step.ts 傳入，避免循環匯入） */
export type SaleFn = (s: MallState, rng: Rng, p: PersonaDef, shop: Shop, cat: CategoryDef, qty: number) => number;

const MAX_NOTES_PER_DAY = 6;

export function newRegularState(id: string): RegularState {
  return {
    id,
    met: false,
    affinity: 0,
    visits: 0,
    lastVisitTick: -1_000_000,
    mood: "neutral",
    storyStage: 0,
    lastTalkTick: -1_000_000,
    lastGiftTick: -1_000_000,
    knowsPrefs: false,
    reserved: false,
    tipsTotal: 0,
    contrib: { revenue: 0, friends: 0, feedback: 0, help: 0 },
  };
}

export function contribOf(reg: RegularState): RegularContrib {
  if (!reg.contrib) reg.contrib = { revenue: 0, friends: 0, feedback: 0, help: 0 };
  return reg.contrib;
}

export function voicesOf(s: MallState): RegularVoice[] {
  if (!s.voices) s.voices = [];
  return s.voices;
}

export function initialRegulars(): RegularState[] {
  return REGULARS.map((r) => newRegularState(r.id));
}

/** 名冊上有新朋友（新增的常客、核准上線的 AI 常客）時，替既有的商場補上他們的紀錄 */
export function syncRegulars(s: MallState): void {
  const have = new Set(s.regulars.map((r) => r.id));
  for (const def of REGULARS) if (!have.has(def.id)) s.regulars.push(newRegularState(def.id));
}

function note(s: MallState, text: string): void {
  if (s.today.regularNotes.length < MAX_NOTES_PER_DAY) s.today.regularNotes.push(text);
}

/** 親密度達標就解鎖故事（附帶一點獎勵） */
function checkStories(s: MallState, reg: RegularState, def: RegularDef): void {
  while (reg.storyStage < def.stories.length) {
    const st = def.stories[reg.storyStage];
    if (!st || reg.affinity < st.at) return;
    reg.storyStage++;
    if (st.reward.funds) {
      s.funds += st.reward.funds;
      s.today.revenue += st.reward.funds;
      s.totalRevenue += st.reward.funds;
    }
    if (st.reward.idx) applyPersonaIndex(s, def.persona, st.reward.idx);
    addLog(s, "info", `💞 與常客「${def.name}」的關係更深了：《${st.title}》`);
    note(s, `與「${def.name}」的關係更深了：《${st.title}》`);
  }
}

export function gain(s: MallState, reg: RegularState, def: RegularDef, rawAmount: number): void {
  // 集點會員活動、會員制、「記住喜好」都讓關係升溫更快
  const amount = rawAmount > 0 ? rawAmount * promoRegularGain(s) * techFx(s.tech.done).regularGainMult * memberAffinityMult(s.members) * (reg.knowsPrefs ? KNOWN_GAIN_MULT : 1) : rawAmount;
  reg.affinity = Math.min(100, Math.max(0, reg.affinity + amount));
  if (amount > 0) checkStories(s, reg, def);
}

/** 每個 tick：每位常客有小機率上門（頻率隨親密度、專屬座位、平假日與時段而變） */
const FACILITY_CATEGORIES = new Set(FACILITY_DEFS.map((d) => d.legacyCategory).filter((c): c is string => !!c && c !== "parking"));

export function runRegulars(s: MallState, rng: Rng, time: TimeInfo, open: Shop[], sale: SaleFn): number {
  let units = 0;
  for (const reg of s.regulars) {
    const def = REGULAR_BY_ID[reg.id];
    if (!def) continue;
    const cands = open.filter((x) => x.category === def.fav || x.category === def.alt);
    const facCat = cands.length === 0 ? [def.fav, def.alt].find((c) => c && FACILITY_CATEGORIES.has(c)) : undefined;
    if (cands.length === 0 && !facCat) continue;
    const p = PERSONA_BY_ID[def.persona];
    const share = (time.offDay ? p.weekendHourShare : p.hourShare)[time.hour] ?? 0;
    const perDay = (0.35 + (0.9 * reg.affinity) / 100) * (reg.knowsPrefs ? KNOWN_VISIT_MULT : 1) * kindHourMult(def.kind, time.hour, time.offDay) * (time.offDay ? Math.sqrt(p.weekendMult) : 1);
    const prob = Math.min(0.5, (perDay * share) / TICKS_PER_HOUR);
    if (!rng.chance(prob)) continue;
    units += facCat ? visitFacility(s, rng, reg, def, p, facCat) : visit(s, rng, reg, def, p, cands, sale);
  }
  return units;
}

/** 設施業態（影城、保齡球館…）沒有店面：常客愛去的是設施，進場收費走設施帳（店面的缺貨、客滿、價格檢查用不上，只看價格接受度） */
function visitFacility(s: MallState, rng: Rng, reg: RegularState, def: RegularDef, p: PersonaDef, category: string): number {
  const want = rng.int(1, p.party[1] >= 2 ? 2 : 1);
  const got = facilityWalkIn(s, category, want);
  if (got < 1) return 0;
  const cat = CATEGORY_BY_ID[category];
  if (!reg.met) {
    reg.met = true;
    reg.affinity = REGULAR_START_AFFINITY;
    addLog(s, "info", `🆕 新常客登場：「${def.name}」第一次來到「${cat?.name ?? category}」！`);
    note(s, `新常客登場：「${def.name}」第一次上門！`);
  }
  reg.lastVisitTick = s.tick;
  reg.visits++;
  s.today.regularVisits++;
  reg.mood = "happy";
  gain(s, reg, def, 0.75 * 1.2);
  return got;
}

function visit(s: MallState, rng: Rng, reg: RegularState, def: RegularDef, p: PersonaDef, cands: Shop[], sale: SaleFn): number {
  // 先找最愛的業態（多間時挑最便宜的），沒有才找第二選擇
  const pickCheapest = (list: Shop[]) => list.slice().sort((a, b) => a.price - b.price)[0];
  const shop = pickCheapest(cands.filter((x) => x.category === def.fav)) ?? pickCheapest(cands);
  if (!shop) return 0;
  const cat = CATEGORY_BY_ID[shop.category];
  if (!cat) return 0;

  if (!reg.met) {
    reg.met = true;
    reg.affinity = REGULAR_START_AFFINITY;
    addLog(s, "info", `🆕 新常客登場：「${def.name}」第一次來到「${shop.name}」！`);
    note(s, `新常客登場：「${def.name}」第一次上門！`);
  }

  const want = rng.int(1, p.party[1] >= 2 ? 2 : 1);
  const stocked = categoryHasStock(cat) && shop.mode === "direct";
  let reason: "stockout" | "full" | "price" | "dirty" | null = null;
  if (stocked && shop.stock < want) reason = "stockout";
  else if (shop.served + want > shopCapacity(shop, s)) reason = "full";
  else if (shop.price > cat.refPrice * def.budget) reason = "price";
  else if (s.cleanliness < (def.kind ? REGULAR_KINDS[def.kind].cleanBar : 40)) reason = "dirty";

  reg.lastVisitTick = s.tick;
  if (reason) {
    const loss = { stockout: 2, price: 1.5, full: 0.8, dirty: 1 }[reason];
    gain(s, reg, def, -loss);
    reg.mood = "upset";
    note(
      s,
      {
        stockout: `「${def.name}」想吃「${shop.name}」，卻碰上缺貨，失望地走了。`,
        price: `「${def.name}」覺得「${shop.name}」變貴了，皺了皺眉。`,
        full: `「${def.name}」來了，但「${shop.name}」客滿，等不到位子。`,
        dirty: `「${def.name}」嫌館內不夠乾淨，匆匆離開。`,
      }[reason],
    );
    return 0;
  }

  const qty = sale(s, rng, p, shop, cat, want);
  if (qty < 1) return 0;
  reg.visits++;
  s.today.regularVisits++;
  reg.mood = "happy";
  const contrib = contribOf(reg);
  contrib.revenue += shop.price * qty;
  let total = qty;
  // 熟客階段以上會帶朋友一起來（朋友走正常成交，算這位熟客的貢獻）
  if (reg.affinity >= FRIEND_MIN_AFFINITY) {
    const kindFriend = def.kind ? REGULAR_KINDS[def.kind].friend : 1;
    const pFriend = Math.min(0.5, 0.3 * (reg.affinity / 100) * kindFriend * (1 + 0.1 * memberTierIndex(s.members?.count ?? 0)));
    if (rng.chance(pFriend)) {
      const n = rng.chance(0.3) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const stockedNow = categoryHasStock(cat) && shop.mode === "direct";
        if (stockedNow && shop.stock < 1) break; // 朋友是和他同行的一桌，不再另外檢查座位
        const got = sale(s, rng, p, shop, cat, 1);
        if (got < 1) break;
        total += got;
        contrib.friends += got;
        contrib.revenue += shop.price * got;
      }
    }
  }
  if (reg.affinity >= 30) {
    const tip = Math.round(shop.price * qty * 0.25 * (reg.affinity / 100));
    if (tip > 0) {
      s.funds += tip;
      s.today.revenue += tip;
      s.totalRevenue += tip;
      reg.tipsTotal += tip;
    }
  }
  const signature = shop.menu.some((e) => e.recipeId !== null && RECIPE_REGULAR[e.recipeId] === def.id);
  gain(s, reg, def, 0.75 * (1.2 + (shop.freshness > 70 ? 0.4 : 0) + (shop.level >= 2 ? 0.3 : 0)) + (signature ? 1 : 0));
  return total;
}

/** 日結算：久沒上門的熟客漸漸疏遠；老主顧替商場帶來一點口碑；意見到期、新的意見與人生大事 */
export function regularsDaily(s: MallState): void {
  syncRegulars(s);
  releaseReservations(s);
  let fans = 0;
  const maxFans = Math.floor(MAX_FAN_IDX / FAN_DAILY_IDX);
  for (const reg of s.regulars) {
    if (!reg.met) continue;
    const def = REGULAR_BY_ID[reg.id];
    if (!def) continue;
    if (s.tick - reg.lastVisitTick > REGULAR_DRIFT_AFTER_TICKS && reg.affinity > 5) {
      reg.affinity = Math.max(5, reg.affinity - 0.5);
      reg.mood = "neutral";
    } else if (s.tick - reg.lastVisitTick > 288 && reg.mood !== "neutral") {
      reg.mood = "neutral";
    }
    if (reg.affinity >= FAN_AFFINITY && fans < maxFans) {
      applyPersonaIndex(s, def.persona, FAN_DAILY_IDX);
      fans++;
    }
  }
  voicesDaily(s);
}

/** 舊存檔的「專屬座位」：現實裡沒有這種東西，退還保留費並取消 */
function releaseReservations(s: MallState): void {
  let refunded = 0;
  for (const reg of s.regulars) {
    if (!reg.reserved) continue;
    reg.reserved = false;
    refunded += RESERVE_FEE;
  }
  if (refunded > 0) {
    s.funds += refunded;
    addLog(s, "info", `🏮 專屬座位的做法取消了（現實裡的店不會替客人保留固定座位），已退還保留費 ¥${refunded.toLocaleString("en-US")}。`);
    note(s, `專屬座位取消，退還 ¥${refunded.toLocaleString("en-US")}。`);
  }
}

// ───────── 熟客的話：意見與人生大事 ─────────

/** 熟客最常光顧的店（最愛業態優先；多間時挑最近有人氣的） */
export function favShopOf(s: MallState, def: RegularDef): Shop | null {
  const direct = s.shops.filter((x) => x.mode === "direct" && x.tenant === null && x.closedUntilTick <= s.tick);
  const favs = direct.filter((x) => x.category === def.fav);
  const pool = favs.length > 0 ? favs : direct.filter((x) => x.category === def.alt);
  return pool.slice().sort((a, b) => b.day.revenue - a.day.revenue)[0] ?? null;
}

function pickTopic(s: MallState, rng: Rng, reg: RegularState, shop: Shop): VoiceTopic {
  const cat = CATEGORY_BY_ID[shop.category];
  const stocked = !!cat && categoryHasStock(cat);
  const w: [VoiceTopic, number][] = [
    ["dirty", s.cleanliness < 45 ? 3 : s.cleanliness < 60 ? 1.2 : 0],
    ["stockout", stocked && (shop.stock < 40 || shop.day.stockouts > 0) ? 3 : 0],
    ["price", cat && shop.price > cat.refPrice * 1.1 ? 2 : 0],
    ["queue", shop.day.lost > 0 ? 2.5 : 0],
    ["stale", shop.freshness < 60 ? 2 : 0],
    ["wish", 0.8],
    ["life", reg.affinity >= 85 ? 1.6 : reg.affinity >= 60 ? 0.9 : 0],
  ];
  const i = rng.weighted(w.map((x) => x[1]));
  return w[i]?.[0] ?? "wish";
}

function voicesDaily(s: MallState): void {
  const voices = voicesOf(s);
  // 到期沒回應：他覺得被忽略
  for (const v of voices.slice()) {
    if (v.deadlineTick > s.tick) continue;
    const reg = s.regulars.find((r) => r.id === v.regularId);
    const def = REGULAR_BY_ID[v.regularId];
    voices.splice(voices.indexOf(v), 1);
    if (reg && def) gain(s, reg, def, VOICE_AFFINITY.ignore);
  }
  if (voices.length >= MAX_OPEN_VOICES) return;
  const rng = createRng(hash32(s.seed ^ 0x7e11, s.tick));
  for (const reg of s.regulars) {
    if (voices.length >= MAX_OPEN_VOICES) return;
    if (!reg.met || reg.affinity < VOICE_MIN_AFFINITY || s.tick - reg.lastVisitTick > 288 * 4) continue;
    if (voices.some((v) => v.regularId === reg.id)) continue;
    const def = REGULAR_BY_ID[reg.id];
    if (!def) continue;
    const kindVoice = def.kind ? REGULAR_KINDS[def.kind].voice : 1;
    if (!rng.chance(0.03 * kindVoice * (0.5 + reg.affinity / 100))) continue;
    const shop = favShopOf(s, def);
    if (!shop) continue;
    const topic = pickTopic(s, rng, reg, shop);
    let text: string;
    let detail: string | undefined;
    if (topic === "life") {
      const ev = LIFE_EVENTS[rng.int(0, LIFE_EVENTS.length - 1)]!;
      detail = ev.id;
      text = ev.text.replaceAll("{name}", def.name);
    } else {
      const lines = VOICE_TOPICS[topic].lines;
      text = (lines[rng.int(0, lines.length - 1)] ?? "").replaceAll("{shop}", shop.name);
    }
    voices.push({ uid: nextId(s, "vo"), regularId: reg.id, shopId: shop.id, topic, ...(detail ? { detail } : {}), text: `${def.name}：「${text}」`, createdTick: s.tick, deadlineTick: s.tick + VOICE_DEADLINE_TICKS });
    addLog(s, "info", `🏮 熟客「${def.name}」有話想對你說（${VOICE_TOPICS[topic].label}）。`);
  }
}

/** 老主顧在危機時肯幫你說話：這間店的熟客（最愛或第二選擇是這個業態）裡，關係夠好的人數（長者與業界人士分量加倍） */
export function regularHelp(s: MallState, shop: Shop): number {
  let w = 0;
  for (const reg of s.regulars) {
    if (!reg.met || reg.affinity < HELP_MIN_AFFINITY) continue;
    const def = REGULAR_BY_ID[reg.id];
    if (!def || (def.fav !== shop.category && def.alt !== shop.category)) continue;
    w += def.kind ? REGULAR_KINDS[def.kind].help : 1;
  }
  return w;
}

/** 有人幫你說了話：記在那些熟客的貢獻裡 */
export function recordHelp(s: MallState, shop: Shop): void {
  for (const reg of s.regulars) {
    if (!reg.met || reg.affinity < HELP_MIN_AFFINITY) continue;
    const def = REGULAR_BY_ID[reg.id];
    if (def && (def.fav === shop.category || def.alt === shop.category)) contribOf(reg).help++;
  }
}

/** 和熟客互動：打招呼、記住喜好、送小禮 */
export function regularAction(s: MallState, regularId: string, action: string): GuestResult {
  const reg = s.regulars.find((r) => r.id === regularId);
  const def = REGULAR_BY_ID[regularId];
  if (!reg || !def) return { ok: false, error: "找不到這位熟客" };
  if (!reg.met) return { ok: false, error: "你還沒認識這位客人" };

  switch (action) {
    case "greet":
      if (!regularIsHere(reg, s.tick)) return { ok: false, error: `「${def.name}」現在不在店裡，等他上門的時候再聊` };
      if (s.tick < reg.lastTalkTick + GREET_COOLDOWN_TICKS) return { ok: false, error: `剛跟「${def.name}」聊過，晚一點再來` };
      reg.lastTalkTick = s.tick;
      gain(s, reg, def, 1);
      return { ok: true, note: `和「${def.name}」聊了幾句，他笑得很開心。` };
    case "remember":
      if (reg.knowsPrefs) return { ok: false, error: "你已經記住他的喜好了" };
      reg.knowsPrefs = true;
      gain(s, reg, def, 2);
      return { ok: true, note: `你記住了「${def.name}」的喜好。被記住的人，來得更勤、關係也長得更快。` };
    case "gift":
      if (s.tick < reg.lastGiftTick + GIFT_COOLDOWN_TICKS) return { ok: false, error: "剛送過禮，太頻繁反而讓人不好意思" };
      if (s.funds < GIFT_COST) return { ok: false, error: "資金不足" };
      s.funds -= GIFT_COST;
      s.today.purchases += GIFT_COST;
      reg.lastGiftTick = s.tick;
      gain(s, reg, def, 3);
      return { ok: true, note: `送了「${def.name}」一份小禮物。` };
    default:
      return { ok: false, error: "不支援的互動" };
  }
}
