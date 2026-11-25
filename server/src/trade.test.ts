import { afterEach, describe, expect, it } from "vitest";
import { TRADE_FEE, TRADE_KEEP_FUNDS, TRADE_MAX_PER_DAY, STARTER_QUESTS, WORLD_EPOCH_MS, afterFee, tradeLimits, type MallState } from "@coidle/shared";
import { buildApp } from "./app";
import { applyMail } from "./sim/mail";
import { createInitialState } from "./sim";
import { calm } from "./testutil";

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
  return { cookie, id: me.user.id as number, name: username };
}
const post = (a: App, cookie: string, url: string, payload: unknown = {}) => a.app.inject({ method: "POST", url, headers: { cookie }, payload: payload as object });

/** 兩座商場；在內部把資金與庫存調成想要的樣子 */
async function pair(a: App, fundsA = 20_000_000, fundsB = 1_000_000) {
  const u1 = await reg(a, "alice");
  const u2 = await reg(a, "bob");
  const m1 = a.service.createMall(u1.id, "甲商場").mallId;
  const m2 = a.service.createMall(u2.id, "乙商場").mallId;
  calm(a.service, m1, m2);
  const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
  for (const [id, funds] of [[m1, fundsA], [m2, fundsB]] as const) {
    const s = structuredClone(a.service.sync(id));
    s.funds = funds;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    cache.set(id, s);
  }
  return { u1, u2, m1, m2, cache };
}

