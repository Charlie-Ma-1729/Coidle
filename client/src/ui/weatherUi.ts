import { WEATHER_NAMES, isCold, isHot, type DayWeather, type Weather, type WeatherSummary } from "@coidle/shared";
import type { GlyphKey } from "../stage/glyphs";

/** 天氣對應的圖示 */
export function weatherGlyph(w: Weather): GlyphKey {
  return w.kind === "clear" ? "sun" : w.kind === "cloudy" ? "cloud" : w.kind === "rain" ? "rain" : "storm";
}

/** 例如「雨・19°」「晴・酷暑 36°」 */
export function weatherLabel(w: Weather): string {
  const tag = isHot(w) ? "酷暑" : isCold(w) ? "寒流" : "";
  return `${WEATHER_NAMES[w.kind]}${tag ? "・" + tag : ""}・${w.temp}°`;
}

export const WEATHER_EMOJI: Record<Weather["kind"], string> = { clear: "☀️", cloudy: "☁️", rain: "☔", storm: "🌀" };

/** 日報上的天氣：例如「☔ 雨・19°（下雨約 9 小時）」；舊日報沒有就回傳 null */
export function reportWeatherText(w: WeatherSummary | undefined): string | null {
  if (!w) return null;
  const wet = w.hours.rain + w.hours.storm;
  const tag = isHot(w) ? "・酷暑" : isCold(w) ? "・寒流" : "";
  const dur = w.kind === "storm" ? `（風雨約 ${wet} 小時）` : w.kind === "rain" ? `（下雨約 ${wet} 小時）` : "";
  return `${WEATHER_EMOJI[w.kind]} ${WEATHER_NAMES[w.kind]}${tag}・${w.temp}°${dur}`;
}

/** 下雨時段的說明，例如「13–22 時」 */
function windowText(d: DayWeather): string {
  if (!d.window) return "";
  const [a, b] = d.window;
  return a <= 6 && b >= 22 ? "（整天）" : `（${a}–${b} 時）`;
}

/** 明日預報的一句話 */
export function forecastText(d: DayWeather): string {
  const hot = isHot(d) ? "，酷暑" : isCold(d) ? "，寒流" : "";
  const ty = d.typhoon ? `・颱風第 ${d.typhoon.day + 1}／${d.typhoon.days} 天` : "";
  return `${WEATHER_NAMES[d.kind]}${windowText(d)}・${d.temp}°${hot}${ty}`;
}

/** 預報有颱風或大雨時，給營運上的建議 */
export function forecastAdvice(d: DayWeather): string | null {
  if (d.kind === "storm") return "颱風要來了：考慮提早閉館，並讓 B1 與室內店面多備貨。";
  if (d.kind === "rain") return "會下雨：家庭、觀光客減少；咖啡、拉麵與室內娛樂會變好，屋頂與市集別排活動。";
  if (isHot(d)) return "會很熱：冷飲、甜點要多備貨，火鍋與關東煮可以少備。";
  if (isCold(d)) return "會很冷：熱湯、火鍋、關東煮要多備貨，冷飲少備。";
  return null;
}
