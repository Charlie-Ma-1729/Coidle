import { EVENT_BY_ID, isPaused } from "@coidle/shared";
import { busy, run, setClock, state } from "../store";
import { Btn } from "./ui";

/** 時間暫停時顯示在所有畫面頂部：說明原因，並讓任何成員一鍵恢復或處理事件 */
export function ClockBanner() {
  const s = state.value;
  if (!s || !isPaused(s.clock)) return null;
  const c = s.clock;
  const waiting = s.pending.filter((p) => c.holds.events.includes(p.uid));

  if (waiting.length > 0) {
    return (
      <div class="clock-banner event">
        <div class="cb-head">
          <b>⏸ 時間已暫停：有重要事件等你決定</b>
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
        </span>
      </div>
      <Btn small kind="primary" onClick={() => setClock({ paused: false }, "時間繼續")}>
        ▶ 恢復
      </Btn>
    </div>
  );
}
