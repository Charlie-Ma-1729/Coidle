import type { TechGrade, TechPlan } from "./types";

// 科研遊戲：把「花錢等時間」改成三段式的研究專案——
//  ① 立項：用滑桿分配資源（速度／嚴謹／節約，總量固定，要取捨）；
//  ② 實驗：進行到一半遇到實驗事件（資料異常、設備故障、意外發現……），選擇怎麼處理，有風險也有回報；
//  ③ 數據判讀：從帶雜訊的折線圖判斷趨勢（小遊戲，伺服器用同一份關卡重新計分）；
//  結案：成果分成「勉強完成／優良／突破」，優良與突破有退款、廚藝經驗與口碑獎勵。
// 離線安全：實驗事件逾期就走最保守的預設選項；所有結果由伺服器結算，加成都有上限。

export const TECH_PLAN_DEFAULT: TechPlan = { speed: 34, rigor: 33, thrift: 33 };

/** 把任意輸入整理成合法配置（各項 0–100 的整數、總和 100）；不合法就用標準配置 */
export function normalizePlan(p: Partial<TechPlan> | undefined): TechPlan {
  if (!p) return { ...TECH_PLAN_DEFAULT };
  const v = [p.speed, p.rigor, p.thrift].map((x) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.round(x)) : NaN));
  if (v.some((x) => Number.isNaN(x))) return { ...TECH_PLAN_DEFAULT };
  const sum = v[0]! + v[1]! + v[2]!;
  if (sum <= 0) return { ...TECH_PLAN_DEFAULT };
  const r = v.map((x) => Math.round((x! / sum) * 100));
  r[0] = 100 - r[1]! - r[2]!;
  if (r[0]! < 0) return { ...TECH_PLAN_DEFAULT };
  return { speed: r[0]!, rigor: r[1]!, thrift: r[2]! };
}

export interface PlanEffects {
  /** 研發時間倍率（<1 較快） */
  ticksMult: number;
  /** 研發費用倍率 */
  costMult: number;
  /** 立項時帶進來的成果品質點數 */
  points0: number;
}
export function planEffects(plan: TechPlan): PlanEffects {
  const v = plan.speed / 100;
  const a = plan.rigor / 100;
  const t = plan.thrift / 100;
  return {
    ticksMult: Math.max(0.6, 1.14 - 0.5 * v + 0.1 * a),
    costMult: Math.max(0.7, 0.93 + 0.4 * v - 0.3 * t + 0.1 * a),
    points0: Math.max(0, 0.2 + 1.6 * a - 0.4 * t),
  };
}

// ───────── 實驗事件 ─────────

export interface TechExpOption {
  id: string;
  label: string;
  desc: string;
  /** 額外花費（占這個專案費用的比例） */
  costPct: number;
  /** 品質點數 */
  points: number;
  /** 有這個機率出狀況，狀況時改加 riskPoints */
  riskP?: number;
  riskPoints?: number;
}
export interface TechExpDef {
  id: string;
  label: string;
  icon: string;
  text: string;
  options: TechExpOption[];
  /** 逾期（沒人處理）時的預設選項：最保守的 */
  defaultOption: string;
}

