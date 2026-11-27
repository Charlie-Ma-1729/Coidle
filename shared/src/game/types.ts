// 遊戲共用型別：模擬引擎（server）與介面（client）共用。
// 狀態全部是純 JSON，方便存進資料庫與跨網路傳輸。
// 區域、業態、事件、解鎖條件全部是「資料」，新增內容不需改引擎。

import type { FinanceState } from "./finance";

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
  /** 商場要到這個等級才能開（省略＝區域開放就能開） */
  minLevel?: number;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  tier: number;
  slots: number;
  /** 最多還能擴建幾個店面 */
  maxExpand: number;
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
  /** 智慧補貨：依這間店的日均銷量、供應商交期與供應狀況自動決定下限與目標（舊存檔沒有＝固定規則） */
  smart?: boolean;
  /** 智慧補貨要備幾天份的貨（預設 2.5） */
  coverDays?: number;
  /** 智慧補貨：供應商預告要出事（或行情要飆漲）時，先多囤一點（預設開） */
  preShock?: boolean;
}

export interface ShopDayStats {
  revenue: number;
  units: number;
  groups: number;
  stockouts: number;
  lost: number;
  /** 嫌太貴而不買的組數（舊存檔沒有） */
  priceWalks?: number;
  /** 今天賣出的貨（或服務耗材）的成本：份數 × 單位成本（舊存檔沒有） */
  cost?: number;
  /** 今天放太久壞掉的貨（舊存檔沒有） */
  waste?: number;
  /** 下單時供應商沒能湊齊、也沒補到的份數（舊存檔沒有） */
  short?: number;
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
  /** 日均銷量（近幾天的移動平均，份／日）；智慧補貨與庫存天數用（舊存檔沒有） */
  avgDaily?: number;
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
  /** 出租中的租戶（mode 為 lease 時才有）；直營或匿名出租為 null */
  tenant: Tenant | null;
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
  /** 招商簽約後租戶自己裝修：完工時開成這個租戶的店 */
  tenant?: Tenant;
  /** 自營新店的店名（沒有＝依業態自動命名） */
  name?: string;
}

/** 白名單效果：事件只能使用這些，並且數值會被夾限。 */
export type EffectSpec =
  | { t: "weather"; kind: WeatherKind; temp: number; ticks: number }
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
  | { t: "familyFreshness"; family: SupplyFamily; amount: number }
  // ── 法律風險：有機率（p）讓某個業態相關的店惹上官司（日本法規，見 shared/legal.ts）
  | { t: "legalRisk"; kind: LegalKind; p: number };

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
   * 需要的天氣："wet"＝此刻在下雨、"wet_streak"＝連著下了兩天以上的雨。
   * 沒寫時由 `weatherNeedOf` 看事件文字有沒有講到下雨來決定（寫了雨就要真的有雨）。
   */
  needsWeather?: "wet" | "wet_streak";
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

/** 天氣：晴、陰、雨、暴風雨（颱風）。氣溫另外記（熱、冷也會影響客流與需求） */
export type WeatherKind = "clear" | "cloudy" | "rain" | "storm";

