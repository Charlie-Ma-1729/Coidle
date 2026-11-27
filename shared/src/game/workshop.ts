import { CATEGORY_BY_ID } from "./data";
import type { CategoryGroup, CategoryId, Dish, IngredientInfo, MenuEntry, PersonaId, Shop, SlotKind } from "./types";

// 研發工坊的「公開」部分：標籤名稱、槽位名稱、常數與純函式。
// 素材的特性、隱藏配方、線索全部只存在伺服器端——玩家只會看到已經認識／發現的內容。

export const SLOT_KINDS: SlotKind[] = ["base", "season", "method", "special"];

export interface WorkshopInfo {
  name: string;
  icon: string;
  /** 一次研發的動作名稱 */
  verb: string;
  /** 做出來的東西叫什麼 */
  noun: string;
  slots: Record<SlotKind, string>;
  /** 自動命名的後綴 */
  suffix: string;
}

export const WORKSHOP_INFO: Record<CategoryGroup, WorkshopInfo> = {
  food: { name: "廚房研發", icon: "🍳", verb: "試做新菜", noun: "菜色", slots: { base: "主料", season: "調味", method: "手法", special: "特色" }, suffix: "" },
  retail: { name: "選品工作室", icon: "🧵", verb: "打樣新品", noun: "商品", slots: { base: "素材", season: "風格", method: "工藝", special: "限定元素" }, suffix: "款" },
  entertainment: { name: "內容製作室", icon: "🎬", verb: "企劃新內容", noun: "企劃", slots: { base: "主題", season: "內容", method: "形式", special: "加料" }, suffix: "企劃" },
  service: { name: "服務研發室", icon: "💆", verb: "調配新療程", noun: "服務", slots: { base: "主療程", season: "輔助", method: "手法", special: "加值" }, suffix: "療程" },
};

export interface TagDef {
  id: string;
  name: string;
  /** 太多時的試吃回饋 */
  much: string;
  /** 不足時的試吃回饋（接近某個隱藏風味時用來給方向） */
  lack: string;
  /** 突出時的正面回饋 */
  good: string;
  /** 偏好這個特性的客群（原創品的吸引力由此而來） */
  appeal: Partial<Record<PersonaId, number>>;
}

const t = (id: string, name: string, much: string, lack: string, good: string, appeal: Partial<Record<PersonaId, number>>): TagDef => ({ id, name, much, lack, good, appeal });

