import { CATEGORY_BY_ID, EVENT_BY_ID, ZONE_BY_ID } from "./data";
import type { MallState, Shop } from "./types";

/** 區域是否已開放：旗標優先（開發／營運用），否則看商場等級 */
export function isZoneUnlocked(s: Pick<MallState, "flags" | "level">, zoneId: string): boolean {
  const forced = s.flags[`zone:${zoneId}`];
  if (forced !== undefined) return forced;
  const z = ZONE_BY_ID[zoneId];
  return !!z && s.level >= z.unlockLevel;
}

/** 目前進貨價倍率（事件造成的漲跌） */
export function currentSupplyMult(s: Pick<MallState, "modifiers" | "tick">): number {
  let m = 1;
  for (const mod of s.modifiers) if (mod.kind === "supply" && mod.endTick > s.tick) m *= mod.mult;
  return m;
}

/** 每份進貨成本 */
export function unitCostOf(category: string, supplyMultiplier = 1): number {
  const cat = CATEGORY_BY_ID[category];
  if (!cat) return 0;
  return Math.max(1, Math.ceil(cat.refPrice * cat.costRatio * supplyMultiplier));
}

/** 客人那邊有幾件事等你處理：收件匣（客訴、評價）＋面對客人的突發事件 */
export function guestTodoCount(s: Pick<MallState, "inbox" | "pending">): number {
  const guestEvents = s.pending.filter((p) => EVENT_BY_ID[p.defId]?.category === "guest").length;
  return s.inbox.length + guestEvents;
}

export function shopIsClosed(s: Pick<MallState, "tick">, shop: Pick<Shop, "closedUntilTick">): boolean {
  return shop.closedUntilTick > s.tick;
}
