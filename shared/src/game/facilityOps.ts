import { CINEMA_TICKET, cinemaBaseViewers, facilityAmount, facilityOf, parkingPolicy, type FacilityDef } from "./facilities";
import { venueDailyVisitors } from "./venues";
import type { Facility, FacilityOps, MallState } from "./types";

// 設施的營運層：價格、政策、維護、招商。規則見 docs/facilities.md「營運層」。
// 全部是純函式；缺欄位的預設值＝改版前的行為，所以熱更新當天營收不變。

export const PRICE_MULT_MIN = 0.6;
export const PRICE_MULT_MAX = 1.5;

/** 標價相對於預設價的需求倍率：便宜一點客人多一點；超過 1.2 倍嫌貴（和店面的 PRICE_TOLERANCE 同一個門檻）。 */
export function priceFactor(mult: number): number {
  const m = Math.min(PRICE_MULT_MAX, Math.max(PRICE_MULT_MIN, mult));
  if (m <= 1) return 1 + (1 - m) * 0.6;
  if (m <= 1.2) return 1 - (m - 1) * 0.8;
  return Math.max(0.1, 0.84 - (m - 1.2) * 4);
}

export const opsOf = (f: Facility | undefined): FacilityOps => f?.ops ?? {};
export const priceMultOf = (f: Facility | undefined): number => Math.min(PRICE_MULT_MAX, Math.max(PRICE_MULT_MIN, f?.ops?.priceMult ?? 1));
export const conditionOf = (f: Facility | undefined): number => Math.min(100, Math.max(0, f?.ops?.condition ?? 100));
/** 是否正在招商（營運商在經營） */
export const isLeased = (f: Facility | undefined): boolean => !!f?.ops?.operator;

/** 設備狀態對營收的影響：70 以上沒事，往下逐漸打折，最差剩六成 */
export function conditionFactor(c: number): number {
  if (c >= 70) return 1;
  return 0.6 + (0.4 * Math.max(0, c)) / 70;
}

/** 設備每天損耗 */
export const CONDITION_DECAY_PER_DAY = 2;
/** 維護：花「已投入建設費」的 2.5%，回到 100；冷卻 2 遊戲日 */
export const MAINT_COST_RATE = 0.025;
export const MAINT_COOLDOWN_DAYS = 2;

/** 維護費＝這座設施已蓋好的單位建設費總和 × MAINT_COST_RATE */
export function maintenanceCost(def: FacilityDef, f: Facility | undefined): number {
  const n = f?.units ?? 0;
  return Math.round((def.units.slice(0, n).reduce((a, u) => a + u.cost, 0) * MAINT_COST_RATE) / 1000) * 1000;
}

// ───────── 停車場 ─────────

export const PARKING_POLICIES: Record<string, { label: string; desc: string }> = {
  free: { label: "免費", desc: "車位免費，不收費。自駕客最願意來，但沒有停車收入。" },
  validate: { label: "購物折抵", desc: "消費就折抵停車費，只有一部分人要付。最能把自駕客變成買氣，收入少。" },
  paid: { label: "計時收費", desc: "照標價收停車費。收入最多，但自駕客的來客加成會打折，標價越高打得越多。" },
};
/** 一次停車的預設收費、每個車位一天周轉幾次、平均有多少比例的車位在用 */
export const PARKING_FEE = 300;
export const PARKING_TURNS = 2.5;
export const PARKING_USAGE = 0.5;

/** 停車場一天的收費收入（沒蓋或免費＝0） */
export function parkingDailyIncome(s: Pick<MallState, "facilities">): number {
  const f = facilityOf(s, "parking");
  const p = parkingPolicy(f);
  if (!f || p === "free") return 0;
  const visits = facilityAmount(s, "parking") * PARKING_TURNS * PARKING_USAGE;
  const share = p === "validate" ? 0.3 : 1;
  const demand = p === "paid" ? priceFactor(priceMultOf(f)) : 1;
  return visits * demand * share * PARKING_FEE * priceMultOf(f) * conditionFactor(conditionOf(f));
}

// ───────── 影城：院線片 ─────────

export interface Film {
  id: string;
  name: string;
  genre: string;
  /** 票房熱度倍率（1＝平均片） */
  heat: number;
  /** 片商抽走的票房比例（授權費） */
  licensePct: number;
}

