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

/** 遊戲時間的完整寫法：2027/04/01 週四 14:30 */
export function fullTimeText(tick: number): string {
  const t = timeInfo(tick);
  return `${t.date.replace(/-/g, "/")} ${WEEKDAY_NAMES[t.dow]} ${String(t.hour).padStart(2, "0")}:${String(Math.floor(t.minute / 5) * 5).padStart(2, "0")}`;
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
