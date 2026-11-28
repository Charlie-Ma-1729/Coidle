// 交易所的時間：仿東證（用遊戲內時間，JST）。
//  - 交易日＝平日、非國定假日（不是 offDay：黃金週、盂蘭盆是公司放假，東證照開）、非 12/31–1/3；
//  - 前場 9:00–11:30、午休、後場 12:30–15:30（2024 年 11 月起的現行時間）；
//  - 一個價格步＝3 遊戲分鐘＝30 真實秒（TIME_SCALE=6），一天 480 步，開市 110 步（前場 50、後場 60）。
// 所有函式都是純函式，只看遊戲日序與伺服器時鐘。
import { dayOfYmd, holidayOf, ymdOfDay } from "../calendar";
import { GAME_UTC_OFFSET_HOURS, TICK_MINUTES, TIME_SCALE } from "../data";
import { DEFAULT_SERVER_CLOCK, type ServerClock } from "../time";

const TICK_MS = TICK_MINUTES * 60_000;
const OFFSET_MS = GAME_UTC_OFFSET_HOURS * 3_600_000;

/** 一個價格步的真實長度（30 秒）與遊戲長度（3 分鐘） */
export const STEP_REAL_MS = 30_000;
export const STEP_GAME_MS = STEP_REAL_MS * TIME_SCALE;
export const STEPS_PER_DAY = 86_400_000 / STEP_GAME_MS; // 480

/** 前場 9:00–11:30（步 180..229）、後場 12:30–15:30（步 250..309） */
export const AM_OPEN = 180;
export const AM_END = 230;
export const PM_OPEN = 250;
export const PM_END = 310;
export const AM_STEPS = AM_END - AM_OPEN; // 50
export const PM_STEPS = PM_END - PM_OPEN; // 60
/** 每個交易日有幾個價格步 */
export const TRADING_STEPS_PER_DAY = AM_STEPS + PM_STEPS; // 110

export type SessionId = "pre" | "am" | "lunch" | "pm" | "after" | "closed";

export const SESSION_LABEL: Record<SessionId, string> = {
  pre: "開盤前",
  am: "前場",
  lunch: "午休",
  pm: "後場",
  after: "收盤後",
  closed: "休市日",
};

// ───────── 交易日 ─────────

/** 這個遊戲日東證開不開 */
export function isTradingDay(day: number): boolean {
  const c = ymdOfDay(day);
  if (c.dow === 0 || c.dow === 6) return false;
  if (c.m === 12 && c.d === 31) return false;
  if (c.m === 1 && c.d <= 3) return false;
  return holidayOf(c) === null;
}

/** 交易日序（所有交易日依序編號；起點固定在 2020-01-01，所以編號與時鐘錨點無關） */
const BASE_DAY = dayOfYmd(2020, 1, 1);
const tdList: number[] = [];
const tdIdx = new Map<number, number>();
let scanned = BASE_DAY - 1;

function scanTo(day: number): void {
  while (scanned < day) {
    scanned++;
    if (isTradingDay(scanned)) {
      tdIdx.set(scanned, tdList.length);
      tdList.push(scanned);
    }
  }
}

/** 這個遊戲日是第幾個交易日；休市日回傳 -1 */
export function tradingDayIndex(day: number): number {
  if (day < BASE_DAY) return -1;
  scanTo(day);
  return tdIdx.get(day) ?? -1;
}

/** 第 i 個交易日的遊戲日序 */
export function tradingDayAt(i: number): number {
  if (i < 0) throw new Error("trading day index < 0");
  while (tdList.length <= i) scanTo(scanned + 30);
  return tdList[i]!;
}

/** 這一天或之後的第一個交易日（遊戲日序） */
export function tradingDayOnOrAfter(day: number): number {
  let d = Math.max(day, BASE_DAY);
  for (let n = 0; n < 40; n++, d++) if (isTradingDay(d)) return d;
  return d;
}

/** 這一天之前（不含）最近的交易日 */
export function tradingDayBefore(day: number): number | null {
  let d = day - 1;
  for (let n = 0; n < 40 && d >= BASE_DAY; n++, d--) if (isTradingDay(d)) return d;
  return null;
}

// ───────── 時間換算 ─────────

/** 真實時間 → 遊戲「本地」毫秒（JST，自 1970 起算） */
export function localGameMs(realMs: number, clock: ServerClock = DEFAULT_SERVER_CLOCK): number {
  return clock.anchorTick * TICK_MS + (realMs - clock.anchorRealMs) * TIME_SCALE + OFFSET_MS;
}

/** 遊戲本地毫秒 → 真實時間 */
export function realMsOfLocal(localMs: number, clock: ServerClock = DEFAULT_SERVER_CLOCK): number {
  return clock.anchorRealMs + (localMs - OFFSET_MS - clock.anchorTick * TICK_MS) / TIME_SCALE;
}

/** 全域價格步序號（自 1970 起每 3 遊戲分鐘一步） */
export const gstepOfLocal = (localMs: number): number => Math.floor(localMs / STEP_GAME_MS);
export const gstepAt = (realMs: number, clock: ServerClock = DEFAULT_SERVER_CLOCK): number => gstepOfLocal(localGameMs(realMs, clock));
export const dayOfGstep = (g: number): number => Math.floor(g / STEPS_PER_DAY);
export const stepOfDayOf = (g: number): number => g - dayOfGstep(g) * STEPS_PER_DAY;
export const gstepOf = (day: number, stepOfDay: number): number => day * STEPS_PER_DAY + stepOfDay;
/** 這個全域步開始的真實時間 */
export const realMsOfGstep = (g: number, clock: ServerClock = DEFAULT_SERVER_CLOCK): number => realMsOfLocal(g * STEP_GAME_MS, clock);