/** 院線片池（全部虛構）。每週上映其中 6 部，熱門片授權費高；沒排的廳放平均片 */
export const FILM_POOL: Film[] = [
  { id: "f_night_express", name: "夜行急行", genre: "懸疑", heat: 1.25, licensePct: 0.2 },
  { id: "f_umi_no_koe", name: "海的聲音再聽一次", genre: "動畫", heat: 1.45, licensePct: 0.3 },
  { id: "f_shotengai", name: "商店街的奇蹟", genre: "喜劇", heat: 1.1, licensePct: 0.14 },
  { id: "f_last_train", name: "末班電車之後", genre: "愛情", heat: 1.15, licensePct: 0.16 },
  { id: "f_kaiju_hr", name: "怪獸課長", genre: "動作", heat: 1.35, licensePct: 0.26 },
  { id: "f_tofu_days", name: "豆腐店的日子", genre: "文藝", heat: 0.85, licensePct: 0.06 },
  { id: "f_hoshizora", name: "星空列車的乘客", genre: "動畫", heat: 1.3, licensePct: 0.24 },
  { id: "f_old_camera", name: "老相機的祕密", genre: "懸疑", heat: 0.95, licensePct: 0.08 },
  { id: "f_summer_fes", name: "最後一個夏祭", genre: "青春", heat: 1.2, licensePct: 0.18 },
  { id: "f_rain_cafe", name: "雨天咖啡館", genre: "文藝", heat: 0.8, licensePct: 0.05 },
  { id: "f_robot_dad", name: "機器人老爸", genre: "家庭", heat: 1.05, licensePct: 0.12 },
  { id: "f_midnight_ring", name: "午夜來電", genre: "驚悚", heat: 1.0, licensePct: 0.1 },
];
export const FILM_BY_ID: Record<string, Film> = Object.fromEntries(FILM_POOL.map((f) => [f.id, f]));
/** 沒排片的廳放的片：熱度與授權費都是平均（等於改版前的行為，授權費含在原本的 35% 變動成本裡） */
export const AVERAGE_FILM: Film = { id: "avg", name: "院線平均片", genre: "綜合", heat: 1, licensePct: 0.1 };
export const CINEMA_CONCESSION_PRICE = 420;
export const CINEMA_CONCESSION_COST = 0.4;
/** 開了賣品，每廳每日多的固定成本（櫃台人力、設備） */
export const CINEMA_CONCESSION_UPKEEP = 3_000;

/** 這一週上映的 6 部（全服同一週同一份片單，每週輪替） */
export function weekFilms(day: number): Film[] {
  const week = Math.floor(Math.max(0, day) / 7);
  const start = (week * 3) % FILM_POOL.length;
  return Array.from({ length: 6 }, (_, i) => FILM_POOL[(start + i) % FILM_POOL.length]!);
}

/** 每廳實際放的片（沒排、排的片已下檔＝院線平均片） */
export function screeningFilms(f: Facility | undefined, day: number): Film[] {
  const week = weekFilms(day);
  return Array.from({ length: f?.units ?? 0 }, (_, i) => {
    const id = f?.ops?.films?.[i];
    return (id && week.find((x) => x.id === id)) || AVERAGE_FILM;
  });
}

/** 影城整體的片熱度與授權費率（廳平均；全部廳放同一部有「看膩」折扣） */
export function programmeEffect(f: Facility | undefined, day: number): { heat: number; licensePct: number } {
  const films = screeningFilms(f, day);
  if (films.length === 0) return { heat: 1, licensePct: AVERAGE_FILM.licensePct };
  const heat = films.reduce((a, x) => a + x.heat, 0) / films.length;
  const license = films.reduce((a, x) => a + x.licensePct, 0) / films.length;
  const distinct = new Set(films.map((x) => x.id)).size;
  const variety = films.length >= 3 && distinct === 1 && films[0]!.id !== AVERAGE_FILM.id ? 0.9 : 1;
  return { heat: heat * variety, licensePct: license };
}

// ───────── 其他設施的加值服務與政策 ─────────

export interface ExtraDef {
  label: string;
  desc: string;
  /** 營收增加的比例、額外的變動成本比例、每單位每日多的固定成本 */
  gain: number;
  cost: number;
  upkeepPerUnit: number;
}

