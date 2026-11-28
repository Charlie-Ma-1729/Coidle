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
  /** 缺貨中的店是哪些業態（去重、最多 6 個；只有業態名，不透露店名與庫存數字）。舊資料沒有 */
  stockoutCats?: string[];
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

/**
 * 名錄裡的 NPC 商場（對玩家完全看不出是 NPC）。名字刻意和遊戲內的商戰對手（港灣大賣場等）不同，
 * 不然玩家會發現「名錄裡的商場」就是商戰頁的對手。id 是內部識別，不會顯示。
 */
export const NPC_MALLS: NpcMallDef[] = [
  { id: "harbor", name: "潮見廣場", tagline: "港邊的生活百貨", bio: "靠港口的大型生活商場，生鮮與日用品特別齊全。", base: 30, cap: 56, phase: 0.4, topCategory: "超市" },
  { id: "airport", name: "空港通商城", tagline: "旅人的補給站", bio: "離機場很近的商場，藥妝與伴手禮是招牌。", base: 32, cap: 60, phase: 1.7, topCategory: "藥妝" },
  { id: "skyline", name: "高台景觀城", tagline: "夜景是最好的調味料", bio: "頂樓有大片觀景餐廳的新式商場。", base: 36, cap: 68, phase: 2.9, topCategory: "景觀 Fine dining" },
  { id: "gourmet", name: "串炸橫丁中心", tagline: "從午後排到深夜", bio: "以串炸與小吃聞名的美食商場。", base: 31, cap: 58, phase: 4.1, topCategory: "串炸" },
  { id: "umeda_hill", name: "丘上購物城", tagline: "坡道盡頭的家庭商場", bio: "建在小山坡上的社區型商場，週末停車場總是客滿，親子活動辦得特別勤。", base: 28, cap: 52, phase: 5.2, topCategory: "親子遊樂場" },
  { id: "kita_gate", name: "北門車站大樓", tagline: "通勤族的第二個家", bio: "站體直結的車站商場，早晚尖峰人潮驚人，便利店與立食店生意極好。", base: 34, cap: 57, phase: 0.9, topCategory: "便利商店" },
  { id: "bayside", name: "灣岸 OUTLET", tagline: "海風吹過的折扣城", bio: "靠海的大型折扣商場，週末與連假的觀光巴士一輛接一輛。", base: 29, cap: 62, phase: 3.3, topCategory: "服飾" },
  { id: "old_arcade", name: "昭和拱廊街", tagline: "老字號店家聯合體", bio: "一群老店自己組成的拱廊商店街，規模不大，但每個老闆都是活招牌。", base: 26, cap: 48, phase: 2.2, topCategory: "喫茶咖啡" },
];
export const NPC_BY_ID = Object.fromEntries(NPC_MALLS.map((n) => [n.id, n])) as Record<string, NpcMallDef>;

/**
 * Overseer 對某個 NPC 商場的調整（存在資料庫，可設到期時間）。沒設的欄位就照原本的時間曲線。
 */
export interface NpcOverride {
  name?: string;
  /** 等級加減（結果夾在 1–8） */
  levelDelta?: number;
  /** 綜合分數的倍率（結果夾在 5–99） */
  scoreMult?: number;
  revenueMult?: number;
  repDelta?: number;
  heatDelta?: number;
  /** 暫時從名錄消失（也不會出手） */
  hidden?: boolean;
  /** 自動出手的頻率倍率：0 ＝ 不出手；1 ＝ 預設；最多 5 */
  activity?: number;
}

