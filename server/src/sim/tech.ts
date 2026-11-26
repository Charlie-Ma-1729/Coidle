import {
  ANALYSIS_MAX_POINTS,
  REFRESH_COST,
  REFRESH_GAIN,
  TECH_BY_ID,
  TECH_CANCEL_REFUND,
  TECH_EXPERIMENTS,
  TECH_EXP_AT,
  TECH_EXP_BY_ID,
  TECH_EXP_MAX_TICKS,
  TECH_GRADE_INFO,
  makeAnalysisLevel,
  nextPlaySeed,
  normalizePlan,
  planEffects,
  scoreAnalysis,
  techBlocker,
  techFx,
  techGrade,
  type MallState,
  type TechExpOption,
  type TechJob,
  type TechPlan,
  type TechState,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import type { GuestResult } from "./guests";
import { prepareInspection } from "./inspections";
import { bump } from "./meta";
import { createRng, hash32 } from "./rng";
import { addLog, nextId } from "./state";

const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;
const hashId = (id: string) => [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

export function newTechState(): TechState {
  return { done: [], jobs: [] };
}

/** 立項：用滑桿分配資源（速度／嚴謹／節約）。沒給配置就用標準配置（標準時間與費用） */
export function startTech(s: MallState, id: string, planIn?: Partial<TechPlan>): GuestResult {
  const def = TECH_BY_ID[id];
  if (!def) return { ok: false, error: "找不到這項科技" };
  const why = techBlocker(s, def);
  if (why) return { ok: false, error: why };
  const plan = normalizePlan(planIn);
  // 沒設定配置＝標準做法：時間與費用和以前一模一樣
  const eff = planIn ? planEffects(plan) : { ticksMult: 1, costMult: 1, points0: planEffects(plan).points0 };
  const cost = planIn ? Math.round((def.cost * eff.costMult) / 1000) * 1000 : def.cost;
  const ticks = Math.max(1, Math.round(def.ticks * eff.ticksMult));
  if (s.funds < cost) return { ok: false, error: "資金不足" };
  s.funds -= cost;
  s.today.purchases += cost;
  const job: TechJob = {
    id,
    startTick: s.tick,
    endTick: s.tick + ticks,
    cost,
    plan,
    points: Math.round(eff.points0 * 100) / 100,
    exp: null,
    expDone: false,
    seed: nextPlaySeed(s.seed ^ 0x7ec41, (s.tick + hashId(id)) >>> 0),
  };
  s.tech.jobs.push(job);
  addLog(s, "info", `🔬 開始研發「${def.name}」（${money(cost)}，速度 ${plan.speed}／嚴謹 ${plan.rigor}／節約 ${plan.thrift}）。`);
  return { ok: true, note: `開始研發「${def.name}」` };
}

export function cancelTech(s: MallState, id: string): GuestResult {
  const i = s.tech.jobs.findIndex((j) => j.id === id);
  const job = s.tech.jobs[i];
  if (!job) return { ok: false, error: "這項科技沒有在研發" };
  const refund = Math.round(job.cost * TECH_CANCEL_REFUND);
  s.funds += refund;
  s.tech.jobs.splice(i, 1);
  return { ok: true, note: `取消研發，退回 ${money(refund)}` };
}

function settleWith(s: MallState, job: TechJob, label: string, opt: TechExpOption, cost: number, analysis?: number[]): GuestResult {
  if (cost > 0) {
    s.funds -= cost;
    s.today.purchases += cost;
  }
  const rng = createRng(hash32(s.seed ^ 0x7ec9, (job.startTick + hashId(job.id)) >>> 0));
  const risky = opt.riskP !== undefined && rng.chance(opt.riskP);
  let pts = risky ? (opt.riskPoints ?? 0) : opt.points;
  let note = `${opt.label}${risky ? "——運氣不好，出了狀況" : ""}`;
  if (analysis !== undefined && job.seed !== undefined) {
    const sc = scoreAnalysis(makeAnalysisLevel(job.seed), analysis);
    pts += sc * ANALYSIS_MAX_POINTS;
    note += `；數據判讀 ${Math.round(sc * 100)} 分`;
  }
  job.points = Math.max(0, Math.round(((job.points ?? 0) + pts) * 100) / 100);
  job.exp = null;
  job.expDone = true;
  const def = TECH_BY_ID[job.id];
  addLog(s, "info", `🔬 「${def?.name ?? job.id}」的實驗事件（${label}）：${note}${cost > 0 ? `（花 ${money(cost)}）` : ""}。`);
  return { ok: true, note };
}

/** 結算一個實驗事件（optionId 為 null＝逾期，走最保守的預設）。analysis＝數據判讀的答案 */
function settleExperiment(s: MallState, job: TechJob, optionId: string | null, analysis?: number[]): GuestResult {
  const exp = job.exp;
  const def = exp ? TECH_EXP_BY_ID[exp.kind] : undefined;
  if (!exp || !def) return { ok: false, error: "這個專案現在沒有需要處理的實驗事件" };
  const opt = def.options.find((o) => o.id === (optionId ?? def.defaultOption));
  if (!opt) return { ok: false, error: "處理方式無效" };
  const cost = Math.round(job.cost * opt.costPct);
  if (cost > s.funds) {
    if (optionId !== null) return { ok: false, error: "資金不足" };
    // 逾期又沒錢：退回不花錢、而且沒有風險的選項（沒有就隨便一個不花錢的）
    const free = def.options.filter((o) => o.costPct === 0).sort((a, b) => (a.riskP ? 1 : 0) - (b.riskP ? 1 : 0))[0];
    if (!free) return { ok: false, error: "資金不足" };
    return settleWith(s, job, def.label, free, 0, analysis);
  }
  return settleWith(s, job, def.label, opt, cost, analysis);
}

/** 玩家處理實驗事件，可附上數據判讀的答案 */
export function techExperiment(s: MallState, id: string, optionId: string, analysis?: number[]): GuestResult {
  const job = s.tech.jobs.find((j) => j.id === id);
  if (!job) return { ok: false, error: "這項科技沒有在研發" };
  if (analysis !== undefined && (!Array.isArray(analysis) || analysis.length > 8 || analysis.some((x) => !Number.isInteger(x)))) return { ok: false, error: "判讀答案無效" };
  return settleExperiment(s, job, optionId, analysis);
}

/** 每個 tick：實驗事件出現／逾期、研發到期的科技結案 */
export function techTick(s: MallState): void {
  if (s.tech.jobs.length === 0) return;
  for (const job of s.tech.jobs) {
    if (job.exp && job.exp.deadlineTick <= s.tick) {
      const def = TECH_BY_ID[job.id];
      settleExperiment(s, job, null);
      addLog(s, "info", `🔬 「${def?.name ?? job.id}」的實驗事件沒人處理，依最保守的做法收尾了。`);
    }
    if (!job.expDone && !job.exp && job.endTick > s.tick) {
      const progress = (s.tick - job.startTick) / Math.max(1, job.endTick - job.startTick);
      if (progress >= TECH_EXP_AT && job.endTick - s.tick > 24) {
        const rng = createRng(hash32(s.seed ^ 0x7ec2, (job.startTick + hashId(job.id)) >>> 0));
        const kind = TECH_EXPERIMENTS[rng.int(0, TECH_EXPERIMENTS.length - 1)]!;
        const left = job.endTick - s.tick;
        job.exp = { uid: nextId(s, "tx"), kind: kind.id, deadlineTick: s.tick + Math.max(24, Math.min(TECH_EXP_MAX_TICKS, Math.floor(left * 0.45))) };
        const tdef = TECH_BY_ID[job.id];
        const text = `${kind.icon} 「${tdef?.name ?? job.id}」的研究遇到狀況：${kind.label}。要你決定怎麼處理。`;
        addLog(s, "warn", text);
        if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
      }
    }
  }
  const due = s.tech.jobs.filter((j) => j.endTick <= s.tick);
  if (due.length === 0) return;
  s.tech.jobs = s.tech.jobs.filter((j) => j.endTick > s.tick);
  for (const j of due) {
    if (s.tech.done.includes(j.id)) continue;
    // 還有沒處理的實驗事件：先依預設收尾
    if (j.exp) settleExperiment(s, j, null);
    s.tech.done.push(j.id);
    bump(s, "techs");
    const def = TECH_BY_ID[j.id];
    const luck = createRng(hash32(s.seed ^ 0x7ec3, (j.startTick + hashId(j.id)) >>> 0)).next();
    const grade = techGrade(j.points ?? 0, luck);
    if (!s.tech.grades) s.tech.grades = {};
    s.tech.grades[j.id] = grade;
    const info = TECH_GRADE_INFO[grade]!;
    if (info.refund > 0) s.funds += Math.round(j.cost * info.refund);
    if (info.skill > 0) for (const shop of s.shops) if (shop.mode === "direct") s.workshop.skill[shop.id] = (s.workshop.skill[shop.id] ?? 0) + info.skill;
    if (info.rep > 0) applyIndexDelta(s, "localRep", info.rep);
    const extra = grade === 0 ? "" : `${info.refund > 0 ? `，退回 ${money(j.cost * info.refund)}` : ""}${info.skill > 0 ? `，研究團隊的經驗讓所有直營店的廚藝經驗 +${info.skill}` : ""}`;
    addLog(s, "info", `🔬 科技研發完成：${def?.icon ?? ""}「${def?.name ?? j.id}」——${info.icon} ${info.label}${extra}！`);
    if (s.today.systemNotes.length < 8) s.today.systemNotes.push(`研發完成：${def?.name ?? j.id}（${info.label}）`);
  }
}

/** 每日：永續類科技帶來的口碑；AI 副手自動更新菜單 */
export function techDaily(s: MallState): void {
  const fx = techFx(s.tech.done);
  if (fx.dailyIdx.localRep) applyIndexDelta(s, "localRep", fx.dailyIdx.localRep);
  if (fx.dailyIdx.touristHeat) applyIndexDelta(s, "touristHeat", fx.dailyIdx.touristHeat);
  if (fx.autoRefresh) {
    for (const shop of s.shops) {
      if (shop.mode !== "direct" || shop.freshness >= 50) continue;
      const cost = REFRESH_COST * shop.level;
      if (s.funds < cost * 3) continue;
      s.funds -= cost;
      s.today.purchases += cost;
      shop.freshness = Math.min(100, shop.freshness + REFRESH_GAIN);
      addLog(s, "info", `🧠 AI 副手替「${shop.name}」推出了新菜單／新活動。`);
    }
  }
}

/** AI 副手：稽查預告一來就自動全力備戰（錢不夠就退一級） */
export function techAutoInspection(s: MallState, uid: string): boolean {
  if (!techFx(s.tech.done).autoInspection) return false;
  for (const level of ["full", "basic"] as const) {
    if (prepareInspection(s, uid, level).ok) {
      addLog(s, "info", `🧠 AI 副手已為稽查做好${level === "full" ? "全力" : "基本"}準備。`);
      return true;
    }
  }
  return false;
}