describe("sending funds", () => {
  it("takes the full amount, delivers 95%, and the partner sees it as a notice", async () => {
    const a = make();
    const t = await pair(a);
    const f1 = a.service.sync(t.m1).funds;
    const f2 = a.service.sync(t.m2).funds;
    const r = await post(a, t.u1.cookie, `/api/malls/${t.m1}/world/trade/funds`, { target: `m:${t.m2}`, amount: 300_000 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ sent: 300_000, received: afterFee(300_000) });
    expect(afterFee(300_000)).toBe(300_000 * (1 - TRADE_FEE));
    const s1 = a.service.sync(t.m1);
    const s2 = a.service.sync(t.m2);
    expect(f1 - s1.funds).toBeGreaterThanOrEqual(300_000 - 1);
    expect(s2.funds - f2).toBeGreaterThanOrEqual(afterFee(300_000) - 1);
    expect(s2.world.notices[0]!.text).toContain("甲商場");
    expect(a.repo.recentTrades(5)[0]).toMatchObject({ from_mall: t.m1, to_mall: t.m2, kind: "funds", amount: 300_000 });
  });

  it("enforces minimums, per-transaction, daily and net-flow limits, and keeps a reserve", async () => {
    const a = make();
    const t = await pair(a, 500_000_000);
    const lim = tradeLimits(1);
    const url = `/api/malls/${t.m1}/world/trade/funds`;
    const go = (amount: unknown) => post(a, t.u1.cookie, url, { target: `m:${t.m2}`, amount });
    expect((await go(500)).statusCode).toBe(400); // 太少
    expect((await go(12_345.5)).statusCode).toBe(400); // 不是整數
    expect((await go("1e9")).statusCode).toBe(400);
    expect((await go(lim.fundsPerTx + 1)).statusCode).toBe(400); // 單筆上限
    expect((await go(lim.fundsPerTx)).statusCode).toBe(200);
    expect((await go(lim.fundsPerTx)).statusCode).toBe(200);
    // 每日上限（800k）：第 3 筆 400k 超過
    const over = await go(lim.fundsPerTx);
    expect(over.statusCode).toBe(400);
    expect(over.json().error).toContain("每天最多");

    // 隔天可以繼續，但 7 天淨流量上限（3M）會擋住長期灌錢
    let sent = 800_000;
    let blocked = false;
    for (let day = 1; day <= 6 && !blocked; day++) {
      clock.t += DAY + 1000;
      for (let i = 0; i < 2; i++) {
        const r = await go(lim.fundsPerTx);
        if (r.statusCode === 200) sent += lim.fundsPerTx;
        else {
          blocked = true;
          expect(r.json().error).toMatch(/淨支援|每天最多/);
        }
      }
    }
    expect(blocked).toBe(true);
    expect(sent).toBeLessThanOrEqual(lim.fundsNet);
  });

  it("refuses to leave the sender with less than the reserve, and refuses strangers, NPCs and self", async () => {
    const a = make();
    const t = await pair(a, TRADE_KEEP_FUNDS + 100_000);
    const url = `/api/malls/${t.m1}/world/trade/funds`;
    expect((await post(a, t.u1.cookie, url, { target: `m:${t.m2}`, amount: 150_000 })).statusCode).toBe(400);
    expect((await post(a, t.u1.cookie, url, { target: `m:${t.m2}`, amount: 100_000 })).statusCode).toBe(200);
    expect((await post(a, t.u1.cookie, url, { target: "n:harbor", amount: 50_000 })).statusCode).toBe(400);
    expect((await post(a, t.u1.cookie, url, { target: `m:${t.m1}`, amount: 50_000 })).statusCode).toBe(400);
    expect((await post(a, t.u1.cookie, url, { target: "m:9999", amount: 50_000 })).statusCode).toBe(404);
    const stranger = await reg(a, "mallory");
    expect((await post(a, stranger.cookie, url, { target: `m:${t.m2}`, amount: 50_000 })).statusCode).toBe(403);
    expect((await post(a, t.u2.cookie, url, { target: `m:${t.m1}`, amount: 50_000 })).statusCode).toBe(403); // 乙的成員不能動甲的錢
  });

  it("ping-ponging money loses 5% each hop, so round trips never gain", async () => {
    const a = make();
    const t = await pair(a, 50_000_000, 50_000_000);
    const total0 = a.service.sync(t.m1).funds + a.service.sync(t.m2).funds;
    for (let i = 0; i < 3; i++) {
      await post(a, t.u1.cookie, `/api/malls/${t.m1}/world/trade/funds`, { target: `m:${t.m2}`, amount: 200_000 });
      await post(a, t.u2.cookie, `/api/malls/${t.m2}/world/trade/funds`, { target: `m:${t.m1}`, amount: 200_000 });
    }
    const total1 = a.service.sync(t.m1).funds + a.service.sync(t.m2).funds;
    expect(total1).toBeLessThan(total0);
    // 次數也有上限
    let blocked = 0;
    for (let i = 0; i < TRADE_MAX_PER_DAY + 2; i++) {
      const r = await post(a, t.u1.cookie, `/api/malls/${t.m1}/world/trade/funds`, { target: `m:${t.m2}`, amount: 10_000 });
      if (r.statusCode === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("sending goods", () => {
  async function stocked(a: App) {
    const t = await pair(a);
    const mutate = (id: number, fn: (s: MallState) => void) => {
      const s = structuredClone(a.service.sync(id));
      fn(s);
      t.cache.set(id, s);
    };
    // 兩邊都有串炸店；甲庫存多、乙缺貨
    mutate(t.m1, (s) => (s.shops.find((x) => x.category === "kushikatsu")!.stock = 1000));
    mutate(t.m2, (s) => (s.shops.find((x) => x.category === "kushikatsu")!.stock = 0));
    const shopA = a.service.sync(t.m1).shops.find((x) => x.category === "kushikatsu")!;
    return { ...t, shopA, mutate };
  }

  it("moves stock (minus the fee) into the partner's shop and counts as a rescue when they were out", async () => {
    const a = make();
    const t = await stocked(a);
    const url = `/api/malls/${t.m1}/world/trade/goods`;
    const before = a.service.sync(t.m2);
    const repBefore = a.service.sync(t.m1).localRep;
    const r = await post(a, t.u1.cookie, url, { target: `m:${t.m2}`, shopId: t.shopA.id, qty: 200 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ sent: 200, received: afterFee(200), rescue: true });
    const sa = a.service.sync(t.m1);
    const sb = a.service.sync(t.m2);
    const shopB = sb.shops.find((x) => x.category === "kushikatsu")!;
    expect(sa.shops.find((x) => x.id === t.shopA.id)!.stock).toBeLessThanOrEqual(800 + 1);
    expect(shopB.stock).toBeGreaterThanOrEqual(afterFee(200) - 1);
    expect(sb.world.notices[0]!.text).toContain("燃眉之急");
    expect(sa.localRep).toBeGreaterThan(repBefore - 1); // 救援小小加口碑
    expect(before.shops.find((x) => x.category === "kushikatsu")!.stock).toBe(0);
  });

  it("validates quantity, stock share, shop type and the recipient's shops", async () => {
    const a = make();
    const t = await stocked(a);
    const url = `/api/malls/${t.m1}/world/trade/goods`;
    const go = (body: object) => post(a, t.u1.cookie, url, { target: `m:${t.m2}`, shopId: t.shopA.id, ...body });
    expect((await go({ qty: 5 })).statusCode).toBe(400);
    expect((await go({ qty: 9999 })).statusCode).toBe(400);
    expect((await go({ qty: 20.5 })).statusCode).toBe(400);
    expect((await go({ qty: 400, shopId: "nope" })).statusCode).toBe(400);
    // 一半以內：庫存 1000 → 400 可以；把庫存降到 100 → 最多轉 50
    t.mutate(t.m1, (s) => (s.shops.find((x) => x.id === t.shopA.id)!.stock = 100));
    expect((await go({ qty: 60 })).statusCode).toBe(400);
    expect((await go({ qty: 40 })).statusCode).toBe(200);
    // 對方沒有這個業態的直營店
    const other = a.service.sync(t.m1).shops.find((x) => x.category === "ramen")!;
    t.mutate(t.m1, (s) => (s.shops.find((x) => x.id === other.id)!.stock = 1000));
    t.mutate(t.m2, (s) => (s.shops = s.shops.filter((x) => x.category !== "ramen")));
    expect((await go({ shopId: other.id, qty: 100 })).statusCode).toBe(400);
  });

  it("has a daily cap per pair", async () => {
    const a = make();
    const t = await stocked(a);
    t.mutate(t.m1, (s) => (s.shops.find((x) => x.id === t.shopA.id)!.stock = 1_000_000));
    const url = `/api/malls/${t.m1}/world/trade/goods`;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post(a, t.u1.cookie, url, { target: `m:${t.m2}`, shopId: t.shopA.id, qty: 400 })).statusCode);
    expect(codes.slice(0, 2)).toEqual([200, 200]); // 800 份
    expect(codes[2]).toBe(400);
  });
});

describe("the directory shows who needs help (a count, not stock numbers)", () => {
  it("counts shops that are out of stock", async () => {
    const a = make();
    const t = await pair(a);
    const s = structuredClone(a.service.sync(t.m2));
    for (const sh of s.shops) sh.stock = 0;
    t.cache.set(t.m2, s);
    // 讓名錄重新整理（每分鐘一次）
    clock.t += 61_000;
    a.service.sync(t.m2);
    const e = a.service.world.entries().find((x) => x.key === `m:${t.m2}`)!;
    expect(e.stockouts).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(e)).not.toMatch(/"stock"/);
  });
});

describe("mail application for trade is clamped", () => {
  const mk = (): MallState => {
    const s = createInitialState(2, 1000, 0);
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    return s;
  };
  it("clamps absurd amounts; goods with no matching shop are returned with a notice", () => {
    const s = mk();
    const f0 = s.funds;
    applyMail(s, { id: 1, kind: "funds_gift", payload: { amount: 9e15, from: "某商場" } });
    expect(s.funds - f0).toBe(20_000_000);
    applyMail(s, { id: 2, kind: "funds_gift", payload: { amount: -500 } });
    expect(s.funds - f0).toBe(20_000_000);

    const shop = s.shops.find((x) => x.category === "kushikatsu")!;
    shop.stock = 0;
    applyMail(s, { id: 3, kind: "goods", payload: { category: "kushikatsu", qty: 9e9, from: "甲" } });
    expect(shop.stock).toBe(2000);
    applyMail(s, { id: 4, kind: "goods", payload: { category: "hotel", qty: 50, from: "甲" } });
    expect(s.world.notices[0]!.text).toContain("沒有地方放");
    applyMail(s, { id: 5, kind: "goods", payload: { category: "kushikatsu", qty: -10 } });
    expect(shop.stock).toBe(2000);
  });
});
