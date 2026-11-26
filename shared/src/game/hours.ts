/**
 * 營業時間：`open`（0–23）～`close`。`close` 超過 24 代表打烊在隔天，例如 `close: 27` ＝ 隔天 03:00，
 * 所以「05:00～03:00」就是 `{ open: 5, close: 27 }`。小時是整點、含開門、不含打烊（open ≤ 小時 < close）。
 */
export const MIN_OPEN_SPAN = 4;
/** 最晚打烊：隔天 05:00（再晚就和下一個早班接在一起了） */
export const MAX_CLOSE_HOUR = 29;

/** 這個整點（0–23）有沒有在營業；跨午夜時，隔天凌晨（小時 < close − 24）也算營業中 */
export function isHourOpen(open: number, close: number, hour: number): boolean {
  if (hour >= open && hour < close) return true;
  return close > 24 && hour < close - 24;
}

/** 每天營業幾小時（最多 24） */
export function openSpan(open: number, close: number): number {
  return Math.max(0, Math.min(24, close - open));
}

/** 營業時間合不合法：整數、開門 0–23、打烊最晚隔天 05:00、每天營業 4～24 小時 */
export function validHours(open: unknown, close: unknown): boolean {
  if (!Number.isInteger(open) || !Number.isInteger(close)) return false;
  const o = open as number;
  const c = close as number;
  return o >= 0 && o <= 23 && c <= MAX_CLOSE_HOUR && c - o >= MIN_OPEN_SPAN && c - o <= 24;
}

/** 顯示用：`22` → "22:00"、`27` → "03:00"（隔天） */
export function hourLabel(h: number, withNextDay = false): string {
  const t = `${String(h % 24).padStart(2, "0")}:00`;
  return withNextDay && h > 24 ? `${t}（隔天）` : t;
}

/** 營業時間區間的顯示：`{5, 27}` → "05:00–03:00（隔天）" */
export function hoursRangeLabel(open: number, close: number): string {
  return `${hourLabel(open)}–${hourLabel(close, true)}`;
}
