import {
  BONUS_FACTOR,
  BONUS_MONTHS,
  CONSUMPTION_STANDARD,
  EMPLOYER_SOCIAL_RATE,
  LATE_FEE_PER_DAY,
  LOSS_CARRY_LIMIT,
  OBLIGATION_NAMES,
  PROPERTY_MONTHS,
  PROPERTY_TAX_RATE,
  ROYALTY_RATE,
  assessedValue,
  billOutstanding,
  corporateTax,
  dailyOverhead,
  dailyWages,
  taxPortion,
  TICKS_PER_DAY,
  type DayStats,
  type MallState,
  type Obligation,
  type ObligationKind,
  type TaxState,
} from "@coidle/shared";
import { addLog, nextId } from "./state";
import type { TimeInfo } from "./time";

const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;
const MAX_HISTORY = 40;

export function newTaxState(): TaxState {
  return {
    quarter: { outputTax: 0, inputTax: 0 },
    fy: { profit: 0, interimPaid: 0 },
    lossCarry: 0,
    lastYearCorporate: 0,
    monthPayroll: 0,
    lastMonthPayroll: 0,
    monthRoyaltyBase: 0,
    bills: [],
    history: [],
    totalPaid: { consumption: 0, corporate: 0, corporate_interim: 0, property: 0, social: 0, bonus: 0, royalty: 0 },
  };
}

// 每日薪資與營運支出的算式在 shared/ledger.ts（畫面要拿來顯示固定成本明細）；這裡照舊匯出給模擬與測試用
export { dailyOverhead, dailyWages };

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

function addBill(s: MallState, kind: ObligationKind, label: string, amount: number, dueInTicks: number): Obligation | null {
  const a = Math.round(amount);
  if (a <= 0) return null;
  const b: Obligation = { uid: nextId(s, "tx"), kind, label, amount: a, createdTick: s.tick, dueTick: s.tick + dueInTicks, paid: 0, lateFee: 0 };
  s.tax.bills.push(b);
  return b;
}

/** 每日結算：累積稅前損益，並依日曆產生帳單、處理到期的扣款。closed 是剛結束的那一天。 */
export function taxDaily(s: MallState, time: TimeInfo, closed: DayStats): void {
  const t = s.tax;
  const wages = dailyWages(s);
  const pretax = closed.revenue + closed.rentIncome - closed.outTax - (closed.purchases - closed.inTax) - (closed.fixed - closed.fixedCredit) - closed.repairs + (closed.invest ?? 0) - (closed.investExempt ?? 0);
  t.fy.profit += pretax;
  t.quarter.outputTax += closed.outTax;
  t.quarter.inputTax += closed.inTax + closed.fixedCredit;
  t.monthPayroll += wages;

  const first = time.date.endsWith("-01");
  if (first) {
    const m = time.month;
    // 社會保險：上個月薪資的雇主負擔，月底前繳
    t.lastMonthPayroll = t.monthPayroll;
    const social = addBill(s, "social", `${prevMonthLabel(m)}社會保險`, t.monthPayroll * EMPLOYER_SOCIAL_RATE, 25 * TICKS_PER_DAY);
    t.monthPayroll = 0;
    if (social) note(s, `🧑‍💼 ${social.label}帳單 ${money(social.amount)} 已開立`);
    // 著作權使用費
    if (t.monthRoyaltyBase > 0) addBill(s, "royalty", `${prevMonthLabel(m)}著作權使用費`, t.monthRoyaltyBase * ROYALTY_RATE, 25 * TICKS_PER_DAY);
    t.monthRoyaltyBase = 0;
    // 固定資產稅（6、9、12、2 月，各四分之一）
    if ((PROPERTY_MONTHS as readonly number[]).includes(m)) {
      const p = addBill(s, "property", `${m} 月固定資產稅・都市計畫稅（第 ${PROPERTY_MONTHS.indexOf(m as never) + 1} 期）`, (assessedValue(s) * PROPERTY_TAX_RATE) / 4, 28 * TICKS_PER_DAY);
      if (p) note(s, `🏢 ${p.label} ${money(p.amount)}`);
    }
    // 夏冬獎金（以上個月薪資為基準，含社會保險負擔）
    if ((BONUS_MONTHS as readonly number[]).includes(m)) {
      const b = addBill(s, "bonus", `${m === 6 ? "夏季" : "冬季"}獎金`, t.lastMonthPayroll * BONUS_FACTOR * (1 + EMPLOYER_SOCIAL_RATE), 7 * TICKS_PER_DAY);
      if (b) note(s, `🎁 ${b.label} ${money(b.amount)} 將於本週發放`);
    }
    // 消費稅：每季（1、4、7、10 月）結算上一季，下個月底前繳；進項大於銷項就是還付
    if ([1, 4, 7, 10].includes(m)) {
      const due = t.quarter.outputTax - t.quarter.inputTax;
      t.quarter = { outputTax: 0, inputTax: 0 };
      if (due > 0) {
        const c = addBill(s, "consumption", `${prevQuarterLabel(m)}消費稅`, due, 30 * TICKS_PER_DAY);
        if (c) note(s, `🧾 ${c.label} ${money(c.amount)}（銷項 − 進項）`);
      } else if (due < 0) {
        s.funds += -due;
        record(s, "consumption", `${prevQuarterLabel(m)}消費稅（還付）`, due, false);
        note(s, `🧾 ${prevQuarterLabel(m)}消費稅進項大於銷項，退稅 ${money(-due)}`);
      }
    }
    // 法人稅等：4 月結算上一個會計年度（可用累積虧損抵），5 月底前繳
    if (m === 4) {
      const income = t.fy.profit;
      let taxable = Math.max(0, income);
      if (income <= 0) t.lossCarry += -income;
      else {
        const use = Math.min(t.lossCarry, income * LOSS_CARRY_LIMIT);
        taxable = income - use;
        t.lossCarry -= use;
      }
      const ct = corporateTax(taxable);
      t.lastYearCorporate = ct.total;
      const c = addBill(s, "corporate", `${time.date.slice(0, 4)} 年度法人稅等（決算）`, ct.total - t.fy.interimPaid, 58 * TICKS_PER_DAY);
      t.fy = { profit: 0, interimPaid: 0 };
      addLog(s, "info", `🏛 年度決算：所得 ${money(income)}，法人稅等 ${money(ct.total)}（實質稅率 ${(ct.effective * 100).toFixed(0)}%）。`);
      if (c) note(s, `🏛 ${c.label} ${money(c.amount)}，5 月底前繳納`);
    }
    // 中間申報（10 月）：預繳上一年稅額的一半
    if (m === 10 && t.lastYearCorporate > 0) {
      const half = t.lastYearCorporate / 2;
      const c = addBill(s, "corporate_interim", "法人稅等（中間申報）", half, 28 * TICKS_PER_DAY);
      if (c) {
        t.fy.interimPaid += c.amount;
        note(s, `🏛 ${c.label} ${money(c.amount)}`);
      }
    }
  }
  settleBills(s);
}

