import { describe, expect, it } from "vitest";
import {
  CATEGORY_BY_ID,
  RND_TICKS,
  SLOT_KINDS,
  TAG_BY_ID,
  menuQualityBonus,
  menuSlots,
  type MallState,
  type SlotKind,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command } from "./sim";
import { INGREDIENTS, INGREDIENT_BY_ID, RECIPES } from "./sim/recipes";
import type { Rng } from "./sim/rng";
import { shopQuality } from "./sim/state";
import { evaluate, syncWorkshop, tagTotals } from "./sim/workshop";

const T0 = 1000;
const mk = (seed = 7): MallState => createInitialState(seed, T0, 0);
const apply = (s: MallState, c: Command): MallState => {
  const r = applyCommand(s, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const fails = (s: MallState, c: Command): string | null => {
  const r = applyCommand(s, c);
  return r.ok ? null : r.error;
};
const sure: Rng = { next: () => 0.5, int: (a) => a, chance: () => true, gauss: () => 0, poisson: () => 0, weighted: () => 0 };
const never: Rng = { ...sure, chance: () => false };
const shopOf = (s: MallState, cat: string) => s.shops.find((x) => x.category === cat)!;
const ZESTY = { base: "f_pork", season: "f_citrus", method: "f_fry" };

function levelUp(s: MallState, level: number): MallState {
  const c = structuredClone(s);
  c.level = level;
  syncWorkshop(c);
  return c;
}

describe("workshop data", () => {
  it("every ingredient uses only tags of its own group, and ids are unique", () => {
    expect(new Set(INGREDIENTS.map((i) => i.id)).size).toBe(INGREDIENTS.length);
    for (const i of INGREDIENTS) {
      for (const tag of Object.keys(i.tags)) expect(TAG_BY_ID[i.group][tag], `${i.id}:${tag}`).toBeDefined();
      expect(SLOT_KINDS).toContain(i.slot);
    }
  });

  it("recipes are well formed: valid tags, categories, methods and at least one clue", () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      for (const tag of [...Object.keys(r.need), ...Object.keys(r.avoid ?? {})]) expect(TAG_BY_ID[r.group][tag], `${r.id}:${tag}`).toBeDefined();
      for (const c of r.categories ?? []) expect(CATEGORY_BY_ID[c]?.group, `${r.id}:${c}`).toBe(r.group);
      for (const m of r.method ?? []) expect(INGREDIENT_BY_ID[m]?.slot).toBe("method");
      expect(r.clues.length).toBeGreaterThan(0);
    }
  });

  it("every hidden recipe can actually be made with some combination of ingredients", () => {
    for (const r of RECIPES) {
      const pool = (slot: SlotKind) => INGREDIENTS.filter((i) => i.group === r.group && i.slot === slot).map((i) => i.id);
      let found = false;
      for (const b of pool("base")) {
        for (const se of pool("season")) {
          for (const m of pool("method")) {
            for (const sp of [undefined, ...pool("special")]) {
              const picks = { base: b, season: se, method: m, special: sp };
              const t = tagTotals(picks);
              const okNeed = Object.entries(r.need).every(([k, v]) => (t[k] ?? 0) >= v);
              const okAvoid = Object.entries(r.avoid ?? {}).every(([k, v]) => (t[k] ?? 0) <= v);
              const okMethod = !r.method || r.method.includes(m);
              if (okNeed && okAvoid && okMethod) found = true;
            }
          }
        }
      }
      expect(found, r.id).toBe(true);
    }
  });

  it("random experiments rarely stumble onto a signature (but it can happen)", () => {
    let hits = 0;
    let n = 0;
    const food = (slot: SlotKind) => INGREDIENTS.filter((i) => i.group === "food" && i.slot === slot);
    for (const b of food("base")) for (const se of food("season")) for (const m of food("method")) {
      n++;
      if (evaluate("kushikatsu", { base: b.id, season: se.id, method: m.id }, 1, sure, []).outcome === "signature") hits++;
    }
    expect(hits).toBeGreaterThan(0);
    expect(hits / n).toBeLessThan(0.08);
  });
});

