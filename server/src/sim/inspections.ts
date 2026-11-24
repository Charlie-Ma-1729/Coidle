import {
  CATEGORY_BY_ID,
  DEFAULT_PREP,
  INSPECTIONS,
  INSPECTION_MEAN_DAYS,
  INSPECTION_NOTICE_MAX_TICKS,
  INSPECTION_NOTICE_MIN_TICKS,
  INSPECTION_SURPRISE_RATE,
  MAX_INSPECTION_LOG,
  OUTCOME_INFO,
  SUSPEND_TICKS,
  inspectionOutcome,
  inspectionScore,
  prepOption,
  type InspectionKind,
  type InspectionNotice,
  type InspectionPrep,
  type MallState,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import type { GuestResult } from "./guests";
import type { Rng } from "./rng";
import { addLog, nextId } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const KINDS: InspectionKind[] = ["hygiene", "fire"];
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

function hasFoodShop(s: MallState): boolean {
  return s.shops.some((x) => x.mode === "direct" && CATEGORY_BY_ID[x.category]?.group === "food");
}

/**
 * 沒人在場時，這次稽查值不值得讓時鐘暫停等人？
 * 只有「照預設做基本整理，結果仍會被警告以上處分」才值得——狀況好的商場放著不管也會合格，不必打擾。
 */
export function inspectionAtRisk(s: MallState, kind: InspectionKind): boolean {
  const opt = prepOption(DEFAULT_PREP);
  const afford = s.funds >= opt.cost;
  const clean = clamp(s.cleanliness + (afford ? opt.clean : 0), 0, 100);
  const equip = clamp(s.equipment + (afford ? opt.equip : 0), 0, 100);
  return inspectionScore(kind, clean, equip) < 60;
}

/** 把備戰的效果與費用實際套用（呼叫端已確認資金夠） */
function applyPrep(s: MallState, level: InspectionPrep): void {
  const opt = prepOption(level);
  s.funds -= opt.cost;
  s.today.purchases += opt.cost;
  s.cleanliness = clamp(s.cleanliness + opt.clean, 0, 100);
  s.equipment = clamp(s.equipment + opt.equip, 0, 100);
}

/**
 * 每個 tick 看看有沒有稽查該來了。
 * 多數會先預告（回傳通知，讓玩家備戰）；少數是突襲，當下就出結果。
 */
export function maybeSpawnInspection(s: MallState, rng: Rng): InspectionNotice | null {
  if (s.shops.length === 0) return null;
  for (const kind of KINDS) {
    if (kind === "hygiene" && !hasFoodShop(s)) continue;
    const nextAt = s.inspections.nextAt[kind] ?? s.tick + 4 * 288;
    if (s.tick < nextAt) continue;
    if (s.inspections.pending.some((p) => p.kind === kind)) continue;

    // 合規分數越低，稽查來得越頻繁
    const mean = INSPECTION_MEAN_DAYS * 288 * (s.inspections.compliance < 40 ? 0.5 : 1);
    s.inspections.nextAt[kind] = s.tick + Math.round(mean * (0.6 + 0.8 * rng.next()));

    if (rng.chance(INSPECTION_SURPRISE_RATE)) {
      addLog(s, "warn", `${INSPECTIONS[kind].icon} ${INSPECTIONS[kind].authority}突擊檢查！沒有任何預告。`);
      resolveInspection(s, kind, null, true);
      return null;
    }
    const notice: InspectionNotice = {
      uid: nextId(s, "ins"),
      kind,
      notifiedTick: s.tick,
      inspectTick: s.tick + rng.int(INSPECTION_NOTICE_MIN_TICKS, INSPECTION_NOTICE_MAX_TICKS),
      prep: null,
    };
    s.inspections.pending.push(notice);
    addLog(s, "warn", `${INSPECTIONS[kind].icon} ${INSPECTIONS[kind].noticeText}趁這段時間做好準備。`);
    return notice;
  }
  return null;
}

/** 到了稽查時間：沒備戰的依預設做基本整理（有錢才做），然後出結果 */
export function runDueInspections(s: MallState): void {
  for (const n of s.inspections.pending.slice()) {
    if (n.inspectTick > s.tick) continue;
    if (n.prep === null) {
      const opt = prepOption(DEFAULT_PREP);
      n.prep = s.funds >= opt.cost ? DEFAULT_PREP : "none";
      if (n.prep !== "none") applyPrep(s, n.prep);
    }
    s.inspections.pending = s.inspections.pending.filter((x) => x.uid !== n.uid);
    s.clock.holds.events = s.clock.holds.events.filter((u) => u !== n.uid);
    resolveInspection(s, n.kind, n.prep, false);
  }
}

export function resolveInspection(s: MallState, kind: InspectionKind, prep: InspectionPrep | null, surprise: boolean): void {
  const def = INSPECTIONS[kind];
  const score = inspectionScore(kind, s.cleanliness, s.equipment);
  const outcome = inspectionOutcome(score);
  const info = OUTCOME_INFO[outcome];

  if (info.fine > 0) {
    s.funds -= info.fine;
    s.today.repairs += info.fine;
  }
  if (info.idx !== 0) {
    applyIndexDelta(s, "localRep", info.idx * 0.6);
    applyIndexDelta(s, "touristHeat", info.idx * 0.4);
  }
  s.inspections.compliance = clamp(s.inspections.compliance + info.compliance, 0, 100);
  if (outcome === "suspend") {
    for (const shop of s.shops) {
      const isFood = CATEGORY_BY_ID[shop.category]?.group === "food";
      if (def.suspends === "all" || isFood) shop.closedUntilTick = Math.max(shop.closedUntilTick, s.tick + SUSPEND_TICKS);
    }
  }

  s.inspections.log.unshift({ tick: s.tick, kind, score, outcome, fine: info.fine, prep, surprise });
  if (s.inspections.log.length > MAX_INSPECTION_LOG) s.inspections.log.length = MAX_INSPECTION_LOG;
  const text = `${def.icon} ${def.name}結果：${score} 分・${info.label}${info.fine ? `（罰款 ${money(info.fine)}）` : ""}`;
  addLog(s, outcome === "excellent" || outcome === "pass" ? "info" : "warn", text);
  note(s, text + "。");
}

export function prepareInspection(s: MallState, uid: string, level: InspectionPrep): GuestResult {
  const n = s.inspections.pending.find((x) => x.uid === uid);
  if (!n) return { ok: false, error: "這次稽查已經結束了" };
  if (n.prep !== null) return { ok: false, error: "已經準備過了" };
  const opt = prepOption(level);
  if (!["none", "basic", "full"].includes(level)) return { ok: false, error: "準備方式無效" };
  if (s.funds < opt.cost) return { ok: false, error: "資金不足" };
  applyPrep(s, level);
  n.prep = level;
  s.clock.holds.events = s.clock.holds.events.filter((u) => u !== uid);
  return { ok: true, note: `${INSPECTIONS[n.kind].name}：${opt.label}。` };
}

/** 「全部採預設處理」：還沒備戰的稽查做基本整理（錢不夠就照常），並解除暫停 */
export function autoPrepareInspections(s: MallState): number {
  let n = 0;
  for (const p of s.inspections.pending) {
    if (p.prep !== null) continue;
    const opt = prepOption(DEFAULT_PREP);
    p.prep = s.funds >= opt.cost ? DEFAULT_PREP : "none";
    if (p.prep !== "none") applyPrep(s, p.prep);
    s.clock.holds.events = s.clock.holds.events.filter((u) => u !== p.uid);
    n++;
  }
  return n;
}
