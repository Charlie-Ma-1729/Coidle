import { EVENTS, EVENT_BY_ID, FAMILY_ORDER, PERSONA_BY_ID, familyShopCount, weatherAllows, weatherNeedOf, type EffectSpec, type EventDef, type MallState, type PersonaId } from "@coidle/shared";
import type { Rng } from "./rng";
import { applyLegalRisk } from "./legal";
import { noteSeen } from "./meta";
import { addLog, isZoneUnlocked, nextId } from "./state";
import {
  applyFamilyFreshness,
  applySupplierDiscover,
  applySupplierNegotiate,
  applySupplierPrice,
  applySupplierRel,
  applySupplierStatus,
  applySupplierSwitch,
  bestMain,
} from "./suppliers";
import type { TimeInfo } from "./time";

/** 每個 tick 觸發新事件的基礎機率（約每遊戲日 1.3 件） */
const EVENT_RATE_PER_TICK = 0.0045;
const MAX_MODIFIERS = 100;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 套用白名單效果。所有數值都會被夾限，
 * 即使效果來自 AI 生成的內容也不可能做出毀滅性的事。
 */
export function applyEffects(s: MallState, effects: EffectSpec[], rng: Rng): void {
  const t = s.tick;
  for (const e of effects) {
    switch (e.t) {
      case "weather":
        // 強制天氣：同時只留一個（新的蓋過舊的），避免一直堆疊
        s.modifiers = s.modifiers.filter((m) => m.kind !== "weather");
        pushModifier(s, { kind: "weather", weather: e.kind, temp: Math.round(clamp(e.temp, -10, 42)), endTick: t + clamp(e.ticks, 1, 288 * 3) });
        break;
      case "traffic":
        pushModifier(s, { kind: "traffic", persona: e.persona, mult: clamp(e.mult, 0.2, 3), endTick: t + clamp(e.ticks, 1, 288 * 3) });
        break;
      case "supply":
        pushModifier(s, { kind: "supply", mult: clamp(e.mult, 0.5, 2), endTick: t + clamp(e.ticks, 1, 288 * 3) });
        break;
      case "demand":
        pushModifier(s, { kind: "demand", category: e.category, mult: clamp(e.mult, 0.3, 3), endTick: t + clamp(e.ticks, 1, 288 * 3) });
        break;
      case "funds":
        s.funds += clamp(e.amount, -500_000, 500_000);
        break;
      case "index":
        applyIndexDelta(s, e.which, clamp(e.amount, -5, 5));
        break;
      case "stockLoss":
        for (const shop of s.shops) shop.stock = Math.max(0, Math.floor(shop.stock * (1 - clamp(e.pct, 0, 0.3))));
        break;
      case "close": {
        const ticks = clamp(e.ticks, 1, 288 * 2);
        const targets = s.shops.slice();
        const count = e.count === undefined ? targets.length : Math.max(0, Math.min(targets.length, e.count));
        for (let i = targets.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          const a = targets[i];
          const b = targets[j];
          if (a && b) {
            targets[i] = b;
            targets[j] = a;
          }
        }
        for (const shop of targets.slice(0, count)) shop.closedUntilTick = Math.max(shop.closedUntilTick, t + ticks);
        break;
      }
      case "equipment":
        s.equipment = clamp(s.equipment + clamp(e.amount, -30, 30), 0, 100);
        break;
      case "cleanliness":
        s.cleanliness = clamp(s.cleanliness + clamp(e.amount, -30, 30), 0, 100);
        break;
      case "supplierStatus":
        applySupplierStatus(s, e.family, e.status, e.ticks, e.which);
        break;
      case "supplierPrice":
        applySupplierPrice(s, e.family, e.mult, e.ticks);
        break;
      case "supplierRel":
        applySupplierRel(s, e.family, e.amount);
        break;
      case "supplierSwitch":
        applySupplierSwitch(s, e.family);
        break;
      case "supplierNegotiate":
        applySupplierNegotiate(s, e.family);
        break;
      case "supplierDiscover":
        applySupplierDiscover(s, rng);
        break;
      case "legalRisk":
        applyLegalRisk(s, e.kind, e.p, rng);
        break;
      case "familyFreshness":
        applyFamilyFreshness(s, e.family, e.amount);
        break;
    }
  }
}

function pushModifier(s: MallState, m: MallState["modifiers"][number]): void {
  s.modifiers.push(m);
  if (s.modifiers.length > MAX_MODIFIERS) s.modifiers.splice(0, s.modifiers.length - MAX_MODIFIERS);
}

