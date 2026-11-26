import { useEffect, useState } from "preact/hooks";
import { TICK_MINUTES, TIME_SCALE, WEEKDAY_NAMES, isPaused, timeInfo, type PublicMallState } from "@coidle/shared";
import { state } from "./store";

// 商場自己的時間 vs 伺服器基準時間。伺服器每次送狀態都附上「那一刻」的伺服器 tick（serverTick），
// 畫面記下收到的時刻，之後用真實時間往後推算，所以不用每分鐘都推新狀態，暫停中的商場也看得到落後量在增加。

const receivedAt = new WeakMap<object, number>();
state.subscribe((v) => {
  if (v) receivedAt.set(v, Date.now());
});

const TICK_MS = TICK_MINUTES * 60_000;

/** 伺服器基準時間現在走到哪個 tick；測試商場不受夾限，沒有這個概念（null） */
export function serverTickNow(s: PublicMallState, now = Date.now()): number | null {
  if (s.serverTick === undefined) return null;
  const at = receivedAt.get(s) ?? now;
  return s.serverTick + Math.floor((Math.max(0, now - at) * TIME_SCALE) / TICK_MS);
}

/**
 * 商場落後伺服器基準時間幾個 tick（0＝已追上）。暫停中的商場時間不動，所以落後量隨真實時間增加；
 * 運轉中的商場以收到狀態那一刻為準（它的 tick 只在狀態推送時更新）。測試商場沿用伺服器寫入的 clock.lag。
 */
export function lagNow(s: PublicMallState, now = Date.now()): number {
  if (s.serverTick === undefined) return s.clock.lag ?? 0;
  const server = isPaused(s.clock) ? (serverTickNow(s, now) as number) : s.serverTick;
  return Math.max(0, server - s.tick);
}

/**
 * 商場時間此刻相對標準流速（真實 4 小時＝1 遊戲日）的倍率，畫面上的人物照這個倍率動：
 * 暫停＝0（人物定格）；落後伺服器而在追趕＝追趕速度（2／3／6×）；已追上＝1。
 * 測試商場不受夾限，照自己的流速。
 */
export function timeFlow(s: PublicMallState, now = Date.now()): number {
  if (isPaused(s.clock)) return 0;
  const v = Math.max(s.clock.speed, 0);
  if (s.serverTick === undefined) return v;
  return v > 1 && lagNow(s, now) > 0 ? v : 1;
}

/** 一個 tick 內最多往前內插幾分鐘（再多就等下一個 tick，不會超過下一個 tick 的時間） */
const MAX_EXTRA_MINUTES = TICK_MINUTES - 1;
const MAX_EXTRA_MS = (MAX_EXTRA_MINUTES + 1) * 60_000 - 1;

/**
 * 全站共用的「tick 之後又走了多久」模型：主畫面時鐘、設定頁的時間都讀同一份，所以永遠同步。
 * 伺服器一個 tick 是 5 遊戲分鐘（真實約 50 秒），狀態只在 tick 變動時更新，畫面會「5 分鐘 5 分鐘跳」，
 * 所以在 tick 之間依時間流速（`timeFlow`：暫停 0、追趕加速倍率）往前內插。
 * 流速只會在收到新狀態時改變（暫停、追趕狀態都來自狀態），所以只要在每次狀態更新時記一筆
 * 「基準毫秒＋起算時刻＋流速」，之後任何時刻都能算出同一個值；新的 tick 一來從 0 重算，不會倒退。
 */
interface LiveModel {
  tick: number;
  /** 起算時刻之前，這個 tick 之後累計的遊戲毫秒 */
  baseMs: number;
  since: number;
  flow: number;
}
let live: LiveModel = { tick: -1, baseMs: 0, since: 0, flow: 0 };

function liveMs(m: LiveModel, now: number): number {
  return Math.min(MAX_EXTRA_MS, m.baseMs + Math.round(Math.max(0, now - m.since) * TIME_SCALE * m.flow));
}

state.subscribe((v) => {
  if (!v) {
    live = { tick: -1, baseMs: 0, since: 0, flow: 0 };
    return;
  }
  const now = Date.now();
  const flow = timeFlow(v, now);
  // 同一個 tick（流速改變、重送快照）：先把過去這段記進基準；新的 tick：從 0 開始
  live = v.tick === live.tick ? { tick: v.tick, baseMs: liveMs(live, now), since: now, flow } : { tick: v.tick, baseMs: 0, since: now, flow };
});

/** 商場時間在 `s.tick` 之後又走了幾分鐘（0–4）。每秒重算一次，所有畫面讀到的值一致。s 為 null 或還沒同步到這份狀態時回傳 0 */
export function useLiveExtra(s: PublicMallState | null): number {
  useTicker(1000);
  return s && s.tick === live.tick ? Math.floor(liveMs(live, Date.now()) / 60_000) : 0;
}

/** 逐分鐘的當日分鐘數：minuteOfDay 是 tick 對應的（整 5 分），加上 `useLiveExtra`（0–1439） */
export function useLiveMinute(s: PublicMallState, minuteOfDay: number): number {
  return (minuteOfDay + useLiveExtra(s)) % 1440;
}

/** 伺服器基準時間在 `serverTickNow` 那個 tick 之後又走了幾分鐘（0–4）；測試商場為 0 */
export function serverExtraMinutes(s: PublicMallState, now = Date.now()): number {
  if (s.serverTick === undefined) return 0;
  const at = receivedAt.get(s) ?? now;
  const gameMinutes = (Math.max(0, now - at) * TIME_SCALE) / 60_000;
  return Math.floor(gameMinutes % TICK_MINUTES);
}

/** 遊戲時間的完整寫法：2027/04/01 週四 14:30（extraMinutes：tick 之後內插的分鐘，0–4） */
export function fullTimeText(tick: number, extraMinutes = 0): string {
  const t = timeInfo(tick);
  const m = Math.min(59, t.minute + Math.max(0, Math.floor(extraMinutes)));
  return `${t.date.replace(/-/g, "/")} ${WEEKDAY_NAMES[t.dow]} ${String(t.hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 落後量的精確說法：2 遊戲日 3 小時、6 小時 20 分 */
export function lagDetail(lag: number): string {
  const mins = lag * TICK_MINUTES;
  if (mins < 1) return "0 分";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = Math.round(mins % 60);
  if (d > 0) return `${d} 遊戲日${h > 0 ? ` ${h} 小時` : ""}`;
  return h > 0 ? `${h} 小時${m > 0 ? ` ${m} 分` : ""}` : `${m} 分`;
}

/** 每隔 ms 重新繪製一次，讓依真實時間推算的數字會動 */
export function useTicker(ms = 5000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}
