import { SHIRTS, WALK_SPEED, advance, type Mover, type Pt, type Rect } from "../facilitymap";
import type { Rng } from "../crowd";

/** 活動場地（屋頂廣場）平面圖與模擬：純邏輯、不依賴 Pixi。入場 → 在舞台前看表演 → 散場；平時有人逛攤位。 */

export interface EventLayout {
  width: number;
  height: number;
  stage: Rect;
  pit: Rect;
  stalls: Rect[];
  gate: Pt;
  booth: Rect;
  /** 觀眾站位（隨活動區數增加） */
  spots: Pt[];
  /** 攤位前閒逛的點 */
  browse: Pt[];
  /** 舞台上表演者的位置 */
  performers: Pt[];
}

/** areas：活動區數（1–4）；每個活動區多一排觀眾站位與一個攤位 */
export function layoutEvent(areas: number): EventLayout {
  const n = Math.max(1, Math.min(4, areas));
  const width = 260;
  const height = 170;
  const stage: Rect = { x: 70, y: 8, w: 120, h: 30 };
  const pit: Rect = { x: 40, y: 48, w: 180, h: 18 + n * 18 };
  const spots: Pt[] = [];
  for (let y = pit.y + 6; y < pit.y + pit.h - 2; y += 8) for (let x = pit.x + 6; x < pit.x + pit.w - 2; x += 9) spots.push({ x: x + (((x * 7 + y * 13) % 5) - 2) * 0.4, y });
  const stalls: Rect[] = [];
  for (let i = 0; i < n; i++) {
    stalls.push({ x: 6, y: 52 + i * 22, w: 22, h: 14 });
    stalls.push({ x: width - 28, y: 52 + i * 22, w: 22, h: 14 });
  }
  const browse: Pt[] = stalls.map((s) => ({ x: s.x < width / 2 ? s.x + s.w + 6 : s.x - 6, y: s.y + s.h + 4 }));
  return {
    width,
    height,
    stage,
    pit,
    stalls,
    gate: { x: width / 2, y: height - 4 },
    booth: { x: width / 2 - 36, y: height - 22, w: 16, h: 12 },
    spots,
    browse,
    performers: [{ x: stage.x + 36, y: stage.y + 16 }, { x: stage.x + 60, y: stage.y + 14 }, { x: stage.x + 84, y: stage.y + 16 }],
  };
}

export interface EventShow {
  start: number;
  end: number;
  /** 觀眾量倍率（午間小場 0.5、晚間主場 1） */
  scale: number;
}

/** 一天的活動：午後 13:30–15:00 小型活動、傍晚 18:00–20:30 主場；落在營業時段內才有 */
export function eventSchedule(openHour: number, closeHour: number): EventShow[] {
  return [
    { start: 13 * 60 + 30, end: 15 * 60, scale: 0.5 },
    { start: 18 * 60, end: 20 * 60 + 30, scale: 1 },
  ].filter((e) => e.start - 40 >= openHour * 60 && e.end + 10 <= closeHour * 60);
}

interface Guest {
  id: number;
  show: number;
  spot: Pt;
  color: number;
  arriveAt: number;
  leaveAt: number;
  phase: "hidden" | "in" | "watch" | "out" | "gone";
  pos: Pt;
  path: Pt[];
}
interface Stroller {
  id: number;
  color: number;
  pos: Pt;
  path: Pt[];
  wait: number;
}

export class EventSim {
  readonly shows: EventShow[];
  private guests: Guest[] = [];
  private strollers: Stroller[] = [];
  private last: number;
  private nextId = 1;

