import type {
  CategoryDef,
  CategoryGroup,
  EventDef,
  LevelDef,
  PersonaDef,
  PersonaId,
  ZoneDef,
} from "./types";

// ───────── 時間與全域常數 ─────────
export const TICK_MINUTES = 5;
export const TICKS_PER_HOUR = 60 / TICK_MINUTES; // 12
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR; // 288
/**
 * 遊戲時間比例：遊戲時間 = 真實時間 × TIME_SCALE。
 * 4 ＝ 真實 6 小時為遊戲 1 天（1 遊戲小時 = 15 真實分鐘，1 tick = 75 真實秒，
 * 一個真實日 = 4 個遊戲日，約 1.75 真實日跑完一週）。可調整。
 */
export const TIME_SCALE = 4;
export const REAL_HOURS_PER_GAME_DAY = 24 / TIME_SCALE;
/** 時區偏移（遊戲日曆使用 UTC+9） */
export const GAME_UTC_OFFSET_HOURS = 9;
export const CURRENCY = "¥";

export const INITIAL_FUNDS = 2_000_000;
export const INDEX_START = 50;
export const INDEX_FLOOR_ABS = 15;
export const INDEX_FLOOR_RATIO = 0.3;
export const INDEX_MAX_DAILY_DROP = 6;
/** 補算上限：最多補算 14 個「標準流速」的真實日 */
export const MAX_CATCHUP_TICKS = 14 * TICKS_PER_DAY * TIME_SCALE;
/** 「有人在場」的判定：有 WebSocket 連線，或最近這麼久有成員操作過 */
export const PRESENCE_WINDOW_MS = 15 * 60_000;

export const UTILITIES_PER_DAY = 45_000;
export const CLEANING_COST_PER_DAY = [0, 25_000, 60_000] as const;
export const MAINTENANCE_COST_PER_DAY = [0, 20_000, 50_000] as const;
export const CLEANING_RESTORE_PER_TICK = [0.01, 0.06, 0.12] as const;
export const MAINTENANCE_RESTORE_PER_TICK = [0, 0.05, 0.1] as const;
export const SUPPLY_LEAD_TICKS = 36;
export const SUPPLY_LOT = 50;
export const UPGRADE_BASE_COST = 1_200_000;
export const UPGRADE_TICKS = 96;
export const MAX_SHOP_LEVEL = 3;
export const SHOP_QUALITY = [0, 0.5, 0.65, 0.8] as const; // 依 level 索引
/** 新鮮感：每遊戲日衰退量、下限、換菜單的費用（×等級）與回復量 */
export const FRESHNESS_DECAY_PER_DAY = 4;
export const FRESHNESS_FLOOR = 20;
export const REFRESH_COST = 60_000;
export const REFRESH_GAIN = 50;
export const MAX_REPORTS = 30;
export const MAX_LOG = 300;

// ───────── 客人類型 ─────────
/** 以「尖峰」描述一天的客流形狀，再正規化成 24 小時比例 */
function curve(peaks: [hour: number, weight: number, width: number][]): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    let v = 0.002;
    for (const [ph, w, width] of peaks) {
      const d = Math.min(Math.abs(h - ph), 24 - Math.abs(h - ph));
      v += w * Math.exp(-(d * d) / (2 * width * width));
    }
    out.push(v);
  }
  const sum = out.reduce((a, b) => a + b, 0);
  return out.map((v) => v / sum);
}

export const PERSONAS: PersonaDef[] = [
  {
    id: "tourist",
    name: "國外觀光客",
    dailyBase: 240,
    hourShare: curve([[12, 1, 2.2], [19, 1.1, 2.2]]),
    weekendHourShare: curve([[13, 1, 2.6], [19.5, 1, 2.4]]),
    weekendMult: 1.2,
    sensitivity: 0.8,
    party: [1, 3],
    index: "touristHeat",
  },
  {
    id: "local",
    name: "在地常客",
    dailyBase: 330,
    hourShare: curve([[12, 1, 1.6], [18.5, 1.2, 2]]),
    weekendHourShare: curve([[13, 1, 2], [18.5, 1.1, 2.2]]),
    weekendMult: 1.1,
    sensitivity: 2.2,
    party: [1, 2],
    index: "localRep",
  },
  {
    id: "commuter",
    name: "通勤上班族",
    dailyBase: 280,
    hourShare: curve([[8, 0.7, 1], [12.5, 1.2, 1.2], [19, 1, 1.6]]),
    weekendHourShare: curve([[13, 0.8, 2.5], [18, 0.7, 2.5]]),
    weekendMult: 0.45,
    sensitivity: 1.2,
    party: [1, 1],
    index: "both",
  },
  {
    id: "family",
    name: "家庭／遊園客",
    dailyBase: 130,
    hourShare: curve([[12, 1.2, 1.8], [15, 0.8, 1.6], [18, 0.8, 1.4]]),
    weekendHourShare: curve([[11.5, 1.2, 1.6], [14.5, 1.3, 2], [18, 0.7, 1.5]]),
    weekendMult: 2.2,
    sensitivity: 1.5,
    party: [2, 4],
    index: "both",
  },
  {
    id: "student",
    name: "學生／年輕人",
    dailyBase: 180,
    hourShare: curve([[16.5, 1.2, 1.8], [20, 1, 2]]),
    weekendHourShare: curve([[14, 1, 2.4], [19, 1.1, 2.4]]),
    weekendMult: 1.5,
    sensitivity: 2.0,
    party: [1, 3],
    index: "both",
  },
  {
    id: "couple",
    name: "情侶／約會客",
    dailyBase: 90,
    hourShare: curve([[14, 0.6, 2], [20, 1.3, 2]]),
    weekendHourShare: curve([[13, 0.8, 2.4], [19.5, 1.3, 2.2]]),
    weekendMult: 1.7,
    sensitivity: 0.9,
    party: [2, 2],
    index: "both",
  },
];

