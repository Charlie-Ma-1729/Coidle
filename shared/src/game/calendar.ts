import { CATEGORY_BY_ID, PERSONAS } from "./data";
import type { PersonaId } from "./types";

// 日本日曆：遊戲日期本來就是真實的日本日曆（JST，從 2027-04-01 開始），這裡讓「哪一天是國定假日、連休、
// 盂蘭盆節、黃金週…」影響客流與業態需求。
// 純函式、只看「遊戲日序」（和 weather.ts 的 dayWeather 同型）：不存檔、不需要 state migration，
// 伺服器基準時間讓所有商場同一天過同一個連假，落後追趕的商場重播的也是同一套結果。
// 之後的新玩法（私鐵載客量、不動產搬家旺季、自有品牌檔期…）可以直接重用 calendarDay() 的 tags。

const DAY_MS = 86_400_000;

export interface CalendarYmd {
  y: number;
  m: number;
  d: number;
  /** 0 = 週日 */
  dow: number;
}

/** 遊戲日序（自 1970-01-01 起算，和 timeInfo().day 相同）→ 年月日與星期 */
export function ymdOfDay(day: number): CalendarYmd {
  const dt = new Date(day * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

export function dayOfYmd(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

// ───────── 國定假日 ─────────

export interface PublicHoliday {
  name: string;
  /** statutory＝法定假日；substitute＝補假（假日撞週日，順延到下一個非假日）；bridge＝國民之休日（夾在兩個假日中間） */
  kind: "statutory" | "substitute" | "bridge";
}

/** 某個月的第 n 個星期幾是幾號 */
function nthWeekday(y: number, m: number, dow: number, n: number): number {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
}

/** 春分日、秋分日（1980–2099 的標準近似公式） */
function equinox(y: number, spring: boolean): number {
  const k = y - 1980;
  return Math.floor((spring ? 20.8431 : 23.2488) + 0.242194 * k - Math.floor(k / 4));
}

const holidayCache = new Map<number, Map<number, PublicHoliday>>();
const key = (m: number, d: number) => m * 100 + d;

/** 這一年的所有假日（鍵＝月×100＋日）。含補假與國民之休日。 */
export function publicHolidays(year: number): Map<number, PublicHoliday> {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const stat = new Map<number, PublicHoliday>();
  const add = (m: number, d: number, name: string) => void stat.set(key(m, d), { name, kind: "statutory" });
  add(1, 1, "元日");
  add(1, nthWeekday(year, 1, 1, 2), "成人之日");
  add(2, 11, "建國紀念日");
  add(2, 23, "天皇誕生日");
  add(3, equinox(year, true), "春分之日");
  add(4, 29, "昭和之日");
  add(5, 3, "憲法紀念日");
  add(5, 4, "綠之日");
  add(5, 5, "兒童節");
  add(7, nthWeekday(year, 7, 1, 3), "海之日");
  add(8, 11, "山之日");
  add(9, nthWeekday(year, 9, 1, 3), "敬老之日");
  add(9, equinox(year, false), "秋分之日");
  add(10, nthWeekday(year, 10, 1, 2), "體育之日");
  add(11, 3, "文化之日");
  add(11, 23, "勤勞感謝日");

  const all = new Map(stat);
  const dayOf = (k: number) => dayOfYmd(year, Math.floor(k / 100), k % 100);
  const keyOfDay = (day: number): number => {
    const c = ymdOfDay(day);
    return key(c.m, c.d);
  };
  // 補假：假日撞週日，順延到「之後第一個不是假日的日子」（依日期順序處理）
  for (const k of [...stat.keys()].sort((a, b) => a - b)) {
    const day = dayOf(k);
    if (ymdOfDay(day).dow !== 0) continue;
    let next = day + 1;
    while (ymdOfDay(next).y === year && all.has(keyOfDay(next))) next++;
    if (ymdOfDay(next).y === year) all.set(keyOfDay(next), { name: `補假（${stat.get(k)!.name}）`, kind: "substitute" });
  }
  // 國民之休日：前一天與後一天都是（法定）假日、本身不是假日也不是週日（例如銀色週的 9/22）
  for (let day = dayOfYmd(year, 1, 2); day < dayOfYmd(year, 12, 31); day++) {
    const k = keyOfDay(day);
    if (all.has(k) || ymdOfDay(day).dow === 0) continue;
    if (stat.has(keyOfDay(day - 1)) && stat.has(keyOfDay(day + 1))) all.set(k, { name: "國民之休日", kind: "bridge" });
  }
  holidayCache.set(year, all);
  return all;
}

/** 這一天的國定假日名稱（含補假）；不是假日回傳 null */
export function holidayOf(c: CalendarYmd): PublicHoliday | null {
  return publicHolidays(c.y).get(key(c.m, c.d)) ?? null;
}

// ───────── 節日與習俗（非法定，但真的會影響客流） ─────────

export type CalendarTag =
  | "weekend"
  | "holiday"
  | "long_weekend"
  | "golden_week"
  | "obon"
  | "new_year"
  | "year_end"
  | "school_break"
  | "payday"
  | "season_event"
  | "moving_season";

export interface ObservanceDef {
  id: string;
  name: string;
  icon: string;
  /** 一句話說明（給玩家看） */
  note: string;
  /** 這一天算不算在其中（holiday＝當天國定假日名稱） */
  test: (c: CalendarYmd, holiday: string | null) => boolean;
  /** 客群倍率（整天；相對平日，未列出＝1） */
  traffic?: Partial<Record<PersonaId, number>>;
  /** 業態需求倍率（業態 id → 倍率） */
  demand?: Record<string, number>;
  /** 長假季（黃金週、盂蘭盆、年末年始）：算在內時，通用的「連休」加成不再疊加，避免重複計算 */
  season?: boolean;
  /** 這些日子公司與學校放假，視同週末（用週末的客流曲線） */
  offDay?: boolean;
  tags?: CalendarTag[];
}

const md = (c: CalendarYmd) => key(c.m, c.d);
/** 月日區間（含頭尾）；跨年的區間（12/29–1/3）也可以 */
const between = (c: CalendarYmd, m1: number, d1: number, m2: number, d2: number): boolean => {
  const v = md(c);
  const a = key(m1, d1);
  const b = key(m2, d2);
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
};
const isNthWeekday = (c: CalendarYmd, m: number, dow: number, n: number) => c.m === m && c.dow === dow && Math.ceil(c.d / 7) === n;

export const OBSERVANCES: ObservanceDef[] = [
  // ── 長假季
  {
    id: "year_end", name: "年末", icon: "🎍", note: "大掃除與年菜採買、回鄉前的最後衝刺；上班族休假。", season: true, offDay: true, tags: ["year_end"],
    test: (c) => between(c, 12, 29, 12, 31),
    traffic: { commuter: 0.4, local: 1.3, family: 1.25, tourist: 1.1, couple: 1.1 },
    demand: { grocery: 1.35, bakery: 1.2, sushi: 1.3, florist: 1.25, sweets: 1.2, izakaya: 1.15, hotpot: 1.2, laundry: 1.2, repair: 1.15, stationery: 1.1, print_shop: 1.3, clinic: 1.1, dental: 1.1, drugstore: 1.1, electronics: 1.08 },
  },
  {
    id: "new_year", name: "新年", icon: "🎌", note: "初詣與福袋，一家老小出來逛；上班族幾乎不出現。", season: true, offDay: true, tags: ["new_year"],
    test: (c) => between(c, 1, 1, 1, 3),
    traffic: { commuter: 0.3, local: 1.35, family: 1.45, couple: 1.25, tourist: 1.25, student: 1.15 },
    demand: { sweets: 1.3, kaiseki: 1.4, fashion: 1.35, shoes: 1.25, toy_store: 1.3, accessory: 1.2, cosmetics: 1.25, kids_play: 1.2, photo_studio: 1.3, electronics: 1.15, camera: 1.1, gamestore: 1.15, anime_goods: 1.15, bookstore: 1.1, vinyl: 1.1, stationery: 1.1 },
  },
  {
    id: "golden_week", name: "黃金週", icon: "🎏", note: "一年最長的連假：全家出遊、旅客最多，上班族休息。", season: true, offDay: true, tags: ["golden_week"],
    test: (c) => between(c, 4, 29, 5, 6),
    traffic: { family: 1.45, tourist: 1.3, couple: 1.2, student: 1.15, commuter: 0.6 },
    demand: { kids_play: 1.4, cinema: 1.2, observatory: 1.25, craft_studio: 1.2, food_truck: 1.2, beer_garden: 1.2, hotel: 1.2, luggage: 1.3, travel_agency: 1.3, parking: 1.25, camera: 1.1, photo_studio: 1.2, spa: 1.1, capsule_hotel: 1.15, art_gallery: 1.1 },
  },
  {
    id: "obon", name: "盂蘭盆節", icon: "🏮", note: "很多人回鄉探親，在地客與上班族變少；返鄉旅客與家族出遊增加，花與供品好賣。", season: true, offDay: true, tags: ["obon"],
    test: (c) => between(c, 8, 13, 8, 16),
    traffic: { commuter: 0.45, local: 0.85, family: 1.35, tourist: 1.2, couple: 1.1 },
    demand: { florist: 1.5, sweets: 1.2, grocery: 1.15, luggage: 1.4, hotel: 1.2, travel_agency: 1.25, beer_garden: 1.15, parking: 1.15 },
  },
  // ── 學校長假
  {
    id: "summer_break", name: "暑假", icon: "🌻", note: "孩子放假：親子、學生與遊樂類的業態變熱門。", tags: ["school_break"],
    test: (c) => between(c, 7, 21, 8, 31),
    traffic: { family: 1.15, student: 1.2, couple: 1.05, commuter: 0.95 },
    demand: { kids_play: 1.3, arcade_vr: 1.2, claw: 1.15, cinema: 1.1, craft_studio: 1.2, bubble_tea: 1.1, cram_school: 1.35, juice_bar: 1.1, gamestore: 1.15, anime_goods: 1.1, toy_store: 1.1, stationery: 1.1, laundry: 1.1, daycare: 1.15, bookstore: 1.05 },
  },
  {
    id: "spring_break", name: "春假", icon: "🌱", note: "學年交替的短假。", tags: ["school_break"],
    test: (c) => between(c, 3, 25, 4, 7),
    traffic: { student: 1.15, family: 1.1 },
    demand: { arcade_vr: 1.1, cinema: 1.1, kids_play: 1.15 },
  },
  {
    id: "winter_break", name: "寒假", icon: "⛄", note: "年底年初的學校長假。", tags: ["school_break"],
    test: (c) => between(c, 12, 25, 1, 7),
    traffic: { student: 1.1, family: 1.1 },
    demand: { cinema: 1.1, arcade_vr: 1.1, kids_play: 1.1 },
  },
  // ── 季節
  {
    id: "sakura", name: "賞花季", icon: "🌸", note: "櫻花盛開，出來散步的人多，餐車與啤酒花園生意好。", tags: ["season_event"],
    test: (c) => between(c, 3, 25, 4, 10),
    traffic: { tourist: 1.15, couple: 1.15, local: 1.1, family: 1.1 },
    demand: { food_truck: 1.3, beer_garden: 1.25, sweets: 1.2, craft_beer: 1.1, observatory: 1.15, flea_market: 1.15 },
  },
  {
    id: "new_life", name: "新生活旺季", icon: "📦", note: "入學、就職、搬家：文具、家電與洗衣、補習的需求上升。", tags: ["moving_season"],
    test: (c) => between(c, 3, 20, 4, 10),
    demand: { stationery: 1.3, electronics: 1.15, laundry: 1.2, print_shop: 1.2, cram_school: 1.25, salon: 1.1, repair: 1.1, convenience: 1.05 },
  },
  {
    id: "koyo", name: "紅葉季", icon: "🍁", note: "賞楓遊客與情侶增加。", tags: ["season_event"],
    test: (c) => between(c, 11, 10, 11, 30),
    traffic: { tourist: 1.15, couple: 1.15, local: 1.05 },
    demand: { kissaten: 1.15, kaiseki: 1.2, observatory: 1.15, art_gallery: 1.1, sweets: 1.1 },
  },
  // ── 節日
  {
    id: "valentine", name: "情人節", icon: "💝", note: "巧克力與告白的日子：情侶與學生變多。", tags: ["season_event"],
    test: (c) => c.m === 2 && c.d === 14,
    traffic: { couple: 1.5, student: 1.2, local: 1.05 },
    demand: { sweets: 1.5, bakery: 1.25, accessory: 1.3, florist: 1.5, fine_dining: 1.4, italian: 1.2, bar: 1.2, cosmetics: 1.15 },
  },
  {
    id: "white_day", name: "白色情人節", icon: "🤍", note: "回禮的日子。", tags: ["season_event"],
    test: (c) => c.m === 3 && c.d === 14,
    traffic: { couple: 1.3, student: 1.1 },
    demand: { accessory: 1.35, sweets: 1.35, florist: 1.25, cosmetics: 1.2, fine_dining: 1.2 },
  },
  {
    id: "mothers_day", name: "母親節", icon: "💐", note: "五月第二個週日：送花與甜點。", tags: ["season_event"],
    test: (c) => isNthWeekday(c, 5, 0, 2),
    traffic: { family: 1.2, couple: 1.05 },
    demand: { florist: 1.9, sweets: 1.3, accessory: 1.2, cosmetics: 1.2, fine_dining: 1.2, italian: 1.15 },
  },
  {
    id: "fathers_day", name: "父親節", icon: "👔", note: "六月第三個週日。", tags: ["season_event"],
    test: (c) => isNthWeekday(c, 6, 0, 3),
    traffic: { family: 1.1 },
    demand: { craft_beer: 1.2, izakaya: 1.1, select_shop: 1.15, shoes: 1.1 },
  },
  {
    id: "tanabata", name: "七夕", icon: "🎋", note: "許願與夜晚的小活動。", tags: ["season_event"],
    test: (c) => c.m === 7 && c.d === 7,
    traffic: { family: 1.1, couple: 1.15 },
    demand: { sweets: 1.15, craft_studio: 1.2 },
  },
  {
    id: "halloween", name: "萬聖節", icon: "🎃", note: "年輕人扮裝逛街。", tags: ["season_event"],
    test: (c) => between(c, 10, 25, 10, 31),
    traffic: { student: 1.2, couple: 1.15, family: 1.1 },
    demand: { toy_store: 1.25, sweets: 1.2, bakery: 1.1, photo_studio: 1.2, arcade_vr: 1.1, bar: 1.15 },
  },
  {
    id: "shichigosan", name: "七五三", icon: "👘", note: "孩子穿和服拍紀念照。", tags: ["season_event"],
    test: (c) => between(c, 11, 10, 11, 20),
    traffic: { family: 1.1 },
    demand: { photo_studio: 1.7, kaiseki: 1.2, sweets: 1.2, salon: 1.15 },
  },
  {
    id: "christmas", name: "聖誕節", icon: "🎄", note: "聖誕夜：情侶約會與家庭聚餐，蛋糕、禮物與餐廳都爆滿。", tags: ["season_event"],
    test: (c) => between(c, 12, 24, 12, 25),
    traffic: { couple: 1.6, family: 1.3, student: 1.1, tourist: 1.1 },
    demand: { fine_dining: 1.5, italian: 1.3, bakery: 1.4, accessory: 1.4, florist: 1.3, toy_store: 1.45, cinema: 1.2, observatory: 1.3, bar: 1.3, wine_bar: 1.3, teppanyaki: 1.25, cosmetics: 1.2 },
  },
  {
    id: "omisoka", name: "除夕", icon: "🔔", note: "年越蕎麥麵與跨年。", tags: ["season_event"],
    test: (c) => c.m === 12 && c.d === 31,
    demand: { soba: 1.7, izakaya: 1.2, observatory: 1.1 },
  },
  {
    id: "bonenkai", name: "忘年會季", icon: "🍻", note: "公司尾牙：居酒屋與燒肉爆滿。", tags: ["season_event"],
    test: (c) => between(c, 12, 6, 12, 28),
    traffic: { commuter: 1.05 },
    demand: { izakaya: 1.3, yakiniku: 1.15, bar: 1.15, craft_beer: 1.1, hotpot: 1.15 },
  },
  {
    id: "shinnenkai", name: "新年會季", icon: "🥂", note: "新年的聚餐。", tags: ["season_event"],
    test: (c) => between(c, 1, 8, 1, 20),
    demand: { izakaya: 1.15 },
  },
  {
    id: "payday", name: "發薪日", icon: "💴", note: "每月 25 日（遇假日提前到週五）：上班族口袋有錢，聚餐與購物變多。", tags: ["payday"],
    test: (c) => (c.d === 25 && c.dow >= 1 && c.dow <= 5) || (c.dow === 5 && (c.d === 23 || c.d === 24)),
    traffic: { commuter: 1.08, local: 1.06, couple: 1.05 },
    demand: { izakaya: 1.15, yakiniku: 1.12, fashion: 1.08, cosmetics: 1.05, electronics: 1.1, camera: 1.1, gamestore: 1.08, shoes: 1.06, spa: 1.1, nail: 1.08, salon: 1.06, select_shop: 1.06, bookstore: 1.05 },
  },
  // ── 特定國定假日的專屬效果
  {
    id: "h_coming_of_age", name: "成人之日", icon: "👘", note: "新成人穿振袖：美容美髮與寫真館大排長龍。",
    test: (_c, h) => h === "成人之日",
    traffic: { student: 1.25, couple: 1.1 },
    demand: { salon: 1.9, photo_studio: 1.9, nail: 1.4, fashion: 1.2 },
  },
  {
    id: "h_children", name: "兒童節", icon: "🎏", note: "給孩子的禮物與柏餅。",
    test: (_c, h) => h === "兒童節",
    demand: { toy_store: 1.4, kids_play: 1.3, sweets: 1.25 },
  },
  {
    id: "h_marine", name: "海之日", icon: "🌊", note: "暑假前的三連休，海邊與家庭出遊。",
    test: (_c, h) => h === "海之日",
    traffic: { family: 1.15, tourist: 1.1 },
    demand: { bubble_tea: 1.1 },
  },
  {
    id: "h_respect", name: "敬老之日", icon: "👵", note: "替長輩送禮、一起吃飯。",
    test: (_c, h) => h === "敬老之日",
    traffic: { family: 1.1, local: 1.05 },
    demand: { sweets: 1.25, florist: 1.25, kaiseki: 1.15, sushi: 1.1 },
  },
  {
    id: "h_equinox", name: "彼岸", icon: "🌼", note: "掃墓祭祖：花與和菓子（萩餅）好賣。",
    test: (_c, h) => h === "春分之日" || h === "秋分之日",
    traffic: { local: 1.05 },
    demand: { florist: 1.4, sweets: 1.15 },
  },
  {
    id: "h_sports", name: "體育之日", icon: "🏃", note: "適合全家出去動一動。",
    test: (_c, h) => h === "體育之日",
    traffic: { family: 1.15, local: 1.05 },
    demand: { gym: 1.1, kids_play: 1.15, food_truck: 1.15 },
  },
  {
    id: "h_culture", name: "文化之日", icon: "🎨", note: "美術館與書店的好日子。",
    test: (_c, h) => h === "文化之日",
    traffic: { tourist: 1.1, couple: 1.1 },
    demand: { art_gallery: 1.3, bookstore: 1.2, live_house: 1.15 },
  },
  {
    id: "h_thanks", name: "勤勞感謝日", icon: "🎁", note: "互相道謝、送小禮物。",
    test: (_c, h) => h === "勤勞感謝日",
    traffic: { local: 1.05, couple: 1.05 },
    demand: { sweets: 1.15 },
  },
];

/** 連休（連續 3 天以上的假日＋週末）的通用加成；黃金週、盂蘭盆、年末年始等長假季已經有自己的數字，不重複疊加 */
const LONG_WEEKEND_TRAFFIC: Partial<Record<PersonaId, number>> = { family: 1.15, tourist: 1.12, couple: 1.08, commuter: 0.85 };
const LONG_WEEKEND_DEMAND: Record<string, number> = { parking: 1.15, hotel: 1.1, travel_agency: 1.1, luggage: 1.15 };

export const TRAFFIC_CLAMP: [number, number] = [0.3, 2.2];
export const DEMAND_CLAMP: [number, number] = [0.5, 2.5];

// ───────── 一天的日曆 ─────────

export interface CalendarDay {
  /** 遊戲日序 */
  day: number;
  y: number;
  m: number;
  d: number;
  dow: number;
  /** 週末、國定假日、公司放假的日子：用週末的客流曲線 */
  offDay: boolean;
  /** 國定假日名稱（含補假、國民之休日）；不是假日為 null */
  holiday: string | null;
  /** 這一天有的節日與習俗（含黃金週、盂蘭盆、季節活動…） */
  observances: { id: string; name: string; icon: string; note: string }[];
  /** 連休：這是連續假日的第幾天／共幾天（3 天以上才算）；不是連休為 null */
  streak: { index: number; length: number } | null;
  tags: CalendarTag[];
  /** 各客群的客流倍率（全部相乘後夾限；沒有影響就是 1） */
  traffic: Record<PersonaId, number>;
  /** 有影響的業態需求倍率（其他業態是 1） */
  demand: Record<string, number>;
}

const PERSONA_IDS = PERSONAS.map((p) => p.id);
const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
const cache = new Map<number, CalendarDay>();
const rawOffCache = new Map<number, boolean>();

/** 不看連休的「這天放不放假」：週末、國定假日、或有 offDay 的節日（年末年始、黃金週、盂蘭盆） */
function rawOff(day: number): boolean {
  const hit = rawOffCache.get(day);
  if (hit !== undefined) return hit;
  const c = ymdOfDay(day);
  const holName = holidayOf(c)?.name ?? null;
  const off = c.dow === 0 || c.dow === 6 || holName !== null || OBSERVANCES.some((o) => o.offDay && o.test(c, holName));
  if (rawOffCache.size > 20_000) rawOffCache.clear();
  rawOffCache.set(day, off);
  return off;
}

/** 這一天的日曆資訊（依遊戲日序快取） */
export function calendarDay(day: number): CalendarDay {
  const hit = cache.get(day);
  if (hit) return hit;
  const c = ymdOfDay(day);
  const hol = holidayOf(c);
  const holName = hol?.name ?? null;
  const active = OBSERVANCES.filter((o) => o.test(c, holName));
  const offDay = rawOff(day);

  // 連休：往前後數連續放假的天數
  let streak: CalendarDay["streak"] = null;
  if (offDay) {
    let a = day;
    let b = day;
    while (a > day - 14 && rawOff(a - 1)) a--;
    while (b < day + 14 && rawOff(b + 1)) b++;
    const length = b - a + 1;
    if (length >= 3) streak = { index: day - a + 1, length };
  }

  const traffic = Object.fromEntries(PERSONA_IDS.map((p) => [p, 1])) as Record<PersonaId, number>;
  const demand: Record<string, number> = {};
  const applyTraffic = (t?: Partial<Record<PersonaId, number>>) => {
    if (t) for (const p of PERSONA_IDS) traffic[p] *= t[p] ?? 1;
  };
  const applyDemand = (dm?: Record<string, number>) => {
    if (dm) for (const [k, v] of Object.entries(dm)) demand[k] = (demand[k] ?? 1) * v;
  };
  for (const o of active) {
    applyTraffic(o.traffic);
    applyDemand(o.demand);
  }
  if (streak && !active.some((o) => o.season)) {
    applyTraffic(LONG_WEEKEND_TRAFFIC);
    applyDemand(LONG_WEEKEND_DEMAND);
  }
  for (const p of PERSONA_IDS) traffic[p] = clamp(traffic[p], TRAFFIC_CLAMP);
  for (const k of Object.keys(demand)) demand[k] = clamp(demand[k]!, DEMAND_CLAMP);

  const tags = new Set<CalendarTag>();
  if (c.dow === 0 || c.dow === 6) tags.add("weekend");
  if (hol) tags.add("holiday");
  if (streak) tags.add("long_weekend");
  for (const o of active) for (const t of o.tags ?? []) tags.add(t);

  const out: CalendarDay = {
    day,
    y: c.y,
    m: c.m,
    d: c.d,
    dow: c.dow,
    offDay,
    holiday: holName,
    observances: active.map(({ id, name, icon, note }) => ({ id, name, icon, note })),
    streak,
    tags: [...tags],
    traffic,
    demand,
  };
  if (cache.size > 5000) cache.clear();
  cache.set(day, out);
  return out;
}

/** 這一天對某個客群的客流倍率 */
export function calendarTraffic(day: number, persona: PersonaId): number {
  return calendarDay(day).traffic[persona];
}

/** 這一天的整體客流倍率（各客群依當天的到訪量加權平均）；客流預測與平衡測試用 */
export function calendarTrafficAverage(day: number): number {
  const c = calendarDay(day);
  let num = 0;
  let den = 0;
  for (const p of PERSONAS) {
    const w = p.dailyBase * (c.offDay ? p.weekendMult : 1);
    num += w * c.traffic[p.id];
    den += w;
  }
  return den > 0 ? num / den : 1;
}

/** 這一天對某個業態的需求倍率 */
export function calendarDemand(day: number, category: string): number {
  return calendarDay(day).demand[category] ?? 1;
}

/** 這一天值得讓玩家知道嗎（有國定假日、連休或節日；單純的週末不算） */
export function isNotable(c: CalendarDay): boolean {
  return c.holiday !== null || c.streak !== null || c.observances.some((o) => o.id !== "payday");
}

/** 從 day 起往後 days 天裡值得注意的日子（預報用） */
export function upcomingCalendar(day: number, days: number): CalendarDay[] {
  const out: CalendarDay[] = [];
  for (let i = 0; i < days; i++) {
    const c = calendarDay(day + i);
    if (isNotable(c)) out.push(c);
  }
  return out;
}

/** 給 HUD 用的短標籤：「🎌 新年・元日」「黃金週・昭和之日」；沒有特別的日子回傳 null */
export function calendarLabel(c: CalendarDay): string | null {
  const parts: string[] = [];
  const big = c.observances.find((o) => ["golden_week", "obon", "new_year", "year_end"].includes(o.id));
  if (big) parts.push(`${big.icon} ${big.name}`);
  if (c.holiday && !parts.some((p) => p.includes(c.holiday!))) parts.push(c.holiday);
  if (parts.length === 0) {
    const ev = c.observances.find((o) => o.id !== "payday" && !["summer_break", "spring_break", "winter_break", "new_life", "bonenkai", "shinnenkai"].includes(o.id));
    if (ev) parts.push(`${ev.icon} ${ev.name}`);
  }
  if (parts.length === 0 && c.streak) parts.push("連休");
  return parts.length > 0 ? parts.join("・") : null;
}

const PERSONA_NAME = Object.fromEntries(PERSONAS.map((p) => [p.id, p.name])) as Record<PersonaId, string>;

/** 給畫面用的說明：這一天對客流與業態的影響（只列影響明顯的） */
export function calendarEffectLines(c: CalendarDay): string[] {
  const lines: string[] = [];
  const t = PERSONA_IDS.filter((p) => Math.abs(c.traffic[p] - 1) >= 0.08)
    .sort((a, b) => Math.abs(c.traffic[b] - 1) - Math.abs(c.traffic[a] - 1))
    .map((p) => `${PERSONA_NAME[p]} ×${c.traffic[p].toFixed(2)}`);
  if (t.length > 0) lines.push(`客流：${t.join("、")}`);
  const dm = Object.entries(c.demand)
    .filter(([k, v]) => Math.abs(v - 1) >= 0.12 && CATEGORY_BY_ID[k])
    .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
    .slice(0, 6)
    .map(([k, v]) => `${CATEGORY_BY_ID[k]!.name} ×${v.toFixed(2)}`);
  if (dm.length > 0) lines.push(`熱門業態：${dm.join("、")}`);
  return lines;
}
