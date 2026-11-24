// 遊戲共用型別：模擬引擎（server）與介面（client）共用。
// 狀態全部是純 JSON，方便存進資料庫與跨網路傳輸。
// 區域、業態、事件、解鎖條件全部是「資料」，新增內容不需改引擎。

export type PersonaId = "tourist" | "local" | "commuter" | "family" | "student" | "couple";
export type IndexId = "localRep" | "touristHeat";
/** 業態 ID，定義在 data（例如 ramen、cinema） */
export type CategoryId = string;
export type ZoneId = string;

export interface PersonaDef {
  id: PersonaId;
  name: string;
  /** 在標準人氣（50）、標準多樣性下，平日一天會來的「團體數」 */
  dailyBase: number;
  /** 平日 24 小時的到訪比例，總和為 1 */
  hourShare: number[];
  /** 假日 24 小時的到訪比例（尖峰時段與形狀和平日不同），總和為 1 */
  weekendHourShare: number[];
  /** 假日總量倍率 */
  weekendMult: number;
  /** 價格敏感度（越高越在意價格） */
  sensitivity: number;
  /** 每個團體的人數（購買份數）範圍 */
  party: [number, number];
  /** 偏好哪個人氣指標：local／tourist／both */
  index: IndexId | "both";
}

export type CategoryGroup = "food" | "retail" | "entertainment" | "service";

export interface CategoryDef {
  id: CategoryId;
  name: string;
  group: CategoryGroup;
  zone: ZoneId;
  /** 參考售價（價格合理度以此為基準） */
  refPrice: number;
  /** 進貨／變動成本占參考售價比例（服務型較低） */
  costRatio: number;
  /** 每個 tick 每間店最多能服務幾份（level 1） */
  baseCapacity: number;
  /** 各客人類型的需求權重 0..1（未列出視為 0） */
  demand: Partial<Record<PersonaId, number>>;
  /** 每日人事固定成本（level 1） */
  wage: number;
  /** 新開店面的建造費用 */
  buildCost: number;
  /** 建造所需 tick 數 */
  buildTicks: number;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  tier: number;
  slots: number;
  /** 解鎖所需商場等級 */
  unlockLevel: number;
  description: string;
}

export interface LevelDef {
  level: number;
  /** 累積營收門檻 */
  minRevenue: number;
  /** 兩項人氣指標平均門檻 */
  minIndexAvg: number;
}

export interface RestockRule {
  enabled: boolean;
  /** 庫存（含在途）低於此值時補貨 */
  min: number;
  /** 補到此數量 */
  target: number;
  /** 每日採購預算上限 */
  dailyBudget: number;
}

export interface ShopDayStats {
  revenue: number;
  units: number;
  groups: number;
  stockouts: number;
  lost: number;
}

export interface Shop {
  id: string;
  slot: number;
  category: CategoryId;
  name: string;
  level: number;
  /** 新鮮感 0–100：會隨時間退流行，需要換菜單／做活動補回 */
  freshness: number;
  /** direct＝直營（賺全部營收）；lease＝出租（收租金＋抽成） */
  mode: "direct" | "lease";
  price: number;
  stock: number;
  incoming: { arriveTick: number; qty: number }[];
  restock: RestockRule;
  spentToday: number;
  /** 出租模式：每日租金與營收抽成比例 */
  rent: number;
  commission: number;
  /** 故障／停電時暫停營業，直到此 tick 為止 */
  closedUntilTick: number;
  /** 本 tick 已服務份數（內部使用，每 tick 重置） */
  served: number;
  day: ShopDayStats;
  /** 目前上架的招牌／新品（研發工坊做出來的） */
  menu: MenuEntry[];
}

export interface Slot {
  id: number;
  zone: ZoneId;
  shopId: string | null;
}

export interface BuildTask {
  id: string;
  kind: "open" | "upgrade";
  slot: number;
  category?: CategoryId;
  shopId?: string;
  completeTick: number;
  cost: number;
}

