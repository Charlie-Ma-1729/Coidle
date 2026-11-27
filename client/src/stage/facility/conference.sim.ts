import { SHIRTS, WALK_SPEED, advance, type Mover, type Pt, type Rect } from "../facilitymap";
import type { Rng } from "../crowd";

/** 會議中心平面圖與模擬：純邏輯、不依賴 Pixi。報到 → 入座聽簡報 → 茶歇 → 離開。 */

export const HALL_COLS = 10;
const DX = 8;
const DY = 8;
const PAD = 8;
const HALL_W = HALL_COLS * DX + PAD * 2;
const STAGE_ZONE = 22;
const LOBBY_H = 56;
const GAP = 10;

export interface Hall {
  index: number;
  rect: Rect;
  /** 講台（簡報者站的位置）與螢幕 */
  podium: Pt;
  screen: Rect;
  /** 座位（依喜歡坐的順序）與全部座位格 */
  seats: Pt[];
  grid: Pt[];
  door: Pt;
  inner: Pt;
  sideX: number;
  aisleY: number;
  above: boolean;
}
export interface ConferenceLayout {
  width: number;
  height: number;
  halls: Hall[];
  lobby: Rect;
  desk: Rect;
  coffee: Rect;
  entrance: Pt;
  /** 報到櫃台前排隊的點 */
  queue: Pt;
  /** 茶歇聊天的位置 */
  chat: Pt[];
}

/** seats：每間會議廳的席數（最多 6 間，3×2，大廳夾在中間） */
export function layoutConference(seatCounts: number[]): ConferenceLayout {
  const counts = seatCounts.slice(0, 6);
  const n = Math.max(1, counts.length);
  const rowsMax = Math.max(1, ...counts.map((s) => Math.ceil(s / HALL_COLS)));
  const hallH = STAGE_ZONE + rowsMax * DY + 12;
  const cols = Math.min(3, n);
  const width = 20 + cols * HALL_W + (cols - 1) * GAP;
  const lobbyY = 10 + hallH + 6;
  const lobby: Rect = { x: 10, y: lobbyY, w: width - 20, h: LOBBY_H };
  const botY = lobbyY + LOBBY_H + 6;
  const height = n > 3 ? botY + hallH + 10 : lobbyY + LOBBY_H + 10;
  const halls: Hall[] = counts.map((seats, i) => {
    const above = i < 3;
    const x = 10 + (i % 3) * (HALL_W + GAP);
    const y = above ? 10 : botY;
    const rect: Rect = { x, y, w: HALL_W, h: hallH };
    const rows = Math.ceil(seats / HALL_COLS);
    const grid: Pt[] = [];
    for (let k = 0; k < seats; k++) {
      const r = Math.floor(k / HALL_COLS);
      const c = k % HALL_COLS;
      grid.push({ x: x + PAD + c * DX + DX / 2, y: above ? y + STAGE_ZONE + r * DY + 4 : y + hallH - STAGE_ZONE - r * DY - 4 });
    }
    const mid = rows * 0.5;
    const frontY = above ? y + STAGE_ZONE : y + hallH - STAGE_ZONE;
    const seatsSorted = [...grid].sort((a, b) => Math.abs(Math.abs(a.y - frontY) / DY - mid) * 12 + Math.abs(a.x - (x + HALL_W / 2)) * 0.3 - (Math.abs(Math.abs(b.y - frontY) / DY - mid) * 12 + Math.abs(b.x - (x + HALL_W / 2)) * 0.3));
    return {
      index: i,
      rect,
      podium: { x: x + HALL_W / 2, y: above ? y + 12 : y + hallH - 12 },
      screen: { x: x + 18, y: above ? y + 3 : y + hallH - 6, w: HALL_W - 36, h: 3 },
      seats: seatsSorted,
      grid,
      door: { x: x + HALL_W / 2, y: above ? y + hallH : y },
      inner: { x: x + HALL_W / 2, y: above ? y + hallH - 5 : y + 5 },
      sideX: x + 4,
      aisleY: above ? y + hallH - 5 : y + 5,
      above,
    };
  });
  const cx = lobby.x + lobby.w / 2;
  return {
    width,
    height,
    halls,
    lobby,
    desk: { x: lobby.x + 10, y: lobby.y + 8, w: 34, h: 7 },
    coffee: { x: cx - 24, y: lobby.y + 8, w: 48, h: 7 },
    entrance: { x: lobby.x, y: lobby.y + lobby.h - 14 },
    queue: { x: lobby.x + 28, y: lobby.y + 24 },
    chat: [-30, -10, 10, 30].map((d) => ({ x: cx + d, y: lobby.y + 26 })),
  };
}

export interface Session {
  hall: number;
  start: number;
  end: number;
}
export const SESSION_LEN = 90;

/** 每間廳一天的場次：9:00、11:00、13:30、15:30 開始（每間錯開 10 分），散場要在打烊前 */
export function conferenceSchedule(hallCount: number, openHour: number, closeHour: number): Session[] {
  const out: Session[] = [];
  for (let h = 0; h < hallCount; h++) {
    for (const t of [9 * 60, 11 * 60, 13 * 60 + 30, 15 * 60 + 30]) {
      const start = t + h * 10;
      if (start - 25 >= openHour * 60 && start + SESSION_LEN <= closeHour * 60) out.push({ hall: h, start, end: start + SESSION_LEN });
    }
  }
  return out;
}

