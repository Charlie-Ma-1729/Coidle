/**
 * 設施樓層（地下停車場、影城）的平面圖與人車模擬：純函式與純類別，不依賴 Pixi／DOM，可直接測試。
 * 單位是「邏輯像素」，畫面端（facilityscene.ts）再整數放大。
 * 這裡的動畫只是示意（和商場主畫面的人潮一樣），帳目與客數以伺服器為準。
 */
import type { Rng } from "./crowd";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 畫面端要畫的東西：車或人 */
export interface Mover {
  id: number;
  kind: "car" | "person";
  x: number;
  y: number;
  color: number;
  /** 車頭朝上下（直的）還是左右（橫的） */
  vertical: boolean;
  /** 人坐著（影城座位上） */
  seated: boolean;
}

/** 沿著折線前進 dist；回傳是否走到終點 */
export function advance(pos: Pt, path: Pt[], dist: number): { vertical: boolean; done: boolean } {
  let vertical = false;
  let left = dist;
  while (path.length > 0 && left > 0) {
    const t = path[0]!;
    const dx = t.x - pos.x;
    const dy = t.y - pos.y;
    const d = Math.hypot(dx, dy);
    vertical = Math.abs(dy) > Math.abs(dx);
    if (d <= left) {
      pos.x = t.x;
      pos.y = t.y;
      left -= d;
      path.shift();
    } else {
      pos.x += (dx / d) * left;
      pos.y += (dy / d) * left;
      left = 0;
    }
  }
  return { vertical, done: path.length === 0 };
}

export const CAR_COLORS = [0xd9534f, 0x4f8fe3, 0xe8e8ee, 0x2d3142, 0xf0c040, 0x52b788, 0x9aa3b8, 0x8a5ff0];
export const SHIRTS = [0xd9534f, 0x4f8fe3, 0x52b788, 0xf0a030, 0xe05fa2, 0x8a5ff0, 0x3a8fb0, 0xe8e8ee];

// ───────── 地下停車場 ─────────

export const BAY_W = 10;
export const BAY_H = 18;
export const AISLE_H = 16;
export const BLOCK_GAP = 6;
export const P_MARGIN_L = 36;
export const P_MARGIN_R = 36;
export const P_MARGIN_T = 10;
export const BAYS_PER_ROW = 14;
const BLOCK_H = BAY_H * 2 + AISLE_H;

export interface Bay {
  i: number;
  rect: Rect;
  /** 0＝上排（車頭朝下開出來）、1＝下排 */
  row: 0 | 1;
  /** 所在區塊的走道中線 y */
  aisleY: number;
}

export interface ParkingLayout {
  width: number;
  height: number;
  bays: Bay[];
  blocks: number;
  /** 往上的坡道車道 x */
  laneX: number;
  /** 車子進出的坡道口（畫面下緣外） */
  ramp: Pt;
  /** 電梯廳的門（人從這裡離開去逛街） */
  door: Pt;
  /** 走道右端，人走到這裡再轉進電梯廳 */
  doorX: number;
}

export function layoutParking(spaces: number): ParkingLayout {
  const n = Math.max(1, Math.floor(spaces));
  const blocks = Math.ceil(n / (BAYS_PER_ROW * 2));
  const width = P_MARGIN_L + BAYS_PER_ROW * BAY_W + P_MARGIN_R;
  const height = P_MARGIN_T * 2 + blocks * BLOCK_H + (blocks - 1) * BLOCK_GAP;
  const bays: Bay[] = [];
  for (let i = 0; i < n; i++) {
    const b = Math.floor(i / (BAYS_PER_ROW * 2));
    const j = i % (BAYS_PER_ROW * 2);
    const row: 0 | 1 = j < BAYS_PER_ROW ? 0 : 1;
    const col = j % BAYS_PER_ROW;
    const blockY = P_MARGIN_T + b * (BLOCK_H + BLOCK_GAP);
    bays.push({
      i,
      row,
      rect: { x: P_MARGIN_L + col * BAY_W, y: blockY + (row === 0 ? 0 : BAY_H + AISLE_H), w: BAY_W, h: BAY_H },
      aisleY: blockY + BAY_H + AISLE_H / 2,
    });
  }
  return { width, height, bays, blocks, laneX: 16, ramp: { x: 16, y: height + 8 }, door: { x: width - 10, y: height / 2 }, doorX: width - 22 };
}

