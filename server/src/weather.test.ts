import { describe, expect, it } from "vitest";
import { EVENT_BY_ID, TICKS_PER_DAY, TICK_MINUTES, dayWeather, type MallState } from "@coidle/shared";
import { advanceTo, createInitialState, timeInfo } from "./sim";
import { applyEffects } from "./sim/events";
import { createRng as makeRng } from "./sim/rng";

const START_OF = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);

/** 先跑到某一天的 0 點再給狀態（用同一個種子，兩邊的亂數流完全一致） */
function stateAt(seed: number, tick: number): MallState {
  return createInitialState(seed, tick);
}

/** 找一個日期天氣是 kind 的日子（避免依賴特定日期） */
function findDay(kind: "clear", fromTick: number): number {
  for (let t = fromTick; t < fromTick + 800 * TICKS_PER_DAY; t += TICKS_PER_DAY) {
    if (dayWeather(timeInfo(t).day).kind === kind) return t;
  }
  throw new Error("no day found: " + kind);
}

function groupsOver(s: MallState, ticks: number): number {
  const r = advanceTo(s, s.tick + ticks);
  return r.reports.reduce((a, x) => a + x.groups, 0) + r.today.groups;
}

describe("weather in the simulation", () => {
  it("event weather replaces any earlier forced weather instead of stacking", () => {
    const s = stateAt(1, START_OF(2027, 6, 2));
    const rng = makeRng(1);
    applyEffects(s, EVENT_BY_ID.rainy_season!.effects, rng);
    applyEffects(s, [{ t: "weather", kind: "storm", temp: 24, ticks: 96 }], rng);
    const forced = s.modifiers.filter((m) => m.kind === "weather");
    expect(forced).toHaveLength(1);
    expect(forced[0]).toMatchObject({ weather: "storm", temp: 24 });
  });

  it("weather effect values are clamped", () => {
    const s = stateAt(1, START_OF(2027, 6, 2));
    applyEffects(s, [{ t: "weather", kind: "clear", temp: 999, ticks: 99999 }], makeRng(1));
    const m = s.modifiers.find((x) => x.kind === "weather")!;
    expect(m).toMatchObject({ temp: 42 });
    expect((m as { endTick: number }).endTick - s.tick).toBeLessThanOrEqual(288 * 3);
  });

  it("the weather events no longer carry their own traffic/demand numbers (no double counting)", () => {
    for (const id of ["rainy_season", "cold_wave", "heat_wave"]) {
      const e = EVENT_BY_ID[id]!;
      expect(e.effects.some((x) => x.t === "weather"), id).toBe(true);
      expect(e.effects.some((x) => x.t === "traffic" || x.t === "demand"), id).toBe(false);
    }
    const typhoon = EVENT_BY_ID.typhoon_warning!;
    for (const o of typhoon.choice!.options) {
      expect(o.effects.some((x) => x.t === "weather" && x.kind === "storm"), o.id).toBe(true);
      expect(o.effects.some((x) => x.t === "traffic"), o.id).toBe(false);
    }
  });

  it("a storm day brings far fewer customers than a clear day (same seed, same mall)", () => {
    // 用事件強制天氣，比較「同一天、同一個種子」的客流
    const day = findDay("clear", START_OF(2027, 4, 5));
    const forced = (kind: "clear" | "rain" | "storm") => {
      const s = stateAt(7, day);
      s.modifiers.push({ kind: "weather", weather: kind, temp: 22, endTick: s.tick + TICKS_PER_DAY });
      return groupsOver(s, TICKS_PER_DAY);
    };
    const sunny = forced("clear");
    const rain = forced("rain");
    const storm = forced("storm");
    expect(sunny).toBeGreaterThan(0);
    expect(rain).toBeLessThan(sunny); // 家庭、觀光客減少
    expect(storm).toBeLessThan(sunny * 0.65);
    expect(storm).toBeLessThan(rain);
  });

  /** 同一個商場、同一天，只換天氣，看一整天後的館內清潔度與帳 */
  function dayWith(kind: "clear" | "rain" | "storm", cleaning: 0 | 1 | 2) {
    const day = findDay("clear", START_OF(2027, 4, 5));
    const s = stateAt(3, day);
    s.cleaningLevel = cleaning;
    s.cleanliness = 80;
    s.modifiers.push({ kind: "weather", weather: kind, temp: 20, endTick: s.tick + TICKS_PER_DAY });
    const r = advanceTo(s, s.tick + TICKS_PER_DAY - 1);
    return { cleanliness: r.cleanliness, fixed: r.today.fixed, funds: r.funds, wx: r.today.wx, r };
  }

  it("rainy days leave the mall dirtier, storms dirtier still (same cleaning level)", () => {
    const clear = dayWith("clear", 1).cleanliness;
    const rain = dayWith("rain", 1).cleanliness;
    const storm = dayWith("storm", 1).cleanliness;
    expect(rain).toBeLessThan(clear);
    expect(storm).toBeLessThan(rain);
  });

  it("with no cleaning contract the rain makes it much worse — and nobody is called in", () => {
    const none = dayWith("rain", 0);
    const std = dayWith("rain", 1);
    expect(none.cleanliness).toBeLessThan(std.cleanliness - 5);
    // 沒簽清潔：沒有加班費，固定成本不會因為下雨變多
    expect(none.fixed).toBe(dayWith("clear", 0).fixed);
  });

  it("extra cleaning crew costs extra on wet days (and only then)", () => {
    const clear = dayWith("clear", 1).fixed;
    const rain = dayWith("rain", 1).fixed;
    const storm = dayWith("storm", 1).fixed;
    expect(rain).toBeGreaterThan(clear);
    expect(storm).toBeGreaterThan(rain);
    // 加班費不是天文數字：颱風整天也不到一天清潔費的 90%
    expect(storm - clear).toBeLessThan(25_000 * 0.9);
  });

  it("the day's weather ticks add up to a full day and end up in the daily report", () => {
    const { r, wx } = dayWith("rain", 1);
    const total = wx!.clear + wx!.cloudy + wx!.rain + wx!.storm;
    expect(total).toBe(TICKS_PER_DAY - 1); // 跑到隔天 0 點前一個 tick
    expect(wx!.rain).toBe(TICKS_PER_DAY - 1);
    // 再跑過午夜，日報就產生了
    const next = advanceTo(r, r.tick + 3);
    const rep = next.reports[next.reports.length - 1]!;
    expect(rep.weather).toBeDefined();
    expect(rep.weather!.kind).toBe("rain");
    expect(rep.weather!.hours.rain).toBeGreaterThanOrEqual(23);
    expect(rep.notes.some((n) => n.includes("雨"))).toBe(true);
    expect(rep.notes[0]).toContain("雨"); // 天氣放最前面
  });

  it("an ordinary clear day is recorded too, but adds no weather note", () => {
    const { r } = dayWith("clear", 1);
    const next = advanceTo(r, r.tick + 3);
    const rep = next.reports[next.reports.length - 1]!;
    expect(rep.weather!.kind).toBe("clear");
    expect(rep.notes.some((n) => n.startsWith("☔") || n.startsWith("🌀"))).toBe(false);
  });

  it("a multi-day typhoon from the calendar: storm persists past midnight and shows in consecutive reports", () => {
    // 往後找一段日曆上的颱風
    let t = START_OF(2027, 8, 1);
    let found = -1;
    for (let i = 0; i < 365 * 6 && found < 0; i++, t += TICKS_PER_DAY) {
      const a = dayWeather(timeInfo(t).day);
      const b = dayWeather(timeInfo(t).day + 1);
      if (a.kind === "storm" && a.typhoon?.day === 0 && b.kind === "storm") found = t;
    }
    expect(found).toBeGreaterThan(0);
    const s = stateAt(9, found);
    const r = advanceTo(s, found + 3 * TICKS_PER_DAY);
    const stormDays = r.reports.filter((x) => x.weather?.kind === "storm");
    expect(stormDays.length).toBeGreaterThanOrEqual(2);
    // 連續的兩份日報
    const idx = r.reports.findIndex((x) => x.weather?.kind === "storm");
    expect(r.reports[idx + 1]?.weather?.kind).toBe("storm");
  });

  it("the typhoon event forces storm weather for almost two days either way you answer", () => {
    for (const id of ["close", "open"]) {
      const opt = EVENT_BY_ID.typhoon_warning!.choice!.options.find((o) => o.id === id)!;
      const w = opt.effects.find((e) => e.t === "weather") as { ticks: number } | undefined;
      expect(w, id).toBeDefined();
      expect(w!.ticks).toBeGreaterThan(TICKS_PER_DAY * 1.5);
    }
  });

  it("is deterministic: the same seed and date give the same results", () => {
    const t = START_OF(2027, 6, 10);
    const a = advanceTo(stateAt(5, t), t + 2 * TICKS_PER_DAY);
    const b = advanceTo(stateAt(5, t), t + 2 * TICKS_PER_DAY);
    expect(a.funds).toBe(b.funds);
    expect(a.reports.map((r) => r.groups)).toEqual(b.reports.map((r) => r.groups));
  });
});
