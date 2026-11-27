import { useEffect, useState } from "preact/hooks";
import {
  BIZ_INSURANCE,
  LENDERS,
  LENDER_ORDER,
  LOAN_MIN,
  PRODUCTS,
  RESTRUCTURE_MISSED_DAYS,
  loanDue,
  type FinanceView,
  type Loan,
  type LoanProduct,
  type PublicMallState,
  type Quote,
} from "@coidle/shared";
import { api } from "../api";
import { confirmThen } from "../components/ConfirmHost";
import { Btn, Card, Chip, Empty, Field } from "../components/ui";
import { gameDeadline, money, num } from "../format";
import { mallId, run, state } from "../store";

const GRADE_TONE = { A: "green", B: "green", C: "cyan", D: "amber", E: "red" } as const;
const CLIMATE_TONE = { loose: "green", normal: "dim", tight: "amber" } as const;
const DECISION: Record<Quote["decision"], { label: string; tone: "green" | "amber" | "red" }> = {
  approve: { label: "可核准", tone: "green" },
  reduced: { label: "降額核准", tone: "amber" },
  decline: { label: "會被婉拒", tone: "red" },
};
const pct = (r: number) => `${(r * 100).toFixed(2)}%`;

/** 融資與保險視圖：每次商場狀態有變（借還款、跨日）就重新預審 */
function useFinanceView(): FinanceView | null {
  const id = mallId.value;
  const s = state.value;
  const [view, setView] = useState<FinanceView | null>(null);
  const key = `${Math.floor((s?.tick ?? 0) / 72)}|${s?.finance?.loans.length ?? 0}|${Math.round((s?.funds ?? 0) / 1000)}|${s?.finance?.insurance ?? 0}|${s?.finance?.restructure ? 1 : 0}`;
  useEffect(() => {
    if (id === null) return;
    let alive = true;
    api
      .finance(id)
      .then((v) => alive && setView(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, key]);
  return view;
}

function LoanRow({ s, loan }: { s: PublicMallState; loan: Loan }) {
  const due = loanDue(loan, s.tick);
  const def = PRODUCTS[loan.product];
  const lender = LENDERS[loan.lender];
  return (
    <div class="stack" style={{ borderTop: "1px solid var(--line, #3333)", paddingTop: "8px" }}>
      <div class="row between">
        <b>
          {lender.name}・{def.name}
        </b>
        <span class="row" style={{ gap: "6px" }}>
          {loan.emergency && <Chip tone="red">緊急授信</Chip>}
          {loan.missedDays > 0 && <Chip tone="red">逾期 {loan.missedDays} 期</Chip>}
        </span>
      </div>
      <div class="small dim">
        未還 {money(loan.outstanding)}（借 {money(loan.principal)}）・日利 {pct(loan.dailyRate)}・{gameDeadline(loan.dueTick, s.tick)}到期
      </div>
      <div class="small dim">下一期應繳約 {money(due.total)}（本金 {money(due.principal)}＋利息 {money(due.interest)}），每個遊戲日自動從帳上扣。</div>
      <div class="row">
        <Btn small disabled={s.funds < 1} onClick={() => run({ type: "repayLoan", loanId: loan.id, amount: Math.max(1, Math.min(Math.floor(s.funds), Math.ceil(loan.outstanding / 4))) }, "已還一部分")}>
          還 1/4
        </Btn>
        <Btn small kind="primary" disabled={s.funds < loan.outstanding} onClick={() => run({ type: "repayLoan", loanId: loan.id }, "已還清")}>
          全部還清（{money(loan.outstanding)}）
        </Btn>
      </div>
    </div>
  );
}

function ProductCard({ s, q, view }: { s: PublicMallState; q: Quote; view: FinanceView }) {
  const def = PRODUCTS[q.product];
  const lender = LENDERS[q.lender];
  const [amount, setAmount] = useState(Math.max(LOAN_MIN, Math.min(q.limit || LOAN_MIN, 2_000_000)));
  useEffect(() => {
    if (q.limit > 0) setAmount((a) => Math.max(LOAN_MIN, Math.min(a, q.limit)));
  }, [q.limit]);
  const d = DECISION[q.decision];
  const can = view.canTake && view.isAuthority && q.decision !== "decline" && amount >= LOAN_MIN && amount <= q.limit;
  const submit = () =>
    confirmThen(
      `向${lender.name}借「${def.name}」${money(amount)}？\n日利 ${pct(q.rate)}、${def.termDays} 個遊戲日、每天自動還本金與利息。${q.product === "emergency" ? "\n⚠ 緊急授信的條件：借了就進入重整（凍結擴建與大額支出，並把營收最低的店轉成出租）。" : ""}`,
      () => run({ type: "takeLoan", product: q.product as LoanProduct, amount }, "貸款已撥款"),
    );
  return (
    <div class="stack" style={{ borderTop: "1px solid var(--line, #3333)", paddingTop: "8px" }}>
      <div class="row between">
        <b>{def.name}</b>
        <span class="row" style={{ gap: "6px" }}>
          <Chip tone={GRADE_TONE[q.grade]}>評等 {q.grade}</Chip>
          <Chip tone={d.tone}>{d.label}</Chip>
        </span>
      </div>
      <p class="small dim">{def.blurb}</p>
      <div class="small">
        {q.decision === "decline" ? (
          <span class="dim">目前借不到</span>
        ) : (
          <>
            最多可借 <b>{money(q.limit)}</b>・日利 <b>{pct(q.rate)}</b>・{q.termDays} 個遊戲日
          </>
        )}
      </div>
      <ul class="small dim" style={{ margin: 0, paddingLeft: "18px" }}>
        {q.reasons.slice(0, 5).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {q.decision !== "decline" && (
        <div class="stack">
          <Field label="借款金額" hint={`${money(LOAN_MIN)} ～ ${money(q.limit)}`}>
            <input type="number" inputMode="numeric" step={10_000} min={LOAN_MIN} max={q.limit} value={amount} onInput={(e) => setAmount(Number((e.target as HTMLInputElement).value))} />
          </Field>
          <Btn kind="primary" disabled={!can} onClick={submit}>
            申請貸款
          </Btn>
          {!view.isAuthority && <span class="small dim">只有管事的人可以借款。</span>}
          {view.blocked && <span class="small neg">{view.blocked}</span>}
        </div>
      )}
    </div>
  );
}

export function Finance() {
  const s = state.value;
  const view = useFinanceView();
  if (!s) return null;
  const f = s.finance;
  const loans = f?.loans ?? [];
  const debt = loans.reduce((a, l) => a + l.outstanding, 0);
  const directShops = s.shops.filter((x) => x.mode === "direct").length;
  const level = f?.insurance ?? 0;
  const forcedNames = (f?.restructure?.forcedShops ?? []).map((id) => s.shops.find((x) => x.id === id)?.name).filter((x): x is string => !!x);

  return (
    <>
      <Card title="🏦 融資與保險">
        <div class="stack">
          <p class="small dim">
            資金週轉不過來時，可以向股市裡的三家金融企業借款。每家有自己的產品，審查看你的<b>營運狀況、口碑與信用紀錄</b>；授信鬆緊跟著各家公司的股價走勢（股價走弱就收緊），但你的借貸不會影響股價。
          </p>
          <div class="row" style={{ gap: "6px", flexWrap: "wrap" }}>
            <Chip tone={debt > 0 ? "amber" : "dim"}>未還本金 {money(debt)}</Chip>
            <Chip tone="cyan">信用紀錄 {Math.round(f?.score ?? 60)} 分</Chip>
            {f?.restructure && <Chip tone="red">重整中</Chip>}
            {level > 0 && <Chip tone="green">已投保營業中斷險</Chip>}
          </div>
          {view && (
            <div class="stack">
              {LENDER_ORDER.map((id) => {
                const c = view.climates[id];
                return (
                  <div key={id} class="row between small">
                    <span>
                      <b>{LENDERS[id].name}</b>
                      <span class="dim">　{LENDERS[id].blurb}</span>
                    </span>
                    <span title={c.note}>
                      <Chip tone={CLIMATE_TONE[c.level]}>{c.label}</Chip>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {f?.restructure && (
        <Card title="🏦 重整中" right={<Chip tone="red">{f.restructure.reason === "emergency" ? "緊急授信" : "連續逾期"}</Chip>}>
          <div class="stack">
            <p class="small">銀行介入：擴建、升級與大額研發暫時凍結。貸款連續逾期達 {RESTRUCTURE_MISSED_DAYS} 期，或接受緊急授信，就會進入重整。</p>
            {forcedNames.length > 0 ? <p class="small">已轉成出租的店：{forcedNames.join("、")}。租金會優先用來還款，貸款全部還清後可以改回直營。</p> : <p class="small dim">目前還沒有店被轉成出租。</p>}
            <p class="small dim">解除條件：把所有貸款還清。</p>
          </div>
        </Card>
      )}

      {loans.length > 0 && (
        <Card title="📄 目前的貸款">
          <div class="stack">
            {loans.map((l) => (
              <LoanRow key={l.id} s={s} loan={l} />
            ))}
          </div>
        </Card>
      )}

      <Card title="💴 申請貸款">
        <div class="stack">
          {!view && <Empty>讀取各家的授信條件…</Empty>}
          {view && view.quotes.map((q) => <ProductCard key={q.product} s={s} q={q} view={view} />)}
        </div>
      </Card>

      <Card title="🛡️ 營業中斷險" right={<Chip tone="dim">霞生命保険</Chip>}>
        <div class="stack">
          <p class="small dim">店面因設備故障、停電等意外停業時，依這間店的平均日營收按比例理賠（稽查停業、巡店事故不算）。保費每間直營店每遊戲日收一次；期望理賠低於保費，降的是風險、不是期望。有投保，信用評分也會加分。</p>
          {BIZ_INSURANCE.map((def, i) => (
            <label key={def.name} class="row between">
              <span class="row" style={{ gap: "6px" }}>
                <input type="radio" name="biz-insurance" checked={level === i} disabled={!view?.isAuthority} onChange={() => level !== i && run({ type: "setBizInsurance", level: i }, `已改為「${def.name}」`)} />
                <span>
                  {def.name}
                  {i > 0 && <span class="dim small">　停業補償日營收 {Math.round(def.rate * 100)}%、單次上限 {money(def.cap)}</span>}
                </span>
              </span>
              <span class="small dim">{i > 0 ? `${money(def.premium)}／店／日（現在約 ${money(def.premium * directShops)}／日）` : "—"}</span>
            </label>
          ))}
          {f && f.totalClaimed > 0 && <p class="small dim">歷來領到理賠 {money(f.totalClaimed)}。</p>}
          {view && !view.isAuthority && <p class="small dim">只有管事的人可以投保。</p>}
        </div>
      </Card>

      {f && f.history.length > 0 && (
        <Card title="🗂️ 借款紀錄">
          <div class="stack small">
            {f.history
              .slice()
              .reverse()
              .map((h, i) => (
                <div key={i} class="row between">
                  <span>
                    {PRODUCTS[h.product].name} {money(h.amount)}
                  </span>
                  <span class="dim">{h.outcome === "early" ? "提前還清" : h.outcome === "repaid" ? "準時還清" : "違約"}</span>
                </div>
              ))}
            {f.totalInterest > 0 && <span class="dim">歷來付出利息 {num(Math.round(f.totalInterest))}。</span>}
          </div>
        </Card>
      )}
    </>
  );
}