/** 白名單效果：事件只能使用這些，並且數值會被夾限。 */
export type EffectSpec =
  | { t: "traffic"; persona: PersonaId | "all"; mult: number; ticks: number }
  | { t: "supply"; mult: number; ticks: number }
  | { t: "demand"; category: CategoryId; mult: number; ticks: number }
  | { t: "funds"; amount: number }
  | { t: "index"; which: IndexId; amount: number }
  | { t: "stockLoss"; pct: number }
  | { t: "close"; ticks: number; count?: number }
  | { t: "equipment"; amount: number }
  | { t: "cleanliness"; amount: number }
  // ── 供應商戲劇（對象是該貨品目前的主力供應商；family "best"＝關係最好的那家）
  | { t: "supplierStatus"; family: SupplyFamily; status: Exclude<SupplierStatus, "ok">; ticks: number; which?: "main" | "other" }
  | { t: "supplierPrice"; family: SupplyFamily | "best"; mult: number; ticks: number }
  | { t: "supplierRel"; family: SupplyFamily | "best"; amount: number }
  | { t: "supplierSwitch"; family: SupplyFamily }
  | { t: "supplierNegotiate"; family: SupplyFamily }
  | { t: "supplierDiscover" }
  | { t: "familyFreshness"; family: SupplyFamily; amount: number };

export type EventCategory =
  | "weather"
  | "facility"
  | "crowd"
  | "supply"
  | "market"
  | "luck"
  | "festival"
  | "guest";

export interface EventOption {
  id: string;
  label: string;
  effects: EffectSpec[];
}

export interface EventDef {
  id: string;
  category: EventCategory;
  title: string;
  text: string;
  weight: number;
  cooldownTicks: number;
  /** 需要已解鎖的區域（未列出＝隨時可能發生） */
  needsZone?: ZoneId;
  /** 需要商場有用到這種貨品（有直營的進貨店面）；"any"＝任何一種 */
  needsFamily?: SupplyFamily | "any";
  /** 需要某家主力供應商關係值達到多少（長期合作的回饋） */
  needsRel?: number;
  /** 需要還有沒發現的供應商 */
  needsUndiscovered?: boolean;
  when?: { months?: number[]; hours?: [number, number] };
  /**
   * 沒人在場時發生這個事件要不要讓時鐘暫停等人處理。
   * "pause"＝預設處理很貴／來不及就損失大（必須有選項）；預設 "auto"＝照常用預設處理繼續營運。
   */
  attention?: "auto" | "pause";
  /** 事件發生當下立即套用 */
  effects: EffectSpec[];
  /** 有選項的事件：逾時未回應就採預設選項 */
  choice?: { deadlineTicks: number; defaultOption: string; options: EventOption[] };
}

export type Modifier =
  | { kind: "traffic"; persona: PersonaId | "all"; mult: number; endTick: number }
  | { kind: "supply"; mult: number; endTick: number }
  | { kind: "demand"; category: CategoryId; mult: number; endTick: number };

export interface PendingChoice {
  uid: string;
  defId: string;
  deadlineTick: number;
}

export interface LogEntry {
  tick: number;
  kind: "event" | "build" | "order" | "warn" | "info";
  text: string;
}

export interface DayStats {
  /** JST 日序（自 1970-01-01 起算的天數） */
  day: number;
  revenue: number;
  /** 出租抽成與租金收入 */
  rentIncome: number;
  purchases: number;
  fixed: number;
  repairs: number;
  groups: number;
  units: number;
  walkouts: number;
  satSum: Record<PersonaId, number>;
  satN: Record<PersonaId, number>;
  groupsByPersona: Record<PersonaId, number>;
  startIndex: { localRep: number; touristHeat: number };
  events: string[];
  /** 今日客人互動：收到的客訴數、客訴累計處理、收到的評價數與星數總和 */
  complaints: number;
  reviews: number;
  starsSum: number;
  /** 今天常客的消息（新登場、解鎖故事、不開心…） */
  regularNotes: string[];
  regularVisits: number;
  /** 今天的活動與稽查消息 */
  systemNotes: string[];
  /** 今天的消費稅：銷項、進項（可扣抵的部分） */
  outTax: number;
  inTax: number;
  /** 今天營運支出中可扣抵進項稅的部分（水電、清潔維護） */
  fixedCredit: number;
}

