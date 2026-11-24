import { MAX_CATCHUP_TICKS, realMsAtTick, reanchor, type MallState } from "@coidle/shared";
import { addLog, newDayStats } from "./state";
import { stepTick, type StepContext } from "./step";
import { timeInfo } from "./time";

/**
 * 把商場推進到 targetTick。不修改傳入的物件。
 *
 * - 因為每個 tick 的亂數只由 (seed, tick) 決定，
 *   一次補算 N 個 tick 與逐 tick 推進的結果完全一致。
 * - 落後超過 MAX_CATCHUP_TICKS 時，只補算最後這一段。
 * - 若沒人在場時遇到「重要事件」，時鐘會在事件發生的那個 tick 停下，
 *   所以回傳的狀態可能比 targetTick 早；此時時鐘已被事件暫停，
 *   錨點會移到事件發生的那一刻（真實時間依暫停前的流速推算）。
 */
export function advanceTo(state: MallState, targetTick: number, ctx: StepContext = { nobodyPresent: false }): MallState {
  if (targetTick <= state.tick) return state;
  const s = structuredClone(state);
  if (targetTick - s.tick > MAX_CATCHUP_TICKS) {
    s.tick = targetTick - MAX_CATCHUP_TICKS;
    s.today = newDayStats(timeInfo(s.tick).day, { localRep: s.localRep, touristHeat: s.touristHeat });
    addLog(s, "warn", "商場很久沒有被照顧，部分營運紀錄已被略過。");
  }
  // 暫停前「還在運轉」的時鐘：算得出事件發生的真實時刻
  const runningClock = structuredClone(s.clock);
  while (s.tick < targetTick) {
    if (stepTick(s, ctx)) {
      reanchor(s.clock, s.tick, realMsAtTick(runningClock, s.tick));
      break;
    }
  }
  return s;
}
