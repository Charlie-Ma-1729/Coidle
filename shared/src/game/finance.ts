// 商場的金融功能：貸款、營業中斷險、破產保護（重整）。純規則，前後端共用。
//
// 放款方是股市裡三檔上市的虛構金融企業（stocks.ts）：
//   常盤フィナンシャル（地方銀行）＝週轉貸款＋緊急授信；木霊証券（零售證券）＝短期融資；霞生命保険＝長期貸付＋營業中斷險。
// 授信審查看三件事：營運狀況、口碑、信用紀錄。授信「氣候」（寬鬆／正常／收緊）跟著該企業的股價走勢，
// 由伺服器在申請當下算好、固定寫進那筆貸款，所以模擬仍是 (seed, tick) 的決定性函式。
// 玩家的借貸絕不影響股價（單向題材連動）。利息離開遊戲＝資金出口（見 docs/finance.md、equity.md 原則 4 第六條）。

import { dailyOverhead, dailyWages } from "./ledger";
import { TICKS_PER_DAY } from "./data";
import type { MallState } from "./types";

// ───────── 機構與產品 ─────────

export type LenderId = "tokiwa_fin" | "kasumi_life" | "kodama_securities";
export type LoanProduct = "working" | "emergency" | "short" | "long";
export type Climate = "loose" | "normal" | "tight";
export type Grade = "A" | "B" | "C" | "D" | "E";

export interface LenderDef {
  id: LenderId;
  /** 對應的股市標的鍵（`g:<id>`） */
  stock: string;
  name: string;
  blurb: string;
  /** 審查三類分數的權重（總和 1） */
  weights: { ops: number; rep: number; credit: number };
}

export const LENDERS: Record<LenderId, LenderDef> = {
  tokiwa_fin: {
    id: "tokiwa_fin",
    stock: "g:tokiwa_fin",
    name: "常盤フィナンシャル",
    blurb: "地方銀行與信用卡。重信用紀錄與現金流。",
    weights: { ops: 0.35, rep: 0.2, credit: 0.45 },
  },
  kodama_securities: {
    id: "kodama_securities",
    stock: "g:kodama_securities",
    name: "木霊証券",
    blurb: "零售證券商。看營收動能與口碑，行情熱絡時放得比較鬆。",
    weights: { ops: 0.45, rep: 0.35, credit: 0.2 },
  },
  kasumi_life: {
    id: "kasumi_life",
    stock: "g:kasumi_life",
    name: "霞生命保険",
    blurb: "壽險與醫療險。重長期穩定，有投保的商場加分。",
    weights: { ops: 0.3, rep: 0.2, credit: 0.5 },
  },
};
export const LENDER_ORDER: LenderId[] = ["tokiwa_fin", "kodama_securities", "kasumi_life"];

export interface ProductDef {
  id: LoanProduct;
  lender: LenderId;
  name: string;
  /** 期限（遊戲日）；本金平均分攤，每個遊戲日自動還一期 */
  termDays: number;
  /** 日利率基準（0.0008＝每遊戲日 0.08%） */
  baseRate: number;
  /** 審查綜合分數低於這個就婉拒 */
  minScore: number;
  /** 額度＝近 7 日日均營收 × 這個天數 × 評等倍率 × 氣候倍率 */
  limitDays: number;
  /** 額度的絕對上限＝這個數字 × 商場等級 */
  capPerLevel: number;
  /** 商場等級門檻 */
  minLevel: number;
  blurb: string;
}

export const PRODUCTS: Record<LoanProduct, ProductDef> = {
  working: { id: "working", lender: "tokiwa_fin", name: "週轉貸款", termDays: 30, baseRate: 0.0008, minScore: 50, limitDays: 6, capPerLevel: 4_000_000, minLevel: 1, blurb: "最一般的營運週轉。利率低，但要有像樣的營運與信用。" },
  emergency: { id: "emergency", lender: "tokiwa_fin", name: "緊急授信", termDays: 30, baseRate: 0.003, minScore: 0, limitDays: 0, capPerLevel: 0, minLevel: 1, blurb: "被其他機構婉拒、現金吃緊時的最後一道。額度只有幾天的固定成本、利率最高，而且借了就進入重整（銀行介入）。" },
  short: { id: "short", lender: "kodama_securities", name: "短期融資", termDays: 8, baseRate: 0.0015, minScore: 38, limitDays: 3, capPerLevel: 1_500_000, minLevel: 1, blurb: "快、額度小、利率較高。行情熱絡時門檻放寬。" },
  long: { id: "long", lender: "kasumi_life", name: "長期貸付", termDays: 90, baseRate: 0.0006, minScore: 65, limitDays: 15, capPerLevel: 8_000_000, minLevel: 4, blurb: "額度大、期限長、利率低；要求等級與評等都高。" },
};
export const PRODUCT_ORDER: LoanProduct[] = ["working", "short", "long", "emergency"];

