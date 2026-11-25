import { DEFAULT_PREP, INSPECTIONS, PREP_OPTIONS, inspectionScore, ticksToRealMinutes, type InspectionNotice, type PublicMallState } from "@coidle/shared";
import { money } from "../format";
import { run } from "../store";
import { Btn, Meter } from "./ui";

/** 稽查預告：還有一段時間可以備戰。沒人處理的話，到時會自動做「例行整理」。 */
export function InspectionCard({ s, n }: { s: PublicMallState; n: InspectionNotice }) {
  const def = INSPECTIONS[n.kind];
  const mins = Math.max(0, Math.round(ticksToRealMinutes(n.inspectTick - s.tick, s.clock.speed, s.clock.lag)));
  const score = inspectionScore(n.kind, s.cleanliness, s.equipment);
  const waiting = s.clock.holds.events.includes(n.uid);
  return (
    <div class="alert">
      <div class="row between">
        <h4>
          {def.icon} {def.authority}預告：{def.name}
        </h4>
        <span class="small dim">約 {mins >= 60 ? `${Math.round(mins / 6) / 10} 小時` : `${mins} 分鐘`}後到訪</span>
      </div>
      <p class="small dim">{def.noticeText.replace("通知：", "：")}</p>
      <Meter label="目前評估分數（現在來就是這個分）" value={score} hint={`${score}`} />
      {n.prep === null ? (
        <>
          <div class="row">
            {PREP_OPTIONS.map((o) => (
              <Btn key={o.id} small kind={o.id === "full" ? "primary" : "ghost"} title={o.hint} disabled={o.cost > s.funds} onClick={() => run({ type: "prepareInspection", uid: n.uid, level: o.id }, `已準備：${o.label}`)}>
                {o.label}
                {o.cost > 0 ? `（${money(o.cost)}）` : ""}
              </Btn>
            ))}
          </div>
          <p class="small dim">
            {waiting ? "時間因此暫停中，處理後會自動繼續。" : `沒人處理的話，到時會自動「${PREP_OPTIONS.find((p) => p.id === DEFAULT_PREP)?.label}」。`}
          </p>
        </>
      ) : (
        <p class="small">✅ 已準備：{PREP_OPTIONS.find((p) => p.id === n.prep)?.label}</p>
      )}
    </div>
  );
}
