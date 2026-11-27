// 融資與保險頁：授信氣候、預審結果、目前的貸款、重整、營業中斷險。DOM 環境在 beforeAll 才載入（理由同 ui.test.tsx）。
import { render } from "preact";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LENDER_ORDER, PRODUCT_ORDER, PRODUCTS, TICKS_PER_DAY, TICK_MINUTES, underwrite, underwriteInput, type FinanceView, type PublicMallState } from "@coidle/shared";
import { advanceFully, applyCommand, createInitialState } from "../../server/src/sim";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};
let store: typeof import("./store");
let container: HTMLElement;
const originalFetch = globalThis.fetch;
let calls: { method: string; url: string; body: any }[] = [];
let view: FinanceView;
let current: PublicMallState;

function mallState(mutate?: (s: ReturnType<typeof createInitialState>) => void): PublicMallState {
  let s = createInitialState(7, START);
  s.flags.noWorldShocks = true;
  s.funds = 20_000_000;
  s = advanceFully(s, s.tick + 5 * TICKS_PER_DAY);
  mutate?.(s);
  const { seed: _seed, cooldowns: _cd, ...rest } = s;
  return rest;
}

function viewOf(s: PublicMallState, over: Partial<FinanceView> = {}): FinanceView {
  const climates = {} as FinanceView["climates"];
  for (const id of LENDER_ORDER) climates[id] = { level: id === "tokiwa_fin" ? "tight" : "normal", label: id === "tokiwa_fin" ? "授信收緊" : "授信正常", note: "測試" };
  const input = underwriteInput(s as never);
  return {
    climates,
    quotes: PRODUCT_ORDER.map((p) => underwrite(input, p, climates[PRODUCTS[p].lender].level, s.finance)),
    canTake: true,
    blocked: null,
    isAuthority: true,
    ...over,
  };
}

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

function stubFetch() {
  calls = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace("http://localhost:5173", "");
    calls.push({ method: init?.method ?? "GET", url: path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (path === "/api/malls/7/finance") return ok(view);
    if (path === "/api/malls/7/commands") return ok(current);
    return new Response(JSON.stringify({ error: "not stubbed" }), { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  store.toasts.value = [];
  store.mallId.value = 7;
  stubFetch();
});
afterEach(() => {
  render(null, container);
});

async function mountFinance() {
  const { Finance } = await import("./screens/Finance");
  render(<Finance />, container);
  await settle();
}

describe("融資與保險頁", () => {
  it("顯示三家機構與各自的授信氣候，以及每個產品的預審結果", async () => {
    current = mallState();
    store.state.value = current;
    view = viewOf(current);
    await mountFinance();
    const text = container.textContent ?? "";
    for (const name of ["常盤フィナンシャル", "木霊証券", "霞生命保険"]) expect(text).toContain(name);
    expect(text).toContain("授信收緊");
    expect(text).toContain("授信正常");
    expect(text).toContain("週轉貸款");
    expect(text).toContain("短期融資");
    expect(text).toContain("評等");
    expect(calls.some((c) => c.url === "/api/malls/7/finance")).toBe(true);
  });

  it("被婉拒的產品顯示理由、沒有申請按鈕；可核准的有", async () => {
    current = mallState((s) => {
      s.funds = -500_000;
      s.localRep = 5;
      s.touristHeat = 5;
      s.reports = s.reports.map((r) => ({ ...r, profit: -400_000, revenue: 80_000 }));
      s.finance = { loans: [], history: [], score: 5, clearedAt: {}, insurance: 0, claims: {}, restructure: null, totalInterest: 0, totalClaimed: 0, nextId: 1 };
    });
    store.state.value = current;
    view = viewOf(current);
    await mountFinance();
    expect(container.textContent).toContain("會被婉拒");
    expect(container.textContent).toContain("緊急授信");
    expect(container.textContent).toContain("借了就進入重整");
  });

  it("有貸款時列出明細、可以還款；逾期與重整會有明確標示", async () => {
    const base = mallState();
    const applied = applyCommand(structuredClone(base) as never, { type: "takeLoan", product: "working", amount: 1_000_000 });
    expect(applied.ok).toBe(true);
    const withLoan = (applied as { ok: true; state: any }).state;
    withLoan.finance.loans[0].missedDays = 2;
    withLoan.finance.restructure = { since: withLoan.tick, reason: "overdue", forcedShops: [withLoan.shops[0].id], nextRoundTick: withLoan.tick + 100 };
    const { seed: _s, cooldowns: _c, ...pub } = withLoan;
    current = pub;
    store.state.value = current;
    view = viewOf(current);
    await mountFinance();
    const text = container.textContent ?? "";
    expect(text).toContain("目前的貸款");
    expect(text).toContain("逾期 2 期");
    expect(text).toContain("重整中");
    expect(text).toContain(withLoan.shops[0].name);
    expect(text).toContain("全部還清");
  });

  it("投保營業中斷險會送出指令；不是管事的人不能投保", async () => {
    current = mallState();
    store.state.value = current;
    view = viewOf(current);
    await mountFinance();
    const radios = Array.from(container.querySelectorAll('input[name="biz-insurance"]')) as HTMLInputElement[];
    expect(radios.length).toBe(3);
    radios[1]!.click();
    await settle();
    const cmd = calls.find((c) => c.url === "/api/malls/7/commands");
    expect(cmd?.body.command).toEqual({ type: "setBizInsurance", level: 1 });

    render(null, container);
    view = viewOf(current, { isAuthority: false });
    await mountFinance();
    expect(container.textContent).toContain("只有管事的人");
    const again = Array.from(container.querySelectorAll('input[name="biz-insurance"]')) as HTMLInputElement[];
    expect(again.every((r) => r.disabled)).toBe(true);
  });

  it("落後伺服器太多時顯示原因、不能申請", async () => {
    current = mallState();
    store.state.value = current;
    view = viewOf(current, { canTake: false, blocked: "你的商場落後伺服器時間超過 1 個遊戲日" });
    await mountFinance();
    expect(container.textContent).toContain("落後伺服器時間超過 1 個遊戲日");
    const apply = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "申請貸款");
    expect(apply.length).toBeGreaterThan(0);
    expect(apply.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
