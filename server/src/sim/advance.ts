import { MAX_CATCHUP_TICKS, type MallState } from "@coidle/shared";
import { addLog, newDayStats } from "./state";
import { stepTick } from "./step";
import { timeInfo } from "./time";

/**
 * 把商場推進到 targetTick。不修改傳入的物件。
 *
 * - 因為每個 tick 的亂數只由 (seed, tick) 決定，
 *   一次補算 N 個 tick 與逐 tick 推進的結果完全一致。
 * - 落後超過 MAX_CATCHUP_TICKS（真實 14 天）時，只補算最後這一段。
 */
export function advanceTo(state: MallState, targetTick: number): MallState {
  if (targetTick <= state.tick) return state;
  const s = structuredClone(state);
  if (targetTick - s.tick > MAX_CATCHUP_TICKS) {
    s.tick = targetTick - MAX_CATCHUP_TICKS;
    s.today = newDayStats(timeInfo(s.tick).day, { localRep: s.localRep, touristHeat: s.touristHeat });
    addLog(s, "warn", "商場很久沒有被照顧，部分營運紀錄已被略過。");
  }
  while (s.tick < targetTick) stepTick(s);
  return s;
}
