import { createHash } from "node:crypto";
import type { EffectSpec, EventCategory, EventDef, PersonaId } from "@coidle/shared";
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

export function checkEvent(raw: unknown): Checked<EventDef> {
  if (!isObj(raw)) return { ok: false, reason: "格式錯誤" };
  const title = typeof raw.title === "string" ? tidy(raw.title) : "";
  const text = typeof raw.text === "string" ? tidy(raw.text) : "";
  const t1 = checkText(title, { min: 3, max: 18 });
  if (t1) return { ok: false, reason: `標題：${t1}` };
  const t2 = checkText(text, { min: 20, max: 130 });
  if (t2) return { ok: false, reason: `描述：${t2}` };
  if (!CATEGORIES.includes(raw.category as EventCategory)) return { ok: false, reason: "category 無效" };
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 3) return { ok: false, reason: "選項要 2–3 個" };

  const options: { id: string; label: string; effects: EffectSpec[]; score: number }[] = [];
  for (const [i, o] of (raw.options as unknown[]).entries()) {
    if (!isObj(o)) return { ok: false, reason: "選項格式錯誤" };
    const label = typeof o.label === "string" ? tidy(o.label) : "";
    const bad = checkText(label, { min: 4, max: 30 });
    if (bad) return { ok: false, reason: `選項：${bad}` };
    const effects = (Array.isArray(o.effects) ? o.effects : [o.effect]).map(normalizeEffect);
    if (effects.length === 0 || effects.length > 2 || effects.some((e) => e === null)) return { ok: false, reason: "效果不在白名單內" };
    const list = effects as EffectSpec[];
    options.push({ id: `o${i + 1}`, label, effects: list, score: list.reduce((a, e) => a + effectScore(e), 0) });
  }
  // 不能有「全面碾壓」的選項（每項都不比別人差、且至少一項嚴格更好又沒有代價）：至少要有取捨
  const best = options.reduce((a, b) => (b.score > a.score ? b : a));
  const worst = options.reduce((a, b) => (b.score < a.score ? b : a));
  if (best.score - worst.score > 8) return { ok: false, reason: "選項差距太大（沒有取捨）" };
  if (options.every((o) => o.score > 0) || options.every((o) => o.score < 0)) return { ok: false, reason: "所有選項都只有好處或都只有壞處（沒有取捨）" };
  // 沒人處理時走最保守的：分數最接近 0 的選項
  const def = options.reduce((a, b) => (Math.abs(b.score) < Math.abs(a.score) ? b : a));
  const id = "ai_" + createHash("sha1").update(title + text).digest("hex").slice(0, 10);
  const value: EventDef = {
    id,
    category: raw.category as EventCategory,
    title,
    text,
    weight: 0.8,
    cooldownTicks: 288 * 8,
    attention: "auto", // AI 事件永遠不會讓時鐘暫停
    effects: [],
    choice: { deadlineTicks: 288, defaultOption: def.id, options: options.map(({ id: oid, label, effects }) => ({ id: oid, label, effects })) },
  };
  return { ok: true, value };
}
