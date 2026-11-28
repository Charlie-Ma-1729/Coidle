// 股價引擎 v2：只在開市步計算，結果只取決於 (種子, 伺服器時鐘, 切換時間)，純函式、決定性。
//  - 一個交易日＝開盤跳空（含休市期間累積的消息與配息除權）→ 110 個價格步（3 遊戲分鐘＝30 真實秒）→ 收盤；
//  - 每遊戲日總變異與 v1 相當：盤中 80%、開盤跳空 20%（休市越久跳空越大）；
//  - 制限值幅：相對前日收盤 ±15%（ストップ高／安）；
//  - 優化：不存每個點。每個交易日只存 OHLC 與收盤的隨機遊走偏離（xClose），盤中價格用小型 LRU 快取、
//    被擠出後從前一日的 xClose 決定性重算；每個交易日只算一次（日 OHLC 過了就不會變）。
import { dayOfYmd, ymdOfDay } from "../calendar";
import { DEFAULT_SERVER_CLOCK, type ServerClock } from "../time";
import { MARKET_MIN_PRICE } from "../market";
import {
  AM_END,
  AM_OPEN,
  AM_STEPS,
  PM_END,
  PM_OPEN,
  TRADING_STEPS_PER_DAY,
  dayOfGstep,
  gstepAt,
  gstepOf,
  isTradingDay,
  lastOpenGstep,
  openOrdinal,
  realMsOfGstep,
  stepOfDayOf,
  stepOfOrdinal,
  tradingDayAt,
  tradingDayBefore,
  tradingDayIndex,
  tradingDayOnOrAfter,
} from "./exchange";
import { FALLBACK_NEWS, SECTORS, type AppliedNews, type MarketNews, type NewsEngine } from "./news";
import { gauss, strHash } from "./rng";
import { signalLevel } from "./signals";
import { STOCK_GROUPS, dividendPerShare, stockGroupOf, type StockGroup } from "./stocks";

/** 制限值幅（相對前日收盤） */
export const PRICE_LIMIT = 0.15;
const X_LIMIT = 0.8;
/** 大盤與個股的「每遊戲日」波動：v1 每真實小時 σ 的 2 倍（一個遊戲日＝4 真實小時） */
const DAY_FACTOR = 2;
const MARKET_SIGMA_H = 0.0022;
/** 盤中占每日變異的比例（其餘是開盤跳空） */
const INTRADAY_SHARE = 0.8;
/** 均值回歸：半衰期約 30 真實天 ≈ 122 個交易日 */
const KAPPA_STEP = Math.LN2 / (122 * TRADING_STEPS_PER_DAY);
/** 盤中價格快取：最多保留幾個「標的×交易日」 */
const INTRADAY_CACHE_MAX = 40 * 45;

/** 指數基準 */
export const DW40_BASE = 10_000;
export const DWPIX_BASE = 1_000;
const SUM_BASE = STOCK_GROUPS.reduce((a, g) => a + g.base, 0);
const SUM_CAP_BASE = STOCK_GROUPS.reduce((a, g) => a + g.base * g.shares, 0);

/** 價格加權指數（仿日經平均）：各檔價格和 ÷ 基準價格和 × 10000 */
export const dw40 = (prices: number[]): number => (DW40_BASE * prices.reduce((a, p) => a + p, 0)) / SUM_BASE;
/** 市值加權指數（仿 TOPIX）：各檔市值和 ÷ 基準市值和 × 1000 */
export const dwpix = (prices: number[]): number => (DWPIX_BASE * prices.reduce((a, p, i) => a + p * STOCK_GROUPS[i]!.shares, 0)) / SUM_CAP_BASE;

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 這一天是不是這檔的除權息日（配息月的下個月第一個交易日開盤） */
export function isExDividendDay(g: StockGroup, day: number): boolean {
  if (g.divYield <= 0 || dividendPerShare(g) <= 0 || !isTradingDay(day)) return false;
  const prev = tradingDayBefore(day);
  if (prev === null) return false;
  const m = ymdOfDay(day).m;
  if (ymdOfDay(prev).m === m) return false; // 不是當月第一個交易日
  const m1 = g.fiscalMonth;
  const m2 = ((g.fiscalMonth + 5) % 12) + 1;
  const prevMonth = m === 1 ? 12 : m - 1;
  return prevMonth === m1 || prevMonth === m2;
}

export interface EngineOptions {
  /** v2 價格序列的起點（真實時間）；之前的歷史由 v1 引擎提供 */
  startRealMs: number;
  /** 接續 v1：切換點的隨機遊走偏離與價格（只有既有 16 檔） */
  handoff?: (key: string) => { x: number; price: number } | null;
  news?: NewsEngine;
}