export interface DailyReport {
  day: number;
  date: string;
  revenue: number;
  rentIncome: number;
  purchases: number;
  fixed: number;
  repairs: number;
  profit: number;
  groups: number;
  units: number;
  walkouts: number;
  avgSat: Record<PersonaId, number | null>;
  shops: { id: string; name: string; category: CategoryId; revenue: number; units: number; stockouts: number; lost: number }[];
  localRep: { start: number; end: number };
  touristHeat: { start: number; end: number };
  events: string[];
  headline: string;
  notes: string[];
  guest?: { complaints: number; reviews: number; avgStars: number | null };
}

/** 傳給玩家的狀態：不含亂數種子與內部冷卻／累積表 */
export type PublicMallState = Omit<MallState, "seed" | "cooldowns" | "grievances">;

// ───────── 客人互動層 ─────────

export type ComplaintCause = "stockout" | "wait" | "price" | "dirty" | "facility" | "quality";
/** 客人的語氣（玩家看得到；是不是「奧客」要自己從語氣判斷，不會直接告訴你） */
export type ComplaintTone = "sincere" | "angry" | "demanding";
/** 離線時的客訴處理偏好 */
export type Stance = "soft" | "balanced" | "firm";
export type ReviewReplyId = "polite" | "funny" | "sincere" | "ignore";

/** 收件匣：等你處理的客人互動（客訴、評價） */
export interface InboxItem {
  uid: string;
  kind: "complaint" | "review";
  createdTick: number;
  deadlineTick: number;
  shopId: string | null;
  persona: PersonaId;
  text: string;
  cause?: ComplaintCause;
  tone?: ComplaintTone;
  stars?: number;
}

export interface ReviewRecord {
  tick: number;
  persona: PersonaId;
  stars: number;
  text: string;
  shopName: string | null;
  /** 怎麼回的；"auto" 代表用了離線自動回覆 */
  reply: ReviewReplyId | "auto" | null;
}

/** 巡場時聽到的客人心聲 */
export interface WalkVoice {
  id: string;
  shopId: string;
  persona: PersonaId;
  mood: "happy" | "annoyed" | "angry" | "curious";
  situation: string;
  text: string;
  expireTick: number;
}

// ───────── 供應商 ─────────

export type SupplyFamily = "meat" | "seafood" | "grain" | "produce" | "sweets" | "goods";
export type SupplierStatus = "ok" | "shortage" | "strike" | "closed" | "cold";

export interface SupplierDef {
  id: string;
  name: string;
  family: SupplyFamily;
  /** 相對於基準進貨價的倍率 */
  price: number;
  /** 品質 0–1：影響店家的口味表現 */
  quality: number;
  /** 可靠度 0–1：越低越容易延遲 */
  reliability: number;
  /** 出貨時間倍率（越小越快） */
  lead: number;
  bio: string;
  /** 一開始沒人認識，要靠事件才會出現 */
  hidden?: boolean;
  /** false＝沒有登錄成發票制度的適格請求書發行事業者（小型業者），進項稅額只能部分扣抵 */
  invoice?: boolean;
}

export interface SupplierState {
  id: string;
  discovered: boolean;
  /** 關係值 0–100：訂越多越好；高了有折扣、缺貨時優先供貨 */
  relationship: number;
  status: SupplierStatus;
  statusUntil: number;
  /** 暫時的漲跌價（事件造成） */
  priceMult: number;
  priceUntil: number;
  /** 長約：鎖定價格、缺貨時優先供貨 */
  contract: { lockedMult: number; untilTick: number } | null;
  orders: number;
}

export interface SupplyState {
  suppliers: SupplierState[];
  /** 每種貨品目前的主力供應商 */
  choice: Record<string, string>;
  /** 主力無法出貨時，自動向備用供應商（現貨，貴一成）補貨 */
  autoFallback: boolean;
}

// ───────── NPC 對手商場（商戰） ─────────

export type RivalStance = "defend" | "neutral" | "aggressive";
export type RivalCampaignKind = "price_war" | "grand_opening" | "tourist_blitz" | "luxury_event" | "food_fest" | "scandal";

export interface RivalCampaign {
  kind: RivalCampaignKind;
  startTick: number;
  endTick: number;
  /** 對各類客人吸引力的加減（scandal 是負的） */
  boost: Partial<Record<PersonaId, number>>;
  /** 玩家反制後的效果倍率（1＝沒反制，0.5＝被削弱一半） */
  factor: number;
}

