import { randomInt } from "node:crypto";
import {
  KIND_LABEL,
  MARKET_DAILY_BUY_LIMIT,
  MARKET_FEE_RATE,
  MARKET_HOLD_CAP,
  MARKET_TAX_RATE,
  PriceEngine,
  SIGNALS,
  STOCK_GROUPS,
  buyQuote,
  dayOfTick,
  hourOfMs,
  msOfHour,
  sellQuote,
  serverTickAt,
  stockGroupOf,
  type MarketHistory,
  type MarketRow,
  type MarketView,
  type PortfolioView,
  type PositionView,
  type ServerClock,
  type TradeResult,
} from "@coidle/shared";
import type { Repo } from "../db/repo";
import { ServiceError } from "../services/errors";

/** 一次最多買賣多少股（只是擋荒謬的輸入；真正的限制是每日買進與持股市值上限） */
const MAX_SHARES_PER_ORDER = 1_000_000;

/**
 * 股票市場：玩家用個人錢包買賣虛構「集團」的股票。價格由伺服器私有種子與時間決定（見 shared/src/game/market.ts），
 * 不存歷史；只存持倉與成交紀錄。錢包與持倉的變動包在同一個資料庫交易裡。
 */
export class MarketService {
  private cached: { engine: PriceEngine; anchorRealMs: number; anchorTick: number } | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
    private readonly clock: () => ServerClock,
  ) {}

  /** 價格引擎：種子存在 meta（第一次用到時產生），伺服器時鐘變了就重建（價格的世界訊號跟著時鐘走） */
  private engine(): PriceEngine {
    const sc = this.clock();
    if (this.cached && this.cached.anchorRealMs === sc.anchorRealMs && this.cached.anchorTick === sc.anchorTick) return this.cached.engine;
    let raw = this.repo.getMeta("stock_seed");
    if (raw === null) {
      raw = String(randomInt(1, 2_147_483_647));
      this.repo.setMeta("stock_seed", raw);
    }
    const engine = new PriceEngine(Number(raw), sc);
    this.cached = { engine, anchorRealMs: sc.anchorRealMs, anchorTick: sc.anchorTick };
    return engine;
  }

  private hour(): number {
    return hourOfMs(this.now());
  }

  /** 現在是第幾個遊戲日（每日買進上限用） */
  private gameDay(): number {
    return dayOfTick(serverTickAt(this.now(), this.clock()));
  }

  price(key: string): number {
    return this.engine().priceAt(key, this.hour());
  }

  private watchOf(key: string): string[] {
    return (stockGroupOf(key)?.signals ?? []).map(([id]) => SIGNALS[id].label);
  }

  /** 全部集團的現價、24 小時漲跌、迷你走勢；帶上我持有幾股 */
  list(userId: number): MarketView {
    const e = this.engine();
    const h = this.hour();
    const held = new Map(this.repo.positionsOfUser(userId).map((p) => [p.company, p.shares]));
    const rows: MarketRow[] = STOCK_GROUPS.map((g) => {
      const price = e.priceAt(g.key, h);
      const prev = e.priceAt(g.key, Math.max(0, h - 24));
      const news = e.events(g.key, Math.max(1, h - 47), h).at(-1) ?? null;
      return {
        key: g.key,
        name: g.name,
        sector: `${g.sector}・${KIND_LABEL[g.kind]}`,
        kind: g.kind,
        blurb: g.blurb,
        watch: this.watchOf(g.key),
        price,
        change24h: Math.round(((price / prev - 1) * 100) * 100) / 100,
        spark: e.series(g.key, Math.max(0, h - 47), h),
        held: held.get(g.key) ?? 0,
        news: news ? { text: news.text, at: news.at, pct: news.pct } : null,
      };
    });
    return {
      at: msOfHour(h),
      rows,
      wallet: this.repo.walletOf(userId),
      boughtToday: this.repo.boughtOnDay(userId, this.gameDay()),
      dailyBuyLimit: MARKET_DAILY_BUY_LIMIT,
      holdCap: MARKET_HOLD_CAP,
      feeRate: MARKET_FEE_RATE,
      taxRate: MARKET_TAX_RATE,
    };
  }

  /** 一檔股票最近 hours 小時的走勢與消息（最多 30 天） */
  history(key: string, hours = 168): MarketHistory {
    const g = stockGroupOf(key);
    if (!g) throw new ServiceError(404, "找不到這檔股票");
    const e = this.engine();
    const h = this.hour();
    const n = Math.min(Math.max(2, Math.floor(hours) || 168), 24 * 30);
    const from = Math.max(0, h - n + 1);
    return {
      key,
      name: g.name,
      points: e.series(key, from, h).map((price, i) => ({ at: msOfHour(from + i), price })),
      events: e.events(key, Math.max(1, from), h).map((v) => ({ at: v.at, pct: v.pct, text: v.text })),
    };
  }

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

  private assertTrader(userId: number, key: string, shares: unknown): { shares: number; price: number } {
    if (this.repo.userById(userId)?.role === "overseer") throw new ServiceError(403, "管理者帳號不能交易股票");
    if (!stockGroupOf(key)) throw new ServiceError(404, "找不到這檔股票");
    if (typeof shares !== "number" || !Number.isInteger(shares) || shares < 1 || shares > MAX_SHARES_PER_ORDER) throw new ServiceError(400, "股數要是 1 以上的整數");
    return { shares, price: this.price(key) };
  }

  buy(userId: number, key: string, sharesIn: unknown): TradeResult {
    const { shares, price } = this.assertTrader(userId, key, sharesIn);
    const q = buyQuote(price, shares);
    const day = this.gameDay();
    const bought = this.repo.boughtOnDay(userId, day);
    if (bought + q.cost > MARKET_DAILY_BUY_LIMIT) {
      throw new ServiceError(409, `每個遊戲日最多買進 ${MARKET_DAILY_BUY_LIMIT.toLocaleString()}（今天已買 ${bought.toLocaleString()}），明天（約 4 個真實小時內換日）再來`);
    }
    const pos = this.repo.positionOf(userId, key);
    if ((pos.shares + shares) * price > MARKET_HOLD_CAP) {
      throw new ServiceError(409, `單一集團的持股市值最多 ${MARKET_HOLD_CAP.toLocaleString()}，這筆買下去會超過`);
    }
    const wallet = this.repo.walletOf(userId);
    if (wallet < q.total) throw new ServiceError(402, `你的錢包只有 ${wallet.toLocaleString()}，買進要 ${q.total.toLocaleString()}（含手續費 ${q.fee.toLocaleString()}）`);
    const name = stockGroupOf(key)!.name;
    const at = this.now();
    this.repo.tx(() => {
      this.repo.addCash(userId, -q.total, { kind: "stock_buy", note: `${name} ${shares.toLocaleString()} 股 @ ${price.toLocaleString()}（手續費 ${q.fee.toLocaleString()}）`, at });
      this.repo.setPosition(userId, key, pos.shares + shares, pos.costTotal + q.total);
      this.repo.addStockTrade({ userId, company: key, side: "buy", shares, price, fee: q.fee, tax: 0, day, at });
    });
    return { key, side: "buy", shares, price, fee: q.fee, tax: 0, cash: -q.total, gain: 0 };
  }

  sell(userId: number, key: string, sharesIn: unknown): TradeResult {
    const { shares, price } = this.assertTrader(userId, key, sharesIn);
    const pos = this.repo.positionOf(userId, key);
    if (pos.shares < shares) throw new ServiceError(409, pos.shares > 0 ? `你只有 ${pos.shares.toLocaleString()} 股` : "你沒有這檔股票");
    const q = sellQuote(price, shares, pos);
    const name = stockGroupOf(key)!.name;
    const at = this.now();
    const day = this.gameDay();
    this.repo.tx(() => {
      this.repo.addCash(userId, q.net, {
        kind: "stock_sell",
        note: `${name} ${shares.toLocaleString()} 股 @ ${price.toLocaleString()}（手續費 ${q.fee.toLocaleString()}，${q.gain >= 0 ? `獲利 ${q.gain.toLocaleString()}，稅 ${q.tax.toLocaleString()}` : `虧損 ${(-q.gain).toLocaleString()}`}）`,
        at,
      });
      this.repo.setPosition(userId, key, pos.shares - shares, pos.costTotal - q.costBasis);
      this.repo.addStockTrade({ userId, company: key, side: "sell", shares, price, fee: q.fee, tax: q.tax, day, at });
    });
    return { key, side: "sell", shares, price, fee: q.fee, tax: q.tax, cash: q.net, gain: q.gain };
  }
}
