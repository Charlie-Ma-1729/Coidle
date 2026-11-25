import { afterEach, describe, expect, it } from "vitest";
import {
  KIND_LABEL,
  MARKET_DAILY_BUY_LIMIT,
  MARKET_HOLD_CAP,
  MARKET_MIN_PRICE,
  MARKET_TAX_RATE,
  PriceEngine,
  SIGNALS,
  STOCK_GROUPS,
  WORLD_EPOCH_MS,
  buyQuote,
  eventAtHour,
  sellQuote,
  stockGroupOf,
  type MallState,
  STARTER_QUESTS,
} from "@coidle/shared";
import { buildApp } from "./app";
import { MIGRATIONS } from "./db/db";
import { calm, overseerLogin } from "./testutil";

// 股票市場：虛構集團的股票，個人錢包買賣。價格是（種子, 時間）的純函式；手續費與稅是唯一的錢的出口；錢包流水要和錢包對得上。

const HOUR = 3_600_000;
const DAY = 86_400_000;
const clock = { t: WORLD_EPOCH_MS + DAY };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + DAY;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;

async function reg(a: App, username: string) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName: username } });
  const cookie = `coidle_sid=${res.cookies.find((x) => x.name === "coidle_sid")!.value}`;
  const me = (await a.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
  return { cookie, id: me.user.id as number };
}
const post = (a: App, cookie: string, url: string, payload: unknown = {}) => a.app.inject({ method: "POST", url, headers: { cookie }, payload: payload as object });
const get = (a: App, cookie: string, url: string) => a.app.inject({ method: "GET", url, headers: { cookie } });
const KEY = STOCK_GROUPS[0]!.key;
const fund = (a: App, userId: number, n: number) => a.repo.addCash(userId, n);
const priceNow = (a: App, key = KEY) => a.service.market.price(key);

describe("price engine", () => {
  it("is deterministic for the same seed and different for another", () => {
    const x = new PriceEngine(12345);
    const y = new PriceEngine(12345);
    const z = new PriceEngine(777);
    const key = STOCK_GROUPS[3]!.key;
    expect(x.series(key, 0, 400)).toEqual(y.series(key, 0, 400));
    expect(x.series(key, 0, 400)).not.toEqual(z.series(key, 0, 400));
    // 先算到很遠再回頭看，和一路算過來一樣
    const w = new PriceEngine(12345);
    w.priceAt(key, 900);
    expect(w.series(key, 0, 400)).toEqual(x.series(key, 0, 400));
    expect(x.series(key, 10, 20)).toEqual([...Array(11).keys()].map((i) => x.priceAt(key, 10 + i)));
  });

  it("keeps every price whole, above the floor, and within a sane band of its base", () => {
    const e = new PriceEngine(4242);
    for (const g of STOCK_GROUPS) {
      for (const p of e.series(g.key, 0, 3000)) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(MARKET_MIN_PRICE);
        expect(p).toBeGreaterThan(g.base * 0.3);
        expect(p).toBeLessThan(g.base * 3);
      }
    }
  });

  it("has defensive stocks that move less than growth stocks", () => {
    const e = new PriceEngine(99);
    const vol = (key: string) => {
      const s = e.series(key, 0, 2400);
      const r = s.slice(1).map((p, i) => Math.log(p / s[i]!));
      const m = r.reduce((a, b) => a + b, 0) / r.length;
      return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
    };
    const calmest = STOCK_GROUPS.filter((g) => g.kind === "defensive").map((g) => vol(g.key));
    const wildest = STOCK_GROUPS.filter((g) => g.kind === "growth").map((g) => vol(g.key));
    expect(Math.max(...calmest)).toBeLessThan(Math.min(...wildest));
  });

  it("produces occasional news, deterministically, with a headline and a size", () => {
    const g = STOCK_GROUPS[5]!;
    const a = Array.from({ length: 3000 }, (_, h) => eventAtHour(g, 31337, h)).filter(Boolean);
    const b = Array.from({ length: 3000 }, (_, h) => eventAtHour(g, 31337, h)).filter(Boolean);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(2);
    expect(a.length).toBeLessThan(30);
    for (const ev of a) {
      expect(Math.abs(ev!.pct)).toBeGreaterThanOrEqual(6);
      expect(Math.abs(ev!.pct)).toBeLessThanOrEqual(12);
      expect(ev!.text.startsWith(g.name)).toBe(true);
    }
  });

  it("reads world signals: golden week lifts travel, wet days weigh on it", () => {
    const goldenWeek = Date.UTC(2027, 4, 3) / DAY;
    expect(SIGNALS.travel.fn(goldenWeek)).toBeGreaterThan(0.3);
    expect(SIGNALS.wet.fn(goldenWeek)).toBeLessThanOrEqual(0);
    for (let d = goldenWeek - 400; d < goldenWeek + 400; d++) for (const s of Object.values(SIGNALS)) expect(Math.abs(s.fn(d))).toBeLessThanOrEqual(1);
  });

  it("has 16 uniquely-keyed groups, all with a label", () => {
    expect(STOCK_GROUPS).toHaveLength(16);
    expect(new Set(STOCK_GROUPS.map((g) => g.key)).size).toBe(16);
    for (const g of STOCK_GROUPS) {
      expect(g.key.startsWith("g:")).toBe(true);
      expect(KIND_LABEL[g.kind]).toBeTruthy();
      expect(stockGroupOf(g.key)).toBe(g);
    }
  });
});