interface StockState {
  g: StockGroup;
  gh: number;
  xClose: number[];
  candles: Candle[];
}

export class PriceEngineV2 {
  /** v2 序列的第一個交易日（遊戲日序） */
  readonly startDay: number;
  private readonly startIdx: number;
  private readonly news: NewsEngine;
  private readonly st = new Map<string, StockState>();
  private computed = 0; // 已算到第幾個交易日（相對 startIdx）
  private readonly intraday = new Map<string, Int32Array>();
  private readonly handoffs = new Map<string, { x: number; price: number }>();

  constructor(
    readonly seed: number,
    readonly clock: ServerClock = DEFAULT_SERVER_CLOCK,
    readonly opts: EngineOptions,
  ) {
    this.news = opts.news ?? FALLBACK_NEWS;
    const g0 = gstepAt(opts.startRealMs, clock);
    const d0 = dayOfGstep(g0);
    // 切換發生在開市期間或之後：從下一個交易日開始，避免當天價格半途跳動
    const afterOpen = isTradingDay(d0) && stepOfDayOf(g0) >= AM_OPEN;
    this.startDay = tradingDayOnOrAfter(afterOpen ? d0 + 1 : d0);
    this.startIdx = tradingDayIndex(this.startDay);
    for (const g of STOCK_GROUPS) {
      this.st.set(g.key, { g, gh: strHash(g.key), xClose: [], candles: [] });
      const h = opts.handoff?.(g.key);
      if (h) this.handoffs.set(g.key, h);
    }
  }

  /** 第一個交易日的開盤前價格（接續 v1，或新上市標的的基準價） */
  private startPrice(g: StockGroup): number {
    return this.handoffs.get(g.key)?.price ?? g.base;
  }

  private startX(g: StockGroup): number {
    return this.handoffs.get(g.key)?.x ?? 0;
  }

  // ───────── 單檔單日模擬 ─────────

  private simulate(s: StockState, i: number): { prices: Int32Array; xClose: number } {
    const D = tradingDayAt(this.startIdx + i);
    const g = s.g;
    const gi = this.startIdx + i; // 全域交易日序（雜湊用）
    const Dprev = i === 0 ? null : tradingDayAt(this.startIdx + i - 1);
    const xPrev = i === 0 ? this.startX(g) : s.xClose[i - 1]!;
    const prevClose = i === 0 ? this.startPrice(g) : s.candles[i - 1]!.close;
    const level = signalLevel(g.signals, D);

    // 這個交易日累積的消息跳動（休市期間的消息併入開盤）
    const jumps = new Float64Array(TRADING_STEPS_PER_DAY);
    const startScan = Dprev ?? D;
    for (let d = startScan; d <= D; d++) {
      for (const a of this.news.eventsFor(this.seed, g, d)) {
        const k = effectiveOrdinal(a, d, D, Dprev);
        if (k >= 0) jumps[k] = (jumps[k] ?? 0) + Math.log(1 + a.pct / 100);
      }
    }

    const sigD = g.sigma * DAY_FACTOR;
    const mktD = MARKET_SIGMA_H * DAY_FACTOR;
    const sigStep = (sigD * Math.sqrt(INTRADAY_SHARE)) / Math.sqrt(TRADING_STEPS_PER_DAY - 1);
    const mktStep = (mktD * Math.sqrt(INTRADAY_SHARE)) / Math.sqrt(TRADING_STEPS_PER_DAY - 1);
    const closedDays = Dprev === null ? 0 : D - Dprev - 1;
    const gapScale = Math.sqrt(1 + 0.5 * closedDays);
    const gapOwn = sigD * Math.sqrt(1 - INTRADAY_SHARE) * gapScale;
    const gapMkt = mktD * Math.sqrt(1 - INTRADAY_SHARE) * gapScale;

    const lo = Math.max(MARKET_MIN_PRICE, Math.ceil(prevClose * (1 - PRICE_LIMIT)));
    const hi = Math.max(lo, Math.floor(prevClose * (1 + PRICE_LIMIT)));
    const prices = new Int32Array(TRADING_STEPS_PER_DAY);

    let x = xPrev;
    // 開盤跳空：大盤＋個股＋休市期間的消息＋除權息
    x += g.beta * gapMkt * gauss(this.seed, 0, gi, 12) + gapOwn * gauss(this.seed, s.gh, gi, 22) + jumps[0]!;
    if (isExDividendDay(g, D)) x += Math.log(Math.max(0.5, 1 - dividendPerShare(g) / Math.max(1, prevClose)));
    for (let k = 0; k < TRADING_STEPS_PER_DAY; k++) {
      if (k > 0) {
        x = x * (1 - KAPPA_STEP) + g.beta * mktStep * gauss(this.seed, 0, gi * 128 + k, 10) + sigStep * gauss(this.seed, s.gh, gi * 128 + k, 20) + jumps[k]!;
      } else {
        x = x * (1 - KAPPA_STEP);
      }
      x = Math.max(-X_LIMIT, Math.min(X_LIMIT, x));
      let p = Math.max(MARKET_MIN_PRICE, Math.round(g.base * Math.exp(x + level)));
      if (p < lo || p > hi) {
        p = p < lo ? lo : hi;
        x = Math.log(p / g.base) - level; // 讓隨機遊走狀態與被夾限的價格一致
      }
      prices[k] = p;
    }
    return { prices, xClose: x };
  }

