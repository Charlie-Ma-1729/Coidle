import { VENUE_ECON, isHourOpen } from "@coidle/shared";
import type { FacilityClock } from "./types";

/** 這個設施此刻的時段熱度與營業時段熱度總和（和伺服器 runVenues 同一套權重）；打烊時 w = 0 */
export function hourShare(kind: string, c: FacilityClock): { w: number; sum: number } {
  const e = VENUE_ECON[kind];
  if (!e) return { w: 0, sum: 0 };
  let sum = 0;
  for (let h = 0; h < 24; h++) if (isHourOpen(c.open, c.close, h)) sum += e.hourWeight[h] ?? 0;
  const hour = Math.floor(c.minute / 60) % 24;
  return { w: isHourOpen(c.open, c.close, hour) ? (e.hourWeight[hour] ?? 0) : 0, sum };
}
