import { RIVAL_BY_ID } from "./rivals";
import type { WorldState } from "./types";

export * from "./coop";

// 跨商場的「世界」：全服公開的商場名錄（真人商場＋NPC 商場）、排行榜與賽季。
// 這裡只放純函式與常數；商場之間不會直接讀彼此的狀態，只透過伺服器層的名錄與信箱。

const DAY_MS = 86_400_000;
/** 世界的起點：NPC 商場的成長曲線與賽季的邊界都從這天算起 */
export const WORLD_EPOCH_MS = Date.UTC(2026, 10, 1);
export const SEASON_DAYS = 28;
export const SEASON_MS = SEASON_DAYS * DAY_MS;
/** 參加賽季獎勵：商場至少要開了這麼久，而且近 30 天有營收 */
export const SEASON_MIN_AGE_MS = 7 * DAY_MS;

export interface DirectoryEntry {
  /** "m:<id>"（真人商場）或 "n:<id>"（NPC 商場） */
  key: string;
  kind: "player" | "npc";
  name: string;
  tagline: string;
  level: number;
  stars: number;
  /** 綜合分數 0–100 */
  score: number;
  localRep: number;
  touristHeat: number;
  /** 近 30 天營收 */
  revenue30: number;
  shops: number;
  /** 店最多的業態名稱 */
  topCategory: string;
  /** 目前缺貨中的店數（用來顯示「需要支援」，不透露庫存數字） */
  stockouts: number;
  updatedAt: number;
}

export type BoardId = "score" | "revenue" | "rep";
export const BOARDS: { id: BoardId; name: string; icon: string }[] = [
  { id: "score", name: "綜合評鑑", icon: "⭐" },
  { id: "revenue", name: "營收", icon: "💴" },
  { id: "rep", name: "口碑", icon: "💬" },
];

export function boardValue(e: DirectoryEntry, board: BoardId): number {
  return board === "score" ? e.score : board === "revenue" ? e.revenue30 : (e.localRep + e.touristHeat) / 2;
}

export function rankEntries(list: DirectoryEntry[], board: BoardId): DirectoryEntry[] {
  return list.slice().sort((a, b) => boardValue(b, board) - boardValue(a, board) || b.score - a.score || a.key.localeCompare(b.key));
}

// ───────── NPC 商場 ─────────
export interface NpcMallDef {
  id: string;
  name: string;
  tagline: string;
  bio: string;
  /** 起步與長期能到的綜合分數 */
  base: number;
  cap: number;
  /** 起伏的相位，讓大家不會同步漲跌 */
  phase: number;
  topCategory: string;
}

/** 既有的 4 家商戰對手也是名錄裡的 NPC 商場；另外再多 4 家（名字全部虛構） */
const fromRival = (id: string, base: number, cap: number, phase: number, topCategory: string): NpcMallDef => {
  const d = RIVAL_BY_ID[id]!;
  return { id, name: d.name, tagline: d.tagline, bio: d.bio, base, cap, phase, topCategory };
};

export const NPC_MALLS: NpcMallDef[] = [
  fromRival("harbor", 30, 56, 0.4, "超市"),
  fromRival("airport", 32, 60, 1.7, "藥妝"),
  fromRival("skyline", 36, 68, 2.9, "景觀 Fine dining"),
  fromRival("gourmet", 31, 58, 4.1, "串炸"),
  { id: "umeda_hill", name: "丘上購物城", tagline: "坡道盡頭的家庭商場", bio: "建在小山坡上的社區型商場，週末停車場總是客滿，親子活動辦得特別勤。", base: 28, cap: 52, phase: 5.2, topCategory: "親子遊樂場" },
  { id: "kita_gate", name: "北門車站大樓", tagline: "通勤族的第二個家", bio: "站體直結的車站商場，早晚尖峰人潮驚人，便利店與立食店生意極好。", base: 34, cap: 57, phase: 0.9, topCategory: "便利商店" },
  { id: "bayside", name: "灣岸 OUTLET", tagline: "海風吹過的折扣城", bio: "靠海的大型折扣商場，週末與連假的觀光巴士一輛接一輛。", base: 29, cap: 62, phase: 3.3, topCategory: "服飾" },
  { id: "old_arcade", name: "昭和拱廊街", tagline: "老字號店家聯合體", bio: "一群老店自己組成的拱廊商店街，規模不大，但每個老闆都是活招牌。", base: 26, cap: 48, phase: 2.2, topCategory: "喫茶咖啡" },
];
export const NPC_BY_ID = Object.fromEntries(NPC_MALLS.map((n) => [n.id, n])) as Record<string, NpcMallDef>;

