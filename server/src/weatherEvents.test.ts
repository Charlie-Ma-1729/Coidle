import { describe, expect, it } from "vitest";
import { EVENT_BY_ID, TICKS_PER_DAY, dayWeather, isWet, timeInfo, weatherAllows, weatherNeedOf, weatherNow, type EventDef, type MallState } from "@coidle/shared";
import { createInitialState } from "./sim";
import { eligible, maybeSpawnEvent } from "./sim/events";
import { createRng } from "./sim/rng";

// 事件寫到下雨，就要真的在下雨：「雨水從天花板滲下來」不該在大晴天出現，
// 「連日的雨讓鐵皮屋頂漏水」要連著下過雨。

const ai: EventDef = {
  id: "ai_947bcd08ff",
  category: "facility",
  title: "老街的鐵皮屋頂漏水",
  text: "連日的雨讓老街對面的鐵皮屋頂滴滴答答，有幾家店的老闆來商場問能不能借個遮雨棚，說是臨時擋一下，大家也都很有人情味。",
  weight: 0.8,
  cooldownTicks: 2304,
  effects: [],
};

const BASE = createInitialState(7, 0, 0);
const at = (tick: number): MallState => ({ ...BASE, modifiers: [], tick });
/** 從第 0 天往後找，回傳符合條件的 tick（每 12 tick＝1 小時掃一次） */
const find = (pred: (s: MallState) => boolean, from = 0, days = 800): number => {
  for (let t = from; t < from + days * TICKS_PER_DAY; t += 12) if (pred(at(t))) return t;
  throw new Error("找不到符合的時間");
};

describe("which events need rain", () => {
  it("reads the event's own words: rain now, a streak of rain, or nothing", () => {
    expect(weatherNeedOf(EVENT_BY_ID.leak!)).toBe("wet"); // 雨水從天花板的縫隙滲了下來
    expect(weatherNeedOf(ai)).toBe("wet_streak"); // 連日的雨
    expect(weatherNeedOf(EVENT_BY_ID.escalator_down!)).toBeNull();
    // 描述天氣本身的事件自己會強制天氣，不受限
    const typhoon = Object.values(EVENT_BY_ID).find((e) => e.category === "weather" && /連日|梅雨|大雨/.test(e.title + e.text))!;
    expect(weatherNeedOf(typhoon)).toBeNull();
    // 明寫的優先
    expect(weatherNeedOf({ ...ai, needsWeather: "wet" })).toBe("wet");
    expect(weatherNeedOf({ ...EVENT_BY_ID.escalator_down!, needsWeather: "wet_streak" })).toBe("wet_streak");
  });
});

describe("weather decides when they can happen", () => {
  it("'wet' needs rain right now; 'wet_streak' needs rain on the day before as well", () => {
    let wet = 0;
    let streak = 0;
    const base = at(0);
    for (let t = 0; t < 365 * TICKS_PER_DAY; t += 12) {
      const s = { ...base, tick: t }; // 只有 tick 不同，不必每次重建整個商場
      const w = isWet(weatherNow(s));
      expect(weatherAllows("wet", s)).toBe(w);
      const st = weatherAllows("wet_streak", s);
      if (st) {
        expect(w).toBe(true);
        expect(isWet({ kind: dayWeather(timeInfo(t).day - 1).kind, temp: 0 })).toBe(true);
      }
      if (w) wet++;
      if (st) streak++;
      expect(weatherAllows(null, s)).toBe(true);
    }
    expect(wet).toBeGreaterThan(0);
    expect(streak).toBeGreaterThan(0);
    expect(streak).toBeLessThan(wet); // 連日有雨比單純下雨少
  });

  it("an event-forced stretch of heavy rain counts as a streak by itself", () => {
    const t = find((s) => !weatherAllows("wet_streak", s) && !isWet(weatherNow(s)));
    const s = at(t);
    s.modifiers.push({ kind: "weather", weather: "rain", temp: 20, endTick: t + 288 });
    expect(weatherAllows("wet", s)).toBe(true);
    expect(weatherAllows("wet_streak", s)).toBe(true);
  });

  it("a rain event is not eligible on a dry day, but is on a rainy one", () => {
    const leak = EVENT_BY_ID.leak!;
    const dry = at(find((s) => !isWet(weatherNow(s))));
    const rainy = at(find((s) => weatherAllows("wet", s)));
    const streak = at(find((s) => weatherAllows("wet_streak", s)));
    const dryStreak = at(find((s) => isWet(weatherNow(s)) && !weatherAllows("wet_streak", s))); // 只下了第一天
    expect(eligible(dry, leak, timeInfo(dry.tick))).toBe(false);
    expect(eligible(rainy, leak, timeInfo(rainy.tick))).toBe(true);
    expect(eligible(dry, ai, timeInfo(dry.tick))).toBe(false);
    expect(eligible(dryStreak, ai, timeInfo(dryStreak.tick))).toBe(false);
    expect(eligible(streak, ai, timeInfo(streak.tick))).toBe(true);
    // 沒提到雨的事件不受影響
    expect(eligible(dry, EVENT_BY_ID.escalator_down!, timeInfo(dry.tick))).toBe(true);
  });

  it("the live spawner never picks a rain event on a dry day", () => {
    const dry = at(find((s) => !isWet(weatherNow(s))));
    let spawnedAny = 0;
    for (let i = 0; i < 1500; i++) {
      const s = structuredClone(dry);
      const sp = maybeSpawnEvent(s, timeInfo(dry.tick), createRng(i + 1));
      if (sp) {
        spawnedAny++;
        expect(weatherAllows(weatherNeedOf(sp.def), s)).toBe(true);
      }
    }
    expect(spawnedAny).toBeGreaterThan(0);
  });
});
