import { useEffect, useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  CLEANING_COST_PER_DAY,
  INSPECTIONS,
  INTERACT_MAX_LAG_TICKS,
  MAINTENANCE_COST_PER_DAY,
  OUTCOME_INFO,
  REAL_HOURS_PER_GAME_DAY,
  RESERVE_UPKEEP_PER_DAY,
  SPEED_PRESETS,
  TICKS_PER_DAY,
  UTILITIES_PER_DAY,
  facilityScale,
  hourlyTraffic,
  hourLabel,
  inspectionScore,
  isHourOpen,
  isPaused,
  MAX_CLOSE_HOUR,
  MIN_OPEN_SPAN,
  validHours,
  laborCostFactor,
  presetOfSpeed,
  techFx,
  timeInfo,
  WEATHER_NAMES,
  calendarTrafficAverage,
  dayWeather,
  weatherAt,
  weatherNow,
  weatherTrafficAverage,
} from "@coidle/shared";
import { CalendarCard } from "../ui/CalendarCard";
import { ConceptCard } from "../ui/ConceptCard";
import { FacilityCard } from "../ui/FacilityCard";
import { forecastAdvice, forecastText } from "../ui/weatherUi";
import { DeviceCard } from "../components/DeviceCard";
import { InspectionCard } from "../components/InspectionCard";
import { Btn, Card, Chip, Field, Meter } from "../components/ui";
import { lagText, money } from "../format";
import { run, setClock, state } from "../store";
import { fullTimeText, lagDetail, lagNow, serverExtraMinutes, serverTickNow, useLiveExtra, useTicker } from "../serverTime";

const LEVEL_NAMES = ["不做", "標準", "加強"] as const;


/** 時間與自動暫停設定（HUD 只放暫停／繼續，其餘進階項目收在設定視窗） */
export function TimeSettings() {
  useTicker(2000); // 時間逐分鐘走（真實約每 10 秒 1 分鐘），不用等 5 秒才更新
  const s = state.value;
  const extra = useLiveExtra(s); // 必須在 early return 之前呼叫（hook 順序）
  if (!s) return null;
  const clock = s.clock;
  const manualPaused = clock.holds.manual;
  const activePreset = presetOfSpeed(clock.speed);
  const lag = lagNow(s);
  const serverTick = serverTickNow(s);
  const syncChip = isPaused(clock) ? "⏸ 已暫停" : lag > TICKS_PER_DAY / 12 ? `⏩ 追趕中・落後 ${lagText(lag)}` : `已同步・${REAL_HOURS_PER_GAME_DAY} 小時＝1 日`;
  return (
        <Card title="⏱ 時間" right={<Chip tone={isPaused(clock) || lag > TICKS_PER_DAY / 12 ? "amber" : "green"}>{syncChip}</Chip>}>
          <div class="stack">
            <div class="time-compare">
              {serverTick === null ? (
                <div>
                  <span>商場時間</span>
                  <b>{fullTimeText(s.tick, extra)}</b>
                  <small>測試商場：不受伺服器基準時間限制</small>
                </div>
              ) : (
                <>
                  <div>
                    <span>伺服器時間</span>
                    <b>{fullTimeText(serverTick, serverExtraMinutes(s))}</b>
                  </div>
                  <div>
                    <span>你的商場</span>
                    <b>{fullTimeText(s.tick, extra)}</b>
                    <small class={lag > 0 ? "late" : ""}>{lag > 0 ? `落後 ${lagDetail(lag)}${isPaused(clock) ? "（暫停中，仍在增加）" : ""}` : "已追上，同步中"}</small>
                  </div>
                </>
              )}
            </div>
            <div class="seg five">
              {SPEED_PRESETS.map((p) => (
                <button key={p.id} class={!manualPaused && activePreset.id === p.id ? "active" : ""} onClick={() => setClock({ speed: p.id }, `追趕速度：${p.name}`)}>
                  <b>{p.mult}×</b>
                  <small>{p.name}</small>
                </button>
              ))}
              <button class={manualPaused ? "active pause" : "pause"} onClick={() => setClock({ paused: !manualPaused }, manualPaused ? "時間繼續" : "時間已暫停")}>
                <b>{manualPaused ? "▶ 恢復" : "⏸ 暫停"}</b>
                <small>{manualPaused ? "繼續走" : "時間靜止"}</small>
              </button>
            </div>
            <p class="small dim">
              所有商場共用一個<b>伺服器基準時間</b>：{REAL_HOURS_PER_GAME_DAY} 真實小時＝1 遊戲日，誰都不能比它快。暫停時商場的時間靜止（不營業、不扣成本、不發生事件，什麼都不會流失），但伺服器時間繼續走，所以暫停會讓你的商場<b>落後</b>；恢復後會依上面選的追趕速度加速追回，追上之後就和伺服器同速。聯名、搶客、貿易這些跨商場互動都以伺服器時間為準，落後超過 {INTERACT_MAX_LAG_TICKS / TICKS_PER_DAY} 個遊戲日時要先追上才能發起。任何隊員都可以調整。
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
  );
}

