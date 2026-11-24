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
  | { t: "cleanliness"; amount: number };

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
  version: 3;
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
  reviewLog: ReviewRecord[];
  guestPrefs: GuestPrefs;
  walk: { nextTick: number; voices: WalkVoice[] };
  today: DayStats;
  reports: DailyReport[];
  log: LogEntry[];
  nextId: number;
}
