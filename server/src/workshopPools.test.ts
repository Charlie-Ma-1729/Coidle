import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_BY_ID, SLOT_KINDS, ingredientFitsCategory, type CategoryDef, type SlotKind } from "@coidle/shared";
import { FAMILIES } from "./sim/ingredientPools";
import { INGREDIENTS, RECIPES } from "./sim/recipes";
import { tagTotals } from "./sim/workshop";

// 研發素材依業態分池：每個業態都要有自己夠用的一組，而且既有配方在該業態的池裡都做得出來。

const poolOf = (c: CategoryDef, slot: SlotKind) => INGREDIENTS.filter((i) => ingredientFitsCategory(i, c.id) && i.slot === slot);

describe("ingredient pools by category", () => {
  it("family names never collide with category ids, and every category belongs to a family", () => {
    for (const f of Object.keys(FAMILIES)) expect(CATEGORY_BY_ID[f], `family ${f} collides with a category`).toBeUndefined();
    const covered = new Set(Object.values(FAMILIES).flat());
    const missing = CATEGORIES.filter((c) => !covered.has(c.id)).map((c) => c.id);
    expect(missing, "categories in no family").toEqual([]);
    for (const [f, members] of Object.entries(FAMILIES)) for (const m of members) expect(CATEGORY_BY_ID[m], `${f} → ${m}`).toBeDefined();
  });

  it("every ingredient is assigned to at least one category of its own group", () => {
    const bad = INGREDIENTS.filter((i) => !i.categories || i.categories.length === 0 || i.categories.some((c) => CATEGORY_BY_ID[c]?.group !== i.group)).map((i) => i.id);
    expect(bad).toEqual([]);
  });

  it("every category has a workable bench: 3+ choices for base/season/method (one available from the start) and 1+ special", () => {
    const problems: string[] = [];
    for (const c of CATEGORIES) {
      for (const k of SLOT_KINDS) {
        const pool = poolOf(c, k);
        const need = k === "special" ? 1 : 3;
        if (pool.length < need) problems.push(`${c.id}(${c.name}) ${k}: only ${pool.length}`);
        else if (k !== "special" && !pool.some((i) => i.unlock.t === "start")) problems.push(`${c.id}(${c.name}) ${k}: nothing available at start`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every hidden recipe can be made in each category it names (generic recipes: in at least one category of the group)", () => {
    const makeable = (r: (typeof RECIPES)[number], c: CategoryDef): boolean => {
      for (const b of poolOf(c, "base"))
        for (const se of poolOf(c, "season"))
          for (const m of poolOf(c, "method"))
            for (const sp of [undefined, ...poolOf(c, "special")]) {
              const t = tagTotals({ base: b.id, season: se.id, method: m.id, special: sp?.id });
              if (Object.entries(r.need).every(([k, v]) => (t[k] ?? 0) >= v) && Object.entries(r.avoid ?? {}).every(([k, v]) => (t[k] ?? 0) <= v) && (!r.method || r.method.includes(m.id))) return true;
            }
      return false;
    };
    const problems: string[] = [];
    for (const r of RECIPES) {
      const cats = (r.categories ?? CATEGORIES.filter((c) => c.group === r.group).map((c) => c.id)).map((id) => CATEGORY_BY_ID[id]!);
      if (r.categories) {
        for (const c of cats) if (!makeable(r, c)) problems.push(`${r.id} in ${c.id}`);
      } else if (!cats.some((c) => makeable(r, c))) problems.push(`${r.id} (generic) in no category`);
    }
    expect(problems).toEqual([]);
  });

  it("ingredients stay in their own kitchen: no pork in bubble tea, no noodles in a bookstore", () => {
    const has = (cat: string, id: string) => INGREDIENTS.some((i) => i.id === id && ingredientFitsCategory(i, cat));
    expect(has("bubble_tea", "f_pork")).toBe(false);
    expect(has("ramen", "f_pork")).toBe(true);
    expect(has("kushikatsu", "f_pork")).toBe(true);
    expect(has("ramen", "f_noodle")).toBe(true);
    expect(has("bookstore", "f_noodle")).toBe(false); // 群組不同
    expect(has("bookstore", "r_cotton")).toBe(false);
    expect(has("fashion", "r_cotton")).toBe(true);
  });

  it("neighbouring categories do not share an identical bench", () => {
    const sig = (c: CategoryDef) => INGREDIENTS.filter((i) => ingredientFitsCategory(i, c.id)).map((i) => i.id).sort().join(",");
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const c of CATEGORIES) {
      const k = sig(c);
      const other = seen.get(k);
      if (other) dup.push(`${other} = ${c.id}`);
      else seen.set(k, c.id);
    }
    expect(dup).toEqual([]);
  });
});
