import { describe, expect, it } from "vitest";
import { CATEGORIES, EVENTS, PERSONAS, TICKS_PER_DAY, ZONE_BY_ID, CATEGORY_BY_ID } from "./index";

describe("shared game data", () => {
  it("has 288 ticks per day", () => {
    expect(TICKS_PER_DAY).toBe(288);
  });

  it("persona hour curves sum to 1", () => {
    for (const p of PERSONAS) {
      expect(p.hourShare).toHaveLength(24);
      expect(p.hourShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });

  it("every category belongs to a known zone and has unique id", () => {
    const ids = new Set<string>();
    for (const c of CATEGORIES) {
      expect(ZONE_BY_ID[c.zone], `zone of ${c.id}`).toBeDefined();
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });

  it("events reference valid categories, zones and default options", () => {
    const effects = (list: { t: string; category?: string }[]) =>
      list.filter((e) => e.t === "demand").forEach((e) => expect(CATEGORY_BY_ID[e.category!]).toBeDefined());
    for (const ev of EVENTS) {
      if (ev.needsZone) expect(ZONE_BY_ID[ev.needsZone]).toBeDefined();
      effects(ev.effects);
      if (ev.choice) {
        expect(ev.choice.options.some((o) => o.id === ev.choice!.defaultOption)).toBe(true);
        ev.choice.options.forEach((o) => effects(o.effects));
      }
    }
  });
});
