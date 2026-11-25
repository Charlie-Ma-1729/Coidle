import { useState } from "preact/hooks";
import { CATEGORY_BY_ID, PERSONAS, WEEKDAY_NAMES, timeInfo } from "@coidle/shared";
import { Card, Chip, Empty, Meter } from "../components/ui";
import { money, moneyShort, num, signed } from "../format";
import { categoryIcon, PERSONA_ICONS } from "../icons";
import { state } from "../store";
import { WEATHER_EMOJI, reportWeatherText } from "../ui/weatherUi";

export function Reports() {
  const s = state.value;
  const [sel, setSel] = useState<number | null>(null);
  if (!s) return null;
  if (s.reports.length === 0) {
    return (
      <Card title="營運日報">
        <Empty>還沒有日報。每個遊戲日（約 6 真實小時）結束時會出一份。</Empty>
      </Card>
    );
  }

  const list = s.reports.slice(-14);
  const idx = sel !== null && sel < list.length ? sel : list.length - 1;
  const r = list[idx]!;
  const max = Math.max(1, ...list.map((x) => Math.abs(x.profit)));
  const weekday = WEEKDAY_NAMES[timeInfo(r.day * 288).dow];
  const dow = new Date(`${r.date}T00:00:00Z`).getUTCDay();

  return (
    <>
      <Card title="每日利潤" right={<span class="small dim">近 {list.length} 天・點選查看</span>}>
        <div class="bars">
          {list.map((x, i) => (
            <div
              key={x.day}
              class={`bar ${x.profit < 0 ? "neg" : ""} ${i === idx ? "sel" : ""}`}
              style={{ height: `${Math.max(3, (Math.abs(x.profit) / max) * 100)}%`, cursor: "pointer" }}
              title={`${x.date} ${x.weather ? WEATHER_EMOJI[x.weather.kind] + " " : ""}${moneyShort(x.profit)}`}
              onClick={() => setSel(i)}
            />
          ))}
        </div>
      </Card>

      <Card
        title={`${r.date}（${WEEKDAY_NAMES[dow] ?? weekday}）`}
        right={
          <span class="row">
            {r.weather && <Chip tone={r.weather.kind === "storm" ? "red" : r.weather.kind === "rain" ? "cyan" : "amber"}>{reportWeatherText(r.weather)}</Chip>}
            <Chip tone={r.profit >= 0 ? "green" : "red"}>{r.profit >= 0 ? "盈" : "虧"} {moneyShort(r.profit)}</Chip>
          </span>
        }
      >
        <div class="stack">
          <div class="news">
            <h4>{r.headline}</h4>
            <ul>
              {r.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>

          <div class="stat-grid">
            <div class="stat">
              <span>營收</span>
              <b>{moneyShort(r.revenue)}</b>
            </div>
            <div class="stat">
              <span>租金抽成</span>
              <b>{moneyShort(r.rentIncome)}</b>
            </div>
            <div class="stat">
              <span>進貨／變動</span>
              <b>{moneyShort(r.purchases)}</b>
            </div>
            <div class="stat">
              <span>固定成本</span>
              <b>{moneyShort(r.fixed)}</b>
            </div>
            <div class="stat">
              <span>維修</span>
              <b>{moneyShort(r.repairs)}</b>
            </div>
            <div class="stat">
              <span>接待組數</span>
              <b>{num(r.groups)}</b>
            </div>
          </div>

          <div class="row small">
            <span>
              🏮 在地口碑 {r.localRep.end.toFixed(1)}（{signed(r.localRep.end - r.localRep.start)}）
            </span>
            <span>
              🧳 觀光熱度 {r.touristHeat.end.toFixed(1)}（{signed(r.touristHeat.end - r.touristHeat.start)}）
            </span>
            <span class="dim">離開的客人 {num(r.walkouts)} 組</span>
          </div>
        </div>
      </Card>

      <div class="grid two">
        <Card title="各類客人滿意度">
          <div class="stack">
            {PERSONAS.map((p) => {
              const v = r.avgSat[p.id];
              return v === null ? (
                <div class="small dim" key={p.id}>
                  {PERSONA_ICONS[p.id]} {p.name}：今日沒來
                </div>
              ) : (
                <Meter key={p.id} label={`${PERSONA_ICONS[p.id]} ${p.name}`} value={v * 100} hint={`${Math.round(v * 100)}`} />
              );
            })}
          </div>
        </Card>

        <Card title="店鋪排行">
          <div class="stack">
            {r.shops
              .slice()
              .sort((a, b) => b.revenue - a.revenue)
              .map((sh) => (
                <div class="row between small" key={sh.id}>
                  <span>
                    {categoryIcon(sh.category)} {sh.name}
                    <span class="dim"> {CATEGORY_BY_ID[sh.category]?.name}</span>
                  </span>
                  <span>
                    <b>{moneyShort(sh.revenue)}</b>
                    {sh.stockouts > 0 && <span class="neg"> 缺{sh.stockouts}</span>}
                  </span>
                </div>
              ))}
          </div>
        </Card>
      </div>

      {r.events.length > 0 && (
        <Card title="當日事件">
          <div class="row">
            {r.events.map((e, i) => (
              <Chip key={i} tone="amber">
                {e}
              </Chip>
            ))}
          </div>
        </Card>
      )}
      <p class="small dim" style={{ textAlign: "center" }}>
        資金目前 {money(s.funds)}
      </p>
    </>
  );
}