export const TAGS: Record<CategoryGroup, TagDef[]> = {
  food: [
    t("salty", "鹹香", "太鹹了，喝了好幾杯水", "少了一點鹹味打底", "鹹香恰到好處", { commuter: 0.6, local: 0.5 }),
    t("sweet", "甘甜", "甜得發膩", "缺一點圓潤的甜味", "甜味很討喜", { couple: 0.6, student: 0.6, family: 0.5 }),
    t("sour", "酸爽", "酸得嗆人", "少了一點酸味提味", "酸味清爽開胃", { tourist: 0.4, couple: 0.4, local: 0.3 }),
    t("spicy", "辛辣", "辣到說不出話", "缺少一點辣味的刺激", "辣得過癮", { student: 0.6, commuter: 0.5, tourist: 0.4 }),
    t("umami", "鮮味", "鮮味太搶戲，反而蓋過食材", "鮮味不夠厚實", "鮮味層次很漂亮", { local: 0.6, tourist: 0.5 }),
    t("rich", "濃郁", "太油太膩了", "不夠濃郁，少了份量感", "濃郁得很有滿足感", { commuter: 0.5, student: 0.5, family: 0.4 }),
    t("crisp", "酥脆", "炸過頭，硬邦邦的", "缺少酥脆的口感", "酥脆得很有聲音", { student: 0.6, tourist: 0.5, family: 0.5 }),
    t("light", "清爽", "清淡到幾乎沒味道", "少了一點清爽感", "吃起來很清爽", { couple: 0.5, local: 0.4, commuter: 0.4 }),
    t("aroma", "香氣", "香氣衝過頭，有點嗆", "香氣不夠突出", "香氣撲鼻", { tourist: 0.6, couple: 0.5 }),
    t("warm", "暖胃", "太燙了，燙嘴", "少了暖呼呼的安心感", "暖暖的，很安心", { local: 0.6, family: 0.5, commuter: 0.4 }),
  ],
  retail: [
    t("classic", "經典", "太守舊，缺少新意", "少了一點經典的味道", "有種耐看的經典感", { local: 0.6, commuter: 0.4 }),
    t("trendy", "潮流", "追流行追過頭，很快會退燒", "不夠有話題性", "很有話題性", { student: 0.7, couple: 0.5 }),
    t("cute", "可愛", "可愛到有點幼稚", "少了一點萌點", "可愛得讓人想帶回家", { couple: 0.6, family: 0.5, student: 0.5 }),
    t("premium", "質感", "價格感太高，客人不敢碰", "質感略顯陽春", "摸起來很有質感", { tourist: 0.6, couple: 0.5 }),
    t("practical", "實用", "太實用，少了趣味", "日常用起來不太方便", "日常很好用", { commuter: 0.6, local: 0.5, family: 0.4 }),
    t("local", "在地", "在地味太重，外地人看不懂", "少了一點在地的故事", "帶著濃濃在地味", { tourist: 0.8, local: 0.3 }),
    t("limited", "限定", "限量得太誇張，客人買不到而抱怨", "缺乏稀少感", "限定感很吸引人", { tourist: 0.6, student: 0.5 }),
    t("eco", "環保", "環保訴求太硬，像在說教", "少了一點永續的理念", "環保理念讓人加分", { couple: 0.4, family: 0.4, local: 0.3 }),
    t("tech", "科技", "科技感過頭，不親切", "少了一點科技巧思", "有種未來感", { student: 0.6, commuter: 0.4 }),
    t("playful", "趣味", "太鬧了，不知道在賣什麼", "不夠有趣", "讓人會心一笑", { student: 0.6, family: 0.5, couple: 0.4 }),
  ],
  entertainment: [
    t("thrill", "刺激", "太刺激，嚇哭了小朋友", "少了一點刺激感", "刺激得讓人尖叫", { student: 0.7, couple: 0.5 }),
    t("relax", "放鬆", "太悠閒，有人睡著了", "少了一點放鬆的餘裕", "讓人完全放鬆", { local: 0.5, commuter: 0.5, couple: 0.4 }),
    t("social", "社交", "人太多，吵得沒法專心", "缺少互動與社交的樂趣", "大家玩得很熱絡", { student: 0.6, family: 0.5, couple: 0.4 }),
    t("story", "劇情", "劇情太複雜，看不懂", "少了一點故事性", "劇情很吸引人", { couple: 0.6, tourist: 0.5, local: 0.3 }),
    t("nostalgia", "懷舊", "太懷舊，年輕人沒共鳴", "少了一點懷舊的情懷", "勾起滿滿回憶", { local: 0.7, commuter: 0.4 }),
    t("immersive", "沉浸", "沉浸過頭，有人分不清現實", "不夠沉浸", "完全沉浸其中", { tourist: 0.6, student: 0.6, couple: 0.5 }),
    t("competitive", "競技", "競爭太激烈，輸的人很不爽", "缺少一點競爭的熱血", "大家都想爭第一", { student: 0.8, commuter: 0.4 }),
    t("family", "親子", "太幼稚，大人覺得無聊", "少了適合親子同樂的設計", "全家人都玩得開心", { family: 0.9 }),
    t("music", "音樂", "音量太大，耳朵嗡嗡響", "少了音樂的帶動", "音樂讓氣氛整個熱起來", { student: 0.6, couple: 0.5, local: 0.3 }),
    t("visual", "視覺", "畫面太花，眼睛很累", "視覺效果略顯單調", "畫面很吸睛", { tourist: 0.7, couple: 0.5, student: 0.4 }),
  ],
  service: [
    t("calm", "安定", "太安靜了，有點無趣", "少了一點讓人安心的氛圍", "整個人都安定下來", { local: 0.5, commuter: 0.5, couple: 0.4 }),
    t("effective", "見效", "效果太強，客人有點不舒服", "效果不太明顯", "效果很明顯", { commuter: 0.7, local: 0.5 }),
    t("luxury", "尊榮", "太奢華，客人不好意思消費", "少了一點被款待的尊榮感", "有被款待的尊榮感", { tourist: 0.7, couple: 0.6 }),
    t("quick", "快速", "趕得太急，失了品質", "耗時太久，客人等得不耐煩", "又快又不馬虎", { commuter: 0.9, student: 0.4 }),
    t("personal", "貼心", "貼心到有點被盯著看", "不夠貼心，像流水線", "貼心得讓人感動", { local: 0.6, family: 0.5, couple: 0.4 }),
    t("natural", "天然", "天然成分味道太重", "少了一點天然的取向", "天然溫和", { couple: 0.5, family: 0.5, tourist: 0.4 }),
    t("tech", "科技", "機器太多，缺乏人味", "少了一點科技輔助", "科技輔助很專業", { student: 0.5, commuter: 0.5, tourist: 0.4 }),
    t("warm", "溫暖", "熱情過頭，有點壓力", "少了一點溫暖", "感覺像回家一樣溫暖", { local: 0.7, family: 0.5 }),
    t("social", "社群", "太吵，隱私不夠", "缺少交流與社群感", "認識了不少新朋友", { student: 0.6, couple: 0.5 }),
    t("wellness", "養生", "說教太多，像在上課", "少了一點養生的概念", "做完神清氣爽", { local: 0.6, commuter: 0.5, tourist: 0.3 }),
  ],
};