export interface RivalDef {
  id: string;
  name: string;
  tagline: string;
  bio: string;
  /** 實力偏移：正的比一般強 */
  bias: number;
  /** 各類客人的強項倍率（大於 1 是強項） */
  profile: Record<PersonaId, number>;
  campaigns: RivalCampaignKind[];
}

export interface RivalState {
  id: string;
  appeal: Record<PersonaId, number>;
  campaign: RivalCampaign | null;
  /** 情報：到這個 tick 之前看得到他們的細節 */
  intelUntil: number;
  /** 合作協議：到這個 tick 之前他們不會對你出招 */
  pactUntil: number;
}

export interface NewsItem {
  tick: number;
  text: string;
}

export interface RivalsState {
  list: RivalState[];
  stance: RivalStance;
  news: NewsItem[];
  /** 下一次有對手動作的 tick（每座對手各自排程在 nextAt 裡） */
  nextAt: Record<string, number>;
}

// ───────── 優惠活動（行銷） ─────────

export interface PromoDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  durationTicks: number;
  /** 預算（排程時就付掉；活動開始前取消可全額退回） */
  cost: number;
  cooldownTicks: number;
  /** 客人實際付的價格打幾折（0.15＝便宜 15%），會讓營收變少、客人更滿意 */
  discount: number;
  /** 各類客人的客流倍率；all 是其餘客人的預設 */
  traffic: Partial<Record<PersonaId | "all", number>>;
  /** 額外的滿意度加成 */
  satBonus: number;
  /** 活動期間常客親密度的增加倍率 */
  regularGain?: number;
  /** 開始時的一次性人氣變動 */
  idx?: { which: IndexId; amount: number };
  /** 開始時，直營店的新鮮感增加量 */
  freshness?: number;
  /** 疲勞：辦一次累積多少「促銷疲勞」（客人看膩了，之後的活動效果會打折） */
  fatigue: number;
}

export interface ActivePromo {
  uid: string;
  defId: string;
  startTick: number;
  endTick: number;
  /** 開始當下的疲勞折扣（1＝全效，越小越打折）；整場活動都用這個 */
  factor: number;
  /** 活動期間成交的組數與營收（結束時結算成效） */
  groups: number;
  revenue: number;
}

export interface ScheduledPromo {
  uid: string;
  defId: string;
  startTick: number;
  cost: number;
}

export interface PromoResult {
  defId: string;
  startTick: number;
  endTick: number;
  groups: number;
  revenue: number;
  cost: number;
}

export interface PromoState {
  active: ActivePromo[];
  scheduled: ScheduledPromo[];
  /** 0–1：促銷疲勞 */
  fatigue: number;
  lastEnd: Record<string, number>;
  history: PromoResult[];
}

// ───────── 稽查與合規 ─────────

export type InspectionKind = "hygiene" | "fire";
export type InspectionPrep = "none" | "basic" | "full";
export type InspectionOutcome = "excellent" | "pass" | "warning" | "fine" | "suspend";

/** 已預告、還沒來的稽查：趁這段時間可以備戰 */
export interface InspectionNotice {
  uid: string;
  kind: InspectionKind;
  notifiedTick: number;
  inspectTick: number;
  prep: InspectionPrep | null;
}

export interface InspectionResult {
  tick: number;
  kind: InspectionKind;
  score: number;
  outcome: InspectionOutcome;
  fine: number;
  prep: InspectionPrep | null;
  /** 沒有預告的突襲 */
  surprise: boolean;
}

export interface InspectionState {
  pending: InspectionNotice[];
  /** 0–100：合規分數。越低，稽查來得越頻繁 */
  compliance: number;
  log: InspectionResult[];
  nextAt: Record<string, number>;
}

// ───────── 常客 ─────────

export interface RegularStory {
  /** 親密度達到多少解鎖 */
  at: number;
  title: string;
  text: string;
  reward: { funds?: number; idx?: number };
}

export interface RegularDef {
  id: string;
  name: string;
  persona: PersonaId;
  /** 最愛的業態；沒有這類店就不會出現 */
  fav: CategoryId;
  /** 找不到最愛時的第二選擇 */
  alt?: CategoryId;
  /** 價格容忍度：願意付到參考價的幾倍 */
  budget: number;
  /** 還沒遇見時顯示的線索 */
  hint: string;
  bio: string;
  /** 「記住喜好」之後才看得到 */
  traits: string[];
  stories: RegularStory[];
}

