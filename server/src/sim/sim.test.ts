import { describe, expect, it } from "vitest";
import { EVENT_BY_ID, TICKS_PER_DAY, TICK_MINUTES, type MallState } from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, stepTick, timeInfo, type Command } from "./index";

/** 2026-03-02（週一）凌晨 0 點（遊戲時鐘）對應的 tick，避開特殊月份事件 */
const START = (Date.UTC(2026, 2, 2, 0, 0, 0) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const DAY = TICKS_PER_DAY;

function run(s: MallState, days: number): MallState {
  return advanceTo(s, s.tick + days * DAY);
}
function must(r: ReturnType<typeof applyCommand>): MallState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
function apply(s: MallState, ...cmds: Command[]): MallState {
  return cmds.reduce((st, c) => must(applyCommand(st, c)), s);
}
function summary(s: MallState) {
  const rs = s.reports;
  return {
    funds: Math.round(s.funds),
    localRep: +s.localRep.toFixed(1),
    touristHeat: +s.touristHeat.toFixed(1),
    cleanliness: +s.cleanliness.toFixed(0),
    equipment: +s.equipment.toFixed(0),
    level: s.level,
    dailyProfit: rs.map((r) => Math.round(r.profit / 1000) + "k").join(" "),
    dailyGroups: rs.map((r) => r.groups).join(" "),
  };
}

describe("time", () => {
  it("maps ticks to JST calendar with weekday/weekend", () => {
    const t = timeInfo(START);
    expect(t.date).toBe("2026-03-02");
    expect(t.hour).toBe(0);
    expect(t.dow).toBe(1); // 週一
    expect(t.weekend).toBe(false);
    expect(timeInfo(START + 5 * DAY).weekend).toBe(true); // 週六
  });
});

describe("determinism and catch-up", () => {
  it("same seed gives identical results", () => {
    const a = run(createInitialState(42, START), 3);
    const b = run(createInitialState(42, START), 3);
    expect(a).toEqual(b);
  });

  it("different seeds diverge", () => {
    const a = run(createInitialState(1, START), 2);
    const b = run(createInitialState(2, START), 2);
    expect(a.funds).not.toBe(b.funds);
  });

  it("one big catch-up equals tick-by-tick advancing", () => {
    const base = createInitialState(7, START);
    const big = advanceTo(base, START + 3 * DAY);
    let small = base;
    for (let t = START + 1; t <= START + 3 * DAY; t += 37) small = advanceTo(small, Math.min(t, START + 3 * DAY));
    small = advanceTo(small, START + 3 * DAY);
    expect(small).toEqual(big);
  });

  it("does not mutate the input state", () => {
    const base = createInitialState(3, START);
    const snapshot = structuredClone(base);
    advanceTo(base, START + DAY);
    expect(base).toEqual(snapshot);
  });
});

describe("economy: default play", () => {
  it("earns money over a week and indices stay in range", () => {
    const s = run(createInitialState(11, START), 7);
    console.log("default 7d:", summary(s));
    expect(s.reports.length).toBeGreaterThanOrEqual(6);
    expect(s.funds).toBeGreaterThan(2_000_000);
    expect(s.localRep).toBeGreaterThan(30);
    expect(s.localRep).toBeLessThanOrEqual(100);
  });

  it("weekend traffic differs from weekday traffic", () => {
    const s = run(createInitialState(11, START), 7);
    // 用日報日期判斷星期
    const dow = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();
    const weekdayGroups = s.reports.filter((r) => ![0, 6].includes(dow(r.date))).map((r) => r.groups);
    const weekendGroups = s.reports.filter((r) => [0, 6].includes(dow(r.date))).map((r) => r.groups);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    console.log("weekday avg groups", avg(weekdayGroups), "weekend avg groups", avg(weekendGroups));
    expect(Math.abs(avg(weekendGroups) - avg(weekdayGroups))).toBeGreaterThan(20);
  });
});

describe("economy: bad settings and absence", () => {
  it("bad settings do clearly worse than defaults, but stay bounded", () => {
    const good = run(createInitialState(11, START), 7);
    let bad = createInitialState(11, START);
    const ids = bad.shops.map((x) => x.id);
    bad = apply(
      bad,
      { type: "setCleaning", level: 0 },
      { type: "setMaintenance", level: 0 },
      ...ids.map((shopId) => ({ type: "setRestock", shopId, rule: { enabled: false } }) as Command),
      ...ids.map((shopId) => ({ type: "setPrice", shopId, price: 99999 }) as Command),
    );
    bad = run(bad, 7);
    console.log("bad 7d:", summary(bad));
    expect(bad.funds).toBeLessThan(good.funds);
    expect(bad.localRep).toBeLessThan(good.localRep);
    // 有下限：不會掉到谷底，也不會變負
    expect(bad.localRep).toBeGreaterThanOrEqual(Math.max(15, 0.3 * bad.peakLocal));
  });

  it("long absence with auto-restock still earns; protection mode stops index decay", () => {
    let s = createInitialState(5, START);
    s = run(s, 20); // 20 個遊戲日完全沒人操作
    console.log("absent 20d:", summary(s), "protection:", s.protection);
    expect(s.protection).toBe(true);
    expect(s.localRep).toBeGreaterThanOrEqual(Math.max(15, 0.3 * s.peakLocal));
    expect(s.touristHeat).toBeGreaterThanOrEqual(Math.max(15, 0.3 * s.peakTourist));
  });

  it("neglect has a mild but real cost: freshness decays and attended play beats absence", () => {
    const absent = run(createInitialState(5, START), 12);
    let attended = createInitialState(5, START);
    for (let d = 0; d < 12; d++) {
      for (const shop of attended.shops) {
        if (shop.freshness < 90 && attended.funds > 300_000) {
          attended = must(applyCommand(attended, { type: "refreshShop", shopId: shop.id }));
        }
      }
      attended = run(attended, 1);
    }
    expect(absent.shops.every((sh) => sh.freshness < 70)).toBe(true);
    expect(attended.shops.every((sh) => sh.freshness > absent.shops[0]!.freshness)).toBe(true);
    expect(attended.localRep).toBeGreaterThan(absent.localRep);
    // 但缺席只是「賺得比較少」，不會破產
    expect(absent.funds).toBeGreaterThan(2_000_000);
  });

  it("refreshShop restores freshness, costs money, and refuses when already fresh", () => {
    let s = run(createInitialState(1, START), 10);
    const shop = s.shops[0]!;
    expect(shop.freshness).toBeLessThan(70);
    const fundsBefore = s.funds;
    s = must(applyCommand(s, { type: "refreshShop", shopId: shop.id }));
    expect(s.shops[0]!.freshness).toBeGreaterThan(shop.freshness);
    expect(s.funds).toBeLessThan(fundsBefore);
    expect(applyCommand(s, { type: "refreshShop", shopId: shop.id }).ok).toBe(false);
  });

  it("daily index drop is capped even with terrible management", () => {
    let s = createInitialState(9, START);
    const ids = s.shops.map((x) => x.id);
    s = apply(s, ...ids.map((shopId) => ({ type: "setPrice", shopId, price: 99999 }) as Command));
    const before = s.localRep;
    s = run(s, 1);
    expect(before - s.localRep).toBeLessThanOrEqual(6.0001);
  });
});

describe("commands", () => {
  it("rejects invalid commands without changing state", () => {
    const s = createInitialState(1, START);
    expect(applyCommand(s, { type: "setPrice", shopId: "nope", price: 100 }).ok).toBe(false);
    expect(applyCommand(s, { type: "setHours", open: 10, close: 12 }).ok).toBe(false);
    expect(applyCommand(s, { type: "buildShop", slot: 9999, category: "ramen" }).ok).toBe(false);
    // 尚未解鎖的區域（1F）不能蓋店
    const f1Slot = s.slots.find((x) => x.zone === "f1")!;
    expect(applyCommand(s, { type: "buildShop", slot: f1Slot.id, category: "fashion" }).ok).toBe(false);
    expect(applyCommand(s, { type: "setLease", shopId: s.shops[0]!.id, enabled: true }).ok).toBe(false);
  });

  it("can build in an empty B1 slot and the shop appears after construction", () => {
    let s = createInitialState(1, START);
    const slot = s.slots.find((x) => x.zone === "b1" && x.shopId === null)!;
    s = must(applyCommand(s, { type: "buildShop", slot: slot.id, category: "udon" }));
    expect(s.shops.length).toBe(5);
    s = run(s, 2);
    expect(s.shops.length).toBe(6);
    expect(s.shops.some((x) => x.category === "udon")).toBe(true);
  });

  it("feature flag unlocks leasing, and leased shops pay rent", () => {
    let s = createInitialState(1, START);
    s.flags["feature:lease"] = true;
    const id = s.shops[0]!.id;
    s = apply(s, { type: "setLease", shopId: id, enabled: true, rent: 80_000, commission: 0.1 });
    s = run(s, 3);
    expect(s.reports.reduce((a, r) => a + r.rentIncome, 0)).toBeGreaterThan(80_000);
  });

  it("zone flag can force-unlock an area for development", () => {
    let s = createInitialState(1, START);
    s.flags["zone:f1"] = true;
    const f1Slot = s.slots.find((x) => x.zone === "f1")!;
    s = must(applyCommand(s, { type: "buildShop", slot: f1Slot.id, category: "fashion" }));
    expect(s.builds.length).toBe(1);
  });
});

describe("events", () => {
  it("events fire over time and choice events fall back to the default when ignored", () => {
    let s = createInitialState(21, START);
    s = run(s, 40);
    const events = s.log.filter((l) => l.kind === "event");
    console.log("events in 40d:", events.length);
    expect(events.length).toBeGreaterThan(10);
    expect(s.pending.length).toBeLessThanOrEqual(3);
  });

  it("player can resolve a pending choice; invalid options are rejected", () => {
    // 逐 tick 推進，直到出現需要玩家回應的選項事件
    const s = createInitialState(21, START);
    for (let i = 0; i < DAY * 60 && s.pending.length === 0; i++) stepTick(s);
    expect(s.pending.length).toBeGreaterThan(0);
    const p = s.pending[0]!;
    expect(applyCommand(s, { type: "resolveEvent", uid: p.uid, optionId: "__bad__" }).ok).toBe(false);
    const def = EVENT_BY_ID[p.defId]!;
    const after = must(applyCommand(s, { type: "resolveEvent", uid: p.uid, optionId: def.choice!.options[0]!.id }));
    expect(after.pending.some((x) => x.uid === p.uid)).toBe(false);
  });
});
