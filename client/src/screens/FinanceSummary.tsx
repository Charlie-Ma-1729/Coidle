import { LEVELS, mallStars, periodOf, timeInfo } from "@coidle/shared";
import { Card, Chip, Empty } from "../components/ui";
import { clockText, money, moneyShort, num } from "../format";
import { StatusMeters } from "../ui/StatusPanel";
import { state } from "../store";
import { Stars } from "./Achievements";

/**
 * 財務 → 資金與損益。取代舊總覽頁：數字與狀態都在這裡，
 * 提醒與警告已集中到待辦中心，不在這裡重複。
 */
export function FinanceSummary() {
  const s = state.value;
  if (!s) return null;
  const t = timeInfo(s.tick);
  const open = t.hour >= s.hours.open && t.hour < s.hours.close;
  const period = periodOf(t.hour, t.offDay);
  const d = s.today;
  const profitSoFar = d.revenue + d.rentIncome - d.purchases - d.fixed - d.repairs;
  const next = LEVELS.find((l) => l.level === s.level + 1);

  return (
    <>
      <div class="row">
        <Chip tone={t.offDay ? "pink" : "cyan"}>{t.holiday ?? (t.offDay ? "假日" : "平日")}</Chip>
        <Chip tone={period === "peak" ? "amber" : period === "quiet" ? "dim" : "green"}>{period === "peak" ? "尖峰時段" : period === "quiet" ? "離峰時段" : "一般時段"}</Chip>
        <Chip tone={open ? "green" : "red"}>{open ? `營業中（至 ${s.hours.close}:00）` : `打烊中（${s.hours.open}:00 開）`}</Chip>
        <Chip tone="amber">Lv.{s.level}</Chip>
        <Chip tone="pink">
          <Stars n={mallStars(s as never)} />
        </Chip>
      </div>

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

      <Card title="口碑與狀態">
        <StatusMeters />
      </Card>

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