  private cacheKey(key: string, i: number): string {
    return `${key}|${i}`;
  }

  private remember(key: string, i: number, prices: Int32Array): void {
    this.intraday.set(this.cacheKey(key, i), prices);
    if (this.intraday.size > INTRADAY_CACHE_MAX) {
      const first = this.intraday.keys().next().value;
      if (first !== undefined) this.intraday.delete(first);
    }
  }

  /** 算到第 i 個交易日（相對起點）為止 */
  private ensure(i: number): void {
    if (i > 40_000) throw new Error("market horizon too far");
    while (this.computed <= i) {
      const n = this.computed;
      for (const s of this.st.values()) {
        const { prices, xClose } = this.simulate(s, n);
        s.xClose.push(xClose);
        let hi = 0;
        let lo = Number.MAX_SAFE_INTEGER;
        for (const p of prices) {
          if (p > hi) hi = p;
          if (p < lo) lo = p;
        }
        s.candles.push({ open: prices[0]!, high: hi, low: lo, close: prices[TRADING_STEPS_PER_DAY - 1]! });
        this.remember(s.g.key, n, prices);
      }
      this.computed++;
    }
  }

  // ───────── 查詢 ─────────

  /** 遊戲日序 → 相對起點的交易日序；不是交易日或在起點之前回傳 -1 */
  dayIdx(day: number): number {
    const t = tradingDayIndex(day);
    return t < 0 || t < this.startIdx ? -1 : t - this.startIdx;
  }

  /** 已算過的最後一個交易日序（沒有為 -1）；用來估計 v2 的「現在」 */
  get computedDays(): number {
    return this.computed;
  }

  /** 第 i 個交易日這一檔的盤中價格（110 點） */
  intradayPrices(key: string, i: number): Int32Array | null {
    const s = this.st.get(key);
    if (!s || i < 0) return null;
    this.ensure(i);
    const hit = this.intraday.get(this.cacheKey(key, i));
    if (hit) return hit;
    const { prices } = this.simulate(s, i);
    this.remember(key, i, prices);
    return prices;
  }

  /** 日 K（OHLC） */
  candle(key: string, i: number): Candle | null {
    const s = this.st.get(key);
    if (!s || i < 0) return null;
    this.ensure(i);
    return s.candles[i] ?? null;
  }

  /** 前日收盤（第 0 日用切換點的價格） */
  prevClose(key: string, i: number): number | null {
    const s = this.st.get(key);
    if (!s || i < 0) return null;
    if (i === 0) return this.startPrice(s.g);
    this.ensure(i);
    return s.candles[i - 1]?.close ?? null;
  }

  /** 某個全域價格步生效的價格（休市時＝最近一次收盤／午休價）；在 v2 起點之前回傳 null */
  priceAtGstep(key: string, g: number): number | null {
    if (!this.st.has(key)) return null;
    const last = lastOpenGstep(g);
    if (last === null) return null;
    const i = this.dayIdx(dayOfGstep(last));
    if (i < 0) return null;
    const k = openOrdinal(stepOfDayOf(last));
    return this.intradayPrices(key, i)?.[k] ?? null;
  }

  priceAt(key: string, realMs: number): number | null {
    return this.priceAtGstep(key, gstepAt(realMs, this.clock));
  }

  /** 全部標的在某個全域步的價格（依 STOCK_GROUPS 順序）；起點之前回傳 null */
  allPricesAtGstep(g: number): number[] | null {
    const out: number[] = [];
    for (const sg of STOCK_GROUPS) {
      const p = this.priceAtGstep(sg.key, g);
      if (p === null) return null;
      out.push(p);
    }
    return out;
  }

