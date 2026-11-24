import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  EVENTS,
  PERSONAS,
  TICKS_PER_DAY,
  ZONE_BY_ID,
  periodOf,
  realMsFromTick,
  tickFromRealMs,
  timeInfo,
  CLOCK_ANCHOR_REAL_MS,
} from "./index";

describe("shared game data", () => {
  it("has 288 ticks per day", () => {
    expect(TICKS_PER_DAY).toBe(288);
  });

  it("persona hour curves sum to 1", () => {
    for (const p of PERSONAS) {
      expect(p.hourShare).toHaveLength(24);
      expect(p.hourShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(p.weekendHourShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
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

describe("game clock", () => {
  it("anchors the game calendar at 2027-04-01 and runs 4x", () => {
    const t0 = timeInfo(tickFromRealMs(CLOCK_ANCHOR_REAL_MS));
    expect(t0.date).toBe("2027-04-01");
    expect(t0.hour).toBe(0);
    // 真實 6 小時 = 遊戲 1 天
    const t1 = timeInfo(tickFromRealMs(CLOCK_ANCHOR_REAL_MS + 6 * 3_600_000));
    expect(t1.date).toBe("2027-04-02");
    // 真實 1 天 = 4 個遊戲日；約 1.75 真實日一週
    const t2 = timeInfo(tickFromRealMs(CLOCK_ANCHOR_REAL_MS + 24 * 3_600_000));
    expect(t2.date).toBe("2027-04-05");
  });

  it("tick <-> real time round-trips", () => {
    const tick = tickFromRealMs(CLOCK_ANCHOR_REAL_MS + 123_456_789);
    expect(tickFromRealMs(realMsFromTick(tick))).toBe(tick);
  });

  it("lunch/dinner are peak and the middle of the night is quiet", () => {
    const peaks = Array.from({ length: 24 }, (_, h) => periodOf(h, false));
    expect(peaks.filter((p) => p === "peak").length).toBeGreaterThan(0);
    expect(peaks[3]).toBe("quiet");
  });
});
