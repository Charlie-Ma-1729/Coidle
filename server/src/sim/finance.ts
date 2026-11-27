// 商場的金融：貸款、營業中斷險、重整（破產保護）。規則與審查見 shared/game/finance.ts。
// 全部是 (狀態, tick) 的決定性函式；授信氣候由伺服器在申請當下填進指令，之後固定寫進貸款。

import {
  BIZ_INSURANCE,
  CLIMATES,
  HISTORY_MAX,
  LOAN_MIN,
  PRODUCTS,
  RESTRUCTURE_MISSED_DAYS,
  TICKS_PER_DAY,
  bizClaimAmount,
  debtOf,
  loanDue,
  newFinanceState,
  shopDailyRevenue,
  underwrite,
  underwriteInput,
  type Climate,
  type FinanceState,
  type Loan,
  type LoanProduct,
  type MallState,
  type Shop,
} from "@coidle/shared";
import { addLog } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

export type FinanceResult = { ok: true; note: string } | { ok: false; error: string };

/** 重整每輪最多把多少比例的直營店轉成出租 */
const FORCE_LEASE_SHARE = 0.3;
/** 重整期間，再度逾期時隔幾個遊戲日再多轉一批 */
const RESTRUCTURE_ROUND_DAYS = 3;

export function financeOf(s: MallState): FinanceState {
  return (s.finance ??= newFinanceState());
}

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

function pushHistory(f: FinanceState, rec: FinanceState["history"][number]): void {
  f.history.push(rec);
  if (f.history.length > HISTORY_MAX) f.history.splice(0, f.history.length - HISTORY_MAX);
}

// ───────── 重整 ─────────

/** 重整期間不能做的大額動作；可以做回傳 null，否則回傳原因 */
export function restructureBlock(s: MallState): string | null {
  return s.finance?.restructure ? "重整期間，擴建、升級與大額研發暫時凍結，還清貸款後才解除" : null;
}

/** 把近期營收最低的幾間直營店強制轉成出租（至少留一間直營） */
function forceLeaseRound(s: MallState): number {
  const f = financeOf(s);
  const rs = f.restructure;
  if (!rs) return 0;
  const direct = s.shops.filter((x) => x.mode === "direct");
  if (direct.length <= 1) return 0;
  const n = Math.min(direct.length - 1, Math.max(1, Math.ceil(direct.length * FORCE_LEASE_SHARE)));
  const picked = direct
    .slice()
    .sort((a, b) => shopDailyRevenue(s, a.id) - shopDailyRevenue(s, b.id) || a.id.localeCompare(b.id))
    .slice(0, n);
  for (const shop of picked) {
    shop.mode = "lease";
    shop.tenant = { brand: shop.name, quality: 0.65, fame: 30, rent: shop.rent, commission: shop.commission, startTick: s.tick, endTick: s.tick + 60 * TICKS_PER_DAY, satisfaction: 60, lowDays: 0, own: true };
    rs.forcedShops.push(shop.id);
  }
  if (picked.length > 0) {
    const text = `🏦 重整：銀行要求把營收最低的 ${picked.map((x) => `「${x.name}」`).join("、")} 轉成出租，租金優先用來還款。`;
    addLog(s, "warn", text);
    note(s, text);
  }
  return picked.length;
}

function enterRestructure(s: MallState, reason: "overdue" | "emergency"): void {
  const f = financeOf(s);
  if (f.restructure) return;
  f.restructure = { since: s.tick, reason, forcedShops: [], nextRoundTick: s.tick + RESTRUCTURE_ROUND_DAYS * TICKS_PER_DAY };
  const text = reason === "emergency" ? "🏦 接受緊急授信，進入重整：擴建、升級與大額研發暫時凍結。" : "🏦 貸款連續逾期，進入重整：擴建、升級與大額研發暫時凍結。";
  addLog(s, "warn", text);
  note(s, text);
  forceLeaseRound(s);
}

/** 玩家不能自行改回直營的店（重整中被強制出租的） */
export function isForcedLease(s: MallState, shopId: string): boolean {
  return !!s.finance?.restructure?.forcedShops.includes(shopId);
}

// ───────── 玩家指令 ─────────

