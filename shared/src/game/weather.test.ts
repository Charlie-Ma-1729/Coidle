import { describe, expect, it } from "vitest";
import { PERSONAS } from "./data";
import {
  COLD_TEMP,
  HOT_TEMP,
  cleanCrewSize,
  cleaningCrew,
  dayWeather,
  emptyWeatherTicks,
  extraCleaningCostPerTick,
  summarizeWeatherDay,
  weatherReportNote,
  wetDirt,
  weatherAt,
  weatherDemand,
  weatherNow,
  weatherSummary,
  weatherTraffic,
  weatherZoneFactor,
  type Weather,
} from "./weather";
import type { MallState } from "./types";
import { timeInfo } from "./time";

const dayOf = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const START = dayOf(2027, 4, 1);
const days = (n: number, from = START) => Array.from({ length: n }, (_, i) => from + i);
const monthOf = (d: number) => new Date(d * 86_400_000).getUTCMonth() + 1;

describe("dayWeather：依日期決定", () => {
  it("確定性：同一天永遠同樣的天氣", () => {
    for (const d of days(200)) expect(dayWeather(d)).toEqual(dayWeather(d));
  });

  it("雨天與颱風天只在某些時段下，其餘時間是陰天", () => {
    let checked = 0;
    for (const d of days(400)) {
      const w = dayWeather(d);
      if (!w.window) continue;
      checked++;
      const [from, to] = w.window;
      expect(to).toBeLessThanOrEqual(24);
      if (w.kind === "rain") {
        // 雨：4–12 點開始，下 6 小時以上（颱風的時段另外在「颱風會跨日」測）
        expect(from).toBeGreaterThanOrEqual(4);
        expect(to - from).toBeGreaterThanOrEqual(6);
      }
      expect(weatherAt(d, from).kind).toBe(w.kind);
      expect(weatherAt(d, to - 1).kind).toBe(w.kind);
      if (from > 0) expect(weatherAt(d, from - 1).kind).toBe("cloudy");
      if (to < 24) expect(weatherAt(d, to).kind).toBe("cloudy");
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("季節性：梅雨季（6、7 月）雨最多；颱風只出現在 6–10 月；冬天比夏天冷", () => {
    const years = Array.from({ length: 6 }, (_, i) => 2027 + i);
    const count = (month: number, kind: string) => {
      let n = 0;
      let total = 0;
      for (const y of years)
        for (let d = 1; d <= 28; d++) {
          total++;
          if (dayWeather(dayOf(y, month, d)).kind === kind) n++;
        }
      return n / total;
    };
    expect(count(6, "rain")).toBeGreaterThan(0.3);
    expect(count(7, "rain")).toBeGreaterThan(0.3);
    expect(count(6, "rain")).toBeGreaterThan(count(2, "rain") + 0.1);
    // 颱風會連著幾天，10 月底開始的颱風可能延續到 11 月初
    for (const d of days(365 * 4)) if (dayWeather(d).kind === "storm") expect([6, 7, 8, 9, 10, 11]).toContain(monthOf(d));
    let storms = 0;
    for (const d of days(365 * 4)) if (dayWeather(d).kind === "storm") storms++;
    expect(storms).toBeGreaterThan(5); // 4 年至少有幾次颱風

    const avg = (month: number) => {
      let sum = 0;
      let n = 0;
      for (const y of years) for (let d = 1; d <= 28; d++, n++) sum += dayWeather(dayOf(y, month, d)).temp;
      return sum / n;
    };
    expect(avg(8)).toBeGreaterThan(avg(1) + 15);
  });

  it("天氣會連著幾天（連日雨），不是每天獨立亂跳", () => {
    let longest = 0;
    let run = 0;
    for (let y = 2027; y < 2032; y++)
      for (let d = 1; d <= 30; d++) {
        const wet = dayWeather(dayOf(y, 6, d)).kind === "rain";
        run = wet ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    expect(longest).toBeGreaterThanOrEqual(4);
  });

  it("會有酷暑與寒流，但不常見", () => {
    let hot = 0;
    let cold = 0;
    for (const d of days(365 * 4)) {
      const w = dayWeather(d);
      if (w.temp >= HOT_TEMP) hot++;
      if (w.temp <= COLD_TEMP) cold++;
    }
    expect(hot).toBeGreaterThan(0);
    expect(cold).toBeGreaterThan(0);
    expect(hot).toBeLessThan(365 * 4 * 0.05);
    expect(cold).toBeLessThan(365 * 4 * 0.15);
  });
});

describe("颱風會跨日", () => {
  /** 找出一段時間內所有連續的颱風天（每段是 [第一天, 最後一天]） */
  const runs = (n: number) => {
    const out: [number, number][] = [];
    let start: number | null = null;
    for (const d of days(n)) {
      const storm = dayWeather(d).kind === "storm";
      if (storm && start === null) start = d;
      if (!storm && start !== null) {
        out.push([start, d - 1]);
        start = null;
      }
    }
    return out;
  };

  it("一次連續 2–3 天（偶爾兩個颱風接在一起更久），不會只有一天", () => {
    const r = runs(365 * 12);
    expect(r.length).toBeGreaterThan(8);
    const lens = r.map(([a, b]) => b - a + 1);
    expect(Math.min(...lens)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...lens)).toBeLessThanOrEqual(6);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    expect(avg).toBeGreaterThan(2);
    expect(avg).toBeLessThan(3.3);
  });

  it("第一天下午才起風雨、中間整天、最後一天只到上午", () => {
    let checked = 0;
    for (const [a, b] of runs(365 * 12)) {
      const first = dayWeather(a);
      const last = dayWeather(b);
      expect(first.typhoon!.day).toBe(0);
      expect(first.window![0]).toBeGreaterThanOrEqual(12);
      expect(first.window![1]).toBe(24);
      expect(last.typhoon!.day).toBe(last.typhoon!.days - 1);
      expect(last.window![0]).toBe(0);
      expect(last.window![1]).toBeLessThanOrEqual(15);
      for (let d = a + 1; d < b; d++) {
        const mid = dayWeather(d);
        if (mid.typhoon!.day > 0 && mid.typhoon!.day < mid.typhoon!.days - 1) expect(mid.window).toEqual([0, 24]);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it("跨日時，隔天一早還在颱風天；預報（dayWeather）看得到整段", () => {
    const [a] = runs(365 * 12).find(([x, y]) => y - x >= 1)!;
    expect(weatherAt(a, 23).kind).toBe("storm");
    expect(weatherAt(a + 1, 1).kind).toBe("storm");
    expect(dayWeather(a + 1).kind).toBe("storm");
    expect(dayWeather(a - 1).kind).not.toBe("storm");
  });
});

describe("雨天髒污與清潔員", () => {
  const w = (kind: Weather["kind"]): Weather => ({ kind, temp: 20 });

  it("雨天更髒、颱風更髒；晴陰沒有額外髒污", () => {
    expect(wetDirt(w("clear"))).toEqual({ tracked: 0, leak: 0 });
    expect(wetDirt(w("cloudy"))).toEqual({ tracked: 0, leak: 0 });
    expect(wetDirt(w("rain")).leak).toBeGreaterThan(0);
    expect(wetDirt(w("storm")).leak).toBeGreaterThan(wetDirt(w("rain")).leak);
    expect(wetDirt(w("storm")).tracked).toBeGreaterThan(wetDirt(w("rain")).tracked);
  });

  it("有簽清潔才會加派：打掃變快、要多付錢；選「不做」沒人加派", () => {
    expect(cleaningCrew(0, w("storm"))).toEqual({ restoreMult: 1, costFrac: 0 });
    expect(cleaningCrew(1, w("clear"))).toEqual({ restoreMult: 1, costFrac: 0 });
    expect(cleaningCrew(1, w("rain")).restoreMult).toBeGreaterThan(1);
    expect(cleaningCrew(1, w("storm")).restoreMult).toBeGreaterThan(cleaningCrew(1, w("rain")).restoreMult);
    expect(extraCleaningCostPerTick(0, w("storm"))).toBe(0);
    expect(extraCleaningCostPerTick(1, w("clear"))).toBe(0);
    expect(extraCleaningCostPerTick(2, w("rain"))).toBeGreaterThan(extraCleaningCostPerTick(1, w("rain")));
    expect(extraCleaningCostPerTick(1, w("storm"))).toBeGreaterThan(extraCleaningCostPerTick(1, w("rain")));
  });

  it("畫面上的清潔員人數：客訴 1 位；下雨加 1、颱風加 2、加強再加 1；最多 3 位", () => {
    expect(cleanCrewSize(1, w("clear"), false)).toBe(0);
    expect(cleanCrewSize(1, w("clear"), true)).toBe(1);
    expect(cleanCrewSize(1, w("rain"), false)).toBe(1);
    expect(cleanCrewSize(1, w("storm"), false)).toBe(2);
    expect(cleanCrewSize(2, w("rain"), false)).toBe(2);
    expect(cleanCrewSize(2, w("storm"), true)).toBe(3);
    expect(cleanCrewSize(0, w("storm"), false)).toBe(0); // 沒簽清潔就沒人加派
    expect(cleanCrewSize(0, w("storm"), true)).toBe(1);
  });
});

describe("日報的天氣", () => {
  const ticks = (o: Partial<Record<Weather["kind"], number>>) => ({ ...emptyWeatherTicks(), ...o });

  it("沒有資料（舊存檔）就不記", () => {
    expect(summarizeWeatherDay(undefined, 20)).toBeUndefined();
    expect(summarizeWeatherDay(emptyWeatherTicks(), 20)).toBeUndefined();
  });

  it("有颱風算颱風；下雨滿 1 小時算雨；其餘看晴陰誰多", () => {
    expect(summarizeWeatherDay(ticks({ storm: 60, cloudy: 100, clear: 128 }), 24)!.kind).toBe("storm");
    expect(summarizeWeatherDay(ticks({ rain: 120, cloudy: 168 }), 19)!.kind).toBe("rain");
    expect(summarizeWeatherDay(ticks({ rain: 6, clear: 282 }), 19)!.kind).toBe("clear"); // 只下了半小時
    expect(summarizeWeatherDay(ticks({ clear: 100, cloudy: 188 }), 19)!.kind).toBe("cloudy");
  });

  it("記下各種天氣的小時數與氣溫", () => {
    const s = summarizeWeatherDay(ticks({ rain: 108, cloudy: 180 }), 18)!;
    expect(s.hours).toEqual({ clear: 0, cloudy: 15, rain: 9, storm: 0 });
    expect(s.temp).toBe(18);
  });

  it("雨天與颱風天的日報有說明（含有沒有加派清潔員）；一般晴陰天不佔版面", () => {
    const rain = summarizeWeatherDay(ticks({ rain: 108, cloudy: 180 }), 18)!;
    expect(weatherReportNote(rain, 1)).toContain("加派了清潔員");
    expect(weatherReportNote(rain, 0)).toContain("沒人加派");
    const storm = summarizeWeatherDay(ticks({ storm: 200, cloudy: 88 }), 24)!;
    expect(weatherReportNote(storm, 1)).toContain("颱風");
    expect(weatherReportNote(summarizeWeatherDay(ticks({ clear: 288 }), 22)!, 1)).toBeNull();
    expect(weatherReportNote(summarizeWeatherDay(ticks({ clear: 288 }), 36)!, 1)).toContain("酷暑");
    expect(weatherReportNote(summarizeWeatherDay(ticks({ cloudy: 288 }), 2)!, 1)).toContain("寒流");
  });
});

describe("weatherNow：事件強制的天氣", () => {
  const base = (modifiers: MallState["modifiers"], tick: number) => ({ tick, modifiers }) as Pick<MallState, "tick" | "modifiers">;
  const tick = 20_000;

  it("沒有事件就用日期決定的天氣", () => {
    const w = weatherNow(base([], tick));
    expect(["clear", "cloudy", "rain", "storm"]).toContain(w.kind);
  });

  it("強制天氣在期間內蓋過日期天氣；過期後恢復", () => {
    const forced = { kind: "weather" as const, weather: "storm" as const, temp: 24, endTick: tick + 50 };
    expect(weatherNow(base([forced], tick))).toEqual({ kind: "storm", temp: 24 });
    expect(weatherNow(base([forced], tick + 50)).kind).toBe(weatherNow(base([], tick + 50)).kind); // 剛好過期
  });

  it("多個強制天氣時，以最新的為準", () => {
    const a = { kind: "weather" as const, weather: "rain" as const, temp: 20, endTick: tick + 100 };
    const b = { kind: "weather" as const, weather: "clear" as const, temp: 36, endTick: tick + 100 };
    expect(weatherNow(base([a, b], tick))).toEqual({ kind: "clear", temp: 36 });
  });

  it("同一個 tick 內修飾值變了，快取不會回傳舊值", () => {
    const s = base([], tick);
    const before = weatherNow(s);
    s.modifiers.push({ kind: "weather", weather: before.kind === "storm" ? "clear" : "storm", temp: 30, endTick: tick + 10 });
    expect(weatherNow(s).temp).toBe(30);
  });

  it("小時對得上遊戲時鐘（tick → 日期與小時）", () => {
    // 遊戲時鐘是 UTC+9：2027-06-10 15:00 的 tick，要對到那一天的 15 點
    const t = (Date.UTC(2027, 5, 10, 15, 0, 0) - 9 * 3_600_000) / (5 * 60_000);
    const ti = timeInfo(t);
    expect([ti.date, ti.hour]).toEqual(["2027-06-10", 15]);
    expect(weatherNow(base([], t))).toEqual(weatherAt(dayOf(2027, 6, 10), 15));
    expect(weatherNow(base([], t + 12 * 3))).toEqual(weatherAt(dayOf(2027, 6, 10), 18));
  });
});

describe("對遊戲的影響", () => {
  const w = (kind: Weather["kind"], temp = 20): Weather => ({ kind, temp });

  it("下雨：家庭與觀光客減少、在地客略增；暴風雨所有客群都大減", () => {
    expect(weatherTraffic(w("rain"), "family")).toBeLessThan(0.75);
    expect(weatherTraffic(w("rain"), "tourist")).toBeLessThan(0.85);
    expect(weatherTraffic(w("rain"), "local")).toBeGreaterThan(1);
    for (const p of PERSONAS) expect(weatherTraffic(w("storm"), p.id)).toBeLessThan(0.6);
    for (const p of PERSONAS) expect(weatherTraffic(w("cloudy"), p.id)).toBe(1);
  });

  it("全年平均客流接近 1（天氣只是改變分佈，不改變整體經濟）", () => {
    let num = 0;
    let den = 0;
    for (const d of days(365 * 6)) {
      const dow = (d + 4) % 7;
      const weekend = dow === 0 || dow === 6;
      for (const p of PERSONAS) {
        const share = weekend ? p.weekendHourShare : p.hourShare;
        const daily = p.dailyBase * (weekend ? p.weekendMult : 1);
        for (let h = 0; h < 24; h++) {
          const base = daily * (share[h] ?? 0);
          num += base * weatherTraffic(weatherAt(d, h), p.id);
          den += base;
        }
      }
    }
    expect(num / den).toBeGreaterThan(0.97);
    expect(num / den).toBeLessThan(1.03);
  });

  it("需求：冷天熱湯、熱天冷飲、雨天咖啡與室內娛樂；屋頂在颱風天幾乎沒人", () => {
    expect(weatherDemand(w("cloudy", 2), "ramen")).toBeGreaterThan(1.3);
    expect(weatherDemand(w("cloudy", 2), "bubble_tea")).toBeLessThan(0.8);
    expect(weatherDemand(w("clear", 35), "bubble_tea")).toBeGreaterThan(1.4);
    expect(weatherDemand(w("clear", 35), "hotpot")).toBeLessThan(0.8);
    expect(weatherDemand(w("rain"), "kissaten")).toBeGreaterThan(1.1);
    expect(weatherDemand(w("rain"), "cinema")).toBeGreaterThan(1.1);
    expect(weatherDemand(w("rain"), "observatory")).toBeLessThanOrEqual(0.5);
    expect(weatherDemand(w("storm"), "observatory")).toBeLessThanOrEqual(0.1);
    expect(weatherDemand(w("clear"), "observatory")).toBeGreaterThan(1.2);
    expect(weatherDemand(w("cloudy"), "ramen")).toBe(1);
  });

  it("樓層：B1 連通車站、雨天更旺；1F 街道門最吃風雨；其他樓層不受影響", () => {
    expect(weatherZoneFactor(w("rain"), "b1")).toBeGreaterThan(1);
    expect(weatherZoneFactor(w("rain"), "f1")).toBeLessThan(1);
    expect(weatherZoneFactor(w("storm"), "f1")).toBeLessThan(weatherZoneFactor(w("rain"), "f1"));
    for (const z of ["ent", "cul", "life", "dining", "plaza", "biz"]) {
      for (const k of ["clear", "cloudy", "rain", "storm"] as const) expect(weatherZoneFactor(w(k), z)).toBe(1);
    }
    expect(weatherZoneFactor(w("clear"), "f1")).toBe(1);
  });

  it("每種天氣都有說明文字", () => {
    for (const k of ["clear", "cloudy", "rain", "storm"] as const) expect(weatherSummary(w(k)).length).toBeGreaterThan(5);
    expect(weatherSummary(w("clear", 36))).toContain("酷暑");
    expect(weatherSummary(w("cloudy", 2))).toContain("寒流");
  });
});
