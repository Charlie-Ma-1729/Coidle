/**
 * 股票市場：玩家用個人錢包買賣「集團」的股票。
 *
 * 這些集團是虛構的、和商場無關（就像阪神電鉄之於阪神百貨：玩家現在經營的是「百貨」，之後才會長成「集團」）。
 * 玩家只是靠投資賺錢。價格是「伺服器私有種子 ＋ 時間」的純函式：
 *  - 每真實 1 小時一個價格點，從世界起點（WORLD_EPOCH_MS）逐點累加，重啟後重算結果一樣；
 *  - 價格 = 基準價 × exp(隨機遊走 + 世界訊號)；隨機遊走有大盤成分、個股成分與偶發的消息跳動，並有很弱的均值回歸；
 *  - 世界訊號是「已發生」的日曆與天氣（連休、發薪日、雨天、酷暑…）的近 3 天平均，幅度很小（±3%），有故事可讀，但不保證獲利。
 * 摩擦：手續費 0.5%／每邊、賣出獲利課 20.315%、每日買進與單一持股上限（見下方常數）。詳見 docs/stock-market.md。
 */
import { dayOfTick, serverTickAt, DEFAULT_SERVER_CLOCK, type ServerClock } from "./time";
import { WORLD_EPOCH_MS } from "./world";
import type { MarketStatus } from "./market/exchange";
import { gauss, rnd, strHash } from "./market/rng";
import { signalLevel } from "./market/signals";
import { LEGACY_STOCK_COUNT, STOCK_GROUPS, stockGroupOf, type StockGroup, type StockKind } from "./market/stocks";

export * from "./market/signals";
export * from "./market/stocks";

export const MARKET_START_MS = WORLD_EPOCH_MS;
export const MARKET_STEP_MS = 3_600_000;

/** 手續費（買、賣各收一次） */
export const MARKET_FEE_RATE = 0.005;
/** 賣出已實現獲利的稅率（日本證券所得稅 20.315%；不做損益相抵） */
export const MARKET_TAX_RATE = 0.20315;
/** 每人每遊戲日最多買進多少錢（不含手續費） */
export const MARKET_DAILY_BUY_LIMIT = 1_000_000;
/** 單一集團的持股市值上限（買進後） */
export const MARKET_HOLD_CAP = 3_000_000;
/** 價格下限（避免歸零） */
export const MARKET_MIN_PRICE = 10;
/** 均值回歸半衰期（小時）：約 30 真實天 */
const REVERT_HALF_LIFE_H = 30 * 24;
const KAPPA = Math.LN2 / REVERT_HALF_LIFE_H;
/** 大盤每小時波動 */
const MARKET_SIGMA = 0.0022;
/** 每小時發生「消息」的機率（每家約 12 真實天一次） */
const EVENT_PROB = 1 / 300;
/** 隨機遊走偏離基準價的上限（對數） */
const X_LIMIT = 0.8;
/** 一個引擎最多往後算多少個點（保護用，約 11 年） */
const MAX_STEPS = 100_000;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface MarketEvent {
  /** 價格點的小時序號 */
  hour: number;
  at: number;
  /** 一次性的漲跌幅（%，正負） */
  pct: number;
  text: string;
}

const GOOD_NEWS = ["發表亮眼的季報", "上調本年度獲利預測", "新事業傳出好消息", "獲得大型合約", "宣布成本大幅下降"];
const BAD_NEWS = ["季報不如預期", "傳出設備故障與停工", "被調降投資評等", "新產品推出延期", "原料漲價侵蝕獲利"];

/** 這一小時有沒有「消息」：機率與幅度由種子決定（純函式） */
export function eventAtHour(g: StockGroup, seed: number, hour: number): MarketEvent | null {
  const gh = strHash(g.key);
  if (rnd(seed, gh, hour, 40) >= EVENT_PROB) return null;
  const up = rnd(seed, gh, hour, 41) < 0.5;
  const size = 6 + rnd(seed, gh, hour, 42) * 6;
  const list = up ? GOOD_NEWS : BAD_NEWS;
  const phrase = list[Math.floor(rnd(seed, gh, hour, 43) * list.length)]!;
  return { hour, at: MARKET_START_MS + hour * MARKET_STEP_MS, pct: Math.round((up ? size : -size) * 10) / 10, text: `${g.name}${phrase}` };
}

export const hourOfMs = (ms: number): number => Math.max(0, Math.floor((ms - MARKET_START_MS) / MARKET_STEP_MS));
export const msOfHour = (hour: number): number => MARKET_START_MS + hour * MARKET_STEP_MS;

/**
 * 價格引擎：從世界起點逐小時累加，結果只取決於 (種子, 伺服器時鐘)。
 * 記憶體快取已算過的點；要更早或更晚的點時再往後延伸。
 */
/** v1 引擎只算既有 16 檔（價格歷史凍結） */
const LEGACY_GROUPS = STOCK_GROUPS.slice(0, LEGACY_STOCK_COUNT);

export class PriceEngine {
  private readonly xs = new Map<string, number[]>();
  private readonly levelCache = new Map<string, number>();