export type Modifier =
  /** 事件強制的天氣（例如連日大雨、颱風、寒流、酷暑）：期間內蓋過依日期決定的天氣 */
  | { kind: "weather"; weather: WeatherKind; temp: number; endTick: number }
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
  /** 其中今天兌換的會員點數（也算在 repairs 裡；舊存檔沒有） */
  memberCost?: number;
  /** 今天發出的會員點數（負債，兌換時才算成本；舊存檔沒有） */
  memberIssued?: number;
  /** 其中今天花在法律糾紛的錢（和解金、判決金、律師費、過料，扣掉保險給付；也算在 repairs 裡。舊存檔沒有） */
  legalCost?: number;
  /** 其中今天付的貸款利息（也算在 repairs 裡；舊存檔沒有） */
  interestCost?: number;
  /** 今天領到的營業中斷險理賠（已從 repairs 扣掉；舊存檔沒有） */
  insuranceClaim?: number;
  groups: number;
  units: number;
  walkouts: number;
  /** 其中因為嫌太貴而不買的組數（舊存檔沒有） */
  priceWalks?: number;
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
  /** 今天向供應商進貨花的錢（已含在 purchases 裡；進的貨是存貨，不是當天的虧損。舊存檔沒有） */
  stockBought?: number;
  /** 今天賣掉的庫存商品的成本（份數 × 單位成本；舊存檔沒有） */
  stockCost?: number;
  /** 今天的固定成本中，打烊時段花掉的部分（水電、薪資照常按天攤；舊存檔沒有） */
  fixedClosed?: number;
  /** 今天各種天氣各出現幾個 tick、最近一次的氣溫（舊存檔沒有這個欄位） */
  wx?: Record<WeatherKind, number>;
  temp?: number;
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
  /** 進貨花費與賣出商品的成本（舊日報沒有） */
  stockBought?: number;
  stockCost?: number;
  groups: number;
  units: number;
  walkouts: number;
  /** 其中因為嫌太貴而不買的組數（舊日報沒有） */
  priceWalks?: number;
  avgSat: Record<PersonaId, number | null>;
  /** price／refPrice／level／priceWalks 是平衡分析用的（舊日報沒有） */
  shops: { id: string; name: string; category: CategoryId; revenue: number; units: number; stockouts: number; lost: number; level?: number; price?: number; refPrice?: number; priceWalks?: number }[];
  localRep: { start: number; end: number };
  touristHeat: { start: number; end: number };
  events: string[];
  headline: string;
  notes: string[];
  guest?: { complaints: number; reviews: number; avgStars: number | null };
  /** 當天的天氣（舊日報沒有） */
  weather?: WeatherSummary;
}

/** 日報記錄的天氣：整天的主要天氣、氣溫，以及各種天氣各幾小時 */
export interface WeatherSummary {
  kind: WeatherKind;
  temp: number;
  hours: Record<WeatherKind, number>;
}

/** 傳給玩家的狀態：不含亂數種子與內部冷卻／累積表 */
export type PublicMallState = Omit<MallState, "seed" | "cooldowns" | "grievances"> & {
  /** 送出這份狀態那一刻的伺服器基準 tick（測試商場不受夾限，沒有）。畫面用它算出商場和伺服器差多少 */
  serverTick?: number;
};

// ───────── 客人互動層 ─────────

export type ComplaintCause = "stockout" | "wait" | "price" | "dirty" | "facility" | "quality";
/** 客人的語氣（玩家看得到；是不是「奧客」要自己從語氣判斷，不會直接告訴你） */
export type ComplaintTone = "sincere" | "angry" | "demanding";

// ───────── 法務（客訴升級成訴訟） ─────────

export type LegalKind = "food_poison" | "allergy" | "defect" | "misleading" | "injury" | "privacy" | "malpractice" | "lodging" | "contract";
/** 請求書 → 民事調停 → 訴訟（示談成立或判決後結案） */
export type LegalStage = "demand" | "mediation" | "trial";

export interface LawsuitCase {
  uid: string;
  kind: LegalKind;
  shopId: string | null;
  shopName: string;
  /** 原告的假名 */
  plaintiff: string;
  /** 請求金額 */
  claim: number;
  stage: LegalStage;
  createdTick: number;
  stageTick: number;
  deadlineTick: number;
  /** 我方的證據力 0–100（成立當下的清潔、設備、合規分數等；律師另加成） */
  evidence: number;
  /** 已委任律師（之後各階段不再收費，證據力 +15） */
  lawyer: boolean;
  /** 案件成立時的投保等級（0＝未投保） */
  insured: number;
  /** 起因的客訴語氣（原告占不占理由種子與語氣決定，不存進狀態、玩家只能從語氣猜） */
  tone: ComplaintTone | null;
  /** 經過（給玩家看的時間軸） */
  history: { tick: number; text: string }[];
}