export function takeLoan(s: MallState, product: LoanProduct, amount: number, climate: Climate | undefined): FinanceResult {
  const def = PRODUCTS[product];
  if (!def) return { ok: false, error: "找不到這個貸款產品" };
  if (!Number.isInteger(amount) || amount < LOAN_MIN) return { ok: false, error: `借款金額至少 ${money(LOAN_MIN)}（整數）` };
  const f = financeOf(s);
  const cl: Climate = climate && CLIMATES[climate] ? climate : "normal";
  const q = underwrite(underwriteInput(s), product, cl, f, amount);
  if (q.decision === "decline") return { ok: false, error: `「${def.name}」被婉拒：${q.reasons[0] ?? "未通過審查"}` };
  if (amount > q.limit) return { ok: false, error: `核定額度只有 ${money(q.limit)}` };
  const installment = Math.ceil(amount / def.termDays);
  const loan: Loan = {
    id: `L${f.nextId++}`,
    product,
    lender: def.lender,
    principal: amount,
    outstanding: amount,
    dailyRate: q.rate,
    startTick: s.tick,
    dueTick: s.tick + def.termDays * TICKS_PER_DAY,
    termDays: def.termDays,
    installment,
    missedDays: 0,
    interestPaid: 0,
    ...(product === "emergency" ? { emergency: true } : {}),
  };
  f.loans.push(loan);
  s.funds += amount;
  addLog(s, "info", `🏦 向${q.lender === "tokiwa_fin" ? "常盤フィナンシャル" : q.lender === "kodama_securities" ? "木霊証券" : "霞生命保険"}借入「${def.name}」${money(amount)}（日利 ${(q.rate * 100).toFixed(2)}%、${def.termDays} 個遊戲日、評等 ${q.grade}）。`);
  if (product === "emergency") enterRestructure(s, "emergency");
  return { ok: true, note: `已借入 ${money(amount)}` };
}

export function repayLoan(s: MallState, loanId: string, amount: number | undefined): FinanceResult {
  const f = s.finance;
  const loan = f?.loans.find((l) => l.id === loanId);
  if (!f || !loan) return { ok: false, error: "找不到這筆貸款" };
  if (amount !== undefined && (!Number.isInteger(amount) || amount <= 0)) return { ok: false, error: "還款金額無效" };
  const want = amount ?? loan.outstanding;
  const pay = Math.min(want, loan.outstanding, Math.floor(s.funds));
  if (pay <= 0) return { ok: false, error: "帳上資金不足" };
  s.funds -= pay;
  loan.outstanding -= pay;
  if (loan.outstanding <= 0) {
    closeLoan(s, loan, s.tick < loan.dueTick ? "early" : "repaid");
    return { ok: true, note: `「${PRODUCTS[loan.product].name}」已還清` };
  }
  // 提前還本金之後，每期的本金跟著減少（期數不變）
  loan.installment = Math.min(loan.installment, Math.ceil(loan.outstanding / Math.max(1, Math.ceil((loan.dueTick - s.tick) / TICKS_PER_DAY))));
  return { ok: true, note: `已還 ${money(pay)}，剩 ${money(loan.outstanding)}` };
}

function closeLoan(s: MallState, loan: Loan, outcome: "repaid" | "early"): void {
  const f = financeOf(s);
  f.loans = f.loans.filter((l) => l.id !== loan.id);
  f.clearedAt[loan.product] = s.tick;
  pushHistory(f, { tick: s.tick, product: loan.product, amount: loan.principal, outcome });
  f.score = clamp(f.score + (outcome === "early" ? 4 : 3), 0, 100);
  addLog(s, "info", `🏦 「${PRODUCTS[loan.product].name}」${money(loan.principal)} 已還清。`);
  if (f.restructure && f.loans.length === 0) {
    const forced = f.restructure.forcedShops.length;
    f.restructure = null;
    const text = `🏦 貸款全數還清，重整解除${forced > 0 ? `。被轉成出租的 ${forced} 間店可以改回直營了` : ""}。`;
    addLog(s, "info", text);
    note(s, text);
  }
}

export function setBizInsurance(s: MallState, level: number): FinanceResult {
  if (!Number.isInteger(level) || level < 0 || level >= BIZ_INSURANCE.length) return { ok: false, error: "保險方案無效" };
  const f = financeOf(s);
  if (f.insurance === level) return { ok: false, error: "已經是這個方案了" };
  f.insurance = level;
  if (level === 0) f.claims = {};
  addLog(s, "info", `🛡️ 營業中斷險改為「${BIZ_INSURANCE[level]!.name}」。`);
  return { ok: true, note: `已改為「${BIZ_INSURANCE[level]!.name}」` };
}

// ───────── 事件掛鉤 ─────────

/** 店面因故障、停電等意外停業時呼叫（稽查停業、巡店事故不算）；有投保才會記下，日結算時理賠 */
export function noteClosure(s: MallState, shop: Shop, ticks: number): void {
  const f = s.finance;
  if (!f || f.insurance <= 0 || shop.mode !== "direct" || ticks <= 0) return;
  f.claims[shop.id] = Math.max(f.claims[shop.id] ?? 0, Math.round(ticks));
}

// ───────── 每日結算 ─────────

