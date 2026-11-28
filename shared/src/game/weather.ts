/**
 * 天氣：由「遊戲日期」決定（純函式，沒有存檔狀態），所有商場同一天的天氣相同。
 *  - 依月份有不同的雨量、颱風與氣溫（梅雨季多雨、夏秋有颱風、冬天冷）
 *  - 雨天與颱風天只在一天中的某幾個小時下，其餘時間是陰天
 *  - 事件（連日大雨、颱風、寒流、酷暑）可以用 `weather` 修飾值強制覆寫一段時間
 * 天氣會影響：各客群的客流、各業態的需求（冷熱、雨天）、B1／1F 兩個對外樓層的相對人潮。
 * 伺服器模擬與前端（畫面、預報）共用這裡的規則。
 */
import { CLEANING_COST_PER_DAY, PERSONAS, TICKS_PER_DAY, TICKS_PER_HOUR } from "./data";
import { timeInfo } from "./time";
import type { EventDef, MallState, PersonaId, WeatherKind, WeatherSummary } from "./types";

export interface Weather {
  kind: WeatherKind;
  /** 氣溫（°C，整數） */
  temp: number;
}

export const WEATHER_NAMES: Record<WeatherKind, string> = { clear: "晴", cloudy: "陰", rain: "雨", storm: "暴風雨" };

export const HOT_TEMP = 32;
export const COLD_TEMP = 6;
export const isHot = (w: Weather): boolean => w.temp >= HOT_TEMP;
export const isCold = (w: Weather): boolean => w.temp <= COLD_TEMP;
export const isWet = (w: Weather): boolean => w.kind === "rain" || w.kind === "storm";

// ───────── 依日期決定 ─────────