export const PERSONA_IDS: PersonaId[] = PERSONAS.map((p) => p.id);
export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((p) => [p.id, p])) as Record<PersonaId, PersonaDef>;

// ───────── 區域 ─────────
export const ZONES: ZoneDef[] = [
  { id: "b1", name: "B1 美食街", tier: 1, slots: 8, unlockLevel: 1, description: "連通車站的地下美食街，日常客流的根基。" },
  { id: "f1", name: "1F 時尚與生活", tier: 2, slots: 8, unlockLevel: 2, description: "服飾、藥妝、選物與停車場，另有輕食簡餐。" },
  { id: "ent", name: "娛樂區", tier: 3, slots: 6, unlockLevel: 3, description: "電影院、親子遊樂場、電玩與 KTV，帶動周邊餐飲。" },
  { id: "cul", name: "3C 與文創", tier: 4, slots: 6, unlockLevel: 4, description: "電器旗艦、書店與文創快閃市集。" },
  { id: "life", name: "生活服務", tier: 5, slots: 6, unlockLevel: 5, description: "健身、SPA、診所、美容與托育。" },
  { id: "dining", name: "高樓層餐飲與夜間街區", tier: 6, slots: 8, unlockLevel: 6, description: "景觀餐廳、燒肉、居酒屋橫丁與酒吧。" },
  { id: "plaza", name: "活動廣場與展望台", tier: 7, slots: 3, unlockLevel: 7, description: "屋頂花園、展望台與大型活動檔期。" },
  { id: "biz", name: "商務與旅宿", tier: 8, slots: 5, unlockLevel: 8, description: "共享辦公、會議中心與旅館。" },
];
export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

export const LEVELS: LevelDef[] = [
  { level: 1, minRevenue: 0, minIndexAvg: 0 },
  { level: 2, minRevenue: 30_000_000, minIndexAvg: 48 },
  { level: 3, minRevenue: 120_000_000, minIndexAvg: 50 },
  { level: 4, minRevenue: 350_000_000, minIndexAvg: 52 },
  { level: 5, minRevenue: 800_000_000, minIndexAvg: 54 },
  { level: 6, minRevenue: 1_500_000_000, minIndexAvg: 56 },
  { level: 7, minRevenue: 2_600_000_000, minIndexAvg: 58 },
  { level: 8, minRevenue: 4_200_000_000, minIndexAvg: 60 },
];

// ───────── 業態 ─────────
type D = Partial<Record<PersonaId, number>>;
const GROUP_DEFAULTS: Record<CategoryGroup, { wage: number; buildCost: number; buildTicks: number }> = {
  food: { wage: 25_000, buildCost: 900_000, buildTicks: 144 },
  retail: { wage: 25_000, buildCost: 1_050_000, buildTicks: 168 },
  entertainment: { wage: 40_000, buildCost: 1_800_000, buildTicks: 288 },
  service: { wage: 30_000, buildCost: 1_350_000, buildTicks: 216 },
};

function cat(
  id: string,
  name: string,
  group: CategoryGroup,
  zone: string,
  refPrice: number,
  costRatio: number,
  baseCapacity: number,
  demand: D,
  extra: Partial<Pick<CategoryDef, "wage" | "buildCost" | "buildTicks">> = {},
): CategoryDef {
  return { id, name, group, zone, refPrice, costRatio, baseCapacity, demand, ...GROUP_DEFAULTS[group], ...extra };
}