describe("quotes", () => {
  it("charges a fee on both sides and tax only on realized gains", () => {
    const buy = buyQuote(1000, 10);
    expect(buy).toEqual({ cost: 10_000, fee: 50, total: 10_050 });
    const up = sellQuote(1200, 10, { shares: 10, costTotal: 10_050 });
    expect(up).toMatchObject({ proceeds: 12_000, fee: 60, costBasis: 10_050, gain: 1890 });
    expect(up.tax).toBe(Math.floor(1890 * MARKET_TAX_RATE));
    expect(up.net).toBe(12_000 - 60 - up.tax);
    const down = sellQuote(900, 10, { shares: 10, costTotal: 10_050 });
    expect(down.gain).toBeLessThan(0);
    expect(down.tax).toBe(0);
    // 賣一部分：只用那一部分的平均成本
    expect(sellQuote(1000, 5, { shares: 10, costTotal: 10_050 }).costBasis).toBe(5025);
  });
});

describe("trading", () => {
  it("is login-only and lists 16 groups without leaking anything NPC-ish", async () => {
    const a = make();
    expect((await a.app.inject({ method: "GET", url: "/api/market" })).statusCode).toBe(401);
    const u = await reg(a, "alice");
    const view = (await get(a, u.cookie, "/api/market")).json();
    expect(view.rows).toHaveLength(16);
    for (const r of view.rows) {
      expect(r.key.startsWith("g:")).toBe(true);
      expect(r.price).toBeGreaterThanOrEqual(MARKET_MIN_PRICE);
      expect(r.spark.length).toBeGreaterThan(1);
      expect(r.held).toBe(0);
    }
    expect(JSON.stringify(view)).not.toMatch(/n:|seed/);
    expect(a.repo.getMeta("stock_seed")).toBeTruthy();
  });

  it("buys, holds, and sells, moving only the wallet and the position; the fee leaves the game", async () => {
    const a = make();
    const u = await reg(a, "alice");
    fund(a, u.id, 1_000_000);
    const price = priceNow(a);
    const q = buyQuote(price, 20);
    const r = await post(a, u.cookie, `/api/market/${encodeURIComponent(KEY)}/buy`, { shares: 20 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ side: "buy", shares: 20, price, fee: q.fee, cash: -q.total });
    expect(a.repo.walletOf(u.id)).toBe(1_000_000 - q.total);
    expect(a.repo.positionOf(u.id, KEY)).toEqual({ shares: 20, costTotal: q.total });

    // 同一小時內賣回：虧了手續費，不課稅
    const s = await post(a, u.cookie, `/api/market/${encodeURIComponent(KEY)}/sell`, { shares: 20 });
    expect(s.statusCode).toBe(200);
    expect(s.json().tax).toBe(0);
    expect(s.json().gain).toBeLessThan(0);
    expect(a.repo.positionOf(u.id, KEY)).toEqual({ shares: 0, costTotal: 0 });
    const back = sellQuote(price, 20, { shares: 20, costTotal: q.total });
    expect(s.json().cash).toBe(back.net);
    expect(a.repo.walletOf(u.id)).toBe(1_000_000 - q.total + back.net);
    expect(q.fee + back.fee).toBe(1_000_000 - a.repo.walletOf(u.id)); // 來回一圈，少掉的剛好是兩筆手續費
  });

  it("taxes a gain at the capital-gains rate and records it in the ledger", async () => {
    const a = make();
    const u = await reg(a, "alice");
    const price = priceNow(a);
    a.repo.setPosition(u.id, KEY, 100, price * 100 - 50_000); // 假裝成本比現價低 5 萬
    const before = a.repo.walletOf(u.id);
    const r = (await post(a, u.cookie, `/api/market/${encodeURIComponent(KEY)}/sell`, { shares: 100 })).json();
    const q = sellQuote(price, 100, { shares: 100, costTotal: price * 100 - 50_000 });
    expect(r.gain).toBe(q.gain);
    expect(q.gain).toBeGreaterThan(40_000);
    expect(r.tax).toBe(Math.floor(q.gain * MARKET_TAX_RATE));
    expect(a.repo.walletOf(u.id) - before).toBe(q.net);
    const [entry] = a.repo.ledgerOfUser(u.id, 5);
    expect(entry).toMatchObject({ kind: "stock_sell", amount: q.net, balanceAfter: a.repo.walletOf(u.id) });
  });

  it("refuses bad orders with the right status", async () => {
    const a = make();
    const u = await reg(a, "alice");
    const url = (k: string, side: string) => `/api/market/${encodeURIComponent(k)}/${side}`;
    for (const shares of [0, -1, 1.5, "5", null, 2_000_000]) expect((await post(a, u.cookie, url(KEY, "buy"), { shares })).statusCode).toBe(400);
    expect((await post(a, u.cookie, url("g:nope", "buy"), { shares: 1 })).statusCode).toBe(404);
    expect((await post(a, u.cookie, url(KEY, "buy"), { shares: 1 })).statusCode).toBe(402); // 錢包是空的
    expect((await post(a, u.cookie, url(KEY, "sell"), { shares: 1 })).statusCode).toBe(409); // 沒持股
    expect((await a.app.inject({ method: "POST", url: url(KEY, "buy"), payload: { shares: 1 } })).statusCode).toBe(401);
    expect(a.repo.ledgerOfUser(u.id, 5)).toEqual([]);
  });

  it("keeps a daily buying limit that resets with the game day, and a per-company holding cap", async () => {
    const a = make();
    const u = await reg(a, "alice");
    fund(a, u.id, 20_000_000);
    const key = STOCK_GROUPS[13]!.key; // 低價股，方便湊到上限
    const p = priceNow(a, key);
    const url = `/api/market/${encodeURIComponent(key)}/buy`;
    const perOrder = Math.floor(MARKET_HOLD_CAP / p); // 剛好不超過持股上限
    expect((await post(a, u.cookie, url, { shares: perOrder + 1 })).statusCode).toBe(409); // 持股市值上限
    expect((await post(a, u.cookie, url, { shares: Math.floor(MARKET_DAILY_BUY_LIMIT / p) })).statusCode).toBe(200);
    expect((await post(a, u.cookie, url, { shares: Math.floor(MARKET_DAILY_BUY_LIMIT / p) })).statusCode).toBe(409); // 今天的額度用完
    const view = (await get(a, u.cookie, "/api/market")).json();
    expect(view.boughtToday).toBeGreaterThan(MARKET_DAILY_BUY_LIMIT * 0.99);
    // 一個遊戲日（4 個真實小時）之後額度重置
    clock.t += 5 * HOUR;
    expect((await post(a, u.cookie, url, { shares: 10 })).statusCode).toBe(200);
  });

  it("keeps wallet + position cost consistent with the ledger across many trades", async () => {
    const a = make();
    const u = await reg(a, "alice");
    fund(a, u.id, 3_000_000);
    let fees = 0;
    for (let i = 0; i < 12; i++) {
      const key = STOCK_GROUPS[i % 5]!.key;
      const side = i % 3 === 2 ? "sell" : "buy";
      const r = await post(a, u.cookie, `/api/market/${encodeURIComponent(key)}/${side}`, { shares: 10 + i });
      if (r.statusCode === 200) fees += r.json().fee + r.json().tax;
      clock.t += 2 * HOUR;
    }
    const entries = a.repo.ledgerOfUser(u.id, 100);
    expect(entries.length).toBeGreaterThan(3);
    expect(3_000_000 + entries.reduce((x, e) => x + e.amount, 0)).toBe(a.repo.walletOf(u.id));
    expect(entries[0]!.balanceAfter).toBe(a.repo.walletOf(u.id));
    // 錢包加持倉成本，只因手續費與稅（以及賣出時實現的損益）而變；成本沒有憑空變多
    const cost = a.repo.positionsOfUser(u.id).reduce((x, p) => x + p.costTotal, 0);
    expect(a.repo.walletOf(u.id) + cost).toBeLessThanOrEqual(3_000_000 + 1_000_000); // 賣出獲利的上限，粗略檢查不會爆
    expect(fees).toBeGreaterThan(0);
  });

  it("blocks Overseer accounts", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t, "overseer");
    a.repo.addCash(o.userId, 100_000);
    expect((await post(a, o.cookie, `/api/market/${encodeURIComponent(KEY)}/buy`, { shares: 1 })).statusCode).toBe(403);
  });

  it("returns history with points and news, and rejects an unknown company", async () => {
    const a = make();
    const u = await reg(a, "alice");
    clock.t = WORLD_EPOCH_MS + 20 * DAY;
    const h = (await get(a, u.cookie, `/api/market/${encodeURIComponent(KEY)}/history?hours=72`)).json();
    expect(h.points).toHaveLength(72);
    expect(h.points.at(-1).price).toBe(priceNow(a));
    expect(h.points[1].at - h.points[0].at).toBe(HOUR);
    expect((await get(a, u.cookie, "/api/market/g:nope/history")).statusCode).toBe(404);
  });

  it("changes price only on the hour, and the same hour gives the same quote", async () => {
    const a = make();
    clock.t = WORLD_EPOCH_MS + 5 * DAY + 10 * 60_000;
    const p1 = priceNow(a);
    clock.t += 30 * 60_000;
    expect(priceNow(a)).toBe(p1);
  });

  it("counts stocks in wealth, and drops them with the account", async () => {
    const a = make();
    const u = await reg(a, "alice");
    fund(a, u.id, 500_000);
    await post(a, u.cookie, `/api/market/${encodeURIComponent(KEY)}/buy`, { shares: 30 });
    const w = (await get(a, u.cookie, "/api/me/wealth")).json();
    const pf = (await get(a, u.cookie, "/api/me/portfolio")).json();
    expect(pf.positions).toHaveLength(1);
    expect(pf.value).toBe(priceNow(a) * 30);
    expect(w.portfolio).toBe(pf.value);
    expect(w.totalValue).toBe(w.cash + w.portfolio);
    a.service.adminDeleteUser(u.id);
    expect(a.repo.positionsOfUser(u.id)).toEqual([]);
  });
});

