import { randomInt } from "node:crypto";
import {
  AM_OPEN,
  PM_END,
  KIND_LABEL,
  TRADING_STEPS_PER_DAY,
  LEGACY_STOCK_COUNT,
  MARKET_DAILY_BUY_LIMIT,
  MARKET_FEE_RATE,
  MARKET_HOLD_CAP,
  MARKET_MIN_PRICE,
  MARKET_TAX_RATE,
  PRICE_LIMIT,
  PriceEngine,
  PriceEngineV2,
  SIGNALS,
  STOCK_GROUPS,
  buyQuote,
  dayOfGstep,
  dividendExemptRatio,
  dividendPerShare,
  dw40,
  dwpix,
  gstepAt,
  gstepOf,
  hourOfMs,
  isExDividendDay,
  isTradingDay,
  lastOpenGstep,
  marketStatus,
  nextOpenGstep,
  openOrdinal,
  realMsOfGstep,
  sellQuote,
  stepOfDayOf,
  stockGroupOf,
  tradingDayAt,
  tradingDayBefore,
  tradingDayIndex,
  type IndexQuote,
  type MarketHistory,
  type MarketNews,
  type MarketNewsItem,
  type MarketOrderView,
  type MarketRange,
  type MarketRow,
  type MarketStatus,
  type MarketView,
  type NewsEngine,
  type PortfolioView,
  type PositionView,
  type ServerClock,
  type TradeResult,
} from "@coidle/shared";
import { POOL_NEWS } from "../../../shared/src/game/market/poolNews";
import type { Repo } from "../db/repo";
import { ServiceError } from "../services/errors";

/** 一次最多買賣多少股（只是擋荒謬的輸入；真正的限制是每日買進與持股市值上限） */
const MAX_SHARES_PER_ORDER = 1_000_000;
/** 每人同時最多幾張預約單 */
const MAX_OPEN_ORDERS = 10;
const SPARK_DAYS = 30;
/** 管理室可調的每日買進／持股上限的天花板（防手滑） */
const LIMIT_CEILING = 100_000_000;
/** 5d＝最近 5 個交易日的盤中走勢；1m／3m＝最近 30／90 個遊戲日的日 K */
const RANGE_DAYS = { "5d": 5 } as const;
const RANGE_GAME_DAYS: Record<"1m" | "3m", number> = { "1m": 30, "3m": 90 };
/** v2 起點之前往回推算幾個交易日的走勢（約半年）：讓每個區間一開始就有完整資料 */
const BACKFILL_DAYS = 130;

interface Quote {
  price: number;
  /** v2 價格序列已開始（可以交易） */
  listed: boolean;
}

/**
 * 股票市場 v2：玩家用個人錢包買賣虛構「集團」的股票。價格依東證的開市時間（遊戲內 JST）每真實 1 分鐘一步，
 * 由伺服器私有種子與時間決定（見 shared/src/game/market/），不存歷史；只存持倉、成交、預約單與配息紀錄。
 * v2 從 v1 在切換點的狀態接續（持倉與成本不受影響）；起點之前的走勢圖用同一個引擎往回推算（見 backfill）。
 */
