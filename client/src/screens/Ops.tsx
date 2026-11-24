import { useEffect, useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  CLEANING_COST_PER_DAY,
  MAINTENANCE_COST_PER_DAY,
  SPEED_PRESETS,
  UTILITIES_PER_DAY,
  hourlyTraffic,
  isPaused,
  presetOfSpeed,
  timeInfo,
} from "@coidle/shared";
import { Btn, Card, Chip, Field } from "../components/ui";
import { money } from "../format";
import { run, setClock, state } from "../store";

const LEVEL_NAMES = ["不做", "標準", "加強"] as const;

export function Ops() {
  const s = state.value;
  const [open, setOpen] = useState(s?.hours.open ?? 10);
  const [close, setClose] = useState(s?.hours.close ?? 22);
  const [weekend, setWeekend] = useState(false);

  useEffect(() => {
    if (s) {
      setOpen(s.hours.open);
      setClose(s.hours.close);
    }
  }, [s?.hours.open, s?.hours.close]);

  if (!s) return null;
  const traffic = hourlyTraffic(weekend);
  const peak = Math.max(...traffic);
  const total = traffic.reduce((a, b) => a + b, 0);
  const captured = traffic.reduce((a, v, h) => (h >= open && h < close ? a + v : a), 0);
  const nowHour = timeInfo(s.tick).hour;

  let wages = 0;
  for (const sh of s.shops) if (sh.mode === "direct") wages += (CATEGORY_BY_ID[sh.category]?.wage ?? 0) * sh.level;
  const fixed = UTILITIES_PER_DAY + CLEANING_COST_PER_DAY[s.cleaningLevel] + MAINTENANCE_COST_PER_DAY[s.maintenanceLevel] + wages;

  const clock = s.clock;
  const manualPaused = clock.holds.manual;
  const activePreset = presetOfSpeed(clock.speed);

  return (
    <>
      <Card title="⏱ 時間流速" right={<Chip tone={isPaused(clock) ? "amber" : "green"}>{isPaused(clock) ? "⏸ 已暫停" : `${activePreset.name}・${activePreset.realHoursPerDay} 小時＝1 日`}</Chip>}>
        <div class="stack">
          <div class="seg five">
            {SPEED_PRESETS.map((p) => (
              <button key={p.id} class={!manualPaused && activePreset.id === p.id ? "active" : ""} onClick={() => setClock({ speed: p.id }, `時間流速：${p.name}`)}>
                <b>{p.name}</b>
                <small>{p.realHoursPerDay} 小時/日</small>
              </button>
            ))}
            <button class={manualPaused ? "active pause" : "pause"} onClick={() => setClock({ paused: !manualPaused }, manualPaused ? "時間繼續" : "時間已暫停")}>
              <b>{manualPaused ? "▶ 恢復" : "⏸ 暫停"}</b>
              <small>{manualPaused ? "繼續走" : "時間靜止"}</small>
            </button>
          </div>
          <p class="small dim">
            最快就是「標準」。調慢會讓營收、升級、事件、建造<b>一起變慢</b>；暫停時間完全靜止——不營業、不扣成本、不發生事件，什麼都不會流失。任何隊員都可以調整，不用等別人同意。
          </p>
          <label class="row">
            <input type="checkbox" checked={clock.pauseOnEvents} onChange={(e) => setClock({ pauseOnEvents: (e.target as HTMLInputElement).checked })} />
            <span>沒人在場時，遇到重要事件自動暫停並通知</span>
          </label>
          <p class="small dim">例如颱風要不要閉館。只有「放著會吃大虧」的事件才會暫停，一般事件照常營運；有人在線時不會暫停。</p>
          <Field label="全員連續幾天沒上線就自動暫停（保底）">
            <select value={clock.idlePauseDays ?? ""} onChange={(e) => setClock({ idlePauseDays: (e.target as HTMLSelectElement).value === "" ? null : Number((e.target as HTMLSelectElement).value) })}>
              <option value="">關閉（離線期間照常營運）</option>
              {[1, 2, 3, 5, 7, 14].map((d) => (
                <option key={d} value={d}>
                  {d} 天
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="🕒 營業時間" right={<Chip tone="green">涵蓋約 {Math.round((captured / total) * 100)}% 的客流</Chip>}>
        <div class="stack">
          <div class="row">
            <Btn small kind={!weekend ? "primary" : "ghost"} onClick={() => setWeekend(false)}>
              平日客流
            </Btn>
            <Btn small kind={weekend ? "primary" : "ghost"} onClick={() => setWeekend(true)}>
              假日客流
            </Btn>
          </div>
          <div class="hours-chart" aria-label="24 小時客流">
            {traffic.map((v, h) => (
              <div key={h} class={`h ${h >= open && h < close ? "open" : ""}`} style={{ height: `${(v / peak) * 100}%`, outline: h === nowHour ? "1px solid var(--cyan)" : undefined }} />
            ))}
          </div>
          <div class="hours-axis">
            {traffic.map((_, h) => (
              <span key={h}>{h % 3 === 0 ? h : ""}</span>
            ))}
          </div>
          <div class="two-col">
            <Field label="開門">
              <select value={open} onChange={(e) => setOpen(Number((e.target as HTMLSelectElement).value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </Field>
            <Field label="打烊">
              <select value={close} onChange={(e) => setClose(Number((e.target as HTMLSelectElement).value))}>
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p class="small dim">粉紅色是營業中的時段。尖峰時段沒開門就等於把客人送給別人；但開得越久，人事與水電也照算。</p>
          <Btn kind="primary" disabled={open === s.hours.open && close === s.hours.close} onClick={() => run({ type: "setHours", open, close }, "營業時間已更新")}>
            套用營業時間
          </Btn>
        </div>
      </Card>

      <div class="grid two">
        <Card title="🧹 清潔等級" right={<span class="small dim">目前整潔度 {Math.round(s.cleanliness)}</span>}>
          <div class="seg">
            {([0, 1, 2] as const).map((lv) => (
              <button key={lv} class={s.cleaningLevel === lv ? "active" : ""} onClick={() => run({ type: "setCleaning", level: lv })}>
                <b>{LEVEL_NAMES[lv]}</b>
                <small>{money(CLEANING_COST_PER_DAY[lv])}/日</small>
              </button>
            ))}
          </div>
          <p class="small dim" style={{ marginTop: "8px" }}>
            越髒客人越不滿意。「標準」大致能維持；人多的時候要加強。
          </p>
        </Card>
        <Card title="🔧 設備維護" right={<span class="small dim">目前狀態 {Math.round(s.equipment)}</span>}>
          <div class="seg">
            {([0, 1, 2] as const).map((lv) => (
              <button key={lv} class={s.maintenanceLevel === lv ? "active" : ""} onClick={() => run({ type: "setMaintenance", level: lv })}>
                <b>{LEVEL_NAMES[lv]}</b>
                <small>{money(MAINTENANCE_COST_PER_DAY[lv])}/日</small>
              </button>
            ))}
          </div>
          <p class="small dim" style={{ marginTop: "8px" }}>
            設備老舊會故障：店家被迫停業並付維修費。
          </p>
        </Card>
      </div>

      <Card title="📋 每日固定成本估算">
        <div class="stack small">
          <div class="row between">
            <span class="dim">水電等基本開銷</span>
            <b>{money(UTILITIES_PER_DAY)}</b>
          </div>
          <div class="row between">
            <span class="dim">清潔 ＋ 維護</span>
            <b>{money(CLEANING_COST_PER_DAY[s.cleaningLevel] + MAINTENANCE_COST_PER_DAY[s.maintenanceLevel])}</b>
          </div>
          <div class="row between">
            <span class="dim">直營店人事（{s.shops.filter((x) => x.mode === "direct").length} 間）</span>
            <b>{money(wages)}</b>
          </div>
          <div class="row between">
            <span>合計 / 遊戲日（約 6 真實小時）</span>
            <b>{money(fixed)}</b>
          </div>
        </div>
      </Card>
    </>
  );
}
