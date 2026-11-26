import { describe, expect, it } from "vitest";
import { hourLabel, hoursRangeLabel, isHourOpen, laborCostFactor, openSpan, validHours } from "../index";

describe("營業時間（可跨午夜）", () => {
  it("一般時段：開門含、打烊不含", () => {
    expect(isHourOpen(10, 22, 10)).toBe(true);
    expect(isHourOpen(10, 22, 21)).toBe(true);
    expect(isHourOpen(10, 22, 22)).toBe(false);
    expect(isHourOpen(10, 22, 3)).toBe(false);
    expect(isHourOpen(0, 24, 0)).toBe(true);
    expect(isHourOpen(0, 24, 23)).toBe(true);
  });

  it("05:00–03:00（隔天）：凌晨 0–2 點也營業，3、4 點休息", () => {
    const open = Array.from({ length: 24 }, (_, h) => isHourOpen(5, 27, h));
    expect(open.filter(Boolean)).toHaveLength(22);
    expect([0, 1, 2].every((h) => open[h])).toBe(true);
    expect(open[3]).toBe(false);
    expect(open[4]).toBe(false);
    expect(open[5]).toBe(true);
    expect(open[23]).toBe(true);
    expect(openSpan(5, 27)).toBe(22);
  });

  it("夜班 20:00–02:00（隔天）", () => {
    expect([19, 20, 23, 0, 1, 2, 3].map((h) => isHourOpen(20, 26, h))).toEqual([false, true, true, true, true, false, false]);
  });

  it("合法性：4～24 小時、開門 0–23、打烊最晚隔天 05:00", () => {
    expect(validHours(5, 27)).toBe(true);
    expect(validHours(5, 29)).toBe(true);
    expect(validHours(0, 24)).toBe(true);
    expect(validHours(23, 27)).toBe(true);
    expect(validHours(10, 13)).toBe(false); // 少於 4 小時
    expect(validHours(5, 30)).toBe(false); // 晚過隔天 05:00
    expect(validHours(4, 29)).toBe(false); // 超過 24 小時
    expect(validHours(-1, 10)).toBe(false);
    expect(validHours(24, 30)).toBe(false);
    expect(validHours(10.5, 22)).toBe(false);
    expect(validHours("10", 22)).toBe(false);
  });

  it("顯示", () => {
    expect(hourLabel(5)).toBe("05:00");
    expect(hourLabel(27)).toBe("03:00");
    expect(hourLabel(27, true)).toBe("03:00（隔天）");
    expect(hourLabel(24, true)).toBe("00:00");
    expect(hoursRangeLabel(5, 27)).toBe("05:00–03:00（隔天）");
    expect(hoursRangeLabel(9, 23)).toBe("09:00–23:00");
  });

  it("人事係數：跨午夜算進深夜加成，24 小時營業最高", () => {
    expect(laborCostFactor(5, 27)).toBeGreaterThan(laborCostFactor(10, 22));
    // 5～27：深夜 22–27 共 5 小時；營業 22 小時、超過 14 小時的 8 小時是加班
    expect(laborCostFactor(5, 27)).toBeCloseTo(1 + (0.25 * (5 + 8)) / 22, 6);
  });
});