export const CATEGORIES: CategoryDef[] = [
  // ── B1 美食街
  cat("ramen", "拉麵", "food", "b1", 950, 0.33, 3, { local: 0.8, commuter: 0.9, student: 0.8, tourist: 0.7, couple: 0.3, family: 0.3 }),
  cat("takoyaki", "章魚燒／大阪燒", "food", "b1", 650, 0.3, 4, { tourist: 0.9, local: 0.7, student: 0.9, family: 0.7, couple: 0.5, commuter: 0.3 }),
  cat("kushikatsu", "串炸", "food", "b1", 1500, 0.35, 4, { tourist: 1, local: 0.8, couple: 0.6, commuter: 0.5, family: 0.5, student: 0.3 }),
  cat("kissaten", "喫茶咖啡", "food", "b1", 800, 0.28, 3, { local: 0.9, commuter: 0.7, couple: 0.7, tourist: 0.4, student: 0.5, family: 0.3 }),
  cat("grocery", "超市", "food", "b1", 600, 0.72, 6, { local: 1, family: 0.8, commuter: 0.6, tourist: 0.2, student: 0.4 }, { wage: 35_000, buildCost: 800_000 }),
  cat("udon", "烏龍麵", "food", "b1", 750, 0.3, 3, { local: 0.8, commuter: 0.8, family: 0.6, tourist: 0.5, student: 0.5 }),
  cat("bubble_tea", "手搖飲", "food", "b1", 550, 0.25, 5, { student: 1, couple: 0.7, tourist: 0.6, family: 0.4, commuter: 0.4, local: 0.3 }),
  cat("sweets", "和菓子／甜點", "food", "b1", 700, 0.3, 3, { tourist: 0.8, couple: 0.8, family: 0.6, local: 0.5, student: 0.5 }),
  cat("curry", "咖哩飯", "food", "b1", 900, 0.32, 3, { commuter: 0.8, student: 0.8, local: 0.7, family: 0.5, tourist: 0.4 }),
  // ── 1F 時尚與生活
  cat("fashion", "服飾", "retail", "f1", 5500, 0.55, 2, { student: 0.8, couple: 0.8, tourist: 0.7, family: 0.4, local: 0.3, commuter: 0.3 }),
  cat("drugstore", "藥妝", "retail", "f1", 1500, 0.7, 4, { tourist: 1, local: 0.7, commuter: 0.6, family: 0.6, student: 0.5, couple: 0.4 }),
  cat("select_shop", "生活選物", "retail", "f1", 3000, 0.55, 2, { couple: 0.7, tourist: 0.7, local: 0.4, student: 0.5, family: 0.4 }),
  cat("parking", "停車場", "service", "f1", 600, 0.02, 8, { family: 0.7, couple: 0.4, local: 0.3, commuter: 0.3, tourist: 0.1 }, { wage: 15_000, buildCost: 1_000_000, buildTicks: 216 }),
  cat("brunch", "早午餐", "food", "f1", 1300, 0.32, 3, { couple: 0.9, local: 0.6, family: 0.6, tourist: 0.5, student: 0.4 }),
  cat("italian", "義式餐廳", "food", "f1", 1600, 0.33, 3, { couple: 0.9, family: 0.7, local: 0.5, tourist: 0.5, student: 0.4 }),
  cat("fastfood", "速食連鎖", "food", "f1", 650, 0.32, 6, { student: 0.9, family: 0.8, commuter: 0.7, local: 0.5, tourist: 0.4 }),
  // ── 娛樂區
  cat("cinema", "電影院", "entertainment", "ent", 1900, 0.35, 8, { couple: 1, student: 0.9, family: 0.8, local: 0.5, tourist: 0.4, commuter: 0.3 }),
  cat("kids_play", "親子遊樂場", "entertainment", "ent", 1200, 0.15, 6, { family: 1, local: 0.2 }),
  cat("arcade_vr", "電玩／VR 館", "entertainment", "ent", 1500, 0.2, 5, { student: 1, couple: 0.7, tourist: 0.6, local: 0.3, family: 0.3 }),
  cat("karaoke", "KTV", "entertainment", "ent", 2000, 0.15, 5, { student: 0.9, couple: 0.6, local: 0.6, commuter: 0.4, tourist: 0.5 }),
  // ── 3C 與文創
  cat("electronics", "3C 旗艦店", "retail", "cul", 18_000, 0.78, 2, { tourist: 0.7, student: 0.6, local: 0.5, commuter: 0.5, couple: 0.3, family: 0.3 }, { buildCost: 1_500_000 }),
  cat("bookstore", "書店", "retail", "cul", 1600, 0.65, 3, { local: 0.7, student: 0.7, commuter: 0.5, couple: 0.5, family: 0.4, tourist: 0.3 }),
  cat("stationery", "文具選物", "retail", "cul", 1200, 0.6, 3, { student: 0.8, tourist: 0.6, local: 0.5, couple: 0.4 }),
  cat("popup", "快閃市集", "retail", "cul", 2000, 0.5, 3, { tourist: 0.8, student: 0.7, couple: 0.7, family: 0.5, local: 0.4 }),
  // ── 生活服務
  cat("gym", "健身房", "service", "life", 1800, 0.1, 4, { commuter: 0.8, local: 0.7, student: 0.5, couple: 0.3 }),
  cat("spa", "SPA／按摩", "service", "life", 4500, 0.2, 2, { tourist: 0.8, couple: 0.8, local: 0.4, commuter: 0.5 }),
  cat("clinic", "診所", "service", "life", 3000, 0.25, 2, { local: 0.9, family: 0.7, commuter: 0.5, tourist: 0.2 }),
  cat("salon", "美容美髮", "service", "life", 5000, 0.2, 1, { couple: 0.7, local: 0.6, commuter: 0.5, student: 0.5, tourist: 0.3 }),
  cat("daycare", "托育中心", "service", "life", 2500, 0.25, 3, { family: 0.9, local: 0.3 }),
  cat("laundry", "共享洗衣", "service", "life", 800, 0.2, 3, { tourist: 0.7, student: 0.6, local: 0.6, commuter: 0.4 }),
  // ── 高樓層餐飲與夜間街區
  cat("yakiniku", "燒肉", "food", "dining", 3500, 0.42, 3, { couple: 0.8, family: 0.8, commuter: 0.6, local: 0.5, tourist: 0.7, student: 0.4 }),
  cat("sushi", "壽司", "food", "dining", 2800, 0.4, 3, { tourist: 1, couple: 0.8, family: 0.7, local: 0.5, commuter: 0.4 }),
  cat("izakaya", "居酒屋", "food", "dining", 2800, 0.3, 4, { commuter: 1, local: 0.9, couple: 0.5, tourist: 0.7, student: 0.3 }),
  cat("bar", "酒吧", "food", "dining", 1800, 0.22, 3, { couple: 0.9, commuter: 0.7, tourist: 0.6, local: 0.5 }),
  cat("fine_dining", "景觀 Fine dining", "food", "dining", 8000, 0.38, 2, { couple: 1, tourist: 0.7, local: 0.2, commuter: 0.3 }),
  cat("hotpot", "火鍋", "food", "dining", 2600, 0.38, 3, { family: 0.8, student: 0.7, local: 0.6, couple: 0.6, tourist: 0.5, commuter: 0.5 }),
  // ── 活動廣場與展望台
  cat("observatory", "展望台", "entertainment", "plaza", 1200, 0.1, 6, { tourist: 1, couple: 0.9, family: 0.7, local: 0.3, student: 0.5 }, { buildCost: 1_500_000 }),
  cat("event_space", "活動場地", "service", "plaza", 5000, 0.3, 2, { family: 0.5, couple: 0.5, student: 0.6, tourist: 0.5, local: 0.4 }, { buildCost: 1_800_000 }),
  // ── 商務與旅宿
  cat("coworking", "共享辦公", "service", "biz", 1800, 0.15, 3, { commuter: 0.9, local: 0.4, student: 0.4 }),
  cat("conference", "會議中心", "service", "biz", 6000, 0.25, 1, { commuter: 0.7, local: 0.3 }),
  cat("hotel", "旅館", "service", "biz", 12_000, 0.3, 1, { tourist: 1, couple: 0.5, commuter: 0.3 }, { buildCost: 3_000_000, buildTicks: 432 }),
];
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<string, CategoryDef>;

