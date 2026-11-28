import { afterEach, describe, expect, it } from "vitest";
import { CORPORATE_STAKE_CAP_PCT, CORPORATE_TOTAL_CAP_PCT, DIVIDEND_EXEMPT_LOW, DIVIDEND_EXEMPT_MID, STOCK_GROUPS, buyQuote, corporateSellQuote, dividendExemptRatio, stockGroupOf, type MallState } from "@coidle/shared";
import { buildApp } from "./app";
import { createInitialState } from "./sim/state";
import { taxDaily } from "./sim/tax";
import { calm } from "./testutil";

// 法人投資：商場用公司資金買賣上市股票。只有管事的人、開市中、受上限約束；手續費與稅離開遊戲；配息入公司資金。

const MIN = 60_000;
const REAL0 = Date.UTC(2026, 10, 24, 0, 0, 0); // 遊戲 2027-04-01（週四）00:00 JST；1 真實分鐘＝6 遊戲分鐘
const OPEN_T = REAL0 + 100 * MIN; // 4/1 10:00（前場）
const CLOSED_T = REAL0 + 170 * MIN;
const clock = { t: OPEN_T };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = OPEN_T;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  b.repo.setMeta("market_v2_start", String(REAL0));
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
const KEY = "g:minato_reit"; // 流通股最少的一檔
const setFunds = (a: App, mallId: number, funds: number) => {
  const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
  const s = structuredClone(a.service.sync(mallId));
  s.funds = funds;
  cache.set(mallId, s);
};
const fundsOf = (a: App, mallId: number) => a.service.sync(mallId).funds;
const url = (mallId: number, side: "buy" | "sell", key = KEY) => `/api/malls/${mallId}/portfolio/${encodeURIComponent(key)}/${side}`;

async function setup() {
  const a = make();
  const alice = await reg(a, "alice");
  const bob = await reg(a, "bob");
  const A = a.service.createMall(alice.id, "甲商場");
  calm(a.service, A.mallId);
  setFunds(a, A.mallId, 10_000_000);
  return { a, alice, bob, A };
}

