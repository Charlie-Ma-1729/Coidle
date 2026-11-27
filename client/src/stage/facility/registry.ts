import type { Rng } from "../crowd";
import type { FacilitySpec } from "../facilityspec";
import { bowlingView } from "./bowling";
import { cinemaView } from "./cinema";
import { conferenceView } from "./conference";
import { eventView } from "./event";
import { hotelView } from "./hotel";
import { hotelLobbyView } from "./hotellobby";
import { parkingView } from "./parking";
import type { FacilityClock, FacilityView } from "./types";

/**
 * 依規格種類找地圖模組。新增一種設施地圖：寫 facility/<kind>.ts（匯出 FacilityFactory）與同名的 *.sim.ts（純邏輯＋測試），
 * 再加進下面的 switch。
 */
export function createFacilityView(spec: FacilitySpec, rng: Rng, clock: FacilityClock): FacilityView {
  switch (spec.kind) {
    case "parking":
      return parkingView(spec, rng, clock);
    case "cinema":
      return cinemaView(spec, rng, clock);
    case "bowling":
      return bowlingView(spec, rng, clock);
    case "hotel":
    case "capsule_hotel":
      return spec.part === "lobby" ? hotelLobbyView(spec, rng, clock) : hotelView(spec, rng, clock);
    case "conference":
      return conferenceView(spec, rng, clock);
    case "event_space":
      return eventView(spec, rng, clock);
  }
}
