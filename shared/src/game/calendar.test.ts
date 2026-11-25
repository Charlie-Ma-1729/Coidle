import { describe, expect, it } from "vitest";
import { PERSONAS } from "./data";
import {
  OBSERVANCES,
  TRAFFIC_CLAMP,
  calendarDay,
  calendarDemand,
  calendarEffectLines,
  calendarLabel,
  calendarTraffic,
  calendarTrafficAverage,
  dayOfYmd,
  publicHolidays,
  upcomingCalendar,
  ymdOfDay,
} from "./calendar";
import { timeInfo } from "./time";

const day = (y: number, m: number, d: number) => dayOfYmd(y, m, d);
const holidaysOf = (year: number) => Object.fromEntries([...publicHolidays(year)].map(([k, v]) => [`${Math.floor(k / 100)}/${k % 100}`, v.name]));

describe("Japanese public holidays", () => {
  it("2027 matches the official calendar (Happy Monday, equinoxes, substitute holiday)", () => {
    const h = holidaysOf(2027);
    expect(h["1/1"]).toBe("元日");
    expect(h["1/11"]).toBe("成人之日"); // 1 月第 2 個週一
    expect(h["2/11"]).toBe("建國紀念日");
    expect(h["2/23"]).toBe("天皇誕生日");
    expect(h["3/21"]).toBe("春分之日");
    expect(h["3/22"]).toBe("補假（春分之日）"); // 春分撞週日
    expect(h["4/29"]).toBe("昭和之日");
    expect(h["5/3"]).toBe("憲法紀念日");
    expect(h["5/4"]).toBe("綠之日");
    expect(h["5/5"]).toBe("兒童節");
    expect(h["7/19"]).toBe("海之日");
    expect(h["8/11"]).toBe("山之日");
    expect(h["9/20"]).toBe("敬老之日");
    expect(h["9/23"]).toBe("秋分之日");
    expect(h["10/11"]).toBe("體育之日");
    expect(h["11/3"]).toBe("文化之日");
    expect(h["11/23"]).toBe("勤勞感謝日");
    expect(Object.keys(h)).toHaveLength(17); // 16 個法定假日＋1 個補假
  });

  it("substitute holidays: a holiday on Sunday moves to the next non-holiday day", () => {
    expect(holidaysOf(2026)["5/6"]).toBe("補假（憲法紀念日）"); // 5/3 週日，5/4、5/5 也是假日，順延到 5/6
    const h29 = holidaysOf(2029);
    expect(h29["2/12"]).toBe("補假（建國紀念日）");
    expect(h29["4/30"]).toBe("補假（昭和之日）");
    expect(h29["9/24"]).toBe("補假（秋分之日）");
  });

  it("a day sandwiched between two holidays is a holiday too (Silver Week)", () => {
    expect(holidaysOf(2026)["9/22"]).toBe("國民之休日"); // 9/21 敬老之日、9/23 秋分之日
    expect(holidaysOf(2027)["9/22"]).toBeUndefined();
  });

  it("equinox formula stays right over the years we simulate", () => {
    const springs = [2027, 2028, 2029, 2030, 2031].map((y) => Object.entries(holidaysOf(y)).find(([, n]) => n === "春分之日")![0]);
    expect(springs).toEqual(["3/21", "3/20", "3/20", "3/20", "3/21"]);
    const autumns = [2027, 2028, 2029, 2030, 2031].map((y) => Object.entries(holidaysOf(y)).find(([, n]) => n === "秋分之日")![0]);
    expect(autumns).toEqual(["9/23", "9/22", "9/23", "9/23", "9/23"]);
  });
});