/** 這個業態的店是否需要庫存（食物與零售需要；娛樂與服務以容量為限） */
export function categoryHasStock(c: CategoryDef): boolean {
  return c.group === "food" || c.group === "retail";
}

/** 開局的店：B1 美食街 5 間 */
export const INITIAL_SHOPS: { category: string; name: string }[] = [
  { category: "kushikatsu", name: "串八" },
  { category: "takoyaki", name: "章魚福" },
  { category: "ramen", name: "麵屋 一徹" },
  { category: "kissaten", name: "喫茶 月見" },
  { category: "grocery", name: "丸屋超市" },
];

// ───────── 隨機事件（線索低調，不點名真實地名與品牌） ─────────
export const EVENTS: EventDef[] = [
  {
    id: "rainy_season",
    category: "weather",
    title: "連日大雨",
    text: "梅雨季，雨連下了好幾天。出門的人少了，不過躲雨的客人會晃進地下街。",
    weight: 3,
    cooldownTicks: 288 * 4,
    when: { months: [6, 7] },
    effects: [
      { t: "traffic", persona: "family", mult: 0.6, ticks: 144 },
      { t: "traffic", persona: "tourist", mult: 0.8, ticks: 144 },
      { t: "traffic", persona: "commuter", mult: 0.85, ticks: 144 },
      { t: "traffic", persona: "local", mult: 1.1, ticks: 144 },
    ],
  },
  {
    id: "typhoon_warning",
    category: "weather",
    title: "颱風接近",
    text: "氣象局發布警報，大風雨預計傍晚登陸。要提早閉館，還是照常營業？",
    weight: 2,
    cooldownTicks: 288 * 6,
    when: { months: [8, 9, 10] },
    // 預設（提早閉館）或賭一把都影響很大，沒人在場時暫停等人決定
    attention: "pause",
    effects: [],
    choice: {
      deadlineTicks: 24,
      defaultOption: "close",
      options: [
        { id: "close", label: "提早閉館，保障安全", effects: [{ t: "close", ticks: 144 }, { t: "index", which: "localRep", amount: 1 }] },
        {
          id: "open",
          label: "照常營業，賭一把",
          effects: [
            { t: "traffic", persona: "all", mult: 0.35, ticks: 96 },
            { t: "equipment", amount: -8 },
            { t: "index", which: "localRep", amount: -1 },
          ],
        },
      ],
    },
  },
  {
    id: "cold_wave",
    category: "weather",
    title: "寒流來襲",
    text: "氣溫驟降，熱湯與熱飲突然成了熱門。",
    weight: 2,
    cooldownTicks: 288 * 5,
    when: { months: [12, 1, 2] },
    effects: [
      { t: "demand", category: "ramen", mult: 1.5, ticks: 144 },
      { t: "demand", category: "udon", mult: 1.5, ticks: 144 },
      { t: "demand", category: "hotpot", mult: 1.6, ticks: 144 },
      { t: "demand", category: "bubble_tea", mult: 0.7, ticks: 144 },
    ],
  },
  {
    id: "heat_wave",
    category: "weather",
    title: "酷暑",
    text: "連續高溫，大家都往有冷氣的地方鑽。冷飲賣到手軟，空調也辛苦了。",
    weight: 2,
    cooldownTicks: 288 * 5,
    when: { months: [7, 8] },
    effects: [
      { t: "demand", category: "bubble_tea", mult: 1.6, ticks: 144 },
      { t: "demand", category: "sweets", mult: 1.3, ticks: 144 },
      { t: "traffic", persona: "all", mult: 1.1, ticks: 144 },
      { t: "equipment", amount: -6 },
    ],
  },
  {
    id: "team_win",
    category: "crowd",
    title: "主場球隊逆轉勝",
    text: "附近球場傳來歡呼聲，散場的球迷湧進街上，每個人都想找個地方慶祝。",
    weight: 2,
    cooldownTicks: 288 * 3,
    when: { hours: [17, 23] },
    effects: [
      { t: "traffic", persona: "local", mult: 1.6, ticks: 60 },
      { t: "traffic", persona: "commuter", mult: 1.3, ticks: 60 },
      { t: "demand", category: "kushikatsu", mult: 1.4, ticks: 60 },
    ],
  },
  {
    id: "influencer_kushikatsu",
    category: "crowd",
    title: "網紅打卡爆紅",
    text: "有人把你們的串炸拍成短影音，一夜之間在社群上瘋傳。",
    weight: 2,
    cooldownTicks: 288 * 3,
    effects: [
      { t: "demand", category: "kushikatsu", mult: 1.8, ticks: 144 },
      { t: "traffic", persona: "tourist", mult: 1.25, ticks: 144 },
      { t: "index", which: "touristHeat", amount: 3 },
    ],
  },
  {
    id: "airport_chaos",
    category: "crowd",
    title: "機場班機大亂",
    text: "航班延誤，私鐵線湧進一大批拖著行李箱的旅客，餓著肚子找地方吃東西。",
    weight: 2,
    cooldownTicks: 288 * 3,
    effects: [{ t: "traffic", persona: "tourist", mult: 2, ticks: 48 }],
  },
  {
    id: "tower_lights",
    category: "festival",
    title: "老塔點燈活動",
    text: "街角那座老塔今晚有特別的燈光秀，霓虹把整條街染成粉紅色。",
    weight: 2,
    cooldownTicks: 288 * 4,
    when: { hours: [15, 20] },
    effects: [
      { t: "traffic", persona: "tourist", mult: 1.4, ticks: 60 },
      { t: "traffic", persona: "family", mult: 1.3, ticks: 60 },
      { t: "traffic", persona: "couple", mult: 1.5, ticks: 60 },
    ],
  },
  {
    id: "rival_sale",
    category: "market",
    title: "隔壁老店大促銷",
    text: "巷子裡的老店掛出「全品項特價」的布條，常客們有點動搖了。",
    weight: 2,
    cooldownTicks: 288 * 4,
    effects: [{ t: "traffic", persona: "local", mult: 0.7, ticks: 72 }],
    choice: {
      deadlineTicks: 24,
      defaultOption: "ignore",
      options: [
        { id: "ignore", label: "不理它，守住品質", effects: [] },
        {
          id: "match",
          label: "跟進促銷（花 5 萬宣傳）",
          effects: [
            { t: "funds", amount: -50_000 },
            { t: "traffic", persona: "local", mult: 1.25, ticks: 72 },
            { t: "index", which: "localRep", amount: 1 },
          ],
        },
      ],
    },
  },
  {
    id: "power_outage",
    category: "facility",
    title: "停電",
    text: "整區忽然陷入黑暗。備用電源啟動前，大家只能先暫停營業。",
    weight: 1.5,
    cooldownTicks: 288 * 5,
    effects: [{ t: "close", ticks: 12 }, { t: "stockLoss", pct: 0.03 }],
  },
  {
    id: "escalator_down",
    category: "facility",
    title: "手扶梯故障",
    text: "手扶梯卡住了，維修人員正在趕來的路上。",
    weight: 1.5,
    cooldownTicks: 288 * 3,
    effects: [{ t: "equipment", amount: -15 }, { t: "funds", amount: -30_000 }],
  },
  {
    id: "leak",
    category: "facility",
    title: "天花板漏水",
    text: "雨水從天花板的縫隙滲了下來，地板濕了一片。",
    weight: 1.5,
    cooldownTicks: 288 * 4,
    effects: [],
    choice: {
      deadlineTicks: 36,
      defaultOption: "patch",
      options: [
        { id: "patch", label: "先擱著，擦乾就好", effects: [{ t: "cleanliness", amount: -25 }, { t: "funds", amount: -20_000 }] },
        { id: "fix", label: "緊急找人修（花 4 萬）", effects: [{ t: "funds", amount: -40_000 }, { t: "cleanliness", amount: -5 }] },
      ],
    },
  },
  {
    id: "ingredient_up",
    category: "supply",
    title: "食材漲價",
    text: "盤商來電：今年天氣影響收成，進貨價要漲三成。",
    weight: 2,
    cooldownTicks: 288 * 6,
    effects: [{ t: "supply", mult: 1.3, ticks: 288 }],
  },
  {
    id: "ingredient_sale",
    category: "supply",
    title: "產地直送特賣",
    text: "盤商手上有一批貨急著出清，這幾天進貨價特別便宜。",
    weight: 1.5,
    cooldownTicks: 288 * 6,
    effects: [{ t: "supply", mult: 0.8, ticks: 144 }],
  },
  {
    id: "tip_jar",
    category: "luck",
    title: "常客留下小費罐",
    text: "一位老常客臨走前在櫃台放了一個信封：「給你們加油，おおきに。」",
    weight: 1.5,
    cooldownTicks: 288 * 4,
    effects: [{ t: "funds", amount: 80_000 }, { t: "index", which: "localRep", amount: 1 }],
  },
  {
    id: "holiday_rush",
    category: "festival",
    title: "連假人潮",
    text: "連假開始，一家老小與外地旅客把商場擠得滿滿的。",
    weight: 3,
    cooldownTicks: 288 * 10,
    when: { months: [1, 5, 8, 12] },
    effects: [
      { t: "traffic", persona: "family", mult: 1.6, ticks: 288 },
      { t: "traffic", persona: "tourist", mult: 1.3, ticks: 288 },
    ],
  },
  {
    id: "summer_festival",
    category: "festival",
    title: "夏日祭典",
    text: "街坊的祭典開始了，鼓聲從遠處傳來，穿浴衣的人潮在商場間穿梭。",
    weight: 3,
    cooldownTicks: 288 * 10,
    when: { months: [7] },
    effects: [
      { t: "traffic", persona: "local", mult: 1.4, ticks: 72 },
      { t: "traffic", persona: "family", mult: 1.4, ticks: 72 },
      { t: "traffic", persona: "couple", mult: 1.4, ticks: 72 },
      { t: "demand", category: "takoyaki", mult: 1.5, ticks: 72 },
    ],
  },
  {
    id: "film_premiere",
    category: "crowd",
    title: "大片首映",
    text: "話題大片首映，戲院外排了長長的隊伍，連隔壁的店都跟著沾光。",
    weight: 2,
    cooldownTicks: 288 * 6,
    needsZone: "ent",
    effects: [
      { t: "demand", category: "cinema", mult: 1.8, ticks: 96 },
      { t: "traffic", persona: "couple", mult: 1.3, ticks: 96 },
      { t: "traffic", persona: "student", mult: 1.3, ticks: 96 },
    ],
  },
  {
    id: "fashion_sale",
    category: "market",
    title: "換季大特賣",
    text: "季末換季，服飾與選物店掛出折扣牌，整層樓都是提著紙袋的人。",
    weight: 2,
    cooldownTicks: 288 * 8,
    needsZone: "f1",
    when: { months: [1, 2, 6, 7, 11, 12] },
    effects: [
      { t: "demand", category: "fashion", mult: 1.6, ticks: 144 },
      { t: "demand", category: "select_shop", mult: 1.4, ticks: 144 },
    ],
  },
  {
    id: "year_end_countdown",
    category: "festival",
    title: "跨年倒數",
    text: "新的一年即將到來，人們聚在一起倒數，整座商場一起熱鬧。",
    weight: 2,
    cooldownTicks: 288 * 20,
    needsZone: "plaza",
    when: { months: [12] },
    effects: [
      { t: "traffic", persona: "all", mult: 1.5, ticks: 96 },
      { t: "index", which: "localRep", amount: 2 },
      { t: "index", which: "touristHeat", amount: 2 },
    ],
  },
  // ───────── 面對客人的突發狀況（有選項；沒人理就採預設） ─────────
  {
    id: "vip_buyout",
    category: "guest",
    title: "貴客想包場",
    text: "一位穿著體面的客人想在傍晚包下一部分座位辦聚會，出手很大方，但這段時間其他客人會變少。",
    weight: 1.5,
    cooldownTicks: 288 * 6,
    when: { hours: [11, 19] },
    effects: [],
    choice: {
      deadlineTicks: 36,
      defaultOption: "decline",
      options: [
        { id: "accept", label: "接下包場（收入＋，散客變少）", effects: [{ t: "funds", amount: 180_000 }, { t: "traffic", persona: "all", mult: 0.7, ticks: 36 }, { t: "index", which: "localRep", amount: 0.8 }] },
        { id: "decline", label: "婉拒，維持一般營業", effects: [] },
      ],
    },
  },
  {
    id: "allergy_guest",
    category: "guest",
    title: "客人說自己過敏",
    text: "有位客人吃到一半臉色不太對，說他對其中一種食材過敏，家人很緊張地看著你。",
    weight: 1.5,
    cooldownTicks: 288 * 5,
    effects: [],
    choice: {
      deadlineTicks: 12,
      defaultOption: "check",
      options: [
        { id: "check", label: "立刻確認原料、換一份安全的並致歉", effects: [{ t: "funds", amount: -8_000 }, { t: "index", which: "localRep", amount: 1 }] },
        { id: "explain", label: "說明菜單已有標示，表達關心", effects: [{ t: "index", which: "localRep", amount: 0.1 }] },
        { id: "ignore", label: "請客人自己注意", effects: [{ t: "index", which: "localRep", amount: -1.8 }, { t: "index", which: "touristHeat", amount: -0.8 }] },
      ],
    },
  },
  {
    id: "birthday_party",
    category: "guest",
    title: "有人在慶生",
    text: "靠窗那桌的小壽星今天生日，家人偷偷跟店員比了個「拜託」的手勢。",
    weight: 2,
    cooldownTicks: 288 * 3,
    when: { hours: [11, 21] },
    effects: [],
    choice: {
      deadlineTicks: 18,
      defaultOption: "wish",
      options: [
        { id: "sing", label: "全店一起唱生日歌（花 1 萬）", effects: [{ t: "funds", amount: -10_000 }, { t: "index", which: "localRep", amount: 0.9 }, { t: "index", which: "touristHeat", amount: 0.4 }] },
        { id: "cake", label: "送一份小蛋糕（花 5 千）", effects: [{ t: "funds", amount: -5_000 }, { t: "index", which: "localRep", amount: 0.5 }] },
        { id: "wish", label: "店員口頭祝福", effects: [{ t: "index", which: "localRep", amount: 0.1 }] },
      ],
    },
  },
  {
    id: "lost_child",
    category: "guest",
    title: "走失的小朋友",
    text: "一個小朋友站在走道中間哭，說找不到媽媽。周圍的人都看過來了。",
    weight: 1.5,
    cooldownTicks: 288 * 6,
    effects: [],
    choice: {
      deadlineTicks: 12,
      defaultOption: "guard",
      options: [
        { id: "broadcast", label: "店員陪著他，並立刻廣播協尋", effects: [{ t: "index", which: "localRep", amount: 1.2 }, { t: "index", which: "touristHeat", amount: 0.6 }] },
        { id: "guard", label: "交給保全處理", effects: [{ t: "index", which: "localRep", amount: 0.4 }] },
      ],
    },
  },
  {
    id: "mystery_guest",
    category: "guest",
    title: "有人一直在做筆記",
    text: "角落那位客人從進門就沒停過筆，每道菜都拍照、寫字，看起來像是在評鑑。",
    weight: 1.2,
    cooldownTicks: 288 * 8,
    effects: [],
    choice: {
      deadlineTicks: 12,
      defaultOption: "normal",
      options: [
        { id: "special", label: "加強招待、請店長親自出面（花 2 萬）", effects: [{ t: "funds", amount: -20_000 }, { t: "index", which: "localRep", amount: 1.2 }, { t: "index", which: "touristHeat", amount: 1.5 }] },
        { id: "normal", label: "一視同仁，照常服務", effects: [{ t: "index", which: "localRep", amount: 0.3 }, { t: "index", which: "touristHeat", amount: 0.3 }] },
      ],
    },
  },
  {
    id: "tour_group_walkin",
    category: "guest",
    title: "旅行團臨時加位",
    text: "導遊揮著小旗子帶著一整團客人湧到門口，問能不能臨時安排位子。",
    weight: 1.5,
    cooldownTicks: 288 * 4,
    when: { hours: [11, 20] },
    effects: [],
    choice: {
      deadlineTicks: 12,
      defaultOption: "accept",
      options: [
        { id: "accept", label: "加開座位、全力接待（花 1.5 萬）", effects: [{ t: "funds", amount: -15_000 }, { t: "traffic", persona: "tourist", mult: 1.8, ticks: 24 }, { t: "index", which: "touristHeat", amount: 1 }] },
        { id: "decline", label: "客滿了，婉拒", effects: [{ t: "index", which: "touristHeat", amount: -0.4 }] },
      ],
    },
  },
  {
    id: "lost_item",
    category: "guest",
    title: "失物招領",
    text: "清潔人員在座位底下撿到一個鼓鼓的錢包，裡面有證件和現金。",
    weight: 1.5,
    cooldownTicks: 288 * 5,
    effects: [],
    choice: {
      deadlineTicks: 24,
      defaultOption: "report",
      options: [
        { id: "contact", label: "翻證件主動聯絡失主，親自送還", effects: [{ t: "index", which: "localRep", amount: 1.2 }, { t: "index", which: "touristHeat", amount: 0.8 }] },
        { id: "report", label: "登記保管，等失主回來認領", effects: [{ t: "index", which: "localRep", amount: 0.4 }] },
      ],
    },
  },
  {
    id: "celebrity_visit",
    category: "guest",
    title: "有名人微服出巡",
    text: "有人悄悄說，戴著帽子和口罩坐在角落的那位，好像是常上電視的名人。",
    weight: 1,
    cooldownTicks: 288 * 10,
    effects: [],
    choice: {
      deadlineTicks: 12,
      defaultOption: "respect",
      options: [
        { id: "photo", label: "請他合照、貼在店裡（有曝光，也可能惹他不悅）", effects: [{ t: "index", which: "touristHeat", amount: 2 }, { t: "index", which: "localRep", amount: -0.4 }] },
        { id: "respect", label: "默默尊重他的隱私，照常服務", effects: [{ t: "index", which: "localRep", amount: 0.8 }] },
      ],
    },
  },
  // ───────── 供應商戲劇（對象是你目前的主力供應商） ─────────
  {
    id: "seafood_shortage",
    category: "supply",
    title: "海鮮供應吃緊",
    text: "外海天氣不好，海鮮供應商通知：這幾天出貨量只有平常的六成，而且要等更久。",
    weight: 1.6,
    cooldownTicks: 288 * 8,
    needsFamily: "seafood",
    attention: "pause",
    effects: [],
    choice: {
      deadlineTicks: 36,
      defaultOption: "wait",
      options: [
        { id: "wait", label: "忍耐幾天（出貨只有六成）", effects: [{ t: "supplierStatus", family: "seafood", status: "shortage", ticks: 144 }] },
        { id: "switch", label: "改向備用供應商（花 1.5 萬）", effects: [{ t: "funds", amount: -15_000 }, { t: "supplierSwitch", family: "seafood" }] },
        { id: "premium", label: "加價搶貨（花 3 萬，維持全額供貨）", effects: [{ t: "funds", amount: -30_000 }, { t: "supplierRel", family: "seafood", amount: 3 }] },
      ],
    },
  },
  {
    id: "meat_strike",
    category: "supply",
    title: "肉品供應商罷工",
    text: "肉品工會宣布罷工，供應商說最快要幾天後才能出貨，還叫你「多多包涵」。",
    weight: 1.4,
    cooldownTicks: 288 * 10,
    needsFamily: "meat",
    attention: "pause",
    effects: [],
    choice: {
      deadlineTicks: 36,
      defaultOption: "wait",
      options: [
        { id: "wait", label: "等他們復工（期間靠備援現貨，貴一成）", effects: [{ t: "supplierStatus", family: "meat", status: "strike", ticks: 216 }] },
        { id: "switch", label: "直接換掉這家（花 1.5 萬）", effects: [{ t: "funds", amount: -15_000 }, { t: "supplierSwitch", family: "meat" }] },
      ],
    },
  },
  {
    id: "grain_price_hike",
    category: "supply",
    title: "製麵所宣布漲價",
    text: "麵粉行情上漲，製麵所老闆打電話來：「下個月起要漲兩成五，不好意思啦。」",
    weight: 1.6,
    cooldownTicks: 288 * 9,
    needsFamily: "grain",
    effects: [],
    choice: {
      deadlineTicks: 48,
      defaultOption: "accept",
      options: [
        { id: "accept", label: "接受漲價", effects: [{ t: "supplierPrice", family: "grain", mult: 1.25, ticks: 576 }] },
        { id: "negotiate", label: "談判（交情夠好就不漲，不然只漲一半）", effects: [{ t: "supplierPrice", family: "grain", mult: 1.25, ticks: 576 }, { t: "supplierNegotiate", family: "grain" }] },
        { id: "switch", label: "換別家（花 1.5 萬）", effects: [{ t: "funds", amount: -15_000 }, { t: "supplierSwitch", family: "grain" }] },
      ],
    },
  },
  {
    id: "produce_scandal",
    category: "supply",
    title: "青果供應商爆出醜聞",
    text: "新聞報導你的蔬果供應商被查到農藥殘留，雖然你拿到的批次沒事，客人們已經開始竊竊私語。",
    weight: 1.2,
    cooldownTicks: 288 * 12,
    needsFamily: "produce",
    effects: [{ t: "familyFreshness", family: "produce", amount: -10 }],
    choice: {
      deadlineTicks: 36,
      defaultOption: "explain",
      options: [
        { id: "switch", label: "立刻換供應商（花 1.5 萬）", effects: [{ t: "funds", amount: -15_000 }, { t: "supplierSwitch", family: "produce" }, { t: "index", which: "localRep", amount: 0.3 }] },
        { id: "explain", label: "公開說明、繼續合作", effects: [{ t: "index", which: "localRep", amount: -0.8 }, { t: "supplierRel", family: "produce", amount: 3 }] },
      ],
    },
  },
  {
    id: "sweets_bankrupt",
    category: "supply",
    title: "原料行倒閉了",
    text: "甜點原料行的老闆一早貼出公告：「本店結束營業」。你的下一批貨在哪？",
    weight: 1,
    cooldownTicks: 288 * 14,
    needsFamily: "sweets",
    attention: "pause",
    effects: [],
    choice: {
      deadlineTicks: 36,
      defaultOption: "switch",
      options: [
        { id: "switch", label: "改向備用供應商（花 1.5 萬）", effects: [{ t: "funds", amount: -15_000 }, { t: "supplierSwitch", family: "sweets" }] },
        { id: "spot", label: "先靠現貨撐著（貴一成），慢慢找新的", effects: [{ t: "supplierStatus", family: "sweets", status: "closed", ticks: 288 * 6 }] },
      ],
    },
  },
  {
    id: "meat_feud",
    category: "supply",
    title: "兩家肉商鬧翻了",
    text: "你的肉品供應商和另一家老對手在市場上吵起來，雙方都逼你「選邊站」。",
    weight: 1,
    cooldownTicks: 288 * 14,
    needsFamily: "meat",
    effects: [],
    choice: {
      deadlineTicks: 48,
      defaultOption: "stay",
      options: [
        { id: "stay", label: "挺目前的供應商（對方會冷處理你）", effects: [{ t: "supplierRel", family: "meat", amount: 10 }, { t: "supplierStatus", family: "meat", status: "cold", ticks: 288 * 3, which: "other" }] },
        { id: "side", label: "改挺對方（花 1.5 萬換主力）", effects: [{ t: "funds", amount: -15_000 }, { t: "supplierSwitch", family: "meat" }] },
      ],
    },
  },
  {
    id: "loyalty_reward",
    category: "supply",
    title: "老交情的回饋",
    text: "長期往來的供應商念著舊情：「這陣子給你特別價，下次記得多照顧啊。」",
    weight: 1.4,
    cooldownTicks: 288 * 8,
    needsFamily: "any",
    needsRel: 50,
    effects: [{ t: "supplierPrice", family: "best", mult: 0.9, ticks: 288 }, { t: "supplierRel", family: "best", amount: 3 }],
  },
  {
    id: "new_supplier",
    category: "supply",
    title: "新供應商登門拜訪",
    text: "一位陌生的業務帶著樣品與報價單來拜訪，說「我們是新開的，請多指教」。",
    weight: 1.2,
    cooldownTicks: 288 * 6,
    needsUndiscovered: true,
    effects: [{ t: "supplierDiscover" }],
  },
];
export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e])) as Record<string, EventDef>;
