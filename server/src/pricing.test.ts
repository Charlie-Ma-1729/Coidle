import { afterEach, describe, expect, it } from "vitest";
import { WORLD_EPOCH_MS } from "@coidle/shared";
import { buildApp } from "./app";
import { runBot } from "./bots/bots";
import { PRICE_TOLERANCE, priceAcceptance } from "./sim/step";
import { overseerLogin } from "./testutil";

const HOUR = 3_600_000;
const clock = { t: WORLD_EPOCH_MS + 24 * HOUR + 3 * HOUR };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + 24 * HOUR + 3 * HOUR;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;
async function register(a: App, username: string) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123" } });
  return `coidle_sid=${res.cookies.find((x) => x.name === "coidle_sid")!.value}`;
}
const call = (a: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) => a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });

describe("price acceptance: raising every price at once is no longer free money", () => {
  it("customers buy at any price up to the tolerance, then give up faster the more price-sensitive they are", () => {
    expect(priceAcceptance(2.2, 0.5)).toBe(1);
    expect(priceAcceptance(2.2, PRICE_TOLERANCE)).toBe(1);
    const local = [1.3, 1.5, 2, 3].map((r) => priceAcceptance(2.2, r));
    expect(local.every((v, i) => v < 1 && (i === 0 || v < local[i - 1]!))).toBe(true);
    expect(priceAcceptance(2.2, 1.5)).toBeLessThan(priceAcceptance(0.8, 1.5)); // 在地客比觀光客更在意價錢
    expect(priceAcceptance(0.8, 3)).toBeGreaterThan(0); // 但不會變成 0：總有人願意付
  });

  it("bot sweep: a modest markup helps, but doubling or tripling every price earns far less than leaving it at the reference", () => {
    const run = (m: number) => {
      let rev = 0;
      let profit = 0;
      for (const seed of [101, 202]) {
        const r = runBot("lazy", seed, 30, { sampleEvery: 1, mutate: (s) => s.shops.forEach((sh) => (sh.price = Math.round(sh.price * m))) });
        const late = r.samples.filter((x) => x.day >= 15);
        rev += late.reduce((a, x) => a + x.revenue, 0) / late.length;
        profit += late.reduce((a, x) => a + x.profit, 0) / late.length;
      }
      return { rev, profit };
    };
    const base = run(1);
    const modest = run(1.2);
    const double = run(2);
    const triple = run(3);
    expect(modest.rev).toBeGreaterThan(base.rev); // 小幅調漲有賺頭
    expect(double.rev).toBeLessThan(base.rev * 0.8); // 價格翻倍：營收明顯比不漲還低
    expect(triple.profit).toBeLessThan(base.profit * 0.2); // 三倍：幾乎沒有生意
  }, 120_000);
});

describe("balance data: one permanent row per mall per game day", () => {
  it("records each finished game day (price ratio, walkout reasons, per-shop detail), skips sandbox malls, and exports for the Overseer only", async () => {
    const a = make();
    const owner = await register(a, "owner");
    const { id } = (await call(a, owner, "POST", "/api/malls", { name: "數據商場" })).json();
    const other = await register(a, "other");
    const sandbox = (await call(a, other, "POST", "/api/malls", { name: "測試用" })).json().id as number;
    a.repo.setSandbox(sandbox, true);
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { pauseOnEvents: false, speed: "standard" });
    await call(a, other, "POST", `/api/malls/${sandbox}/clock`, { pauseOnEvents: false, speed: "standard" });

    clock.t += 12 * HOUR; // 3 個遊戲日
    await call(a, owner, "GET", `/api/malls/${id}/state`);
    await call(a, other, "GET", `/api/malls/${sandbox}/state`);
    a.service.tickAll();

    const rows = a.repo.balanceRows(0, 1e9);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((r) => r.mall_id))).toEqual(new Set([id])); // 測試商場不記
    expect(rows.map((r) => r.day)).toEqual([...new Set(rows.map((r) => r.day))].sort((x, y) => x - y)); // 每天一列、不重複
    const r = rows[rows.length - 1]!;
    expect(r.members).toBe(1);
    expect(r.price_ratio).toBeCloseTo(1, 1); // 預設標價＝參考價
    expect(r.lost_capacity + r.stockouts + r.price_walks).toBe(r.walkouts);
    const detail = JSON.parse(r.detail_json) as { c: string; pr: number; lv: number }[];
    expect(detail).toHaveLength(r.shops);
    expect(detail.every((x) => x.pr > 0 && x.lv >= 1)).toBe(true);
    expect(r.funds).not.toBeNull(); // 最新一天附現金

    // 再多過幾天：只會增加新的日子，不會重複寫
    const before = rows.length;
    await call(a, owner, "GET", `/api/malls/${id}/state`);
    a.service.tickAll();
    expect(a.repo.balanceRows(0, 1e9).length).toBe(before);
    clock.t += 8 * HOUR;
    await call(a, owner, "GET", `/api/malls/${id}/state`);
    expect(a.repo.balanceRows(0, 1e9).length).toBeGreaterThan(before);

    // 管理 API：只有 Overseer 能看
    expect((await call(a, owner, "GET", "/api/admin/balance")).statusCode).toBe(403);
    const o = await overseerLogin(a);
    const api = (await call(a, o.cookie, "GET", "/api/admin/balance?days=30")).json();
    expect(api.malls).toEqual([{ id, name: "數據商場", sandbox: 0 }]);
    expect(api.rows[0].detail).toHaveLength(5);
    const csv = await call(a, o.cookie, "GET", "/api/admin/balance/export?kind=mall&format=csv");
    expect(csv.headers["content-disposition"]).toContain("coidle-balance-mall");
    expect(csv.body).toContain("mall_id,day,date,level,shops,members,funds,revenue");
    expect(csv.body.split("\n").length).toBeGreaterThan(3);
    const shopCsv = await call(a, o.cookie, "GET", "/api/admin/balance/export?kind=shop&format=csv");
    expect(shopCsv.body).toContain("mall_id,day,date,category,level,price_ratio,units");
    const audit = a.repo.audit({ limit: 10, action: "balance.export" });
    expect(audit.length).toBe(2);
  });
});
