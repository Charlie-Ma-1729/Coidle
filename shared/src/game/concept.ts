import { CATEGORY_BY_ID, PERSONAS, TICKS_PER_DAY } from "./data";
import type { CategoryGroup, PersonaId } from "./types";

// 概念定位：商場想成為什麼樣的地方。
// 每種定位讓某幾類客人更常來、某幾類業態的需求更高，同時另一些客人與業態會少一點——
// 整體客流大致不變（測試守著），贏面來自「定位和你實際開的店對得上」。
// 純資料＋純函式，不改商場的其他狀態；同一位玩家的不同商場可以各選各的。

export type ConceptId = "general" | "foodie" | "trend" | "family" | "tourist" | "night" | "local";

export interface ConceptDef {
  id: ConceptId;
  name: string;
  icon: string;
  tagline: string;
  /** 適合怎麼搭店（給玩家的建議） */
  advice: string;
  /** 各客群的客流倍率（沒列的是 1） */
  traffic: Partial<Record<PersonaId, number>>;
  /** 各業態大類的需求倍率（沒列的是 1） */
  demand: Partial<Record<CategoryGroup, number>>;
}

export const CONCEPTS: ConceptDef[] = [
  { id: "general", name: "綜合型", icon: "🏬", tagline: "什麼都有一點，不押寶", advice: "沒有特別的加成也沒有代價；還沒想好方向時的預設。", traffic: {}, demand: {} },
  {
    id: "foodie",
    name: "美食街",
    icon: "🍜",
    tagline: "吃飯就來這裡",
    advice: "餐飲店開得越多越划算；上班族與在地常客最愛，學生與零售少一點。",
    traffic: { local: 1.05, commuter: 1.05, student: 0.95 },
    demand: { food: 1.1, retail: 0.95 },
  },
  {
    id: "trend",
    name: "潮流時尚",
    icon: "🛍",
    tagline: "年輕人的逛街據點",
    advice: "服飾、雜貨、美容與話題性高的店；學生與情侶會多，家庭與上班族比較少。",
    traffic: { student: 1.15, couple: 1.08, commuter: 0.92, family: 0.88 },
    demand: { retail: 1.12, service: 1.04, food: 0.95 },
  },
  {
    id: "family",
    name: "親子家庭",
    icon: "👨‍👩‍👧",
    tagline: "週末帶孩子來玩的地方",
    advice: "遊樂、親子餐廳與日常用品；家庭客很多，假日尤其明顯，情侶與學生較少。",
    traffic: { family: 1.25, local: 1.04, commuter: 0.95, student: 0.9, couple: 0.85 },
    demand: { entertainment: 1.08, food: 1.04, retail: 0.96 },
  },
  {
    id: "tourist",
    name: "觀光伴手禮",
    icon: "🎎",
    tagline: "外國旅客的必訪景點",
    advice: "伴手禮、特色小吃與體驗型的店；觀光客明顯變多，在地客與上班族會少一些。",
    traffic: { tourist: 1.15, couple: 1.05, family: 1.05, local: 0.92, commuter: 0.92 },
    demand: { retail: 1.08, food: 1.03, service: 0.95 },
  },
  {
    id: "night",
    name: "夜遊約會",
    icon: "🌃",
    tagline: "下班後才熱鬧起來",
    advice: "居酒屋、酒吧、娛樂與氣氛餐廳；情侶與年輕人多，家庭客幾乎不來。",
    traffic: { couple: 1.2, student: 1.06, tourist: 1.03, local: 0.98, commuter: 0.97, family: 0.8 },
    demand: { entertainment: 1.1, food: 1.02, service: 0.96, retail: 0.95 },
  },
  {
    id: "local",
    name: "社區生活",
    icon: "🏘",
    tagline: "住附近的人天天來",
    advice: "診所、美容、日用品與平價餐飲；在地常客與上班族穩，觀光客與情侶較少。",
    traffic: { local: 1.1, commuter: 1.06, family: 1.04, tourist: 0.88, student: 0.96, couple: 0.95 },
    demand: { service: 1.1, food: 1.03, entertainment: 0.95, retail: 0.97 },
  },
];

export const CONCEPT_BY_ID = Object.fromEntries(CONCEPTS.map((c) => [c.id, c])) as Record<ConceptId, ConceptDef>;

/** 換定位之後要隔多久才能再換（28 遊戲日），避免跟著日曆與天氣來回切 */
export const CONCEPT_COOLDOWN_TICKS = 28 * TICKS_PER_DAY;
/** 第一次選定位免費；之後每次改裝招牌與重新宣傳的費用，隨商場等級成長 */
export const CONCEPT_CHANGE_BASE_COST = 400_000;

export function conceptChangeCost(level: number): number {
  return CONCEPT_CHANGE_BASE_COST * Math.max(1, level);
}

/** 商場目前的定位（沒選過就是綜合型） */
export function conceptDefOf(s: { concept?: { id: string } }): ConceptDef {
  return CONCEPT_BY_ID[(s.concept?.id ?? "general") as ConceptId] ?? CONCEPT_BY_ID.general;
}

/** 這個定位對某客群的客流倍率 */
export function conceptTraffic(id: string | undefined, persona: PersonaId): number {
  return CONCEPT_BY_ID[(id ?? "general") as ConceptId]?.traffic[persona] ?? 1;
}

/** 這個定位對某業態的需求倍率 */
export function conceptDemand(id: string | undefined, category: string): number {
  const group = CATEGORY_BY_ID[category]?.group;
  return group ? (CONCEPT_BY_ID[(id ?? "general") as ConceptId]?.demand[group] ?? 1) : 1;
}

/** 整體客流倍率（各客群依平日到訪量加權）；平衡測試與說明文字用 */
export function conceptTrafficAverage(id: string | undefined): number {
  let num = 0;
  let den = 0;
  for (const p of PERSONAS) {
    num += p.dailyBase * conceptTraffic(id, p.id);
    den += p.dailyBase;
  }
  return den > 0 ? num / den : 1;
}

/** 定位的效果說明（一行一項）：客群與業態各列出有影響的 */
export function conceptEffectLines(def: ConceptDef): string[] {
  const out: string[] = [];
  const pct = (m: number) => `${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}%`;
  for (const p of PERSONAS) {
    const m = def.traffic[p.id];
    if (m !== undefined && m !== 1) out.push(`${p.name} 客流 ${pct(m)}`);
  }
  const GROUP_NAME: Record<CategoryGroup, string> = { food: "餐飲", retail: "零售", entertainment: "娛樂", service: "服務" };
  for (const [g, m] of Object.entries(def.demand) as [CategoryGroup, number][]) if (m !== 1) out.push(`${GROUP_NAME[g]}業態需求 ${pct(m)}`);
  return out;
}