interface Car {
  id: number;
  bay: number;
  color: number;
  phase: "in" | "parked" | "out";
  pos: Pt;
  path: Pt[];
  vertical: boolean;
  dead?: boolean;
}
interface Party {
  id: number;
  carId: number;
  members: { dx: number; dy: number; color: number }[];
  phase: "out" | "inside" | "back";
  pos: Pt;
  path: Pt[];
  timer: number;
}

const CAR_SPEED = 46;
export const WALK_SPEED = 17;

export class ParkingSim {
  private cars: Car[] = [];
  private parties: Party[] = [];
  private taken = new Set<number>();
  private acc = 0;
  private nextId = 1;
  private lastSpawnAt = -99;
  private time = 0;

  constructor(readonly layout: ParkingLayout, private rng: Rng, initialFill = 0.4) {
    const target = Math.round(layout.bays.length * Math.min(0.95, Math.max(0, initialFill)));
    const order = layout.bays.map((b) => b.i).sort(() => this.rng() - 0.5);
    for (let k = 0; k < target; k++) this.parkInstantly(order[k]!);
  }

  /** 已停（含正在進場）的車位數 */
  get occupied(): number {
    return this.taken.size;
  }

  private parkInstantly(bayI: number): void {
    const bay = this.layout.bays[bayI]!;
    const car: Car = { id: this.nextId++, bay: bayI, color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)]!, phase: "parked", pos: this.bayCenter(bay), path: [], vertical: true };
    this.cars.push(car);
    this.taken.add(bayI);
    // 人還在樓上逛：剩下的逛街時間隨機
    this.parties.push(this.makeParty(car, "inside", this.dwell() * this.rng()));
  }

  private bayCenter(b: Bay): Pt {
    return { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 };
  }
  private mouth(b: Bay): Pt {
    return { x: b.rect.x + b.rect.w / 2, y: b.row === 0 ? b.rect.y + b.rect.h + 1 : b.rect.y - 1 };
  }
  private dwell(): number {
    return 22 + this.rng() * 50;
  }
  private makeParty(car: Car, phase: Party["phase"], timer: number): Party {
    const n = 1 + Math.floor(this.rng() * 3);
    const members = Array.from({ length: n }, (_, k) => ({ dx: k * 3 - (n - 1) * 1.5, dy: k % 2 ? 2 : 0, color: SHIRTS[Math.floor(this.rng() * SHIRTS.length)]! }));
    return { id: this.nextId++, carId: car.id, members, phase, pos: { x: this.layout.door.x, y: this.layout.door.y }, path: [], timer };
  }

  private carPathIn(b: Bay): Pt[] {
    const c = this.bayCenter(b);
    return [{ x: this.layout.laneX, y: b.aisleY }, { x: c.x, y: b.aisleY }, c];
  }
  private carPathOut(b: Bay): Pt[] {
    const c = this.bayCenter(b);
    return [{ x: c.x, y: b.aisleY }, { x: this.layout.laneX, y: b.aisleY }, { ...this.layout.ramp }];
  }
  private walkToDoor(b: Bay): Pt[] {
    const m = this.mouth(b);
    const y = b.aisleY + (b.row === 0 ? -5 : 5);
    return [{ x: m.x, y }, { x: this.layout.doorX, y }, { x: this.layout.doorX, y: this.layout.door.y }, { ...this.layout.door }];
  }
  private walkFromDoor(b: Bay): Pt[] {
    const m = this.mouth(b);
    const y = b.aisleY + (b.row === 0 ? -5 : 5);
    return [{ x: this.layout.doorX, y: this.layout.door.y }, { x: this.layout.doorX, y }, { x: m.x, y }, { x: m.x, y: m.y }];
  }

  /**
   * @param dt 真實秒（已乘上時間流速）
   * @param fill 這個時段停車場大約停滿幾成（0–1）；打烊時 0，人車會陸續離開
   */
  update(dt: number, fill: number): void {
    this.time += dt;
    const target = fill * this.layout.bays.length;
    // 進場：還沒到目標水位就陸續進來，坡道口要有空隙
    if (this.taken.size < target) {
      this.acc += dt * 0.5;
      while (this.acc >= 1) {
        this.acc -= 1;
        this.spawnCar();
      }
    } else this.acc = Math.min(this.acc, 0.5);

    for (const c of this.cars) {
      if (c.phase === "parked") continue;
      const r = advance(c.pos, c.path, CAR_SPEED * dt);
      c.vertical = r.vertical;
      if (r.done) {
        if (c.phase === "in") {
          c.phase = "parked";
          c.vertical = true;
          const party = this.makeParty(c, "out", 0);
          const bay = this.layout.bays[c.bay]!;
          party.pos = this.mouth(bay);
          party.path = this.walkToDoor(bay);
          this.parties.push(party);
        } else {
          this.taken.delete(c.bay);
          c.dead = true;
        }
      }
    }
    if (this.cars.some((c) => c.dead)) this.cars = this.cars.filter((c) => !c.dead);

    const gone: number[] = [];
    for (const p of this.parties) {
      if (p.phase === "inside") {
        // 打烊或水位偏高時，人逛得比較快就下樓
        p.timer -= dt * (fill <= 0.01 ? 5 : this.taken.size > target + 2 ? 2.5 : 1);
        if (p.timer <= 0) {
          const car = this.cars.find((c) => c.id === p.carId);
          if (!car) {
            gone.push(p.id);
            continue;
          }
          p.phase = "back";
          p.pos = { ...this.layout.door };
          p.path = this.walkFromDoor(this.layout.bays[car.bay]!);
        }
      } else {
        const r = advance(p.pos, p.path, WALK_SPEED * dt);
        if (r.done) {
          if (p.phase === "out") {
            p.phase = "inside";
            p.timer = this.dwell();
          } else {
            gone.push(p.id);
            const car = this.cars.find((c) => c.id === p.carId);
            if (car) {
              car.phase = "out";
              car.path = this.carPathOut(this.layout.bays[car.bay]!);
              car.vertical = true;
            }
          }
        }
      }
    }
    if (gone.length) this.parties = this.parties.filter((p) => !gone.includes(p.id));
  }

  private spawnCar(): void {
    if (this.time - this.lastSpawnAt < 1.6) return;
    const free = this.layout.bays.filter((b) => !this.taken.has(b.i));
    if (free.length === 0) return;
    // 偏好離坡道近（編號小）的位子，但帶一點隨機
    const pick = free[Math.min(free.length - 1, Math.floor(Math.pow(this.rng(), 1.6) * free.length))]!;
    this.taken.add(pick.i);
    this.lastSpawnAt = this.time;
    const car: Car = { id: this.nextId++, bay: pick.i, color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)]!, phase: "in", pos: { ...this.layout.ramp }, path: this.carPathIn(pick), vertical: true };
    this.cars.push(car);
  }

  movers(): Mover[] {
    const out: Mover[] = [];
    for (const c of this.cars) out.push({ id: c.id, kind: "car", x: c.pos.x, y: c.pos.y, color: c.color, vertical: c.vertical, seated: false });
    for (const p of this.parties) {
      if (p.phase === "inside") continue;
      p.members.forEach((m, k) => out.push({ id: p.id * 10 + k, kind: "person", x: p.pos.x + m.dx, y: p.pos.y + m.dy, color: m.color, vertical: true, seated: false }));
    }
    return out;
  }
}

