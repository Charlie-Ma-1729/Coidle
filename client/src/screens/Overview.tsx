import {
  CATEGORY_BY_ID,
  EVENT_BY_ID,
  FAMILY_ORDER,
  LEVELS,
  SUPPLY_FAMILIES,
  billsDueWithin,
  chosenSupplier,
  familyShopCount,
  TEAM_EVENT_BY_ID,
  guestTodoCount,
  leaseEnabled,
  mallStars,
  timeInfo,
  periodOf,
  type PublicMallState,
} from "@coidle/shared";
import { EventChoiceCard } from "../components/EventCards";
import { InspectionCard } from "../components/InspectionCard";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { clockText, money, moneyShort, num, pct } from "../format";
import { goTo } from "../nav";
import { state, user } from "../store";
import { Stars } from "./Achievements";

function PendingEvents({ s }: { s: PublicMallState }) {
  // 面對客人的事件放在「客人」分頁；總覽只顯示其餘事件，另加一個提醒
  const others = s.pending.filter((p) => EVENT_BY_ID[p.defId]?.category !== "guest");
  const guestTodo = guestTodoCount(s);
  return (
    <>
      {/* 因為這個而暫停的稽查預告，已經顯示在頂部的暫停橫幅裡，不重複 */}
      {s.inspections.pending
        .filter((n) => !s.clock.holds.events.includes(n.uid))
        .map((n) => (
          <InspectionCard key={n.uid} s={s} n={n} />
        ))}
      {others.map((p) => (
        <EventChoiceCard key={p.uid} s={s} p={p} />
      ))}
      {s.meta.team.event && !s.meta.team.event.contributions.some((c) => c.actorId === String(user.value?.id ?? "")) && (
        <div class="alert cyan">
          <h4>🧑‍🤝‍🧑 團隊事件：{TEAM_EVENT_BY_ID[s.meta.team.event.defId]?.title}</h4>
          <p class="small dim">需要 {s.meta.team.event.needed} 位隊員各認領一項任務（目前 {s.meta.team.event.contributions.length} 位）。</p>
          <div class="row">
            <Btn small kind="primary" onClick={() => goTo("more", "goals")}>
              去認領
            </Btn>
          </div>
        </div>
      )}
      {s.leasing.renewals.length > 0 && (
        <div class="alert cyan">
          <h4>📄 有 {s.leasing.renewals.length} 份租約到期等你決定</h4>
          <p class="small dim">沒處理的話，滿意度夠高的租戶會自動續約，不夠的就讓他走。</p>
          <div class="row">
            <Btn small kind="primary" onClick={() => goTo("more", "leasing")}>
              去看看
            </Btn>
          </div>
        </div>
      )}
      {leaseEnabled(s) && s.leasing.candidates.length > 0 && (
        <div class="alert">
          <span class="small">
            🏪 有 {s.leasing.candidates.length} 個品牌想進駐洽談：{s.leasing.candidates.slice(0, 3).map((c) => c.brand).join("、")}
          </span>{" "}
          <Btn small onClick={() => goTo("more", "leasing")}>
            看看
          </Btn>
        </div>
      )}
      {guestTodo > 0 && (
        <div class="alert cyan">
          <h4>👥 客人那邊有 {guestTodo} 件事等你</h4>
          <p class="small dim">客訴、評價、突發狀況。放著不管會依你的處理偏好自動處理，但親自處理通常更划算。</p>
          <div class="row">
            <Btn small kind="primary" onClick={() => goTo("guests")}>
              去看看
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}

function Warnings({ s }: { s: PublicMallState }) {
  const warns: { tone: "red" | "amber"; text: string }[] = [];
  if (s.funds < 0) warns.push({ tone: "red", text: "帳上資金為負，自動補貨已暫停！" });
  const due30 = billsDueWithin(s, 30 * 288);
  if (s.tax.bills.some((b) => b.dueTick < s.tick)) warns.push({ tone: "red", text: "有逾期未繳的稅金或保險費，每天加收延滯稅（到「更多 → 稅務」看明細）" });
  else if (due30 > 0 && s.funds < due30) warns.push({ tone: "amber", text: `30 天內要繳 ${money(due30)}，但帳上只有 ${money(s.funds)}` });
  const out = s.shops.filter((x) => x.mode === "direct" && CATEGORY_BY_ID[x.category] && ["food", "retail"].includes(CATEGORY_BY_ID[x.category]!.group) && x.stock < 1);
  if (out.length > 0) warns.push({ tone: "red", text: `${out.map((x) => `「${x.name}」`).join("")}缺貨中` });
  const closed = s.shops.filter((x) => x.closedUntilTick > s.tick);
  if (closed.length > 0) warns.push({ tone: "red", text: `${closed.map((x) => `「${x.name}」`).join("")}暫停營業中` });
  for (const fam of FAMILY_ORDER) {
    if (familyShopCount(s, fam) === 0) continue;
    const c = chosenSupplier(s, fam);
    if (c && c.st.status !== "ok" && c.st.statusUntil > s.tick) {
      const label = { shortage: "出貨吃緊", strike: "罷工中", closed: "已倒閉", cold: "和你鬧翻了" }[c.st.status];
      warns.push({ tone: c.st.status === "shortage" ? "amber" : "red", text: `${SUPPLY_FAMILIES[fam].icon}「${c.def.name}」${label}（${SUPPLY_FAMILIES[fam].name}的主力供應商）` });
    }
  }
  if (s.cleanliness < 40) warns.push({ tone: "amber", text: "館內太髒了，提高清潔等級吧" });
  if (s.equipment < 40) warns.push({ tone: "amber", text: "設備老舊，小心故障，提高維護等級" });
  const stale = s.shops.filter((x) => x.mode === "direct" && x.freshness < 40);
  if (stale.length > 0) warns.push({ tone: "amber", text: `${stale.map((x) => `「${x.name}」`).join("")}菜單太老氣，客人覺得沒新鮮感（到「工坊」研發新作品）` });
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
        <Chip tone="pink">
          <Stars n={mallStars(s as never)} />
        </Chip>
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