interface Attendee {
  id: number;
  session: number;
  seat: Pt;
  color: number;
  arriveAt: number;
  leaveAt: number;
  chatUntil: number;
  phase: "hidden" | "in" | "seated" | "out" | "chat" | "leaving" | "gone";
  pos: Pt;
  path: Pt[];
}

export class ConferenceSim {
  readonly sessions: Session[];
  private people: Attendee[] = [];
  private last: number;
  private nextId = 1;

  constructor(readonly layout: ConferenceLayout, private rng: Rng, openHour: number, closeHour: number, minute: number, private attendance: (hall: number, start: number) => number) {
    this.sessions = conferenceSchedule(layout.halls.length, openHour, closeHour);
    this.sessions.forEach((sh, si) => {
      const hall = layout.halls[sh.hall]!;
      const n = Math.max(0, Math.min(hall.seats.length, Math.round(this.attendance(sh.hall, sh.start))));
      for (let k = 0; k < n; k++) {
        const leaveAt = sh.end + this.rng() * 4;
        this.people.push({ id: this.nextId++, session: si, seat: hall.seats[k]!, color: SHIRTS[Math.floor(this.rng() * SHIRTS.length)]!, arriveAt: sh.start - 24 + this.rng() * 20, leaveAt, chatUntil: leaveAt + 8 + this.rng() * 8, phase: "hidden", pos: { ...layout.entrance }, path: [] });
      }
    });
    this.last = minute;
    this.snap(minute);
  }

  private chatPt(): Pt {
    const c = this.layout.chat[Math.floor(this.rng() * this.layout.chat.length)]!;
    return { x: c.x + (this.rng() - 0.5) * 10, y: c.y + (this.rng() - 0.5) * 8 };
  }
  private pathIn(p: Attendee): Pt[] {
    const L = this.layout;
    const hall = L.halls[this.sessions[p.session]!.hall]!;
    const laneY = hall.above ? L.lobby.y + 2 : L.lobby.y + L.lobby.h - 2;
    return [{ x: L.queue.x + (this.rng() - 0.5) * 8, y: L.queue.y + this.rng() * 5 }, { x: hall.door.x, y: laneY }, { ...hall.door }, { ...hall.inner }, { x: hall.sideX, y: hall.aisleY }, { x: hall.sideX, y: p.seat.y }, { ...p.seat }];
  }
  private pathOut(p: Attendee): Pt[] {
    const L = this.layout;
    const hall = L.halls[this.sessions[p.session]!.hall]!;
    const laneY = hall.above ? L.lobby.y + 2 : L.lobby.y + L.lobby.h - 2;
    return [{ x: hall.sideX, y: p.seat.y }, { x: hall.sideX, y: hall.aisleY }, { ...hall.inner }, { ...hall.door }, { x: hall.door.x, y: laneY }, this.chatPt()];
  }

  private snap(minute: number): void {
    for (const p of this.people) {
      const sh = this.sessions[p.session]!;
      if (minute < p.arriveAt) p.phase = "hidden";
      else if (minute >= p.chatUntil + 3) p.phase = "gone";
      else if (minute >= p.leaveAt) {
        p.phase = "chat";
        p.pos = this.chatPt();
        p.path = [];
      } else if (minute >= sh.start - 1) {
        p.phase = "seated";
        p.pos = { ...p.seat };
        p.path = [];
      } else {
        p.phase = "in";
        p.pos = { ...this.layout.entrance };
        p.path = this.pathIn(p);
      }
    }
  }

  update(dt: number, minute: number): void {
    if (Math.abs(minute - this.last) > 40) this.snap(minute);
    this.last = minute;
    for (const p of this.people) {
      switch (p.phase) {
        case "hidden":
          if (minute >= p.arriveAt && minute < this.sessions[p.session]!.end) {
            p.phase = "in";
            p.pos = { ...this.layout.entrance };
            p.path = this.pathIn(p);
          }
          break;
        case "in":
          if (advance(p.pos, p.path, WALK_SPEED * 1.2 * dt).done) p.phase = "seated";
          break;
        case "seated":
          if (minute >= p.leaveAt) {
            p.phase = "out";
            p.path = this.pathOut(p);
          }
          break;
        case "out":
          if (advance(p.pos, p.path, WALK_SPEED * 1.2 * dt).done) p.phase = "chat";
          break;
        case "chat":
          if (minute >= p.chatUntil) {
            p.phase = "leaving";
            p.path = [{ ...this.layout.entrance }];
          }
          break;
        case "leaving":
          if (advance(p.pos, p.path, WALK_SPEED * 1.2 * dt).done) p.phase = "gone";
          break;
      }
    }
  }

  /** 這間廳現在有場次在進行（螢幕亮、簡報者在講台上） */
  live(hall: number, minute: number): boolean {
    return this.sessions.some((s) => s.hall === hall && minute >= s.start - 2 && minute < s.end);
  }

  movers(): Mover[] {
    const out: Mover[] = [];
    for (const p of this.people) {
      if (p.phase === "hidden" || p.phase === "gone") continue;
      out.push({ id: p.id, kind: "person", x: p.pos.x, y: p.pos.y, color: p.color, vertical: true, seated: p.phase === "seated" });
    }
    return out;
  }
}

/** 每場出席人數：全館基準日人次 ÷ （會議廳數 × 周轉場次），假日少一半 */
export function conferenceAttendance(daily: number, halls: number, seats: number, weekend: boolean): number {
  if (halls <= 0) return 0;
  const per = (daily * (weekend ? 0.5 : 1)) / (halls * 2);
  return Math.max(4, Math.min(seats * 0.95, per));
}