/** 這個時段停車場大約停滿幾成：跟著商場的相對人潮走（營業時段平均為 1）；打烊 0 */
export function parkingFill(shape: number, weekend: boolean): number {
  if (shape <= 0) return 0;
  return Math.min(0.94, Math.max(0.12, 0.2 + 0.42 * shape + (weekend ? 0.1 : 0)));
}

// ───────── 影城 ─────────

export const SEAT_COLS = 12;
export const SEAT_DX = 9;
export const SEAT_DY = 8;
const ROOM_PAD = 8;
const ROOM_W = SEAT_COLS * SEAT_DX + ROOM_PAD * 2;
const SCREEN_ZONE = 24;
const LOBBY_H = 64;
const C_GAP = 12;

export interface CinemaRoom {
  /** 這層的第幾間（0 起算） */
  index: number;
  rect: Rect;
  /** 銀幕 */
  screen: Rect;
  /** 觀眾座位（依「喜歡坐的順序」排好） */
  seats: Pt[];
  /** 座位總格（畫面用，含空位） */
  grid: Pt[];
  /** 門（在大廳那一側的牆上）與門內一格 */
  door: Pt;
  inner: Pt;
  /** 門內側的走道 y 與側邊走道 x */
  aisleY: number;
  sideX: number;
  /** 這間在大廳上方（門朝下）還是下方（門朝上） */
  above: boolean;
}

export interface CinemaLayout {
  width: number;
  height: number;
  rooms: CinemaRoom[];
  lobby: Rect;
  counter: Rect;
  snack: Rect;
  entrance: Pt;
  queue: Pt;
}

