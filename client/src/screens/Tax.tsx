import {
  CATEGORY_BY_ID,
  EMPLOYER_SOCIAL_RATE,
  FAMILY_ORDER,
  LOSS_CARRY_LIMIT,
  OBLIGATION_NAMES,
  SUPPLY_FAMILIES,
  billOutstanding,
  billsDueWithin,
  chosenSupplier,
  consumptionRate,
  corporateTax,
  invoiceCreditRate,
  laborCostFactor,
  licenseOf,
  timeInfo,
  type PublicMallState,
} from "@coidle/shared";
import { Card, Chip, Empty } from "../components/ui";
import { dateText, money, moneyShort, pct, realDuration } from "../format";
import { categoryIcon } from "../icons";
import { state } from "../store";

const DAY30 = 30 * 288;

function Summary({ s }: { s: PublicMallState }) {
  const due30 = billsDueWithin(s, DAY30);
  const short = s.funds < due30;
  const income = Math.max(0, s.tax.fy.profit - s.tax.lossCarry * LOSS_CARRY_LIMIT);
  const ct = corporateTax(income);
  const q = s.tax.quarter.outputTax - s.tax.quarter.inputTax;
  return (
    <div class="kpis">
      <div class="kpi">
        <span class="label">30 天內要繳</span>
        <span class={`big ${short ? "neg" : ""}`}>{moneyShort(due30)}</span>
        <span class="small dim">{short ? `帳上只有 ${moneyShort(s.funds)}，不夠！` : "自動從資金扣款"}</span>
      </div>
      <div class="kpi">
        <span class="label">本會計年度所得（4–3 月）</span>
        <span class={`big ${s.tax.fy.profit >= 0 ? "pos" : "neg"}`}>{moneyShort(s.tax.fy.profit)}</span>
        <span class="small dim">預估法人稅等 {moneyShort(ct.total)}（實質 {pct(ct.effective * 100)}）</span>
      </div>
      <div class="kpi">
        <span class="label">本季消費稅累積</span>
        <span class="big">{moneyShort(Math.max(0, q))}</span>
        <span class="small dim">銷項 {moneyShort(s.tax.quarter.outputTax)} − 進項 {moneyShort(s.tax.quarter.inputTax)}</span>
      </div>
    </div>
  );
}

