// 個人財務視窗：總覽、商場股權、股市、明細。DOM 環境在 beforeAll 才載入（理由同 ui.test.tsx）。
import { render } from "preact";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STOCK_GROUPS, type LedgerEntry, type MarketStatus, type MarketView, type PersonalEquityView, type PortfolioView, type WealthView } from "@coidle/shared";

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};
let store: typeof import("./store");
let container: HTMLElement;
const originalFetch = globalThis.fetch;
let calls: { method: string; url: string; body: any }[] = [];

beforeAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost:5173" });
  store = await import("./store");
}, 240_000);

afterAll(async () => {
  globalThis.fetch = originalFetch;
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  await GlobalRegistrator.unregister();
});

const wealth: WealthView = {
  stakes: [{ mallId: 7, mallName: "甲商場", shares: 4000, pct: 40, mallCash: 5_000_000, value: 2_000_000, isMember: true }],
  foundCost: 2_000_000,
  cash: 750_000,
  portfolio: 120_000,
  corporate: 0,
  totalValue: 2_870_000,
};
const equity: PersonalEquityView = {
  stakes: wealth.stakes,
  offers: [{ id: 11, mallId: 7, fromId: 2, fromName: "bob", toId: 1, toName: "我", shares: 300, price: 150_000, expiresAt: Date.now() + 1e8 }],
  requests: [],
};
const row = (i: number, held = 0) => ({
  key: STOCK_GROUPS[i]!.key,
  name: STOCK_GROUPS[i]!.name,
  sector: `${STOCK_GROUPS[i]!.sector}・一般`,
  kind: STOCK_GROUPS[i]!.kind,
  blurb: STOCK_GROUPS[i]!.blurb,
  watch: ["長假與連休"],
  price: 1000 + i,
  sectorName: STOCK_GROUPS[i]!.sector,
  tier: "prime",
  listed: true,
  prevClose: 990 + i,
  change: i % 2 === 0 ? 1.25 : -0.8,
  open: 995 + i,
  high: 1010 + i,
  low: 990 + i,
  limitUp: 1138 + i,
  limitDown: 842 + i,
  cap: (1000 + i) * 300_000_000,
  divYield: 0.02,
  spark: [990, 1000, 1010, 1000 + i],
  held,
  news: null,
});
const openStatus: MarketStatus = { session: "am", open: true, day: 20_000, clock: "10:00", gstep: 4_800_100, nextOpenAt: Date.now() + 3_600_000, nextCloseAt: Date.now() + 900_000, reason: null };
const closedStatus: MarketStatus = { session: "after", open: false, day: 20_000, clock: "17:00", gstep: 4_800_170, nextOpenAt: Date.now() + 3_600_000, nextCloseAt: null, reason: null };
const market: MarketView = {
  at: Date.now(),
  rows: STOCK_GROUPS.map((_, i) => row(i, i === 0 ? 100 : 0)),
  indices: [
    { id: "dw40", name: "大和平均株價", value: 10_123.4, prevClose: 10_000, change: 1.23, spark: [10_000, 10_050, 10_123.4] },
    { id: "dwpix", name: "大和株價指數", value: 1_001.1, prevClose: 1_000, change: 0.11, spark: [1000, 1001.1] },
  ],
  status: openStatus,
  orders: [],
  wallet: 750_000,
  boughtToday: 0,
  dailyBuyLimit: 1_000_000,
  holdCap: 3_000_000,
  feeRate: 0.005,
  taxRate: 0.20315,
};
let marketNow: MarketView = market;
const portfolio: PortfolioView = {
  positions: [{ key: STOCK_GROUPS[0]!.key, name: STOCK_GROUPS[0]!.name, sector: STOCK_GROUPS[0]!.sector, shares: 100, costTotal: 100_500, avgCost: 1005, price: 1000, value: 100_000, pnl: -500, pnlPct: -0.5 }],
  value: 100_000,
  cost: 100_500,
  pnl: -500,
};
const entries: LedgerEntry[] = [
  { id: 3, kind: "stock_buy", amount: -100_500, balanceAfter: 750_000, note: "北嶺 100 股", at: Date.now() },
  { id: 2, kind: "dividend", amount: 80_000, balanceAfter: 850_500, note: "甲商場", at: Date.now() - 1000 },
  { id: 1, kind: "buyback", amount: 500_000, balanceAfter: 770_500, note: "甲商場 100 股", at: Date.now() - 2000 },
];