export const EXTRA_DEFS: Record<string, ExtraDef> = {
  cinema: { label: "賣品（爆米花與飲料）", desc: "每位觀眾再賣一份賣品；多請櫃台人力。", gain: 0, cost: 0, upkeepPerUnit: CINEMA_CONCESSION_UPKEEP },
  bowling: { label: "聯賽夜", desc: "固定的聯賽之夜：球道更滿、多賣酒水，但要付裁判與獎品。", gain: 0.2, cost: 0.05, upkeepPerUnit: 2_500 },
  hotel: { label: "早餐與行李寄放", desc: "加收早餐與行李寄放費；多請人手。", gain: 0.1, cost: 0.05, upkeepPerUnit: 1_200 },
  capsule_hotel: { label: "大浴場與置物服務", desc: "加收大浴場使用與置物費；多請人手。", gain: 0.1, cost: 0.05, upkeepPerUnit: 700 },
  conference: { label: "茶歇與設備租借", desc: "會議附帶茶點與投影音響租借。", gain: 0.2, cost: 0.06, upkeepPerUnit: 3_000 },
  event_space: { label: "宣傳協力", desc: "幫活動主辦宣傳與票務，抽票務分潤。", gain: 0.2, cost: 0.06, upkeepPerUnit: 3_000 },
};

export const BOOKING_POLICIES: Record<string, { label: string; desc: string }> = {
  fcfs: { label: "先到先得", desc: "有人預約就接，檔期盡量排滿，全部外租。" },
  reserve: { label: "保留自辦檔期", desc: "每週有兩天的最後一場留給自己辦活動：沒有場租、只有一半的票務收入，但活動帶來口碑與觀光客熱度。" },
};
export const RESERVE_HEAT_PER_OWN_SLOT = 0.04;
/** 自辦檔期的收入是外租場租的幾成（票務分潤） */
export const OWN_SLOT_REVENUE = 0.5;

export function bookingPolicy(f: Facility | undefined): "fcfs" | "reserve" {
  return f?.ops?.policy === "reserve" ? "reserve" : "fcfs";
}

/**
 * 會議中心與活動場地「有預約才有收入」：每個單位（廳／活動區）每天有幾場檔期，
 * 外租客戶預約後，開場那一小時結算場租。預約由伺服器每天補到未來 BOOKING_HORIZON 天（決定性）。
 */
export const BOOKING_SLOT_HOURS: Record<string, number[]> = { conference: [9, 11, 13, 15], event_space: [13, 18] };
/** 一場的標準場租（乘價格倍率） */
export const BOOKING_FEE: Record<string, number> = { conference: 34_000, event_space: 45_000 };
/** 預約的基準填滿率（Lv.1；每級 +4%），再乘日曆／天氣需求、價格接受度與設備狀態 */
export const BOOKING_BASE_FILL = 0.5;
export const BOOKING_HORIZON = 7;
export const isBookable = (kind: string): boolean => kind === "conference" || kind === "event_space";
export const BOOKING_CLIENTS = ["あおぞら商事", "ひまわり製薬", "北斗電機", "みなと信用金庫", "さくら学園", "星野不動産", "渡辺会計事務所", "かもめ商店会", "つばさ旅行", "やまびこ農協"];

// ───────── 招商 ─────────

/** 沒有品牌目錄的設施（停車場）用的虛構營運商 */
export const PARKING_OPERATORS = ["ほしぞらパーキング", "ミナト駐車サービス", "ひなた時間貸し", "あさひパーク", "つむぎ時間貸し", "ブルーライン駐車場"];
export const OFFER_MAX = 2;

/** 一座設施預設價格下、基準的一日營收（不含日曆／天氣需求）：招商租金的依據 */
export function facilityBaselineRevenue(s: Pick<MallState, "facilities" | "level">, def: FacilityDef): number {
  const f = facilityOf(s, def.kind);
  const units = f?.units ?? 0;
  if (units <= 0) return 0;
  if (def.kind === "parking") return facilityAmount(s, "parking") * PARKING_TURNS * PARKING_USAGE * PARKING_FEE * 0.8;
  if (def.kind === "cinema") return cinemaBaseViewers(units, s.level) * CINEMA_TICKET;
  const e = def.econ;
  return e ? venueDailyVisitors(def.kind, units, s.level) * e.price : 0;
}

/** 營運商的營收倍率：品質與知名度高的品牌做得比一般好（約 0.9–1.2） */
export function operatorFactor(quality: number, fame: number): number {
  return 0.9 + 0.2 * Math.min(1, Math.max(0, (quality - 0.5) / 0.45)) * 0.7 + 0.1 * (fame / 100);
}