/** 這個 NPC 商場在某個真實時間點的公開資料。純函式：同樣的時間永遠得到同樣的結果，所以不用存檔 */
export function npcEntry(def: NpcMallDef, nowMs: number): DirectoryEntry {
  const days = Math.max(0, (nowMs - WORLD_EPOCH_MS) / DAY_MS);
  const growth = (def.cap - def.base) * (1 - Math.exp(-days / 50));
  const wobble = 2.5 * Math.sin(days / 11 + def.phase) + 1.2 * Math.sin(days / 3.1 + def.phase * 2);
  const score = Math.round(Math.max(10, Math.min(95, def.base + growth + wobble)) * 10) / 10;
  const level = Math.max(1, Math.min(8, Math.floor((score - 22) / 6)));
  const rep = Math.round(Math.min(95, 38 + score * 0.55 + wobble) * 10) / 10;
  const revenue30 = Math.round((0.4e6 * Math.pow(level, 1.9) * 30 * (0.9 + 0.1 * Math.sin(days / 7 + def.phase))) / 10_000) * 10_000;
  return {
    key: `n:${def.id}`,
    kind: "npc",
    name: def.name,
    tagline: def.tagline,
    level,
    stars: Math.max(1, Math.min(5, Math.ceil(score / 20))),
    score,
    localRep: rep,
    touristHeat: Math.round((rep + wobble) * 10) / 10,
    revenue30,
    shops: 8 + level * 6,
    topCategory: def.topCategory,
    stockouts: 0,
    updatedAt: nowMs,
  };
}

export function npcEntries(nowMs: number): DirectoryEntry[] {
  return NPC_MALLS.map((n) => npcEntry(n, nowMs));
}

// ───────── 賽季 ─────────
export function seasonAt(ms: number): number {
  return Math.floor((ms - WORLD_EPOCH_MS) / SEASON_MS);
}
export function seasonRange(season: number): { start: number; end: number } {
  return { start: WORLD_EPOCH_MS + season * SEASON_MS, end: WORLD_EPOCH_MS + (season + 1) * SEASON_MS };
}

export interface SeasonReward {
  title: string;
  /** 基準獎金，會再乘上商場等級係數 */
  base: number;
}
export const SEASON_REWARDS: SeasonReward[] = [
  { title: "季度冠軍", base: 2_000_000 },
  { title: "季度亞軍", base: 1_000_000 },
  { title: "季度季軍", base: 600_000 },
];
export const SEASON_PARTICIPATION: SeasonReward = { title: "參賽商場", base: 100_000 };

/** 獎金隨商場等級成長，免得後期的獎勵相對於經濟太小、早期的又太大 */
export function seasonRewardFunds(base: number, level: number): number {
  return Math.round((base * (0.5 + 0.5 * level)) / 1000) * 1000;
}

export interface SeasonResultRow {
  key: string;
  kind: "player" | "npc";
  name: string;
  score: number;
  level: number;
}
export interface SeasonResult {
  season: number;
  start: number;
  end: number;
  ranking: SeasonResultRow[];
}

// ───────── 商戰資格 ─────────
/**
 * 商戰只能找「等級相差不遠」的商場，或是「小打大」：
 * 發起方等級 ≤ 目標等級，或兩者相差不超過 1。大打小一律不行。
 */
export function canCompete(attackerLevel: number, targetLevel: number): boolean {
  return attackerLevel <= targetLevel || attackerLevel - targetLevel <= 1;
}

export function newWorldState(): WorldState {
  return { seasons: [], notices: [], mailCount: 0, alliances: [] };
}
