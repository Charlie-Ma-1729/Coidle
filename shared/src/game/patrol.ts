import { CATEGORY_BY_ID, TICKS_PER_DAY } from "./data";
import type { LegalKind, PatrolIssue, PatrolState } from "./types";

// 巡店：帶著行動點在商場裡逐店逐點檢查，找出藏起來的問題、處理它。
// 隱藏問題每天依各店的狀況冒出來、越拖越嚴重，最後變成事故（罰款、停業、官司、稽查）。
// 每個區域／業態有自己的檢查點與問題（資料驅動：新樓層只要補 `spots` 與 `PATROL_KINDS` 就會自動有）。

export interface PatrolSpotDef {
  label: string;
  icon: string;
  desc: string;
}
export const PATROL_SPOTS: Record<string, PatrolSpotDef> = {
  floor: { label: "賣場／用餐區", icon: "🛍️", desc: "客人最多的地方：陳列、桌面、動線。" },
  counter: { label: "收銀・櫃台", icon: "🧾", desc: "標價、帳目、客人與員工的接觸點。" },
  back: { label: "後場・廚房", icon: "🍳", desc: "備料、烹調與清洗的地方。" },
  cold: { label: "冷藏・冷凍", icon: "🧊", desc: "食材與飲料的保存。" },
  stock: { label: "倉庫・庫存區", icon: "📦", desc: "貨品的存放與出入庫。" },
  restroom: { label: "廁所・公共區", icon: "🚻", desc: "客人也會看的地方，最容易被抱怨。" },
  staff: { label: "員工休息室", icon: "🧑‍🍳", desc: "員工的狀態與士氣。" },
  equip: { label: "設備室", icon: "⚙️", desc: "空調、電力、機械與瓦斯。" },
  safety: { label: "安全出口・消防", icon: "🧯", desc: "避難路徑、滅火器、警報。" },
  treat: { label: "施術・服務區", icon: "💆", desc: "診療、施術或教學進行的地方。" },
  data: { label: "客戶資料", icon: "🗂️", desc: "預約簿、會員資料與契約。" },
  stage: { label: "機台・設施・舞台", icon: "🎢", desc: "娛樂設備、音響燈光與場地。" },
  rooms: { label: "客房・寄放區", icon: "🛏️", desc: "房間、行李與住客物品。" },
};

/** 一間店有哪些可以檢查的點（依區域與群組；新樓層補一個分支即可） */
export function spotsOf(category: string): string[] {
  const cat = CATEGORY_BY_ID[category];
  if (!cat) return ["floor", "counter", "equip", "restroom", "staff"];
  if (cat.zone === "biz") return ["rooms", "counter", "safety", "data", "staff"];
  if (cat.zone === "life") return ["treat", "data", "counter", "restroom", "equip"];
  if (cat.zone === "plaza") return cat.group === "food" ? ["floor", "back", "cold", "safety", "staff"] : ["stage", "safety", "counter", "restroom", "staff"];
  if (cat.group === "food") return ["floor", "back", "cold", "restroom", "equip"];
  if (cat.group === "retail") return ["floor", "counter", "stock", "equip", "staff"];
  if (cat.group === "entertainment") return ["stage", "safety", "counter", "restroom", "staff"];
  return ["counter", "safety", "equip", "restroom", "staff"];
}

/** 每日未處理的影響（乘上嚴重度）與事故 */
export interface PatrolEffects {
  /** 全館清潔度每日變化 */
  clean?: number;
  /** 全館設備狀態每日變化 */
  equip?: number;
  /** 那間店新鮮感每日變化 */
  fresh?: number;
  /** 在地口碑每日變化 */
  rep?: number;
  /** 那間店庫存每日損失比例（0–1） */
  stockLoss?: number;
}
export interface PatrolIncident {
  text: string;
  /** 罰款／賠款（日圓） */
  fine?: number;
  rep?: number;
  closeTicks?: number;
  repair?: number;
  stockLossPct?: number;
  /** 引發這種法律糾紛的機率 */
  legal?: { kind: LegalKind; p: number };
  /** 讓這種稽查提早到來 */
  inspect?: "hygiene" | "fire";
}

