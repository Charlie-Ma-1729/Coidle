import { GAME_UTC_OFFSET_HOURS, PERSONAS, TICKS_PER_DAY, TICK_MINUTES, TIME_SCALE } from "./data";

const TICK_MS = TICK_MINUTES * 60_000;
const DAY_MS = 86_400_000;
const OFFSET_MS = GAME_UTC_OFFSET_HOURS * 3_600_000;

export interface TimeInfo {
  tick: number;
  /** 遊戲日序（自 1970-01-01 起算） */
  day: number;
  hour: number;
  minute: number;
  /** 0 = 週日 */
  dow: number;
  month: number;
  tickOfDay: number;
  date: string;
  weekend: boolean;
}

/** tick → 遊戲內時間（遊戲時鐘固定以 UTC+9 計算） */
export function timeInfo(tick: number): TimeInfo {
  const ms = tick * TICK_MS + OFFSET_MS;
  const day = Math.floor(ms / DAY_MS);
  const tickOfDay = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  const msOfDay = ms - day * DAY_MS;
  const d = new Date(ms);
  const dow = (day + 4) % 7; // 1970-01-01 是週四
  return {
    tick,
    day,
    hour: Math.floor(msOfDay / 3_600_000),
    minute: Math.floor((msOfDay % 3_600_000) / 60_000),
    dow,
    month: d.getUTCMonth() + 1,
    tickOfDay,
    date: d.toISOString().slice(0, 10),
    weekend: dow === 0 || dow === 6,
  };
}

/**
 * 時鐘錨點：真實世界的這一刻，對應遊戲內 2027-04-01 00:00（遊戲日曆）。
 * 之後每過 1 真實毫秒，遊戲時間前進 TIME_SCALE 毫秒。
 * （春天開局，約 15 個真實日後進入梅雨季。）
 */
export const CLOCK_ANCHOR_REAL_MS = Date.UTC(2026, 10, 24, 0, 0, 0);
export const CLOCK_ANCHOR_GAME_MS = Date.UTC(2027, 3, 1, 0, 0, 0) - OFFSET_MS;

/** 真實時間（毫秒）→ tick。時間比例由 TIME_SCALE 決定。 */
export function tickFromRealMs(realMs: number): number {
  return Math.floor((CLOCK_ANCHOR_GAME_MS + (realMs - CLOCK_ANCHOR_REAL_MS) * TIME_SCALE) / TICK_MS);
}

export function realMsFromTick(tick: number): number {
  return CLOCK_ANCHOR_REAL_MS + (tick * TICK_MS - CLOCK_ANCHOR_GAME_MS) / TIME_SCALE;
}

/** 遊戲 tick 數換算成真實分鐘數 */
export function ticksToRealMinutes(ticks: number): number {
  return (ticks * TICK_MINUTES) / TIME_SCALE;
}

export const WEEKDAY_NAMES = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"] as const;

/** 24 小時的相對客流量（所有客人類型加總） */
export function hourlyTraffic(weekend: boolean): number[] {
  const out = new Array<number>(24).fill(0);
  for (const p of PERSONAS) {
    const daily = p.dailyBase * (weekend ? p.weekendMult : 1);
    const share = weekend ? p.weekendHourShare : p.hourShare;
    for (let h = 0; h < 24; h++) out[h] = (out[h] ?? 0) + daily * (share[h] ?? 0);
  }
  return out;
}

export type Period = "peak" | "normal" | "quiet";

/** 這個小時是尖峰、一般還是離峰（相對當天最高峰） */
export function periodOf(hour: number, weekend: boolean): Period {
  const t = hourlyTraffic(weekend);
  const max = Math.max(...t);
  const v = (t[hour] ?? 0) / max;
  return v >= 0.72 ? "peak" : v <= 0.3 ? "quiet" : "normal";
}