  constructor(
    readonly seed: number,
    private readonly clock: ServerClock = DEFAULT_SERVER_CLOCK,
  ) {
    for (const g of LEGACY_GROUPS) this.xs.set(g.key, [0]);
  }

  /** 世界訊號對這一小時價格的影響（對數尺度）：近 3 個遊戲日（今天、昨天、前天）已發生訊號的加權平均 */
  private level(g: StockGroup, hour: number): number {
    if (g.signals.length === 0) return 0;
    const day = dayOfTick(serverTickAt(msOfHour(hour), this.clock));
    const ck = `${g.key}|${day}`;
    const hit = this.levelCache.get(ck);
    if (hit !== undefined) return hit;
    const v = signalLevel(g.signals, day);
    if (this.levelCache.size > 20_000) this.levelCache.clear();
    this.levelCache.set(ck, v);
    return v;
  }

  private extend(hour: number): void {
    if (hour > MAX_STEPS) throw new Error("market horizon too far");
    for (const g of LEGACY_GROUPS) {
      const xs = this.xs.get(g.key)!;
      const gh = strHash(g.key);
      while (xs.length <= hour) {
        const h = xs.length; // 要算的這一小時
        const prev = xs[h - 1]!;
        const market = MARKET_SIGMA * gauss(this.seed, 0, h, 10);
        const own = g.sigma * gauss(this.seed, gh, h, 20);
        const ev = eventAtHour(g, this.seed, h);
        const jump = ev ? Math.log(1 + ev.pct / 100) : 0;
        xs.push(clamp(prev * (1 - KAPPA) + g.beta * market + own + jump, -X_LIMIT, X_LIMIT));
      }
    }
  }

  /** 第 hour 小時的價格（整數日圓） */
  priceAt(key: string, hour: number): number {
    const g = stockGroupOf(key);
    if (!g || !this.xs.has(key)) throw new Error(`unknown stock ${key}`);
    const h = Math.max(0, Math.floor(hour));
    this.extend(h);
    const x = this.xs.get(key)![h]!;
    return Math.max(MARKET_MIN_PRICE, Math.round(g.base * Math.exp(x + this.level(g, h))));
  }

  /** 第 hour 小時的隨機遊走偏離（對數；v2 引擎在切換點從這裡接續） */
  deviationAt(key: string, hour: number): number {
    if (!this.xs.has(key)) return 0;
    const h = Math.max(0, Math.floor(hour));
    this.extend(h);
    return this.xs.get(key)![h]!;
  }

  /** from（含）到 to（含）的價格點 */
  series(key: string, from: number, to: number): number[] {
    const out: number[] = [];
    for (let h = Math.max(0, from); h <= to; h++) out.push(this.priceAt(key, h));
    return out;
  }

  /** from 到 to 之間發生的消息 */
  events(key: string, from: number, to: number): MarketEvent[] {
    const g = stockGroupOf(key);
    if (!g || !this.xs.has(key)) return [];
    const out: MarketEvent[] = [];
    for (let h = Math.max(1, from); h <= to; h++) {
      const e = eventAtHour(g, this.seed, h);
      if (e) out.push(e);
    }
    return out;
  }
}

// ───────── 買賣試算 ─────────

/** 手續費（無條件進位到整數元） */
export const marketFee = (amount: number): number => Math.ceil(amount * MARKET_FEE_RATE);

export interface BuyQuote {
  cost: number;
  fee: number;
  /** 錢包要付的總額 */
  total: number;
}

export function buyQuote(price: number, shares: number): BuyQuote {
  const cost = price * shares;
  const fee = marketFee(cost);
  return { cost, fee, total: cost + fee };
}

export interface SellQuote {
  proceeds: number;
  fee: number;
  /** 這些股份的平均成本 */
  costBasis: number;
  /** 已實現損益（扣手續費後；負數＝虧損） */
  gain: number;
  tax: number;
  /** 進錢包的 */
  net: number;
}

/** 賣出 shares 股：成本用平均成本法，只有獲利才課稅（虧損不退稅、也不和其他持股相抵） */
export function sellQuote(price: number, shares: number, pos: { shares: number; costTotal: number }): SellQuote {
  const proceeds = price * shares;
  const fee = marketFee(proceeds);
  const costBasis = pos.shares > 0 ? Math.round((pos.costTotal * shares) / pos.shares) : 0;
  const gain = proceeds - fee - costBasis;
  const tax = gain > 0 ? Math.floor(gain * MARKET_TAX_RATE) : 0;
  return { proceeds, fee, costBasis, gain, tax, net: proceeds - fee - tax };
}

// ───────── 給畫面的型別 ─────────