export interface PatrolKindDef {
  id: string;
  label: string;
  icon: string;
  /** 這種問題會出現在哪些檢查點 */
  spots: string[];
  groups?: string[];
  zones?: string[];
  categories?: string[];
  weight: number;
  /** 線索：[很模糊（嚴重度 1–2）, 比較明確（3 以上）]，{shop} 是店名 */
  hints: [string, string];
  /** 查明之後的說明 */
  detail: string;
  /** 嚴重度 1 時的處理費用（實際 = 基本費 × (0.6 + 0.4 × 嚴重度)） */
  cost: number;
  daily: PatrolEffects;
  /** 每天每嚴重度增加的官司機率（併入法務的每日結算） */
  legal?: { kind: LegalKind; hazard: number };
  /** 稽查時的扣分類別 */
  inspection?: "hygiene" | "fire";
  incident: PatrolIncident;
}

export const PATROL_KINDS: Record<string, PatrolKindDef> = {
  hygiene_corner: {
    id: "hygiene_corner", label: "衛生死角", icon: "🪳", spots: ["back", "restroom", "floor"], groups: ["food"], weight: 3,
    hints: ["角落有股說不上來的味道。", "牆角發現髒污與蟲跡，明顯很久沒人清了。"],
    detail: "後場或角落的清潔做得不徹底，容易滋生蟲害與細菌。", cost: 8_000,
    daily: { clean: -0.25 }, legal: { kind: "food_poison", hazard: 0.0008 }, inspection: "hygiene",
    incident: { text: "衛生死角釀成食安疑慮，客人投訴後保健所來關切。", fine: 30_000, rep: -0.6, legal: { kind: "food_poison", p: 0.35 }, inspect: "hygiene" },
  },
  cold_chain: {
    id: "cold_chain", label: "冷藏故障", icon: "🌡️", spots: ["cold"], groups: ["food"], weight: 2,
    hints: ["冷藏櫃的聲音有點怪、摸起來沒那麼冰。", "冷藏溫度明顯偏高，食材已經在變質邊緣。"],
    detail: "冷藏設備效能下降，食材保存溫度不足。", cost: 20_000,
    daily: { stockLoss: 0.012 }, legal: { kind: "food_poison", hazard: 0.0007 }, inspection: "hygiene",
    incident: { text: "冷藏櫃停擺，整批食材報廢。", stockLossPct: 0.4, repair: 25_000, legal: { kind: "food_poison", p: 0.2 } },
  },
  expired_goods: {
    id: "expired_goods", label: "過期品", icon: "⏳", spots: ["cold", "back"], groups: ["food"], weight: 2,
    hints: ["有些標籤的日期好像模糊了。", "架上發現已過期的食材，還混在新貨裡。"],
    detail: "先進先出沒做好，過期食材留在庫裡。", cost: 6_000,
    daily: { fresh: -0.8 }, legal: { kind: "food_poison", hazard: 0.0006 }, inspection: "hygiene",
    incident: { text: "客人吃到過期食材，鬧上社群，被迫回收。", fine: 50_000, rep: -0.8 },
  },
  gas_oil: {
    id: "gas_oil", label: "油煙・瓦斯隱患", icon: "🔥", spots: ["back", "equip"], groups: ["food"], weight: 1.5,
    hints: ["排油煙機上積了厚厚一層油。", "瓦斯接頭有輕微的漏氣味，油垢快要堵住排煙管。"],
    detail: "排油煙設備與瓦斯管線久未檢修，有起火風險。", cost: 15_000,
    daily: { equip: -0.15 }, inspection: "fire",
    incident: { text: "排油煙管起火，店面暫停營業整修。", closeTicks: 36, repair: 60_000, inspect: "fire", rep: -0.5 },
  },
  allergen_label: {
    id: "allergen_label", label: "過敏原標示不全", icon: "🥜", spots: ["counter", "floor"], groups: ["food"], weight: 2,
    hints: ["菜單上好像少了什麼說明。", "菜單沒有標示主要過敏原，店員也答不出來。"],
    detail: "食品表示法要求標示過敏原；沒標或標錯，出了事店家要負責。", cost: 5_000,
    daily: {}, legal: { kind: "allergy", hazard: 0.0015 }, inspection: "hygiene",
    incident: { text: "客人因過敏送醫，指責菜單沒有標示。", legal: { kind: "allergy", p: 0.6 }, rep: -0.5 },
  },
  mispriced: {
    id: "mispriced", label: "標價錯誤", icon: "🏷️", spots: ["floor", "counter"], groups: ["retail", "food"], weight: 2,
    hints: ["標價牌和收銀機的數字好像對不太上。", "好幾樣商品的標價與結帳價不同，客人已經在抱怨。"],
    detail: "價格牌沒更新或標示不實（景品表示法的不當表示）。", cost: 4_000,
    daily: { rep: -0.03 }, legal: { kind: "misleading", hazard: 0.001 },
    incident: { text: "標價與實際價格不符，被消費生活中心接獲通報。", fine: 40_000, rep: -0.6, legal: { kind: "misleading", p: 0.3 } },
  },
  defective_stock: {
    id: "defective_stock", label: "瑕疵品流入", icon: "🧵", spots: ["stock", "floor"], groups: ["retail"], weight: 2,
    hints: ["有幾樣商品包裝看起來怪怪的。", "進貨裡混了明顯有瑕疵的商品，還擺在架上賣。"],
    detail: "驗貨不確實，瑕疵品上架。", cost: 7_000,
    daily: { fresh: -0.5 }, legal: { kind: "defect", hazard: 0.001 },
    incident: { text: "客人買到瑕疵品要求賠償，並把照片貼上網。", fine: 30_000, rep: -0.5, legal: { kind: "defect", p: 0.35 } },
  },
  shoplift: {
    id: "shoplift", label: "失竊・扒手", icon: "🕵️", spots: ["floor", "counter", "stock"], groups: ["retail"], weight: 2,
    hints: ["盤點時數字好像少了一點。", "同一批人反覆出現在死角，貨品確實不見了。"],
    detail: "死角沒人看、監視設備不足，貨品持續遺失。", cost: 6_000,
    daily: { stockLoss: 0.01 },
    incident: { text: "一次性被偷走大批貨品。", stockLossPct: 0.25, rep: -0.2 },
  },
  crowd_flow: {
    id: "crowd_flow", label: "動線擁擠", icon: "🚷", spots: ["floor", "restroom", "stage"], weight: 2,
    hints: ["尖峰時段這一帶人擠人。", "動線被擺放物堵住，客人要側身才能通過。"],
    detail: "動線設計不良，尖峰時容易推擠、客人不耐煩。", cost: 5_000,
    daily: { rep: -0.03 }, legal: { kind: "injury", hazard: 0.0004 },
    incident: { text: "擁擠中有客人跌倒受傷。", fine: 20_000, rep: -0.4, legal: { kind: "injury", p: 0.4 } },
  },
  equipment_wear: {
    id: "equipment_wear", label: "設備異音", icon: "🔧", spots: ["equip", "stage"], weight: 3,
    hints: ["設備運轉時有點怪聲。", "馬達聲音很吵、還有焦味，隨時可能故障。"],
    detail: "設備零件磨損，沒有及時維修。", cost: 10_000,
    daily: { equip: -0.2 },
    incident: { text: "設備突然故障，店面緊急停業搶修。", closeTicks: 36, repair: 30_000 },
  },
  fire_safety: {
    id: "fire_safety", label: "消防設備不良", icon: "🧯", spots: ["safety", "equip"], weight: 2,
    hints: ["滅火器的壓力表好像在紅區邊緣。", "安全門被貨物擋住，滅火器已經過期。"],
    detail: "消防器材過期、避難口被堵（違反消防法）。", cost: 9_000,
    daily: {}, legal: { kind: "injury", hazard: 0.0006 }, inspection: "fire",
    incident: { text: "消防查核發現重大缺失，限期改善並罰款。", fine: 80_000, inspect: "fire", rep: -0.4 },
  },
  staff_slack: {
    id: "staff_slack", label: "員工怠工", icon: "😪", spots: ["staff", "counter"], weight: 2,
    hints: ["員工的精神好像不太好。", "員工士氣低落、互相推託，服務明顯變差。"],
    detail: "排班與休息安排不當，員工士氣低。", cost: 8_000,
    daily: { fresh: -0.6, rep: -0.02 },
    incident: { text: "員工當著客人的面吵起來，客人傳到網路上。", rep: -0.7 },
  },
  privacy_slip: {
    id: "privacy_slip", label: "個資管理疏漏", icon: "🔓", spots: ["data", "counter"], zones: ["life", "biz"], categories: ["cosmetics", "drugstore", "convenience"], weight: 2,
    hints: ["預約簿隨便放在櫃台上。", "客戶資料沒有上鎖、電腦也沒設密碼。"],
    detail: "個人資料沒有妥善保管（個人情報保護法的安全管理措施義務）。", cost: 10_000,
    daily: {}, legal: { kind: "privacy", hazard: 0.0012 },
    incident: { text: "客戶資料外流，多位客人要求說明與賠償。", legal: { kind: "privacy", p: 0.6 }, rep: -0.6 },
  },
  license_lapse: {
    id: "license_lapse", label: "證照過期", icon: "📄", spots: ["counter", "treat", "data"], groups: ["service"], weight: 1.5,
    hints: ["牆上的證照好像是舊的。", "必要的許可證或資格證已經過期了。"],
    detail: "營業許可或專業資格逾期未更新。", cost: 12_000,
    daily: {}, inspection: "hygiene",
    incident: { text: "稽查發現證照過期，被命令改善並處以罰款。", fine: 100_000, rep: -0.4, inspect: "hygiene" },
  },
  sterilize: {
    id: "sterilize", label: "器具消毒不足", icon: "🧴", spots: ["treat"], zones: ["life"], weight: 2,
    hints: ["器具的收納看起來沒那麼乾淨。", "器具沒有確實消毒，還混用了不同客人的用品。"],
    detail: "消毒流程沒落實，有感染風險。", cost: 9_000,
    daily: {}, legal: { kind: "malpractice", hazard: 0.0012 }, inspection: "hygiene",
    incident: { text: "客人感染後求償，保健所跟進調查。", legal: { kind: "malpractice", p: 0.5 }, rep: -0.6, inspect: "hygiene" },
  },
  ride_safety: {
    id: "ride_safety", label: "設施安全隱患", icon: "🎢", spots: ["stage", "safety"], groups: ["entertainment"], weight: 2,
    hints: ["設施的接縫有點鬆動。", "安全帶與護欄的固定件磨損，已經有客人覺得晃。"],
    detail: "遊樂或展演設施的固定與檢查不確實（民法717條工作物責任）。", cost: 18_000,
    daily: {}, legal: { kind: "injury", hazard: 0.0015 }, inspection: "fire",
    incident: { text: "設施出了意外，客人受傷，現場停止營運。", closeTicks: 24, repair: 40_000, legal: { kind: "injury", p: 0.6 }, rep: -0.8 },
  },
  age_limit: {
    id: "age_limit", label: "年齡限制管理", icon: "🔞", spots: ["counter", "stage"], categories: ["arcade_vr", "karaoke", "live_house", "bowling", "bar", "craft_beer", "wine_bar", "izakaya", "beer_garden"], weight: 1.5,
    hints: ["入口好像沒有確認年齡。", "未成年客人在不該待的時段出入，也沒人詢問。"],
    detail: "年齡與時段限制沒落實（風營法、未成年保護相關規定）。", cost: 6_000,
    daily: {}, inspection: "fire",
    incident: { text: "被查到讓未成年人在限制時段進入，被處以罰款。", fine: 80_000, rep: -0.5 },
  },
  noise: {
    id: "noise", label: "噪音抱怨", icon: "📢", spots: ["stage", "floor"], groups: ["entertainment"], zones: ["dining", "plaza"], weight: 1.5,
    hints: ["鄰近的店家投來不太友善的目光。", "音量太大，附近住戶已經去區公所陳情。"],
    detail: "音量與營業時間的管理不當。", cost: 5_000,
    daily: { rep: -0.04 },
    incident: { text: "住戶連署抗議噪音，上了地方新聞。", rep: -0.8, fine: 20_000 },
  },
  guest_property: {
    id: "guest_property", label: "住客物品管理", icon: "🧳", spots: ["rooms", "counter"], categories: ["hotel", "capsule_hotel", "luggage"], weight: 2,
    hints: ["寄放區的標籤有點亂。", "行李與遺失物沒有登記，住客找不到自己的東西。"],
    detail: "財物保管流程不完整（旅館業法與民法的保管責任）。", cost: 6_000,
    daily: {}, legal: { kind: "lodging", hazard: 0.0012 },
    incident: { text: "住客遺失貴重物品，要求賠償。", legal: { kind: "lodging", p: 0.6 }, rep: -0.4 },
  },
};

