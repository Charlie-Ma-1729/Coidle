import { useState } from "preact/hooks";
import {
  MAX_ACTIVE_PROMOS,
  PROMOS,
  PROMO_BY_ID,
  promoEffectFactor,
  ticksToRealMinutes,
  type PersonaId,
  type PromoDef,
  type PublicMallState,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { dateText, clockText, money, nextTickAt, realDuration } from "../format";
import { PERSONA_ICONS } from "../icons";
import { run, state } from "../store";

const PERSONA_NAME: Record<string, string> = { tourist: "觀光客", local: "在地客", commuter: "上班族", family: "家庭", student: "學生", couple: "情侶", all: "全客群" };

function effects(def: PromoDef, factor: number) {
  const chips: { text: string; tone: "cyan" | "amber" | "green" | "pink" }[] = [];
  if (def.discount > 0) chips.push({ text: `客人少付 ${Math.round(def.discount * 100)}%`, tone: "amber" });
  for (const [p, m] of Object.entries(def.traffic) as [PersonaId | "all", number][]) {
    if (m === 1) continue;
    const eff = 1 + (m - 1) * factor;
    chips.push({ text: `${p === "all" ? "全客群" : `${PERSONA_ICONS[p]} ${PERSONA_NAME[p]}`} 客流 ×${eff.toFixed(2)}`, tone: "cyan" });
  }
  if (def.satBonus > 0) chips.push({ text: "客人更滿意", tone: "green" });
  if (def.regularGain) chips.push({ text: "常客關係升溫更快", tone: "pink" });
  if (def.idx) chips.push({ text: def.idx.which === "touristHeat" ? "觀光熱度＋" : "在地口碑＋", tone: "pink" });
  if (def.freshness) chips.push({ text: "店家更有新意", tone: "green" });
  return chips;
}

function PromoCard({ s, def }: { s: PublicMallState; def: PromoDef }) {
  const [when, setWhen] = useState("now");
  const factor = promoEffectFactor(s.promos.fatigue);
  const busyNow = s.promos.active.some((a) => a.defId === def.id) || s.promos.scheduled.some((x) => x.defId === def.id);
  const cooldownLeft = (s.promos.lastEnd[def.id] ?? -Infinity) + def.cooldownTicks - s.tick;
  const startOptions: { id: string; label: string; tick: number }[] = [
    { id: "now", label: "現在", tick: s.tick },
    { id: "eve", label: "今晚 18:00", tick: nextTickAt(s.tick, 18) },
    { id: "tmr", label: "明天 11:00", tick: nextTickAt(nextTickAt(s.tick, 0), 11) },
    { id: "wkd", label: "下個假日 11:00", tick: nextTickAt(s.tick, 11, true) },
  ];
  const start = startOptions.find((o) => o.id === when) ?? startOptions[0]!;
  const tooMany = when === "now" && s.promos.active.length >= MAX_ACTIVE_PROMOS;
  const blocked = busyNow || cooldownLeft > 0 || s.funds < def.cost || tooMany;
  const reason = busyNow
    ? "進行中或已排程"
    : cooldownLeft > 0
      ? `冷卻中（${realDuration(cooldownLeft, s.clock.speed).replace("約 ", "約")}）`
      : s.funds < def.cost
        ? "資金不足"
        : tooMany
          ? `同時最多 ${MAX_ACTIVE_PROMOS} 個`
          : "";

  return (
    <div class="promo">
      <div class="row between">
        <b>
          {def.icon} {def.name}
        </b>
        <span class="small dim">
          預算 {money(def.cost)}・{realDuration(def.durationTicks, s.clock.speed)}
        </span>
      </div>
      <p class="small dim">{def.desc}</p>
      <div class="row" style={{ gap: "4px" }}>
        {effects(def, factor).map((c) => (
          <Chip key={c.text} tone={c.tone}>
            {c.text}
          </Chip>
        ))}
      </div>
      <div class="row">
        <select style={{ width: "auto" }} value={when} onChange={(e) => setWhen((e.target as HTMLSelectElement).value)}>
          {startOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <Btn small kind="primary" disabled={blocked} onClick={() => run({ type: "schedulePromo", defId: def.id, startTick: when === "now" ? undefined : start.tick }, when === "now" ? `「${def.name}」開跑！` : `「${def.name}」已排程`)}>
          {when === "now" ? "立刻開辦" : "排程"}
        </Btn>
        {reason && <span class="small dim">{reason}</span>}
      </div>
    </div>
  );
}

export function Marketing() {
  const s = state.value;
  if (!s) return null;
  const fatigue = s.promos.fatigue;
  return (
    <>
      <Card title="😮‍💨 促銷疲勞" right={<span class="small dim">辦太勤，客人會看膩</span>}>
        <Meter label={fatigue < 0.15 ? "客人還很期待" : fatigue < 0.5 ? "有點熟悉了" : "客人看膩了"} value={fatigue * 100} hint={`新活動效果約 ${Math.round(promoEffectFactor(fatigue) * 100)}%`} tone={fatigue < 0.3 ? "green" : fatigue < 0.6 ? "amber" : "red"} />
        <p class="small dim" style={{ marginTop: "6px" }}>
          每個遊戲日自然消退一點。活動可以預先排程：先排好、放心離線，時間到了自己開跑。
        </p>
      </Card>

      <Card title="🎪 進行中與排程">
        {s.promos.active.length === 0 && s.promos.scheduled.length === 0 ? (
          <Empty>目前沒有活動。從下面挑一個，或預先排程到忙碌的時段。</Empty>
        ) : (
          <div class="stack">
            {s.promos.active.map((a) => {
              const def = PROMO_BY_ID[a.defId];
              const total = a.endTick - a.startTick;
              const done = Math.min(100, ((s.tick - a.startTick) / total) * 100);
              const left = Math.round(ticksToRealMinutes(a.endTick - s.tick, s.clock.speed));
              return (
                <div class="promo" key={a.uid}>
                  <div class="row between">
                    <b>
                      {def?.icon} {def?.name}
                    </b>
                    <Chip tone="green">進行中・還有約 {left >= 60 ? `${Math.round(left / 6) / 10} 小時` : `${left} 分鐘`}</Chip>
                  </div>
                  <Meter label="進度" value={done} hint={`${Math.round(done)}%`} tone="cyan" />
                  <p class="small dim">
                    至今接待 {a.groups} 組客人、營收 {money(a.revenue)}（預算 {money(def?.cost ?? 0)}）
                  </p>
                </div>
              );
            })}
            {s.promos.scheduled.map((x) => {
              const def = PROMO_BY_ID[x.defId];
              return (
                <div class="promo" key={x.uid}>
                  <div class="row between">
                    <b>
                      {def?.icon} {def?.name}
                    </b>
                    <Chip tone="amber">排程中</Chip>
                  </div>
                  <div class="row between small">
                    <span class="dim">
                      預定 {dateText(x.startTick)} {clockText(x.startTick)} 開始
                    </span>
                    <Btn small kind="danger" onClick={() => run({ type: "cancelPromo", uid: x.uid }, "已取消，預算退回")}>
                      取消（退回 {money(x.cost)}）
                    </Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="🗂 活動目錄">
        <div class="stack">
          {PROMOS.map((def) => (
            <PromoCard key={def.id} s={s} def={def} />
          ))}
        </div>
      </Card>

      <Card title="📈 歷史成效">
        {s.promos.history.length === 0 ? (
          <Empty>還沒有結束的活動。</Empty>
        ) : (
          <div class="stack">
            {s.promos.history.map((h, i) => {
              const def = PROMO_BY_ID[h.defId];
              const roi = h.cost > 0 ? h.revenue / h.cost : 0;
              return (
                <div class="report-row" key={i}>
                  <div class="row between">
                    <b>
                      {def?.icon} {def?.name}
                    </b>
                    <span class="small dim">{dateText(h.endTick)}</span>
                  </div>
                  <p class="small dim">
                    {h.groups} 組客人・營收 {money(h.revenue)}・預算 {money(h.cost)}（期間營收是預算的 {roi.toFixed(1)} 倍）
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