export class MarketService {
  private v1c: { engine: PriceEngine; anchorRealMs: number; anchorTick: number } | null = null;
  private v2c: { engine: PriceEngineV2; anchorRealMs: number; anchorTick: number; start: number } | null = null;
  private bfc: { main: PriceEngineV2; engine: PriceEngineV2; n: number; adj: Map<string, number> } | null = null;
  private baseCache: { gstep: number; rows: Omit<MarketRow, "held">[]; indices: IndexQuote[] } | null = null;
  private readonly feedCache = new Map<number, MarketNews[]>();
  private lastDivDay: number | null = null;
  /** 法人投資（商場持股）的配息出口：由 MallService 設定 */
  private corpSink: ((mallId: number, gross: number, exempt: number, note: string) => void) | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
    private readonly clock: () => ServerClock,
    private readonly news: NewsEngine = POOL_NEWS,
  ) {}

  /** 設定商場收配息的出口（商場用公司資金持有股票時，配息入商場資金） */
  setCorporateSink(fn: (mallId: number, gross: number, exempt: number, note: string) => void): void {
    this.corpSink = fn;
  }

  // ───────── 引擎 ─────────

  private seed(): number {
    let raw = this.repo.getMeta("stock_seed");
    if (raw === null) {
      raw = String(randomInt(1, 2_147_483_647));
      this.repo.setMeta("stock_seed", raw);
    }
    return Number(raw);
  }

  /** v2 價格序列的起點（真實時間）：第一次用到時記下來；之前的歷史交給 v1 */
  private startMs(): number {
    const raw = this.repo.getMeta("market_v2_start");
    if (raw !== null) return Number(raw);
    const t = this.now();
    this.repo.setMeta("market_v2_start", String(t));
    return t;
  }

  /** v1 引擎：價格歷史凍結（只算既有 16 檔），伺服器時鐘變了就重建 */
  private v1(): PriceEngine {
    const sc = this.clock();
    if (this.v1c && this.v1c.anchorRealMs === sc.anchorRealMs && this.v1c.anchorTick === sc.anchorTick) return this.v1c.engine;
    const engine = new PriceEngine(this.seed(), sc);
    this.v1c = { engine, anchorRealMs: sc.anchorRealMs, anchorTick: sc.anchorTick };
    return engine;
  }

  private v2(): PriceEngineV2 {
    const sc = this.clock();
    const start = this.startMs();
    if (this.v2c && this.v2c.anchorRealMs === sc.anchorRealMs && this.v2c.anchorTick === sc.anchorTick && this.v2c.start === start) return this.v2c.engine;
    const v1 = this.v1();
    const h = hourOfMs(start);
    const engine = new PriceEngineV2(this.seed(), sc, {
      startRealMs: start,
      news: this.news,
      handoff: (key) => (STOCK_GROUPS.findIndex((g) => g.key === key) < LEGACY_STOCK_COUNT ? { x: v1.deviationAt(key, h), price: v1.priceAt(key, h) } : null),
    });
    this.v2c = { engine, anchorRealMs: sc.anchorRealMs, anchorTick: sc.anchorTick, start };
    this.baseCache = null;
    this.feedCache.clear();
    return engine;
  }

  /**
   * 起點之前的往回推算：同一個價格引擎從 BACKFILL_DAYS 個交易日前（基準價）開始走，
   * 再把每檔的價格在對數上線性拉到「真正的起點價格」，所以走勢圖接得起來；
   * 只用來畫圖（價格、買賣、持倉成本都不受影響），純函式、同樣的種子永遠同樣的結果。
   */
  private backfill(): { engine: PriceEngineV2; n: number; adj: Map<string, number> } {
    const main = this.v2();
    if (this.bfc && this.bfc.main === main) return this.bfc;
    const sc = this.clock();
    const startIdx = tradingDayIndex(main.startDay);
    const n = Math.min(BACKFILL_DAYS, startIdx);
    const engine = new PriceEngineV2(this.seed(), sc, { startRealMs: realMsOfGstep(gstepOf(tradingDayAt(startIdx - n), 0), sc), news: this.news });
    const adj = new Map<string, number>();
    for (const g of STOCK_GROUPS) {
      const closeB = engine.candle(g.key, n - 1)?.close ?? 0;
      const target = main.prevClose(g.key, 0) ?? closeB;
      adj.set(g.key, closeB > 0 && target > 0 ? Math.log(target / closeB) : 0);
    }
    this.bfc = { main, engine, n, adj };
    return this.bfc;
  }

  /** 第 j 個交易日（相對 v2 起點；負數＝往回推算的日子）這一檔的盤中價格 */
  private dayPrices(key: string, j: number): { at: number; price: number }[] {
    if (j >= 0) return this.v2().intradaySeries(key, j);
    const b = this.backfill();
    const t = b.n + j;
    if (t < 0) return [];
    const f = Math.exp((b.adj.get(key) ?? 0) * ((t + 1) / b.n));
    return b.engine.intradaySeries(key, t).map((s) => ({ at: s.at, price: Math.max(MARKET_MIN_PRICE, Math.round(s.price * f)) }));
  }

  /** 第 j 個交易日的收盤（j 為負＝往回推算的日子）；超出範圍回傳 null */
  private closeOfDay(key: string, j: number): number | null {
    if (j >= 0) return this.v2().candle(key, j)?.close ?? null;
    const b = this.backfill();
    const t = b.n + j;
    if (t < 0) return null;
    const c = b.engine.candle(key, t);
    return c ? Math.max(MARKET_MIN_PRICE, Math.round(c.close * Math.exp((b.adj.get(key) ?? 0) * ((t + 1) / b.n)))) : null;
  }

  private dayOfJ(j: number): number {
    return j >= 0 ? this.v2().dayOfIdx(j) : this.backfill().engine.dayOfIdx(this.backfill().n + j);
  }

  status(): MarketStatus {
    const st = marketStatus(this.now(), this.clock());
    const h = this.haltInfo();
    // 臨時暫停交易：只是不能成交，價格仍是（種子, 時間）的純函式，不受影響
    if (h) return { ...st, open: false, session: "closed", reason: h.reason ? `臨時暫停交易：${h.reason}` : "臨時暫停交易", halted: true };
    return st;
  }

  // ───────── 管理室：暫停交易與上限調整（只動「能不能成交」與限額，不動價格） ─────────

  /** 目前的臨時暫停交易；沒有暫停就回傳 null */
  haltInfo(): { reason: string; at: number } | null {
    const raw = this.repo.getMeta("market_halt");
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as { reason?: unknown; at?: unknown };
      return { reason: typeof v.reason === "string" ? v.reason : "", at: typeof v.at === "number" ? v.at : 0 };
    } catch {
      return null;
    }
  }

  /** 開始或解除臨時暫停交易。暫停期間：買賣與法人下單被拒絕、預約單不成交；解除後預約單依原規則在「下單後第一次開盤」成交 */
  setHalt(on: boolean, reason = ""): { halted: boolean } {
    if (on) this.repo.setMeta("market_halt", JSON.stringify({ reason: reason.slice(0, 80), at: this.now() }));
    else this.repo.setMeta("market_halt", "");
    return { halted: on };
  }

  /** 每日買進上限與單一集團持股上限：預設是常數，管理室可以調整（0 以上、有天花板） */
  limits(): { dailyBuyLimit: number; holdCap: number } {
    let dailyBuyLimit = MARKET_DAILY_BUY_LIMIT;
    let holdCap = MARKET_HOLD_CAP;
    const raw = this.repo.getMeta("market_limits");
    if (raw) {
      try {
        const v = JSON.parse(raw) as { dailyBuyLimit?: unknown; holdCap?: unknown };
        if (typeof v.dailyBuyLimit === "number" && Number.isFinite(v.dailyBuyLimit)) dailyBuyLimit = Math.min(LIMIT_CEILING, Math.max(0, Math.floor(v.dailyBuyLimit)));
        if (typeof v.holdCap === "number" && Number.isFinite(v.holdCap)) holdCap = Math.min(LIMIT_CEILING, Math.max(0, Math.floor(v.holdCap)));
      } catch {
        /* 壞掉的設定就用預設 */
      }
    }
    return { dailyBuyLimit, holdCap };
  }

  /** 調整上限；欄位傳 null 或不傳＝恢復預設 */
  setLimits(patch: { dailyBuyLimit?: number | null; holdCap?: number | null }): { dailyBuyLimit: number; holdCap: number } {
    for (const k of ["dailyBuyLimit", "holdCap"] as const) {
      const v = patch[k];
      if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > LIMIT_CEILING)) {
        throw new ServiceError(400, `上限必須是 0 到 ${LIMIT_CEILING.toLocaleString()} 之間的整數`);
      }
    }
    const out: Record<string, number> = {};
    if (typeof patch.dailyBuyLimit === "number") out.dailyBuyLimit = Math.floor(patch.dailyBuyLimit);
    if (typeof patch.holdCap === "number") out.holdCap = Math.floor(patch.holdCap);
    this.repo.setMeta("market_limits", Object.keys(out).length ? JSON.stringify(out) : "");
    return this.limits();
  }

  /** 現在是第幾個遊戲日（每日買進上限用） */
  private gameDay(): number {
    return dayOfGstep(gstepAt(this.now(), this.clock()));
  }

  private quote(key: string): Quote {
    const p = this.v2().priceAt(key, this.now());
    if (p !== null) return { price: p, listed: true };
    const g = stockGroupOf(key);
    if (!g) throw new Error(`unknown stock ${key}`);
    const idx = STOCK_GROUPS.indexOf(g);
    if (idx < LEGACY_STOCK_COUNT) return { price: this.v1().priceAt(key, hourOfMs(Math.min(this.now(), this.startMs()))), listed: false };
    return { price: g.base, listed: false };
  }

  price(key: string): number {
    return this.quote(key).price;
  }

  /** 現價相對近 N 個交易日收盤均價的偏離（0.05＝高於均價 5%）。授信氣候用：價格是（種子, 時間）的純函式，所以這個數字也是 */
  trend(key: string, days = 20): number {
    const pos = this.nowPos(this.v2());
    const lastJ = pos ? pos.i : -1;
    let sum = 0;
    let n = 0;
    for (let j = lastJ; j > lastJ - days; j--) {
      const c = this.closeOfDay(key, j);
      if (c !== null) {
        sum += c;
        n++;
      }
    }
    if (n === 0) return 0;
    const avg = sum / n;
    return avg > 0 ? this.price(key) / avg - 1 : 0;
  }

  private watchOf(key: string): string[] {
    return (stockGroupOf(key)?.signals ?? []).map(([id]) => SIGNALS[id].label);
  }

  // ───────── 消息 ─────────

  private feedOfDay(e: PriceEngineV2, day: number): MarketNews[] {
    const hit = this.feedCache.get(day);
    if (hit) return hit;
    const f = e.feed(day, day);
    if (this.feedCache.size > 60) this.feedCache.delete(this.feedCache.keys().next().value as number);
    this.feedCache.set(day, f);
    return f;
  }

  private newsAt(n: MarketNews): number {
    return realMsOfGstep(gstepOf(n.day, n.stepOfDay), this.clock());
  }

  private subjectOf(n: MarketNews): string {
    if (n.scope === "stock") return stockGroupOf(n.target ?? "")?.name ?? "";
    if (n.scope === "sector") return `${n.target}業界`;
    return "市場全體";
  }

  /** 全市場消息串（已經發生的，新的在前） */
  newsFeed(limit = 40): MarketNewsItem[] {
    const e = this.v2();
    const g = gstepAt(this.now(), this.clock());
    const today = dayOfGstep(g);
    const out: MarketNews[] = [];
    for (let d = today; d > today - 14 && out.length < limit * 2; d--) {
      for (const n of this.feedOfDay(e, d)) if (gstepOf(n.day, n.stepOfDay) <= g) out.push(n);
    }
    out.sort((a, b) => b.day - a.day || b.stepOfDay - a.stepOfDay);
    const disclosures: MarketNewsItem[] = this.repo.disclosuresSince(this.now() - 14 * 4 * 3_600_000, this.now()).map((d) => {
      const name = stockGroupOf(d.company)?.name ?? d.company;
      const pct = Math.round(d.pct * 10) / 10;
      return {
        id: `disc-${d.id}`,
        at: d.at,
        scope: "stock" as const,
        target: d.company,
        subject: name,
        pct: 0,
        headline: d.kind === "cross" ? `「${d.holder}」持有「${name}」股份升至 ${pct}%（大量持有報告）` : `「${d.holder}」持有「${name}」股份降至 5% 以下`,
        body: "持有流通股超過 5% 要公開報告。這只是持股變動的公告，不影響股價。",
        sentiment: "neutral",
        phase: null,
      };
    });
    const news: MarketNewsItem[] = out.map((n) => ({
      id: n.id,
      at: this.newsAt(n),
      scope: n.scope,
      target: n.target,
      subject: this.subjectOf(n),
      pct: n.pct,
      headline: n.headline,
      body: n.body,
      sentiment: n.sentiment,
      phase: n.phase,
    }));
    return [...disclosures, ...news].sort((a, b) => b.at - a.at).slice(0, limit);
  }

  // ───────── 行情 ─────────

  /** 現在的「開市步」所屬的交易日序與步序；還沒有（v2 起點之前）回傳 null */
  private nowPos(e: PriceEngineV2): { i: number; k: number } | null {
    const last = lastOpenGstep(gstepAt(this.now(), this.clock()));
    if (last === null) return null;
    const i = e.dayIdx(dayOfGstep(last));
    return i < 0 ? null : { i, k: openOrdinal(stepOfDayOf(last)) };
  }

  private baseRows(): { rows: Omit<MarketRow, "held">[]; indices: IndexQuote[] } {
    const gstep = gstepAt(this.now(), this.clock());
    if (this.baseCache && this.baseCache.gstep === gstep) return this.baseCache;
    const e = this.v2();
    const pos = this.nowPos(e);
    const rows: Omit<MarketRow, "held">[] = [];
    const prices: number[] = [];
    const prevCloses: number[] = [];
    const sparks: number[][] = [];
    const today = dayOfGstep(gstep);
    for (const g of STOCK_GROUPS) {
      const q = this.quote(g.key);
      let prevClose = q.price;
      let open = q.price;
      let high = q.price;
      let low = q.price;
      if (pos && q.listed) {
        prevClose = e.prevClose(g.key, pos.i)!;
        const pts = e.intradayPrices(g.key, pos.i)!;
        open = pts[0]!;
        for (let k = 0; k <= pos.k; k++) {
          const p = pts[k]!;
          if (p > high || k === 0) high = p;
          if (p < low || k === 0) low = p;
        }
      } else {
        // v2 還沒開始交易：「前日收盤」是往回推算的倒數第二天
        prevClose = this.closeOfDay(g.key, -2) ?? q.price;
      }
      // 迷你走勢：最近 SPARK_DAYS 個交易日的收盤（含往回推算的日子）接上現價
      const spark: number[] = [];
      const lastJ = pos && q.listed ? pos.i : -1;
      for (let j = Math.max(-this.backfill().n, lastJ - SPARK_DAYS); j < lastJ; j++) spark.push(this.closeOfDay(g.key, j) ?? q.price);
      spark.push(q.price);
      const latest = e.newsOf(g.key, today - 20, today).filter((n) => gstepOf(n.day, n.stepOfDay) <= gstep).at(-1) ?? null;
      prices.push(q.price);
      prevCloses.push(prevClose);
      sparks.push(spark);
      rows.push({
        key: g.key,
        name: g.name,
        sector: `${g.sector}・${KIND_LABEL[g.kind]}`,
        sectorName: g.sector,
        kind: g.kind,
        tier: g.tier,
        blurb: g.blurb,
        watch: this.watchOf(g.key),
        price: q.price,
        listed: q.listed,
        prevClose,
        change: Math.round((q.price / prevClose - 1) * 10_000) / 100,
        open,
        high,
        low,
        limitUp: Math.floor(prevClose * (1 + PRICE_LIMIT)),
        limitDown: Math.max(MARKET_MIN_PRICE, Math.ceil(prevClose * (1 - PRICE_LIMIT))),
        cap: q.price * g.shares,
        divYield: g.divYield,
        spark,
        news: latest ? { text: latest.headline, at: this.newsAt(latest), pct: latest.pct } : null,
      });
    }
    const indices: IndexQuote[] = [
      { id: "dw40", name: "大和平均株價", value: dw40(prices), prevClose: dw40(prevCloses), change: 0, spark: [] },
      { id: "dwpix", name: "大和株價指數", value: dwpix(prices), prevClose: dwpix(prevCloses), change: 0, spark: [] },
    ];
    for (const ix of indices) {
      ix.change = Math.round((ix.value / ix.prevClose - 1) * 10_000) / 100;
      ix.value = Math.round(ix.value * 100) / 100;
      ix.prevClose = Math.round(ix.prevClose * 100) / 100;
    }
    // 指數迷你走勢：用各檔 spark 的同位置合成（長度取最短）
    const n = Math.min(...sparks.map((s) => s.length));
    for (const ix of indices) {
      ix.spark = [];
      for (let t = 0; t < n; t++) {
        const ps = sparks.map((s) => s[s.length - n + t]!);
        ix.spark.push(Math.round((ix.id === "dw40" ? dw40(ps) : dwpix(ps)) * 100) / 100);
      }
    }
    this.baseCache = { gstep, rows, indices };
    return this.baseCache;
  }

  /** 全部集團的現價、漲跌、迷你走勢、指數與市場狀態；帶上我持有幾股與我的預約單 */
  list(userId: number): MarketView {
    this.settle();
    const { rows, indices } = this.baseRows();
    const held = new Map(this.repo.positionsOfUser(userId).map((p) => [p.company, p.shares]));
    return {
      at: this.now(),
      rows: rows.map((r) => ({ ...r, held: held.get(r.key) ?? 0 })),
      indices,
      status: this.status(),
      orders: this.orders(userId),
      wallet: this.repo.walletOf(userId),
      boughtToday: this.repo.boughtOnDay(userId, this.gameDay()),
      dailyBuyLimit: this.limits().dailyBuyLimit,
      holdCap: this.limits().holdCap,
      feeRate: MARKET_FEE_RATE,
      taxRate: MARKET_TAX_RATE,
    };
  }

  /** 一檔股票的走勢與消息：1d／5d＝每個價格步一點，1m／3m／all＝每個交易日一根日 K */
  history(key: string, range: MarketRange = "1d"): MarketHistory {
    const g = stockGroupOf(key);
    if (!g) throw new ServiceError(404, "找不到這檔股票");
    const e = this.v2();
    const nowMs = this.now();
    const gnow = gstepAt(nowMs, this.clock());
    const pos = this.nowPos(e);
    const clock = this.clock();
    const today = dayOfGstep(gnow);
    type Pt = MarketHistory["points"][number];
    // 「現在」落在第幾個交易日：v2 還沒開始交易（起點後的第一個開盤之前）時，就是往回推算的最後一天
    const lastJ = pos ? pos.i : -1;
    const lastK = pos ? pos.k : TRADING_STEPS_PER_DAY - 1;
    const firstJ = -this.backfill().n;
    const series = (j: number) => this.dayPrices(key, j).slice(0, j === lastJ ? lastK + 1 : undefined);
    const prevCloseOf = (j: number): number | null => (j === 0 ? e.prevClose(key, 0) : this.closeOfDay(key, j - 1));

    let points: Pt[] = [];
    let prevClose: number | null = null;
    let kind: MarketHistory["kind"] = "daily";

    if (range === "1d" || range === "5d") {
      kind = "intraday";
      const days = range === "1d" ? 1 : RANGE_DAYS["5d"];
      const first = Math.max(firstJ, lastJ - days + 1);
      for (let j = first; j <= lastJ; j++) points.push(...series(j));
      prevClose = prevCloseOf(first);
    } else {
      const fromDay = today - (range === "all" ? 100_000 : RANGE_GAME_DAYS[range]) + 1;
      for (let j = lastJ; j >= firstJ && this.dayOfJ(j) >= fromDay; j--) {
        const pts = series(j);
        if (pts.length === 0) continue;
        let hi = 0;
        let lo = Number.MAX_SAFE_INTEGER;
        for (const s of pts) {
          hi = Math.max(hi, s.price);
          lo = Math.min(lo, s.price);
        }
        const at = j === lastJ && pos ? Math.min(pts.at(-1)!.at, nowMs) : realMsOfGstep(gstepOf(this.dayOfJ(j), PM_END - 1), clock);
        points.push({ at, price: pts.at(-1)!.price, open: pts[0]!.price, high: hi, low: lo });
      }
      points.reverse();
      prevClose = prevCloseOf(lastJ);
    }
    const firstAt = points[0]?.at ?? nowMs;

    const d0 = dayOfGstep(gstepAt(firstAt, clock));
    const events = e
      .newsOf(key, d0 - 1, dayOfGstep(gnow))
      .filter((n) => gstepOf(n.day, n.stepOfDay) <= gnow && this.newsAt(n) >= firstAt)
      .map((n) => ({ id: n.id, at: this.newsAt(n), pct: n.pct, text: n.headline, body: n.body, scope: n.scope }));
    return { key, name: g.name, range, kind, points, prevClose, clock, events };
  }

  // ───────── 持倉 ─────────

  portfolio(userId: number): PortfolioView {
    const positions: PositionView[] = this.repo.positionsOfUser(userId).flatMap((p) => {
      const g = stockGroupOf(p.company);
      if (!g) return [];
      const price = this.price(p.company);
      const value = price * p.shares;
      const pnl = value - p.costTotal;
      return [
        {
          key: p.company,
          name: g.name,
          sector: g.sector,
          shares: p.shares,
          costTotal: p.costTotal,
          avgCost: Math.round((p.costTotal / p.shares) * 100) / 100,
          price,
          value,
          pnl,
          pnlPct: p.costTotal > 0 ? Math.round((pnl / p.costTotal) * 10_000) / 100 : 0,
        },
      ];
    });
    const value = positions.reduce((a, p) => a + p.value, 0);
    const cost = positions.reduce((a, p) => a + p.costTotal, 0);
    return { positions, value, cost, pnl: value - cost };
  }

  // ───────── 買賣 ─────────

  private assertTrader(userId: number, key: string, shares: unknown): number {
    if (this.repo.userById(userId)?.role === "overseer") throw new ServiceError(403, "管理者帳號不能交易股票");
    if (!stockGroupOf(key)) throw new ServiceError(404, "找不到這檔股票");
    if (typeof shares !== "number" || !Number.isInteger(shares) || shares < 1 || shares > MAX_SHARES_PER_ORDER) throw new ServiceError(400, "股數要是 1 以上的整數");
    return shares;
  }

  private closedMessage(st: MarketStatus): string {
    const mins = Math.max(1, Math.ceil((st.nextOpenAt - this.now()) / 60_000));
    const when = mins >= 120 ? `約 ${Math.round(mins / 60)} 真實小時後` : `約 ${mins} 真實分鐘後`;
    const why = st.reason ?? (st.session === "lunch" ? "午休中" : st.session === "pre" ? "尚未開盤" : "已經收盤");
    return `市場休市中（${why}），${when}開盤。休市時可以下預約單，開盤用開盤價成交。`;
  }

  /** 開市中的即時價格；休市或還沒上市就拒絕 */
  livePrice(key: string): number {
    const st = this.status();
    if (!st.open) throw new ServiceError(409, this.closedMessage(st));
    const q = this.quote(key);
    if (!q.listed) throw new ServiceError(409, "這檔股票還沒上市，下次開盤後才能交易");
    return q.price;
  }

  private execBuy(userId: number, key: string, shares: number, price: number, day: number, at: number): TradeResult {
    const q = buyQuote(price, shares);
    const lim = this.limits();
    const bought = this.repo.boughtOnDay(userId, day);
    if (bought + q.cost > lim.dailyBuyLimit) {
      throw new ServiceError(409, `每個遊戲日最多買進 ${lim.dailyBuyLimit.toLocaleString()}（今天已買 ${bought.toLocaleString()}），明天（約 4 個真實小時內換日）再來`);
    }
    const pos = this.repo.positionOf(userId, key);
    if ((pos.shares + shares) * price > lim.holdCap) {
      throw new ServiceError(409, `單一集團的持股市值最多 ${lim.holdCap.toLocaleString()}，這筆買下去會超過`);
    }
    const wallet = this.repo.walletOf(userId);
    if (wallet < q.total) throw new ServiceError(402, `你的錢包只有 ${wallet.toLocaleString()}，買進要 ${q.total.toLocaleString()}（含手續費 ${q.fee.toLocaleString()}）`);
    const name = stockGroupOf(key)!.name;
    this.repo.tx(() => {
      this.repo.addCash(userId, -q.total, { kind: "stock_buy", note: `${name} ${shares.toLocaleString()} 股 @ ${price.toLocaleString()}（手續費 ${q.fee.toLocaleString()}）`, at });
      this.repo.setPosition(userId, key, pos.shares + shares, pos.costTotal + q.total);
      this.repo.addStockTrade({ userId, company: key, side: "buy", shares, price, fee: q.fee, tax: 0, day, at });
    });
    return { key, side: "buy", shares, price, fee: q.fee, tax: 0, cash: -q.total, gain: 0 };
  }

  private execSell(userId: number, key: string, shares: number, price: number, day: number, at: number): TradeResult {
    const pos = this.repo.positionOf(userId, key);
    if (pos.shares < shares) throw new ServiceError(409, pos.shares > 0 ? `你只有 ${pos.shares.toLocaleString()} 股` : "你沒有這檔股票");
    const q = sellQuote(price, shares, pos);
    const name = stockGroupOf(key)!.name;
    this.repo.tx(() => {
      this.repo.addCash(userId, q.net, {
        kind: "stock_sell",
        note: `${name} ${shares.toLocaleString()} 股 @ ${price.toLocaleString()}（手續費 ${q.fee.toLocaleString()}，${q.gain >= 0 ? `獲利 ${q.gain.toLocaleString()}，稅 ${q.tax.toLocaleString()}` : `虧損 ${(-q.gain).toLocaleString()}`}）`,
        at,
      });
      this.repo.setPosition(userId, key, pos.shares - shares, pos.costTotal - q.costBasis);
      this.repo.addStockTrade({ userId, company: key, side: "sell", shares, price, fee: q.fee, tax: q.tax, day, at, gain: q.gain });
    });
    return { key, side: "sell", shares, price, fee: q.fee, tax: q.tax, cash: q.net, gain: q.gain };
  }

  buy(userId: number, key: string, sharesIn: unknown): TradeResult {
    const shares = this.assertTrader(userId, key, sharesIn);
    this.settle();
    return this.execBuy(userId, key, shares, this.livePrice(key), this.gameDay(), this.now());
  }

  sell(userId: number, key: string, sharesIn: unknown): TradeResult {
    const shares = this.assertTrader(userId, key, sharesIn);
    this.settle();
    return this.execSell(userId, key, shares, this.livePrice(key), this.gameDay(), this.now());
  }

  // ───────── 預約單 ─────────

  private orderView(r: { id: number; company: string; side: "buy" | "sell"; shares: number; status: MarketOrderView["status"]; created_at: number; settled_at: number | null; price: number | null; note: string }): MarketOrderView {
    return { id: r.id, key: r.company, name: stockGroupOf(r.company)?.name ?? r.company, side: r.side, shares: r.shares, status: r.status, createdAt: r.created_at, settledAt: r.settled_at, price: r.price, note: r.note };
  }

  orders(userId: number): MarketOrderView[] {
    return this.repo.ordersOfUser(userId, 12).map((r) => this.orderView(r));
  }

  /** 休市時下「開盤市價單」：下一次開盤用開盤價成交（買賣限制與錢包在成交時檢查） */
  placeOrder(userId: number, key: string, side: unknown, sharesIn: unknown): MarketOrderView {
    const shares = this.assertTrader(userId, key, sharesIn);
    if (side !== "buy" && side !== "sell") throw new ServiceError(400, "要買還是賣？");
    const st = this.status();
    if (st.open) throw new ServiceError(409, "市場開市中，請直接買賣");
    if (this.repo.openOrderCount(userId) >= MAX_OPEN_ORDERS) throw new ServiceError(409, `預約單最多同時 ${MAX_OPEN_ORDERS} 張`);
    if (side === "sell") {
      const pending = this.repo.ordersOfUser(userId, 200).filter((o) => o.status === "open" && o.company === key && o.side === "sell").reduce((a, o) => a + o.shares, 0);
      const have = this.repo.positionOf(userId, key).shares;
      if (have - pending < shares) throw new ServiceError(409, have > 0 ? `你有 ${have.toLocaleString()} 股（其中 ${pending.toLocaleString()} 股已被其他預約賣單占用）` : "你沒有這檔股票");
    }
    const at = this.now();
    const id = this.repo.addOrder({ userId, company: key, side, shares, createdAt: at });
    return this.orderView(this.repo.orderById(id) as never);
  }

  cancelOrder(userId: number, id: number): MarketOrderView {
    const o = this.repo.orderById(id);
    if (!o || o.user_id !== userId) throw new ServiceError(404, "找不到這張預約單");
    if (o.status !== "open") throw new ServiceError(409, "這張預約單已經處理過了");
    this.repo.settleOrder(id, "cancelled", this.now(), null, "已取消");
    return this.orderView(this.repo.orderById(id) as never);
  }

  /** 處理到期的預約單：在「下單之後的第一次開盤」的開盤價成交；成交時才檢查錢包與限制，失敗就標記拒絕 */
  private processOrders(): void {
    if (this.haltInfo()) return; // 暫停交易期間不成交，解除後依原規則處理
    const sc = this.clock();
    const gnow = gstepAt(this.now(), sc);
    const e = this.v2();
    for (const o of this.repo.openOrders()) {
      const first = nextOpenGstep(gstepAt(o.created_at, sc));
      if (first > gnow) continue;
      const price = e.priceAtGstep(o.company, first);
      if (price === null) continue; // 還沒上市（v2 起點之前）：留到上市後
      const at = this.now();
      const day = dayOfGstep(first);
      try {
        const r = o.side === "buy" ? this.execBuy(o.user_id, o.company, o.shares, price, day, at) : this.execSell(o.user_id, o.company, o.shares, price, day, at);
        this.repo.settleOrder(o.id, "filled", at, price, `成交 ${r.shares.toLocaleString()} 股 @ ${price.toLocaleString()}`);
      } catch (err) {
        this.repo.settleOrder(o.id, "rejected", at, price, err instanceof ServiceError ? err.message : "無法成交");
      }
    }
  }

  // ───────── 配息 ─────────

  /** 除權息日開盤後，把配息發給「持有這檔」的玩家（扣證券所得稅；冪等） */
  private settleDividends(): void {
    const sc = this.clock();
    const last = lastOpenGstep(gstepAt(this.now(), sc));
    if (last === null) return;
    const e = this.v2();
    const upto = dayOfGstep(last);
    if (upto < e.startDay) return;
    if (this.lastDivDay === null) {
      const raw = this.repo.getMeta("market_div_day");
      this.lastDivDay = raw === null ? e.startDay - 1 : Number(raw);
    }
    if (this.lastDivDay >= upto) return;
    let d = this.lastDivDay;
    for (let day = Math.max(this.lastDivDay + 1, e.startDay); day <= upto; day++) {
      if (!isTradingDay(day)) continue;
      for (const g of STOCK_GROUPS) {
        if (!isExDividendDay(g, day) || this.repo.dividendPaid(g.key, day)) continue;
        const per = dividendPerShare(g);
        const holders = this.repo.holdersOf(g.key);
        const mallHolders = this.repo.mallHoldersOf(g.key);
        const at = this.now();
        this.repo.tx(() => {
          let gross = 0;
          let tax = 0;
          for (const h of holders) {
            const amount = h.shares * per;
            const t = Math.floor(amount * MARKET_TAX_RATE);
            gross += amount;
            tax += t;
            this.repo.addCash(h.userId, amount - t, { kind: "stock_dividend", note: `${g.name} 配息 ${per.toLocaleString()}／股 × ${h.shares.toLocaleString()} 股（稅 ${t.toLocaleString()}）`, at });
          }
          for (const h of mallHolders) {
            // 法人：配息全額入公司資金，不當場扣稅；併入決算所得，並適用受取配当益金不算入（持股 ≤5% 不算入 20%、>5% 不算入 50%）
            const amount = h.shares * per;
            const ratio = dividendExemptRatio(h.shares, g.shares);
            gross += amount;
            this.corpSink?.(h.mallId, amount, Math.floor(amount * ratio), `${g.name} 配息 ${per.toLocaleString()}／股 × ${h.shares.toLocaleString()} 股（併入年度所得，其中 ${ratio * 100}% 益金不算入）`);
          }
          this.repo.recordDividend({ company: g.key, exDay: day, perShare: per, holders: holders.length + mallHolders.length, gross, tax, paidAt: at });
        });
      }
      d = day;
    }
    this.lastDivDay = Math.max(d, upto);
    this.repo.setMeta("market_div_day", String(this.lastDivDay));
  }

  /** 先把該發的配息與該成交的預約單處理掉（買賣、列表前都會呼叫，所以不依賴排程的準時） */
  settle(): void {
    this.settleDividends();
    this.processOrders();
  }

  /** 排程：每分鐘左右呼叫一次 */
  tick(): void {
    this.settle();
  }

  // ───────── 給別處用 ─────────

  /** 上一個交易日（遊戲日序），資產快照等用 */
  lastTradingDay(): number | null {
    const g = gstepAt(this.now(), this.clock());
    const day = dayOfGstep(g);
    return isTradingDay(day) && stepOfDayOf(g) >= AM_OPEN ? day : tradingDayBefore(day);
  }
}

