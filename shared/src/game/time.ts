import { calendarDay } from "./calendar";
import { GAME_UTC_OFFSET_HOURS, PERSONAS, TICKS_PER_DAY, TICK_MINUTES, TIME_SCALE } from "./data";
import type { MallClock, SpeedId } from "./types";

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
  /** 週六、週日 */
  weekend: boolean;
  /** 休息日：週末、國定假日、或公司放假的長假（年末年始、黃金週、盂蘭盆）。客流用週末的曲線與倍率 */
  offDay: boolean;
  /** 國定假日名稱（含補假）；不是假日為 null */
  holiday: string | null;
}

/** tick → 遊戲日序（自 1970-01-01 起算；遊戲時鐘固定以 UTC+9 計算） */
export function dayOfTick(tick: number): number {
  return Math.floor((tick * TICK_MS + OFFSET_MS) / DAY_MS);
}

/** tick → 遊戲內時間（遊戲時鐘固定以 UTC+9 計算） */
export function timeInfo(tick: number): TimeInfo {
  const ms = tick * TICK_MS + OFFSET_MS;
  const day = Math.floor(ms / DAY_MS);
  const tickOfDay = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  const msOfDay = ms - day * DAY_MS;
  const d = new Date(ms);
  const dow = (day + 4) % 7; // 1970-01-01 是週四
  const cal = calendarDay(day);
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
    offDay: cal.offDay,
    holiday: cal.holiday,
  };
}

/**
 * 預設的伺服器時鐘錨點：真實世界的這一刻，對應遊戲內 2027-04-01 00:00（遊戲日曆）。
 * 之後每過 1 真實毫秒，遊戲時間前進 TIME_SCALE 毫秒。
 * （春天開局，約 15 個真實日後進入梅雨季。）
 * 正式伺服器的錨點存在資料庫（見 server 的 server_clock），這組只是全新資料庫與測試的預設。
 */
export const CLOCK_ANCHOR_REAL_MS = Date.UTC(2026, 10, 24, 0, 0, 0);
export const CLOCK_ANCHOR_GAME_MS = Date.UTC(2027, 3, 1, 0, 0, 0) - OFFSET_MS;

/** 伺服器基準時間的錨點：真實時間 anchorRealMs 對應伺服器 tick anchorTick */
export interface ServerClock {
  anchorRealMs: number;
  anchorTick: number;
}

export const DEFAULT_SERVER_CLOCK: ServerClock = {
  anchorRealMs: CLOCK_ANCHOR_REAL_MS,
  anchorTick: Math.floor(CLOCK_ANCHOR_GAME_MS / TICK_MS),
};

/** 真實時間（毫秒）→ 伺服器基準 tick。所有商場的 tick 都不會超過它。 */
export function serverTickAt(realMs: number, sc: ServerClock = DEFAULT_SERVER_CLOCK): number {
  return sc.anchorTick + Math.floor(((realMs - sc.anchorRealMs) * TIME_SCALE) / TICK_MS);
}

/** 伺服器基準時間走到某個 tick 的真實時間（毫秒） */
export function serverRealMsAt(tick: number, sc: ServerClock = DEFAULT_SERVER_CLOCK): number {
  return sc.anchorRealMs + ((tick - sc.anchorTick) * TICK_MS) / TIME_SCALE;
}

/** 落後伺服器基準時間幾個 tick（追上或在前面都是 0） */
export function lagTicks(tick: number, nowMs: number, sc: ServerClock = DEFAULT_SERVER_CLOCK): number {
  return Math.max(0, serverTickAt(nowMs, sc) - tick);
}

/** 預設錨點下的換算（測試與沒有資料庫的場合用） */
export function tickFromRealMs(realMs: number): number {
  return serverTickAt(realMs);
}

export function realMsFromTick(tick: number): number {
  return serverRealMsAt(tick);
}

/**
 * 遊戲 tick 數換算成真實分鐘數。
 * - 沒給 lag（測試商場不受夾限）：單純依流速 speed 換算。
 * - 給了 lag（落後伺服器的 tick 數，0＝已追上）：用追趕模型——落後時以 speed 倍速追，
 *   追上之後夾回 1×。speed 與 lag 的關係：追趕期每經過 1 個伺服器 tick，商場前進 speed 個 tick。
 */
export function ticksToRealMinutes(ticks: number, speed = 1, lag?: number): number {
  const v = Math.max(speed, 1e-9);
  const perTick = TICK_MINUTES / TIME_SCALE; // 1 個伺服器 tick 等於幾個真實分鐘
  if (lag === undefined) return (ticks * perTick) / v;
  if (lag <= 0 || v <= 1) return ticks * perTick; // 已追上，或追趕速度不比伺服器快：1×
  const catchUpTicks = (v * lag) / (v - 1); // 追趕期間商場前進的 tick 數
  if (ticks <= catchUpTicks) return (ticks * perTick) / v;
  return (lag / (v - 1) + (ticks - catchUpTicks)) * perTick;
}

