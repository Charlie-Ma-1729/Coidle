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
import { calendarDay } from "./calendar";
import { dayOfTick, serverTickAt, DEFAULT_SERVER_CLOCK, type ServerClock } from "./time";
import { dayWeather } from "./weather";
import { WORLD_EPOCH_MS } from "./world";

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
/** 世界訊號對價格的最大影響（對數尺度，約 ±3%） */
export const SIGNAL_AMPLITUDE = 0.03;
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

// ───────── 世界訊號（都是「某一遊戲日已發生」的值，約 −1 到 1） ─────────

export type SignalId = "travel" | "holiday" | "payday" | "wet" | "extreme" | "heat" | "moving" | "fiscal" | "season" | "yearend";

interface SignalDef {
  label: string;
  fn: (day: number) => number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const SIGNALS: Record<SignalId, SignalDef> = {
  travel: {
    label: "長假與連休",
    fn: (d) => {
      const c = calendarDay(d);
      if (c.tags.includes("golden_week") || c.tags.includes("obon") || c.tags.includes("new_year")) return 1;
      if (c.tags.includes("long_weekend")) return 0.6;
      if (c.tags.includes("year_end")) return 0.4;
      if (c.tags.includes("holiday")) return 0.3;
      if (c.tags.includes("weekend")) return 0.15;
      return 0;
    },
  },
  holiday: {
    label: "假日",
    fn: (d) => {
      const c = calendarDay(d);
      return c.offDay ? (c.streak ? 0.9 : 0.55) : 0;
    },
  },
  payday: { label: "發薪日", fn: (d) => (calendarDay(d).tags.includes("payday") ? 1 : 0) },
  wet: {
    label: "雨天（負面）",
    fn: (d) => {
      const w = dayWeather(d);
      return w.kind === "storm" ? -1 : w.kind === "rain" ? -0.5 : 0;
    },
  },
  extreme: {
    label: "酷暑與嚴寒",
    fn: (d) => {
      const t = dayWeather(d).temp;
      if (t >= 32 || t <= 4) return 1;
      if (t >= 29 || t <= 8) return 0.45;
      return 0;
    },
  },
  heat: { label: "氣溫（越熱越好）", fn: (d) => clamp((dayWeather(d).temp - 18) / 12, -1, 1) },
  moving: { label: "搬家旺季", fn: (d) => (calendarDay(d).tags.includes("moving_season") ? 1 : 0) },
  fiscal: {
    label: "年度末",
    fn: (d) => {
      const m = calendarDay(d).m;
      return m === 3 ? 0.8 : m === 2 ? 0.4 : 0;
    },
  },
  season: {
    label: "換季寒暖差",
    fn: (d) => clamp(Math.abs(dayWeather(d).temp - dayWeather(d - 3).temp) / 8, 0, 1),
  },
  yearend: {
    label: "年末年始",
    fn: (d) => {
      const c = calendarDay(d);
      return c.tags.includes("year_end") || c.tags.includes("new_year") ? 1 : 0;
    },
  },
};

// ───────── 16 家集團 ─────────

export type StockKind = "defensive" | "normal" | "growth";

export const KIND_LABEL: Record<StockKind, string> = { defensive: "防禦型", normal: "一般", growth: "成長型" };
const KIND_SIGMA: Record<StockKind, number> = { defensive: 0.003, normal: 0.0042, growth: 0.006 };
const KIND_BETA: Record<StockKind, number> = { defensive: 0.6, normal: 1, growth: 1.4 };

export interface StockGroup {
  /** 公開的鍵：g:<id> */
  key: string;
  name: string;
  sector: string;
  kind: StockKind;
  /** 一句話介紹 */
  blurb: string;
  /** 起始基準價（日圓） */
  base: number;
  /** 對大盤的敏感度（預設依性格） */
  beta: number;
  /** 個股每小時波動（預設依性格） */
  sigma: number;
  /** 世界訊號與權重 */
  signals: [SignalId, number][];
}

function group(id: string, name: string, sector: string, kind: StockKind, base: number, blurb: string, signals: [SignalId, number][], tweak: { beta?: number; sigma?: number } = {}): StockGroup {
  return { key: `g:${id}`, name, sector, kind, base, blurb, signals, beta: tweak.beta ?? KIND_BETA[kind], sigma: tweak.sigma ?? KIND_SIGMA[kind] };
}

export const STOCK_GROUPS: StockGroup[] = [
  group("hokurei_rail", "北嶺鉄道グループ", "私鐵", "defensive", 2400, "北方沿線的老牌私鐵，沿線有住宅、百貨與遊園地。", [["travel", 0.7], ["payday", 0.3]]),
  group("minato_rail", "湊電鉄グループ", "私鐵", "normal", 1850, "港灣線的私鐵，觀光客多，客流起伏比同業大。", [["travel", 0.8], ["yearend", 0.3]], { sigma: 0.0048 }),
  group("yamato_travel", "大和トラベル", "旅行", "normal", 1320, "連鎖旅行社，團體旅遊與長假行程是主力。", [["travel", 1], ["wet", 0.5]]),
  group("sorakoh_air", "蒼空エアライン", "航空", "normal", 3100, "國內線為主的航空公司，旺季與淡季差距大。", [["travel", 0.9], ["wet", 0.6]]),
  group("momiji_hotels", "紅葉ホテルズ", "飯店", "normal", 2650, "溫泉旅館與商務飯店的連鎖集團。", [["travel", 0.9], ["wet", 0.3]]),
  group("mizuho_energy", "瑞穂エナジー", "電力瓦斯", "defensive", 1780, "區域電力與瓦斯，冷氣與暖氣用得越兇、用量越大。", [["extreme", 1]]),
  group("asagiri_foods", "朝霧フーズ", "食品", "defensive", 960, "冷凍食品與調味料，家庭聚會的日子賣得好。", [["holiday", 0.8], ["travel", 0.2]]),
  group("seiryu_beverage", "清流ビバレッジ", "飲料", "normal", 740, "礦泉水、茶飲與運動飲料，天氣一熱就好賣。", [["heat", 1]]),
  group("hinata_retail", "日向リテール", "超市便利店", "defensive", 1420, "社區超市與便利商店，發薪日與假日客人多。", [["payday", 0.7], ["holiday", 0.5]]),
  group("hoshino_ent", "星野エンタメ", "娛樂", "growth", 1560, "電影院、遊樂場與演唱會製作。", [["holiday", 0.9], ["travel", 0.4]]),
  group("aoba_estate", "あおば不動産", "不動產", "normal", 2980, "住宅開發與仲介，3、4 月搬家季是旺季。", [["moving", 1]]),
  group("takanosu_const", "鷹ノ巣建設", "建設", "normal", 2210, "土木與建築，年度末集中結案，雨天工期延誤。", [["fiscal", 0.9], ["wet", 0.4]]),
  group("shirasagi_pharma", "白鷺製薬", "製藥", "defensive", 4200, "感冒藥與保健品，換季時需求上升。", [["season", 0.8]]),
  group("todai_soft", "灯台ソフト", "資訊科技", "growth", 880, "企業用軟體與雲端服務，股價只看市場情緒。", [], { sigma: 0.0068 }),
  group("tokiwa_fin", "常盤フィナンシャル", "金融", "defensive", 1190, "地方銀行與信用卡，景氣好壞影響大。", [["payday", 0.6], ["yearend", 0.3]], { beta: 1.2, sigma: 0.0034 }),
  group("mitsuhashi_trading", "三津橋商事", "綜合商社", "normal", 1500, "什麼都做一點的商社，股價大致就是大盤。", [], { beta: 1, sigma: 0.0036 }),
];

const GROUP_BY_KEY = new Map(STOCK_GROUPS.map((g) => [g.key, g]));
export const stockGroupOf = (key: string): StockGroup | undefined => GROUP_BY_KEY.get(key);

// ───────── 決定性亂數 ─────────

/** 雜湊：(種子, 字串雜湊, 整數) → 0 到 1 */
function rnd(seed: number, a: number, b: number, salt: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca6b) ^ Math.imul((b | 0) + salt * 0x27d4eb2f, 0xc2b2ae35)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 近似標準常態（四個均勻亂數相加） */
function gauss(seed: number, a: number, b: number, salt: number): number {
  return (rnd(seed, a, b, salt) + rnd(seed, a, b, salt + 1) + rnd(seed, a, b, salt + 2) + rnd(seed, a, b, salt + 3) - 2) / 0.5774;
}

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
export class PriceEngine {
  private readonly xs = new Map<string, number[]>();
  private readonly levelCache = new Map<string, number>();