const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 這個 NPC 商場在某一天「需要支援」（缺貨）的店數：純函式，大約每 8 天有 1 天缺貨 */
export function npcStockouts(id: string, nowMs: number): number {
  let h = 2166136261;
  for (const ch of `${id}:${Math.floor((nowMs - WORLD_EPOCH_MS) / DAY_MS)}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const r = (h >>> 0) / 4294967296;
  return r < 0.12 ? 1 + (r < 0.04 ? 1 : 0) : 0;
}

const hash01 = (s: string): number => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h >>> 0) / 4294967296;
};
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * 「經營者的手感」：每 6 天一段，隨機（但由 id 與日期決定）有檔期衝刺（+3～+8）、
 * 整修／缺人手的低潮（−2～−6）或平穩；段與段之間平滑銜接，所以像是有人在調整策略，而不是規律的正弦波。
 */
function npcOperatorSwing(id: string, days: number): number {
  const block = Math.floor(days / 6);
  const at = (b: number): number => {
    const r = hash01(`${id}:op:${b}`);
    if (r < 0.28) return 3 + hash01(`${id}:opa:${b}`) * 5;
    if (r < 0.4) return -(2 + hash01(`${id}:opb:${b}`) * 4);
    return (hash01(`${id}:opc:${b}`) - 0.5) * 1.6;
  };
  return at(block) + (at(block + 1) - at(block)) * smooth(days / 6 - block);
}

/** 這個 NPC 追著頂尖玩家的「企圖心」：0.80～0.98，每座不同，所以有的緊貼、有的落後 */
export function npcAmbition(def: NpcMallDef): number {
  return 0.8 + 0.18 * hash01(`${def.id}:ambition`);
}

/**
 * 這個 NPC 商場在某個真實時間點的公開資料。純函式：同樣的輸入永遠得到同樣的結果，所以不用存檔。
 * `pace`＝目前最頂尖真人商場的綜合分數：NPC 像有人在經營，會被玩家的進度推著走，
 * 不會停在固定天花板被追過（沒給或 ≤0 就只走自己的曲線）。
 */
export function npcEntry(def: NpcMallDef, nowMs: number, ov?: NpcOverride, pace = 0): DirectoryEntry {
  const days = Math.max(0, (nowMs - WORLD_EPOCH_MS) / DAY_MS);
  // 起步較快、之後仍緩慢爬升（不再停在 cap）
  const growth = (def.cap - def.base) * (1 - Math.exp(-days / 50)) + (92 - def.cap) * 0.4 * (1 - Math.exp(-days / 220));
  const wobble = 2.5 * Math.sin(days / 11 + def.phase) + 1.2 * Math.sin(days / 3.1 + def.phase * 2);
  let own = def.base + growth + wobble + npcOperatorSwing(def.id, days);
  if (pace > 0) {
    // 追趕有延遲：差距越大追得越快，但不會一步到位
    const target = pace * npcAmbition(def) + wobble * 0.6 + npcOperatorSwing(def.id, days) * 0.5;
    if (target > own) own += (target - own) * 0.8;
  }
  const baseScore = Math.max(10, Math.min(pace > 0 ? 97 : 95, own));
  const score = Math.round(clampN(baseScore * (ov?.scoreMult ?? 1), 5, 99) * 10) / 10;
  const level = clampN(Math.floor((score - 22) / 6) + Math.round(ov?.levelDelta ?? 0), 1, 8);
  const rep = Math.round(clampN(Math.min(95, 38 + score * 0.55 + wobble) + (ov?.repDelta ?? 0), 0, 100) * 10) / 10;
  const heat = Math.round(clampN(rep + wobble - (ov?.repDelta ?? 0) + (ov?.heatDelta ?? 0), 0, 100) * 10) / 10;
  const revenue30 = Math.round((0.4e6 * Math.pow(level, 1.9) * 30 * (0.9 + 0.1 * Math.sin(days / 7 + def.phase)) * (ov?.revenueMult ?? 1)) / 10_000) * 10_000;
  return {
    key: `n:${def.id}`,
    kind: "npc",
    name: ov?.name?.trim() || def.name,
    tagline: def.tagline,
    level,
    stars: Math.max(1, Math.min(5, Math.ceil(score / 20))),
    score,
    localRep: rep,
    touristHeat: heat,
    revenue30,
    shops: 8 + level * 6,
    topCategory: def.topCategory,
    stockouts: npcStockouts(def.id, nowMs),
    stockoutCats: npcStockouts(def.id, nowMs) > 0 ? [def.topCategory] : [],
    updatedAt: nowMs,
  };
}

export function npcEntries(nowMs: number, overrides: Record<string, NpcOverride> = {}, pace = 0): DirectoryEntry[] {
  return NPC_MALLS.filter((n) => !overrides[n.id]?.hidden).map((n) => npcEntry(n, nowMs, overrides[n.id], pace));
}

// ───────── 對外的商場代號 ─────────
// NPC 商場在遊戲裡和真人商場長得一樣（沒有任何「NPC」標示）。對外一律用 "m:<編號>"：
// 真人商場是它的資料庫編號；NPC 商場用 9000 起跳的固定編號（真人商場不會有這麼多）。
// 伺服器內部仍用 "n:<id>"，只有 API 的出入口會轉換。
export const NPC_PUBLIC_BASE = 9000;
const npcIndex = (id: string): number => NPC_MALLS.findIndex((n) => n.id === id);

/** 內部代號 → 對外代號（真人商場原樣） */
export function publicKey(key: string): string {
  if (!key.startsWith("n:")) return key;
  const i = npcIndex(key.slice(2));
  return i < 0 ? key : `m:${NPC_PUBLIC_BASE + i}`;
}

/** 對外代號（或內部代號）→ 內部代號 */
export function internalKey(key: string): string {
  const m = /^m:(\d{1,9})$/.exec(key);
  if (!m) return key;
  const i = Number(m[1]) - NPC_PUBLIC_BASE;
  return i >= 0 && i < NPC_MALLS.length ? `n:${NPC_MALLS[i]!.id}` : key;
}

/** NPC 在交易與搶客紀錄裡的整數編號（負數，和真人商場的正整數不會撞） */
export function npcNumericId(npcId: string): number {
  return -(npcIndex(npcId) + 1);
}
export function npcIdFromNumeric(n: number): string | null {
  return n < 0 && -n <= NPC_MALLS.length ? NPC_MALLS[-n - 1]!.id : null;
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