/** 營業時間（含客流預測）。 */
export function HoursCards() {
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
  const captured = traffic.reduce((a, v, h) => (isHourOpen(open, close, h) ? a + v : a), 0);
  // 打烊時間可以選到隔天凌晨（05~03 這種跨午夜營業）；每天營業 4～24 小時
  const closeChoices: number[] = [];
  for (let c = open + MIN_OPEN_SPAN; c <= Math.min(MAX_CLOSE_HOUR, open + 24); c++) closeChoices.push(c);
  const nowHour = timeInfo(s.tick).hour;
  return (
    <>
      {techFx(s.tech.done).forecast && (
        <Card title="📈 客流預測（大數據分析）" right={<span class="small dim">接下來 12 個遊戲小時</span>}>
          <div class="bars">
            {Array.from({ length: 12 }, (_, i) => {
              const ti = timeInfo(s.tick + i * 12);
              const h = ti.hour;
              const wk = ti.offDay;
              // 天氣與日曆也算進去：下雨、颱風時整體人流會明顯變少；連假、節日則會變多（i = 0 是此刻，含事件強制的天氣）
              const w = i === 0 ? weatherNow(s) : weatherAt(ti.day, h);
              const v = (hourlyTraffic(wk)[h] ?? 0) * weatherTrafficAverage(w) * calendarTrafficAverage(ti.day);
              const mx = Math.max(...hourlyTraffic(wk)) * 1.1;
              return <div class="bar" key={i} title={`${h}:00　${WEATHER_NAMES[w.kind]}　${Math.round((v / mx) * 100)}%`} style={{ height: `${Math.max(4, Math.min(100, (v / mx) * 100))}%` }} />;
            })}
          </div>
          <p class="small dim">柱子越高人越多（已含天氣與日曆）；尖峰前把庫存補好、人手排滿。</p>
          <p class="small">
            <b>明日預報：</b>
            {forecastText(dayWeather(timeInfo(s.tick).day + 1))}
            {forecastAdvice(dayWeather(timeInfo(s.tick).day + 1)) && <span class="dim">　{forecastAdvice(dayWeather(timeInfo(s.tick).day + 1))}</span>}
          </p>
        </Card>
      )}

      <ConceptCard />
      <FacilityCard />

      <Card title="📅 日本日曆" right={<span class="small dim">連假與節日的人潮</span>}>
        <CalendarCard tick={s.tick} />
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
              <div key={h} class={`h ${isHourOpen(open, close, h) ? "open" : ""}`} style={{ height: `${(v / peak) * 100}%`, outline: h === nowHour ? "1px solid var(--cyan)" : undefined }} />
            ))}
          </div>
          <div class="hours-axis">
            {traffic.map((_, h) => (
              <span key={h}>{h % 3 === 0 ? h : ""}</span>
            ))}
          </div>
          <div class="two-col">
            <Field label="開門">
              <select
                value={open}
                onChange={(e) => {
                  const o = Number((e.target as HTMLSelectElement).value);
                  setOpen(o);
                  // 改開門時間後，打烊若變得不合法（太短或超過 24 小時），自動挪到最接近的合法值
                  setClose((c) => Math.min(Math.max(c, o + MIN_OPEN_SPAN), Math.min(MAX_CLOSE_HOUR, o + 24)));
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="打烊">
              <select value={close} onChange={(e) => setClose(Number((e.target as HTMLSelectElement).value))}>
                {closeChoices.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h, true)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p class="small dim">粉紅色是營業中的時段。尖峰時段沒開門就等於把客人送給別人；但開得越久，人事與水電也照算。打烊可以選到隔天凌晨（例如 05:00–03:00），深夜 22–05 點的薪資有 25% 加成。</p>
          <Btn kind="primary" disabled={!validHours(open, close) || (open === s.hours.open && close === s.hours.close)}onClick={() => run({ type: "setHours", open, close }, "營業時間已更新")}>
            套用營業時間
          </Btn>
        </div>
      </Card>
    </>
  );
}