/** 最小貸款金額 */
export const LOAN_MIN = 100_000;
/** 緊急授信額度＝這麼多天的固定成本 */
export const EMERGENCY_FIXED_DAYS = 3;
/** 緊急授信只在現金撐不過這麼多天固定成本時才給 */
export const EMERGENCY_CASH_DAYS = 3;
/** 還清後多久才能再向同一家借（遊戲日）：避免當週轉鍊 */
export const LOAN_COOLDOWN_DAYS = 2;
/** 連續幾期沒繳足就進重整 */
export const RESTRUCTURE_MISSED_DAYS = 3;
/** 延滯：每期沒繳足的部分，加收的日利率倍率 */
export const LATE_RATE_MULT = 1.5;
/** 日利率的合理範圍（防止氣候與評等加碼疊出離譜數字） */
export const RATE_MIN = 0.0003;
export const RATE_MAX = 0.006;

// ───────── 授信氣候（跟著該企業的股價走勢） ─────────

export interface ClimateEffect {
  level: Climate;
  limitMult: number;
  /** 日利率加減碼 */
  rateAdd: number;
  /** 木霊証券的門檻調整（行情熱絡放寬、冷清收緊） */
  minScoreAdj: number;
  label: string;
}

export const CLIMATES: Record<Climate, ClimateEffect> = {
  loose: { level: "loose", limitMult: 1.2, rateAdd: -0.0001, minScoreAdj: -5, label: "授信寬鬆" },
  normal: { level: "normal", limitMult: 1, rateAdd: 0, minScoreAdj: 0, label: "授信正常" },
  tight: { level: "tight", limitMult: 0.7, rateAdd: 0.0002, minScoreAdj: 5, label: "授信收緊" },
};

/**
 * 授信氣候：該企業現價相對近一個月均價、大盤現價相對近一個月均價。
 * 輸入是兩個「相對均價的偏離」（0.05＝高於均價 5%），回傳氣候與一句說明。
 */
export function creditClimate(lenderTrend: number, marketTrend: number): { level: Climate; note: string } {
  const x = (Number.isFinite(lenderTrend) ? lenderTrend : 0) * 0.7 + (Number.isFinite(marketTrend) ? marketTrend : 0) * 0.3;
  if (x <= -0.05) return { level: "tight", note: "公司股價與大盤走弱，授信趨於保守" };
  if (x >= 0.05) return { level: "loose", note: "公司股價與大盤走強，授信比較寬鬆" };
  return { level: "normal", note: "市場平穩，授信照常" };
}

// ───────── 狀態 ─────────

export interface Loan {
  id: string;
  product: LoanProduct;
  lender: LenderId;
  /** 借的本金 */
  principal: number;
  /** 還沒還的本金 */
  outstanding: number;
  /** 固定日利率（成交當下由授信氣候與評等決定，之後不變） */
  dailyRate: number;
  startTick: number;
  dueTick: number;
  termDays: number;
  /** 每期應還本金 */
  installment: number;
  /** 連續沒繳足的期數 */
  missedDays: number;
  /** 累計付過的利息（日報與歷史用） */
  interestPaid: number;
  /** 緊急授信：借的當下就進入重整 */
  emergency?: boolean;
}

export interface LoanRecord {
  tick: number;
  product: LoanProduct;
  amount: number;
  outcome: "repaid" | "early" | "defaulted";
}

export interface Restructure {
  since: number;
  reason: "overdue" | "emergency";
  /** 被強制出租的店（還清後可以改回直營） */
  forcedShops: string[];
  /** 下一次若仍逾期要再轉出租的 tick */
  nextRoundTick: number;
}

