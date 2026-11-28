import { ZONE_BY_ID } from "./data";
import { floorArea, mergeCapacity, mergedCount } from "./floor";
import type { MallState } from "./types";

// 擴建：在已開放的區域加蓋店面。越蓋越貴；同一區域能擴建的數量有上限；
// 後面幾個擴建案還要商場達到更高等級。擴建是土建工程，費用算進固定資產稅的評價額。

export const EXPAND_BASE_COST = 2_000_000;

/** 這個區域已經擴建了幾次（以樓板面積與基本面積的差計算；舊存檔每個 slot 一格，結果與舊算法相同） */
export function expansionsOf(s: Pick<MallState, "slots">, zoneId: string): number {
  const z = ZONE_BY_ID[zoneId];
  if (!z) return 0;
  return Math.max(0, floorArea(s, zoneId) - z.slots);
}

/** 第 n+1 次擴建（n 從 0 起算）的費用 */
export function expandCost(zoneId: string, n: number): number {
  const z = ZONE_BY_ID[zoneId];
  if (!z) return 0;
  return Math.round((EXPAND_BASE_COST * (0.7 + 0.3 * z.tier) * (1 + 0.45 * n)) / 100_000) * 100_000;
}

/** 第 n+1 次擴建要求的商場等級 */
export function expandMinLevel(zoneId: string, n: number): number {
  const z = ZONE_BY_ID[zoneId];
  return (z?.unlockLevel ?? 1) + Math.floor(n / 2);
}

/** 目前這個區域下一次擴建的狀態 */
export function expandInfo(s: Pick<MallState, "slots" | "level" | "flags" | "funds">, zoneId: string): { n: number; cost: number; minLevel: number; max: number; canBuy: boolean; reason: string | null } {
  const z = ZONE_BY_ID[zoneId];
  const n = expansionsOf(s, zoneId);
  const cost = expandCost(zoneId, n);
  const minLevel = expandMinLevel(zoneId, n);
  const max = z?.maxExpand ?? 0;
  let reason: string | null = null;
  if (!z) reason = "區域無效";
  else if (n >= max) reason = "這個區域已經擴建到上限";
  else if (s.level < minLevel) reason = `商場達到 Lv.${minLevel} 才能再擴建`;
  else if (s.funds < cost) reason = "資金不足";
  else if (mergedCount(s, zoneId) > mergeCapacity(s.slots.filter((x) => x.zone === zoneId).length + 1)) reason = "擴建後版面會變成島型，放不下現有的大店（先拆除一間大店）";
  return { n, cost, minLevel, max, canBuy: reason === null, reason };
}