  /**
   * @param count 這場主場想有幾位觀眾（呼叫端依基準日人次換算）；午間場依 scale 縮小
   */
  constructor(readonly layout: EventLayout, private rng: Rng, openHour: number, closeHour: number, minute: number, count: number) {
    this.shows = eventSchedule(openHour, closeHour);
    this.shows.forEach((sh, si) => {
      const n = Math.min(layout.spots.length, Math.round(count * sh.scale));
      const spots = [...layout.spots].sort(() => this.rng() - 0.5).slice(0, n).sort((a, b) => a.y - b.y); // 前排先坐滿
      for (const spot of spots) this.guests.push({ id: this.nextId++, show: si, spot, color: SHIRTS[Math.floor(this.rng() * SHIRTS.length)]!, arriveAt: sh.start - 38 + this.rng() * 34, leaveAt: sh.end + this.rng() * 8, phase: "hidden", pos: { ...layout.gate }, path: [] });
    });
    const k = Math.min(8, 3 + layout.stalls.length);
    for (let i = 0; i < k; i++) this.strollers.push({ id: this.nextId++, color: SHIRTS[Math.floor(this.rng() * SHIRTS.length)]!, pos: { ...layout.browse[i % layout.browse.length]! }, path: [], wait: this.rng() * 5 });
    this.last = minute;
    this.snap(minute);
  }

  private pathIn(g: Guest): Pt[] {
    return [{ x: this.layout.gate.x, y: this.layout.pit.y + this.layout.pit.h + 6 }, { x: g.spot.x, y: this.layout.pit.y + this.layout.pit.h + 6 }, { ...g.spot }];
  }

  private snap(minute: number): void {
    for (const g of this.guests) {
      const sh = this.shows[g.show]!;
      if (minute < g.arriveAt) g.phase = "hidden";
      else if (minute >= g.leaveAt + 6) g.phase = "gone";
      else if (minute >= g.leaveAt) {
        g.phase = "out";
        g.pos = { ...g.spot };
        g.path = [{ x: g.spot.x, y: this.layout.pit.y + this.layout.pit.h + 6 }, { ...this.layout.gate }];
      } else if (minute >= sh.start - 3) {
        g.phase = "watch";
        g.pos = { ...g.spot };
        g.path = [];
      } else {
        g.phase = "in";
        g.pos = { ...this.layout.gate };
        g.path = this.pathIn(g);
      }
    }
  }

  update(dt: number, minute: number): void {
    if (Math.abs(minute - this.last) > 40) this.snap(minute);
    this.last = minute;
    for (const g of this.guests) {
      switch (g.phase) {
        case "hidden":
          if (minute >= g.arriveAt && minute < this.shows[g.show]!.end) {
            g.phase = "in";
            g.pos = { ...this.layout.gate };
            g.path = this.pathIn(g);
          }
          break;
        case "in":
          if (advance(g.pos, g.path, WALK_SPEED * 1.3 * dt).done) g.phase = "watch";
          break;
        case "watch":
          if (minute >= g.leaveAt) {
            g.phase = "out";
            g.path = [{ x: g.spot.x, y: this.layout.pit.y + this.layout.pit.h + 6 }, { ...this.layout.gate }];
          }
          break;
        case "out":
          if (advance(g.pos, g.path, WALK_SPEED * 1.3 * dt).done) g.phase = "gone";
          break;
      }
    }
    for (const s of this.strollers) {
      if (s.path.length === 0) {
        s.wait -= dt;
        if (s.wait <= 0) {
          const to = this.layout.browse[Math.floor(this.rng() * this.layout.browse.length)]!;
          s.path = [{ x: to.x + (this.rng() - 0.5) * 6, y: to.y + (this.rng() - 0.5) * 4 }];
          s.wait = 3 + this.rng() * 6;
        }
      } else advance(s.pos, s.path, WALK_SPEED * 0.7 * dt);
    }
  }

  /** 此刻有活動在進行（舞台亮燈、表演者上台） */
  live(minute: number): boolean {
    return this.shows.some((s) => minute >= s.start - 2 && minute < s.end);
  }

  movers(): Mover[] {
    const out: Mover[] = [];
    for (const g of this.guests) {
      if (g.phase === "hidden" || g.phase === "gone") continue;
      out.push({ id: g.id, kind: "person", x: g.pos.x, y: g.pos.y, color: g.color, vertical: true, seated: false });
    }
    for (const s of this.strollers) out.push({ id: s.id, kind: "person", x: s.pos.x, y: s.pos.y, color: s.color, vertical: true, seated: false });
    return out;
  }
}

/** 主場想有幾位觀眾：基準日人次的 6 成集中在主場，不超過站位數 */
export function eventCrowd(daily: number, spots: number, weekend: boolean): number {
  return Math.max(6, Math.min(spots, Math.round(daily * 0.6 * (weekend ? 1.25 : 1))));
}