export interface FinanceState {
  loans: Loan[];
  history: LoanRecord[];
  /** 信用紀錄分 0–100（準時還款慢慢加、逾期與重整扣）；沒借過＝預設 60 */
  score: number;
  /** 各產品最近一次還清的 tick（冷卻用） */
  clearedAt: Partial<Record<LoanProduct, number>>;
  /** 營業中斷險方案（0＝未投保） */
  insurance: number;
  /** 今天已經發生、等著理賠的停業（店 id → 停業 tick 數）；日結算時理賠並清空 */
  claims: Record<string, number>;
  restructure: Restructure | null;
  /** 歷來付出的利息、領到的理賠（統計用） */
  totalInterest: number;
  totalClaimed: number;
  nextId: number;
}

export const SCORE_DEFAULT = 60;

export function newFinanceState(): FinanceState {
  return { loans: [], history: [], score: SCORE_DEFAULT, clearedAt: {}, insurance: 0, claims: {}, restructure: null, totalInterest: 0, totalClaimed: 0, nextId: 1 };
}

export const HISTORY_MAX = 20;

export const debtOf = (f: Pick<FinanceState, "loans"> | undefined): number => (f?.loans ?? []).reduce((a, l) => a + l.outstanding, 0);

// ───────── 營業中斷險（向霞生命保険投保） ─────────

export interface BizInsuranceDef {
  name: string;
  /** 每間直營店每遊戲日的保費 */
  premium: number;
  /** 停業期間，補償這間店平均日營收的多少比例 */
  rate: number;
  /** 一次理賠（一天結算）的上限 */
  cap: number;
}

export const BIZ_INSURANCE: BizInsuranceDef[] = [
  { name: "未投保", premium: 0, rate: 0, cap: 0 },
  { name: "營業中斷保険（基本）", premium: 700, rate: 0.4, cap: 600_000 },
  { name: "營業中斷保険（完整）", premium: 1_900, rate: 0.7, cap: 2_400_000 },
];

/** 一間店停業這麼多 tick，依它平均日營收給付多少（不含上限） */
export function bizClaimAmount(level: number, shopDailyRevenue: number, closedTicks: number): number {
  const def = BIZ_INSURANCE[level] ?? BIZ_INSURANCE[0]!;
  if (def.rate <= 0 || closedTicks <= 0 || shopDailyRevenue <= 0) return 0;
  return Math.round((shopDailyRevenue * closedTicks * def.rate) / TICKS_PER_DAY);
}

// ───────── 授信審查 ─────────

