import {
  CATEGORY_BY_ID,
  MAX_ACTIVE_PROMOS,
  MAX_PROMO_HISTORY,
  MAX_QUEUED_PROMOS,
  MAX_SCHEDULE_AHEAD_TICKS,
  PROMO_BY_ID,
  PROMO_FATIGUE_DECAY_PER_DAY,
  promoEffectFactor,
  type MallState,
  type PersonaId,
  type Shop,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import type { GuestResult } from "./guests";
import { addLog, nextId } from "./state";

const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

// ───────── 活動對模擬的影響 ─────────

/** 這位客人類型的客流倍率（疲勞會讓加成的部分打折） */
export function promoTraffic(s: MallState, persona: PersonaId): number {
  let m = 1;
  for (const a of s.promos.active) {
    const def = PROMO_BY_ID[a.defId];
    if (!def) continue;
    const mult = def.traffic[persona] ?? def.traffic.all ?? 1;
    m *= 1 + (mult - 1) * a.factor;
  }
  return m;
}

/** 客人實際少付的比例（多個活動相乘） */
export function promoDiscount(s: MallState): number {
  let keep = 1;
  for (const a of s.promos.active) keep *= 1 - (PROMO_BY_ID[a.defId]?.discount ?? 0);
  return 1 - keep;
}

export function promoSatBonus(s: MallState): number {
  let b = 0;
  for (const a of s.promos.active) b += (PROMO_BY_ID[a.defId]?.satBonus ?? 0) * a.factor;
  return b;
}

/** 活動期間常客親密度增加的倍率 */
export function promoRegularGain(s: MallState): number {
  let m = 1;
  for (const a of s.promos.active) {
    const g = PROMO_BY_ID[a.defId]?.regularGain;
    if (g) m = Math.max(m, 1 + (g - 1) * a.factor);
  }
  return m;
}

export function effectivePrice(s: MallState, shop: Shop): number {
  return shop.price * (1 - promoDiscount(s));
}

/** 每筆成交記進進行中活動的成效 */
export function noteSale(s: MallState, revenue: number): void {
  for (const a of s.promos.active) {
    a.groups++;
    a.revenue += revenue;
  }
}

// ───────── 排程、開始、結束 ─────────

export function schedulePromo(s: MallState, defId: string, startTick?: number): GuestResult {
  const def = PROMO_BY_ID[defId];
  if (!def) return { ok: false, error: "沒有這個活動" };
  const start = startTick ?? s.tick;
  if (!Number.isInteger(start)) return { ok: false, error: "開始時間無效" };
  if (start < s.tick) return { ok: false, error: "不能排到過去" };
  if (start > s.tick + MAX_SCHEDULE_AHEAD_TICKS) return { ok: false, error: "最多只能預先排程 14 個遊戲日" };
  if (s.promos.active.some((a) => a.defId === defId) || s.promos.scheduled.some((x) => x.defId === defId)) {
    return { ok: false, error: "這個活動已經在進行或排程中了" };
  }
  if ((s.promos.lastEnd[defId] ?? -Infinity) + def.cooldownTicks > start) return { ok: false, error: "這個活動剛辦過，還在冷卻中" };
  if (s.promos.active.length + s.promos.scheduled.length >= MAX_QUEUED_PROMOS) return { ok: false, error: `最多同時進行與排程 ${MAX_QUEUED_PROMOS} 個活動` };
  if (start === s.tick && s.promos.active.length >= MAX_ACTIVE_PROMOS) return { ok: false, error: `同時最多進行 ${MAX_ACTIVE_PROMOS} 個活動` };
  if (s.funds < def.cost) return { ok: false, error: "資金不足" };

  s.funds -= def.cost;
  s.today.purchases += def.cost;
  s.promos.scheduled.push({ uid: nextId(s, "pr"), defId, startTick: start, cost: def.cost });
  startDuePromos(s); // 現在開始的話，立刻生效
  return { ok: true, note: start === s.tick ? `「${def.name}」開跑了！` : `「${def.name}」已排程。` };
}

/** 開始前取消，預算全額退回 */
export function cancelPromo(s: MallState, uid: string): GuestResult {
  const at = s.promos.scheduled.findIndex((x) => x.uid === uid);
  const sc = s.promos.scheduled[at];
  if (!sc) return { ok: false, error: "只能取消還沒開始的活動" };
  s.promos.scheduled.splice(at, 1);
  s.funds += sc.cost;
  s.today.purchases -= sc.cost;
  return { ok: true, note: "已取消，預算退回。" };
}

export function startDuePromos(s: MallState): void {
  if (s.promos.scheduled.length === 0) return;
  const due = s.promos.scheduled.filter((x) => x.startTick <= s.tick).sort((a, b) => a.startTick - b.startTick);
  for (const sc of due) {
    const def = PROMO_BY_ID[sc.defId];
    if (!def) {
      s.promos.scheduled = s.promos.scheduled.filter((x) => x.uid !== sc.uid);
      continue;
    }
    if (s.promos.active.length >= MAX_ACTIVE_PROMOS) {
      // 同時進行太多：等最早結束的那個空出位置
      sc.startTick = Math.min(...s.promos.active.map((a) => a.endTick));
      continue;
    }
    s.promos.scheduled = s.promos.scheduled.filter((x) => x.uid !== sc.uid);
    const factor = promoEffectFactor(s.promos.fatigue);
    s.promos.active.push({ uid: sc.uid, defId: def.id, startTick: s.tick, endTick: s.tick + def.durationTicks, factor, groups: 0, revenue: 0 });
    s.promos.fatigue = Math.min(1, s.promos.fatigue + def.fatigue);
    if (def.idx) applyIndexDelta(s, def.idx.which, def.idx.amount * factor);
    if (def.freshness) {
      for (const shop of s.shops) {
        const cat = CATEGORY_BY_ID[shop.category];
        if (shop.mode === "direct" && cat) shop.freshness = Math.min(100, shop.freshness + def.freshness * factor);
      }
    }
    addLog(s, "info", `${def.icon} 活動開跑：「${def.name}」${factor < 0.95 ? `（客人有點看膩了，效果約 ${Math.round(factor * 100)}%）` : ""}`);
    note(s, `「${def.name}」開跑。`);
  }
}

export function endPromos(s: MallState): void {
  if (s.promos.active.length === 0) return;
  const ended = s.promos.active.filter((a) => a.endTick <= s.tick);
  if (ended.length === 0) return;
  s.promos.active = s.promos.active.filter((a) => a.endTick > s.tick);
  for (const a of ended) {
    const def = PROMO_BY_ID[a.defId];
    s.promos.lastEnd[a.defId] = s.tick;
    s.promos.history.unshift({ defId: a.defId, startTick: a.startTick, endTick: a.endTick, groups: a.groups, revenue: a.revenue, cost: def?.cost ?? 0 });
    if (s.promos.history.length > MAX_PROMO_HISTORY) s.promos.history.length = MAX_PROMO_HISTORY;
    addLog(s, "info", `${def?.icon ?? "🎉"} 活動結束：「${def?.name}」期間接待 ${a.groups} 組客人、營收 ${money(a.revenue)}`);
    note(s, `「${def?.name}」結束：${a.groups} 組客人、營收 ${money(a.revenue)}（預算 ${money(def?.cost ?? 0)}）。`);
  }
}

export function promoFatigueDaily(s: MallState): void {
  s.promos.fatigue = Math.max(0, s.promos.fatigue - PROMO_FATIGUE_DECAY_PER_DAY);
}
