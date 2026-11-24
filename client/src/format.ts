import { CURRENCY, WEEKDAY_NAMES, ticksToRealMinutes, timeInfo } from "@coidle/shared";

export function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${CURRENCY}${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

/** 大數字縮寫：12,345,678 → 12.3M */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}${CURRENCY}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${CURRENCY}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}${CURRENCY}${(a / 1e3).toFixed(0)}k`;
  return `${sign}${CURRENCY}${Math.round(a).toLocaleString("en-US")}`;
}

export function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function clockText(tick: number): string {
  const t = timeInfo(tick);
  return `${String(t.hour).padStart(2, "0")}:${String(Math.floor(t.minute / 5) * 5).padStart(2, "0")}`;
}

export function dateText(tick: number): string {
  const t = timeInfo(tick);
  return `${t.date.slice(5).replace("-", "/")} ${WEEKDAY_NAMES[t.dow]}`;
}

/** 遊戲 tick 數 → 「約 X 分鐘／X 小時」的真實時間說明 */
export function realDuration(ticks: number, speed = 1): string {
  const m = Math.round(ticksToRealMinutes(ticks, speed));
  if (m < 60) return `約 ${m} 分鐘`;
  const h = m / 60;
  return h < 24 ? `約 ${h.toFixed(h < 10 ? 1 : 0).replace(/\.0$/, "")} 小時` : `約 ${(h / 24).toFixed(1).replace(/\.0$/, "")} 天`;
}

/** 從現在往後數，下一個「HH:00」的 tick（weekendOnly：只算假日） */
export function nextTickAt(tick: number, hour: number, weekendOnly = false): number {
  const t = timeInfo(tick);
  const nowInDay = t.hour * 12 + Math.floor(t.minute / 5);
  let target = tick + (((hour * 12 - nowInDay + 288) % 288) || 288);
  if (weekendOnly) {
    for (let i = 0; i < 8 && !timeInfo(target).weekend; i++) target += 288;
  }
  return target;
}

export function signed(n: number, digits = 1): string {
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}
