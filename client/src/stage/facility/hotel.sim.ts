import { SHIRTS, WALK_SPEED, advance, type Pt, type Rect } from "../facilitymap";
import type { Rng } from "../crowd";

/** 旅館（與膠囊旅館）一個標準樓層的平面圖與模擬：純邏輯、不依賴 Pixi。 */

export interface HotelRoom {
  i: number;
  rect: Rect;
  /** 在走道上方（門朝下）還是下方 */
  above: boolean;
  /** 門口在走道中線上的點 */
  door: Pt;
}
export interface HotelLayout {
  width: number;
  height: number;
  capsule: boolean;
  rooms: HotelRoom[];
  corridor: Rect;
  elevator: Rect;
  /** 電梯門口（客人從這裡出現、離開） */
  lift: Pt;
  laneY: number;
}

const ROOM_H = 30;
const CORRIDOR_H = 16;
const HALL_W = 44;

export function layoutHotel(roomCount: number, capsule: boolean): HotelLayout {
  const n = Math.max(2, roomCount);
  const per = Math.ceil(n / 2);
  const rw = capsule ? 14 : 28;
  const rooms: HotelRoom[] = [];
  const cy = 10 + ROOM_H;
  const laneY = cy + CORRIDOR_H / 2;
  for (let i = 0; i < n; i++) {
    const above = i < per;
    const col = above ? i : i - per;
    const x = HALL_W + col * (rw + 1);
    rooms.push({ i, above, rect: { x, y: above ? 10 : cy + CORRIDOR_H, w: rw, h: ROOM_H }, door: { x: x + rw / 2, y: laneY } });
  }
  const width = HALL_W + per * (rw + 1) + 10;
  return {
    width,
    height: 20 + ROOM_H * 2 + CORRIDOR_H,
    capsule,
    rooms,
    corridor: { x: HALL_W - 4, y: cy, w: width - HALL_W + 4, h: CORRIDOR_H },
    elevator: { x: 4, y: cy - 6, w: 30, h: CORRIDOR_H + 12 },
    lift: { x: 30, y: laneY },
    laneY,
  };
}

interface Booking {
  room: number;
  checkIn: number;
  checkOut: number;
  color: number;
}
export interface Walker {
  id: number;
  pos: Pt;
  path: Pt[];
  color: number;
  /** 拉著行李箱 */
  bag: boolean;
  kind: "arrive" | "leave";
  /** 離開的人走到電梯就收掉 */
  gone: boolean;
  room: number;
}

export class HotelSim {
  readonly layout: HotelLayout;
  private bookings: Booking[] = [];
  /** 房間裡現在有客人（亮燈） */
  readonly lit: boolean[];
  /** 房門開著：倒數秒數 */
  readonly doorOpen: number[];
  walkers: Walker[] = [];
  /** 清潔員與推車 */
  maid: { pos: Pt; path: Pt[]; room: number; timer: number; busy: boolean } | null = null;
  private dirty: { room: number; readyAt: number }[] = [];
  private last: number;
  private nextId = 1;

  constructor(layout: HotelLayout, private rng: Rng, occupancy: number, minute: number) {
    this.layout = layout;
    this.lit = layout.rooms.map(() => false);
    this.doorOpen = layout.rooms.map(() => 0);
    for (const r of layout.rooms) {
      if (this.rng() < occupancy) this.bookings.push({ room: r.i, checkIn: 15 * 60 + this.rng() * 7 * 60, checkOut: 8 * 60 + this.rng() * 3 * 60, color: SHIRTS[Math.floor(this.rng() * SHIRTS.length)]! });
    }
    this.last = minute;
    this.snap(minute);
  }

  private occupiedAt(b: Booking, m: number): boolean {
    return m >= b.checkIn || m < b.checkOut;
  }

  /** 直接放到該有的狀態（第一次進來、或時間跳很多） */
  private snap(minute: number): void {
    this.walkers = [];
    this.dirty = [];
    this.maid = null;
    for (const r of this.layout.rooms) this.lit[r.i] = false;
    for (const b of this.bookings) {
      this.lit[b.room] = this.occupiedAt(b, minute);
      // 剛退房、等著打掃
      if (!this.lit[b.room] && minute >= b.checkOut && minute < b.checkOut + 90) this.dirty.push({ room: b.room, readyAt: 0 });
    }
  }

  update(dt: number, minute: number): void {
    const wrapped = this.last > 1380 && minute < 60;
    if (Math.abs(minute - this.last) > 40 && !wrapped) {
      this.snap(minute);
    } else {
      const from = this.last;
      const to = minute;
      const crossed = (t: number) => (from <= to ? t > from && t <= to : t > from || t <= to);
      for (const b of this.bookings) {
        if (crossed(b.checkIn)) this.spawn(b, "arrive");
        if (crossed(b.checkOut)) this.spawn(b, "leave");
      }
    }
    this.last = minute;

    for (const w of this.walkers) {
      const r = advance(w.pos, w.path, WALK_SPEED * dt);
      if (!r.done) continue;
      if (w.kind === "arrive") {
        this.lit[w.room] = true;
        this.doorOpen[w.room] = 1;
      }
      w.gone = true;
    }
    this.walkers = this.walkers.filter((w) => !w.gone);
    for (let i = 0; i < this.doorOpen.length; i++) this.doorOpen[i] = Math.max(0, this.doorOpen[i]! - dt);
    this.stepMaid(dt);
  }

  private spawn(b: Booking, kind: "arrive" | "leave"): void {
    const room = this.layout.rooms[b.room]!;
    const inside: Pt = { x: room.door.x, y: room.above ? room.rect.y + room.rect.h - 4 : room.rect.y + 4 };
    const lane: Pt = { x: room.door.x, y: this.layout.laneY };
    if (kind === "arrive") {
      this.walkers.push({ id: this.nextId++, pos: { ...this.layout.lift }, path: [lane, inside], color: b.color, bag: true, kind, gone: false, room: b.room });
    } else {
      this.lit[b.room] = false;
      this.doorOpen[b.room] = 1.2;
      this.walkers.push({ id: this.nextId++, pos: { ...inside }, path: [lane, { ...this.layout.lift }], color: b.color, bag: true, kind, gone: false, room: b.room });
      this.dirty.push({ room: b.room, readyAt: this.last + 20 });
    }
  }

  private stepMaid(dt: number): void {
    const L = this.layout;
    if (!this.maid) {
      const next = this.dirty.find((d) => d.readyAt <= this.last || d.readyAt - this.last > 600);
      if (!next) return;
      this.dirty = this.dirty.filter((d) => d !== next);
      const room = L.rooms[next.room]!;
      this.maid = { pos: { ...L.lift }, path: [{ x: room.door.x, y: L.laneY }], room: next.room, timer: 6, busy: false };
      return;
    }
    const m = this.maid;
    if (!m.busy) {
      if (advance(m.pos, m.path, WALK_SPEED * 0.9 * dt).done) m.busy = true;
    } else {
      m.timer -= dt;
      this.doorOpen[m.room] = Math.max(this.doorOpen[m.room]!, 0.3);
      if (m.timer <= 0) this.maid = null;
    }
  }
}

/** 這個樓層的住房率：依基準日人次（間夜）與全館房數推算，假日略高 */
export function hotelOccupancy(daily: number, totalRooms: number, weekend: boolean): number {
  if (totalRooms <= 0) return 0;
  return Math.min(0.97, Math.max(0.05, (daily * (weekend ? 1.2 : 1)) / totalRooms));
}