/** seatCounts：這層每間放映廳的座位數（最多 4 間，橫排在大廳上方；橫向的圖比較適合寬的面板，放大時才能用整數倍） */
export function layoutCinema(seatCounts: number[]): CinemaLayout {
  const counts = seatCounts.slice(0, 4);
  const n = Math.max(1, counts.length);
  const rowsMax = Math.max(1, ...counts.map((s) => Math.ceil(s / SEAT_COLS)));
  const roomH = SCREEN_ZONE + rowsMax * SEAT_DY + 14;
  const width = 20 + n * ROOM_W + (n - 1) * C_GAP;
  const y0 = 10;
  const lobbyY = y0 + roomH + 6;
  const lobby: Rect = { x: 10, y: lobbyY, w: width - 20, h: LOBBY_H };
  const height = lobbyY + LOBBY_H + 10;

  const rooms: CinemaRoom[] = counts.map((seats, i) => {
    const above = true;
    const x = 10 + i * (ROOM_W + C_GAP);
    const y = y0;
    const rect: Rect = { x, y, w: ROOM_W, h: roomH };
    const screen: Rect = { x: x + 14, y: above ? y + 4 : y + roomH - 8, w: ROOM_W - 28, h: 4 };
    const rows = Math.ceil(seats / SEAT_COLS);
    const grid: Pt[] = [];
    for (let k = 0; k < seats; k++) {
      const r = Math.floor(k / SEAT_COLS);
      const col = k % SEAT_COLS;
      // 上排的廳銀幕在上、第 0 排最靠銀幕；下排的廳整個上下鏡射（銀幕在下）
      const yy = above ? y + SCREEN_ZONE + r * SEAT_DY : y + roomH - SCREEN_ZONE - r * SEAT_DY;
      grid.push({ x: x + ROOM_PAD + col * SEAT_DX + SEAT_DX / 2, y: yy });
    }
    const mid = rows * 0.62;
    const seatsSorted = [...grid].sort((a, b) => {
      const ra = Math.abs(Math.abs(a.y - (above ? y + SCREEN_ZONE : y + roomH - SCREEN_ZONE)) / SEAT_DY - mid);
      const rb = Math.abs(Math.abs(b.y - (above ? y + SCREEN_ZONE : y + roomH - SCREEN_ZONE)) / SEAT_DY - mid);
      const ca = Math.abs(a.x - (x + ROOM_W / 2));
      const cb = Math.abs(b.x - (x + ROOM_W / 2));
      return ra * 14 + ca * 0.4 - (rb * 14 + cb * 0.4);
    });
    const doorY = above ? y + roomH : y;
    return {
      index: i,
      rect,
      screen,
      seats: seatsSorted,
      grid,
      door: { x: x + ROOM_W / 2, y: doorY },
      inner: { x: x + ROOM_W / 2, y: above ? y + roomH - 4 : y + 4 },
      aisleY: above ? y + roomH - 4 : y + 4,
      sideX: x + 4,
      above,
    };
  });
  return {
    width,
    height,
    rooms,
    lobby,
    counter: { x: lobby.x + 14, y: lobby.y + 6, w: 46, h: 8 },
    snack: { x: lobby.x + lobby.w - 14 - 46, y: lobby.y + 6, w: 46, h: 8 },
    entrance: { x: lobby.x, y: lobby.y + lobby.h - 14 },
    queue: { x: lobby.x + 36, y: lobby.y + 22 },
  };
}

export interface Show {
  room: number;
  /** 開演／散場（遊戲分鐘，從 0 點起算） */
  start: number;
  end: number;
}
export const SHOW_LEN = 120;

/** 每間廳一天的場次：開店後 30 分鐘起每 150 分鐘一場，每間錯開 25 分鐘，散場要在打烊前 */
export function cinemaSchedule(roomCount: number, openHour: number, closeHour: number): Show[] {
  const out: Show[] = [];
  const close = Math.min(closeHour * 60, 24 * 60);
  for (let r = 0; r < roomCount; r++) {
    for (let t = openHour * 60 + 30 + r * 25; t + SHOW_LEN <= close; t += 150) out.push({ room: r, start: t, end: t + SHOW_LEN });
  }
  return out;
}

interface Viewer {
  id: number;
  show: number;
  seat: Pt;
  color: number;
  arriveAt: number;
  leaveAt: number;
  phase: "hidden" | "in" | "seated" | "out" | "gone";
  pos: Pt;
  path: Pt[];
}

export class CinemaSim {
  readonly shows: Show[];
  private viewers: Viewer[] = [];
  private lastMinute = -1;
  private nextId = 1;

