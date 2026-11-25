import { createHash } from "node:crypto";
import { CATEGORY_BY_ID, REGULARS, type CategoryGroup, type EffectSpec, type EventCategory, type EventDef, type PersonaId, type RegularDef } from "@coidle/shared";
import { checkText } from "./validate";

// 內容驗證與正規化：模型的輸出不可信，一律「只收白名單、數值夾限、文字過濾」。

export type NewsMood = "good" | "bad" | "neutral" | "season";
export type ReviewTier = "high" | "mid" | "low";
export const NEWS_MOODS: NewsMood[] = ["good", "bad", "neutral", "season"];
export const REVIEW_TIERS: ReviewTier[] = ["high", "mid", "low"];

export interface NewsItem {
  mood: NewsMood;
  text: string;
}
export interface ReviewItem {
  tier: ReviewTier;
  text: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** 去掉模型常見的小瑕疵（多餘空白、全形空格） */
const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\{ ?shop ?\}/g, "{shop}").trim();

export function checkNews(raw: unknown): Checked<NewsItem> {
  if (!isObj(raw)) return { ok: false, reason: "格式錯誤" };
  const mood = raw.mood;
  if (!NEWS_MOODS.includes(mood as NewsMood)) return { ok: false, reason: "mood 無效" };
  const text = typeof raw.text === "string" ? tidy(raw.text) : "";
  const bad = checkText(text, { min: 12, max: 70 });
  if (bad) return { ok: false, reason: bad };
  if (text.includes("{")) return { ok: false, reason: "含佔位符" };
  return { ok: true, value: { mood: mood as NewsMood, text } };
}

export function checkReview(raw: unknown): Checked<ReviewItem> {
  if (!isObj(raw)) return { ok: false, reason: "格式錯誤" };
  const tier = raw.tier;
  if (!REVIEW_TIERS.includes(tier as ReviewTier)) return { ok: false, reason: "tier 無效" };
  const text = typeof raw.text === "string" ? tidy(raw.text) : "";
  const bad = checkText(text, { min: 15, max: 110, must: ["{shop}"] });
  if (bad) return { ok: false, reason: bad };
  if ((text.match(/\{shop\}/g) ?? []).length > 1) return { ok: false, reason: "佔位符重複" };
  if (/\{(?!shop\})/.test(text)) return { ok: false, reason: "含不明佔位符" };
  return { ok: true, value: { tier: tier as ReviewTier, text } };
}

// ───────── 事件 ─────────
const PERSONAS: PersonaId[] = ["tourist", "local", "commuter", "family", "student", "couple"];
const CATEGORIES: EventCategory[] = ["crowd", "facility", "luck", "market", "festival"];

