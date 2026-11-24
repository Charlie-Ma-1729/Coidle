import { PERSONA_BY_ID, PERSONA_IDS } from "./data";
import type { MallState, PersonaId, RivalCampaignKind, RivalDef, RivalState } from "./types";

// 商戰：附近有幾座 NPC 對手商場，各有風格。他們會自己辦活動、價格戰、出醜聞，
// 左右各類客人要去哪一家。名字全部虛構。

export const RIVALS: RivalDef[] = [
  {
    id: "harbor",
    name: "港灣大賣場",
    tagline: "天天特價・走量取勝",
    bio: "靠低價與大份量吸客的連鎖大賣場，在地客與學生最愛。老闆信奉「薄利多銷」。",
    bias: 0,
    profile: { tourist: 0.8, local: 1.25, commuter: 1.0, family: 1.2, student: 1.25, couple: 0.8 },
    campaigns: ["price_war", "grand_opening"],
  },
  {
    id: "airport",
    name: "機場前旅客廣場",
    tagline: "旅客一下飛機就能逛",
    bio: "緊鄰機場的觀光型商場，免稅、伴手禮與行李寄放樣樣齊全，專攻觀光客。",
    bias: 1,
    profile: { tourist: 1.35, local: 0.7, commuter: 0.9, family: 1.0, student: 0.9, couple: 1.05 },
    campaigns: ["tourist_blitz", "grand_opening"],
  },
  {
    id: "skyline",
    name: "雲端天際城",
    tagline: "高樓景觀・精品名店",
    bio: "新開的高端複合大樓，精品與景觀餐廳林立，吸引情侶與講究的客人。",
    bias: 3,
    profile: { tourist: 1.1, local: 0.8, commuter: 1.0, family: 0.85, student: 0.8, couple: 1.35 },
    campaigns: ["luxury_event", "grand_opening"],
  },
  {
    id: "gourmet",
    name: "美食橫丁",
    tagline: "吃到飽的老街風情",
    bio: "一整條小吃橫丁，老街人情味十足，是你在餐飲上最直接的對手。",
    bias: -1,
    profile: { tourist: 1.1, local: 1.2, commuter: 1.1, family: 1.1, student: 1.0, couple: 1.0 },
    campaigns: ["food_fest", "grand_opening"],
  },
];

export const RIVAL_BY_ID = Object.fromEntries(RIVALS.map((r) => [r.id, r])) as Record<string, RivalDef>;

export const RIVAL_INTEL_COST = 30_000;
export const RIVAL_INTEL_TICKS = 288 * 2;
export const RIVAL_PACT_COST = 100_000;
export const RIVAL_PACT_TICKS = 288 * 3;
export const RIVAL_COUNTER_COST = 60_000;
export const RIVAL_AUTO_DEFENSE_COST = 40_000;
export const RIVAL_AUTO_AGGRESSIVE_COST = 60_000;
/** 每座對手平均每幾個遊戲日有一次動作 */
export const RIVAL_MEAN_DAYS = 7;
export const MAX_RIVAL_NEWS = 14;

