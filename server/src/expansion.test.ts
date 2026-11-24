import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  FAMILY_OF,
  LICENSES,
  STARTER_QUESTS,
  ZONES,
  ZONE_BY_ID,
  assessedValue,
  categoryHasStock,
  consumptionRate,
  expandCost,
  expandInfo,
  expandMinLevel,
  expansionsOf,
  isCategoryAvailable,
  type MallState,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command } from "./sim";

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const mk = (level = 1, funds = 100_000_000): MallState => {
  const s = createInitialState(7, START, 0);
  s.level = level;
  s.funds = funds;
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
  return s;
};
const apply = (s: MallState, c: Command): MallState => {
  const r = applyCommand(s, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const fails = (s: MallState, c: Command): string | null => {
  const r = applyCommand(s, c);
  return r.ok ? null : r.error;
};

describe("category catalogue", () => {
  it("has plenty of variety in every zone", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(80);
    for (const z of ZONES) {
      const n = CATEGORIES.filter((c) => c.zone === z.id).length;
      expect(n, z.id).toBeGreaterThanOrEqual(z.slots - 2); // 就算不擴建也能開出不重複的組合
    }
  });

  it("every category is internally consistent (supply family, level gate, license, prices)", () => {
    for (const c of CATEGORIES) {
      const z = ZONE_BY_ID[c.zone]!;
      if (categoryHasStock(c)) expect(FAMILY_OF[c.id], `${c.id} family`).toBeDefined();
      if (c.minLevel !== undefined) expect(c.minLevel, `${c.id} minLevel`).toBeGreaterThanOrEqual(z.unlockLevel);
      expect(c.refPrice).toBeGreaterThan(0);
      expect(c.costRatio).toBeGreaterThan(0);
      expect(c.costRatio).toBeLessThan(1);
      expect(Object.keys(c.demand).length, `${c.id} demand`).toBeGreaterThanOrEqual(2);
      for (const v of Object.values(c.demand)) expect(v!).toBeLessThanOrEqual(1);
    }
    // 食品業態一定有營業許可
    for (const c of CATEGORIES) {
      if (c.group === "food") expect(LICENSES[c.id], `${c.id} license`).toBeDefined();
    }
    for (const id of Object.keys(LICENSES)) expect(CATEGORIES.some((c) => c.id === id), `license ${id}`).toBe(true);
  });

  it("takeout foods get the reduced consumption tax and insured dental care is non-taxable", () => {
    expect(consumptionRate("onigiri")).toBe(0.08);
    expect(consumptionRate("bakery")).toBe(0.08);
    expect(consumptionRate("dental")).toBe(0);
    expect(consumptionRate("tonkatsu")).toBe(0.1);
  });

  it("new categories are gated by level and cannot be built early", () => {
    let s = mk(2);
    const slot = s.slots.find((x) => x.zone === "b1" && !x.shopId)!;
    expect(isCategoryAvailable(s, "gyoza")).toBe(true);
    expect(isCategoryAvailable(s, "juice_bar")).toBe(false); // Lv.3
    expect(fails(s, { type: "buildShop", slot: slot.id, category: "juice_bar" })).toMatch(/Lv\.3/);
    s = apply(s, { type: "buildShop", slot: slot.id, category: "gyoza" });
    expect(s.builds.length).toBe(1);
    // 區域旗標強制開放時不看業態等級
    s = mk(1);
    s.flags["zone:dining"] = true;
    expect(isCategoryAvailable(s, "kaiseki")).toBe(true);
  });
});

describe("zone expansion", () => {
  it("costs escalate, are capped, and add real slots", () => {
    let s = mk(3, 500_000_000);
    const before = s.slots.filter((x) => x.zone === "b1").length;
    expect(expansionsOf(s, "b1")).toBe(0);
    const c0 = expandCost("b1", 0);
    const c1 = expandCost("b1", 1);
    expect(c1).toBeGreaterThan(c0);
    expect(expandCost("biz", 0)).toBeGreaterThan(c0); // 高樓層更貴

    const f0 = s.funds;
    s = apply(s, { type: "expandZone", zone: "b1" });
    expect(f0 - s.funds).toBe(c0);
    expect(s.slots.filter((x) => x.zone === "b1").length).toBe(before + 1);
    expect(s.slots.every((x, i) => x.id === i)).toBe(true); // 編號 = 陣列位置
    expect(expansionsOf(s, "b1")).toBe(1);
    expect(s.log.some((l) => l.text.includes("擴建完成"))).toBe(true);

    // 新店面真的可以開店
    const fresh = s.slots[s.slots.length - 1]!;
    s = apply(s, { type: "buildShop", slot: fresh.id, category: "gyoza" });
    expect(s.builds.some((b) => b.slot === fresh.id)).toBe(true);

    const max = ZONE_BY_ID.b1!.maxExpand;
    s.level = 8;
    s.funds = 5_000_000_000;
    for (let i = 1; i < max; i++) s = apply(s, { type: "expandZone", zone: "b1" });
    expect(expansionsOf(s, "b1")).toBe(max);
    expect(fails(s, { type: "expandZone", zone: "b1" })).toMatch(/上限/);
  });

  it("is refused when funds are short, the zone is locked or the level is too low", () => {
    const s = mk(1, 1_000_000);
    expect(fails(s, { type: "expandZone", zone: "b1" })).toMatch(/資金/);
    expect(fails(mk(1), { type: "expandZone", zone: "f1" })).toMatch(/尚未解鎖/);
    expect(fails(mk(1), { type: "expandZone", zone: "nowhere" })).toMatch(/無效/);
    // 第 3 次起要更高的商場等級
    let t = mk(1, 500_000_000);
    t = apply(t, { type: "expandZone", zone: "b1" });
    t = apply(t, { type: "expandZone", zone: "b1" });
    expect(expandMinLevel("b1", 2)).toBe(2);
    expect(expandInfo(t, "b1").reason).toMatch(/Lv\.2/);
    expect(fails(t, { type: "expandZone", zone: "b1" })).toMatch(/Lv\.2/);
  });

  it("expansion raises the assessed value for property tax", () => {
    let s = mk(3, 500_000_000);
    const v0 = assessedValue(s);
    s = apply(s, { type: "expandZone", zone: "b1" });
    expect(assessedValue(s) - v0).toBe(expandCost("b1", 0));
  });

  it("simulation keeps working with extra slots (catch-up equals tick-by-tick)", () => {
    let base = mk(3, 500_000_000);
    base = apply(base, { type: "expandZone", zone: "b1" });
    const slot = base.slots[base.slots.length - 1]!;
    base = apply(base, { type: "buildShop", slot: slot.id, category: "taiyaki" });
    const a = advanceTo(base, base.tick + 6 * 288);
    let b = base;
    for (let i = 0; i < 6 * 6; i++) b = advanceTo(b, b.tick + 48);
    expect(b.shops.length).toBe(a.shops.length);
    expect(b.funds).toBeCloseTo(a.funds, 2);
    expect(a.shops.some((x) => x.category === "taiyaki")).toBe(true);
  });

  it("migrates v10 saves by adding the new base slots", () => {
    const v10 = JSON.parse(JSON.stringify(mk())) as Record<string, unknown> & { slots: { id: number; zone: string; shopId: string | null }[] };
    v10.version = 10;
    // 還原成舊版每區店面數（8,8,6,6,6,8,3,5）
    const old: Record<string, number> = { b1: 8, f1: 8, ent: 6, cul: 6, life: 6, dining: 8, plaza: 3, biz: 5 };
    const kept: typeof v10.slots = [];
    const seen: Record<string, number> = {};
    for (const x of v10.slots) {
      seen[x.zone] = (seen[x.zone] ?? 0) + 1;
      if (seen[x.zone]! <= old[x.zone]!) kept.push({ ...x, id: kept.length });
    }
    v10.slots = kept;
    const m = migrateState(v10, 0);
    expect(m.version).toBe(11);
    for (const z of ZONES) expect(m.slots.filter((x) => x.zone === z.id).length).toBe(z.slots);
    expect(m.slots.every((x, i) => x.id === i)).toBe(true);
    // 既有的店仍然指向原本的店面
    for (const sh of m.shops) expect(m.slots[sh.slot]?.shopId).toBe(sh.id);
  });
});