/** 把模型給的效果轉成白名單效果並夾限；不認得的一律拒收 */
export function normalizeEffect(raw: unknown): EffectSpec | null {
  if (!isObj(raw)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  switch (raw.t) {
    case "funds": {
      const a = num(raw.amount);
      return a === null ? null : { t: "funds", amount: Math.round(clamp(a, -60_000, 60_000)) };
    }
    case "index": {
      const a = num(raw.amount);
      if (a === null || (raw.which !== "localRep" && raw.which !== "touristHeat")) return null;
      return { t: "index", which: raw.which, amount: Math.round(clamp(a, -2, 2) * 100) / 100 };
    }
    case "traffic": {
      const m = num(raw.mult);
      const k = num(raw.ticks);
      const p = raw.persona === "all" || PERSONAS.includes(raw.persona as PersonaId) ? (raw.persona as PersonaId | "all") : null;
      if (m === null || k === null || p === null) return null;
      return { t: "traffic", persona: p, mult: Math.round(clamp(m, 0.8, 1.5) * 100) / 100, ticks: Math.round(clamp(k, 12, 144)) };
    }
    case "cleanliness": {
      const a = num(raw.amount);
      return a === null ? null : { t: "cleanliness", amount: Math.round(clamp(a, -15, 15)) };
    }
    default:
      return null;
  }
}

/** 淨效果的粗略「好壞」，用來挑預設選項（沒人處理時走最保守的那個）與檢查沒有明顯最佳解 */
function effectScore(e: EffectSpec): number {
  switch (e.t) {
    case "funds":
      return e.amount / 20_000;
    case "index":
      return e.amount * 2;
    case "traffic":
      return (e.mult - 1) * 3 * (e.ticks / 72);
    case "cleanliness":
      return e.amount / 10;
    default:
      return 0;
  }
}

export interface EventCheckOpts {
  /** Overseer 親手寫的事件：不強迫「要有取捨」，可以只有好處（節慶）或沒有選項；仍然只收白名單效果並夾限數值 */
  trusted?: boolean;
}

export function checkEvent(raw: unknown, opts: EventCheckOpts = {}): Checked<EventDef> {
  if (!isObj(raw)) return { ok: false, reason: "格式錯誤" };
  const title = typeof raw.title === "string" ? tidy(raw.title) : "";
  const text = typeof raw.text === "string" ? tidy(raw.text) : "";
  const t1 = checkText(title, { min: 3, max: 18 });
  if (t1) return { ok: false, reason: `標題：${t1}` };
  const t2 = checkText(text, { min: 20, max: 130 });
  if (t2) return { ok: false, reason: `描述：${t2}` };
  if (!CATEGORIES.includes(raw.category as EventCategory)) return { ok: false, reason: "category 無效" };
  const noChoice = opts.trusted === true && (!Array.isArray(raw.options) || raw.options.length === 0);
  if (!noChoice && (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 3)) return { ok: false, reason: "選項要 2–3 個" };

  const options: { id: string; label: string; effects: EffectSpec[]; score: number }[] = [];
  for (const [i, o] of ((noChoice ? [] : raw.options) as unknown[]).entries()) {
    if (!isObj(o)) return { ok: false, reason: "選項格式錯誤" };
    const label = typeof o.label === "string" ? tidy(o.label) : "";
    const bad = checkText(label, { min: 4, max: 30 });
    if (bad) return { ok: false, reason: `選項：${bad}` };
    const effects = (Array.isArray(o.effects) ? o.effects : [o.effect]).map(normalizeEffect);
    if (effects.length === 0 || effects.length > 2 || effects.some((e) => e === null)) return { ok: false, reason: "效果不在白名單內" };
    const list = effects as EffectSpec[];
    options.push({ id: `o${i + 1}`, label, effects: list, score: list.reduce((a, e) => a + effectScore(e), 0) });
  }
  // 沒有選項的事件（Overseer 的公告型事件）：效果直接套用
  let direct: EffectSpec[] = [];
  if (noChoice) {
    const list = (Array.isArray(raw.effects) ? raw.effects : []).map(normalizeEffect);
    if (list.length === 0 || list.length > 3 || list.some((e) => e === null)) return { ok: false, reason: "沒有選項的事件要有 1–3 個白名單內的效果" };
    direct = list as EffectSpec[];
  } else if (!opts.trusted) {
  // 不能有「全面碾壓」的選項（每項都不比別人差、且至少一項嚴格更好又沒有代價）：至少要有取捨
  const best = options.reduce((a, b) => (b.score > a.score ? b : a));
  const worst = options.reduce((a, b) => (b.score < a.score ? b : a));
  if (best.score - worst.score > 8) return { ok: false, reason: "選項差距太大（沒有取捨）" };
  if (options.every((o) => o.score > 0) || options.every((o) => o.score < 0)) return { ok: false, reason: "所有選項都只有好處或都只有壞處（沒有取捨）" };
  // 純花費、沒有任何回報的選項，旁邊卻有純好處的選項：前者永遠不會有人選，等於沒有選擇
  const pureCost = (o: { effects: EffectSpec[] }) => o.effects.every((e) => effectScore(e) <= 0) && o.effects.some((e) => effectScore(e) < 0);
  const pureGain = (o: { effects: EffectSpec[] }) => o.effects.every((e) => effectScore(e) >= 0) && o.effects.some((e) => effectScore(e) > 0);
  if (options.some(pureCost) && options.some(pureGain)) return { ok: false, reason: "有選項只有花費沒有回報，另一個卻只有好處（沒有取捨）" };
  }
  // 沒人處理時走最保守的：分數最接近 0 的選項
  const def = noChoice ? null : options.reduce((a, b) => (Math.abs(b.score) < Math.abs(a.score) ? b : a));
  const trusted = opts.trusted === true;
  const id = (trusted ? "ov_" : "ai_") + createHash("sha1").update(title + text).digest("hex").slice(0, 10);
  const weight = trusted && typeof raw.weight === "number" && Number.isFinite(raw.weight) ? clamp(raw.weight, 0, 3) : 0.8;
  const cooldownDays = trusted && typeof raw.cooldownDays === "number" && Number.isFinite(raw.cooldownDays) ? clamp(raw.cooldownDays, 1, 60) : 8;
  const deadlineHours = trusted && typeof raw.deadlineHours === "number" && Number.isFinite(raw.deadlineHours) ? clamp(raw.deadlineHours, 1, 72) : 24;
  const value: EventDef = {
    id,
    category: raw.category as EventCategory,
    title,
    text,
    weight,
    cooldownTicks: Math.round(288 * cooldownDays),
    attention: trusted && raw.attention === "pause" ? "pause" : "auto", // AI 事件永遠不會讓時鐘暫停；Overseer 的事件可以選
    effects: direct,
    ...(def ? { choice: { deadlineTicks: Math.round(12 * deadlineHours), defaultOption: def.id, options: options.map(({ id: oid, label, effects }) => ({ id: oid, label, effects })) } } : {}),
  };
  return { ok: true, value };
}

// ───────── 品牌名、原創商品名、新常客 ─────────
export const BRAND_GROUPS: CategoryGroup[] = ["food", "retail", "entertainment", "service"];
export interface BrandItem {
  group: CategoryGroup;
  /** 這個店名是替哪一種店取的（業態 id）：簡介會描述那種店，所以只能給同業態的候選品牌用 */
  category: string;
  name: string;
  blurb: string;
}
export interface DishItem {
  group: CategoryGroup;
  /** 這個名字是替哪一種店取的（業態 id） */
  category: string;
  name: string;
}

/** 名稱只收中日英數與少數符號，擋掉表情符號、標點洗版等 */
const NAME_RE = /^[\u3040-\u30ff\u3400-\u9fffA-Za-z0-9・·ー\- ]+$/;

export function checkBrand(raw: unknown): Checked<BrandItem> {
  if (!isObj(raw)) return { ok: false, reason: "格式錯誤" };
  const cat = typeof raw.category === "string" ? CATEGORY_BY_ID[raw.category] : undefined;
  if (!cat) return { ok: false, reason: "category 不是有效的業態" };
  const name = typeof raw.name === "string" ? tidy(raw.name) : "";
  const blurb = typeof raw.blurb === "string" ? tidy(raw.blurb) : "";
  const bn = checkText(name, { min: 2, max: 9 });
  if (bn) return { ok: false, reason: `品牌名：${bn}` };
  if (!NAME_RE.test(name)) return { ok: false, reason: "品牌名含不允許的符號" };
  const bb = checkText(blurb, { min: 8, max: 45 });
  if (bb) return { ok: false, reason: `簡介：${bb}` };
  return { ok: true, value: { group: cat.group, category: cat.id, name, blurb } };
}

export function checkDish(raw: unknown): Checked<DishItem> {
  if (!isObj(raw)) return { ok: false, reason: "格式錯誤" };
  const cat = typeof raw.category === "string" ? CATEGORY_BY_ID[raw.category] : undefined;
  if (!cat) return { ok: false, reason: "category 不是有效的業態" };
  const name = typeof raw.name === "string" ? tidy(raw.name) : "";
  const bad = checkText(name, { min: 3, max: 14 });
  if (bad) return { ok: false, reason: `名稱：${bad}` };
  if (!NAME_RE.test(name)) return { ok: false, reason: "名稱含不允許的符號" };
  return { ok: true, value: { group: cat.group, category: cat.id, name } };
}

/** 新常客：人設與故事由模型寫，獎勵數值一律由伺服器固定（模型沒有決定權） */
export function checkRegular(raw: unknown): Checked<RegularDef> {
  if (!isObj(raw)) return { ok: false, reason: "格式錯誤" };
  const name = typeof raw.name === "string" ? tidy(raw.name).replace(/\s+/g, "") : ""; // 「大和 結衣」→「大和結衣」，和手寫常客的寫法一致
  const bn = checkText(name, { min: 2, max: 8 });
  if (bn) return { ok: false, reason: `名字：${bn}` };
  if (!NAME_RE.test(name)) return { ok: false, reason: "名字含不允許的符號" };
  if (REGULARS.some((r) => r.name === name)) return { ok: false, reason: "名字和既有常客重複" };
  if (!PERSONAS.includes(raw.persona as PersonaId)) return { ok: false, reason: "persona 無效" };
  const fav = typeof raw.fav === "string" ? raw.fav : "";
  if (!CATEGORY_BY_ID[fav]) return { ok: false, reason: "fav 不是有效的業態" };
  // 第二選擇是選填的：模型編了不存在的 id 就直接丟掉，不必為此整個人物作廢
  const altRaw = typeof raw.alt === "string" && raw.alt !== fav && CATEGORY_BY_ID[raw.alt] ? raw.alt : undefined;
  const budget = typeof raw.budget === "number" && Number.isFinite(raw.budget) ? Math.round(clamp(raw.budget, 1, 1.6) * 100) / 100 : 1.25;
  const hint = typeof raw.hint === "string" ? tidy(raw.hint) : "";
  const bio = typeof raw.bio === "string" ? tidy(raw.bio) : "";
  const h = checkText(hint, { min: 10, max: 50 });
  if (h) return { ok: false, reason: `線索：${h}` };
  const b = checkText(bio, { min: 18, max: 90 });
  if (b) return { ok: false, reason: `簡介：${b}` };
  if (!Array.isArray(raw.traits) || raw.traits.length < 2 || raw.traits.length > 3) return { ok: false, reason: "特質要 2–3 個" };
  const traits: string[] = [];
  for (const x of raw.traits as unknown[]) {
    const tt = typeof x === "string" ? tidy(x) : "";
    const bad = checkText(tt, { min: 2, max: 26 });
    if (bad) return { ok: false, reason: `特質：${bad}` };
    traits.push(tt);
  }
  if (!Array.isArray(raw.stories) || raw.stories.length < 2) return { ok: false, reason: "故事至少要 2 段" };
  const rewards = [
    { at: 30, reward: { funds: 20_000, idx: 0.5 } },
    { at: 65, reward: { funds: 55_000, idx: 1 } },
  ];
  const stories: RegularDef["stories"] = [];
  for (const [i, x] of (raw.stories as unknown[]).slice(0, 2).entries()) { // 模型多寫了第三段就只取前兩段
    if (!isObj(x)) return { ok: false, reason: "故事格式錯誤" };
    const title = typeof x.title === "string" ? tidy(x.title) : "";
    const text = typeof x.text === "string" ? tidy(x.text) : "";
    const bt = checkText(title, { min: 2, max: 16 });
    if (bt) return { ok: false, reason: `故事標題：${bt}` };
    const bx = checkText(text, { min: 25, max: 110 });
    if (bx) return { ok: false, reason: `故事內文：${bx}` };
    stories.push({ title, text, ...rewards[i]! });
  }
  const id = "ai_" + createHash("sha1").update(name + bio).digest("hex").slice(0, 8);
  const value: RegularDef = { id, name, persona: raw.persona as PersonaId, fav, ...(altRaw ? { alt: altRaw } : {}), budget, hint, bio, traits, stories };
  return { ok: true, value };
}