function Bills({ s }: { s: PublicMallState }) {
  const bills = s.tax.bills.slice().sort((a, b) => a.dueTick - b.dueTick);
  return (
    <Card title="🧾 待繳帳單" right={<span class="small dim">到期自動扣款，不用手動處理</span>}>
      {bills.length === 0 ? (
        <Empty>目前沒有待繳的帳單。稅金與保險會在每月 1 日、每季與決算時開立。</Empty>
      ) : (
        <div class="log">
          <ul>
            {bills.map((b) => {
              const late = b.dueTick < s.tick;
              return (
                <li key={b.uid}>
                  <time>
                    {late ? <Chip tone="red">逾期</Chip> : `約 ${realDuration(b.dueTick - s.tick, s.clock.speed, s.clock.lag)}後`}
                  </time>
                  <span>
                    {OBLIGATION_NAMES[b.kind].icon} {b.label}：<b>{money(billOutstanding(b))}</b>
                    <span class="small dim">（{dateText(b.dueTick)}到期{b.lateFee > 0 ? `，含延滯稅 ${money(b.lateFee)}` : ""}）</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function History({ s }: { s: PublicMallState }) {
  return (
    <Card title="📒 繳納紀錄" right={<span class="small dim">累計 {moneyShort(Object.values(s.tax.totalPaid).reduce((a, b) => a + b, 0))}</span>}>
      {s.tax.history.length === 0 ? (
        <Empty>還沒有繳納紀錄。</Empty>
      ) : (
        <div class="log">
          <ul>
            {s.tax.history.slice(0, 12).map((h, i) => (
              <li key={i}>
                <time>{dateText(h.tick)}</time>
                <span>
                  {OBLIGATION_NAMES[h.kind].icon} {h.label}：{h.amount < 0 ? `退稅 ${money(-h.amount)}` : money(h.amount)}
                  {h.late ? "（逾期）" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Rules({ s }: { s: PublicMallState }) {
  const date = timeInfo(s.tick).date;
  const credit = invoiceCreditRate(date);
  const f = laborCostFactor(s.hours.open, s.hours.close);
  const direct = s.shops.filter((x) => x.mode === "direct");
  const licensed = direct.filter((x) => licenseOf(x.category));
  const nonInvoice = FAMILY_ORDER.map((fam) => ({ fam, c: chosenSupplier(s, fam) })).filter((x) => x.c && x.c.def.invoice === false);
  const lossCarry = s.tax.lossCarry;
  return (
    <>
      <Card title="⚖️ 你要遵守的規定">
        <div class="stack">
          <div>
            <b class="small">🧾 消費稅（價格都是含稅價）</b>
            <p class="small dim">
              店內用餐、服飾、娛樂、服務 10%；外帶的食品與飲料（超市、手搖飲、和菓子）8%；診所與認可托育不課稅。每季結算「賣出的稅 − 進貨付出的稅」。
            </p>
            <div class="row">
              {direct.slice(0, 12).map((x) => (
                <Chip key={x.id} tone={consumptionRate(x.category) < 0.1 ? "green" : "dim"}>
                  {categoryIcon(x.category)} {x.name} {Math.round(consumptionRate(x.category) * 100)}%
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <b class="small">🧾 發票制度（インボイス）</b>
            <p class="small dim">
              跟沒有登錄的小型供應商進貨，付出的稅只能扣抵一部分。目前（{date.slice(0, 7)}）過渡期可扣 {Math.round(credit * 100)}%，之後逐步降到 0。價格便宜的小供應商，實際成本可能沒那麼便宜。
            </p>
            {nonInvoice.length === 0 ? (
              <p class="small">你目前的主力供應商都已登錄，進項稅額可以全額扣抵。</p>
            ) : (
              nonInvoice.map((x) => (
                <p class="small" key={x.fam}>
                  {SUPPLY_FAMILIES[x.fam].icon} {x.c!.def.name}：未登錄，進項稅額只能扣 {Math.round(credit * 100)}%
                </p>
              ))
            )}
          </div>
          <div>
            <b class="small">🏛 法人稅等</b>
            <p class="small dim">
              會計年度 4 月到隔年 3 月，決算後 5 月底前繳；10 月先預繳一半。稅率：所得 800 萬圓以下 15%、超過 23.2%，再加地方法人稅、住民稅、事業稅與防衛特別法人稅，實質約 33–36%。虧損可全額結轉，抵之後的所得
              {lossCarry > 0 ? `（目前可抵 ${money(lossCarry)}）` : ""}。
            </p>
          </div>
          <div>
            <b class="small">🧑‍💼 勞動與社會保險</b>
            <p class="small dim">
              雇主負擔約 {pct(EMPLOYER_SOCIAL_RATE * 100)} 的社會保險（健保、厚生年金、雇用保險、勞災），每月繳；6、12 月發獎金（約 0.4 個月薪資）。深夜（22 點後）與每天超過 14 小時的班次，薪資加成 25%。
              目前營業 {s.hours.open}:00–{s.hours.close}:00，人事成本係數 ×{f.toFixed(2)}。
            </p>
          </div>
          <div>
            <b class="small">🏢 固定資產稅・都市計畫稅</b>
            <p class="small dim">依大樓與店面投資額課稅（約 1.7%/年），6、9、12、2 月各繳四分之一。</p>
          </div>
        </div>
      </Card>
      <Card title="📜 許認可（開店前要辦的手續）">
        {licensed.length === 0 ? (
          <Empty>目前的店都不需要特別的許可。</Empty>
        ) : (
          <div class="stack">
            {licensed.map((x) => {
              const l = licenseOf(x.category)!;
              return (
                <p class="small" key={x.id}>
                  {categoryIcon(x.category)} <b>{x.name}</b>（{CATEGORY_BY_ID[x.category]?.name}）：{l.name}
                  <span class="dim">　{l.law}</span>
                </p>
              );
            })}
          </div>
        )}
        <p class="small dim">衛生與消防的定期稽查在「營運 → 設備與稽查」處理。</p>
      </Card>
    </>
  );
}

export function Tax() {
  const s = state.value;
  if (!s) return null;
  const overdue = s.tax.bills.some((b) => b.dueTick < s.tick);
  return (
    <>
      {overdue && (
        <div class="alert red">
          <h4>⚠️ 有逾期未繳的稅金</h4>
          <p class="small">資金不足，沒能全額繳納。逾期每天加收延滯稅，也會讓稽查變頻繁。賺到錢會自動補繳。</p>
        </div>
      )}
      <Summary s={s} />
      <Bills s={s} />
      <History s={s} />
      <Rules s={s} />
      <p class="small dim" style={{ padding: "0 4px 12px" }}>
        依日本制度設計，稅率與規定以 2026 年度為基準，僅供遊戲使用，不是稅務建議。所有帳單都自動處理——你只需要保持帳上有現金。
      </p>
    </>
  );
}