describe("wallet ledger", () => {
  it("records every kind of wallet movement so the ledger adds up to the wallet", async () => {
    const a = make();
    const alice = await reg(a, "alice");
    const bob = await reg(a, "bob");
    const A = a.service.createMall(alice.id, "甲商場");
    calm(a.service, A.mallId);
    const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
    const s = structuredClone(a.service.sync(A.mallId));
    s.funds = 10_000_000;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    cache.set(A.mallId, s);
    a.service.joinMall(A.inviteCode, bob.id, "ops", 8);
    a.repo.setShares(A.mallId, alice.id, 6000);
    a.repo.setShares(A.mallId, bob.id, 4000);
    const start = 800_000;
    fund(a, bob.id, start);
    fund(a, alice.id, start);

    // 股利（alice 管事：她持股過半）
    expect((await post(a, alice.cookie, `/api/malls/${A.mallId}/dividend`, { amount: 100_000 })).statusCode).toBe(200);
    // 撤資
    expect((await post(a, bob.cookie, `/api/malls/${A.mallId}/shares/buyback`, { shares: 100 })).statusCode).toBe(200);
    // 賣給其他股東
    const offer = (await post(a, bob.cookie, `/api/malls/${A.mallId}/shares/offer`, { userId: alice.id, shares: 200 })).json().offers.at(-1);
    expect((await post(a, alice.cookie, `/api/shares/offers/${offer.id}/respond`, { accept: true })).statusCode).toBe(200);
    // 注資換股（bob 申請、alice 核准）
    const req = await post(a, bob.cookie, `/api/malls/${A.mallId}/capital`, { amount: 100_000 });
    expect(req.statusCode).toBe(200);
    const pending = (await get(a, alice.cookie, `/api/malls/${A.mallId}/shares/offers`)).json().requests[0];
    expect((await post(a, alice.cookie, `/api/capital/${pending.id}/respond`, { accept: true })).statusCode).toBe(200);
    // 開新商場的創業資金（先補足錢包）
    fund(a, bob.id, 2_000_000);
    a.repo.bumpFounded(bob.id);
    a.service.chargeFounding(bob.id);
    // 買賣股票
    await post(a, bob.cookie, `/api/market/${encodeURIComponent(KEY)}/buy`, { shares: 15 });

    const kinds = (id: number) => new Set(a.repo.ledgerOfUser(id, 100).map((e) => e.kind));
    expect(kinds(bob.id)).toEqual(new Set(["dividend", "buyback", "share_sale", "capital", "founding", "stock_buy"]));
    expect(kinds(alice.id)).toEqual(new Set(["dividend", "share_buy"]));
    // 流水加總 + 手動補的錢 = 錢包；最新一筆的 balanceAfter = 錢包
    const manual = (id: number) => (id === bob.id ? start + 2_000_000 : start);
    for (const id of [alice.id, bob.id]) {
      const es = a.repo.ledgerOfUser(id, 100);
      expect(manual(id) + es.reduce((x, e) => x + e.amount, 0)).toBe(a.repo.walletOf(id));
      expect(es[0]!.balanceAfter).toBe(a.repo.walletOf(id));
    }
    const ledger = (await get(a, bob.cookie, "/api/me/ledger?limit=3")).json();
    expect(ledger.entries).toHaveLength(3);
    expect(ledger.entries[0].kind).toBe("stock_buy");
  });

  it("returns a cross-mall personal equity view", async () => {
    const a = make();
    const alice = await reg(a, "alice");
    const bob = await reg(a, "bob");
    const A = a.service.createMall(alice.id, "甲商場");
    const B = a.service.createMall(bob.id, "乙商場");
    calm(a.service, A.mallId, B.mallId);
    a.service.joinMall(A.inviteCode, bob.id, "ops", 8);
    a.repo.setShares(A.mallId, alice.id, 7000);
    a.repo.setShares(A.mallId, bob.id, 3000);
    await post(a, alice.cookie, `/api/malls/${A.mallId}/shares/offer`, { userId: bob.id, shares: 100 });
    const v = (await get(a, bob.cookie, "/api/me/equity")).json();
    expect(v.stakes.map((s: { mallId: number }) => s.mallId).sort()).toEqual([A.mallId, B.mallId].sort());
    expect(v.offers).toHaveLength(1);
    expect(v.offers[0]).toMatchObject({ mallId: A.mallId, fromId: alice.id, toId: bob.id, shares: 100 });
    expect((await get(a, alice.cookie, "/api/me/equity")).json().offers).toHaveLength(1);
  });

  it("lets a holder who is no longer a member read the cap table", async () => {
    const a = make();
    const alice = await reg(a, "alice");
    const bob = await reg(a, "bob");
    const A = a.service.createMall(alice.id, "甲商場");
    a.service.joinMall(A.inviteCode, bob.id, "ops", 8);
    a.repo.setShares(A.mallId, alice.id, 6000);
    a.repo.setShares(A.mallId, bob.id, 4000);
    a.service.kickMember(A.mallId, alice.id, bob.id);
    expect((await get(a, bob.cookie, `/api/malls/${A.mallId}/holdings`)).statusCode).toBe(200);
    const carol = await reg(a, "carol");
    expect((await get(a, carol.cookie, `/api/malls/${A.mallId}/holdings`)).statusCode).toBe(403);
  });
});

describe("migration v13", () => {
  it("creates the market and ledger tables (migration 13)", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(13);
    const a = make();
    const tables = (a.repo.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ["stock_positions", "stock_trades", "wallet_ledger"]) expect(tables).toContain(t);
  });
});