  constructor(
    readonly seed: number,
    private readonly clock: ServerClock = DEFAULT_SERVER_CLOCK,
  ) {
    for (const g of STOCK_GROUPS) this.xs.set(g.key, [0]);
  }

  /** 世界訊號對這一小時價格的影響（對數尺度）：近 3 個遊戲日（今天、昨天、前天）已發生訊號的加權平均 */
  private level(g: StockGroup, hour: number): number {
    if (g.signals.length === 0) return 0;
    const day = dayOfTick(serverTickAt(msOfHour(hour), this.clock));
    const ck = `${g.key}|${day}`;
    const hit = this.levelCache.get(ck);
    if (hit !== undefined) return hit;
    const raw = (d: number) => g.signals.reduce((a, [id, w]) => a + w * SIGNALS[id].fn(d), 0);
    const tilt = 0.5 * raw(day) + 0.3 * raw(day - 1) + 0.2 * raw(day - 2);
    const v = SIGNAL_AMPLITUDE * clamp(tilt, -1, 1);
    if (this.levelCache.size > 20_000) this.levelCache.clear();
    this.levelCache.set(ck, v);
    return v;
  }

  private extend(hour: number): void {
    if (hour > MAX_STEPS) throw new Error("market horizon too far");
    for (const g of STOCK_GROUPS) {
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
    const g = GROUP_BY_KEY.get(key);
    if (!g) throw new Error(`unknown stock ${key}`);
    const h = Math.max(0, Math.floor(hour));
    this.extend(h);
    const x = this.xs.get(key)![h]!;
    return Math.max(MARKET_MIN_PRICE, Math.round(g.base * Math.exp(x + this.level(g, h))));
  }

  /** from（含）到 to（含）的價格點 */
  series(key: string, from: number, to: number): number[] {
    const out: number[] = [];
    for (let h = Math.max(0, from); h <= to; h++) out.push(this.priceAt(key, h));
    return out;
  }

  /** from 到 to 之間發生的消息 */
  events(key: string, from: number, to: number): MarketEvent[] {
    const g = GROUP_BY_KEY.get(key);
    if (!g) return [];
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
  kind: StockKind;
  blurb: string;
  /** 它會跟著哪些世界訊號起伏（給玩家讀的標籤） */
  watch: string[];
  price: number;
  /** 24 個真實小時的漲跌幅（%，2 位小數） */
  change24h: number;
  /** 最近 48 個價格點（迷你走勢圖） */
  spark: number[];
  /** 我持有幾股 */
  held: number;
  /** 最近一次消息（48 小時內） */
  news: { text: string; at: number; pct: number } | null;
}

export interface MarketView {
  /** 這個價格是哪個小時的（ms） */
  at: number;
  rows: MarketRow[];
  /** 我的個人錢包 */
  wallet: number;
  /** 這個遊戲日已經買進多少（不含手續費） */
  boughtToday: number;
  dailyBuyLimit: number;
  holdCap: number;
  feeRate: number;
  taxRate: number;
}

export interface MarketHistory {
  key: string;
  name: string;
  /** 每小時一個點 */
  points: { at: number; price: number }[];
  events: { at: number; pct: number; text: string }[];
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
  price: "價格每真實 1 小時更新一次，由隨機波動、偶發的消息，以及遊戲世界已經發生的日曆與天氣共同決定。世界訊號只佔一小部分，不保證獲利；長期有微弱的回歸基準價的傾向，但這不是穩賺的套利。",
  friction: `買、賣各收 ${MARKET_FEE_RATE * 100}% 手續費；賣出的獲利要課 ${(MARKET_TAX_RATE * 100).toFixed(3)}% 所得稅（虧損不退、不相抵）；每個遊戲日最多買進 ${MARKET_DAILY_BUY_LIMIT.toLocaleString()} 日圓，單一集團持股市值最多 ${MARKET_HOLD_CAP.toLocaleString()} 日圓；不能放空，也沒有股利。`,
} as const;