export const PATROL_KIND_ORDER = Object.keys(PATROL_KINDS);

/** 這個業態在這個檢查點可能冒出的問題種類 */
export function patrolKindsFor(category: string, spot?: string): PatrolKindDef[] {
  const cat = CATEGORY_BY_ID[category];
  if (!cat) return [];
  const mine = spotsOf(category);
  return PATROL_KIND_ORDER.map((k) => PATROL_KINDS[k]!).filter((k) => {
    if (!k.spots.some((sp) => mine.includes(sp))) return false;
    if (spot && !k.spots.includes(spot)) return false;
    const hasFilter = !!(k.groups || k.zones || k.categories);
    if (!hasFilter) return true;
    return !!(k.categories?.includes(cat.id) || k.groups?.includes(cat.group) || k.zones?.includes(cat.zone));
  });
}

// ───────── 規則 ─────────

export const PATROL_SESSION_TICKS = 36;
export const PATROL_COOLDOWN_TICKS = 12;
export const PATROL_BASE_AP = 3;
export const PATROL_MAX_ISSUES_PER_SHOP = 3;
export const PATROL_MAX_ISSUES = 14;
/** 嚴重度每隔幾天加一級；到頂後再拖幾天就變成事故 */
export const PATROL_ESCALATE_DAYS = 2;
export const PATROL_INCIDENT_DAYS = 8;
export const PATROL_SCHEDULE_DAYS = 2;
/** 兩次事故之間至少隔幾個遊戲日 */
export const PATROL_INCIDENT_GAP_DAYS = 4;
/** 處理完之後，這個檢查點多久不會再冒新問題（遊戲日） */
export const PATROL_CLEARED_DAYS = { now: 10, schedule: 10, pro: 30 } as const;

