import { createHash } from "node:crypto";
import {
  ACHIEVEMENTS,
  CLUES,
  DAILY_PICKS,
  GOALS,
  GOAL_BY_ID,
  PLACE_GUESS_COOLDOWN,
  PLACE_HASHES,
  PLACE_HASH_SALT,
  TEAM_EVENTS,
  TEAM_EVENT_BY_ID,
  TEAM_EVENT_GAP_DAYS,
  TEAM_EVENT_TICKS,
  TEAM_PARTIAL_RATIO,
  WEEKLY_PICKS,
  WEEK_BONUS_MULT,
  WEEK_DAYS,
  goalLabel,
  goalProgress,
  leaseEnabled,
  normalizeGuess,
  TICKS_PER_DAY,
  type GoalDef,
  type GoalPeriod,
  type MallState,
  type MetaState,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import type { GuestResult } from "./guests";
import { createRng, hash32 } from "./rng";
import { addLog, nextId } from "./state";
import type { TimeInfo } from "./time";

const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;
const MAX_LOG = 20;

export interface Actor {
  id: string;
  name: string;
}

function emptyPeriod(): GoalPeriod {
  return { key: -1, picks: [], base: {}, bonusPaid: false };
}

export function newMetaState(startTick: number): MetaState {
  return {
    startTick,
    tally: {},
    seen: {},
    day: emptyPeriod(),
    week: emptyPeriod(),
    team: { event: null, nextAt: startTick + 2 * TICKS_PER_DAY, size: 1, members: {} },
    achievements: {},
    clues: {},
    placeSolved: false,
    guesses: 0,
    lastGuessTick: -1_000_000,
    log: [],
  };
}

export function bump(s: MallState, key: string, n = 1): void {
  s.meta.tally[key] = (s.meta.tally[key] ?? 0) + n;
}

export function noteSeen(s: MallState, defId: string): void {
  s.meta.seen[defId] = (s.meta.seen[defId] ?? 0) + 1;
}

function metaLog(s: MallState, text: string): void {
  s.meta.log.unshift({ tick: s.tick, text });
  if (s.meta.log.length > MAX_LOG) s.meta.log.length = MAX_LOG;
  addLog(s, "info", text);
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

/** 近期平均：接待組數與日營收（沒有日報時給一個溫和的預設） */
export function recentAverages(s: MallState): { groups: number; revenue: number } {
  const rs = s.reports.slice(-7);
  if (rs.length === 0) return { groups: 800, revenue: 1_000_000 };
  return { groups: rs.reduce((a, r) => a + r.groups, 0) / rs.length, revenue: rs.reduce((a, r) => a + r.revenue + r.rentIncome, 0) / rs.length };
}

// ───────── 目標 ─────────
function pickGoals(s: MallState, scope: "day" | "week", key: number): GoalPeriod {
  const rng = createRng(hash32(s.seed ^ (scope === "day" ? 0x6a31 : 0x7b42), key));
  const avg = recentAverages(s);
  const pool = GOALS.filter((g) => g.scope === scope && (g.minLevel ?? 0) <= s.level && (g.needs !== "lease" || leaseEnabled(s)));
  const picks: GoalPeriod["picks"] = [];
  const want = scope === "day" ? DAILY_PICKS : WEEKLY_PICKS;
  const left = pool.slice();
  while (picks.length < want && left.length > 0) {
    const i = rng.int(0, left.length - 1);
    const def = left.splice(i, 1)[0] as GoalDef;
    let target = def.target ?? 0;
    if (!def.target) {
      const base = def.metric === "revenue" ? avg.revenue : avg.groups;
      target = Math.max(def.metric === "revenue" ? 100_000 : 10, Math.round(base * (def.scale ?? 1)));
      if (def.metric === "revenue") target = Math.round(target / 10_000) * 10_000;
    }
    picks.push({ id: def.id, target, reward: Math.max(10_000, Math.round((avg.revenue * def.ratio * 0.6) / 1000) * 1000), done: false });
  }
  return { key, picks, base: { ...s.meta.tally }, bonusPaid: false };
}

function settle(s: MallState, period: "day" | "week"): number {
  const p = period === "day" ? s.meta.day : s.meta.week;
  let done = 0;
  for (const pick of p.picks) {
    if (pick.done) {
      done++;
      continue;
    }
    const def = GOAL_BY_ID[pick.id];
    if (!def) continue;
    if (goalProgress(s, def, period) >= pick.target) {
      pick.done = true;
      done++;
      s.funds += pick.reward;
      bump(s, "goalsDone");
      applyIndexDelta(s, "localRep", period === "day" ? 0.1 : 0.3);
      metaLog(s, `🎯 達成目標：${goalLabel(def, pick.target)}（獎金 ${money(pick.reward)}）`);
    }
  }
  return done;
}

/** 建立商場（或升級舊存檔）時就先排好今天與本週的目標，不用等到第一次日結算 */
export function initGoals(s: MallState): void {
  const day = Math.floor(timeInfoDay(s.tick));
  if (s.meta.day.key < 0) s.meta.day = pickGoals(s, "day", day);
  if (s.meta.week.key < 0) s.meta.week = pickGoals(s, "week", Math.floor(day / WEEK_DAYS));
}

function timeInfoDay(tick: number): number {
  return Math.floor(((tick * 5 * 60_000) + 9 * 3_600_000) / 86_400_000);
}

/** 平日的目標在日結算時才驗收；即時達成的會在這之前就顯示完成，但獎金統一在此發放 */
function goalsDaily(s: MallState, time: TimeInfo): void {
  const m = s.meta;
  // 日目標驗收（今天的數據還在 s.today，沒有加進累計）
  settle(s, "day");
  // 週目標：到了週末才結算；全部達成有額外獎金
  const weekKey = Math.floor(time.day / WEEK_DAYS);
  const dayDone = m.day.picks.filter((p) => p.done).length;
  void dayDone;
  const weekEnding = m.week.key >= 0 && weekKey !== m.week.key;
  if (weekEnding || m.week.key < 0) {
    if (weekEnding) {
      // 把今天的接待與營收算進去再驗收
      const done = settle(s, "week");
      if (m.week.picks.length > 0 && done === m.week.picks.length && !m.week.bonusPaid) {
        const bonus = Math.round((m.week.picks.reduce((a, p) => a + p.reward, 0) * (WEEK_BONUS_MULT - 1)) / 1000) * 1000;
        s.funds += bonus;
        applyIndexDelta(s, "localRep", 0.5);
        applyIndexDelta(s, "touristHeat", 0.5);
        m.week.bonusPaid = true;
        metaLog(s, `🏅 本週目標全部達成！額外獎金 ${money(bonus)}`);
      }
    }
  }
  // 把「剛結束的這一天」計入累計
  bump(s, "groups", s.today.groups);
  bump(s, "revenue", s.today.revenue + s.today.rentIncome);
  bump(s, "regularVisits", s.today.regularVisits);
  // 開新的一天／一週
  m.day = pickGoals(s, "day", time.day);
  if (m.week.key !== weekKey) m.week = pickGoals(s, "week", weekKey);
}

// ───────── 團隊事件 ─────────
function teamDaily(s: MallState, time: TimeInfo): void {
  const t = s.meta.team;
  const ev = t.event;
  if (ev && ev.deadlineTick <= s.tick) {
    const def = TEAM_EVENT_BY_ID[ev.defId];
    const avg = recentAverages(s);
    if (def && ev.contributions.length > 0) {
      const reward = Math.round((avg.revenue * def.ratio * TEAM_PARTIAL_RATIO * (ev.contributions.length / ev.needed)) / 1000) * 1000;
      s.funds += reward;
      metaLog(s, `🧑‍🤝‍🧑「${def.title}」時間到：完成了 ${ev.contributions.length}／${ev.needed} 位的準備，獲得部分回饋 ${money(reward)}。`);
    } else if (def) {
      metaLog(s, `🧑‍🤝‍🧑「${def.title}」沒有人來得及準備，這次錯過了。`);
    }
    t.event = null;
    t.nextAt = s.tick + TEAM_EVENT_GAP_DAYS * TICKS_PER_DAY;
  }
  if (!t.event && s.tick >= t.nextAt) {
    const rng = createRng(hash32(s.seed ^ 0x4e3d, s.tick));
    const pool = TEAM_EVENTS.filter((e) => !e.months || e.months.includes(time.month));
    const def = pool[rng.int(0, Math.max(0, pool.length - 1))];
    if (def) {
      const needed = Math.max(1, Math.min(3, t.size));
      t.event = { uid: nextId(s, "te"), defId: def.id, startTick: s.tick, deadlineTick: s.tick + TEAM_EVENT_TICKS, needed, contributions: [] };
      metaLog(s, `${def.icon} 團隊事件：${def.title}！需要 ${needed} 位隊員各認領一項任務。`);
    } else t.nextAt = s.tick + TICKS_PER_DAY;
  }
}

export function contribute(s: MallState, taskId: string, actor: Actor | undefined): GuestResult {
  const ev = s.meta.team.event;
  const def = ev && TEAM_EVENT_BY_ID[ev.defId];
  if (!ev || !def) return { ok: false, error: "現在沒有需要團隊合作的事件" };
  if (!actor) return { ok: false, error: "需要登入身分" };
  const task = def.tasks.find((x) => x.id === taskId);
  if (!task) return { ok: false, error: "找不到這項任務" };
  if (ev.contributions.some((c) => c.taskId === taskId)) return { ok: false, error: "這項任務已經有人認領了" };
  if (ev.contributions.some((c) => c.actorId === actor.id)) return { ok: false, error: "你已經認領過一項了，把其他的留給隊友吧" };
  if (s.funds < task.cost) return { ok: false, error: "資金不足" };
  s.funds -= task.cost;
  s.today.purchases += task.cost;
  ev.contributions.push({ taskId, actorId: actor.id, name: actor.name, tick: s.tick });
  const m = (s.meta.team.members[actor.id] ??= { name: actor.name, actions: 0, tasks: 0, lastTick: s.tick });
  m.tasks++;
  addLog(s, "info", `🧑‍🤝‍🧑 ${actor.name} 認領了「${task.label}」（${ev.contributions.length}／${ev.needed}）。`);
  if (ev.contributions.length >= ev.needed) {
    const avg = recentAverages(s);
    const reward = Math.round((avg.revenue * def.ratio) / 1000) * 1000;
    s.funds += reward;
    applyIndexDelta(s, "localRep", def.idx / 2);
    applyIndexDelta(s, "touristHeat", def.idx / 2);
    bump(s, "teamDone");
    s.meta.team.event = null;
    s.meta.team.nextAt = s.tick + TEAM_EVENT_GAP_DAYS * TICKS_PER_DAY;
    metaLog(s, `🎉「${def.title}」大家分工完成了！獲得 ${money(reward)} 與口碑加成。`);
    return { ok: true, note: "團隊事件完成！" };
  }
  return { ok: true, note: `已認領「${task.label}」` };
}

/** 記下每位隊員做了多少事（貢獻榜只列貢獻，不做負面比較） */
export function trackActor(s: MallState, actor: Actor | undefined, cmdType: string): void {
  if (!actor || cmdType === "touch") return;
  const m = (s.meta.team.members[actor.id] ??= { name: actor.name, actions: 0, tasks: 0, lastTick: s.tick });
  m.name = actor.name;
  m.actions++;
  m.lastTick = s.tick;
}

// ───────── 成就與線索 ─────────
function achievementsAndClues(s: MallState): void {
  for (const a of ACHIEVEMENTS) {
    if (s.meta.achievements[a.id] !== undefined) continue;
    let ok = false;
    try {
      ok = a.check(s);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    s.meta.achievements[a.id] = s.tick;
    if (a.reward) s.funds += a.reward;
    metaLog(s, `🏆 成就解鎖：${a.icon}「${a.name}」${a.reward ? `（獎金 ${money(a.reward)}）` : ""}${a.title ? `，獲得稱號「${a.title}」` : ""}`);
  }
  for (const c of CLUES) {
    if (s.meta.clues[c.id] !== undefined) continue;
    let ok = false;
    try {
      ok = c.when(s);
    } catch {
      ok = false;
    }
    if (ok) {
      s.meta.clues[c.id] = s.tick;
      addLog(s, "info", `🔎 發現一則線索：${c.icon} ${c.text.slice(0, 24)}…`);
    }
  }
}

/** 日結算（要在各店的當日統計重置之前呼叫） */
export function metaDaily(s: MallState, time: TimeInfo): void {
  goalsDaily(s, time);
  teamDaily(s, time);
  achievementsAndClues(s);
}

// ───────── 猜地點 ─────────
export function placeHash(text: string): string {
  return createHash("sha256").update(PLACE_HASH_SALT + normalizeGuess(text)).digest("hex").slice(0, 24);
}

export function guessPlace(s: MallState, text: string): GuestResult {
  const m = s.meta;
  if (m.placeSolved) return { ok: false, error: "你已經猜中了！" };
  if (typeof text !== "string" || text.trim().length < 2) return { ok: false, error: "請輸入你的猜測" };
  if (s.tick < m.lastGuessTick + PLACE_GUESS_COOLDOWN) return { ok: false, error: "剛猜過，隔一個遊戲日再來，順便多收集幾則線索" };
  m.lastGuessTick = s.tick;
  m.guesses++;
  if (PLACE_HASHES.includes(placeHash(text))) {
    m.placeSolved = true;
    achievementsAndClues(s);
    return { ok: true, note: "猜對了！你一定很熟這個地方。" };
  }
  return { ok: true, note: "還沒猜中。再多留意線索吧，答案其實就藏在日常的細節裡。" };
}
