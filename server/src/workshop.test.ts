import { describe, expect, it } from "vitest";
import {
  STARTER_QUESTS,
  CATEGORY_BY_ID,
  MID_BY_ID,
  RND_TICKS,
  SLOT_KINDS,
  TAG_BY_ID,
  ingredientFitsCategory,
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
const mk = (seed = 7): MallState => {
  const s = createInitialState(seed, T0, 0);
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0; // 新手任務獎金不干擾金額檢查
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

  // 「每個隱藏配方在它的業態裡做得出來」改由 workshopPools.test.ts 以各業態自己的素材池檢查。

  it("random experiments rarely stumble onto a signature (but it can happen)", () => {
    let hits = 0;
    let n = 0;
    const food = (slot: SlotKind) => INGREDIENTS.filter((i) => ingredientFitsCategory(i, "kushikatsu") && i.slot === slot);
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
    expect(fails(s1, { type: "listDish", shopId: shopOf(s1, "ramen").id, dishId })).toContain("研發它的那間店");
    // 同業態的另一間店也不行：哪間店研發的就只能在那間店上架
    expect(s1.workshop.dishes.find((d) => d.id === dishId)!.madeShopId).toBe(shopId);
    const twin = { ...s1.shops.find((x) => x.id === shopId)!, id: "twin-shop", menu: [] };
    expect(fails({ ...s1, shops: [...s1.shops, twin] }, { type: "listDish", shopId: "twin-shop", dishId })).toContain("研發它的那間店");
    expect(menuSlots(1)).toBe(2);
    expect(fails(s1, { type: "discardDish", dishId })).toContain("招牌");
  });

  it("legacy dishes are bound to the shop named in madeAt, and mis-listed entries return to the cookbook", () => {
    const { s, shopId, dishId } = withDish();
    const s1 = structuredClone(apply(s, { type: "listDish", shopId, dishId }));
    const origin = s1.shops.find((x) => x.id === shopId)!;
    const other = { ...structuredClone(origin), id: "other-shop", name: "別間店", menu: [] as typeof origin.menu };
    // 模擬舊存檔：作品沒有 madeShopId，而且被放到同業態的另一間店
    const dish = s1.workshop.dishes.find((d) => d.id === dishId)!;
    delete dish.madeShopId;
    other.menu = origin.menu.splice(0);
    s1.shops.push(other);
    syncWorkshop(s1);
    expect(dish.madeShopId).toBe(shopId);
    expect(other.menu).toHaveLength(0);
    expect(origin.menu).toHaveLength(0);
    expect(s1.workshop.dishes.some((d) => d.id === dishId)).toBe(true);
    const again = structuredClone(s1);
    syncWorkshop(again);
    expect(again.shops.find((x) => x.id === "other-shop")!.menu).toHaveLength(0);
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

  it("research only accepts ingredients that suit the shop's category", () => {
    const s0 = levelUp(mk(), 2);
    const shop = shopOf(s0, "kushikatsu");
    // 手搖飲的茶葉、咖啡的豆子不是串炸店的素材
    expect(fails(s0, { type: "startRnd", shopId: shop.id, picks: { base: "f_blacktea", season: "f_citrus", method: "f_fry" } })).toContain("不適合");
    expect(fails(s0, { type: "startRnd", shopId: shop.id, picks: { base: "f_pork", season: "f_citrus", method: "f_pourover" } })).toContain("不適合");
    // 自己業態的素材可以
    expect(fails(s0, { type: "startRnd", shopId: shop.id, picks: ZESTY })).toBeNull();
  });

  it("every public ingredient carries the categories it suits, and old saves are backfilled without log spam", () => {
    const s = levelUp(mk(), 3);
    expect(s.workshop.ingredients.every((i) => (i.categories?.length ?? 0) > 0)).toBe(true);
    // 模擬舊存檔：素材沒有 categories
    const old = structuredClone(s);
    for (const i of old.workshop.ingredients) delete i.categories;
    const logs = old.log.length;
    syncWorkshop(old);
    expect(old.workshop.ingredients.every((i) => (i.categories?.length ?? 0) > 0)).toBe(true);
    expect(old.workshop.ingredients.length).toBe(s.workshop.ingredients.length);
    expect(old.log.length - logs).toBeLessThanOrEqual(1);
    // 再同步一次不再有變化
    const again = structuredClone(old);
    syncWorkshop(again);
    expect(again.workshop).toEqual(old.workshop);
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
    expect(m.version).toBe(13);
    expect(m.shops.every((x) => Array.isArray(x.menu))).toBe(true);
    expect(m.workshop.ingredients.length).toBeGreaterThan(10);
    expect(m.workshop.dishes).toEqual([]);
  });
});

describe("research mid-wait event", () => {
  const startOne = () => {
    const s0 = levelUp(mk(), 2);
    const shop = shopOf(s0, "kushikatsu");
    return { s: apply(s0, { type: "startRnd", shopId: shop.id, picks: ZESTY }), shop };
  };

  it("appears at half progress, never before, and does not stop the clock", () => {
    const { s, shop } = startOne();
    const job = s.workshop.jobs[0]!;
    const total = job.endTick - job.startTick;
    const early = advanceTo(structuredClone(s), job.startTick + Math.floor(total * 0.4));
    expect(early.workshop.jobs[0]!.mid).toBeUndefined();
    const mid = advanceTo(structuredClone(s), job.startTick + Math.floor(total * 0.6));
    expect(mid.workshop.jobs[0]!.mid).toBeDefined();
    expect(mid.tick).toBe(job.startTick + Math.floor(total * 0.6)); // 沒有因為事件暫停
    expect(shop.id).toBe(mid.workshop.jobs[0]!.shopId);
  });

  it("a chosen option costs money and is applied once; unresolved events fall back to the default", () => {
    const { s, shop } = startOne();
    const job = s.workshop.jobs[0]!;
    const mid = advanceTo(structuredClone(s), job.startTick + Math.floor((job.endTick - job.startTick) * 0.6));
    const ev = MID_BY_ID[mid.workshop.jobs[0]!.mid!.kind]!;
    expect(fails(mid, { type: "resolveRndEvent", shopId: shop.id, optionId: "nope" })).toContain("沒有這個選項");
    const paid = ev.options.find((o) => o.costPct > 0);
    if (paid) {
      const poor = { ...structuredClone(mid), funds: 1 };
      expect(fails(poor, { type: "resolveRndEvent", shopId: shop.id, optionId: paid.id })).toContain("資金不足");
      const done = apply(mid, { type: "resolveRndEvent", shopId: shop.id, optionId: paid.id });
      expect(done.funds).toBeLessThan(mid.funds);
      expect(done.workshop.jobs[0]!.mid!.skill).toBe(paid.skill);
      expect(fails(done, { type: "resolveRndEvent", shopId: shop.id, optionId: paid.id })).toContain("處理過");
    }
    // 沒人處理：研發結束時自動採預設，結果出得來
    const end = advanceTo(structuredClone(mid), job.endTick + 2);
    expect(end.workshop.jobs).toHaveLength(0);
    expect(end.workshop.tastings.length).toBeGreaterThan(0);
  });

  it("is deterministic: same state and choice give the same result", () => {
    const { s, shop } = startOne();
    const job = s.workshop.jobs[0]!;
    const mid = advanceTo(structuredClone(s), job.startTick + Math.floor((job.endTick - job.startTick) * 0.6));
    const ev = MID_BY_ID[mid.workshop.jobs[0]!.mid!.kind]!;
    const o = ev.options.find((x) => x.risk) ?? ev.options[0]!;
    const a = apply(structuredClone(mid), { type: "resolveRndEvent", shopId: shop.id, optionId: o.id });
    const b = apply(structuredClone(mid), { type: "resolveRndEvent", shopId: shop.id, optionId: o.id });
    expect(a.workshop.jobs[0]!.mid).toEqual(b.workshop.jobs[0]!.mid);
  });
});
