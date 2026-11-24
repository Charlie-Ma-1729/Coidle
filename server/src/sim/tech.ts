import { REFRESH_COST, REFRESH_GAIN, TECH_BY_ID, TECH_CANCEL_REFUND, techBlocker, techFx, type MallState, type TechState } from "@coidle/shared";
import { applyIndexDelta } from "./events";
import type { GuestResult } from "./guests";
import { prepareInspection } from "./inspections";
import { bump } from "./meta";
import { addLog } from "./state";

const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

export function newTechState(): TechState {
  return { done: [], jobs: [] };
}

export function startTech(s: MallState, id: string): GuestResult {
  const def = TECH_BY_ID[id];
  if (!def) return { ok: false, error: "找不到這項科技" };
  const why = techBlocker(s, def);
  if (why) return { ok: false, error: why };
  if (s.funds < def.cost) return { ok: false, error: "資金不足" };
  s.funds -= def.cost;
  s.today.purchases += def.cost;
  s.tech.jobs.push({ id, startTick: s.tick, endTick: s.tick + def.ticks, cost: def.cost });
  addLog(s, "info", `🔬 開始研發「${def.name}」（${money(def.cost)}）。`);
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

/** 每個 tick：研發到期的科技完成 */
export function techTick(s: MallState): void {
  if (s.tech.jobs.length === 0) return;
  const due = s.tech.jobs.filter((j) => j.endTick <= s.tick);
  if (due.length === 0) return;
  s.tech.jobs = s.tech.jobs.filter((j) => j.endTick > s.tick);
  for (const j of due) {
    if (s.tech.done.includes(j.id)) continue;
    s.tech.done.push(j.id);
    bump(s, "techs");
    const def = TECH_BY_ID[j.id];
    addLog(s, "info", `🔬 科技研發完成：${def?.icon ?? ""}「${def?.name ?? j.id}」！`);
    if (s.today.systemNotes.length < 8) s.today.systemNotes.push(`研發完成：${def?.name ?? j.id}`);
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
