import { EVENT_BY_ID, ticksToRealMinutes, type PendingChoice, type PublicMallState } from "@coidle/shared";
import { run } from "../store";
import { Btn } from "./ui";

/** 一個需要你決定的事件：說明、選項按鈕，以及「沒人回應會怎樣」 */
export function EventChoiceCard({ s, p }: { s: PublicMallState; p: PendingChoice }) {
  const def = EVENT_BY_ID[p.defId];
  if (!def?.choice) return null;
  const mins = Math.max(0, Math.round(ticksToRealMinutes(p.deadlineTick - s.tick, s.clock.speed)));
  const defaultLabel = def.choice.options.find((o) => o.id === def.choice!.defaultOption)?.label;
  return (
    <div class="alert">
      <h4>
        {def.category === "guest" ? "🙋" : "⚡"} {def.title} <span class="dim small">（{mins >= 60 ? `${Math.round(mins / 6) / 10} 小時` : `${mins} 分鐘`}內回覆）</span>
      </h4>
      <p class="small">{def.text}</p>
      <div class="row">
        {def.choice.options.map((o) => (
          <Btn key={o.id} small kind={o.id === def.choice!.defaultOption ? "ghost" : "primary"} onClick={() => run({ type: "resolveEvent", uid: p.uid, optionId: o.id }, "已處理")}>
            {o.label}
          </Btn>
        ))}
      </div>
      <p class="small dim">沒人回應就會：{defaultLabel}</p>
    </div>
  );
}
