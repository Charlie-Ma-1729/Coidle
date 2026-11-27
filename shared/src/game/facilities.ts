import type { PersonaId } from "./types";
import type { Facility, MallState } from "./types";
// 營運層（價格、維護、招商）見 facilityOps.ts
import { VENUE_DEFS, type VenueEcon } from "./venues";

// 大型設施：不佔店面格、由「單位」逐步增加（停車場＝地下層、電影院＝廳…）。
// 狀態是 MallState.facilities（可選欄位，舊存檔沒有）。規則見 docs/facilities.md。

export type FacilityKind = "parking" | "cinema" | "bowling" | "hotel" | "capsule_hotel" | "conference" | "event_space";

export interface FacilityUnitDef {
  /** 蓋這一個單位的費用／工期（tick）／商場最低等級 */
  cost: number;
  ticks: number;
  minLevel: number;
  /** 這個單位提供的量（停車場＝車位數） */
  amount: number;
}

export interface FacilityDef {
  kind: FacilityKind;
  name: string;
  /** 單位名稱（層、廳…） */
  unit: string;
  desc: string;
  /** 依序解鎖的單位（長度＝上限） */
  units: FacilityUnitDef[];
  /** 舊版是店面的業態 id：載入時轉成設施 */
  legacyCategory?: string;
  /** 每層樓放幾個單位（設施樓層的切法） */
  perFloor: number;
  /** 樓層標籤與名稱：例如 P1、8F */
  floorLabel: (k: number) => string;
  floorName: (k: number) => string;
  /** 旅館類才有：一樓大廳層的樓層標籤與名稱 */
  lobby?: { label: string; name: string };
  /** 營運收入的參數（影城、停車場沒有：各有專用邏輯）；見 venues.ts */
  econ?: VenueEcon;
}

const BASE_DEFS: FacilityDef[] = [
  {
    kind: "parking",
    name: "地下停車場",
    unit: "層",
    desc: "挖到地下一層一層往下蓋。車位越多，自駕來的家庭、情侶、通勤族越容易上門（效果會遞減），不佔任何樓層的店面格。",
    legacyCategory: "parking",
    perFloor: 1,
    floorLabel: (k) => `P${k + 1}`,
    floorName: (k) => `地下停車場 B${k + 2}`,
    units: [
      { cost: 1_900_000, ticks: 216, minLevel: 2, amount: 30 },
      { cost: 3_100_000, ticks: 288, minLevel: 3, amount: 50 },
      { cost: 5_000_000, ticks: 360, minLevel: 5, amount: 70 },
      { cost: 7_500_000, ticks: 432, minLevel: 7, amount: 100 },
    ],
  },
  {
    kind: "cinema",
    name: "影城",
    unit: "廳",
    desc: "專屬的影城樓層，一廳一廳往上加（每層 4 廳，共 2 層）。廳越多、片越豐富，看電影的人越多（遞減）；每廳要養人，連假、聖誕、經典老片週人潮更多。電影院不再佔用娛樂層的店面格。",
    legacyCategory: "cinema",
    perFloor: 4,
    floorLabel: (k) => `${8 + k}F`,
    floorName: (k) => `影城 ${k + 1} 樓`,
    units: [
      { cost: 1_200_000, ticks: 288, minLevel: 3, amount: 100 },
      { cost: 1_500_000, ticks: 216, minLevel: 3, amount: 100 },
      { cost: 2_000_000, ticks: 216, minLevel: 4, amount: 120 },
      { cost: 2_600_000, ticks: 216, minLevel: 5, amount: 120 },
      { cost: 3_400_000, ticks: 252, minLevel: 6, amount: 140 },
      { cost: 4_400_000, ticks: 252, minLevel: 7, amount: 140 },
      { cost: 5_600_000, ticks: 288, minLevel: 8, amount: 160 },
      { cost: 7_000_000, ticks: 288, minLevel: 8, amount: 160 },
    ],
  },
];

export const FACILITY_DEFS: FacilityDef[] = [...BASE_DEFS, ...VENUE_DEFS];

export const FACILITY_BY_KIND: Record<string, FacilityDef> = Object.fromEntries(FACILITY_DEFS.map((d) => [d.kind, d]));

/** 開自駕比例（沿用舊停車場業態的客群需求權重） */
export const DRIVE_SHARE: Partial<Record<PersonaId, number>> = { family: 0.7, couple: 0.4, local: 0.3, commuter: 0.3, tourist: 0.1 };

/** 停車場最多讓自駕客增加的比例（以開車比例 0.7 的客群為準） */
export const PARKING_MAX_BOOST = 0.05;
export const PARKING_SPACES_SCALE = 80;

export function facilityOf(s: Pick<MallState, "facilities">, kind: string): Facility | undefined {
  return s.facilities?.find((f) => f.kind === kind);
}

/** 已蓋好的單位數 */
export function facilityUnits(s: Pick<MallState, "facilities">, kind: string): number {
  return facilityOf(s, kind)?.units ?? 0;
}

/** 已蓋好的單位提供的總量（停車場＝總車位數） */
export function facilityAmount(s: Pick<MallState, "facilities">, kind: string): number {
  const def = FACILITY_BY_KIND[kind];
  const n = facilityUnits(s, kind);
  return def ? def.units.slice(0, n).reduce((a, u) => a + u.amount, 0) : 0;
}

