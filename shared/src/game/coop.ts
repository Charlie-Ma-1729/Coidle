import { REAL_HOURS_PER_GAME_DAY, TICKS_PER_DAY } from "./data";
import type { WorldState } from "./types";

// 合作：聯名協議的常數與純函式。獨立成一個檔案，讓商戰（rivals.ts）可以引用而不會和 world.ts 形成循環匯入。
const DAY_MS = 86_400_000;

// ───────── 跨商場互動與伺服器基準時間 ─────────
// 所有跨商場的效果都以「伺服器基準時間」（server tick）為起點、以遊戲 tick 計長度；
// 商場自己的時鐘落後時，模擬到那個 tick 才會收到效果。冷卻、保護、每日上限用真實毫秒，
// 因為伺服器時間是真實時間的線性函數，兩者等價。
/** 落後伺服器基準時間超過這麼多 tick（5 遊戲日，約 20 個真實小時）的商場，不能發起跨商場互動 */
export const INTERACT_MAX_LAG_TICKS = 5 * TICKS_PER_DAY;

/** 能不能發起跨商場互動？可以回傳 null，否則回傳原因（前後端共用同一套說明） */
export function interactBlocker(lag: number): string | null {
  if (lag > INTERACT_MAX_LAG_TICKS) return "你的商場落後伺服器時間太多了，先把時間追上來再發起互動";
  return null;
}

// ───────── 關係企業：同一位玩家經手的商場，不能左手轉右手 ─────────
/**
 * 兩座商場只要有同一位玩家（現任成員，或在這段期間內離開的成員）就是「關係企業」。
 * 離開後仍算一段時間，是為了擋掉「加入、轉完、退出」的做法。期間與一個賽季同長。
 */
export const RELATED_TAIL_MS = 28 * DAY_MS;
/** 關係企業之間不能做的事（前後端共用同一段說明） */
export const RELATED_BLOCK_TEXT = "你們有共同的經營者（或最近才離開的成員），屬於關係企業，不能互相聯名、貿易或搶客";
/** 關係企業之間的聯名協議被強制結束時，寄給雙方的通知 */
export const RELATED_ENDED_TEXT = "兩座商場出現了共同的經營者，成為關係企業，聯名協議已自動結束";
/** 一季同一位玩家只領一份獎金，名次較低的另一座商場不再領獎（仍然列在榜上） */
export const SEASON_ONE_REWARD_PER_PLAYER = true;

// ───────── 合作：聯名協議 ─────────
/** 聯名協議期間（遊戲日；伺服器基準流速下約 4 個真實日 16 小時） */
export const ALLIANCE_GAME_DAYS = 28;
export const ALLIANCE_REAL_MS = Math.round(ALLIANCE_GAME_DAYS * REAL_HOURS_PER_GAME_DAY * 3_600_000);
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

// ───────── 貿易：互相調貨與支援 ─────────
/** 手續費（轉出的貨與錢，對方只收到 95%，差額直接消失，所以來回轉只會越轉越少） */
export const TRADE_FEE = 0.05;
export const TRADE_MIN_FUNDS = 10_000;
/** 轉出之後自己至少要留下這麼多錢 */
export const TRADE_KEEP_FUNDS = 200_000;
export const TRADE_MIN_GOODS = 20;
export const TRADE_MAX_GOODS = 400;
export const TRADE_MAX_PER_DAY = 10;
export const TRADE_DAY_MS = DAY_MS;
export const TRADE_NET_WINDOW_MS = 7 * DAY_MS;

export interface TradeLimits {
  /** 單筆上限 */
  fundsPerTx: number;
  /** 同一對商場每個真實日的資金上限 */
  fundsPerDay: number;
  /** 同一對商場 7 天內單向淨流量上限 */
  fundsNet: number;
  goodsPerDay: number;
}

/** 上限隨「轉出方」的商場等級成長 */
export function tradeLimits(level: number): TradeLimits {
  const lv = Math.max(1, level);
  return { fundsPerTx: 400_000 * lv, fundsPerDay: 800_000 * lv, fundsNet: 3_000_000 * lv, goodsPerDay: 800 };
}

/** 對方實際收到的量 */
export function afterFee(n: number): number {
  return Math.floor(n * (1 - TRADE_FEE));
}

// ───────── 競爭：商戰搶客 ─────────
// 對任何商場（含 NPC）辦一場針對某類客人的促銷，把他們的客人搶過來一點。
// 資格：等級相差不遠，或「小打大」（見 world.ts 的 canCompete）。效果有界、有冷卻與保護期。
export const COMPETE_BASE_COST = 100_000;
/** 被搶的一方：那一類客人客流 ×0.9；發動的一方：×1.15。約 1 個遊戲日（用模擬算過：對發動方大約打平成本，對被搶方是可承受的小損失） */
export const COMPETE_TARGET_MULT = 0.9;
export const COMPETE_SELF_MULT = 1.15;
export const COMPETE_TICKS = 288;
/** 發動方的冷卻、每日次數 */
export const COMPETE_COOLDOWN_MS = 6 * 3_600_000;
export const COMPETE_MAX_PER_DAY = 3;
/** 被搶的一方：被打到之後的保護期，以及每天最多被針對幾次 */
export const COMPETE_SHIELD_MS = 8 * 3_600_000;
export const COMPETE_MAX_ON_TARGET_PER_DAY = 2;
/** 新開張的商場有這段時間的新手保護：不能被針對 */
export const COMPETE_NEWBIE_MS = 3 * DAY_MS;

export function competeCost(level: number): number {
  return COMPETE_BASE_COST * Math.max(1, level);
}