  /** 一個交易日的盤中點（時間用真實毫秒） */
  intradaySeries(key: string, i: number): { at: number; price: number }[] {
    const prices = this.intradayPrices(key, i);
    if (!prices) return [];
    const D = tradingDayAt(this.startIdx + i);
    const out: { at: number; price: number }[] = [];
    for (let k = 0; k < TRADING_STEPS_PER_DAY; k++) out.push({ at: realMsOfGstep(gstepOf(D, stepOfOrdinal(k)), this.clock), price: prices[k]! });
    return out;
  }

  /** 一個交易日的指數盤中點（DW40、DWPIX） */
  indexIntraday(i: number): { at: number; dw40: number; dwpix: number }[] {
    const D = tradingDayAt(this.startIdx + i);
    const arrs = STOCK_GROUPS.map((g) => this.intradayPrices(g.key, i));
    if (arrs.some((a) => !a)) return [];
    const out: { at: number; dw40: number; dwpix: number }[] = [];
    for (let k = 0; k < TRADING_STEPS_PER_DAY; k++) {
      const ps = arrs.map((a) => a![k]!);
      out.push({ at: realMsOfGstep(gstepOf(D, stepOfOrdinal(k)), this.clock), dw40: dw40(ps), dwpix: dwpix(ps) });
    }
    return out;
  }

  /** 一個交易日收盤的指數 */
  indexClose(i: number): { dw40: number; dwpix: number } | null {
    const ps: number[] = [];
    for (const g of STOCK_GROUPS) {
      const c = this.candle(g.key, i);
      if (!c) return null;
      ps.push(c.close);
    }
    return { dw40: dw40(ps), dwpix: dwpix(ps) };
  }

  /** 第 i 個交易日對應的遊戲日序 */
  dayOfIdx(i: number): number {
    return tradingDayAt(this.startIdx + i);
  }

  /** 消息引擎（給伺服器取全市場消息串） */
  get newsEngine(): NewsEngine {
    return this.news;
  }

  /** 一檔標的在 [fromDay, toDay]（遊戲日）發生的消息（自身＋板塊＋全市場），依發生時間排序 */
  newsOf(key: string, fromDay: number, toDay: number): MarketNews[] {
    const g = stockGroupOf(key);
    if (!g) return [];
    const out: MarketNews[] = [];
    for (let d = fromDay; d <= toDay; d++) for (const a of this.news.eventsFor(this.seed, g, d)) out.push(a.news);
    return out.sort((a, b) => a.day - b.day || a.stepOfDay - b.stepOfDay);
  }

  /** 全市場消息串（所有標的的自身消息、各板塊、全市場，去重），依時間排序 */
  feed(fromDay: number, toDay: number): MarketNews[] {
    const out: MarketNews[] = [];
    for (let d = fromDay; d <= toDay; d++) {
      const m = this.news.macroNewsOnDay(this.seed, d);
      if (m) out.push(m);
      for (const sec of SECTORS) {
        const s = this.news.sectorNewsOnDay(this.seed, sec, d);
        if (s) out.push(s);
      }
      for (const g of STOCK_GROUPS) out.push(...this.news.stockNewsOnDay(this.seed, g, d));
    }
    return out.sort((a, b) => a.day - b.day || a.stepOfDay - b.stepOfDay);
  }
}

/**
 * 一則消息落在「交易日 D」的哪一個開市步序（0..54）；不屬於這個交易日回傳 -1。
 * d 是消息發生的遊戲日：D 之前的休市日、前一交易日收盤後（≥15:30）、D 當天開盤前 → 併入開盤（0）；
 * D 當天盤中依時間；D 當天午休 → 後場第一步；D 當天收盤後 → 屬於下一個交易日。
 */
function effectiveOrdinal(a: AppliedNews, d: number, D: number, Dprev: number | null): number {
  const s = a.news.stepOfDay;
  if (d === D) {
    if (s < AM_OPEN) return 0;
    if (s < AM_END) return s - AM_OPEN;
    if (s < PM_OPEN) return AM_STEPS;
    if (s < PM_END) return AM_STEPS + (s - PM_OPEN);
    return -1;
  }
  if (Dprev !== null && d === Dprev) return s >= PM_END ? 0 : -1;
  return 0;
}

/** 起點時鐘用的小工具：2027-04-01 等遊戲日轉日序（測試用） */
export const gameDayOf = (y: number, m: number, d: number): number => dayOfYmd(y, m, d);