/** 雜湊：日期＋用途 → 0 到 1 */
function rnd(n: number, salt: number): number {
  let x = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(salt + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** 月份 1–12 */
const MONTH_RAIN = [0.16, 0.18, 0.22, 0.24, 0.26, 0.5, 0.45, 0.24, 0.3, 0.26, 0.18, 0.14];
/** 每個月「有颱風天」的比例；颱風一次連續 2–3 天，所以開始的機率是這個比例除以平均長度 */
const MONTH_STORM = [0, 0, 0, 0, 0, 0.02, 0.03, 0.06, 0.08, 0.04, 0, 0];
const TYPHOON_AVG_DAYS = 2.5;
const MONTH_TEMP = [6, 6, 10, 15, 20, 23, 27, 29, 25, 19, 13, 8];
const CLOUDY_SHARE = 0.3;

function monthOfDay(day: number): number {
  return new Date(day * 86_400_000).getUTCMonth() + 1;
}

/** 這一天的「天氣擲骰」：有 45% 的機率沿用前一天（天氣會連著幾天），所以會有連日雨 */
function roll(day: number, depth = 0): number {
  if (depth < 6 && rnd(day, 7) < 0.45) return roll(day - 1, depth + 1);
  return rnd(day, 1);
}

export interface DayWeather extends Weather {
  /** 下雨（或颱風）的時段：[from, to) 小時；晴／陰天為 null */
  window: [number, number] | null;
  /** 颱風會連續 2–3 天：這是第幾天（0 起算）、一共幾天；不是颱風為 undefined */
  typhoon?: { day: number; days: number };
}

/**
 * 颱風：一次連續 2–3 天。第一天下午起風雨、中間整天、最後一天只到上午；
 * 往前找最近 3 天內有沒有颱風開始。回傳這一天是第幾天、共幾天，以及那天的風雨時段。
 */
function typhoonOn(day: number): { day: number; days: number; window: [number, number] } | null {
  for (let back = 0; back < 3; back++) {
    const d0 = day - back;
    const p = MONTH_STORM[monthOfDay(d0) - 1]! / TYPHOON_AVG_DAYS;
    if (p <= 0 || rnd(d0, 21) >= p) continue;
    const days = 2 + Math.floor(rnd(d0, 22) * 2); // 2 或 3 天
    if (back >= days) continue;
    const from = back === 0 ? 12 + Math.floor(rnd(d0, 23) * 6) : 0; // 第一天 12–17 點起
    const to = back === days - 1 ? 8 + Math.floor(rnd(d0, 24) * 8) : 24; // 最後一天 8–15 點結束
    return { day: back, days, window: [from, to] };
  }
  return null;
}

/** 這一天的天氣概況（預報用）。kind 是整天的主要天氣，雨與颱風只在 window 內下。 */
export function dayWeather(day: number): DayWeather {
  const m = monthOfDay(day) - 1;
  const ty = typhoonOn(day);
  if (ty) {
    const temp = Math.round(MONTH_TEMP[m]! - 1 + (rnd(day, 5) - 0.5) * 4);
    return { kind: "storm", temp, window: ty.window, typhoon: { day: ty.day, days: ty.days } };
  }
  const x = roll(day);
  const rain = MONTH_RAIN[m]!;
  let kind: WeatherKind;
  if (x < rain) kind = "rain";
  else kind = rnd(day, 3) < CLOUDY_SHARE ? "cloudy" : "clear";

  let temp = MONTH_TEMP[m]! + (rnd(day, 5) - 0.5) * 7;
  if (kind === "rain") temp -= 2;
  else if (kind === "clear") temp += 1.5;
  temp = Math.round(temp);

  let window: [number, number] | null = null;
  if (kind === "rain") {
    const from = 4 + Math.floor(rnd(day, 11) * 9); // 4–12 點開始
    window = [from, Math.min(24, from + 6 + Math.floor(rnd(day, 12) * 11))];
  }
  return { kind, temp, window };
}

/** 某一天某個小時的實際天氣（雨、颱風只在時段內，時段外是陰天） */
export function weatherAt(day: number, hour: number): Weather {
  const d = dayWeather(day);
  if (d.window && (hour < d.window[0] || hour >= d.window[1])) return { kind: "cloudy", temp: d.temp };
  return { kind: d.kind, temp: d.temp };
}

let cache: { s: unknown; tick: number; n: number; w: Weather } | null = null;

/** 這座商場此刻的天氣：有事件強制的天氣就用它，否則依遊戲日期（同一個 tick 內有快取） */
export function weatherNow(s: Pick<MallState, "tick" | "modifiers">): Weather {
  if (cache && cache.s === s && cache.tick === s.tick && cache.n === s.modifiers.length) return cache.w;
  let w: Weather | null = null;
  for (let i = s.modifiers.length - 1; i >= 0; i--) {
    const m = s.modifiers[i]!;
    if (m.kind === "weather" && m.endTick > s.tick) {
      w = { kind: m.weather, temp: m.temp };
      break;
    }
  }
  if (!w) {
    const t = timeInfo(s.tick);
    w = weatherAt(t.day, t.hour);
  }
  cache = { s, tick: s.tick, n: s.modifiers.length, w };
  return w;
}

// ───────── 事件的天氣條件 ─────────

/** 事件文字裡明講「連日下雨」的說法（梅雨、連下好幾天…） */
const STREAK_RAIN = /(連日|連續|接連|持續|一直).{0,4}雨|雨.{0,3}(連下|下個不停|連著下)|連下.{0,3}雨|梅雨/;
/** 事件文字裡明講「正在下雨」的說法 */
const WET_RAIN = /下雨|雨水|大雨|豪雨|雨天|淋雨|雨勢|淋濕|雨中|雨夜/;

/**
 * 這個事件需要什麼天氣才合理：
 *  - "wet"：此刻正在下雨（雨或暴風雨）；"wet_streak"：連著下了兩天以上的雨。
 * 明確寫了 `needsWeather` 就用它；沒寫的（包含 AI 生成的、已經核准上線的舊事件），
 * 看標題與內文有沒有講到下雨——寫「連日的雨」就要連日有雨，寫「雨水滲進來」就要此刻在下雨。
 * 描述天氣本身的事件（category 是 weather，它們自己會強制天氣）不受限。
 */
export function weatherNeedOf(def: Pick<EventDef, "category" | "title" | "text" | "needsWeather">): "wet" | "wet_streak" | null {
  if (def.needsWeather !== undefined) return def.needsWeather;
  if (def.category === "weather") return null;
  const t = `${def.title}${def.text}`;
  if (STREAK_RAIN.test(t)) return "wet_streak";
  if (WET_RAIN.test(t)) return "wet";
  return null;
}

/** 此刻的天氣符不符合事件的條件。事件強制的連日大雨本身就是「連日」，不用再看前一天。 */
export function weatherAllows(need: "wet" | "wet_streak" | null, s: Pick<MallState, "tick" | "modifiers">): boolean {
  if (need === null) return true;
  if (!isWet(weatherNow(s))) return false;
  if (need === "wet") return true;
  if (s.modifiers.some((m) => m.kind === "weather" && m.endTick > s.tick && (m.weather === "rain" || m.weather === "storm"))) return true;
  return isWet({ kind: dayWeather(timeInfo(s.tick).day - 1).kind, temp: 0 });
}

// ───────── 對遊戲的影響 ─────────

/** 各客群的客流倍率（以天氣種類為主，另有熱／冷的修正）。晴天略高於 1，讓全年平均接近 1。 */
const TRAFFIC: Record<WeatherKind, Record<PersonaId, number>> = {
  clear: { tourist: 1.08, local: 1.02, commuter: 1.01, family: 1.12, student: 1.05, couple: 1.08 },
  cloudy: { tourist: 1, local: 1, commuter: 1, family: 1, student: 1, couple: 1 },
  rain: { tourist: 0.78, local: 1.04, commuter: 0.92, family: 0.66, student: 0.88, couple: 0.82 },
  storm: { tourist: 0.35, local: 0.5, commuter: 0.55, family: 0.25, student: 0.4, couple: 0.3 },
};

export function weatherTraffic(w: Weather, persona: PersonaId): number {
  let m = TRAFFIC[w.kind][persona];
  if (isHot(w)) m *= 1.08; // 都往有冷氣的地方鑽
  else if (isCold(w) && (persona === "tourist" || persona === "family")) m *= 0.92;
  return m;
}

/** 全部客群加權平均的客流倍率（畫面上人潮的疏密用） */
export function weatherTrafficAverage(w: Weather): number {
  let num = 0;
  let den = 0;
  for (const p of PERSONAS) {
    num += p.dailyBase * weatherTraffic(w, p.id);
    den += p.dailyBase;
  }
  return num / den;
}

/** 業態需求倍率：冷熱天、雨天、晴天各有熱門與冷門 */
export function weatherDemand(w: Weather, category: string): number {
  let m = 1;
  if (isHot(w)) m *= HOT_DEMAND[category] ?? 1;
  if (isCold(w)) m *= COLD_DEMAND[category] ?? 1;
  if (w.kind === "rain") m *= RAIN_DEMAND[category] ?? 1;
  else if (w.kind === "storm") m *= STORM_DEMAND[category] ?? RAIN_DEMAND[category] ?? 1;
  else if (w.kind === "clear") m *= CLEAR_DEMAND[category] ?? 1;
  return m;
}

const HOT_DEMAND: Record<string, number> = {
  bubble_tea: 1.5, juice_bar: 1.4, sweets: 1.25, beer_garden: 1.2, ramen: 0.85, udon: 0.9, hotpot: 0.7, oden: 0.7,
  // 避暑：冷氣空間熱門，出汗的衣物多、需要洗；健身與戶外感的店冷清
  cinema: 1.1, bookstore: 1.1, electronics: 1.05, laundry: 1.12, spa: 1.08, coworking: 1.05, gym: 0.9, fashion: 0.95, flea_market: 0.8,
};
const COLD_DEMAND: Record<string, number> = {
  ramen: 1.4, udon: 1.4, hotpot: 1.5, oden: 1.5, curry: 1.15, taiyaki: 1.2, bubble_tea: 0.75, juice_bar: 0.7, beer_garden: 0.5, observatory: 0.7,
  // 寒流：冬衣、泡湯、感冒
  fashion: 1.06, shoes: 1.05, spa: 1.15, drugstore: 1.15, clinic: 1.12, convenience: 1.08, laundry: 0.95,
};
const RAIN_DEMAND: Record<string, number> = {
  kissaten: 1.15, ramen: 1.1, convenience: 1.12, drugstore: 1.05,
  cinema: 1.12, karaoke: 1.1, arcade_vr: 1.1, bowling: 1.08, escape_room: 1.08,
  observatory: 0.5, beer_garden: 0.4, food_truck: 0.4, flea_market: 0.4,
  // 雨天宅在室內：逛書店、3C、遊戲與按摩；街頭逛街的衣飾、花與寫真變少
  bookstore: 1.12, electronics: 1.08, camera: 0.95, gamestore: 1.1, vinyl: 1.1, art_gallery: 1.1, spa: 1.1, coworking: 1.08, clinic: 1.08, nail: 1.05, salon: 1.05,
  fashion: 0.92, accessory: 0.95, florist: 0.95, photo_studio: 0.9, laundry: 0.9,
};
const STORM_DEMAND: Record<string, number> = { ...RAIN_DEMAND, observatory: 0.1, beer_garden: 0.1, food_truck: 0.1, flea_market: 0.1 };
const CLEAR_DEMAND: Record<string, number> = {
  observatory: 1.25, beer_garden: 1.15, food_truck: 1.15, flea_market: 1.2,
  // 晴天出門逛街、拍照、約會；宅在家玩的業態略少
  fashion: 1.08, shoes: 1.08, accessory: 1.06, nail: 1.05, photo_studio: 1.1, camera: 1.08, florist: 1.05, popup: 1.06,
  bookstore: 0.95, gamestore: 0.95, cinema: 0.95, arcade_vr: 0.95,
};

/**
 * 樓層的相對人潮：B1 連通車站、淋不到雨；1F 有街道門，風雨最直接。
 * （其他樓層客人只搭電扶梯與電梯，不受影響。）
 */
export function weatherZoneFactor(w: Weather, zoneId: string): number {
  if (zoneId === "b1") return w.kind === "storm" ? 1.04 : w.kind === "rain" ? 1.08 : 1;
  if (zoneId === "f1") return w.kind === "storm" ? 0.8 : w.kind === "rain" ? 0.92 : 1;
  return 1;
}

/** 給畫面用的一句話：這個天氣對生意的影響 */
export function weatherSummary(w: Weather): string {
  if (w.kind === "storm") return "颱風天：客流大減，建議提早閉館；1F 受影響最大，B1 連通車站較安全；屋頂幾乎沒人。";
  if (w.kind === "rain") return "下雨：家庭、觀光客變少，在地客與室內娛樂、咖啡、拉麵變好；B1 淋不到雨，1F 較冷清；屋頂與市集沒人。";
  if (isHot(w)) return "酷暑：大家往有冷氣的商場躲，冷飲、甜點熱賣，火鍋與關東煮冷清。";
  if (isCold(w)) return "寒流：熱湯、火鍋、關東煮熱賣，冷飲冷清；家庭與觀光客稍少。";
  if (w.kind === "clear") return "晴天：出門的人多，家庭、情侶與觀光客變多；屋頂展望台、啤酒花園、市集生意好。";
  return "陰天：沒有特別影響。";
}

// ───────── 雨天的髒污與清潔員 ─────────

/**
 * 雨天館內變髒：客人鞋底帶進來的泥水（讓每份銷售的髒污變多 tracked 倍），
 * 加上雨水從門口、電梯與屋頂滲進來的固定髒污（每個 tick 的 leak，乘上商場規模）。
 * 颱風天更嚴重。
 */
export function wetDirt(w: Weather): { tracked: number; leak: number } {
  if (w.kind === "storm") return { tracked: 1.2, leak: 0.07 };
  if (w.kind === "rain") return { tracked: 0.6, leak: 0.025 };
  return { tracked: 0, leak: 0 };
}

/**
 * 雨天加派清潔員：有簽清潔（標準／加強）才有；打掃速度變快，但要多付一筆加班費
 * （costFrac 是「當天清潔費」的比例，只在下雨的時候計）。選「不做」就沒人加派，館內只會越來越髒。
 */
export function cleaningCrew(level: 0 | 1 | 2, w: Weather): { restoreMult: number; costFrac: number } {
  if (level === 0 || !isWet(w)) return { restoreMult: 1, costFrac: 0 };
  return w.kind === "storm" ? { restoreMult: 1.5, costFrac: 0.8 } : { restoreMult: 1.3, costFrac: 0.4 };
}

/** 雨天加派清潔員每個 tick 的額外支出 */
export function extraCleaningCostPerTick(level: 0 | 1 | 2, w: Weather): number {
  return (CLEANING_COST_PER_DAY[level] / TICKS_PER_DAY) * cleaningCrew(level, w).costFrac;
}

/** 畫面上同時在巡邏的清潔員人數：有客訴 1 位；簽了清潔的話，下雨再加 1 位、颱風加 2 位，「加強」再多 1 位（最多 3 位） */
export function cleanCrewSize(level: 0 | 1 | 2, w: Weather, complaint: boolean): number {
  let n = complaint ? 1 : 0;
  if (level > 0 && isWet(w)) n += w.kind === "storm" ? 2 : 1;
  if (level === 2 && isWet(w)) n += 1;
  return Math.min(3, n);
}

// ───────── 日報的天氣 ─────────

export function emptyWeatherTicks(): Record<WeatherKind, number> {
  return { clear: 0, cloudy: 0, rain: 0, storm: 0 };
}

/** 把一天累積的各種天氣 tick 數，整理成日報要記的摘要：有颱風算颱風，下雨滿 1 小時算雨，其餘看晴陰哪個多 */
export function summarizeWeatherDay(ticks: Record<WeatherKind, number> | undefined, temp: number | undefined): WeatherSummary | undefined {
  if (!ticks) return undefined;
  const total = ticks.clear + ticks.cloudy + ticks.rain + ticks.storm;
  if (total === 0) return undefined;
  const hours = {
    clear: Math.round(ticks.clear / TICKS_PER_HOUR),
    cloudy: Math.round(ticks.cloudy / TICKS_PER_HOUR),
    rain: Math.round(ticks.rain / TICKS_PER_HOUR),
    storm: Math.round(ticks.storm / TICKS_PER_HOUR),
  };
  let kind: WeatherKind;
  if (ticks.storm >= TICKS_PER_HOUR) kind = "storm";
  else if (ticks.rain + ticks.storm >= TICKS_PER_HOUR) kind = "rain";
  else kind = ticks.clear >= ticks.cloudy ? "clear" : "cloudy";
  return { kind, temp: temp ?? 20, hours };
}

/** 日報裡的天氣短句（一般的晴陰天回傳 null，不佔版面） */
export function weatherReportNote(w: WeatherSummary, cleaningLevel: 0 | 1 | 2): string | null {
  const wet = w.hours.rain + w.hours.storm;
  const crew = cleaningLevel > 0 ? "，加派了清潔員" : "，沒簽清潔所以沒人加派，地板越來越濕滑";
  if (w.kind === "storm") return `🌀 颱風天（風雨約 ${wet} 小時，${w.temp}°）：客流大減，雨水帶進館內的髒污多了一倍以上${crew}。`;
  if (w.kind === "rain") return `☔ 下了約 ${wet} 小時的雨（${w.temp}°）：家庭與觀光客變少，咖啡與室內娛樂變好，館內濕滑髒污變多${crew}。`;
  if (isHot({ kind: w.kind, temp: w.temp })) return `☀️ 酷暑（${w.temp}°）：大家往有冷氣的商場躲，冷飲與甜點熱賣。`;
  if (isCold({ kind: w.kind, temp: w.temp })) return `🥶 寒流（${w.temp}°）：熱湯與火鍋熱賣，冷飲冷清。`;
  return null;
}
