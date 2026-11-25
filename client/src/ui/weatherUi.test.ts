import { describe, expect, it } from "vitest";
import { forecastAdvice, forecastText, reportWeatherText, weatherGlyph, weatherLabel } from "./weatherUi";

describe("weatherUi", () => {
  it("圖示對應天氣種類", () => {
    expect(weatherGlyph({ kind: "clear", temp: 20 })).toBe("sun");
    expect(weatherGlyph({ kind: "cloudy", temp: 20 })).toBe("cloud");
    expect(weatherGlyph({ kind: "rain", temp: 20 })).toBe("rain");
    expect(weatherGlyph({ kind: "storm", temp: 20 })).toBe("storm");
  });

  it("標籤帶氣溫，酷暑與寒流會特別標出來", () => {
    expect(weatherLabel({ kind: "rain", temp: 19 })).toBe("雨・19°");
    expect(weatherLabel({ kind: "clear", temp: 36 })).toContain("酷暑");
    expect(weatherLabel({ kind: "cloudy", temp: 2 })).toContain("寒流");
  });

  it("預報寫出下雨時段；整天下雨不寫時段", () => {
    expect(forecastText({ kind: "rain", temp: 19, window: [13, 22] })).toBe("雨（13–22 時）・19°");
    expect(forecastText({ kind: "rain", temp: 19, window: [4, 24] })).toContain("整天");
    expect(forecastText({ kind: "clear", temp: 25, window: null })).toBe("晴・25°");
  });

  it("預報寫出颱風是第幾天、共幾天", () => {
    expect(forecastText({ kind: "storm", temp: 24, window: [0, 24], typhoon: { day: 1, days: 3 } })).toContain("颱風第 2／3 天");
    expect(forecastText({ kind: "storm", temp: 24, window: [14, 24], typhoon: { day: 0, days: 2 } })).toContain("第 1／2 天");
    expect(forecastText({ kind: "rain", temp: 19, window: [13, 22] })).not.toContain("颱風");
  });

  it("日報的天氣：雨與颱風寫小時數；舊日報（沒有天氣）回傳 null", () => {
    expect(reportWeatherText(undefined)).toBeNull();
    const rain = { kind: "rain" as const, temp: 19, hours: { clear: 0, cloudy: 15, rain: 9, storm: 0 } };
    expect(reportWeatherText(rain)).toBe("☔ 雨・19°（下雨約 9 小時）");
    const storm = { kind: "storm" as const, temp: 24, hours: { clear: 0, cloudy: 4, rain: 0, storm: 20 } };
    expect(reportWeatherText(storm)).toContain("風雨約 20 小時");
    expect(reportWeatherText({ kind: "clear", temp: 25, hours: { clear: 24, cloudy: 0, rain: 0, storm: 0 } })).toBe("☀️ 晴・25°");
    expect(reportWeatherText({ kind: "clear", temp: 36, hours: { clear: 24, cloudy: 0, rain: 0, storm: 0 } })).toContain("酷暑");
  });

  it("颱風、大雨、酷暑、寒流有營運建議；一般天氣沒有", () => {
    expect(forecastAdvice({ kind: "storm", temp: 24, window: [10, 20] })).toContain("閉館");
    expect(forecastAdvice({ kind: "rain", temp: 19, window: [10, 20] })).toContain("下雨");
    expect(forecastAdvice({ kind: "clear", temp: 36, window: null })).toContain("冷飲");
    expect(forecastAdvice({ kind: "cloudy", temp: 2, window: null })).toContain("熱湯");
    expect(forecastAdvice({ kind: "clear", temp: 24, window: null })).toBeNull();
  });
});