export interface MarketRow {
  key: string;
  name: string;
  sector: string;
  /** 板塊（不含性格），給篩選用 */
  sectorName: string;
  kind: StockKind;
  tier: string;
  blurb: string;
  /** 它會跟著哪些世界訊號起伏（給玩家讀的標籤） */
  watch: string[];
  /** 現價（休市時＝最近一次收盤／午休價） */
  price: number;
  /** 還沒上市（v2 起點之前）：不能交易，價格是基準價 */
  listed: boolean;
  /** 前日收盤 */
  prevClose: number;
  /** 較前日收盤的漲跌幅（%，2 位小數） */
  change: number;
  /** 今日開高低（還沒開盤時為前一個交易日） */
  open: number;
  high: number;
  low: number;
  /** 制限值幅（今日可波動的上下限價） */
  limitUp: number;
  limitDown: number;
  /** 市值（現價 × 流通股數） */
  cap: number;
  /** 年配息率（占基準價） */
  divYield: number;
  /** 迷你走勢圖（最近約 30 個交易日的收盤，最後一點是現價） */
  spark: number[];
  /** 我持有幾股 */
  held: number;
  /** 最近一次消息 */
  news: { text: string; at: number; pct: number } | null;
}

export interface IndexQuote {
  id: "dw40" | "dwpix";
  name: string;
  value: number;
  prevClose: number;
  /** 漲跌幅（%） */
  change: number;
  spark: number[];
}

export interface MarketOrderView {
  id: number;
  key: string;
  name: string;
  side: "buy" | "sell";
  shares: number;
  status: "open" | "filled" | "cancelled" | "rejected";
  createdAt: number;
  settledAt: number | null;
  price: number | null;
  note: string;
}

export interface MarketView {
  /** 這個價格是哪一刻的（ms） */
  at: number;
  rows: MarketRow[];
  indices: IndexQuote[];
  /** 市場狀態（開休市、下次開市的真實時間） */
  status: MarketStatus;
  /** 我的預約單（未成交的與最近成交的） */
  orders: MarketOrderView[];
  /** 我的個人錢包 */
  wallet: number;
  /** 這個遊戲日已經買進多少（不含手續費） */
  boughtToday: number;
  dailyBuyLimit: number;
  holdCap: number;
  feeRate: number;
  taxRate: number;
}

export type MarketRange = "1d" | "5d" | "1m" | "3m" | "all";

export interface MarketHistory {
  key: string;
  name: string;
  range: MarketRange;
  /** intraday＝每個價格步一點（1 真實分鐘）；daily＝每個交易日一點（含 OHLC） */
  kind: "intraday" | "daily";
  points: { at: number; price: number; open?: number; high?: number; low?: number }[];
  /** 前日收盤（1d 的基準線） */
  prevClose: number | null;
  events: { id: string; at: number; pct: number; text: string; body: string; scope: string }[];
}

/** 消息串的一則（全市場） */
export interface MarketNewsItem {
  id: string;
  at: number;
  scope: "stock" | "sector" | "macro";
  /** 標的鍵（stock）、板塊名（sector）、null（macro） */
  target: string | null;
  /** 顯示用的主體名稱（公司、板塊或「市場全體」） */
  subject: string;
  pct: number;
  headline: string;
  body: string;
  sentiment: string;
  phase: string | null;
}

export interface PositionView {
  key: string;
  name: string;
  sector: string;
  shares: number;
  /** 買進成本合計（含手續費） */
  costTotal: number;
  avgCost: number;
  price: number;
  /** 市值 */
  value: number;
  /** 未實現損益（市值 − 成本；未扣賣出手續費與稅） */
  pnl: number;
  pnlPct: number;
}

export interface PortfolioView {
  positions: PositionView[];
  /** 市值合計 */
  value: number;
  /** 成本合計 */
  cost: number;
  pnl: number;
}

export interface TradeResult {
  key: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  fee: number;
  tax: number;
  /** 錢包變動（買為負、賣為正） */
  cash: number;
  /** 賣出的已實現損益 */
  gain: number;
}

export const MARKET_TEXT = {
  what: "這裡的集團是虛構的，和商場無關——玩家現在經營的是「百貨」，將來才會長成「集團」。你只是用個人錢包投資，試著賺一點。",
  hours: "市場依東京證券交易所的時間開市（用遊戲內的日本時間）：平日 9:00–11:30、12:30–15:30，週末、國定假日、12/31–1/3 休市。遊戲時間每真實 1 分鐘走 6 分鐘，所以一個遊戲日（4 真實小時）裡只有約 55 分鐘開市。休市時價格不動，消息照常發生，到下次開盤用跳空反映；休市時可以下「預約單」，開盤用開盤價成交。",
  price: "開市時每真實 1 分鐘更新一次價格，由隨機波動、偶發的消息，以及遊戲世界已經發生的日曆與天氣共同決定。單日漲跌幅有限制（±15%）。世界訊號只佔一小部分，不保證獲利；長期有微弱的回歸基準價的傾向，但這不是穩賺的套利。",
  friction: `買、賣各收 ${MARKET_FEE_RATE * 100}% 手續費；賣出的獲利要課 ${(MARKET_TAX_RATE * 100).toFixed(3)}% 所得稅（虧損不退、不相抵）；有配息的標的在除權息日把配息入帳（同樣課稅）；每個遊戲日最多買進 ${MARKET_DAILY_BUY_LIMIT.toLocaleString()} 日圓，單一集團持股市值最多 ${MARKET_HOLD_CAP.toLocaleString()} 日圓；不能放空。`,
} as const;