/** 下一個單位的資訊與能不能蓋 */
export function nextFacilityUnit(
  s: Pick<MallState, "facilities" | "level" | "funds">,
  kind: string,
): { def: FacilityUnitDef | null; index: number; canBuy: boolean; reason: string | null } {
  const d = FACILITY_BY_KIND[kind];
  if (!d) return { def: null, index: 0, canBuy: false, reason: "沒有這種設施" };
  const f = facilityOf(s, kind);
  const index = (f?.units ?? 0) + (f?.building ? 1 : 0);
  if (f?.building) return { def: null, index, canBuy: false, reason: `正在興建第 ${index} ${d.unit}` };
  const u = d.units[index];
  if (!u) return { def: null, index, canBuy: false, reason: "已達上限" };
  if (s.level < u.minLevel) return { def: u, index, canBuy: false, reason: `商場要 Lv.${u.minLevel} 才能蓋第 ${index + 1} ${d.unit}` };
  if (s.funds < u.cost) return { def: u, index, canBuy: false, reason: "資金不足" };
  return { def: u, index, canBuy: true, reason: null };
}

/** 停車場對某客群來客量的倍率：車位越多越旺，但遞減；沒蓋就是 1（舊商場不受影響） */
export function parkingTrafficMult(s: Pick<MallState, "facilities">, persona: PersonaId): number {
  const d = DRIVE_SHARE[persona] ?? 0;
  if (d <= 0) return 1;
  const spaces = facilityAmount(s, "parking");
  if (spaces <= 0) return 1;
  return 1 + PARKING_MAX_BOOST * (1 - Math.exp(-spaces / PARKING_SPACES_SCALE)) * (d / 0.7) * parkingBoostScale(facilityOf(s, "parking"));
}

/** 停車場的收費政策（缺＝免費，也就是改版前的行為）；招商中一律由營運商收費 */
export function parkingPolicy(f: Facility | undefined): "free" | "validate" | "paid" {
  if (f?.ops?.operator) return "paid";
  const p = f?.ops?.policy;
  return p === "validate" || p === "paid" ? p : "free";
}

/** 自駕客來客加成的縮放：免費＝1；購物折抵 1.4；收費 0.6，標價越高越低（招商＝收費預設價） */
export function parkingBoostScale(f: Facility | undefined): number {
  const p = parkingPolicy(f);
  if (p === "validate") return 1.4;
  if (p === "paid") {
    const mult = f?.ops?.operator ? 1 : Math.min(1.5, Math.max(0.6, f?.ops?.priceMult ?? 1));
    return Math.max(0.2, Math.min(0.8, 0.6 - (mult - 1) * 0.8));
  }
  return 1;
}

// ───────── 設施樓層 ─────────

export interface FacilityFloor {
  id: string;
  kind: FacilityKind;
  label: string;
  name: string;
  /** 這層放的單位：[from, to)，超過已蓋好的數量表示還在蓋 */
  from: number;
  to: number;
  /** 旅館類的大廳層（辦理入住／退房的一樓大廳） */
  part?: "lobby";
}

/** 目前有哪些設施樓層（有單位蓋好或正在蓋才有）。停車場每層一個地下層；影城每 4 廳一層。 */
export function facilityFloors(s: Pick<MallState, "facilities">): FacilityFloor[] {
  const out: FacilityFloor[] = [];
  for (const d of FACILITY_DEFS) {
    const f = facilityOf(s, d.kind);
    if (!f) continue;
    const total = f.units + (f.building ? 1 : 0);
    const floors = Math.ceil(total / d.perFloor);
    // 旅館類：先有一樓大廳（第一層客房動工就開始蓋大廳），再有標準客房層
    if (d.lobby && total > 0) out.push({ id: `fac:${d.kind}:lobby`, kind: d.kind, label: d.lobby.label, name: d.lobby.name, from: 0, to: d.units.length, part: "lobby" });
    // 旅館類的標準客房層先封存（只留大廳），之後再開
    if (d.lobby) continue;
    for (let k = 0; k < floors; k++) {
      out.push({ id: `fac:${d.kind}:${k}`, kind: d.kind, label: d.floorLabel(k), name: d.floorName(k), from: k * d.perFloor, to: Math.min(d.units.length, (k + 1) * d.perFloor) });
    }
  }
  return out;
}

// ───────── 影城的需求 ─────────

export const CINEMA_TICKET = 1900;
export const CINEMA_VAR_COST = 0.35;
/** 每廳每日固定成本（放映師、清潔、授權） */
export const CINEMA_UPKEEP_PER_SCREEN_DAY = 6_000;
/** 每廳每日場次 */
export const CINEMA_SHOWS_PER_DAY = 4;
/** 第 1 廳的基準日觀影人次；廳數增加時以 n^0.7 遞增 */
export const CINEMA_BASE_VIEWERS = 15;

/** 一天的基準觀影人次（未乘日曆／天氣／事件需求）：廳越多遞增但遞減，商場等級越高越多 */
export function cinemaBaseViewers(screens: number, level: number): number {
  if (screens <= 0) return 0;
  return CINEMA_BASE_VIEWERS * Math.pow(screens, 0.7) * (1 + 0.12 * (Math.max(1, level) - 1));
}

/** 各小時的觀影熱度：晚上最旺 */
export const CINEMA_HOUR_WEIGHT: number[] = Array.from({ length: 24 }, (_, h) => (h >= 18 && h <= 21 ? 1.4 : h >= 12 && h <= 17 ? 0.85 : h >= 10 && h <= 11 ? 0.5 : h === 22 ? 0.7 : 0.4));