export const TECH_EXPERIMENTS: TechExpDef[] = [
  {
    id: "anomaly",
    label: "資料異常",
    icon: "📉",
    text: "中期的實驗數據出現無法解釋的偏差，研究員不確定是儀器問題還是真的發現。",
    options: [
      { id: "rerun", label: "重做一輪實驗", desc: "多花一點錢，數據更可靠。", costPct: 0.08, points: 1 },
      { id: "adjust", label: "調整參數繼續", desc: "不花錢，小幅改善。", costPct: 0, points: 0.4 },
      { id: "ignore", label: "當作雜訊忽略", desc: "省事，但有四成機率埋下隱患。", costPct: 0, points: 0, riskP: 0.4, riskPoints: -0.8 },
    ],
    defaultOption: "adjust",
  },
  {
    id: "equipment",
    label: "設備故障",
    icon: "🔧",
    text: "關鍵的實驗設備突然故障，進度卡住了。",
    options: [
      { id: "repair", label: "原廠緊急維修", desc: "貴，但修得徹底。", costPct: 0.1, points: 0.6 },
      { id: "borrow", label: "向其他單位借用", desc: "便宜、有點麻煩。", costPct: 0.04, points: 0.3 },
      { id: "push", label: "硬著頭皮用舊設備", desc: "不花錢，五成機率數據作廢。", costPct: 0, points: 0, riskP: 0.5, riskPoints: -1 },
    ],
    defaultOption: "borrow",
  },
  {
    id: "insight",
    label: "意外發現",
    icon: "💡",
    text: "研究員在實驗中發現一個意想不到的現象，可能是突破，也可能是死胡同。",
    options: [
      { id: "pursue", label: "追下去（賭一把）", desc: "五成機率大幅提升成果，五成機率白費力氣。", costPct: 0.05, points: 2.2, riskP: 0.5, riskPoints: -1.8 },
      { id: "safe", label: "記下來，照原計畫", desc: "穩穩的小幅加分。", costPct: 0, points: 0.5 },
    ],
    defaultOption: "safe",
  },
  {
    id: "team",
    label: "意見分歧",
    icon: "🗣️",
    text: "研究團隊對下一步的方向有不同的看法，各有各的道理。",
    options: [
      { id: "consult", label: "請外部顧問評估", desc: "花一點錢，方向更清楚。", costPct: 0.03, points: 0.7 },
      { id: "keep", label: "照主持人的決定", desc: "不花錢，維持現狀。", costPct: 0, points: 0.2 },
    ],
    defaultOption: "keep",
  },
];
export const TECH_EXP_BY_ID = Object.fromEntries(TECH_EXPERIMENTS.map((e) => [e.id, e])) as Record<string, TechExpDef>;

/** 實驗事件在專案進行到幾成時出現；逾期天數上限（tick） */
export const TECH_EXP_AT = 0.5;
export const TECH_EXP_MAX_TICKS = 144;

// ───────── 數據判讀（小遊戲） ─────────

export interface AnalysisQuestion {
  /** 帶雜訊的測量值 */
  series: number[];
  /** 0＝下降、1＝持平、2＝上升（由資料本身用迴歸斜率算出，client 與伺服器一致） */
  truth: 0 | 1 | 2;
}
export interface AnalysisLevel {
  questions: AnalysisQuestion[];
}

function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function trendOf(series: number[]): 0 | 1 | 2 {
  const n = series.length;
  const mx = (n - 1) / 2;
  const my = series.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (series[i]! - my);
    den += (i - mx) * (i - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  return slope > 0.45 ? 2 : slope < -0.45 ? 0 : 1;
}

export function makeAnalysisLevel(seed: number): AnalysisLevel {
  const r = stream(seed ^ 0x77aa11);
  const questions: AnalysisQuestion[] = [];
  for (let q = 0; q < 3; q++) {
    const want = [0, 1, 2][Math.floor(r() * 3)] as 0 | 1 | 2;
    const slope = want === 2 ? 1.1 + r() * 0.8 : want === 0 ? -(1.1 + r() * 0.8) : (r() - 0.5) * 0.3;
    const series: number[] = [];
    for (let i = 0; i < 16; i++) series.push(Math.round((50 + slope * i + (r() - 0.5) * 7) * 10) / 10);
    questions.push({ series, truth: trendOf(series) });
  }
  return { questions };
}

/** 判讀分數 0–1：答對題數比例；答案數量不對／不合法就算 0 */
export function scoreAnalysis(level: AnalysisLevel, answers: number[] | undefined): number {
  if (!Array.isArray(answers) || answers.length !== level.questions.length) return 0;
  let ok = 0;
  level.questions.forEach((q, i) => {
    if (answers[i] === q.truth) ok++;
  });
  return ok / level.questions.length;
}
export const ANALYSIS_MAX_POINTS = 1.2;

// ───────── 結案 ─────────

/** 結案等級：品質點數 + 一點運氣（luck 0–1）。超過 3.2 突破、1.8 優良 */
export function techGrade(points: number, luck: number): TechGrade {
  const score = points + (luck - 0.5) * 0.8;
  return score >= 3.2 ? 2 : score >= 1.8 ? 1 : 0;
}

export const TECH_GRADE_INFO: { label: string; icon: string; refund: number; skill: number; rep: number }[] = [
  { label: "勉強完成", icon: "🔬", refund: 0, skill: 0, rep: 0 },
  { label: "優良成果", icon: "🏅", refund: 0.1, skill: 1, rep: 0 },
  { label: "突破性成果", icon: "🏆", refund: 0.3, skill: 2, rep: 0.4 },
];