describe("calendar days", () => {
  it("an ordinary weekday changes nothing", () => {
    const c = calendarDay(day(2027, 6, 9)); // 週三
    expect(c.offDay).toBe(false);
    expect(c.holiday).toBeNull();
    expect(c.streak).toBeNull();
    expect(calendarLabel(c)).toBeNull();
    for (const p of PERSONAS) expect(c.traffic[p.id]).toBe(1);
    expect(calendarDemand(c.day, "ramen")).toBe(1);
  });

  it("day numbers line up with timeInfo (weekday and date)", () => {
    const d = day(2027, 8, 14);
    const y = ymdOfDay(d);
    expect(y).toMatchObject({ y: 2027, m: 8, d: 14, dow: 6 }); // 週六
    const t = timeInfo(d * 288 - 9 * 12); // JST 0 點
    expect(t.day).toBe(d);
    expect(t.weekend).toBe(true);
    expect(t.offDay).toBe(true);
  });

  it("public holidays count as off days; timeInfo reports the holiday", () => {
    const t = timeInfo(day(2027, 5, 3) * 288 - 9 * 12 + 120); // 5/3 週一
    expect(t.weekend).toBe(false);
    expect(t.offDay).toBe(true);
    expect(t.holiday).toBe("憲法紀念日");
  });

  it("Golden Week: families and tourists flood in, commuters stay home", () => {
    const c = calendarDay(day(2027, 5, 3));
    expect(c.observances.some((o) => o.id === "golden_week")).toBe(true);
    expect(c.tags).toEqual(expect.arrayContaining(["holiday", "golden_week"]));
    expect(c.traffic.family).toBeGreaterThanOrEqual(1.4);
    expect(c.traffic.tourist).toBeGreaterThanOrEqual(1.25);
    expect(c.traffic.commuter).toBeLessThan(0.7);
    expect(calendarDemand(c.day, "kids_play")).toBeGreaterThan(1.3);
    // 4/30 雖然是平日，公司也放假：視同假日，連休一路連到 5/6
    const bridge = calendarDay(day(2027, 4, 30));
    expect(bridge.offDay).toBe(true);
    expect(bridge.streak!.length).toBe(8); // 4/29–5/6
    expect(calendarLabel(c)).toContain("黃金週");
  });

  it("Obon: hometown season — commuters and locals thin out, flowers sell", () => {
    const c = calendarDay(day(2027, 8, 14));
    expect(c.observances.some((o) => o.id === "obon")).toBe(true);
    expect(c.traffic.commuter).toBeLessThan(0.5);
    expect(c.traffic.local).toBeLessThan(1);
    expect(c.traffic.family).toBeGreaterThan(1.3);
    expect(calendarDemand(c.day, "florist")).toBeGreaterThanOrEqual(1.5);
    expect(calendarLabel(c)).toContain("盂蘭盆");
  });

  it("New Year's days and the year-end rush", () => {
    const ny = calendarDay(day(2028, 1, 2));
    expect(ny.offDay).toBe(true);
    expect(ny.traffic.commuter).toBeLessThan(0.4);
    expect(ny.traffic.family).toBeGreaterThan(1.4);
    expect(calendarDemand(ny.day, "kaiseki")).toBeGreaterThan(1.3);
    const ye = calendarDay(day(2027, 12, 30));
    expect(ye.offDay).toBe(true);
    expect(calendarDemand(ye.day, "grocery")).toBeGreaterThan(1.3);
    expect(calendarDemand(day(2027, 12, 31), "soba")).toBeGreaterThan(1.6);
  });

  it("Christmas Eve and Valentine's Day are for couples", () => {
    expect(calendarTraffic(day(2027, 12, 24), "couple")).toBeGreaterThanOrEqual(1.5);
    expect(calendarDemand(day(2027, 12, 24), "bakery")).toBeGreaterThan(1.3);
    expect(calendarTraffic(day(2028, 2, 14), "couple")).toBeGreaterThanOrEqual(1.4);
    expect(calendarDemand(day(2028, 2, 14), "florist")).toBeGreaterThanOrEqual(1.4);
  });

  it("Silver Week is a five-day stretch with the generic long-weekend bonus (no season on top)", () => {
    const c = calendarDay(day(2026, 9, 21));
    expect(c.holiday).toBe("敬老之日");
    expect(c.streak).toEqual({ index: 3, length: 5 }); // 9/19（六）到 9/23（三）
    expect(c.tags).toContain("long_weekend");
    expect(c.traffic.family).toBeGreaterThan(1.1);
    expect(c.traffic.commuter).toBeLessThan(0.95);
  });

  it("payday on the 25th (or the Friday before when it falls on a weekend)", () => {
    expect(calendarDay(day(2027, 6, 25)).tags).toContain("payday"); // 週五
    expect(calendarDay(day(2027, 9, 24)).tags).toContain("payday"); // 25 日是週六 → 提前到週五 24 日
    expect(calendarDay(day(2027, 9, 25)).tags).not.toContain("payday");
    expect(calendarTraffic(day(2027, 6, 25), "commuter")).toBeGreaterThan(1);
  });

  it("Coming-of-Age Day boosts salons and photo studios", () => {
    const c = calendarDay(day(2027, 1, 11));
    expect(calendarDemand(c.day, "salon")).toBeGreaterThan(1.8);
    expect(calendarDemand(c.day, "photo_studio")).toBeGreaterThan(1.8);
  });

  it("multipliers stay inside the clamps, and every id/category in the table is real", () => {
    const ids = new Set<string>();
    for (const o of OBSERVANCES) {
      expect(ids.has(o.id)).toBe(false);
      ids.add(o.id);
    }
    for (let d = day(2027, 4, 1); d < day(2031, 4, 1); d++) {
      const c = calendarDay(d);
      for (const p of PERSONAS) {
        expect(c.traffic[p.id]).toBeGreaterThanOrEqual(TRAFFIC_CLAMP[0]);
        expect(c.traffic[p.id]).toBeLessThanOrEqual(TRAFFIC_CLAMP[1]);
      }
    }
  });

  it("upcoming list and effect lines are usable by the UI", () => {
    const list = upcomingCalendar(day(2027, 4, 20), 30);
    expect(list.some((c) => c.observances.some((o) => o.id === "golden_week"))).toBe(true);
    expect(list.every((c, i) => i === 0 || c.day > list[i - 1]!.day)).toBe(true);
    const lines = calendarEffectLines(calendarDay(day(2027, 5, 3)));
    expect(lines[0]).toContain("客流");
    expect(lines[0]).toContain("家庭");
  });
});