/** 審查用的快照：從商場狀態抽出來的數字，純函式只看這個 */
export interface UnderwriteInput {
  level: number;
  funds: number;
  /** 近 7 日（不足就有幾天算幾天）的日均營收（含租金）、日均淨利、虧損天數、資料天數 */
  avgRevenue: number;
  avgProfit: number;
  lossDays: number;
  reportDays: number;
  /** 每遊戲日固定成本（薪水＋水電） */
  dailyFixed: number;
  /** 目前所有貸款的未還本金 */
  debt: number;
  localRep: number;
  touristHeat: number;
  openCases: number;
  severeIssues: number;
  /** 稽查合規分數 0–100、逾期未繳的稅單數 */
  compliance: number;
  overdueTax: number;
  /** 信用紀錄分、是否投保營業中斷險、是否正在重整 */
  recordScore: number;
  insured: boolean;
  restructuring: boolean;
  /** 現有貸款中，這個產品是不是已經有一筆、還清後的冷卻剩多少 tick */
  tick: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 從商場狀態取審查快照 */
export function underwriteInput(s: Pick<MallState, "level" | "funds" | "localRep" | "touristHeat" | "reports" | "shops" | "hours" | "tech" | "cleaningLevel" | "maintenanceLevel" | "tick" | "tax" | "inspections" | "legal" | "patrol" | "finance">): UnderwriteInput {
  const rs = s.reports.slice(-7);
  const n = rs.length;
  const avgRevenue = n ? rs.reduce((a, r) => a + r.revenue + r.rentIncome, 0) / n : 0;
  const avgProfit = n ? rs.reduce((a, r) => a + r.profit, 0) / n : 0;
  const overdueTax = (s.tax?.bills ?? []).filter((b) => b.dueTick + TICKS_PER_DAY <= s.tick && b.amount - b.paid > 0).length;
  const severe = (s.patrol?.issues ?? []).filter((i) => i.status !== "hidden" && i.severity >= 4).length;
  const f = s.finance;
  return {
    level: s.level,
    funds: s.funds,
    avgRevenue,
    avgProfit,
    lossDays: rs.filter((r) => r.profit < 0).length,
    reportDays: n,
    dailyFixed: dailyOverhead(s) + dailyWages(s),
    debt: debtOf(f),
    localRep: s.localRep,
    touristHeat: s.touristHeat,
    openCases: s.legal?.cases.length ?? 0,
    severeIssues: severe,
    compliance: s.inspections?.compliance ?? 60,
    overdueTax,
    recordScore: f?.score ?? SCORE_DEFAULT,
    insured: (f?.insurance ?? 0) > 0,
    restructuring: !!f?.restructure,
    tick: s.tick,
  };
}

export interface Factors {
  ops: number;
  rep: number;
  credit: number;
}

/** 三類分數（各 0–100）與給玩家看的理由 */
export function scoreFactors(i: UnderwriteInput): { factors: Factors; notes: { ops: string[]; rep: string[]; credit: string[] } } {
  const notes = { ops: [] as string[], rep: [] as string[], credit: [] as string[] };
  // 營運狀況
  let ops = 50;
  if (i.reportDays === 0) {
    notes.ops.push("營運資料還不足（沒有日報）");
  } else {
    const margin = i.avgRevenue > 0 ? i.avgProfit / i.avgRevenue : -0.5;
    ops += clamp(margin * 150, -30, 30);
    if (margin < 0) notes.ops.push("近期營運虧損");
    else if (margin > 0.15) notes.ops.push("近期獲利穩健");
    if (i.lossDays >= 4) {
      ops -= 8;
      notes.ops.push(`近 ${i.reportDays} 天有 ${i.lossDays} 天虧損`);
    }
  }
  const cashDays = i.dailyFixed > 0 ? i.funds / i.dailyFixed : 99;
  if (i.funds < 0) {
    ops -= 20;
    notes.ops.push("帳上現金為負");
  } else if (cashDays < 3) {
    ops -= 10;
    notes.ops.push("現金只夠撐不到 3 天的固定成本");
  } else {
    ops += clamp((cashDays - 3) * 1.5, 0, 15);
  }
  if (i.avgRevenue > 0 && i.debt > 0) {
    const ratio = i.debt / (i.avgRevenue * 30);
    ops -= clamp(ratio * 40, 0, 25);
    if (ratio > 0.5) notes.ops.push("現有負債偏高");
  }
  // 口碑
  let rep = clamp((i.localRep + i.touristHeat) / 2, 0, 100);
  if (rep < 40) notes.rep.push("商場口碑偏低");
  else if (rep >= 70) notes.rep.push("商場口碑很好");
  if (i.openCases > 0) {
    rep -= Math.min(24, i.openCases * 8);
    notes.rep.push(`有 ${i.openCases} 件未結的法律糾紛`);
  }
  if (i.severeIssues > 0) {
    rep -= Math.min(18, i.severeIssues * 6);
    notes.rep.push(`巡店發現 ${i.severeIssues} 件還沒處理的嚴重問題`);
  }
  // 信用紀錄
  let credit = i.recordScore + (i.compliance - 60) * 0.4;
  if (i.overdueTax > 0) {
    credit -= Math.min(30, i.overdueTax * 10);
    notes.credit.push(`有 ${i.overdueTax} 筆逾期未繳的稅單`);
  }
  if (i.insured) credit += 5;
  if (i.restructuring) {
    credit -= 25;
    notes.credit.push("重整期間");
  }
  if (i.recordScore < 45) notes.credit.push("過去的還款紀錄不佳");
  else if (i.recordScore >= 75) notes.credit.push("還款紀錄良好");
  return { factors: { ops: clamp(ops, 0, 100), rep: clamp(rep, 0, 100), credit: clamp(credit, 0, 100) }, notes };
}

export function gradeOf(score: number): Grade {
  return score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "E";
}
const GRADE_LIMIT: Record<Grade, number> = { A: 1, B: 0.8, C: 0.55, D: 0.3, E: 0 };
const GRADE_RATE: Record<Grade, number> = { A: -0.0001, B: 0, C: 0.0002, D: 0.0004, E: 0.0008 };

export type Decision = "approve" | "reduced" | "decline";

export interface Quote {
  product: LoanProduct;
  lender: LenderId;
  decision: Decision;
  /** 綜合分數與評等 */
  score: number;
  grade: Grade;
  factors: Factors;
  /** 現在最多能借多少（已扣掉未還本金；0＝借不到） */
  limit: number;
  /** 這個條件下的日利率 */
  rate: number;
  termDays: number;
  climate: Climate;
  /** 給玩家看的審查意見 */
  reasons: string[];
  /** 這個產品現在是否開放（等級、冷卻、緊急授信資格） */
  available: boolean;
}

function clampRate(r: number): number {
  return clamp(r, RATE_MIN, RATE_MAX);
}

/**
 * 授信審查：對某個產品、在某個授信氣候下，這間商場現在能借多少、利率多少、為什麼。
 * `amount` 是申請金額（沒給＝預審，只問能借多少）。決定性、只看快照。
 */
export function underwrite(i: UnderwriteInput, product: LoanProduct, climate: Climate, fin: Pick<FinanceState, "loans" | "clearedAt"> | undefined, amount?: number): Quote {
  const def = PRODUCTS[product];
  const lender = LENDERS[def.lender];
  const eff = CLIMATES[climate];
  const { factors, notes } = scoreFactors(i);
  const w = lender.weights;
  const score = Math.round(factors.ops * w.ops + factors.rep * w.rep + factors.credit * w.credit);
  const grade = gradeOf(score);
  const reasons: string[] = [];
  const base: Omit<Quote, "decision" | "limit" | "rate" | "reasons" | "available"> = { product, lender: def.lender, score, grade, factors, termDays: def.termDays, climate };

  const mine = (fin?.loans ?? []).filter((l) => l.product === product);
  const cleared = fin?.clearedAt?.[product];
  const coolLeft = cleared === undefined ? 0 : cleared + LOAN_COOLDOWN_DAYS * TICKS_PER_DAY - i.tick;
  const decline = (why: string, available = true): Quote => ({ ...base, decision: "decline", limit: 0, rate: clampRate(def.baseRate + GRADE_RATE[grade] + eff.rateAdd), reasons: [why, ...reasons], available });

  if (i.level < def.minLevel) return decline(`商場要到 Lv.${def.minLevel} 才能申請「${def.name}」`, false);
  if (mine.length > 0) return decline(`「${def.name}」已經有一筆還沒還清`);
  if (coolLeft > 0) return decline(`剛還清不久，${Math.ceil(coolLeft / TICKS_PER_DAY)} 個遊戲日後才能再申請`);

  // 緊急授信：只給評等太差、其他機構都婉拒、而且現金吃緊的商場
  if (product === "emergency") {
    const cashDays = i.dailyFixed > 0 ? i.funds / i.dailyFixed : 99;
    const others: LoanProduct[] = ["working", "short", "long"];
    const anyOk = others.some((p) => {
      const d = PRODUCTS[p];
      const lw = LENDERS[d.lender].weights;
      const sc = Math.round(factors.ops * lw.ops + factors.rep * lw.rep + factors.credit * lw.credit);
      return i.level >= d.minLevel && sc >= d.minScore + CLIMATES[climate].minScoreAdj * (d.lender === "kodama_securities" ? 1 : 0);
    });
    if (anyOk) return decline("評等正常的商場可以向其他產品申請，不適用緊急授信", true);
    if (cashDays >= EMERGENCY_CASH_DAYS) return decline("現金還撐得住，不符合緊急授信的條件", true);
    const room = Math.max(0, Math.round(i.dailyFixed * EMERGENCY_FIXED_DAYS) - i.debt);
    const rate = clampRate(def.baseRate + eff.rateAdd);
    const q: Quote = { ...base, decision: "approve", limit: room, rate, reasons: ["銀行願意救急，但條件是進入重整：凍結擴建與大額支出，並把最虧的店轉成出租來還款"], available: true };
    if (room < LOAN_MIN) return decline("目前負債已超過緊急授信能給的額度");
    if (amount !== undefined) {
      if (amount > room) return { ...q, decision: "reduced", reasons: [`緊急授信最多 ${room.toLocaleString("en-US")}`, ...q.reasons] };
    }
    return q;
  }

  // 一般產品：分數要過門檻（木霊的門檻跟著行情鬆緊）
  const minScore = def.minScore + (def.lender === "kodama_securities" ? eff.minScoreAdj : 0);
  const weak = (Object.entries(factors) as [keyof Factors, number][]).sort((a, b) => a[1] - b[1]);
  const label = { ops: "營運狀況", rep: "口碑", credit: "信用紀錄" } as const;
  if (score < minScore) {
    const top = weak[0]!;
    for (const k of [top[0], weak[1]![0]]) reasons.push(...notes[k].slice(0, 2));
    return decline(`綜合評分 ${score} 分（評等 ${grade}）未達「${def.name}」的門檻 ${minScore} 分，主要弱項是${label[top[0]]}`);
  }
  if (i.avgRevenue <= 0) return decline("營運資料不足，無法核定額度");

  const gradeMult = GRADE_LIMIT[grade];
  const raw = i.avgRevenue * def.limitDays * gradeMult * eff.limitMult;
  const cap = def.capPerLevel * i.level;
  const room = Math.max(0, Math.floor((Math.min(raw, cap) - i.debt) / 10_000) * 10_000);
  const rate = clampRate(def.baseRate + GRADE_RATE[grade] + eff.rateAdd);
  for (const k of ["ops", "rep", "credit"] as const) reasons.push(...notes[k].slice(0, 1));
  if (room < LOAN_MIN) return decline("額度已經用盡（現有負債占掉了核定額度）");
  const q: Quote = { ...base, decision: "approve", limit: room, rate, reasons: [`綜合評分 ${score} 分、評等 ${grade}`, `${eff.label}`, ...reasons], available: true };
  if (amount !== undefined && amount > room) return { ...q, decision: "reduced", reasons: [`申請 ${amount.toLocaleString("en-US")}，核定 ${room.toLocaleString("en-US")}`, ...q.reasons] };
  return q;
}

// ───────── 給畫面的總覽 ─────────

export interface FinanceView {
  /** 各機構目前的授信氣候（跟著該企業的股價走勢）與一句說明 */
  climates: Record<LenderId, { level: Climate; label: string; note: string }>;
  /** 每個產品的預審結果（不扣任何東西） */
  quotes: Quote[];
  /** 現在能不能申請（落後超過 1 遊戲日不行）、原因 */
  canTake: boolean;
  blocked: string | null;
  /** 只有管事的人能借款與投保 */
  isAuthority: boolean;
}

// ───────── 還款 ─────────

/** 這一期應繳：本金一期＋當期利息（未還本金 × 日利率）。最後一期把剩下的本金繳清 */
export function loanDue(l: Loan, tick: number): { principal: number; interest: number; total: number } {
  const daysLeft = Math.max(1, Math.ceil((l.dueTick - tick) / TICKS_PER_DAY));
  const principal = daysLeft <= 1 ? l.outstanding : Math.min(l.outstanding, l.installment);
  const rate = l.missedDays > 0 ? l.dailyRate * LATE_RATE_MULT : l.dailyRate;
  const interest = Math.round(l.outstanding * rate);
  return { principal, interest, total: principal + interest };
}

/** 提前還款時，從貸款扣掉多少本金（先還利率高的由呼叫端排序） */
export function applyPrincipal(l: Loan, pay: number): number {
  const p = Math.max(0, Math.min(pay, l.outstanding));
  l.outstanding -= p;
  return p;
}

/** 每間直營店平均日營收（近 7 份日報；沒有就用今天的） */
export function shopDailyRevenue(s: Pick<MallState, "reports" | "shops">, shopId: string): number {
  const rs = s.reports.slice(-7);
  const vals = rs.map((r) => r.shops.find((x) => x.id === shopId)?.revenue ?? 0).filter((v) => v > 0);
  if (vals.length > 0) return vals.reduce((a, b) => a + b, 0) / vals.length;
  return s.shops.find((x) => x.id === shopId)?.day.revenue ?? 0;
}