describe("法人投資", () => {
  it("lets only the controller trade with company funds, charging the fee out of the mall", async () => {
    const { a, alice, bob, A } = await setup();
    a.service.joinMall(A.inviteCode, bob.id, "ops", 8);
    expect((await post(a, bob.cookie, url(A.mallId, "buy"), { shares: 10 })).statusCode).toBe(403);
    const price = a.service.market.price(KEY);
    const before = fundsOf(a, A.mallId);
    const r = await post(a, alice.cookie, url(A.mallId, "buy"), { shares: 100 });
    expect(r.statusCode).toBe(200);
    const q = buyQuote(price, 100);
    expect(r.json()).toMatchObject({ side: "buy", shares: 100, price, fee: q.fee, cash: -q.total });
    expect(fundsOf(a, A.mallId)).toBe(before - q.total);
    expect(a.repo.mallPositionOf(A.mallId, KEY)).toEqual({ shares: 100, costTotal: q.total });
    // 賣回：獲利才課稅，錢回到公司資金
    const s = await post(a, alice.cookie, url(A.mallId, "sell"), { shares: 100 });
    expect(s.statusCode).toBe(200);
    const back = corporateSellQuote(price, 100, { shares: 100, costTotal: q.total });
    expect(back.tax).toBe(0); // 法人沒有當場扣稅，併入年度所得
    expect(fundsOf(a, A.mallId)).toBe(before - q.total + back.net);
    expect(a.service.sync(A.mallId).today.invest).toBe(back.gain);
    expect(a.repo.mallPositionOf(A.mallId, KEY)).toEqual({ shares: 0, costTotal: 0 });
    expect((await post(a, alice.cookie, url(A.mallId, "sell"), { shares: 1 })).statusCode).toBe(409);
  });

  it("refuses while the market is closed, with bad input, or for a mall you do not run", async () => {
    const { a, alice, bob, A } = await setup();
    expect((await post(a, alice.cookie, url(A.mallId, "buy"), { shares: 0 })).statusCode).toBe(400);
    expect((await post(a, alice.cookie, url(A.mallId, "buy", "g:nope"), { shares: 1 })).statusCode).toBe(404);
    expect((await post(a, bob.cookie, url(A.mallId, "buy"), { shares: 1 })).statusCode).toBe(403);
    clock.t = CLOSED_T;
    const r = await post(a, alice.cookie, url(A.mallId, "buy"), { shares: 1 });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain("休市");
  });

  it("keeps total investments within 40% of the mall's cash", async () => {
    const { a, alice, A } = await setup();
    const price = a.service.market.price(KEY);
    const limit = Math.floor((10_000_000 * CORPORATE_TOTAL_CAP_PCT) / price);
    expect((await post(a, alice.cookie, url(A.mallId, "buy"), { shares: limit + 50 })).statusCode).toBe(409);
    expect((await post(a, alice.cookie, url(A.mallId, "buy"), { shares: limit })).statusCode).toBe(200);
    expect((await post(a, alice.cookie, url(A.mallId, "buy"), { shares: 5 })).statusCode).toBe(409); // 已經滿了
    const v = (await get(a, alice.cookie, "/api/me/corporate")).json();
    expect(v.accounts).toHaveLength(1);
    expect(v.accounts[0]).toMatchObject({ mallId: A.mallId, canTrade: true });
    expect(v.accounts[0].holdings[0]).toMatchObject({ key: KEY, shares: limit });
    expect(v.singleCap).toBe(CORPORATE_STAKE_CAP_PCT);
  });

  it("publishes a no-price-effect disclosure when a holding crosses 5%, and counts investments in wealth", async () => {
    const { a, alice, A } = await setup();
    const g = stockGroupOf(KEY)!;
    setFunds(a, A.mallId, 30_000_000_000);
    const need = Math.floor(g.shares * 0.05) + 1;
    const r = await post(a, alice.cookie, url(A.mallId, "buy"), { shares: need });
    expect(r.statusCode).toBe(200);
    const feed = (await get(a, alice.cookie, "/api/market/news?limit=20")).json().items as { headline: string; pct: number }[];
    const d = feed.find((n) => n.headline.includes("大量持有"));
    expect(d).toBeTruthy();
    expect(d!.pct).toBe(0);
    const w = (await get(a, alice.cookie, "/api/me/wealth")).json();
    expect(w.corporate).toBeGreaterThan(0);
    // 商場估值已含法人持股（holdMark），corporate 只是拆開顯示，不重複加總
    expect(w.totalValue).toBe(w.stakes.reduce((x: number, s: { value: number }) => x + s.value, 0) + w.portfolio + w.cash);
    expect(a.service.sync(A.mallId).holdMark).toBeGreaterThan(0);
    // 賣回 5% 以下 → 「不再大量持有」
    expect((await post(a, alice.cookie, url(A.mallId, "sell"), { shares: 10 })).statusCode).toBe(200);
    const feed2 = (await get(a, alice.cookie, "/api/market/news?limit=20")).json().items as { headline: string }[];
    expect(feed2.some((n) => n.headline.includes("降至 5% 以下"))).toBe(true);
  });

  it("pays dividends in full to the mall's funds, counted as investment income with a 20% exemption (holding ≤ 5%)", async () => {
    const { a, A } = await setup();
    const key = "g:hokurei_rail";
    a.repo.setMallPosition(A.mallId, key, 1000, 2_400_000);
    const before = fundsOf(a, A.mallId);
    a.service.market.tick(); // 4/1 是北嶺鉄道的除權息日
    const per = Math.round((stockGroupOf(key)!.base * stockGroupOf(key)!.divYield) / 2);
    const gross = 1000 * per;
    expect(fundsOf(a, A.mallId) - before).toBeCloseTo(gross, 0); // 不當場扣稅
    const t = a.service.sync(A.mallId).today;
    expect(t.invest).toBe(gross);
    expect(t.investExempt).toBe(Math.floor(gross * DIVIDEND_EXEMPT_LOW));
    a.service.market.tick();
    expect(fundsOf(a, A.mallId) - before).toBeCloseTo(gross, 0); // 冪等
  });

  it("applies the 50% exemption above 5% and rolls investment income into the fiscal-year taxable profit", () => {
    expect(dividendExemptRatio(50, 1000)).toBe(DIVIDEND_EXEMPT_LOW); // 剛好 5%
    expect(dividendExemptRatio(51, 1000)).toBe(DIVIDEND_EXEMPT_MID);
    const s = createInitialState(1, 1);
    taxDaily(s, { date: "2027-05-10", month: 5 } as never, { ...s.today, invest: 1_000_000, investExempt: 200_000 });
    const none = createInitialState(1, 1);
    taxDaily(none, { date: "2027-05-10", month: 5 } as never, { ...none.today });
    expect(s.tax.fy.profit - none.tax.fy.profit).toBe(800_000); // 只計入未豁免的部分
    const loss = createInitialState(1, 1);
    taxDaily(loss, { date: "2027-05-10", month: 5 } as never, { ...loss.today, invest: -300_000 });
    expect(loss.tax.fy.profit - none.tax.fy.profit).toBe(-300_000); // 賣股虧損抵減所得
  });

  it("keeps the 40-stock list consistent with the corporate caps", () => {
    for (const g of STOCK_GROUPS) expect(Math.floor(g.shares * CORPORATE_STAKE_CAP_PCT)).toBeGreaterThan(0);
  });
});
