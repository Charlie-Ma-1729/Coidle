import { afterEach, describe, expect, it } from "vitest";
import { LENDER_ORDER, PRODUCTS, WORLD_EPOCH_MS, underwrite, underwriteInput, type FinanceView, type MallState } from "@coidle/shared";
import { buildApp } from "./app";
import { calm } from "./testutil";

// 金融的伺服器層：只有管事的人能借款與投保；授信氣候由伺服器依該機構的股價決定（前端送的 terms 會被覆蓋）；
// 落後伺服器太多不能借款；融資頁回傳每個產品的預審。

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
const cmd = (a: App, cookie: string, mall: number, command: unknown) => post(a, cookie, `/api/malls/${mall}/commands`, { command });

/** alice 開商場、bob 是成員（沒有管事的權限）；商場先跑幾天產生日報 */
async function setup() {
  const a = make();
  const alice = await reg(a, "alice");
  const bob = await reg(a, "bob");
  const A = a.service.createMall(alice.id, "甲商場");
  calm(a.service, A.mallId);
  a.service.joinMall(A.inviteCode, bob.id, "ops", 8);
  a.repo.setShares(A.mallId, bob.id, 100); // 有股份才能經營；但持股遠低於一半，管事的人仍是創辦人 alice
  const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
  const s0 = structuredClone(a.service.sync(A.mallId));
  s0.funds = 20_000_000;
  cache.set(A.mallId, s0);
  clock.t += 3 * 4 * HOUR; // 3 個遊戲日（6× 時間）
  a.service.sync(A.mallId);
  expect(a.service.sync(A.mallId).reports.length).toBeGreaterThan(0);
  return { a, alice, bob, mall: A.mallId };
}

describe("融資頁與權限", () => {
  it("回傳三家機構的授信氣候與每個產品的預審；只有管事的人 isAuthority", async () => {
    const { a, alice, bob, mall } = await setup();
    const v = (await get(a, alice.cookie, `/api/malls/${mall}/finance`)).json() as FinanceView;
    for (const id of LENDER_ORDER) expect(["loose", "normal", "tight"]).toContain(v.climates[id].level);
    expect(v.quotes.map((q) => q.product)).toEqual(["working", "short", "long", "emergency"]);
    expect(v.isAuthority).toBe(true);
    const vb = (await get(a, bob.cookie, `/api/malls/${mall}/finance`)).json() as FinanceView;
    expect(vb.isAuthority).toBe(false);
  });

  it("非管事的成員不能借款與投保；管事的人可以", async () => {
    const { a, alice, bob, mall } = await setup();
    const denied = await cmd(a, bob.cookie, mall, { type: "takeLoan", product: "working", amount: 500_000 });
    expect(denied.statusCode).toBe(403);
    expect((await cmd(a, bob.cookie, mall, { type: "setBizInsurance", level: 1 })).statusCode).toBe(403);
    const before = a.service.sync(mall).funds;
    const ok = await cmd(a, alice.cookie, mall, { type: "takeLoan", product: "working", amount: 500_000 });
    expect(ok.statusCode).toBe(200);
    expect(Math.round(a.service.sync(mall).funds - before)).toBeGreaterThanOrEqual(499_000);
    expect(a.service.sync(mall).finance!.loans).toHaveLength(1);
    expect((await cmd(a, alice.cookie, mall, { type: "setBizInsurance", level: 1 })).statusCode).toBe(200);
    // 還款誰都可以（只是花公司的錢還公司的債）
    const id = a.service.sync(mall).finance!.loans[0]!.id;
    expect((await cmd(a, bob.cookie, mall, { type: "repayLoan", loanId: id, amount: 100_000 })).statusCode).toBe(200);
  });
});

describe("授信氣候由伺服器決定", () => {
  it("前端送的 terms 會被覆蓋：條款以伺服器算的氣候為準", async () => {
    const { a, alice, mall } = await setup();
    (a.service as unknown as { climateOf: () => { level: string; note: string } }).climateOf = () => ({ level: "tight", note: "測試" });
    const s = a.service.sync(mall);
    const tight = underwrite(underwriteInput(s), "working", "tight", s.finance);
    const loose = underwrite(underwriteInput(s), "working", "loose", s.finance);
    expect(tight.rate).toBeGreaterThan(loose.rate);
    const r = await cmd(a, alice.cookie, mall, { type: "takeLoan", product: "working", amount: 500_000, terms: { climate: "loose" } });
    expect(r.statusCode).toBe(200);
    const loan = a.service.sync(mall).finance!.loans[0]!;
    expect(loan.dailyRate).toBe(tight.rate); // 不是 loose 的利率
  });

  it("授信氣候由伺服器代入的結果也顯示在融資頁，產品對應到該機構", async () => {
    const { a, alice, mall } = await setup();
    (a.service as unknown as { climateOf: (l: string) => { level: string; note: string } }).climateOf = (l) => ({ level: l === "kodama_securities" ? "loose" : "normal", note: "測試" });
    const v = (await get(a, alice.cookie, `/api/malls/${mall}/finance`)).json() as FinanceView;
    expect(v.climates.kodama_securities.level).toBe("loose");
    expect(v.climates.tokiwa_fin.level).toBe("normal");
    const short = v.quotes.find((q) => q.product === "short")!;
    expect(short.climate).toBe("loose");
    expect(PRODUCTS.short.lender).toBe("kodama_securities");
  });
});

describe("金融操作的落後門檻", () => {
  it("商場落後伺服器超過 1 個遊戲日就不能借款（避免用舊資訊套利）", async () => {
    const { a, alice, mall } = await setup();
    a.service.setClock(mall, { id: alice.id, displayName: "alice" }, { paused: true });
    clock.t += 6 * HOUR; // 暫停期間伺服器照走：約 1.5 個遊戲日
    const v = (await get(a, alice.cookie, `/api/malls/${mall}/finance`)).json() as FinanceView;
    expect(v.canTake).toBe(false);
    expect(v.blocked).toContain("落後");
    const r = await cmd(a, alice.cookie, mall, { type: "takeLoan", product: "working", amount: 500_000 });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toContain("落後");
  });
});