  /**
   * @param audience 某場的觀眾人數（呼叫端依廳數、等級、時段算）
   */
  constructor(readonly layout: CinemaLayout, private rng: Rng, openHour: number, closeHour: number, minute: number, private audience: (room: number, start: number) => number) {
    this.shows = cinemaSchedule(layout.rooms.length, openHour, closeHour);
    this.plan();
    this.snap(minute);
    this.lastMinute = minute;
  }

  private plan(): void {
    this.shows.forEach((sh, si) => {
      const room = this.layout.rooms[sh.room]!;
      const n = Math.max(0, Math.min(room.seats.length, Math.round(this.audience(sh.room, sh.start))));
      for (let k = 0; k < n; k++) {
        this.viewers.push({
          id: this.nextId++,
          show: si,
          seat: room.seats[k]!,
          color: SHIRTS[Math.floor(this.rng() * SHIRTS.length)]!,
          arriveAt: sh.start - 28 + this.rng() * 24,
          leaveAt: sh.end + this.rng() * 5,
          phase: "hidden",
          pos: { ...this.layout.entrance },
          path: [],
        });
      }
    });
  }

  private pathIn(v: Viewer): Pt[] {
    const L = this.layout;
    const room = L.rooms[this.shows[v.show]!.room]!;
    const q = { x: L.queue.x + (this.rng() - 0.5) * 10, y: L.queue.y + this.rng() * 6 };
    return [q, { x: room.door.x, y: L.lobby.y + (room.above ? 2 : L.lobby.h - 2) }, { ...room.door }, { ...room.inner }, { x: room.sideX, y: room.aisleY }, { x: room.sideX, y: v.seat.y }, { ...v.seat }];
  }
  private pathOut(v: Viewer): Pt[] {
    const L = this.layout;
    const room = L.rooms[this.shows[v.show]!.room]!;
    return [{ x: room.sideX, y: v.seat.y }, { x: room.sideX, y: room.aisleY }, { ...room.inner }, { ...room.door }, { x: room.door.x, y: L.lobby.y + (room.above ? 2 : L.lobby.h - 2) }, { x: L.entrance.x + 14, y: L.entrance.y }, { ...L.entrance }];
  }

  /** 直接放到「這個時間點該在的位置」（第一次進來、或時間跳很多時） */
  private snap(minute: number): void {
    for (const v of this.viewers) {
      const sh = this.shows[v.show]!;
      if (minute < v.arriveAt) {
        v.phase = "hidden";
      } else if (minute >= v.leaveAt + 4) {
        v.phase = "gone";
      } else if (minute >= sh.start - 1 || minute >= v.leaveAt) {
        if (minute >= v.leaveAt) {
          v.phase = "out";
          v.pos = { ...v.seat };
          v.path = this.pathOut(v);
        } else {
          v.phase = "seated";
          v.pos = { ...v.seat };
          v.path = [];
        }
      } else {
        v.phase = "in";
        v.pos = { ...this.layout.entrance };
        v.path = this.pathIn(v);
      }
    }
  }

  /** @param dt 真實秒（已乘流速）；@param minute 遊戲分鐘（0–1439） */
  update(dt: number, minute: number): void {
    if (Math.abs(minute - this.lastMinute) > 40) this.snap(minute);
    this.lastMinute = minute;
    for (const v of this.viewers) {
      switch (v.phase) {
        case "hidden":
          if (minute >= v.arriveAt && minute < this.shows[v.show]!.end) {
            v.phase = "in";
            v.pos = { ...this.layout.entrance };
            v.path = this.pathIn(v);
          }
          break;
        case "in":
          if (advance(v.pos, v.path, WALK_SPEED * 1.2 * dt).done) v.phase = "seated";
          break;
        case "seated":
          if (minute >= v.leaveAt) {
            v.phase = "out";
            v.path = this.pathOut(v);
          }
          break;
        case "out":
          if (advance(v.pos, v.path, WALK_SPEED * 1.2 * dt).done) v.phase = "gone";
          break;
      }
    }
  }

  /** 這間廳現在是不是亮著（開演前 3 分鐘到散場） */
  roomLit(room: number, minute: number): boolean {
    return this.shows.some((s) => s.room === room && minute >= s.start - 3 && minute < s.end);
  }

  /** 座位現在有人坐（畫面用來把座位點亮） */
  movers(): Mover[] {
    const out: Mover[] = [];
    for (const v of this.viewers) {
      if (v.phase === "hidden" || v.phase === "gone") continue;
      out.push({ id: v.id, kind: "person", x: v.pos.x, y: v.pos.y, color: v.color, vertical: true, seated: v.phase === "seated" });
    }
    return out;
  }
}
