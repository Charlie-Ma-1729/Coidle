import type { FacilityDef } from "./facilities";

// 其他大型設施的定義：保齡球館、旅館、膠囊旅館、會議中心、活動場地。
// 一樣是「單位」逐步增加、各有自己的樓層；營運收入由 server/src/sim/facilities.ts 的 runVenues 依 econ 結算。
// 與影城不同的是：這些設施的人次公式全部寫在 econ 裡（影城保留專用常數，方便單獨調）。

export interface VenueEcon {
  /** 套用日曆／天氣／事件需求倍率的業態 id */
  category: string;
  /** 平均每人次收入 */
  price: number;
  /** 變動成本占收入比例 */
  varCost: number;
  /** 第 1 個單位的基準日人次；n 個單位 = base × n^exp × (1 + 0.12 × (商場等級 − 1)) */
  base: number;
  exp: number;
  /** 每個單位每日固定成本（人事、清潔、授權），打烊也照付 */
  upkeepPerUnitDay: number;
  /** 每個單位容量一天可周轉幾次（上限 = 單位容量合計 × turns） */
  turns: number;
  /** 各小時的熱度（0–23），營業時段內依比例分配當天人次 */
  hourWeight: number[];
}

const hours = (f: (h: number) => number): number[] => Array.from({ length: 24 }, (_, h) => f(h));
const inRange = (h: number, a: number, b: number): boolean => h >= a && h <= b;

export const VENUE_ECON: Record<string, VenueEcon> = {
  bowling: {
    category: "bowling",
    price: 1600,
    varCost: 0.15,
    base: 15,
    exp: 0.75,
    upkeepPerUnitDay: 14_000,
    turns: 10,
    hourWeight: hours((h) => (inRange(h, 18, 22) ? 1.5 : inRange(h, 12, 17) ? 0.9 : inRange(h, 10, 11) ? 0.4 : 0.3)),
  },
  hotel: {
    category: "hotel",
    price: 12_000,
    varCost: 0.3,
    base: 5,
    exp: 0.75,
    upkeepPerUnitDay: 18_000,
    turns: 1,
    hourWeight: hours((h) => (inRange(h, 15, 22) ? 1.4 : inRange(h, 10, 14) ? 0.8 : 0.4)),
  },
  capsule_hotel: {
    category: "capsule_hotel",
    price: 4500,
    varCost: 0.25,
    base: 6,
    exp: 0.75,
    upkeepPerUnitDay: 12_000,
    turns: 1,
    hourWeight: hours((h) => (inRange(h, 17, 23) ? 1.5 : inRange(h, 9, 16) ? 0.6 : 0.5)),
  },
  conference: {
    category: "conference",
    price: 6000,
    varCost: 0.25,
    base: 8.5,
    exp: 0.7,
    upkeepPerUnitDay: 24_000,
    turns: 2,
    hourWeight: hours((h) => (inRange(h, 9, 12) ? 1.3 : inRange(h, 13, 17) ? 1.1 : inRange(h, 18, 20) ? 0.4 : 0.1)),
  },
  event_space: {
    category: "event_space",
    price: 5000,
    varCost: 0.3,
    base: 7.5,
    exp: 0.7,
    upkeepPerUnitDay: 20_000,
    turns: 3,
    hourWeight: hours((h) => (inRange(h, 17, 21) ? 1.6 : inRange(h, 12, 16) ? 0.9 : inRange(h, 10, 11) ? 0.4 : 0.3)),
  },
};

/** 這一整天預期的人次（未乘日曆／天氣／事件需求）：單位越多遞增但遞減，商場等級越高越多 */
export function venueDailyVisitors(kind: string, units: number, level: number): number {
  const e = VENUE_ECON[kind];
  if (!e || units <= 0) return 0;
  return e.base * Math.pow(units, e.exp) * (1 + 0.12 * (Math.max(1, level) - 1));
}

const noop = (label: string) => (_k: number) => label;

