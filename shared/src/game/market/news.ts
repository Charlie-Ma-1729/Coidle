// 股市消息面：純函式（種子＋遊戲日＋標的 → 消息），不存檔、決定性。
//  - 消息來源：公司（自身消息、決算、傳聞→證實／否認、分析師評等）、板塊、全市場（macro）。
//  - 文案來自「內容庫」（AI 預先生成並審核過的 news.data.json）；庫裡沒有符合條件的文案時退回內建短句。
//  - 條件式觸發：文案可限定板塊／月份／季節／日曆（連休、黃金週…）／天氣；符合當天條件的文案權重較高，
//    當天有明顯日曆或天氣條件時，板塊與全市場消息的機率也略升。只用「已發生」的日曆與天氣，不偷看未來。
//  - 期望值守則：所有跳動的方向五五波、幅度對稱；傳聞→證實／否認是 martingale
//    （傳聞時先反映 q·R，證實機率 q 時再補 (1−q)·R，否認時回吐 q·R），看標題買賣沒有期望獲利。
import { calendarDay } from "../calendar";
import { dayWeather } from "../weather";
import { rnd, strHash } from "./rng";
import { STOCK_GROUPS, type StockGroup } from "./stocks";

// ───────── 內容庫格式 ─────────

export type NewsKind = "company" | "sector" | "macro" | "analyst" | "rumor" | "wrap" | "preopen";
export type NewsSentiment = "pos" | "neg" | "neutral";

export interface NewsWhen {
  sectors?: string[];
  months?: number[];
  seasons?: string[];
  calendar?: string[];
  weather?: string[];
  earnings?: boolean;
  mood?: "up" | "down" | "flat";
}

export interface NewsPoolItem {
  id: string;
  kind: NewsKind;
  archetype: string;
  sentiment: NewsSentiment;
  mag: 1 | 2 | 3;
  headline: string;
  body: string;
  when?: NewsWhen;
  /** 傳聞與證實／否認互相指向 */
  pair?: string;
  weight: number;
}

// ───────── 給畫面與引擎的消息 ─────────

export type NewsScope = "stock" | "sector" | "macro";

export interface MarketNews {
  /** 穩定且唯一：scope|鍵|遊戲日|序 */
  id: string;
  scope: NewsScope;
  /** 標的鍵（stock）、板塊名（sector）、null（macro） */
  target: string | null;
  day: number;
  /** 發生在一天中的第幾步（0..239） */
  stepOfDay: number;
  /** 對受影響標的的價格跳動（%）；macro 實際套用時乘上各檔 beta */
  pct: number;
  headline: string;
  body: string;
  sentiment: NewsSentiment;
  mag: number;
  archetype: string;
  poolId: string | null;
  /** 傳聞／證實／否認 */
  phase: "rumor" | "confirm" | "deny" | null;
}

export interface AppliedNews {
  news: MarketNews;
  /** 實際對這檔的價格跳動（%） */
  pct: number;
}

interface DayCtx {
  month: number;
  tags: string[];
  weather: string;
  temp: number;
  /** 有明顯日曆／天氣條件（用來略微提高板塊與全市場消息的機率） */
  notable: boolean;
}