export function patrolLevel(xp: number): number {
  return Math.min(10, Math.floor(Math.sqrt(Math.max(0, xp) / 2)));
}
export function patrolAp(xp: number, inspectionSoon: boolean): number {
  return PATROL_BASE_AP + Math.floor(patrolLevel(xp) / 3) + (inspectionSoon ? 1 : 0);
}
/** 檢查一個點時，發現它有問題的機率 */
export function detectChance(severity: number, xp: number): number {
  return Math.min(0.95, 0.55 + 0.04 * patrolLevel(xp) + 0.05 * (severity - 1));
}
export function fixCost(kindId: string, severity: number, option: FixOption): number {
  const k = PATROL_KINDS[kindId];
  if (!k) return 0;
  const base = k.cost * (0.6 + 0.4 * severity);
  return Math.round((base * { now: 1, schedule: 0.5, pro: 2.2 }[option]) / 100) * 100;
}
export type FixOption = "now" | "schedule" | "pro";
export const FIX_OPTIONS: { id: FixOption; label: string; desc: string }[] = [
  { id: "now", label: "立刻處理", desc: "付全額，當場修好；這個地方 10 天內不太會再出問題。" },
  { id: "schedule", label: "排程處理", desc: `半價，${PATROL_SCHEDULE_DAYS} 天後修好；在那之前問題不會再惡化、但影響照舊。` },
  { id: "pro", label: "請專業處理", desc: "2.2 倍價錢，一次根治：30 天內不會再犯，合規分數 +2。" },
];