export const VENUE_DEFS: FacilityDef[] = [
  {
    kind: "bowling",
    name: "保齡球館",
    unit: "球道",
    desc: "專屬的保齡球館樓層，一條球道一條球道往上加（最多 8 道）。球道越多越能同時容納團體客；晚上與假日最忙。保齡球館不再佔用娛樂層的店面格。",
    legacyCategory: "bowling",
    perFloor: 8,
    floorLabel: noop("保齡"),
    floorName: noop("保齡球館"),
    econ: VENUE_ECON.bowling,
    units: [
      { cost: 1_800_000, ticks: 288, minLevel: 3, amount: 4 },
      { cost: 900_000, ticks: 144, minLevel: 3, amount: 4 },
      { cost: 900_000, ticks: 144, minLevel: 3, amount: 4 },
      { cost: 1_000_000, ticks: 144, minLevel: 4, amount: 4 },
      { cost: 1_000_000, ticks: 144, minLevel: 4, amount: 4 },
      { cost: 1_200_000, ticks: 144, minLevel: 5, amount: 4 },
      { cost: 1_200_000, ticks: 144, minLevel: 5, amount: 4 },
      { cost: 1_400_000, ticks: 144, minLevel: 6, amount: 4 },
    ],
  },
  {
    kind: "hotel",
    name: "旅館",
    unit: "客房層",
    desc: "旅館是一整棟，一層一層往上加客房（每層 10 間，最多 6 層）。畫面有一樓大廳（櫃台辦理入住與退房）和一個標準客房層（旅客走到房間、退房離開）。住房量隨觀光客、連假與天氣起伏，之後可進駐旅館品牌。",
    legacyCategory: "hotel",
    perFloor: 6,
    floorLabel: noop("旅館"),
    floorName: noop("旅館（標準客房層）"),
    lobby: { label: "旅廳", name: "旅館大廳" },
    econ: VENUE_ECON.hotel,
    units: [
      { cost: 3_000_000, ticks: 432, minLevel: 8, amount: 10 },
      { cost: 2_800_000, ticks: 360, minLevel: 8, amount: 10 },
      { cost: 3_400_000, ticks: 360, minLevel: 8, amount: 10 },
      { cost: 4_000_000, ticks: 360, minLevel: 8, amount: 10 },
      { cost: 4_800_000, ticks: 360, minLevel: 8, amount: 10 },
      { cost: 5_800_000, ticks: 360, minLevel: 8, amount: 10 },
    ],
  },
  {
    kind: "capsule_hotel",
    name: "膠囊旅館",
    unit: "艙位層",
    desc: "一層一層往上加艙位（每層 24 個，最多 3 層）。便宜、周轉快，通勤族與背包客最愛。畫面有一樓大廳（櫃台辦理入住與退房）和一個標準艙位層。",
    legacyCategory: "capsule_hotel",
    perFloor: 3,
    floorLabel: noop("膠囊"),
    floorName: noop("膠囊旅館（標準艙位層）"),
    lobby: { label: "膠廳", name: "膠囊旅館大廳" },
    econ: VENUE_ECON.capsule_hotel,
    units: [
      { cost: 2_000_000, ticks: 360, minLevel: 8, amount: 24 },
      { cost: 1_800_000, ticks: 288, minLevel: 8, amount: 24 },
      { cost: 2_200_000, ticks: 288, minLevel: 8, amount: 24 },
    ],
  },
  {
    kind: "conference",
    name: "會議中心",
    unit: "會議廳",
    desc: "專屬的會議樓層，一間一間往上加會議廳（每間 60 席，最多 6 間）。上班時段最忙：報到、入座、聽簡報、茶歇。尾牙與新年會的旺季更熱鬧，之後可接企業客戶與活動檔期。",
    legacyCategory: "conference",
    perFloor: 6,
    floorLabel: noop("會議"),
    floorName: noop("會議中心"),
    econ: VENUE_ECON.conference,
    units: [
      { cost: 2_400_000, ticks: 288, minLevel: 8, amount: 60 },
      { cost: 2_000_000, ticks: 216, minLevel: 8, amount: 60 },
      { cost: 2_400_000, ticks: 216, minLevel: 8, amount: 60 },
      { cost: 2_800_000, ticks: 216, minLevel: 8, amount: 60 },
      { cost: 3_400_000, ticks: 252, minLevel: 8, amount: 60 },
      { cost: 4_000_000, ticks: 252, minLevel: 8, amount: 60 },
    ],
  },
  {
    kind: "event_space",
    name: "活動場地",
    unit: "活動區",
    desc: "專屬的活動廣場，一個活動區一個活動區往上加（每區可容 200 人，最多 4 區）。有舞台、觀眾區與攤位；傍晚與假日辦活動最熱。之後可接藝人活動與檔期。",
    legacyCategory: "event_space",
    perFloor: 4,
    floorLabel: noop("活動"),
    floorName: noop("活動場地"),
    econ: VENUE_ECON.event_space,
    units: [
      { cost: 1_800_000, ticks: 288, minLevel: 7, amount: 200 },
      { cost: 1_800_000, ticks: 216, minLevel: 7, amount: 200 },
      { cost: 2_400_000, ticks: 216, minLevel: 8, amount: 200 },
      { cost: 3_000_000, ticks: 252, minLevel: 8, amount: 200 },
    ],
  },
];