const SEASON_MONTHS: Record<string, number[]> = {
  spring: [3, 4, 5],
  summer: [7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
  rainy: [6, 7],
  typhoon: [8, 9, 10],
};

const ctxCache = new Map<number, DayCtx>();
function dayCtx(day: number): DayCtx {
  const hit = ctxCache.get(day);
  if (hit) return hit;
  const c = calendarDay(day);
  const w = dayWeather(day);
  const tags = [...(c.tags as string[]), ...c.observances.map((o) => o.id)];
  const weather = String(w.kind);
  const notable = c.offDay && c.streak !== null || weather === "storm" || weather === "rain" || w.temp >= 32 || w.temp <= 4 || c.tags.includes("payday");
  const v: DayCtx = { month: c.m, tags, weather, temp: w.temp, notable };
  if (ctxCache.size > 5000) ctxCache.clear();
  ctxCache.set(day, v);
  return v;
}

/** 這則文案的條件（when）符合今天嗎；回傳 null＝不符、否則為權重倍率（有條件且符合＝3 倍、通用＝1 倍） */
function whenScore(w: NewsWhen | undefined, g: StockGroup | null, ctx: DayCtx, earnings: boolean): number | null {
  if (!w) return 1;
  let specific = 0;
  if (w.sectors?.length) {
    if (!g || !w.sectors.includes(g.sector)) return null;
    specific++;
  }
  if (w.months?.length) {
    if (!w.months.includes(ctx.month)) return null;
    specific++;
  }
  if (w.seasons?.length) {
    if (!w.seasons.some((s) => SEASON_MONTHS[s]?.includes(ctx.month))) return null;
    specific++;
  }
  if (w.calendar?.length) {
    if (!w.calendar.some((t) => ctx.tags.includes(t))) return null;
    specific++;
  }
  if (w.weather?.length) {
    const hot = ctx.temp >= 32 ? ["hot", "heat", "heatwave"] : [];
    const cold = ctx.temp <= 4 ? ["cold", "coldwave"] : [];
    if (!w.weather.some((t) => t === ctx.weather || hot.includes(t) || cold.includes(t))) return null;
    specific++;
  }
  if (w.earnings !== undefined && w.earnings !== earnings) return null;
  if (w.earnings) specific++;
  return specific > 0 ? 3 : 1;
}

// ───────── 內建短句（內容庫沒有符合的文案時） ─────────
const FALLBACK_GOOD = ["發表亮眼的季報", "上調本年度獲利預測", "新事業傳出好消息", "獲得大型合約", "宣布成本大幅下降"];
const FALLBACK_BAD = ["季報不如預期", "傳出設備故障與停工", "被調降投資評等", "新產品推出延期", "原料漲價侵蝕獲利"];
const FALLBACK_SECTOR_GOOD = ["業界傳出訂單回溫", "景氣指標轉佳"];
const FALLBACK_SECTOR_BAD = ["業界傳出訂單縮減", "原料成本上升壓縮利潤"];
const FALLBACK_MACRO_GOOD = ["央行維持寬鬆、市場情緒轉佳", "景氣指標優於預期"];
const FALLBACK_MACRO_BAD = ["海外市場動盪、投資人轉趨保守", "景氣指標不如預期"];

// ───────── 機率與幅度 ─────────
const P_STOCK = 1 / 60;
const P_ANALYST = 1 / 45;
const P_RUMOR = 1 / 220;
const P_SECTOR = 1 / 45;
const P_MACRO = 1 / 8;
/** 當天有明顯日曆／天氣條件時，板塊與全市場消息的機率倍率 */
const NOTABLE_BOOST = 1.4;
const MAG_WEIGHTS: [1 | 2 | 3, number][] = [
  [1, 0.55],
  [2, 0.33],
  [3, 0.12],
];
const MAG_BAND: Record<number, [number, number]> = { 1: [1.2, 3], 2: [3, 6], 3: [6, 12] };

const SALT = { stock: 110, sign: 111, mag: 112, size: 113, time: 114, pick: 115, rumor: 120, delay: 126, confirm: 127, analyst: 130, sector: 140, macro: 150, earn: 160 };

function pickMag(r: number, scale = 1): 1 | 2 | 3 {
  let acc = 0;
  for (const [m, w] of MAG_WEIGHTS) {
    acc += w;
    if (r < acc) return m;
  }
  void scale;
  return 1;
}

const sizeOf = (mag: number, r: number, scale = 1): number => {
  const [lo, hi] = MAG_BAND[mag] ?? MAG_BAND[1]!;
  return Math.round((lo + (hi - lo) * r) * scale * 10) / 10;
};

const normSector = (s: string): string => s.replace(/（.*?）|\(.*?\)/g, "");

export const SECTORS: string[] = [...new Set(STOCK_GROUPS.map((g) => g.sector))];

/** 消息引擎：內容庫可替換（測試用空庫、正式用 poolNews.ts 的庫） */
export class NewsEngine {
  private readonly byKind = new Map<NewsKind, NewsPoolItem[]>();
  private readonly byId = new Map<string, NewsPoolItem>();

  constructor(pool: NewsPoolItem[] = []) {
    for (const raw of pool) {
      const it: NewsPoolItem = raw.when?.sectors ? { ...raw, when: { ...raw.when, sectors: raw.when.sectors.map(normSector) } } : raw;
      const list = this.byKind.get(it.kind) ?? [];
      list.push(it);
      this.byKind.set(it.kind, list);
      this.byId.set(it.id, it);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  /** 從庫裡挑一則：先過濾條件，再依權重（符合特定條件者 3 倍）以 r 抽選；沒有就放寬幅度、再沒有回傳 null */
  private pick(kind: NewsKind, sentiment: NewsSentiment, mag: number, g: StockGroup | null, ctx: DayCtx, r: number, opts: { earnings?: boolean; prefer?: RegExp; pair?: string; only?: RegExp } = {}): NewsPoolItem | null {
    const list = this.byKind.get(kind);
    if (!list || list.length === 0) return null;
    for (const strictMag of [true, false]) {
      let total = 0;
      const cands: [NewsPoolItem, number][] = [];
      for (const it of list) {
        if (it.sentiment !== sentiment) continue;
        if (strictMag && it.mag !== mag) continue;
        if (opts.pair !== undefined && it.pair !== opts.pair && it.id !== opts.pair) continue;
        if (opts.only && !opts.only.test(it.archetype)) continue;
        const s = whenScore(it.when, g, ctx, opts.earnings ?? false);
        if (s === null) continue;
        let w = Math.max(0.01, it.weight) * s;
        if (opts.prefer && opts.prefer.test(it.archetype)) w *= 4;
        cands.push([it, w]);
        total += w;
      }
      if (cands.length === 0) continue;
      let t = r * total;
      for (const [it, w] of cands) {
        t -= w;
        if (t < 0) return it;
      }
      return cands[cands.length - 1]![0];
    }
    return null;
  }

  private fill(text: string, g: StockGroup | null, sector: string | null, peerSeed: number): string {
    const peers = g ? STOCK_GROUPS.filter((x) => x.sector === g.sector && x.key !== g.key) : [];
    const any = STOCK_GROUPS.filter((x) => x.key !== g?.key);
    const peer = (peers.length ? peers : any)[Math.floor(peerSeed * (peers.length ? peers : any).length)]!;
    return text
      .replace(/\{name\}/g, g?.name ?? "")
      .replace(/\{peer\}/g, peer.name)
      .replace(/\{sector\}/g, g?.sector ?? sector ?? "");
  }

  /** 一個「消息事件」的共用組裝：決定語氣與幅度、挑文案 */
  private make(opts: {
    seed: number;
    id: string;
    scope: NewsScope;
    target: string | null;
    day: number;
    stepOfDay: number;
    kind: NewsKind;
    g: StockGroup | null;
    sector: string | null;
    key: number;
    sentiment: NewsSentiment;
    mag: 1 | 2 | 3;
    pctAbs: number;
    fallback: string[];
    earnings?: boolean;
    prefer?: RegExp;
    /** 只從 archetype 符合的文案挑（傳聞起始／證實／否認各用各的） */
    only?: RegExp;
    phase?: MarketNews["phase"];
    pair?: string;
    pickR?: number;
  }): MarketNews {
    const ctx = dayCtx(opts.day);
    const pickR = opts.pickR ?? rnd(opts.seed, opts.key, opts.day, SALT.pick);
    const base = { earnings: opts.earnings, prefer: opts.prefer, only: opts.only };
    const item =
      (opts.pair !== undefined ? this.pick(opts.kind, opts.sentiment, opts.mag, opts.g, ctx, pickR, { ...base, pair: opts.pair }) : null) ?? this.pick(opts.kind, opts.sentiment, opts.mag, opts.g, ctx, pickR, base);
    const sign = opts.sentiment === "neg" ? -1 : 1;
    const peerSeed = rnd(opts.seed, opts.key, opts.day, SALT.pick + 7);
    if (item) {
      return {
        id: opts.id,
        scope: opts.scope,
        target: opts.target,
        day: opts.day,
        stepOfDay: opts.stepOfDay,
        pct: sign * opts.pctAbs,
        headline: this.fill(item.headline, opts.g, opts.sector, peerSeed),
        body: this.fill(item.body, opts.g, opts.sector, peerSeed),
        sentiment: opts.sentiment,
        mag: opts.mag,
        archetype: item.archetype,
        poolId: item.id,
        phase: opts.phase ?? null,
      };
    }
    const phrase = opts.fallback[Math.floor(pickR * opts.fallback.length)]!;
    const subject = opts.g ? opts.g.name : opts.sector ? `${opts.sector}業界` : "市場";
    return {
      id: opts.id,
      scope: opts.scope,
      target: opts.target,
      day: opts.day,
      stepOfDay: opts.stepOfDay,
      pct: sign * opts.pctAbs,
      headline: opts.scope === "macro" ? phrase : opts.scope === "sector" ? `${subject}${phrase.replace(/^業界/, "")}` : `${subject}${phrase}`,
      body: "",
      sentiment: opts.sentiment,
      mag: opts.mag,
      archetype: "fallback",
      poolId: null,
      phase: opts.phase ?? null,
    };
  }

  /** 這檔標的自己的消息（含決算、分析師、傳聞→證實／否認） */
  stockNewsOnDay(seed: number, g: StockGroup, day: number): MarketNews[] {
    const out: MarketNews[] = [];
    const gh = strHash(g.key);
    const t0 = (salt: number) => 60 + Math.floor(rnd(seed, gh, day, salt) * 140); // 6:00–19:20
    // 自身消息
    if (rnd(seed, gh, day, SALT.stock) < P_STOCK) {
      const mag = pickMag(rnd(seed, gh, day, SALT.mag));
      const up = rnd(seed, gh, day, SALT.sign) < 0.5;
      out.push(
        this.make({ seed, id: `stock|${g.key}|${day}|0`, scope: "stock", target: g.key, day, stepOfDay: t0(SALT.time), kind: "company", g, sector: g.sector, key: gh, sentiment: up ? "pos" : "neg", mag, pctAbs: sizeOf(mag, rnd(seed, gh, day, SALT.size)), fallback: up ? FALLBACK_GOOD : FALLBACK_BAD }),
      );
    }
    // 分析師評等：多數是小幅調升／調降（依強度 1–3，幅度減半）；約 15% 只是「維持評等」之類的中性評論（沒有價格效果）
    if (rnd(seed, gh, day, SALT.analyst) < P_ANALYST) {
      const r = rnd(seed, gh, day, SALT.analyst + 1);
      const neutral = r < 0.15;
      const up = r >= 0.575;
      const mag = neutral ? 1 : pickMag(rnd(seed, gh, day, SALT.analyst + 4));
      out.push(
        this.make({
          seed,
          id: `stock|${g.key}|${day}|a`,
          scope: "stock",
          target: g.key,
          day,
          stepOfDay: t0(SALT.analyst + 2),
          kind: "analyst",
          g,
          sector: g.sector,
          key: gh + 1,
          sentiment: neutral ? "neutral" : up ? "pos" : "neg",
          mag,
          pctAbs: neutral ? 0 : sizeOf(mag, rnd(seed, gh, day, SALT.analyst + 3), 0.5),
          fallback: neutral ? ["維持投資評等"] : up ? ["被調升投資評等"] : ["被調降投資評等"],
        }),
      );
    }
    // 決算：公開日曆（每季一次，結算月後兩個月的 8–22 日，收盤後公告）；驚喜方向五五波
    const cd = calendarDay(day);
    const y = cd.y; // 讓每年的決算日不同
    for (let q = 0; q < 4; q++) {
      const qend = ((g.fiscalMonth - 1 + 3 * q) % 12) + 1;
      const am = ((qend - 1 + 2) % 12) + 1;
      if (am !== cd.m) continue;
      const dom = 8 + Math.floor(rnd(seed, gh, y * 12 + am, SALT.earn) * 15);
      if (cd.d !== dom) continue;
      const mag = pickMag(rnd(seed, gh, day, SALT.earn + 1));
      const up = rnd(seed, gh, day, SALT.earn + 2) < 0.5;
      out.push(
        this.make({ seed, id: `stock|${g.key}|${day}|e`, scope: "stock", target: g.key, day, stepOfDay: 160 + Math.floor(rnd(seed, gh, day, SALT.earn + 3) * 16), kind: "company", g, sector: g.sector, key: gh + 2, sentiment: up ? "pos" : "neg", mag, pctAbs: sizeOf(mag, rnd(seed, gh, day, SALT.earn + 4), 1.1), fallback: up ? ["發表亮眼的季報"] : ["季報不如預期"], earnings: true, prefer: /earn|決算|result|財報|季報/i }),
      );
      break;
    }
    // 傳聞：先反映 q·R；delay 天後以機率 q 證實（補 (1−q)·R）、否則否認（回吐 q·R）
    const rumorOf = (d0: number) => rnd(seed, gh, d0, SALT.rumor) < P_RUMOR;
    if (rumorOf(day)) {
      const { R, q, up, mag } = this.rumorParams(seed, gh, day);
      out.push(
        this.make({ seed, id: `stock|${g.key}|${day}|r`, scope: "stock", target: g.key, day, stepOfDay: t0(SALT.rumor + 1), kind: "rumor", g, sector: g.sector, key: gh + 3, sentiment: up ? "pos" : "neg", mag, pctAbs: Math.round(R * q * 10) / 10, fallback: up ? ["傳出可能獲得大型合約的消息"] : ["傳出可能下修財測的消息"], phase: "rumor", only: /^rumor/i }),
      );
    }
    for (let d0 = day - 7; d0 <= day - 2; d0++) {
      if (!rumorOf(d0)) continue;
      const delay = 2 + Math.floor(rnd(seed, gh, d0, SALT.delay) * 6);
      if (d0 + delay !== day) continue;
      const { R, q, up, mag } = this.rumorParams(seed, gh, d0);
      const confirm = rnd(seed, gh, d0, SALT.confirm) < q;
      const firstId = `stock|${g.key}|${d0}|r`;
      const first = this.make({ seed, id: firstId, scope: "stock", target: g.key, day: d0, stepOfDay: 0, kind: "rumor", g, sector: g.sector, key: gh + 3, sentiment: up ? "pos" : "neg", mag, pctAbs: Math.round(R * q * 10) / 10, fallback: ["傳聞"], phase: "rumor", only: /^rumor/i });
      const extra = confirm ? R * (1 - q) : -R * q; // 以「方向為正」計
      const sentiment: NewsSentiment = (extra >= 0) === up ? "pos" : "neg";
      const m = this.make({
        seed,
        id: `stock|${g.key}|${day}|c`,
        scope: "stock",
        target: g.key,
        day,
        stepOfDay: t0(SALT.confirm + 1),
        kind: "rumor",
        g,
        sector: g.sector,
        key: gh + 4,
        sentiment,
        mag,
        pctAbs: Math.round(Math.abs(extra) * 10) / 10,
        fallback: confirm ? (up ? ["傳聞獲得證實，公司正式發表"] : ["先前的疑慮獲得證實"]) : up ? ["公司否認先前的傳聞"] : ["先前的疑慮獲公司澄清"],
        phase: confirm ? "confirm" : "deny",
        only: confirm ? /^confirm/i : /^deny/i,
        pair: first.poolId ?? undefined,
      });
      out.push(m);
    }
    return out;
  }

  private rumorParams(seed: number, gh: number, d0: number): { R: number; q: number; up: boolean; mag: 1 | 2 | 3 } {
    const mag = pickMag(rnd(seed, gh, d0, SALT.rumor + 2));
    return {
      R: sizeOf(mag, rnd(seed, gh, d0, SALT.rumor + 3), 1.4),
      q: 0.3 + rnd(seed, gh, d0, SALT.rumor + 4) * 0.4,
      up: rnd(seed, gh, d0, SALT.rumor + 5) < 0.5,
      mag,
    };
  }

  /** 板塊消息：同板塊的標的一起跳動 */
  sectorNewsOnDay(seed: number, sector: string, day: number): MarketNews | null {
    const sh = strHash(`s:${sector}`);
    const boost = dayCtx(day).notable ? NOTABLE_BOOST : 1;
    if (rnd(seed, sh, day, SALT.sector) >= P_SECTOR * boost) return null;
    const mag = pickMag(rnd(seed, sh, day, SALT.sector + 1));
    const up = rnd(seed, sh, day, SALT.sector + 2) < 0.5;
    const g = STOCK_GROUPS.find((x) => x.sector === sector) ?? null;
    return this.make({
      seed,
      id: `sector|${sector}|${day}|0`,
      scope: "sector",
      target: sector,
      day,
      stepOfDay: 60 + Math.floor(rnd(seed, sh, day, SALT.sector + 3) * 140),
      kind: "sector",
      g: g ? { ...g, name: "" } : null,
      sector,
      key: sh,
      sentiment: up ? "pos" : "neg",
      mag,
      pctAbs: sizeOf(mag, rnd(seed, sh, day, SALT.sector + 4), 0.45),
      fallback: up ? FALLBACK_SECTOR_GOOD : FALLBACK_SECTOR_BAD,
    });
  }

  /** 全市場消息：各檔依 beta 跳動 */
  macroNewsOnDay(seed: number, day: number): MarketNews | null {
    const boost = dayCtx(day).notable ? NOTABLE_BOOST : 1;
    if (rnd(seed, 7, day, SALT.macro) >= P_MACRO * boost) return null;
    const mag = pickMag(rnd(seed, 7, day, SALT.macro + 1));
    const up = rnd(seed, 7, day, SALT.macro + 2) < 0.5;
    return this.make({
      seed,
      id: `macro||${day}|0`,
      scope: "macro",
      target: null,
      day,
      stepOfDay: 60 + Math.floor(rnd(seed, 7, day, SALT.macro + 3) * 140),
      kind: "macro",
      g: null,
      sector: null,
      key: 7,
      sentiment: up ? "pos" : "neg",
      mag,
      pctAbs: sizeOf(mag, rnd(seed, 7, day, SALT.macro + 4), 0.28),
      fallback: up ? FALLBACK_MACRO_GOOD : FALLBACK_MACRO_BAD,
    });
  }

  /** 對這檔標的有影響的消息（自身、板塊、全市場），pct 為實際套用幅度 */
  eventsFor(seed: number, g: StockGroup, day: number): AppliedNews[] {
    const out: AppliedNews[] = [];
    for (const n of this.stockNewsOnDay(seed, g, day)) out.push({ news: n, pct: n.pct });
    const s = this.sectorNewsOnDay(seed, g.sector, day);
    if (s) out.push({ news: s, pct: s.pct });
    const m = this.macroNewsOnDay(seed, day);
    if (m) out.push({ news: m, pct: Math.round(m.pct * g.beta * 100) / 100 });
    return out;
  }

  /** 收盤市況評語（依指數當日漲跌；內容庫 wrap 類，沒有就用內建句） */
  wrapOf(seed: number, day: number, changePct: number): { headline: string; body: string } {
    const mood = changePct > 0.4 ? "up" : changePct < -0.4 ? "down" : "flat";
    const list = (this.byKind.get("wrap") ?? []).filter((it) => it.when?.mood === mood || !it.when?.mood);
    const matched = list.filter((it) => it.when?.mood === mood);
    const use = matched.length ? matched : list;
    if (use.length === 0) {
      const head = mood === "up" ? "大盤收高" : mood === "down" ? "大盤收低" : "大盤小幅震盪收平";
      return { headline: head, body: "" };
    }
    const it = use[Math.floor(rnd(seed, 9, day, 170) * use.length)]!;
    return { headline: it.headline.replace(/\{[a-z]+\}/g, ""), body: it.body.replace(/\{[a-z]+\}/g, "") };
  }
}

/** 只有內建短句的消息引擎（測試與內容庫缺席時） */
export const FALLBACK_NEWS = new NewsEngine([]);
