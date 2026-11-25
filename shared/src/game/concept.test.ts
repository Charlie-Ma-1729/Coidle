import { describe, expect, it } from "vitest";
import { CATEGORIES, PERSONAS } from "./data";
import { CONCEPTS, CONCEPT_BY_ID, conceptChangeCost, conceptDemand, conceptEffectLines, conceptTraffic, conceptTrafficAverage } from "./concept";

describe("concept positioning is a trade-off, not free traffic", () => {
  it("the default concept changes nothing", () => {
    for (const p of PERSONAS) expect(conceptTraffic(undefined, p.id)).toBe(1);
    for (const c of CATEGORIES) expect(conceptDemand(undefined, c.id)).toBe(1);
    expect(conceptTrafficAverage("general")).toBe(1);
  });

  it("every concept keeps overall traffic about the same, so it cannot just be a raw buff", () => {
    for (const c of CONCEPTS) {
      const avg = conceptTrafficAverage(c.id);
      expect(avg, c.name).toBeGreaterThan(0.985);
      expect(avg, c.name).toBeLessThan(1.03);
    }
  });

  it("every concept has a real upside and a real cost, within sane bounds", () => {
    for (const c of CONCEPTS.filter((x) => x.id !== "general")) {
      const t = PERSONAS.map((p) => conceptTraffic(c.id, p.id));
      expect(Math.max(...t), c.name).toBeGreaterThan(1.04);
      expect(Math.min(...t), c.name).toBeLessThan(0.97);
      for (const v of t) {
        expect(v).toBeGreaterThanOrEqual(0.8);
        expect(v).toBeLessThanOrEqual(1.25);
      }
      const d = CATEGORIES.map((x) => conceptDemand(c.id, x.id));
      expect(Math.max(...d), c.name).toBeGreaterThan(1.02);
      expect(Math.min(...d), c.name).toBeGreaterThanOrEqual(0.9);
      expect(Math.max(...d), c.name).toBeLessThanOrEqual(1.12);
      expect(conceptEffectLines(c).length).toBeGreaterThan(0);
    }
  });

  it("an unknown id behaves like the default", () => {
    expect(conceptTraffic("nope", "tourist")).toBe(1);
    expect(conceptDemand("nope", "ramen")).toBe(1);
    expect(CONCEPT_BY_ID.general.traffic).toEqual({});
  });

  it("changing costs more at higher levels", () => {
    expect(conceptChangeCost(5)).toBeGreaterThan(conceptChangeCost(1));
  });
});
