import { CATEGORY_BY_ID, EVENT_BY_ID, LEVELS, ticksToRealMinutes, timeInfo, periodOf, type PublicMallState } from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { clockText, money, moneyShort, num, pct } from "../format";
import { run, state } from "../store";

function PendingEvents({ s }: { s: PublicMallState }) {
  if (s.pending.length === 0) return null;
  return (
    <>
      {s.pending.map((p) => {
        const def = EVENT_BY_ID[p.defId];
        if (!def?.choice) return null;
        const mins = Math.max(0, Math.round(ticksToRealMinutes(p.deadlineTick - s.tick)));
        const defaultLabel = def.choice.options.find((o) => o.id === def.choice!.defaultOption)?.label;
        return (
          <div class="alert" key={p.uid}>
            <h4>
              ⚡ {def.title} <span class="dim small">（{mins >= 60 ? `${Math.round(mins / 6) / 10} 小時` : `${mins} 分鐘`}內回覆）</span>
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
      })}
    </>
  );
}

function Warnings({ s }: { s: PublicMallState }) {
  const warns: { tone: "red" | "amber"; text: string }[] = [];
  if (s.protection) warns.push({ tone: "amber", text: "好一陣子沒人照顧，商場進入保全模式（半營運，人氣不再下滑）。任何人操作一下就會恢復。" });
  if (s.funds < 0) warns.push({ tone: "red", text: "帳上資金為負，自動補貨已暫停！" });
  const out = s.shops.filter((x) => x.mode === "direct" && CATEGORY_BY_ID[x.category] && ["food", "retail"].includes(CATEGORY_BY_ID[x.category]!.group) && x.stock < 1);
  for (const sh of out) warns.push({ tone: "red", text: `「${sh.name}」缺貨中` });
  const closed = s.shops.filter((x) => x.closedUntilTick > s.tick);
  for (const sh of closed) warns.push({ tone: "red", text: `「${sh.name}」暫停營業中` });
  if (s.cleanliness < 40) warns.push({ tone: "amber", text: "館內太髒了，提高清潔等級吧" });
  if (s.equipment < 40) warns.push({ tone: "amber", text: "設備老舊，小心故障，提高維護等級" });
  const stale = s.shops.filter((x) => x.mode === "direct" && x.freshness < 40);
  if (stale.length > 0) warns.push({ tone: "amber", text: `${stale.map((x) => `「${x.name}」`).join("")}菜單太老氣，客人覺得沒新鮮感` });
  if (warns.length === 0) return null;
  return (
    <>
      {warns.slice(0, 6).map((w, i) => (
        <div class={`alert ${w.tone === "red" ? "red" : ""}`} key={i}>
          <span class="small">{w.tone === "red" ? "🚨" : "⚠️"} {w.text}</span>
        </div>
      ))}
    </>
  );
}

export function Overview() {
  const s = state.value;
  if (!s) return null;
  const t = timeInfo(s.tick);
  const open = t.hour >= s.hours.open && t.hour < s.hours.close;
  const period = periodOf(t.hour, t.weekend);
  const next = LEVELS.find((l) => l.level === s.level + 1);
  const lvlProgress = next ? Math.min(100, (s.totalRevenue / next.minRevenue) * 100) : 100;
  const d = s.today;
  const profitSoFar = d.revenue + d.rentIncome - d.purchases - d.fixed - d.repairs;
  const last = s.reports[s.reports.length - 1];

  return (
    <>
      <div class="row">
        <Chip tone={t.weekend ? "pink" : "cyan"}>{t.weekend ? "假日" : "平日"}</Chip>
        <Chip tone={period === "peak" ? "amber" : period === "quiet" ? "dim" : "green"}>{period === "peak" ? "🔥 尖峰時段" : period === "quiet" ? "離峰時段" : "一般時段"}</Chip>
        <Chip tone={open ? "green" : "red"}>{open ? `營業中（至 ${s.hours.close}:00）` : `打烊中（${s.hours.open}:00 開）`}</Chip>
        <Chip tone="amber">Lv.{s.level}</Chip>
      </div>

      <PendingEvents s={s} />
      <Warnings s={s} />

      <div class="kpis">
        <div class="kpi">
          <span class="label">資金</span>
          <span class={`big ${s.funds < 0 ? "neg" : ""}`}>{moneyShort(s.funds)}</span>
          <span class="small dim">{money(s.funds)}</span>
        </div>
        <div class="kpi">
          <span class="label">今日（截至 {clockText(s.tick)}）</span>
          <span class={`big ${profitSoFar >= 0 ? "pos" : "neg"}`}>{moneyShort(profitSoFar)}</span>
          <span class="small dim">
            營收 {moneyShort(d.revenue + d.rentIncome)}・{num(d.groups)} 組客人
          </span>
        </div>
        <div class="kpi">
          <span class="label">累計營收</span>
          <span class="big">{moneyShort(s.totalRevenue)}</span>
          <span class="small dim">{next ? `下一級 ${moneyShort(next.minRevenue)}` : "已達最高等級"}</span>
        </div>
      </div>

      <div class="grid two">
        <Card title="口碑與狀態">
          <div class="stack">
            <Meter label="🏮 在地口碑" value={s.localRep} hint={s.localRep.toFixed(1)} tone="pink" />
            <Meter label="🧳 觀光熱度" value={s.touristHeat} hint={s.touristHeat.toFixed(1)} tone="cyan" />
            <Meter label="🧹 清潔" value={s.cleanliness} hint={pct(s.cleanliness)} />
            <Meter label="🔧 設備" value={s.equipment} hint={pct(s.equipment)} />
            {next && <Meter label={`⬆ 升級到 Lv.${next.level}（需口碑平均 ≥ ${next.minIndexAvg}）`} value={lvlProgress} hint={pct(lvlProgress)} tone="amber" />}
          </div>
        </Card>

        <Card title={last ? `📰 商場快訊（${last.date}）` : "📰 商場快訊"}>
          {last ? (
            <div class="news">
              <h4>{last.headline}</h4>
              <ul>
                {last.notes.slice(0, 5).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty>第一份日報會在明天凌晨出爐。</Empty>
          )}
        </Card>
      </div>

      <Card title="最近發生的事">
        {s.log.length === 0 ? (
          <Empty>還很平靜。</Empty>
        ) : (
          <div class="log">
            <ul>
              {s.log
                .slice(-8)
                .reverse()
                .map((l, i) => (
                  <li key={i}>
                    <time>{clockText(l.tick)}</time>
                    <span>{l.text}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}
