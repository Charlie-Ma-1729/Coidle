import { EVENT_BY_ID, INTERACT_MAX_LAG_TICKS, TICKS_PER_DAY, catchUpMinutes, isPaused } from "@coidle/shared";
import { lagText } from "../format";
import { lagNow, useTicker } from "../serverTime";
import { busy, run, setClock, state } from "../store";
import { InspectionCard } from "./InspectionCard";
import { Btn } from "./ui";

/** 落後多少 tick 以內不特別提醒（6 遊戲小時） */
const LAG_QUIET = TICKS_PER_DAY / 4;

/** 時間暫停時顯示在所有畫面頂部：說明原因，並讓任何成員一鍵恢復或處理事件；落後伺服器時間時顯示追趕進度 */
export function ClockBanner() {
  useTicker(10_000);
  const s = state.value;
  if (!s) return null;
  const lag = lagNow(s);
  if (!isPaused(s.clock)) {
    if (lag < LAG_QUIET) return null;
    const mins = catchUpMinutes(lag, s.clock.speed);
    return (
      <div class="clock-banner">
        <div class="cb-head">
          <b>⏩ 正在追趕伺服器時間</b>
          <span class="small dim">
            還差 {lagText(lag)}
            {Number.isFinite(mins) ? `，約 ${mins < 90 ? `${Math.max(1, Math.round(mins))} 分鐘` : `${(mins / 60).toFixed(1)} 小時`}追上` : "（追趕速度已是 1×，追不上；到設定調快一點）"}。
            {lag > INTERACT_MAX_LAG_TICKS ? "追到落後 5 遊戲日以內，才能發起聯名、搶客、貿易。" : ""}
          </span>
        </div>
      </div>
    );
  }
  const c = s.clock;
  const waiting = s.pending.filter((p) => c.holds.events.includes(p.uid));
  const notices = s.inspections.pending.filter((n) => c.holds.events.includes(n.uid));

  if (waiting.length > 0 || notices.length > 0) {
    return (
      <div class="clock-banner event">
        <div class="cb-head">
          <b>⏸ 時間已暫停：有重要的事等你決定</b>
          <span class="small dim">處理完時間會自動繼續，期限不會流失。</span>
        </div>
        {waiting.map((p) => {
          const def = EVENT_BY_ID[p.defId];
          if (!def?.choice) return null;
          return (
            <div class="cb-event" key={p.uid}>
              <div>
                <b>{def.title}</b>
                <p class="small dim">{def.text}</p>
              </div>
              <div class="row">
                {def.choice.options.map((o) => (
                  <Btn key={o.id} small kind={o.id === def.choice!.defaultOption ? "ghost" : "primary"} onClick={() => run({ type: "resolveEvent", uid: p.uid, optionId: o.id }, "已處理，時間繼續")}>
                    {o.label}
                  </Btn>
                ))}
              </div>
            </div>
          );
        })}
        {notices.map((n) => (
          <InspectionCard key={n.uid} s={s} n={n} />
        ))}
        <div class="row">
          <Btn small disabled={busy.value} onClick={() => run({ type: "resolveAllDefault" }, "已採預設處理，時間繼續")}>
            全部採預設處理並恢復
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div class="clock-banner">
      <div class="cb-head">
        <b>⏸ 時間已暫停</b>
        <span class="small dim">
          {c.holds.idle ? "因為太久沒有人上線而自動暫停。" : "營業、成本、事件都停在原地，不會有任何損失。"}
          {lag >= LAG_QUIET ? `伺服器時間繼續走，目前已落後 ${lagText(lag)}，恢復後會自動追趕。` : ""}
        </span>
      </div>
      <Btn small kind="primary" onClick={() => setClock({ paused: false }, "時間繼續")}>
        ▶ 恢復
      </Btn>
    </div>
  );
}
