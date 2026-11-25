import { LEVELS } from "@coidle/shared";
import { Meter } from "../components/ui";
import { pct } from "../format";
import { state } from "../store";

/** 口碑、觀光熱度、清潔、設備、升級進度。財務頁與 HUD 的狀態面板共用。 */
export function StatusMeters() {
  const s = state.value;
  if (!s) return null;
  const next = LEVELS.find((l) => l.level === s.level + 1);
  const lvlProgress = next ? Math.min(100, (s.totalRevenue / next.minRevenue) * 100) : 100;
  return (
    <div class="stack">
      <Meter label="🏮 在地口碑" value={s.localRep} hint={s.localRep.toFixed(1)} tone="pink" />
      <Meter label="🧳 觀光熱度" value={s.touristHeat} hint={s.touristHeat.toFixed(1)} tone="cyan" />
      <Meter label="🧹 清潔" value={s.cleanliness} hint={pct(s.cleanliness)} />
      <Meter label="🔧 設備" value={s.equipment} hint={pct(s.equipment)} />
      {next && <Meter label={`⬆ 升級到 Lv.${next.level}（需口碑平均 ≥ ${next.minIndexAvg}）`} value={lvlProgress} hint={pct(lvlProgress)} tone="amber" />}
    </div>
  );
}

/** 點 HUD 資金後展開的小面板 */
export function StatusPopover(props: { onClose: () => void; onMore: () => void }) {
  return (
    <div class="st-pop st-status st-panel" role="dialog" aria-label="商場狀態">
      <div class="st-pop-head">
        <h3>商場狀態</h3>
        <button class="st-btn sq" onClick={props.onClose} aria-label="關閉">
          ✕
        </button>
      </div>
      <div class="st-pop-body">
        <StatusMeters />
        <button class="st-btn" style={{ justifyContent: "center" }} onClick={props.onMore}>
          看財務明細
        </button>
      </div>
    </div>
  );
}
