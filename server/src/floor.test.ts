import { describe, expect, it } from "vitest";
import {
  BIG_UNLOCK,
  CATEGORY_BY_ID,
  FOOTPRINT_BY_CATEGORY,
  DEMOLISH_FEE_RATE,
  OPEN_PLAN_FLAG,
  STARTER_QUESTS,
  ZONES,
  expansionsOf,
  floorArea,
  footprintOf,
  freeCells,
  liveSlots,
  mergeCapacity,
  mergedCount,
  planResize,
  shopWagePerDay,
  shopDemand,
  slotSpan,
  spanCostFactor,
  usedCells,
  type MallState,
  type PersonaId,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command } from "./sim";
import { shopCapacity } from "./sim/state";

// 樓層空地化（階段 C）：格＝slot；span 缺＝1；大店吸收旁邊的空格變墓碑（span 0）。旗標關時行為與以前完全相同。

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const CAT = "grocery";
const ZONE = CATEGORY_BY_ID[CAT]!.zone;
const mk = (open = true): MallState => {
  const s = createInitialState(7, START, 0);
  s.level = 9;
  s.funds = 500_000_000;
  s.flags[`zone:${ZONE}`] = true;
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
  if (open) s.flags[OPEN_PLAN_FLAG] = true;
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
const emptyIn = (s: MallState, zone = ZONE) => liveSlots(s, zone).filter((x) => !x.shopId && !s.builds.some((b) => b.slot === x.id));
/** 蓋滿並完工 */
const finish = (s: MallState): MallState => advanceTo(s, s.tick + 2_000);

describe("floor helpers on legacy saves", () => {
  it("treats a missing span as 1, so area equals the slot count and expansions are unchanged", () => {
    const s = mk(false);
    for (const z of ZONES) {
      expect(floorArea(s, z.id)).toBe(s.slots.filter((x) => x.zone === z.id).length);
      expect(expansionsOf(s, z.id)).toBe(0);
    }
    expect(s.slots.every((x) => x.span === undefined && slotSpan(x) === 1)).toBe(true);
    expect(migrateState(structuredClone(s), 0).slots).toEqual(s.slots); // 遷移不寫入新欄位
  });

  it("keeps old behaviour when the flag is off: no big shops, no demolish", () => {
    const s = mk(false);
    const slot = emptyIn(s)[0]!;
    expect(fails(s, { type: "buildShop", slot: slot.id, category: CAT, span: 2 })).toMatch(/尚未開放/);
    const built = apply(s, { type: "buildShop", slot: slot.id, category: CAT });
    expect(built.slots[slot.id]!.span).toBeUndefined();
    expect(fails(finish(built), { type: "demolishShop", shopId: finish(built).shops.at(-1)!.id })).toMatch(/尚未開放/);
  });
});

describe("big shops", () => {
  it("absorbs a neighbouring empty cell, keeps the area, and charges per cell", () => {
    const s = mk();
    const area = floorArea(s, ZONE);
    const free0 = freeCells(s, ZONE);
    const slot = emptyIn(s).find((x) => planResize(s, x.id, 2).ok)!;
    const cat = CATEGORY_BY_ID[CAT]!;
    expect(footprintOf(cat).options).toContain(2);
    const t = apply(s, { type: "buildShop", slot: slot.id, category: CAT, span: 2 });
    expect(s.funds - t.funds).toBeGreaterThanOrEqual(cat.buildCost * spanCostFactor(2)); // 建造費 ×規模係數（再加許認可規費）
    expect(t.slots[slot.id]!.span).toBe(2);
    expect(t.slots.filter((x) => x.zone === ZONE && x.span === 0)).toHaveLength(1);
    expect(floorArea(t, ZONE)).toBe(area); // 面積不變
    expect(usedCells(t, ZONE)).toBe(usedCells(s, ZONE) + 2);
    expect(freeCells(t, ZONE)).toBe(free0 - 2);
    expect(t.slots.every((x, i) => x.id === i)).toBe(true); // 編號 = 陣列位置
    // 墓碑不是空地：不能在上面開店，也不會被當成招商的空位
    const tomb = t.slots.find((x) => x.span === 0)!;
    expect(fails(t, { type: "buildShop", slot: tomb.id, category: CAT })).toBeTruthy();
    // 完工後帶 span，容量與人事隨它放大
    const done = finish(t);
    const shop = done.shops.find((x) => x.slot === slot.id)!;
    expect(shop.span).toBe(2);
    const plain = { ...shop, span: undefined };
    expect(shopCapacity(shop, done)).toBeGreaterThan(shopCapacity(plain, done));
    expect(shopWagePerDay(done, shop)).toBeGreaterThan(shopWagePerDay(done, plain));
  });

  it("refuses sizes the category does not offer, or when the floor has no room", () => {
    const s = mk();
    const slot = emptyIn(s)[0]!;
    expect(fails(s, { type: "buildShop", slot: slot.id, category: "ramen", span: 2 })).toMatch(/不能開這個大小/);
    // 把同區空格用光，只剩這一格
    // 把同區其他空格都蓋店，這一格就併不起來
    let t = s;
    for (const o of emptyIn(t).filter((x) => x.id !== slot.id)) t = apply(t, { type: "buildShop", slot: o.id, category: CAT });
    expect(planResize(t, slot.id, 2).ok).toBe(false);
    expect(fails(t, { type: "buildShop", slot: slot.id, category: CAT, span: 2 })).toMatch(/空地不夠/);
    // 4 格（2×2）暫不開放
    expect(planResize(s, slot.id, 4).ok).toBe(false);
  });

  it("can pick which empty cell to absorb, records which shop absorbed it, and is capped by the floor layout", () => {
    const s = mk();
    const [a, b, c] = emptyIn(s);
    const t = apply(s, { type: "buildShop", slot: a!.id, category: CAT, span: 2, cells: [c!.id] });
    expect(t.slots[c!.id]!.span).toBe(0);
    expect(t.slots[c!.id]!.into).toBe(a!.id);
    expect(t.slots[b!.id]!.span).toBeUndefined();
    expect(fails(s, { type: "buildShop", slot: a!.id, category: CAT, span: 2, cells: [a!.id] })).toBeTruthy();
    expect(fails(s, { type: "buildShop", slot: a!.id, category: CAT, span: 2, cells: [b!.id, c!.id] })).toBeTruthy();
    expect(fails(s, { type: "buildShop", slot: a!.id, category: CAT, span: 2, cells: [9999] })).toBeTruthy();
    // 版面上限：10 格的區最多併 mergeCapacity(10) 間
    const cap = mergeCapacity(s.slots.filter((x) => x.zone === ZONE).length);
    expect(cap).toBeGreaterThan(0);
    let u = s;
    let made = 0;
    for (;;) {
      const free = emptyIn(u);
      const pick = free.find((x) => planResize(u, x.id, 2).ok);
      if (!pick) break;
      u = apply(u, { type: "buildShop", slot: pick.id, category: CAT, span: 2 });
      made++;
    }
    expect(made).toBe(cap);
    expect(mergedCount(u, ZONE)).toBe(cap);
  });
});

describe("demolish", () => {
  it("returns the cells, charges 25% of the build cost, and has a per-zone cooldown", () => {
    let s = mk();
    const cat = CATEGORY_BY_ID[CAT]!;
    const slot = emptyIn(s).find((x) => planResize(s, x.id, 2).ok)!;
    s = finish(apply(s, { type: "buildShop", slot: slot.id, category: CAT, span: 2 }));
    const shop = s.shops.find((x) => x.slot === slot.id)!;
    const area = floorArea(s, ZONE);
    const before = s.funds;
    const t = apply(s, { type: "demolishShop", shopId: shop.id });
    expect(before - t.funds).toBe(Math.round(cat.buildCost * spanCostFactor(2) * DEMOLISH_FEE_RATE));
    expect(t.shops.some((x) => x.id === shop.id)).toBe(false);
    expect(t.slots[slot.id]!.shopId).toBeNull();
    expect(slotSpan(t.slots[slot.id]!)).toBe(1);
    expect(t.slots.filter((x) => x.zone === ZONE && x.span === 0)).toHaveLength(0); // 格子還回來了
    expect(floorArea(t, ZONE)).toBe(area);
    // 冷卻：同一區一個遊戲日內不能再拆
    const other = emptyIn(t)[0]!;
    const t2 = finish(apply(t, { type: "buildShop", slot: other.id, category: CAT }));
    const shop2 = t2.shops.find((x) => x.slot === other.id)!;
    t2.demolishAt = { [ZONE]: t2.tick };
    expect(fails(t2, { type: "demolishShop", shopId: shop2.id })).toMatch(/隔一個遊戲日/);
  });

  it("is deterministic and equals a split advance", () => {
    const base = mk();
    const slot = emptyIn(base).find((x) => planResize(base, x.id, 2).ok)!;
    const built = apply(base, { type: "buildShop", slot: slot.id, category: CAT, span: 2 });
    const one = advanceTo(structuredClone(built), built.tick + 600);
    const two = advanceTo(advanceTo(structuredClone(built), built.tick + 250), built.tick + 600);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });
});

describe("expansion vs. merged big shops", () => {
  it("blocks an expansion that would turn the layout into the island type and no longer fit the existing big shops", () => {
    // cul 有 8 格（壓縮型，最多併 4 間）；併 2 間後再擴建到 9 格（島型，最多併 1 間）就會放不下
    let s = mk();
    s.flags["zone:cul"] = true;
    const cul = () => liveSlots(s, "cul").filter((x) => !x.shopId && !s.builds.some((b) => b.slot === x.id));
    expect(s.slots.filter((x) => x.zone === "cul")).toHaveLength(8);
    for (let i = 0; i < 2; i++) s = apply(s, { type: "buildShop", slot: cul()[0]!.id, category: "electronics", span: 2 });
    expect(mergedCount(s, "cul")).toBe(2);
    expect(mergeCapacity(9)).toBeLessThan(2);
    expect(fails(s, { type: "expandZone", zone: "cul" })).toMatch(/版面|大店/);
    // 拆掉一間以後，只剩 1 間，擴建就放行
    const shop = finish(s).shops.find((x) => (x.span ?? 1) > 1)!;
    const t = apply(finish(s), { type: "demolishShop", shopId: shop.id });
    expect(mergedCount(t, "cul")).toBe(1);
    expect(fails(t, { type: "expandZone", zone: "cul" })).toBeNull();
  });
});

describe("big shop unlocks new customer segments", () => {
  it("adds demand only for span >= 2, never lowers existing demand, and every big-capable category has an unlock", () => {
    for (const id of Object.keys(FOOTPRINT_BY_CATEGORY)) {
      const cat = CATEGORY_BY_ID[id]!;
      const u = BIG_UNLOCK[id];
      expect(u, `${id} 有大店解鎖客層`).toBeDefined();
      expect(Object.keys(u!.demand).length).toBeGreaterThan(0);
      for (const p of Object.keys(u!.demand) as PersonaId[]) {
        expect(shopDemand(cat, undefined, p)).toBe(cat.demand[p] ?? 0); // 小店不變
        expect(shopDemand(cat, 1, p)).toBe(cat.demand[p] ?? 0);
        expect(shopDemand(cat, 2, p)).toBeGreaterThan(cat.demand[p] ?? 0);
      }
    }
  });

  it("KTV: a big venue draws commuters (company parties) that a small one barely gets", () => {
    const cat = CATEGORY_BY_ID.karaoke!;
    expect(shopDemand(cat, 2, "commuter")).toBeGreaterThan(shopDemand(cat, 1, "commuter") * 2);
    expect(shopDemand(cat, 2, "family")).toBeGreaterThan(0);
    expect(shopDemand(cat, 1, "family")).toBe(0);
  });
});
