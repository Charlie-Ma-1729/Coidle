import {
  CATEGORY_BY_ID,
  FAN_AFFINITY,
  FAN_DAILY_IDX,
  GIFT_COOLDOWN_TICKS,
  GIFT_COST,
  GREET_COOLDOWN_TICKS,
  MAX_FAN_IDX,
  PERSONA_BY_ID,
  REGULARS,
  REGULAR_BY_ID,
  REGULAR_DRIFT_AFTER_TICKS,
  REGULAR_START_AFFINITY,
  RESERVE_FEE,
  RESERVE_MIN_AFFINITY,
  TICKS_PER_HOUR,
  categoryHasStock,
  techFx,
  type CategoryDef,
  type MallState,
  type PersonaDef,
  type RegularDef,
  type RegularState,
  type Shop,
} from "@coidle/shared";
import { applyPersonaIndex } from "./events";
import type { GuestResult } from "./guests";
import { promoRegularGain } from "./promos";
import type { Rng } from "./rng";
import { RECIPE_REGULAR } from "./recipes";
import { addLog, shopCapacity } from "./state";
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
  };
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

function gain(s: MallState, reg: RegularState, def: RegularDef, rawAmount: number): void {
  const amount = rawAmount > 0 ? rawAmount * promoRegularGain(s) * techFx(s.tech.done).regularGainMult : rawAmount; // 集點會員活動期間，關係升溫更快
  reg.affinity = Math.min(100, Math.max(0, reg.affinity + amount));
  if (amount > 0) checkStories(s, reg, def);
}

/** 每個 tick：每位常客有小機率上門（頻率隨親密度、專屬座位、平假日與時段而變） */
export function runRegulars(s: MallState, rng: Rng, time: TimeInfo, open: Shop[], sale: SaleFn): number {
  let units = 0;
  for (const reg of s.regulars) {
    const def = REGULAR_BY_ID[reg.id];
    if (!def) continue;
    const cands = open.filter((x) => x.category === def.fav || x.category === def.alt);
    if (cands.length === 0) continue;
    const p = PERSONA_BY_ID[def.persona];
    const share = (time.weekend ? p.weekendHourShare : p.hourShare)[time.hour] ?? 0;
    const perDay = (0.35 + (0.9 * reg.affinity) / 100) * (reg.reserved ? 1.3 : 1) * (time.weekend ? Math.sqrt(p.weekendMult) : 1);
    const prob = Math.min(0.5, (perDay * share) / TICKS_PER_HOUR);
    if (!rng.chance(prob)) continue;
    units += visit(s, rng, reg, def, p, cands, sale);
  }
  return units;
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
  else if (s.cleanliness < 40) reason = "dirty";

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
  if (reg.affinity >= 30) {
    const tip = Math.round(shop.price * qty * 0.25 * (reg.affinity / 100) * (reg.reserved ? 1.5 : 1));
    if (tip > 0) {
      s.funds += tip;
      s.today.revenue += tip;
      s.totalRevenue += tip;
      reg.tipsTotal += tip;
    }
  }
  const signature = shop.menu.some((e) => e.recipeId !== null && RECIPE_REGULAR[e.recipeId] === def.id);
  gain(s, reg, def, 0.75 * (1.2 + (shop.freshness > 70 ? 0.4 : 0) + (shop.level >= 2 ? 0.3 : 0)) + (signature ? 1 : 0));
  return qty;
}

/** 日結算：久沒上門的常客漸漸疏遠；熟客粉絲替商場帶來一點口碑 */
export function regularsDaily(s: MallState): void {
  syncRegulars(s);
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
}

/** 和常客互動：招呼、記住喜好、送小禮、保留／取消專屬座位 */
export function regularAction(s: MallState, regularId: string, action: string): GuestResult {
  const reg = s.regulars.find((r) => r.id === regularId);
  const def = REGULAR_BY_ID[regularId];
  if (!reg || !def) return { ok: false, error: "找不到這位常客" };
  if (!reg.met) return { ok: false, error: "你還沒認識這位客人" };

  switch (action) {
    case "greet":
      if (s.tick < reg.lastTalkTick + GREET_COOLDOWN_TICKS) return { ok: false, error: `剛跟「${def.name}」聊過，晚一點再來` };
      reg.lastTalkTick = s.tick;
      gain(s, reg, def, 1);
      return { ok: true, note: `和「${def.name}」聊了幾句，他笑得很開心。` };
    case "remember":
      if (reg.knowsPrefs) return { ok: false, error: "你已經記住他的喜好了" };
      reg.knowsPrefs = true;
      gain(s, reg, def, 2);
      return { ok: true, note: `你把「${def.name}」的喜好記在小本子上。` };
    case "gift":
      if (s.tick < reg.lastGiftTick + GIFT_COOLDOWN_TICKS) return { ok: false, error: "剛送過禮，太頻繁反而讓人不好意思" };
      if (s.funds < GIFT_COST) return { ok: false, error: "資金不足" };
      s.funds -= GIFT_COST;
      s.today.purchases += GIFT_COST;
      reg.lastGiftTick = s.tick;
      gain(s, reg, def, 3);
      return { ok: true, note: `送了「${def.name}」一份小禮物。` };
    case "reserve":
      if (reg.reserved) return { ok: false, error: "已經保留專屬座位了" };
      if (reg.affinity < RESERVE_MIN_AFFINITY) return { ok: false, error: `親密度要達到 ${RESERVE_MIN_AFFINITY} 才能保留專屬座位` };
      if (s.funds < RESERVE_FEE) return { ok: false, error: "資金不足" };
      s.funds -= RESERVE_FEE;
      s.today.purchases += RESERVE_FEE;
      reg.reserved = true;
      return { ok: true, note: `「${def.name}」有專屬座位了。` };
    case "unreserve":
      if (!reg.reserved) return { ok: false, error: "沒有保留專屬座位" };
      reg.reserved = false;
      return { ok: true, note: `取消了「${def.name}」的專屬座位。` };
    default:
      return { ok: false, error: "不支援的互動" };
  }
}