/** 依客人類型把人氣變動套到對應的指標（在地口碑／觀光熱度，兩者皆可的各一半） */
export function applyPersonaIndex(s: MallState, persona: PersonaId, amount: number): void {
  const idx = PERSONA_BY_ID[persona].index;
  if (idx === "both") {
    applyIndexDelta(s, "localRep", amount / 2);
    applyIndexDelta(s, "touristHeat", amount / 2);
  } else {
    applyIndexDelta(s, idx, amount);
  }
}

/** 事件帶來的人氣變動 */
export function applyIndexDelta(s: MallState, which: "localRep" | "touristHeat", amount: number): void {
  const v = clamp(s[which] + amount, 0, 100);
  s[which] = v;
  if (which === "localRep") s.peakLocal = Math.max(s.peakLocal, v);
  else s.peakTourist = Math.max(s.peakTourist, v);
}

/** 這個事件現在能不能發生（冷卻、月份與時段、區域、貨品、天氣…）；測試也直接用它 */
export function eligible(s: MallState, def: EventDef, time: TimeInfo): boolean {
  if ((s.cooldowns[def.id] ?? 0) > s.tick) return false;
  if (def.when?.months && !def.when.months.includes(time.month)) return false;
  if (def.when?.hours) {
    const [from, to] = def.when.hours;
    if (time.hour < from || time.hour >= to) return false;
  }
  if (def.needsZone) {
    if (!isZoneUnlocked(s, def.needsZone)) return false;
    const hasShop = s.shops.some((shop) => s.slots[shop.slot]?.zone === def.needsZone);
    if (!hasShop) return false;
  }
  if (def.needsFamily) {
    const used = def.needsFamily === "any" ? FAMILY_ORDER.some((f) => familyShopCount(s, f) > 0) : familyShopCount(s, def.needsFamily) > 0;
    if (!used) return false;
  }
  if (def.needsRel !== undefined && !(bestMain(s)?.st.relationship !== undefined && bestMain(s)!.st.relationship >= def.needsRel)) return false;
  if (def.needsUndiscovered && !s.supply.suppliers.some((x) => !x.discovered)) return false;
  if (s.pending.some((p) => p.defId === def.id)) return false;
  // 事件寫到下雨，就要此刻真的在下雨（連日的雨要連著下過）；不然會在大晴天看到「雨水滲進來」
  if (!weatherAllows(weatherNeedOf(def), s)) return false;
  return true;
}

export interface Spawned {
  def: EventDef;
  /** 有選項的事件會產生待決項目，這是它的 uid */
  uid: string | null;
}

export function maybeSpawnEvent(s: MallState, time: TimeInfo, rng: Rng): Spawned | null {
  if (!rng.chance(EVENT_RATE_PER_TICK)) return null;
  const pool = EVENTS.filter((e) => eligible(s, e, time));
  if (pool.length === 0) return null;
  const idx = rng.weighted(pool.map((e) => e.weight));
  const def = pool[idx];
  return def ? { def, uid: spawnEvent(s, def, rng) } : null;
}

export function spawnEvent(s: MallState, def: EventDef, rng: Rng): string | null {
  s.cooldowns[def.id] = s.tick + def.cooldownTicks;
  addLog(s, "event", `【${def.title}】${def.text}`);
  s.today.events.push(def.title);
  noteSeen(s, def.id);
  applyEffects(s, def.effects, rng);
  if (!def.choice) return null;
  const uid = nextId(s, "ev");
  s.pending.push({ uid, defId: def.id, deadlineTick: s.tick + def.choice.deadlineTicks });
  return uid;
}

/** 玩家或逾時預設選擇。回傳是否成功。 */
export function resolveChoice(s: MallState, uid: string, optionId: string | null, rng: Rng): boolean {
  const idx = s.pending.findIndex((p) => p.uid === uid);
  const pending = s.pending[idx];
  if (!pending) return false;
  const def = EVENT_BY_ID[pending.defId];
  if (!def?.choice) return false;
  const byDefault = optionId === null;
  const option = def.choice.options.find((o) => o.id === (optionId ?? def.choice!.defaultOption));
  if (!option) return false;
  s.pending.splice(idx, 1);
  // 處理完這個事件，就解除它造成的暫停
  s.clock.holds.events = s.clock.holds.events.filter((u) => u !== uid);
  applyEffects(s, option.effects, rng);
  addLog(s, "event", byDefault ? `【${def.title}】沒人回應，採預設處理：${option.label}` : `【${def.title}】已處理：${option.label}`);
  return true;
}

export function resolveDeadlines(s: MallState, rng: Rng): void {
  for (const p of s.pending.slice()) {
    if (p.deadlineTick <= s.tick) resolveChoice(s, p.uid, null, rng);
  }
}

export function expireModifiers(s: MallState): void {
  s.modifiers = s.modifiers.filter((m) => m.endTick > s.tick);
}