/** 清潔、設備維護、稽查與每日固定成本。 */
export function FacilityCards() {
  const s = state.value;
  if (!s) return null;
  let wages = 0;
  for (const sh of s.shops) if (sh.mode === "direct") wages += (CATEGORY_BY_ID[sh.category]?.wage ?? 0) * sh.level;
  const reservedSeats = s.regulars.filter((r) => r.reserved).length * RESERVE_UPKEEP_PER_DAY;
  const fixed = UTILITIES_PER_DAY + (CLEANING_COST_PER_DAY[s.cleaningLevel] + MAINTENANCE_COST_PER_DAY[s.maintenanceLevel]) * facilityScale(s) + wages * laborCostFactor(s.hours.open, s.hours.close) + reservedSeats;
  return (
    <>
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

      <Card title="🧾 稽查與合規" right={<Chip tone={s.inspections.compliance >= 60 ? "green" : s.inspections.compliance >= 40 ? "amber" : "red"}>合規 {Math.round(s.inspections.compliance)}</Chip>}>
        <div class="stack">
          <p class="small dim">
            衛生、消防單位會不定期來稽查，多半會先預告，少數是突擊。分數主要取決於「清潔」與「設備」。合規分數越低，來得越頻繁。
          </p>
          <div class="two-col">
            <Meter label="🧼 若現在來衛生稽查" value={inspectionScore("hygiene", s.cleanliness, s.equipment)} hint={`${inspectionScore("hygiene", s.cleanliness, s.equipment)} 分`} />
            <Meter label="🧯 若現在來消防檢查" value={inspectionScore("fire", s.cleanliness, s.equipment)} hint={`${inspectionScore("fire", s.cleanliness, s.equipment)} 分`} />
          </div>
          {s.inspections.pending.map((n) => (
            <InspectionCard key={n.uid} s={s} n={n} />
          ))}
          {s.inspections.log.length === 0 ? (
            <p class="small dim">還沒有被稽查過。</p>
          ) : (
            <div class="stack">
              {s.inspections.log.slice(0, 5).map((r, i) => {
                const info = OUTCOME_INFO[r.outcome];
                return (
                  <div class="report-row" key={i}>
                    <div class="row between">
                      <span>
                        {INSPECTIONS[r.kind].icon} {INSPECTIONS[r.kind].name}
                        {r.surprise ? "（突擊）" : ""}
                      </span>
                      <Chip tone={info.tone}>
                        {r.score} 分・{info.label}
                      </Chip>
                    </div>
                    {r.fine > 0 && <p class="small neg">罰款 {money(r.fine)}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

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
          {reservedSeats > 0 && (
            <div class="row between">
              <span class="dim">常客專屬座位</span>
              <b>{money(reservedSeats)}</b>
            </div>
          )}
          <div class="row between">
            <span>合計 / 遊戲日（約 6 真實小時）</span>
            <b>{money(fixed)}</b>
          </div>
        </div>
      </Card>
    </>
  );
}

/** 完整的營運頁（舊版整頁，仍供測試與過渡使用）。 */
export function Ops() {
  return (
    <>
      <DeviceCard />
      <TimeSettings />
      <HoursCards />
      <FacilityCards />
    </>
  );
}
