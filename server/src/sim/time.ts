import { GAME_UTC_OFFSET_HOURS, TICKS_PER_DAY, TICK_MINUTES, TIME_SCALE } from "@coidle/shared";

const TICK_MS = TICK_MINUTES * 60_000;
const DAY_MS = 86_400_000;
const OFFSET_MS = GAME_UTC_OFFSET_HOURS * 3_600_000;

export interface TimeInfo {
  tick: number;
  /** 遊戲日序（自 1970-01-01 起算） */
  day: number;
  hour: number;
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
    dow,
    month: d.getUTCMonth() + 1,
    tickOfDay,
    date: d.toISOString().slice(0, 10),
    weekend: dow === 0 || dow === 6,
  };
}

/** 真實時間（毫秒）→ tick。時間比例由 TIME_SCALE 決定。 */
export function tickFromRealMs(realMs: number): number {
  return Math.floor((realMs * TIME_SCALE) / TICK_MS);
}

export function realMsFromTick(tick: number): number {
  return (tick * TICK_MS) / TIME_SCALE;
}
