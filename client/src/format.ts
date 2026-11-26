import { CURRENCY, TICK_MINUTES, TIME_SCALE, WEEKDAY_NAMES, timeInfo } from "@coidle/shared";

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

/**
 * 截止時間：直接寫「遊戲時間」，避免「N 小時」讓人分不清是真實還是遊戲小時。
 * 與現在同一個遊戲日就只寫鐘點，否則帶日期與星期。例：「遊戲時間 14:35」「遊戲時間 04/02 週五 14:35」
 */
export function gameDeadline(deadlineTick: number, nowTick: number): string {
  const sameDay = timeInfo(deadlineTick).day === timeInfo(nowTick).day;
  return `遊戲時間 ${sameDay ? "" : `${dateText(deadlineTick)} `}${clockText(deadlineTick)}`;
}

/**
 * 期限本身是真實時間（毫秒）的東西（聯名邀請、聯名到期），也換成遊戲時間顯示。
 * nowTick 是「此刻」在伺服器時間軸上的 tick（拿不到就用商場的 tick）。
 */
export function gameDeadlineAtMs(untilMs: number, nowMs: number, nowTick: number): string {
  const tick = nowTick + Math.round(((untilMs - nowMs) * TIME_SCALE) / (TICK_MINUTES * 60_000));
  return gameDeadline(tick, nowTick);
}

/** 遊戲 tick 數 → 「約 X 遊戲分鐘／遊戲小時／遊戲日」。一律用遊戲時間，不換算真實時間，避免兩種「小時」搞混。 */
export function gameDuration(ticks: number): string {
  const m = Math.max(0, Math.round(ticks * TICK_MINUTES));
  if (m < 60) return `約 ${m} 遊戲分鐘`;
  const h = m / 60;
  const fmt = (n: number, digits: number) => n.toFixed(digits).replace(/\.0$/, "");
  return h < 24 ? `約 ${fmt(h, h < 10 ? 1 : 0)} 遊戲小時` : `約 ${fmt(h / 24, 1)} 遊戲日`;
}

/** 把落後伺服器的 tick 數說成「N 遊戲日」 */
export function lagText(lag: number): string {
  const days = lag / 288;
  return days < 1 ? `${Math.max(1, Math.round(days * 24))} 遊戲小時` : `${days.toFixed(days < 10 ? 1 : 0).replace(/\.0$/, "")} 遊戲日`;
}

/** 從現在往後數，下一個「HH:00」的 tick（weekendOnly：只算假日） */
export function nextTickAt(tick: number, hour: number, weekendOnly = false): number {
  const t = timeInfo(tick);
  const nowInDay = t.hour * 12 + Math.floor(t.minute / 5);
  let target = tick + (((hour * 12 - nowInDay + 288) % 288) || 288);
  if (weekendOnly) {
    for (let i = 0; i < 12 && !timeInfo(target).offDay; i++) target += 288;
  }
  return target;
}

/** 真實時間 → 「MM/DD HH:mm」（本地時區） */
export function timeText(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 帶正負號的金額：+¥1,234／-¥1,234 */
export function moneySigned(n: number): string {
  return `${n > 0 ? "+" : ""}${money(n)}`;
}

export function signed(n: number, digits = 1): string {
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}