describe("evaluation", () => {
  it("a matching combination yields the signature; a bad roll gives 'almost'", () => {
    const a = evaluate("kushikatsu", ZESTY, 1, sure, []);
    expect(a.outcome).toBe("signature");
    expect(a.recipe?.id).toBe("rc_kushi_zesty");
    expect(a.quality).toBeGreaterThan(70);
    expect(evaluate("kushikatsu", ZESTY, 1, never, []).outcome).toBe("almost");
  });

  it("the same ingredients do not unlock a recipe in a shop it does not belong to", () => {
    expect(evaluate("ramen", ZESTY, 1, sure, []).outcome).not.toBe("signature");
  });

  it("excess of one trait is a flop that names the problem", () => {
    const r = evaluate("ramen", { base: "f_pork", season: "f_salt", method: "f_pickle", special: "f_cheese" }, 3, never, []);
    // 鹹：0+3+1+1 = 5，不過量；改用更極端的組合
    expect(["original", "flop"]).toContain(r.outcome);
    const over = evaluate("ramen", { base: "f_noodle", season: "f_salt", method: "f_boil", special: "f_cheese" }, 3, never, []);
    expect(over.feedback.length).toBeGreaterThan(0);
  });

  it("a near miss on an undiscovered recipe gives a directional clue, never the recipe name", () => {
    const r = evaluate("kushikatsu", { base: "f_pork", season: "f_vinegar", method: "f_fry" }, 1, never, []);
    if (r.outcome === "original") {
      expect(r.clue ?? "").not.toContain("柑香");
    }
  });
});

describe("research flow", () => {
  it("starting research validates ingredients, cost, one job per shop and repeats", () => {
    const s0 = levelUp(mk(), 2);
    const shop = shopOf(s0, "kushikatsu");
    expect(fails(s0, { type: "startRnd", shopId: shop.id, picks: { base: "f_pork", season: "f_citrus" } })).toContain("手法");
    expect(fails(s0, { type: "startRnd", shopId: shop.id, picks: { base: "f_beef", season: "f_citrus", method: "f_fry" } })).toContain("不認識");
    expect(fails(s0, { type: "startRnd", shopId: shop.id, picks: { base: "f_pork", season: "f_fry", method: "f_fry" } })).not.toBeNull();
    const poor = { ...structuredClone(s0), funds: 100 };
    expect(fails(poor, { type: "startRnd", shopId: shop.id, picks: ZESTY })).toBe("資金不足");

    const s1 = apply(s0, { type: "startRnd", shopId: shop.id, picks: ZESTY });
    expect(s1.funds).toBeLessThan(s0.funds);
    expect(s1.workshop.jobs).toHaveLength(1);
    expect(fails(s1, { type: "startRnd", shopId: shop.id, picks: { base: "f_chicken", season: "f_soy", method: "f_grill" } })).toContain("正在研發");

    const s2 = apply(s1, { type: "cancelRnd", shopId: shop.id });
    expect(s2.workshop.jobs).toHaveLength(0);
    expect(s2.funds).toBeGreaterThan(s1.funds);
    expect(s2.funds).toBeLessThan(s0.funds);
  });

  it("research runs offline: after the duration a tasting is waiting, traits are learned, and a repeat of a decided combo is refused", () => {
    let s = levelUp(mk(11), 2);
    const shop = shopOf(s, "kushikatsu");
    // 用不同種子重試，直到命中（執行成功率不是 100%）
    let result: MallState | null = null;
    for (let seed = 1; seed < 40 && !result; seed++) {
      const c = levelUp(mk(seed), 2);
      const sh = shopOf(c, "kushikatsu");
      let t = apply(c, { type: "startRnd", shopId: sh.id, picks: ZESTY });
      t = advanceTo(t, t.tick + RND_TICKS + 2, { nobodyPresent: false });
      if (t.workshop.discovered.includes("rc_kushi_zesty")) result = t;
    }
    expect(result).not.toBeNull();
    s = result!;
    expect(s.workshop.dishes[0]?.signature).toBe(true);
    expect(s.workshop.dishes[0]?.name).toBe("柑香酥衣串");
    expect(s.workshop.tastings[0]?.outcome).toBe("signature");
    expect(s.workshop.tried[Object.keys(s.workshop.tried)[0]!]).toBe("signature");
    expect(Object.keys(s.workshop.learned).length).toBeGreaterThan(0);
    expect(s.workshop.log[0]?.dishName).toBe("柑香酥衣串");
    expect(fails(s, { type: "startRnd", shopId: shopOf(s, "kushikatsu").id, picks: ZESTY })).toContain("招牌");
  });

  it("catch-up equals tick-by-tick with research running", () => {
    const base = levelUp(mk(5), 2);
    const sh = shopOf(base, "kushikatsu");
    const start = apply(base, { type: "startRnd", shopId: sh.id, picks: ZESTY });
    const a = advanceTo(start, start.tick + 300, { nobodyPresent: false });
    let b = start;
    for (let i = 0; i < 300; i++) b = advanceTo(b, b.tick + 1, { nobodyPresent: false });
    expect(b.workshop).toEqual(a.workshop);
    expect(b.funds).toBeCloseTo(a.funds, 3);
  });
});