/** 這間店現在的隱藏問題帶來的額外官司風險（每天，已乘嚴重度；hidden 與其他狀態都算） */
export function issueLegalHazard(patrol: Pick<PatrolState, "issues"> | undefined, shopId: string): { total: number; kinds: [LegalKind, number][] } {
  const by = new Map<LegalKind, number>();
  let total = 0;
  for (const i of patrol?.issues ?? []) {
    if (i.shopId !== shopId) continue;
    const l = PATROL_KINDS[i.kind]?.legal;
    if (!l) continue;
    const h = l.hazard * i.severity;
    total += h;
    by.set(l.kind, (by.get(l.kind) ?? 0) + h);
  }
  return { total, kinds: [...by.entries()] };
}

/** 稽查扣分：沒處理的相關問題（每件嚴重度 × 1.2，上限 12） */
export function issueInspectionPenalty(patrol: Pick<PatrolState, "issues"> | undefined, kind: "hygiene" | "fire"): number {
  let p = 0;
  for (const i of patrol?.issues ?? []) {
    if (PATROL_KINDS[i.kind]?.inspection === kind) p += i.severity * 1.2;
  }
  return Math.min(12, Math.round(p));
}

/** 官司證據力扣分：這間店還沒處理的問題（每件嚴重度 × 1.5，上限 15） */
export function issueEvidencePenalty(patrol: Pick<PatrolState, "issues"> | undefined, shopId: string): number {
  let p = 0;
  for (const i of patrol?.issues ?? []) if (i.shopId === shopId) p += i.severity * 1.5;
  return Math.min(15, Math.round(p));
}

export function newPatrolState(): PatrolState {
  return { issues: [], session: null, nextTick: 0, xp: 0, foundTotal: 0, fixedTotal: 0, incidents: 0, cleared: {}, report: null };
}

/** 給玩家看的版本：沒被發現的問題不存在；只有線索的問題不透露種類與嚴重度 */
export function publicPatrol(p: PatrolState | undefined): PatrolState | undefined {
  if (!p) return p;
  const issues: PatrolIssue[] = [];
  for (const i of p.issues) {
    if (i.status === "hidden") continue;
    if (i.status === "hinted") issues.push({ ...i, kind: "unknown", severity: 0 });
    else issues.push(i);
  }
  return { ...p, issues };
}

export const DAY = TICKS_PER_DAY;