export const CAMPAIGNS: Record<RivalCampaignKind, { name: string; icon: string; ticks: [number, number]; boost: Partial<Record<PersonaId, number>>; news: string }> = {
  price_war: {
    name: "價格戰",
    icon: "💥",
    ticks: [144, 288],
    boost: { local: 14, student: 12, commuter: 8, family: 8 },
    news: "「{rival}」打出「全品項殺到見骨」的價格戰，在地客與學生都被吸過去了。",
  },
  grand_opening: {
    name: "盛大開幕",
    icon: "🎆",
    ticks: [216, 360],
    boost: { tourist: 8, local: 8, commuter: 8, family: 8, student: 8, couple: 8 },
    news: "「{rival}」新館盛大開幕，連續三天的開幕慶讓不少人湧過去看熱鬧。",
  },
  tourist_blitz: {
    name: "旅客攻勢",
    icon: "✈️",
    ticks: [216, 360],
    boost: { tourist: 18, couple: 6, student: 4 },
    news: "「{rival}」和旅行社合作推出「落地優惠券」，大批旅客被直接導流過去。",
  },
  luxury_event: {
    name: "名牌快閃",
    icon: "💎",
    ticks: [144, 288],
    boost: { couple: 16, tourist: 10, commuter: 4 },
    news: "「{rival}」辦了一場名牌聯名快閃，情侶與精品客都排隊拍照。",
  },
  food_fest: {
    name: "美食祭",
    icon: "🍢",
    ticks: [216, 360],
    boost: { local: 8, couple: 8, family: 6, tourist: 8 },
    news: "「{rival}」舉辦「橫丁美食祭」，一整條街飄著香味，人潮擠得水洩不通。",
  },
  scandal: {
    name: "醜聞",
    icon: "🗞️",
    ticks: [216, 360],
    boost: { tourist: -12, local: -12, commuter: -12, family: -12, student: -12, couple: -12 },
    news: "「{rival}」被爆出衛生與服務的醜聞，客人們紛紛退避三舍。",
  },
};

/** 一座對手此刻對某類客人的吸引力（含活動加減、合作期間的好感） */
export function rivalAppealNow(r: RivalState, persona: PersonaId, tick: number): number {
  let v = r.appeal[persona] ?? 40;
  if (r.campaign && r.campaign.endTick > tick) v += (r.campaign.boost[persona] ?? 0) * r.campaign.factor;
  return Math.min(100, Math.max(0, v));
}

type PlayerView = Pick<MallState, "localRep" | "touristHeat" | "shops" | "level">;

/** 玩家這座商場對某類客人的吸引力：口碑為底，業態越多元、等級越高越強 */
export function playerAppeal(s: PlayerView, persona: PersonaId): number {
  const p = PERSONA_BY_ID[persona];
  const base = p.index === "localRep" ? s.localRep : p.index === "touristHeat" ? s.touristHeat : (s.localRep + s.touristHeat) / 2;
  const diversity = new Set(s.shops.map((x) => x.category)).size;
  return Math.min(100, Math.max(0, base + Math.min(10, diversity * 1.2) + (s.level - 1) * 1.5));
}

export function playerScore(s: PlayerView): number {
  return PERSONA_IDS.reduce((a, p) => a + playerAppeal(s, p), 0) / PERSONA_IDS.length;
}

export function rivalScore(r: RivalState, tick: number): number {
  return PERSONA_IDS.reduce((a, p) => a + rivalAppealNow(r, p, tick), 0) / PERSONA_IDS.length;
}

/**
 * 對手對你各類客人客流的影響：你比對手平均強就大於 1，弱就小於 1。
 * 簽了合作協議的對手，會讓你多一點點好處。
 */
export function rivalMult(s: Pick<MallState, "rivals" | "localRep" | "touristHeat" | "shops" | "level" | "tick">, persona: PersonaId): number {
  const list = s.rivals.list;
  if (list.length === 0) return 1;
  let sum = 0;
  let pacts = 0;
  for (const r of list) {
    sum += rivalAppealNow(r, persona, s.tick);
    if (r.pactUntil > s.tick) pacts++;
  }
  const mean = sum / list.length;
  const m = 1 + (playerAppeal(s, persona) - mean) * 0.006 + Math.min(2, pacts) * 0.03;
  return Math.min(1.3, Math.max(0.75, m));
}

export function rivalTarget(def: RivalDef, level: number): number {
  return Math.min(85, Math.max(25, 40 + level * 2.5 + def.bias));
}

export function initialRivals(level: number): RivalState[] {
  return RIVALS.map((def) => {
    const t = rivalTarget(def, level);
    const appeal = Object.fromEntries(PERSONA_IDS.map((p) => [p, Math.round(t * (def.profile[p] ?? 1) * 10) / 10])) as Record<PersonaId, number>;
    return { id: def.id, appeal, campaign: null, intelUntil: 0, pactUntil: 0 };
  });
}