/** 一天中的步（0..239）→ 開市步序（0..54）；不在開市時間回傳 -1 */
export function openOrdinal(stepOfDay: number): number {
  if (stepOfDay >= AM_OPEN && stepOfDay < AM_END) return stepOfDay - AM_OPEN;
  if (stepOfDay >= PM_OPEN && stepOfDay < PM_END) return AM_STEPS + (stepOfDay - PM_OPEN);
  return -1;
}

/** 開市步序（0..54）→ 一天中的步 */
export const stepOfOrdinal = (k: number): number => (k < AM_STEPS ? AM_OPEN + k : PM_OPEN + (k - AM_STEPS));

/** 一天中的步 → 時段（不看是不是交易日） */
export function sessionOfStep(stepOfDay: number): Exclude<SessionId, "closed"> {
  if (stepOfDay < AM_OPEN) return "pre";
  if (stepOfDay < AM_END) return "am";
  if (stepOfDay < PM_OPEN) return "lunch";
  if (stepOfDay < PM_END) return "pm";
  return "after";
}

/** 一天中的步 → 遊戲時間字串 "HH:MM" */
export function clockOfStep(stepOfDay: number): string {
  const min = stepOfDay * (STEP_GAME_MS / 60_000);
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export interface MarketStatus {
  session: SessionId;
  /** 現在能不能下單（前場或後場） */
  open: boolean;
  /** 遊戲日序與遊戲時間 */
  day: number;
  clock: string;
  /** 全域價格步序號 */
  gstep: number;
  /** 下一個開盤的真實時間（ms）；開市中是下一個「收盤／午休」之後的…見 nextCloseAt */
  nextOpenAt: number;
  /** 開市中：這個時段結束（午休或收盤）的真實時間；否則為 null */
  nextCloseAt: number | null;
  /** 休市的原因（假日名稱、週末…）；開市日為 null */
  reason: string | null;
  /** 管理室臨時暫停交易中（價格照常由種子與時間決定，只是不能成交） */
  halted?: boolean;
}

/** 下一個開盤步（全域步序號）：目前之後（含目前這一步若剛好是開盤第一步）的第一個開市時段起點 */
export function nextOpenGstep(g: number): number {
  const day = dayOfGstep(g);
  const s = stepOfDayOf(g);
  if (isTradingDay(day)) {
    if (s < AM_OPEN) return gstepOf(day, AM_OPEN);
    if (s >= AM_END && s < PM_OPEN) return gstepOf(day, PM_OPEN);
    if (s >= AM_OPEN && s < AM_END) return gstepOf(day, PM_OPEN); // 前場中：下一個開盤是後場
    if (s >= PM_OPEN && s < PM_END) return gstepOf(tradingDayOnOrAfter(day + 1), AM_OPEN);
  }
  return gstepOf(tradingDayOnOrAfter(day + 1), AM_OPEN);
}

function closedReason(day: number): string | null {
  const c = ymdOfDay(day);
  if (c.dow === 0 || c.dow === 6) return c.dow === 0 ? "週日休市" : "週六休市";
  if (c.m === 12 && c.d === 31) return "年末休市（大納會之後）";
  if (c.m === 1 && c.d <= 3) return "年始休市";
  const h = holidayOf(c);
  return h ? `${h.name}休市` : null;
}

/** 市場狀態（給畫面與下單檢查用） */
export function marketStatus(realMs: number, clock: ServerClock = DEFAULT_SERVER_CLOCK): MarketStatus {
  const g = gstepAt(realMs, clock);
  const day = dayOfGstep(g);
  const s = stepOfDayOf(g);
  const trading = isTradingDay(day);
  const session: SessionId = trading ? sessionOfStep(s) : "closed";
  const open = session === "am" || session === "pm";
  let nextCloseAt: number | null = null;
  if (open) nextCloseAt = realMsOfGstep(gstepOf(day, session === "am" ? AM_END : PM_END), clock);
  // 開市中的「下一個開盤」＝這個時段之後的下一個開盤
  const nextOpen = open ? nextOpenGstep(gstepOf(day, session === "am" ? AM_END : PM_END)) : nextOpenGstep(g);
  return {
    session,
    open,
    day,
    clock: clockOfStep(s),
    gstep: g,
    nextOpenAt: realMsOfGstep(nextOpen, clock),
    nextCloseAt,
    reason: trading ? null : closedReason(day),
  };
}

/** 現在這一刻有效的「開市步」全域序號：休市時是最近一個開市步（收盤價所在的步） */
export function lastOpenGstep(g: number): number | null {
  const day = dayOfGstep(g);
  const s = stepOfDayOf(g);
  if (isTradingDay(day)) {
    if (s >= PM_END) return gstepOf(day, PM_END - 1);
    if (s >= PM_OPEN) return g;
    if (s >= AM_END) return gstepOf(day, AM_END - 1);
    if (s >= AM_OPEN) return g;
  }
  const prev = tradingDayBefore(day);
  return prev === null ? null : gstepOf(prev, PM_END - 1);
}