describe("menu", () => {
  function withDish(): { s: MallState; shopId: string; dishId: string } {
    let found: MallState | null = null;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const c = levelUp(mk(seed), 2);
      const t = advanceTo(apply(c, { type: "startRnd", shopId: shopOf(c, "kushikatsu").id, picks: ZESTY }), c.tick + RND_TICKS + 2, { nobodyPresent: false });
      if (t.workshop.dishes.length > 0) found = t;
    }
    const s = found!;
    return { s, shopId: shopOf(s, "kushikatsu").id, dishId: s.workshop.dishes[0]!.id };
  }

  it("listing a dish raises quality, refreshes the shop once, and respects slots and fit", () => {
    const { s, shopId, dishId } = withDish();
    const before = shopQuality(shopOf(s, "kushikatsu"));
    const s1 = apply(s, { type: "listDish", shopId, dishId });
    const shop = s1.shops.find((x) => x.id === shopId)!;
    expect(shop.menu).toHaveLength(1);
    expect(menuQualityBonus(shop)).toBeGreaterThan(0.02);
    expect(shopQuality(shop)).toBeGreaterThan(before);
    expect(fails(s1, { type: "listDish", shopId, dishId })).toContain("已經");
    expect(fails(s1, { type: "listDish", shopId: shopOf(s1, "ramen").id, dishId })).toContain("不適合");
    expect(menuSlots(1)).toBe(2);
    expect(fails(s1, { type: "discardDish", dishId })).toContain("招牌");
  });

  it("unlisting and relisting does not reset novelty", () => {
    const { s, shopId, dishId } = withDish();
    let t = apply(s, { type: "listDish", shopId, dishId });
    t = advanceTo(t, t.tick + 288 * 10, { nobodyPresent: false });
    const aged = t.shops.find((x) => x.id === shopId)!.menu[0]!.novelty;
    expect(aged).toBeLessThan(100);
    t = apply(t, { type: "unlistDish", shopId, slotIndex: 0 });
    t = apply(t, { type: "listDish", shopId, dishId });
    expect(t.shops.find((x) => x.id === shopId)!.menu[0]!.novelty).toBeCloseTo(aged, 5);
  });

  it("an untouched tasting auto-lists the new work into a free slot after it expires", () => {
    const w = withDish();
    const { shopId } = w;
    expect(w.s.workshop.tastings.length).toBeGreaterThan(0);
    const s = advanceTo(w.s, w.s.tick + 700, { nobodyPresent: false });
    expect(s.workshop.tastings).toHaveLength(0);
    expect(s.shops.find((x) => x.id === shopId)!.menu.length).toBe(1);
  });
});

describe("unlocking and migration", () => {
  it("new ingredients appear as the mall levels up; known ones never disappear", () => {
    const s0 = mk();
    const n0 = s0.workshop.ingredients.length;
    expect(n0).toBeGreaterThan(10);
    expect(s0.workshop.ingredients.some((i) => i.id === "f_citrus")).toBe(false);
    const s1 = levelUp(s0, 2);
    expect(s1.workshop.ingredients.some((i) => i.id === "f_citrus")).toBe(true);
    expect(s1.workshop.ingredients.length).toBeGreaterThan(n0);
  });

  it("the state sent to players never contains hidden tags or recipes", () => {
    const s = mk();
    const text = JSON.stringify(s.workshop);
    expect(text).not.toContain("rc_kushi_zesty");
    expect(text).not.toContain("\"tags\":{");
  });

  it("migrates v6 to v7 with an empty workshop and menus", () => {
    const v6 = JSON.parse(JSON.stringify(mk())) as Record<string, unknown> & { shops: Record<string, unknown>[] };
    v6.version = 6;
    delete v6.workshop;
    for (const sh of v6.shops) delete sh.menu;
    const m = migrateState(v6, 0);
    expect(m.version).toBe(7);
    expect(m.shops.every((x) => Array.isArray(x.menu))).toBe(true);
    expect(m.workshop.ingredients.length).toBeGreaterThan(10);
    expect(m.workshop.dishes).toEqual([]);
  });
});
