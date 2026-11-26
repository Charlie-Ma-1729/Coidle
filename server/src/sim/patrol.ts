import {
  FIX_OPTIONS,
  PATROL_CLEARED_DAYS,
  PATROL_COOLDOWN_TICKS,
  PATROL_ESCALATE_DAYS,
  PATROL_INCIDENT_DAYS,
  PATROL_INCIDENT_GAP_DAYS,
  PATROL_KINDS,
  PATROL_MAX_ISSUES,
  PATROL_MAX_ISSUES_PER_SHOP,
  PATROL_SCHEDULE_DAYS,
  PATROL_SESSION_TICKS,
  PATROL_SPOTS,
  TICKS_PER_DAY,
  detectChance,
  fixCost,
  newPatrolState,
  patrolAp,
  patrolKindsFor,
  spotsOf,
  type FixOption,
  type MallState,
  type PatrolIssue,
  type PatrolState,
  type Shop,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import { chatVoiceFor } from "./guests";
import { openCase } from "./legal";
import { createRng, hash32, type Rng } from "./rng";
import { addLog, nextId } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;
const digits = (id: string) => Number(id.replace(/\D/g, "")) || 0;

export type PatrolResult = { ok: true; note: string } | { ok: false; error: string };

export function patrolOf(s: MallState): PatrolState {
  if (!s.patrol) s.patrol = newPatrolState();
  return s.patrol;
}

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

const keyOf = (shopId: string, spot: string) => `${shopId}:${spot}`;
const shopOf = (s: MallState, id: string) => s.shops.find((x) => x.id === id);

// ───────── 一趟巡店 ─────────

/** 這趟的時間到了就自動收工 */
function expireSession(s: MallState): void {
  const p = s.patrol;
  if (p?.session && p.session.expireTick <= s.tick) endPatrol(s);
}

export function startPatrol(s: MallState, open: boolean): PatrolResult {
  const p = patrolOf(s);
  expireSession(s);
  if (p.session) return { ok: false, error: "已經在巡店了" };
  if (!open) return { ok: false, error: "商場打烊中，沒有什麼好巡的" };
  if (s.tick < p.nextTick) return { ok: false, error: "剛巡完，讓店面運轉一下再來" };
  const direct = s.shops.filter((x) => x.mode === "direct" && x.tenant === null && x.closedUntilTick <= s.tick);
  if (direct.length === 0) return { ok: false, error: "現在沒有營業中的直營店" };
  const soon = s.inspections.pending.length > 0;
  const ap = patrolAp(p.xp, soon);
  p.session = { startTick: s.tick, expireTick: s.tick + PATROL_SESSION_TICKS, ap, apMax: ap, checked: [], chats: 0, found: 0, fixed: 0, spent: 0 };
  return { ok: true, note: `開始巡店：這趟有 ${ap} 點行動力${soon ? "（稽查將至，多 1 點）" : ""}。` };
}

function needSession(s: MallState): PatrolResult | null {
  expireSession(s);
  const p = patrolOf(s);
  if (!p.session) return { ok: false, error: "還沒開始巡店（或這趟的時間到了）" };
  if (p.session.ap < 1) return { ok: false, error: "行動力用完了，結束這趟吧" };
  return null;
}

/** 檢查某間店的一個點：花 1 點行動力，有機率發現藏在那裡的問題 */
export function inspectSpot(s: MallState, shopId: string, spot: string): PatrolResult {
  const bad = needSession(s);
  if (bad) return bad;
  const p = patrolOf(s);
  const sess = p.session!;
  const shop = shopOf(s, shopId);
  if (!shop || shop.mode !== "direct" || shop.tenant !== null) return { ok: false, error: "只能巡直營店" };
  if (!spotsOf(shop.category).includes(spot) || !PATROL_SPOTS[spot]) return { ok: false, error: "這間店沒有這個檢查點" };
  const key = keyOf(shopId, spot);
  if (sess.checked.includes(key)) return { ok: false, error: "這個點這趟已經檢查過了" };
  sess.ap--;
  sess.checked.push(key);
  p.xp += 1;
  const label = `${shop.name}・${PATROL_SPOTS[spot]!.label}`;
  const here = p.issues.filter((i) => i.shopId === shopId && i.spot === spot);
  if (here.length === 0) return { ok: true, note: `${label}：看起來沒有問題。` };
  const rng = createRng(hash32(s.seed ^ 0x9a7, digits(shopId) * 131 + spot.length * 17 + s.tick));
  const lines: string[] = [];
  for (const i of here) {
    if (i.status !== "hidden") {
      lines.push(i.status === "hinted" ? "這裡已經有線索了，可以花 1 點「查明」。" : "這裡的問題你已經知道了。");
      continue;
    }
    if (rng.next() < detectChance(i.severity, p.xp)) {
      i.status = "hinted";
      const def = PATROL_KINDS[i.kind];
      i.hint = def ? def.hints[i.severity >= 3 ? 1 : 0] : "有點怪怪的。";
      p.foundTotal++;
      sess.found++;
      p.xp += 3;
      lines.push(`發現線索：${i.hint}`);
    }
  }
  if (lines.length === 0) return { ok: true, note: `${label}：看起來沒有問題。` };
  return { ok: true, note: `${label}：${lines.join(" ")}` };
}

/** 查明一個有線索的問題：花 1 點行動力，知道是什麼、有多嚴重 */
export function deepenIssue(s: MallState, uid: string): PatrolResult {
  const bad = needSession(s);
  if (bad) return bad;
  const p = patrolOf(s);
  const issue = p.issues.find((i) => i.uid === uid);
  if (!issue || issue.status === "hidden") return { ok: false, error: "找不到這個問題" };
  if (issue.status !== "hinted") return { ok: false, error: "這個問題已經查明了" };
  const def = PATROL_KINDS[issue.kind];
  if (!def) return { ok: false, error: "找不到這個問題" };
  p.session!.ap--;
  issue.status = "confirmed";
  p.xp += 2;
  const shop = shopOf(s, issue.shopId);
  return { ok: true, note: `查明了：${shop?.name ?? "某店"}的「${def.label}」（嚴重度 ${issue.severity}／5）。${def.detail}` };
}

/** 和客人聊聊：花 1 點行動力，聽一則客人的心聲（接著用「巡場」的做法處理） */
export function chatShop(s: MallState, shopId: string, rng: Rng): PatrolResult {
  const bad = needSession(s);
  if (bad) return bad;
  const p = patrolOf(s);
  const shop = shopOf(s, shopId);
  if (!shop || shop.closedUntilTick > s.tick) return { ok: false, error: "這間店現在沒有客人" };
  const v = chatVoiceFor(s, rng, shop);
  if (!v) return { ok: false, error: "沒什麼好聊的" };
  p.session!.ap--;
  p.session!.chats++;
  p.xp += 1;
  s.walk.voices = [v, ...s.walk.voices.filter((x) => x.expireTick >= s.tick)].slice(0, 8);
  return { ok: true, note: `聽到一位客人的心聲：${v.text}` };
}

/** 處理一個查明的問題：立刻、排程或請專業 */
export function fixIssue(s: MallState, uid: string, option: string): PatrolResult {
  expireSession(s);
  const p = patrolOf(s);
  const issue = p.issues.find((i) => i.uid === uid);
  if (!issue || issue.status === "hidden") return { ok: false, error: "找不到這個問題" };
  if (issue.status === "hinted") return { ok: false, error: "先花 1 點行動力查明這是什麼問題" };
  if (issue.status === "scheduled") return { ok: false, error: "已經排程處理了" };
  if (!FIX_OPTIONS.some((o) => o.id === option)) return { ok: false, error: "處理方式無效" };
  const opt = option as FixOption;
  const def = PATROL_KINDS[issue.kind];
  const shop = shopOf(s, issue.shopId);
  if (!def || !shop) {
    p.issues = p.issues.filter((i) => i.uid !== uid);
    return { ok: false, error: "那間店已經不在了" };
  }
  const cost = fixCost(issue.kind, issue.severity, opt);
  if (cost > s.funds) return { ok: false, error: "資金不足" };
  s.funds -= cost;
  s.today.repairs += cost;
  if (p.session) {
    p.session.spent += cost;
    p.session.fixed++;
  }
  p.xp += 2;
  if (opt === "schedule") {
    issue.status = "scheduled";
    issue.fixTick = s.tick + PATROL_SCHEDULE_DAYS * TICKS_PER_DAY;
    addLog(s, "info", `🔧 「${shop.name}」的「${def.label}」已排程處理（${money(cost)}）。`);
    return { ok: true, note: `已排程：${PATROL_SCHEDULE_DAYS} 天後處理好（${money(cost)}）。` };
  }
  resolveIssue(s, issue, opt === "pro" ? PATROL_CLEARED_DAYS.pro : PATROL_CLEARED_DAYS.now);
  if (opt === "pro" && s.inspections) s.inspections.compliance = clamp(s.inspections.compliance + 2, 0, 100);
  addLog(s, "info", `🔧 處理了「${shop.name}」的「${def.label}」（${money(cost)}）。`);
  return { ok: true, note: `${opt === "pro" ? "請專業人員根治" : "立刻處理好"}了（${money(cost)}）。` };
}

function resolveIssue(s: MallState, issue: PatrolIssue, clearedDays: number): void {
  const p = patrolOf(s);
  p.issues = p.issues.filter((i) => i.uid !== issue.uid);
  p.fixedTotal++;
  p.cleared[keyOf(issue.shopId, issue.spot)] = s.tick + clearedDays * TICKS_PER_DAY;
}

export function endPatrol(s: MallState): PatrolResult {
  const p = patrolOf(s);
  const sess = p.session;
  if (!sess) return { ok: false, error: "沒有在巡店" };
  const open = p.issues.filter((i) => i.status === "confirmed" || i.status === "hinted").length;
  p.report = { tick: s.tick, checked: sess.checked.length, found: sess.found, fixed: sess.fixed, spent: sess.spent, open };
  p.session = null;
  p.nextTick = s.tick + PATROL_COOLDOWN_TICKS;
  const text = `🚶 巡店結束：檢查了 ${sess.checked.length} 個點、發現 ${sess.found} 個問題、處理 ${sess.fixed} 件${sess.spent > 0 ? `（花 ${money(sess.spent)}）` : ""}，還有 ${open} 件沒處理。`;
  addLog(s, "info", text);
  return { ok: true, note: text };
}

// ───────── 每天：問題冒出來、惡化、變成事故 ─────────

function forceInspection(s: MallState, kind: "hygiene" | "fire"): void {
  const cur = s.inspections.nextAt[kind];
  const soon = s.tick + 144;
  if (cur === undefined || cur > soon) s.inspections.nextAt[kind] = soon;
}

function runIncident(s: MallState, issue: PatrolIssue, shop: Shop, rng: Rng): void {
  const def = PATROL_KINDS[issue.kind];
  if (!def) return;
  const inc = def.incident;
  // 對現金流友善：事故的罰款與修理費最多拿走帳上資金的一半，沒錢（資金為負）就只剩口碑與停業的損失，不會把商場推進死亡螺旋
  let budget = Math.max(0, s.funds * 0.5);
  const pay = (amount: number) => {
    const x = Math.min(amount, budget);
    budget -= x;
    s.funds -= x;
    s.today.repairs += x;
  };
  if (inc.fine) pay(inc.fine);
  if (inc.repair) pay(inc.repair);
  if (inc.rep) applyIndexDelta(s, "localRep", inc.rep);
  if (inc.closeTicks) shop.closedUntilTick = Math.max(shop.closedUntilTick, s.tick + inc.closeTicks);
  if (inc.stockLossPct) shop.stock = Math.max(0, Math.floor(shop.stock * (1 - inc.stockLossPct)));
  if (inc.inspect) forceInspection(s, inc.inspect);
  if (inc.legal && rng.chance(inc.legal.p)) openCase(s, rng, shop, inc.legal.kind, null);
  patrolOf(s).incidents++;
  const text = `🚨 「${shop.name}」的「${def.label}」沒有及時處理，釀成事故：${inc.text}`;
  addLog(s, "warn", text);
  note(s, text);
}

/** 每日：排程完成、未處理的問題造成影響與惡化、冒出新問題、收掉逾時的巡店 */
export function patrolDaily(s: MallState): void {
  const p = patrolOf(s);
  expireSession(s);
  for (const [k, t] of Object.entries(p.cleared)) if (t <= s.tick) delete p.cleared[k];
  const rng = createRng(hash32(s.seed ^ 0x9a7701, s.tick));

  // 全館清潔度與設備狀態的損耗是所有問題加總，打折並設每日上限（館內有清潔與維護人員在補，不會一路崩到底）
  let dClean = 0;
  let dEquip = 0;
  for (const issue of p.issues.slice()) {
    const shop = shopOf(s, issue.shopId);
    const def = PATROL_KINDS[issue.kind];
    if (!shop || !def) {
      p.issues = p.issues.filter((x) => x.uid !== issue.uid);
      continue;
    }
    if (issue.status === "scheduled" && issue.fixTick !== undefined && issue.fixTick <= s.tick) {
      resolveIssue(s, issue, PATROL_CLEARED_DAYS.schedule);
      addLog(s, "info", `🔧 「${shop.name}」的「${def.label}」已經處理好了。`);
      continue;
    }
    // 沒處理的影響
    const sev = issue.severity;
    const e = def.daily;
    if (e.clean) dClean += e.clean * sev;
    if (e.equip) dEquip += e.equip * sev;
    if (e.fresh) shop.freshness = clamp(shop.freshness + e.fresh * sev, 0, 100);
    if (e.rep) applyIndexDelta(s, "localRep", e.rep * sev);
    if (e.stockLoss && shop.stock > 0) shop.stock = Math.max(0, shop.stock - Math.floor(shop.stock * e.stockLoss * sev));
    if (issue.status === "scheduled") continue; // 排程中的不再惡化
    if (issue.severity < 5 && s.tick - issue.worsenedTick >= PATROL_ESCALATE_DAYS * TICKS_PER_DAY) {
      issue.severity++;
      issue.worsenedTick = s.tick;
    } else if (issue.severity >= 5 && s.tick - issue.worsenedTick >= PATROL_INCIDENT_DAYS * TICKS_PER_DAY && s.tick >= (p.nextIncident ?? 0)) {
      p.nextIncident = s.tick + PATROL_INCIDENT_GAP_DAYS * TICKS_PER_DAY;
      p.issues = p.issues.filter((x) => x.uid !== issue.uid);
      p.cleared[keyOf(issue.shopId, issue.spot)] = s.tick + PATROL_CLEARED_DAYS.now * TICKS_PER_DAY;
      runIncident(s, issue, shop, rng);
    }
  }

  s.cleanliness = clamp(s.cleanliness + Math.max(-2, dClean * 0.35), 0, 100);
  s.equipment = clamp(s.equipment + Math.max(-2, dEquip * 0.35), 0, 100);

  // 新問題：管理越鬆散越容易冒出來
  if (p.issues.length >= PATROL_MAX_ISSUES) return;
  const dirty = Math.max(0, (50 - s.cleanliness) / 50);
  const worn = Math.max(0, (50 - s.equipment) / 50);
  const lax = Math.max(0, (50 - (s.inspections?.compliance ?? 60)) / 50);
  let spawned = 0;
  for (const shop of s.shops) {
    if (spawned >= 2 || p.issues.length >= PATROL_MAX_ISSUES) break;
    if (shop.mode !== "direct" || shop.tenant !== null || shop.closedUntilTick > s.tick) continue;
    if (p.issues.filter((i) => i.shopId === shop.id).length >= PATROL_MAX_ISSUES_PER_SHOP) continue;
    if (!rng.chance(0.018 + 0.03 * dirty + 0.025 * worn + 0.015 * lax)) continue;
    const mySpots = spotsOf(shop.category);
    const free = (spot: string) => !p.issues.some((i) => i.shopId === shop.id && i.spot === spot) && (p.cleared[keyOf(shop.id, spot)] ?? 0) <= s.tick;
    const kinds = patrolKindsFor(shop.category).filter((k) => k.spots.some((sp) => mySpots.includes(sp) && free(sp)));
    const kind = kinds[rng.weighted(kinds.map((k) => k.weight))];
    if (!kind) continue;
    const spots = kind.spots.filter((sp) => mySpots.includes(sp) && free(sp));
    const spot = spots[rng.int(0, spots.length - 1)];
    if (!spot) continue;
    p.issues.push({ uid: nextId(s, "pi"), kind: kind.id, shopId: shop.id, spot, severity: lax > 0.3 ? 2 : 1, bornTick: s.tick, worsenedTick: s.tick, status: "hidden" });
    spawned++;
  }
}