export interface RegularState {
  id: string;
  /** 遇見過了（第一次上門之後） */
  met: boolean;
  affinity: number;
  visits: number;
  lastVisitTick: number;
  mood: "happy" | "neutral" | "upset";
  /** 已解鎖的故事數 */
  storyStage: number;
  lastTalkTick: number;
  lastGiftTick: number;
  knowsPrefs: boolean;
  /** 保留專屬座位（每日有維持費；來得更勤、小費更多） */
  reserved: boolean;
  tipsTotal: number;
}

export interface GuestPrefs {
  complaintStance: Stance;
  /** 評價沒人回時，自動送出禮貌的回覆 */
  autoReplyReviews: boolean;
}

/** 時間流速檔位（倍率相對於基準 TIME_SCALE） */
export type SpeedId = "standard" | "relaxed" | "slow" | "glacial";

/**
 * 每座商場自己的時鐘。真實時間 → tick 的換算只看這個，
 * 模擬引擎本身只認 tick，所以暫停／調速都不需要改引擎。
 */
export interface MallClock {
  /** 玩家選擇的流速倍率（1＝標準：真實 6 小時為 1 遊戲日） */
  speed: number;
  /** 換算錨點：真實時間 anchorRealMs 對應 tick anchorTick */
  anchorRealMs: number;
  anchorTick: number;
  /** 任何一個暫停原因成立，有效流速就是 0（時間靜止） */
  holds: {
    /** 玩家手動暫停 */
    manual: boolean;
    /** 久未上線自動暫停 */
    idle: boolean;
    /** 因待處理重要事件而暫停（事件 uid） */
    events: string[];
  };
  /** 沒人在場時遇到重要事件是否自動暫停 */
  pauseOnEvents: boolean;
  /** 全員超過幾個真實日沒上線就自動暫停；null＝關閉 */
  idlePauseDays: number | null;
  /** 最後一次有成員造訪的真實時間 */
  lastVisitRealMs: number;
}

export interface MallState {
  version: 8;
  clock: MallClock;
  seed: number;
  tick: number;
  funds: number;
  totalRevenue: number;
  level: number;
  /** 功能旗標：開發階段用來開關內容（例如 zone:b1、feature:lease） */
  flags: Record<string, boolean>;
  hours: { open: number; close: number };
  localRep: number;
  touristHeat: number;
  peakLocal: number;
  peakTourist: number;
  cleanliness: number;
  equipment: number;
  cleaningLevel: 0 | 1 | 2;
  maintenanceLevel: 0 | 1 | 2;
  slots: Slot[];
  shops: Shop[];
  builds: BuildTask[];
  modifiers: Modifier[];
  pending: PendingChoice[];
  cooldowns: Record<string, number>;
  /** 各店各種不滿的累積（內部用，滿了就變成一則客訴）：鍵為 "shopId:cause" */
  grievances: Record<string, number>;
  inbox: InboxItem[];
  regulars: RegularState[];
  promos: PromoState;
  inspections: InspectionState;
  supply: SupplyState;
  rivals: RivalsState;
  workshop: WorkshopState;
  tax: TaxState;
  reviewLog: ReviewRecord[];
  guestPrefs: GuestPrefs;
  walk: { nextTick: number; voices: WalkVoice[] };
  today: DayStats;
  reports: DailyReport[];
  log: LogEntry[];
  nextId: number;
}

// ───────── 研發工坊 ─────────

/** 研發的四個槽位：主料／調味（風格）／手法／特色（選填） */
export type SlotKind = "base" | "season" | "method" | "special";

/** 玩家已經認識的素材。特性（標籤）要靠試做才會慢慢掌握 */
export interface IngredientInfo {
  id: string;
  group: CategoryGroup;
  slot: SlotKind;
  name: string;
  icon: string;
  cost: number;
  desc: string;
}