/** 每個遊戲日：保費與理賠、貸款還款與逾期、重整的推進。要在日報建立之前呼叫（利息與理賠才算進今天的損益） */
export function financeDaily(s: MallState): void {
  const f = s.finance;
  if (!f) return;
  insuranceDaily(s, f);
  loansDaily(s, f);
  restructureDaily(s, f);
}

function insuranceDaily(s: MallState, f: FinanceState): void {
  const def = BIZ_INSURANCE[f.insurance] ?? BIZ_INSURANCE[0]!;
  if (def.premium > 0) {
    const prem = def.premium * s.shops.filter((x) => x.mode === "direct").length;
    if (prem > 0) {
      s.funds -= prem;
      s.today.fixed += prem;
    }
  }
  const ids = Object.keys(f.claims);
  if (ids.length === 0) return;
  let total = 0;
  const names: string[] = [];
  for (const id of ids) {
    const shop = s.shops.find((x) => x.id === id);
    if (!shop || shop.mode !== "direct") continue;
    const amt = bizClaimAmount(f.insurance, shopDailyRevenue(s, id), f.claims[id]!);
    if (amt > 0) {
      total += amt;
      names.push(`「${shop.name}」`);
    }
  }
  f.claims = {};
  total = Math.min(total, def.cap);
  if (total <= 0) return;
  s.funds += total;
  s.today.repairs -= total;
  s.today.insuranceClaim = (s.today.insuranceClaim ?? 0) + total;
  f.totalClaimed += total;
  const text = `🛡️ 營業中斷險理賠 ${money(total)}（${names.join("、")}停業）。`;
  addLog(s, "info", text);
  note(s, text);
}

function loansDaily(s: MallState, f: FinanceState): void {
  if (f.loans.length === 0) return;
  // 先繳利率高的
  const order = f.loans.slice().sort((a, b) => b.dailyRate - a.dailyRate || a.id.localeCompare(b.id));
  let anyMissed = false;
  for (const loan of order) {
    const due = loanDue(loan, s.tick);
    const budget = Math.max(0, Math.floor(s.funds));
    const payInterest = Math.min(due.interest, budget);
    const payPrincipal = Math.min(due.principal, Math.max(0, budget - payInterest));
    const paid = payInterest + payPrincipal;
    if (paid > 0) s.funds -= paid;
    if (payInterest > 0) {
      s.today.repairs += payInterest;
      s.today.interestCost = (s.today.interestCost ?? 0) + payInterest;
      loan.interestPaid += payInterest;
      f.totalInterest += payInterest;
    }
    loan.outstanding -= payPrincipal;
    const unpaidInterest = due.interest - payInterest;
    if (unpaidInterest > 0) loan.outstanding += unpaidInterest; // 欠的利息滾進本金
    if (paid < due.total) {
      loan.missedDays++;
      anyMissed = true;
      f.score = clamp(f.score - 4, 0, 100);
      if (loan.missedDays === 1 || loan.missedDays >= RESTRUCTURE_MISSED_DAYS) {
        const text = `🏦 「${PRODUCTS[loan.product].name}」本期沒繳足，還差 ${money(due.total - paid)}（連續 ${loan.missedDays} 期）。`;
        addLog(s, "warn", text);
        note(s, text);
      }
    } else {
      loan.missedDays = 0;
    }
    if (loan.outstanding <= 0) closeLoan(s, loan, "repaid");
    else if (s.tick >= loan.dueTick && loan.missedDays === RESTRUCTURE_MISSED_DAYS) {
      // 到期還沒還清且連續逾期：視為違約，記錄後繼續照重整處理（本金仍要還）
      pushHistory(f, { tick: s.tick, product: loan.product, amount: loan.principal, outcome: "defaulted" });
    }
  }
  if (!anyMissed && f.loans.length > 0) f.score = clamp(f.score + 0.3, 0, 100);
  // 連續逾期 → 重整
  if (!f.restructure && f.loans.some((l) => l.missedDays >= RESTRUCTURE_MISSED_DAYS)) {
    f.score = clamp(f.score - 15, 0, 100);
    enterRestructure(s, "overdue");
  }
}

function restructureDaily(s: MallState, f: FinanceState): void {
  const rs = f.restructure;
  if (!rs) return;
  if (f.loans.length === 0) {
    // 保險起見（理論上 closeLoan 已處理）：沒有貸款就解除
    f.restructure = null;
    return;
  }
  if (s.tick >= rs.nextRoundTick) {
    rs.nextRoundTick = s.tick + RESTRUCTURE_ROUND_DAYS * TICKS_PER_DAY;
    if (f.loans.some((l) => l.missedDays > 0)) forceLeaseRound(s);
  }
}

// 讓外部（報表、UI 測試）方便取用
export { debtOf };
