import { LEVELS, dayLedger, fixedCostBreakdown, mallStars, periodOf, timeInfo } from "@coidle/shared";
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
  const lg = dayLedger(d);
  const fc = fixedCostBreakdown(s);
  const profitSoFar = lg.operating;
  const signedMoney = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
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
          <span class="label">今日營運損益（截至 {clockText(s.tick)}）</span>
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

      <Card title={`今日損益明細（截至 ${clockText(s.tick)}）`}>
        <div class="ledger">
          <div>
            <span>商品營收</span>
            <b>{money(lg.revenue)}</b>
          </div>
          {lg.rentIncome > 0 && (
            <div>
              <span>租金與抽成</span>
              <b>{money(lg.rentIncome)}</b>
            </div>
          )}
          <div>
            <span>− 賣出商品的成本</span>
            <b>{money(lg.stockCost)}</b>
          </div>
          <div>
            <span>− 其他支出（服務耗材、研發、活動、客訴…）</span>
            <b>{money(lg.otherCosts)}</b>
          </div>
          <div>
            <span>− 固定成本（水電、薪資、清潔維護…）</span>
            <b>{money(lg.fixed)}</b>
          </div>
          {lg.fixedClosed > 0 && (
            <div class="sub">
              <span>其中打烊時段花的（下方說明）</span>
              <b>{money(lg.fixedClosed)}</b>
            </div>
          )}
          <div>
            <span>− 維修與罰款</span>
            <b>{money(lg.repairs)}</b>
          </div>
          <div class="total">
            <span>營運損益（顯示在上方的數字）</span>
            <b class={lg.operating >= 0 ? "pos" : "neg"}>{signedMoney(lg.operating)}</b>
          </div>
          <div class="sub">
            <span>今天進貨（付出的現金，變成庫存）</span>
            <b>{money(lg.stockBought)}</b>
          </div>
          <div class="sub">
            <span>庫存變化（進貨 − 賣出成本）</span>
            <b>{signedMoney(lg.stockChange)}</b>
          </div>
          <div class="total">
            <span>現金變化（資金實際增減）</span>
            <b class={lg.cash >= 0 ? "pos" : "neg"}>{signedMoney(lg.cash)}</b>
          </div>
        </div>
        <p class="small dim" style={{ marginTop: "8px" }}>
          進貨買的是之後要賣的貨，不算當天虧損，所以營運損益只扣「已經賣掉」的那部分成本。補了一大批貨時，現金會減少，但倉庫裡多了庫存。賣出成本以標準進價估算，實際進價受供應商與行情影響。
        </p>
      </Card>

      <Card title="固定成本：打烊了也照常算">
        <div class="ledger">
          <div>
            <span>水電</span>
            <b>{money(fc.utilities)}／天</b>
          </div>
          <div>
            <span>清潔與維護團隊</span>
            <b>{money(fc.upkeep)}／天</b>
          </div>
          <div>
            <span>員工薪資</span>
            <b>{money(fc.wages)}／天</b>
          </div>
          {fc.reserved > 0 && (
            <div>
              <span>常客專屬座位維持費</span>
              <b>{money(fc.reserved)}／天</b>
            </div>
          )}
          <div class="total">
            <span>合計（均攤到每個小時，約 {money(fc.perHour)}／小時）</span>
            <b>{money(fc.perDay)}／天</b>
          </div>
          {fc.closedHours > 0 && (
            <div class="sub">
              <span>
                每天打烊 {fc.closedHours} 小時（{String(s.hours.close % 24).padStart(2, "0")}:00–{String(s.hours.open).padStart(2, "0")}:00），這段時間約花
              </span>
              <b>{money(fc.closedPerDay)}</b>
            </div>
          )}
        </div>
        <p class="small dim" style={{ marginTop: "8px" }}>
          為什麼打烊後還在扣錢？水電與冷凍冷藏設備是整天運轉的，清潔與維護團隊在夜間打掃保養，員工領的是月薪，這些都不會因為關門就停。所以成本是整天均攤、不是只在營業時間算。打烊時整潔與設備會慢慢恢復，隔天開門才不會一開始就髒。
          想少花，可以調整營業時間（深夜與超過 14 小時的班有薪資加成）、調降清潔與維護等級、研發節能與自動化科技，或把店面改成出租。
        </p>
      </Card>

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