export interface ClosedCase {
  uid: string;
  kind: LegalKind;
  shopName: string;
  plaintiff: string;
  claim: number;
  /** 最後付出的錢（含保險給付之後；不含律師費） */
  paid: number;
  insurer: number;
  lawyerFee: number;
  closedTick: number;
  /** 結果說明 */
  result: string;
  outcome: "settled" | "mediated" | "dismissed" | "partial" | "lost";
}

export interface LegalState {
  cases: LawsuitCase[];
  closed: ClosedCase[];
  /** 保險等級 0–2（每日依直營店數收保費） */
  insurance: number;
  /** 下一件新糾紛最早成立的 tick（冷卻） */
  nextAt: number;
  totalPaid: number;
  totalInsured: number;
}
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

export type SupplyFamily =
  | "meat"
  | "seafood"
  | "grain"
  | "produce"
  | "sweets"
  | "goods"
  | "drinks"
  | "apparel"
  | "beauty"
  | "tech"
  | "culture"
  | "medical"
  | "venue"
  | "hospitality";
export type SupplierStatus = "ok" | "shortage" | "strike" | "closed" | "cold";
/** 全服供應衝擊的原因（同一家供應商出事，所有用它的商場都受影響） */
export type ShockKind = "strike" | "typhoon" | "recall" | "customs" | "poor_harvest" | "ban" | "bankrupt" | "price_spike";

/** 這座商場已知的一次供應衝擊（預告→生效→結束）；由全服排程決定，商場只是記下來 */
export interface SupplierShock {
  id: string;
  kind: ShockKind;
  warnTick: number;
  startTick: number;
  endTick: number;
  /** 衝擊期間的基礎供貨比例（0–1）；沒有關係或長約的買家只拿到這麼多 */
  fill: number;
  /** 漲價型衝擊的價格倍率 */
  priceMult?: number;
}

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
  /** 目前或即將發生的全服供應衝擊（可選欄位；舊存檔沒有） */
  shock?: SupplierShock | null;
  /** 最近處理過的衝擊編號，避免重複套用 */
  lastShockId?: string;
}

