import type { WorldState } from "./types";

// 合作：聯名協議的常數與純函式。獨立成一個檔案，讓商戰（rivals.ts）可以引用而不會和 world.ts 形成循環匯入。
const DAY_MS = 86_400_000;

// ───────── 合作：聯名協議 ─────────
/** 聯名協議期間（遊戲日；標準流速下約 7 個真實日） */
export const ALLIANCE_GAME_DAYS = 28;
export const ALLIANCE_REAL_MS = 7 * DAY_MS;
/** 同時最多幾份聯名協議；邀請有效期 */
export const ALLIANCE_MAX_ACTIVE = 2;
export const ALLIANCE_MAX_PENDING = 3;
export const ALLIANCE_INVITE_MS = 24 * 3_600_000;
/** 每份協議的導客加成（客流 ×1.03），總加成含商戰合作協議在內最多 +0.06 */
export const ALLIANCE_BONUS = 0.03;
export const COOP_BONUS_CAP = 0.06;
/** 聯名活動：花費隨商場等級成長；每份協議每 3 個真實日一次；雙方客流 ×1.10 約 12 遊戲小時 */
export const JOINT_PROMO_BASE_COST = 100_000;
export const JOINT_PROMO_COOLDOWN_MS = 3 * DAY_MS;
export const JOINT_PROMO_TICKS = 144;
export const JOINT_PROMO_MULT = 1.1;

export function jointPromoCost(level: number): number {
  return JOINT_PROMO_BASE_COST * Math.max(1, level);
}

/** 目前生效的聯名協議數 */
export function allianceCount(s: { world?: Pick<WorldState, "alliances">; tick: number }): number {
  return (s.world?.alliances ?? []).filter((a) => a.endTick > s.tick).length;
}

/**
 * NPC 商場願不願意和你聯名：你的綜合分數不能比他們低太多（落差 8 分以內）。
 * 純函式，不用擲骰——被拒絕時玩家可以明確知道該努力什麼。
 */
export function npcAcceptsAlliance(npcScore: number, myScore: number): boolean {
  return myScore >= npcScore - 8;
}