function stubFetch() {
  calls = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const path = u.replace("http://localhost:5173", "");
    calls.push({ method: init?.method ?? "GET", url: path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (path === "/api/me/wealth") return ok(wealth);
    if (path === "/api/me/equity") return ok(equity);
    if (path === "/api/market") return ok(marketNow);
    if (path === "/api/me/corporate") {
      return ok({
        accounts: [{ mallId: 7, mallName: "甲商場", funds: 5_000_000, holdings: [], value: 0, cost: 0, room: 2_000_000, canTrade: true, blocked: null }],
        singleCap: 0.1,
        totalCap: 0.4,
        disclosurePct: 0.05,
        feeRate: 0.005,
        taxRate: 0.20315,
      });
    }
    if (path.startsWith("/api/malls/7/portfolio/")) return ok({ mallId: 7, key: STOCK_GROUPS[0]!.key, side: "buy", shares: 5, price: 1000, fee: 25, tax: 0, cash: -5025, gain: 0 });
    if (path === "/api/me/wealth/history") return ok({ points: [{ day: 19_999, cash: 700_000, stakes: 2_000_000, stocks: 100_000, corporate: 0, total: 2_800_000 }, { day: 20_000, cash: 750_000, stakes: 2_000_000, stocks: 120_000, corporate: 0, total: 2_870_000 }] });
    if (path === "/api/me/stock-summary") return ok({ trades: 2, realized: 12_000, fees: 500, tax: 2_400, dividends: 3_000, unrealized: -500 });
    if (path.startsWith("/api/market/news")) return ok({ items: [{ id: "n1", at: Date.now() - 60_000, scope: "stock", target: STOCK_GROUPS[0]!.key, subject: STOCK_GROUPS[0]!.name, pct: 4.2, headline: `${STOCK_GROUPS[0]!.name}發表亮眼的季報`, body: "營收創新高，公司上調獲利預測。", sentiment: "pos", phase: null }] });
    if (path.endsWith("/order")) return ok({ id: 5, key: STOCK_GROUPS[0]!.key, name: STOCK_GROUPS[0]!.name, side: "buy", shares: 5, status: "open", createdAt: Date.now(), settledAt: null, price: null, note: "" });
    if (path === "/api/me/portfolio") return ok(portfolio);
    if (path.startsWith("/api/me/ledger")) return ok({ entries });
    if (path.includes("/history")) {
      const points = Array.from({ length: 24 }, (_, i) => ({ at: Date.now() - (24 - i) * 3_600_000, price: 1000 + i }));
      return ok({ key: STOCK_GROUPS[0]!.key, name: STOCK_GROUPS[0]!.name, range: "1d", kind: "intraday", points, prevClose: 995, events: [] });
    }
    if (path.includes("/buy") || path.includes("/sell")) return ok({ key: STOCK_GROUPS[0]!.key, side: path.includes("/buy") ? "buy" : "sell", shares: 5, price: 1000, fee: 25, tax: 0, cash: -5025, gain: 0 });
    if (path.startsWith("/api/shares/offers/")) return ok({ mallId: 7 });
    if (path === "/api/malls/7/holdings") {
      return ok({ total: 10_000, relatedAt: 2000, holders: [{ userId: 1, displayName: "我", shares: 4000, pct: 40, isMember: true, isController: false }], people: [{ userId: 1, displayName: "我", isMember: true }, { userId: 2, displayName: "bob", isMember: true }], treasury: 0, mallCash: 5_000_000, sharePrice: 500, dividendMax: 0, dividendReadyAt: 0 });
    }
    return new Response(JSON.stringify({ error: "not stubbed" }), { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  store.toasts.value = [];
  store.user.value = { id: 1, username: "me", displayName: "我", role: "player" };
  store.wealth.value = null;
  store.personalPage.value = null;
  marketNow = market;
  stubFetch();
});
afterEach(() => {
  render(null, container);
});

const buttons = () => Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
const byText = (t: string | RegExp) => buttons().find((b) => (typeof t === "string" ? b.textContent?.trim() === t : t.test(b.textContent ?? "")))!;

async function open(tab?: "overview" | "stakes" | "market" | "ledger") {
  if (tab) store.personalPage.value = { tab };
  const { PersonalWindow } = await import("./screens/Personal");
  render(<PersonalWindow onClose={() => {}} />, container);
  await settle();
}

describe("個人財務視窗", () => {
  it("shows the four tabs and the overview with totals, composition and pending items", async () => {
    await open();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs.join("|")).toMatch(/總覽\|商場股權.*\|股市\|明細/);
    const text = container.textContent ?? "";
    expect(text).toContain("總資產");
    expect(text).toContain("個人錢包");
    expect(text).toContain("商場持股");
    expect(text).toContain("股票市值");
    expect(text).toContain("資產組成");
    expect(text).toContain("資產走勢");
    expect(text).toContain("1 份別人想賣你的股份");
    expect(store.wealth.value?.totalValue).toBe(2_870_000);
  });

  it("lists my stakes, expands one to manage it, and answers an incoming offer", async () => {
    await open("stakes");
    expect(container.textContent).toContain("甲商場");
    expect(container.textContent).toContain("40%");
    expect(container.textContent).toContain("bob 想賣你");
    byText("處理").click();
    await settle();
    expect(calls.some((c) => c.url === "/api/malls/7/holdings")).toBe(true);
    expect(container.textContent).toContain("撤資");
    expect(byText(/出價賣給他/)).toBeTruthy();
    byText("同意").click();
    await settle();
    const call = calls.find((c) => c.url === "/api/shares/offers/11/respond")!;
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ accept: true });
  });

  it("shows the market with all groups and my holdings, and buys from the detail view", async () => {
    await open("market");
    const text = container.textContent ?? "";
    for (const g of STOCK_GROUPS) expect(text).toContain(g.name);
    expect(text).toContain("我的持倉");
    expect(text).toContain("未實現損益");

    const first = container.querySelector(".st-stock") as HTMLElement;
    first.click();
    await settle();
    expect(container.textContent).toContain("買賣");
    const input = container.querySelector('input[aria-label="股數"]') as HTMLInputElement;
    input.value = "5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(container.textContent).toContain("手續費");
    const buy = byText("買進");
    expect(buy.disabled).toBe(false);
    buy.click();
    await settle();
    const call = calls.find((c) => c.method === "POST" && c.url.endsWith("/buy"))!;
    expect(call.url).toContain(encodeURIComponent(STOCK_GROUPS[0]!.key));
    expect(call.body).toEqual({ shares: 5 });
  });

  it("shows the market status bar, indices and the stock summary", async () => {
    await open("market");
    const text = container.textContent ?? "";
    expect(text).toContain("開市中");
    expect(text).toContain("大和平均株價");
    expect(text).toContain("大和株價指數");
    expect(text).toContain("已實現損益");
    byText("消息").click();
    await settle();
    expect(container.textContent).toContain("發表亮眼的季報");
    expect(calls.some((c) => c.url.startsWith("/api/market/news"))).toBe(true);
  });

  it("trades with a mall's company funds when I run the mall", async () => {
    await open("market");
    (container.querySelector(".st-stock") as HTMLElement).click();
    await settle();
    expect(container.textContent).toContain("交易帳戶");
    byText("甲商場（公司資金）").click();
    await settle();
    expect(container.textContent).toContain("用「甲商場」的公司資金投資");
    expect(container.textContent).toContain("大量持有報告");
    const input = container.querySelector('input[aria-label="公司投資股數"]') as HTMLInputElement;
    input.value = "5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    byText("公司買進").click();
    await settle();
    const call = calls.find((c) => c.method === "POST" && c.url.startsWith("/api/malls/7/portfolio/"))!;
    expect(call.url.endsWith("/buy")).toBe(true);
    expect(call.body).toEqual({ shares: 5 });
    expect(calls.some((c) => c.url === `/api/market/${encodeURIComponent(STOCK_GROUPS[0]!.key)}/buy`)).toBe(false);
  });

  it("offers a pre-order instead of buying while the market is closed", async () => {
    marketNow = { ...market, status: closedStatus };
    await open("market");
    expect(container.textContent).toContain("休市");
    (container.querySelector(".st-stock") as HTMLElement).click();
    await settle();
    expect(container.textContent).toContain("預約買賣");
    const input = container.querySelector('input[aria-label="股數"]') as HTMLInputElement;
    input.value = "5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(buttons().some((b) => b.textContent?.trim() === "買進")).toBe(false);
    byText("預約買進").click();
    await settle();
    const call = calls.find((c) => c.method === "POST" && c.url.endsWith("/order"))!;
    expect(call.body).toEqual({ side: "buy", shares: 5 });
    expect(calls.some((c) => c.url.endsWith("/buy"))).toBe(false);
  });

  it("disables buying more than the daily limit or the wallet allows", async () => {
    await open("market");
    (container.querySelector(".st-stock") as HTMLElement).click();
    await settle();
    const input = container.querySelector('input[aria-label="股數"]') as HTMLInputElement;
    input.value = "9999";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(byText("買進").disabled).toBe(true);
    expect(container.textContent).toContain("超過目前能買的上限");
    expect(calls.some((c) => c.url.endsWith("/buy"))).toBe(false);
  });

  it("lists the wallet ledger and filters it by category", async () => {
    await open("ledger");
    const text = () => container.textContent ?? "";
    expect(text()).toContain("買進股票");
    expect(text()).toContain("收到股利");
    expect(text()).toContain("撤資（商場回購）");
    byText("股利").click();
    await settle();
    expect(text()).toContain("收到股利");
    expect(text()).not.toContain("買進股票");
    byText("股票").click();
    await settle();
    expect(text()).toContain("買進股票");
    expect(text()).not.toContain("收到股利");
  });
});
