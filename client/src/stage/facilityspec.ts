import { CINEMA_HOUR_WEIGHT, CINEMA_SHOWS_PER_DAY, FACILITY_BY_KIND, cinemaBaseViewers, facilityOf, venueDailyVisitors, type PublicMallState } from "@coidle/shared";
import type { StageFloor } from "./model";

/** 這幾種設施共用「單位清單」的規格（保齡球館、旅館、膠囊旅館、會議中心、活動場地） */
export type VenueKind = "bowling" | "hotel" | "capsule_hotel" | "conference" | "event_space";
export const VENUE_KINDS: VenueKind[] = ["bowling", "hotel", "capsule_hotel", "conference", "event_space"];

/** 設施樓層的畫面規格：由真實狀態換算，純資料（可比較、可測試） */
export interface VenueSpec {
  kind: VenueKind;
  /** 旅館類的一樓大廳層（沒有就是標準客房層） */
  part?: "lobby";
  /** 這層每個單位（球道、客房層、會議廳、活動區）的容量與是否蓋好；施工中的也列出（畫施工條紋、不跑人） */
  units: { amount: number; built: boolean }[];
  /** 這一整天預期的人次（已乘單位數與商場等級）：模擬用來決定場內大約有多少人 */
  daily: number;
}

export type FacilitySpec =
  | { kind: "parking"; spaces: number; built: boolean }
  | { kind: "cinema"; rooms: { seats: number; built: boolean }[]; /** 每場基準觀眾（尚未乘時段熱度） */ showBase: number }
  | VenueSpec;

export function facilitySpec(s: Pick<PublicMallState, "facilities" | "level">, floor: StageFloor): FacilitySpec | null {
  const fc = floor.facility;
  if (!fc) return null;
  const def = FACILITY_BY_KIND[fc.kind];
  const f = facilityOf(s, fc.kind);
  if (!def) return null;
  const units = f?.units ?? 0;
  if (fc.kind === "parking") {
    const u = def.units[fc.from];
    if (!u) return null;
    return { kind: "parking", spaces: u.amount, built: fc.from < units };
  }
  const rooms: { amount: number; built: boolean }[] = [];
  for (let i = fc.from; i < fc.to; i++) {
    const u = def.units[i];
    if (!u) continue;
    if (i < units || (i === units && f?.building)) rooms.push({ amount: u.amount, built: i < units });
  }
  if (rooms.length === 0) return null;
  const built = Math.max(1, units);
  if (fc.kind === "cinema") return { kind: "cinema", rooms: rooms.map((r) => ({ seats: r.amount, built: r.built })), showBase: cinemaBaseViewers(built, s.level) / (built * CINEMA_SHOWS_PER_DAY) };
  if ((VENUE_KINDS as string[]).includes(fc.kind)) return { kind: fc.kind as VenueKind, ...(fc.part ? { part: fc.part } : {}), units: rooms, daily: venueDailyVisitors(fc.kind, units, s.level) };
  return null;
}

/** 設施樓層畫面的重建簽名 */
export function specKey(sp: FacilitySpec): string {
  if (sp.kind === "parking") return `p:${sp.spaces}:${sp.built ? 1 : 0}`;
  if (sp.kind === "cinema") return `c:${sp.rooms.map((r) => `${r.seats}${r.built ? "+" : "-"}`).join(",")}:${Math.round(sp.showBase)}`;
  return `${sp.kind}${sp.part ? ":lobby" : ""}:${sp.units.map((r) => `${r.amount}${r.built ? "+" : "-"}`).join(",")}:${Math.round(sp.daily)}`;
}

/** 某場電影的觀眾數：每場基準 × 時段熱度（晚上最旺），不超過座位的 95% */
export function showAudience(seats: number, showBase: number, startMinute: number): number {
  const w = CINEMA_HOUR_WEIGHT[Math.floor(startMinute / 60) % 24] ?? 0.5;
  return Math.max(4, Math.min(seats * 0.95, (showBase * w) / 0.75));
}