export const TAG_BY_ID: Record<CategoryGroup, Record<string, TagDef>> = Object.fromEntries(
  (Object.keys(TAGS) as CategoryGroup[]).map((g) => [g, Object.fromEntries(TAGS[g].map((x) => [x.id, x]))]),
) as Record<CategoryGroup, Record<string, TagDef>>;

// ───────── 數值 ─────────
/** 一次研發要花的真實時間（遊戲 tick）；用到「特色」素材會更久 */
export const RND_TICKS = 96;
export const RND_TICKS_SPECIAL = 120;
export const RND_BASE_COST: Record<CategoryGroup, number> = { food: 15_000, retail: 25_000, entertainment: 40_000, service: 30_000 };
export const RND_CANCEL_REFUND = 0.5;
/** 試吃結果放多久沒處理就自動處理（2 個遊戲日） */
export const TASTING_TTL = 576;
/** 某個特性總分超過這個值就是「失衡」 */
export const EXCESS_TAG = 7;
export const MAX_COOKBOOK = 60;
export const MAX_WORKSHOP_LOG = 40;
export const MAX_TASTINGS = 12;

// 菜單
export const MENU_SLOTS_BY_LEVEL = [0, 2, 3, 4] as const;
export const MENU_NOVELTY_FLOOR = 25;
/** 每個遊戲日新鮮度衰退：招牌退得慢 */
export const MENU_NOVELTY_DECAY = { signature: 1.5, original: 4 } as const;
/** 上架時，店面整體新鮮感一次回升多少 */
export const MENU_LIST_FRESHNESS = { signature: 30, original: 15 } as const;
export const MENU_QUALITY_WEIGHT = 0.04;
export const MENU_QUALITY_CAP = 0.14;
export const MENU_APPEAL_WEIGHT = 0.35;
/** 招牌的口碑加成：每日、每道、總上限 */
export const SIGNATURE_IDX_DAILY = 0.04;
export const SIGNATURE_IDX_CAP = 0.2;
export const REGULAR_SIGNATURE_BONUS = 8;

export function menuSlots(level: number): number {
  return MENU_SLOTS_BY_LEVEL[Math.min(MENU_SLOTS_BY_LEVEL.length - 1, Math.max(1, level))] ?? 2;
}

export function groupOfCategory(category: CategoryId): CategoryGroup | null {
  return CATEGORY_BY_ID[category]?.group ?? null;
}

export function dishFitsCategory(dish: Pick<Dish, "group" | "categories">, category: CategoryId): boolean {
  if (groupOfCategory(category) !== dish.group) return false;
  return !dish.categories || dish.categories.includes(category);
}

/** 這道作品能不能上架到這間店：業態要合，而且是哪間店研發的就只能在那間店上架 */
export function dishFitsShop(dish: Pick<Dish, "group" | "categories" | "madeShopId">, shop: Pick<Shop, "id" | "category">): boolean {
  if (dish.madeShopId && dish.madeShopId !== shop.id) return false;
  return dishFitsCategory(dish, shop.category);
}

export function entryFreshFactor(e: Pick<MenuEntry, "novelty">): number {
  return 0.5 + 0.5 * (e.novelty / 100);
}

/** 店裡菜單對品質的加成（加在 0–1 的品質上） */
export function menuQualityBonus(shop: Pick<Shop, "menu">): number {
  let b = 0;
  for (const e of shop.menu ?? []) b += (e.quality / 100) * entryFreshFactor(e) * MENU_QUALITY_WEIGHT;
  return Math.min(MENU_QUALITY_CAP, b);
}

/** 菜單對某客群的吸引力 0–1（取最能打動這群人的那一道） */
export function menuAppeal(shop: Pick<Shop, "menu">, persona: PersonaId): number {
  let best = 0;
  for (const e of shop.menu ?? []) best = Math.max(best, (e.appeal[persona] ?? 0) * entryFreshFactor(e));
  return best;
}

/** 這個素材這個業態用不用得到（群組要對，而且素材有指定業態的話要包含這個業態） */
export function ingredientFitsCategory(i: Pick<IngredientInfo, "group" | "categories">, category: CategoryId): boolean {
  if (groupOfCategory(category) !== i.group) return false;
  return !i.categories || i.categories.includes(category);
}

/** 試過的組合的鍵：同業態、同一組素材（順序無關） */
export function comboKey(category: CategoryId, picks: Partial<Record<SlotKind, string>>): string {
  const ids = SLOT_KINDS.map((k) => picks[k]).filter((x): x is string => !!x);
  return `${category}:${ids.slice().sort().join(",")}`;
}

export function rndCostOf(group: CategoryGroup, ingredientCosts: number[]): number {
  return RND_BASE_COST[group] + ingredientCosts.reduce((a, b) => a + b, 0);
}