describe("annual balance", () => {
  /** 一整年每天的「有效客流」（各客群：到訪量 × 週末倍率 × 日曆倍率）相對於「只有週末、沒有日曆」的比例 */
  function yearRatio(fromYear: number): { all: number; withoutWeekendShift: number } {
    let withCal = 0;
    let base = 0;
    for (let d = day(fromYear, 4, 1); d < day(fromYear + 1, 4, 1); d++) {
      const c = calendarDay(d);
      const weekend = c.dow === 0 || c.dow === 6;
      for (const p of PERSONAS) {
        base += p.dailyBase * (weekend ? p.weekendMult : 1);
        withCal += p.dailyBase * (c.offDay ? p.weekendMult : 1) * c.traffic[p.id];
      }
    }
    return { all: withCal / base, withoutWeekendShift: 0 };
  }

  it("the calendar adds only a modest amount of traffic over a whole year (no inflation)", () => {
    for (const y of [2027, 2028, 2029]) {
      const { all } = yearRatio(y);
      // 日曆會讓假日更熱鬧，但全年平均不能偏離基準太多：目標 +0%～+8%
      expect(all, `year ${y}`).toBeGreaterThan(1.0);
      expect(all, `year ${y}`).toBeLessThan(1.08);
    }
  });

  it("calendarTrafficAverage weights personas by their actual volume that day", () => {
    const d = day(2027, 5, 3);
    const avg = calendarTrafficAverage(d);
    const c = calendarDay(d);
    const min = Math.min(...PERSONAS.map((p) => c.traffic[p.id]));
    const max = Math.max(...PERSONAS.map((p) => c.traffic[p.id]));
    expect(avg).toBeGreaterThanOrEqual(min);
    expect(avg).toBeLessThanOrEqual(max);
    expect(calendarTrafficAverage(day(2027, 6, 9))).toBe(1);
  });
});