function prevMonthLabel(m: number): string {
  return `${m === 1 ? 12 : m - 1} 月份`;
}
function prevQuarterLabel(m: number): string {
  return { 1: "10–12 月", 4: "1–3 月", 7: "4–6 月", 10: "7–9 月" }[m] ?? "上一季";
}

function record(s: MallState, kind: ObligationKind, label: string, amount: number, late: boolean): void {
  s.tax.history.unshift({ tick: s.tick, kind, label, amount: Math.round(amount), late });
  if (s.tax.history.length > MAX_HISTORY) s.tax.history.length = MAX_HISTORY;
  if (amount > 0) s.tax.totalPaid[kind] += amount;
}

/** 到期的帳單自動扣款；錢不夠就先繳一部分，餘額每天加收延滯稅，並拉低合規分數 */
export function settleBills(s: MallState): void {
  const t = s.tax;
  let overdue = false;
  for (const b of t.bills.slice().sort((x, y) => x.dueTick - y.dueTick)) {
    if (b.dueTick > s.tick) continue;
    if (b.dueTick + TICKS_PER_DAY <= s.tick && billOutstanding(b) > 0) b.lateFee += Math.round((b.amount - b.paid) * LATE_FEE_PER_DAY);
    const owe = billOutstanding(b);
    const pay = Math.min(owe, Math.max(0, Math.floor(s.funds)));
    if (pay > 0) {
      s.funds -= pay;
      b.paid += pay;
    }
    if (billOutstanding(b) <= 0) {
      const late = s.tick > b.dueTick + TICKS_PER_DAY;
      record(s, b.kind, b.label, b.paid, late);
      note(s, `${OBLIGATION_NAMES[b.kind].icon} 已繳納：${b.label} ${money(b.paid)}${late ? "（含延滯稅）" : ""}`);
      t.bills = t.bills.filter((x) => x.uid !== b.uid);
    } else {
      overdue = true;
      if (b.lateFee === 0 || pay > 0 || s.tick - b.dueTick < TICKS_PER_DAY) {
        addLog(s, "warn", `${OBLIGATION_NAMES[b.kind].icon} 資金不足！「${b.label}」還差 ${money(billOutstanding(b))}，逾期每天加收延滯稅。`);
      }
    }
  }
  if (overdue) s.inspections.compliance = Math.max(0, s.inspections.compliance - 1.5);
}

/** 已經辦理但還沒繳的稅，加上預估 30 天內到期的金額（給介面提醒「現金夠不夠」用） */
export function upcomingCash(s: MallState, ticks = 30 * TICKS_PER_DAY): number {
  return s.tax.bills.filter((b) => b.dueTick <= s.tick + ticks).reduce((a, b) => a + billOutstanding(b), 0);
}

/** 目前會計年度到今天的稅額預估（給稅務畫面） */
export function corporateEstimate(s: MallState) {
  const income = Math.max(0, s.tax.fy.profit - s.tax.lossCarry * LOSS_CARRY_LIMIT);
  return corporateTax(income);
}

export const STANDARD_RATE = CONSUMPTION_STANDARD;
export { taxPortion };