/** 以追趕速度 speed 追上落後 lag 個 tick 要幾個真實分鐘；追趕速度不比伺服器快就追不上（回傳 Infinity） */
export function catchUpMinutes(lag: number, speed: number): number {
  if (lag <= 0) return 0;
  if (speed <= 1) return Infinity;
  return (lag / (speed - 1)) * (TICK_MINUTES / TIME_SCALE);
}

// ───────── 每座商場的時鐘：調速、暫停 ─────────

export interface SpeedPreset {
  id: SpeedId;
  name: string;
  /** 相對於標準的倍率 */
  mult: number;
  /** 真實幾小時為 1 遊戲日 */
  realHoursPerDay: number;
}

/**
 * 追趕速度，由快到慢：只有落後伺服器基準時間時才有用；已追上伺服器的商場一律 1×（4 小時＝1 遊戲日）。
 * 想慢慢玩就暫停（holds.manual），暫停期間產生的落後之後再追。
 */
export const SPEED_PRESETS: SpeedPreset[] = [
  { id: "turbo", name: "極速追趕", mult: 6, realHoursPerDay: 24 / TIME_SCALE / 6 },
  { id: "rapid", name: "快速追趕", mult: 3, realHoursPerDay: 24 / TIME_SCALE / 3 },
  { id: "brisk", name: "輕快追趕", mult: 2, realHoursPerDay: 24 / TIME_SCALE / 2 },
  { id: "standard", name: "與伺服器同速", mult: 1, realHoursPerDay: 24 / TIME_SCALE },
];
/** 最慢的檔位倍率（比這更慢的舊設定會在載入時被拉回） */
export const SLOWEST_SPEED = 1;
/** 新商場預設的追趕速度：落後時自動全速追，追上就是 1× */
export const DEFAULT_CATCHUP_SPEED = 6;

export function speedPreset(id: string): SpeedPreset | undefined {
  return SPEED_PRESETS.find((p) => p.id === id);
}

/** 目前流速最接近哪個檔位 */
export function presetOfSpeed(speed: number): SpeedPreset {
  return SPEED_PRESETS.reduce((best, p) => (Math.abs(p.mult - speed) < Math.abs(best.mult - speed) ? p : best), SPEED_PRESETS[3]!);
}

export function newClock(nowMs: number, tick: number, speed = 1): MallClock {
  return {
    speed,
    anchorRealMs: nowMs,
    anchorTick: tick,
    holds: { manual: false, idle: false, events: [] },
    pauseOnEvents: true,
    idlePauseDays: null,
    lastVisitRealMs: nowMs,
  };
}

export function isPaused(clock: MallClock): boolean {
  return clock.holds.manual || clock.holds.idle || clock.holds.events.length > 0;
}

/** 有效流速：只要任何暫停原因成立就是 0 */
export function effectiveSpeed(clock: MallClock): number {
  return isPaused(clock) ? 0 : clock.speed;
}

/**
 * 真實時間 → 這座商場此刻應該走到的 tick。
 * 給了 server（伺服器時鐘）就夾在伺服器基準 tick 以內：已追上時實際速度必為 1×，
 * 不需要另外的狀態機。不給（測試商場）就不夾，照商場自己的流速跑。
 */
export function tickAt(clock: MallClock, nowMs: number, server?: ServerClock): number {
  const v = effectiveSpeed(clock);
  if (v === 0) return clock.anchorTick;
  const elapsed = Math.max(0, nowMs - clock.anchorRealMs);
  const own = clock.anchorTick + Math.floor((elapsed * TIME_SCALE * v) / TICK_MS);
  if (!server) return own;
  return Math.max(clock.anchorTick, Math.min(own, serverTickAt(nowMs, server)));
}

/** 這座商場走到 tick 時，對應的真實時間（時鐘正在運轉時才有意義）。有夾限時不會早於伺服器走到該 tick 的時刻。 */
export function realMsAtTick(clock: MallClock, tick: number, server?: ServerClock): number {
  const v = effectiveSpeed(clock);
  if (v === 0) return clock.anchorRealMs;
  const own = clock.anchorRealMs + ((tick - clock.anchorTick) * TICK_MS) / (TIME_SCALE * v);
  return server ? Math.max(own, serverRealMsAt(tick, server)) : own;
}

/** 把錨點移到「現在這個 tick＋現在的真實時間」。改速／恢復時用，確保時間不會跳動。 */
export function reanchor(clock: MallClock, tick: number, nowMs: number): void {
  clock.anchorRealMs = nowMs;
  clock.anchorTick = tick;
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
