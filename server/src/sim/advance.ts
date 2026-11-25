import { MAX_ADVANCE_TICKS, isPaused, realMsAtTick, reanchor, type MallState, type ServerClock } from "@coidle/shared";
import { stepTick, type StepContext } from "./step";

/**
 * 把商場推進到 targetTick。不修改傳入的物件。
 *
 * - 因為每個 tick 的亂數只由 (seed, tick) 決定，
 *   一次補算 N 個 tick 與逐 tick 推進（或分段推進）的結果完全一致。
 * - 單次最多推進 MAX_ADVANCE_TICKS 個 tick（工作量上限）：落後更多時只推進到上限，
 *   回傳的狀態會比 targetTick 早，剩下的由下一次呼叫繼續——不會丟掉任何 tick。
 * - 若沒人在場時遇到「重要事件」，時鐘會在事件發生的那個 tick 停下，
 *   所以回傳的狀態也可能比 targetTick 早；此時時鐘已被事件暫停，
 *   錨點會移到事件發生的那一刻（真實時間依暫停前的流速推算；有伺服器時鐘時，不會早於伺服器走到該 tick 的時刻）。
 */
export function advanceTo(state: MallState, targetTick: number, ctx: StepContext = { nobodyPresent: false }, server?: ServerClock): MallState {
  return advanceChunk(state, targetTick, ctx, server);
}

/**
 * 一路推進到 targetTick（或被重要事件停住為止）：重複呼叫 advanceTo，不受單次工作量上限影響。
 * 伺服器的排程不用它（要分批做，免得卡住其他商場）；機器人與需要「直接跳到某一天」的測試用它。
 */
export function advanceFully(state: MallState, targetTick: number, ctx: StepContext = { nobodyPresent: false }, server?: ServerClock): MallState {
  let cur = state;
  while (cur.tick < targetTick) {
    const next = advanceChunk(cur, targetTick, ctx, server);
    if (next.tick <= cur.tick) break;
    cur = next;
    if (isPaused(cur.clock)) break;
  }
  return cur;
}

function advanceChunk(state: MallState, targetTick: number, ctx: StepContext, server?: ServerClock): MallState {
  if (targetTick <= state.tick) return state;
  const s = structuredClone(state);
  const end = Math.min(targetTick, s.tick + MAX_ADVANCE_TICKS);
  // 暫停前「還在運轉」的時鐘：算得出事件發生的真實時刻
  const runningClock = structuredClone(s.clock);
  while (s.tick < end) {
    if (stepTick(s, ctx)) {
      reanchor(s.clock, s.tick, realMsAtTick(runningClock, s.tick, server));
      break;
    }
  }
  return s;
}