/** 食譜本裡的一道菜（餐飲）／商品／企劃／療程 */
export interface Dish {
  id: string;
  name: string;
  icon: string;
  group: CategoryGroup;
  /** 只能在這些業態上架；沒有限制就是同類型都可以 */
  categories?: CategoryId[];
  /** 隱藏配方的代號；null＝自己亂做出來的原創品 */
  recipeId: string | null;
  signature: boolean;
  /** 0–100 */
  quality: number;
  /** 對各客群的吸引力 0–1 */
  appeal: Partial<Record<PersonaId, number>>;
  /** 突出的特性（標籤 id） */
  tags: string[];
  desc: string;
  madeTick: number;
  madeAt: string;
  picks: Partial<Record<SlotKind, string>>;
  /** 新鮮度 0–100：上架時慢慢退流行，收起來會慢慢回復（換季再上，客人又覺得新鮮） */
  novelty: number;
  /** 上架過幾次（第一次上架才有首賣效果） */
  listedCount: number;
}

export interface MenuEntry {
  dishId: string;
  name: string;
  icon: string;
  signature: boolean;
  recipeId: string | null;
  quality: number;
  appeal: Partial<Record<PersonaId, number>>;
  /** 新鮮度 0–100：上架之後慢慢退流行 */
  novelty: number;
  listedTick: number;
}

export interface RndJob {
  uid: string;
  shopId: string;
  picks: Partial<Record<SlotKind, string>>;
  startTick: number;
  endTick: number;
  cost: number;
  sig: string;
}

/** signature＝命中隱藏配方；original＝普通創作；flop＝搭配失衡；burnt＝手滑失敗；almost＝配方對了但火候差一點 */
export type RndOutcome = "signature" | "original" | "flop" | "burnt" | "almost";

export interface Tasting {
  uid: string;
  shopId: string;
  createdTick: number;
  deadlineTick: number;
  outcome: RndOutcome;
  dishId: string | null;
  picks: Partial<Record<SlotKind, string>>;
  feedback: string[];
  /** 接近某個隱藏風味時的提示 */
  clue: string | null;
  /** 這次試做新掌握了哪些素材特性 */
  learned: { ingredientId: string; tag: string }[];
}

export interface ExperimentLog {
  tick: number;
  shopName: string;
  picks: Partial<Record<SlotKind, string>>;
  outcome: RndOutcome;
  dishName: string | null;
  feedback: string[];
}

export interface ClueNote {
  id: string;
  tick: number;
  source: string;
  text: string;
  /** 對應的配方已經被你發現了 */
  solved: boolean;
}

export interface WorkshopState {
  ingredients: IngredientInfo[];
  /** 素材 id → 已掌握的特性（標籤 id） */
  learned: Record<string, string[]>;
  dishes: Dish[];
  /** 已發現的隱藏配方代號 */
  discovered: string[];
  jobs: RndJob[];
  tastings: Tasting[];
  /** 試過的組合 → 結果（同樣的組合不會再給新線索） */
  tried: Record<string, RndOutcome>;
  /** 各店完成的研發次數（廚藝經驗） */
  skill: Record<string, number>;
  log: ExperimentLog[];
  clues: ClueNote[];
}

// ───────── 稅務與法規（日本制度的簡化版） ─────────

export type ObligationKind = "consumption" | "corporate" | "corporate_interim" | "property" | "social" | "bonus" | "royalty";

/** 一張要繳的帳單：到期自動從資金扣款；資金不足就先繳一部分，餘額每天加收延滯稅 */
export interface Obligation {
  uid: string;
  kind: ObligationKind;
  label: string;
  amount: number;
  createdTick: number;
  dueTick: number;
  paid: number;
  lateFee: number;
}

export interface TaxPayment {
  tick: number;
  kind: ObligationKind;
  label: string;
  amount: number;
  /** 是逾期才繳清的 */
  late: boolean;
}

export interface TaxState {
  /** 目前這一季累積的消費稅 */
  quarter: { outputTax: number; inputTax: number };
  /** 目前會計年度（4–3 月）累積的稅前損益、已預繳的中間申報 */
  fy: { profit: number; interimPaid: number };
  /** 可結轉扣抵的虧損 */
  lossCarry: number;
  /** 上一個會計年度的法人稅等總額（中間申報的基準） */
  lastYearCorporate: number;
  /** 這個月累積的薪資（下個月算社會保險與獎金） */
  monthPayroll: number;
  lastMonthPayroll: number;
  /** 這個月 KTV 等需付著作權使用費的營收 */
  monthRoyaltyBase: number;
  bills: Obligation[];
  history: TaxPayment[];
  /** 累計已繳 */
  totalPaid: Record<ObligationKind, number>;
}