export interface SupplyState {
  suppliers: SupplierState[];
  /** 每種貨品目前的主力供應商 */
  choice: Record<string, string>;
  /** 主力無法出貨時，自動向備用供應商（現貨，貴一成）補貨 */
  autoFallback: boolean;
  /** 每種貨品玩家指定的首選備用供應商（沒指定就挑最划算的；舊存檔沒有） */
  backup?: Record<string, string>;
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

/** 熟客的類型：不同類型有不同的來店時段、帶朋友、給意見的習慣（見 shared/regularsKit.ts） */
export type RegularKind = "worker" | "elder" | "foodie" | "thrifty" | "fan" | "family" | "pro" | "creator";

export interface RegularDef {
  id: string;
  name: string;
  persona: PersonaId;
  /** 類型（舊的與 AI 內容池的常客沒有就當「一般」） */
  kind?: RegularKind;
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
  /** 已停用：專屬座位不符合現實，舊存檔會在日結時退費並清掉（欄位保留給舊存檔） */
  reserved: boolean;
  tipsTotal: number;
  /** 這位熟客帶來的貢獻累計（舊存檔沒有） */
  contrib?: RegularContrib;
}

export interface RegularContrib {
  /** 本人與朋友的消費額（不含小費） */
  revenue: number;
  /** 帶來的朋友人次 */
  friends: number;
  /** 採納意見的次數 */
  feedback: number;
  /** 危機時幫忙說情／作證的次數 */
  help: number;
}

/** 熟客直接對你說的話：給店家的意見，或人生大事（搬家、結婚……）。要在期限內回應 */
export type VoiceTopic = "dirty" | "stockout" | "price" | "queue" | "stale" | "wish" | "life";
export interface RegularVoice {
  uid: string;
  regularId: string;
  shopId: string | null;
  topic: VoiceTopic;
  /** life 類的細項（move／marry／baby／promo／retire／sick） */
  detail?: string;
  text: string;
  createdTick: number;
  deadlineTick: number;
}

// ───────── 巡店（隱藏問題、行動點、檢查與處理） ─────────

/** hidden＝還沒被發現（不給玩家看）；hinted＝有線索但不知道是什麼；confirmed＝查明了；scheduled＝已排程修理 */
export type PatrolIssueStatus = "hidden" | "hinted" | "confirmed" | "scheduled";

export interface PatrolIssue {
  uid: string;
  /** 問題種類（見 shared/patrol.ts 的 PATROL_KINDS）；只有線索時對玩家是 "unknown" */
  kind: string;
  shopId: string;
  spot: string;
  /** 嚴重度 1–5；只有線索時對玩家是 0 */
  severity: number;
  bornTick: number;
  /** 上次惡化的 tick */
  worsenedTick: number;
  status: PatrolIssueStatus;
  /** 線索（發現之後才有） */
  hint?: string;
  /** 排程處理完成的 tick */
  fixTick?: number;
}

export interface PatrolSession {
  startTick: number;
  expireTick: number;
  ap: number;
  apMax: number;
  /** 這趟檢查過的點（"店面編號:檢查點"） */
  checked: string[];
  chats: number;
  found: number;
  fixed: number;
  spent: number;
}

export interface PatrolReport {
  tick: number;
  checked: number;
  found: number;
  fixed: number;
  spent: number;
  /** 結束時還沒處理的問題（已發現的） */
  open: number;
}

export interface PatrolState {
  issues: PatrolIssue[];
  session: PatrolSession | null;
  nextTick: number;
  /** 巡店經驗值（等級由它決定） */
  xp: number;
  foundTotal: number;
  fixedTotal: number;
  /** 沒處理而釀成事故的次數 */
  incidents: number;
  /** 下一次事故最早發生的 tick（事故之間至少隔幾天，避免放置的商場一次被連環打擊；舊存檔沒有） */
  nextIncident?: number;
  /** 處理過的檢查點在這個 tick 之前不會再冒新問題（"店面編號:檢查點" → tick） */
  cleared: Record<string, number>;
  report: PatrolReport | null;
}

// ───────── 會員制（商場的點數卡） ─────────

export interface MemberState {
  /** 點數回饋率（%）：0＝不發點數；其他為 1／2／3／5 */
  rate: number;
  /** 會員人數 */
  count: number;
  /** 已發出、還沒用掉的點數（日圓）＝商場欠客人的負債 */
  points: number;
  totalIssued: number;
  totalRedeemed: number;
  totalExpired: number;
  /** 本月到期失效的點數累計（只是統計，給畫面看） */
  lastDayIssued: number;
  lastDayRedeemed: number;
}

export interface GuestPrefs {
  complaintStance: Stance;
  /** 評價沒人回時，自動送出禮貌的回覆 */
  autoReplyReviews: boolean;
}

/** 追趕速度檔位（倍率相對於伺服器基準時間 TIME_SCALE；已追上伺服器時一律是 1×） */
export type SpeedId = "turbo" | "rapid" | "brisk" | "standard";

/**
 * 每座商場自己的時鐘。真實時間 → tick 的換算只看這個，
 * 模擬引擎本身只認 tick，所以暫停／調速都不需要改引擎。
 * 商場的 tick 永遠不會超過伺服器基準時間（見 shared/game/time.ts 的 tickAt）。
 */
export interface MallClock {
  /** 追趕速度倍率（1＝與伺服器同速：真實 4 小時為 1 遊戲日）。落後時用它加速追，追上後夾回 1× */
  speed: number;
  /**
   * 上次同步時落後伺服器基準時間的 tick 數（0＝已追上）。由伺服器在同步時寫入，
   * 畫面據此顯示「追趕中」並推算倒數；未設定（測試商場不受夾限）時畫面照 speed 本身推算。
   */
  lag?: number;
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

/** 跨商場世界在這座商場留下的紀錄（賽季成績、收到的通知）；對手的資料不會放在這裡 */
export interface WorldState {
  seasons: { season: number; rank: number; of: number; title: string; reward: number }[];
  /** 跨商場通知。被搶客的那一則帶著對方的名錄 key 與被搶的客群，畫面可以據此提供「反擊」 */
  notices: { tick: number; text: string; from?: string; persona?: string }[];
  /** 已經收下的信件數 */
  mailCount: number;
  /** 生效中的聯名協議（以這座商場自己的遊戲時間計算期限） */
  alliances: { id: number; partner: string; endTick: number }[];
}

export interface MallState {
  version: 13;
  clock: MallClock;
  seed: number;
  tick: number;
  funds: number;
  totalRevenue: number;
  level: number;
  /** 功能旗標：開發階段用來開關內容（例如 zone:b1、feature:lease） */
  flags: Record<string, boolean>;
  /** 概念定位（見 concept.ts）；沒選過就沒有這個欄位，視為「綜合型」。since＝選定時的 tick，換定位的冷卻從這裡算 */
  concept?: { id: string; since: number };
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
  tech: TechState;
  leasing: LeasingState;
  meta: MetaState;
  world: WorldState;
  reviewLog: ReviewRecord[];
  guestPrefs: GuestPrefs;
  /** 法務：客訴升級成的法律糾紛與保險（舊存檔沒有） */
  legal?: LegalState;
  /** 熟客的意見與人生大事（舊存檔沒有） */
  voices?: RegularVoice[];
  /** 會員制（點數卡；舊存檔沒有） */
  members?: MemberState;
  /** 金融：貸款、營業中斷險、重整（舊存檔沒有）。見 finance.ts */
  finance?: FinanceState;
  /** 巡店：隱藏問題與行動點（舊存檔沒有） */
  patrol?: PatrolState;
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
  /** 只有這些業態用得到；省略＝同類型（group）的業態都能用 */
  categories?: CategoryId[];
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
  /** 研發這道作品的店；有值就只能在那間店上架（舊存檔沒有這欄，只看業態） */
  madeShopId?: string;
  quality: number;
  appeal: Partial<Record<PersonaId, number>>;
  /** 新鮮度 0–100：上架之後慢慢退流行 */
  novelty: number;
  listedTick: number;
}

/** 研發小遊戲的輸入（client 玩完後送給伺服器重新計分；見 shared/workshopPlay.ts） */
export interface PlayInput {
  /** 玩的是哪一份關卡種子（過期的關卡不算） */
  seed: number;
  stages: { id: string; inputs: number[] }[];
  /** 調味微調：特性 id → +1／−1（最多兩個） */
  tweak?: Record<string, number>;
}

export interface RndJob {
  uid: string;
  shopId: string;
  picks: Partial<Record<SlotKind, string>>;
  startTick: number;
  endTick: number;
  cost: number;
  sig: string;
  /** 小遊戲的結果（驗證過的；舊存檔與沒玩的研發沒有） */
  play?: { score: number; bonus: number; tweak: Record<string, number> };
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
  /** 目前小遊戲的關卡種子（每次開始研發就換一份；舊存檔第一次用到時補上） */
  playSeed?: number;
}

// ───────── 稅務與法規（日本制度） ─────────

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

// ───────── 科技樹 ─────────

/** 科研專案的立項配置（三項加總 100）：速度（縮短時間、更貴）、嚴謹（提高成果品質）、節約（更省錢、成果較保守） */
export interface TechPlan {
  speed: number;
  rigor: number;
  thrift: number;
}

/** 研究進行到一半遇到的實驗事件 */
export interface TechExperiment {
  uid: string;
  kind: string;
  deadlineTick: number;
}

export interface TechJob {
  id: string;
  startTick: number;
  endTick: number;
  cost: number;
  /** 立項配置（舊存檔與沒設定的專案沒有） */
  plan?: TechPlan;
  /** 成果品質點數（立項、實驗事件與數據判讀累積；決定結案等級） */
  points?: number;
  /** 目前待回應的實驗事件 */
  exp?: TechExperiment | null;
  /** 實驗事件已經發生過（每個專案一次） */
  expDone?: boolean;
  /** 這個專案數據判讀用的關卡種子 */
  seed?: number;
}

/** 0＝勉強完成、1＝優良、2＝突破 */
export type TechGrade = 0 | 1 | 2;

export interface TechState {
  done: string[];
  jobs: TechJob[];
  /** 各科技的結案等級（舊存檔沒有） */
  grades?: Record<string, TechGrade>;
}

// ───────── 出租招商 ─────────

export interface Tenant {
  brand: string;
  /** 0.5–0.95：品牌的營運品質（取代店面等級的品質） */
  quality: number;
  /** 0–100：知名度，越高越能帶客，但也越會殺價 */
  fame: number;
  /** 每日租金與營業額抽成 */
  rent: number;
  commission: number;
  startTick: number;
  endTick: number;
  /** 租戶滿意度 0–100 */
  satisfaction: number;
  /** 連續幾天滿意度過低（滿 4 天就會撤櫃） */
  lowDays: number;
  /** 自己的店轉成出租（匿名租戶）：可以隨時收回自營，沒有租約約束 */
  own?: boolean;
}

export interface TenantCandidate {
  id: string;
  brand: string;
  category: CategoryId;
  quality: number;
  fame: number;
  rent: number;
  commission: number;
  termDays: number;
  /** 0–1：越想進駐，越不容易被還價嚇跑 */
  eagerness: number;
  createdTick: number;
  expireTick: number;
  /** 已經還過價（只能還一次） */
  countered: boolean;
  /** 品牌簡介（來自 AI 內容池時才有） */
  blurb?: string;
}

/** 租約到期的續約洽談 */
export interface LeaseRenewal {
  uid: string;
  shopId: string;
  brand: string;
  /** 租戶開出的續約租金（依滿意度） */
  rent: number;
  termDays: number;
  deadlineTick: number;
}

export interface LeasingState {
  candidates: TenantCandidate[];
  renewals: LeaseRenewal[];
  /** 下次可能有新品牌來洽談的 tick */
  nextAt: number;
  log: { tick: number; text: string }[];
}

// ───────── 目標、團隊事件、成就與線索 ─────────

export interface GoalPick {
  id: string;
  /** 達成門檻（依這座商場近期的表現換算） */
  target: number;
  /** 達成獎金 */
  reward: number;
  done: boolean;
}

/** 一個週期（一天或一週）的目標：進度＝現在的累計 − 週期開始時的累計 */
export interface GoalPeriod {
  /** 週期編號（遊戲日序，或週序） */
  key: number;
  picks: GoalPick[];
  base: Record<string, number>;
  bonusPaid: boolean;
}

export interface TeamContribution {
  taskId: string;
  actorId: string;
  name: string;
  tick: number;
}

export interface TeamEventState {
  uid: string;
  defId: string;
  startTick: number;
  deadlineTick: number;
  /** 需要幾位不同的隊員各認領一項 */
  needed: number;
  contributions: TeamContribution[];
}

export interface TeamMember {
  name: string;
  /** 下過幾次指令、完成過幾項團隊任務 */
  actions: number;
  tasks: number;
  lastTick: number;
}

export interface MetaState {
  startTick: number;
  /** 累計計數（接待、營收、處理客訴…） */
  tally: Record<string, number>;
  /** 看過的事件（id → 次數），線索收集用 */
  seen: Record<string, number>;
  day: GoalPeriod;
  week: GoalPeriod;
  team: {
    event: TeamEventState | null;
    nextAt: number;
    /** 商場成員人數（由伺服器同步） */
    size: number;
    members: Record<string, TeamMember>;
  };
  /** 成就 id → 解鎖時的 tick */
  achievements: Record<string, number>;
  /** 線索 id → 發現時的 tick */
  clues: Record<string, number>;
  placeSolved: boolean;
  guesses: number;
  lastGuessTick: number;
  log: { tick: number; text: string }[];
}
