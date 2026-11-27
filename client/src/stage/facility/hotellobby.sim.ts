import { SHIRTS, WALK_SPEED, advance, type Pt, type Rect } from "../facilitymap";
import type { Rng } from "../crowd";

/** 旅館（與膠囊旅館）一樓大廳的平面圖與模擬：純邏輯、不依賴 Pixi。入住與退房的旅客都在櫃台排隊辦理。 */

export interface LobbyLayout {
  width: number;
  height: number;
  capsule: boolean;
  /** 入口（街上）與電梯門 */
  door: Pt;
  lift: Pt;
  desk: Rect;
  /** 櫃台前兩個服務位置 */
  serve: Pt[];
  /** 排隊的點，0 號最靠近櫃台 */
  queue: Pt[];
  sofas: Rect[];
  /** 沙發上的座位點 */
  sit: Pt[];
  /** 櫃台後的服務員 */
  staff: Pt[];
  /** 膠囊旅館的置物櫃牆（一般旅館沒有） */
  lockers: Rect | null;
}

export function layoutLobby(capsule: boolean): LobbyLayout {
  const width = 260;
  const height = 150;
  const desk: Rect = { x: 70, y: 14, w: 110, h: 12 };
  const sofas: Rect[] = [{ x: 12, y: 54, w: 36, h: 12 }, { x: 12, y: 86, w: 36, h: 12 }];
  return {
    width,
    height,
    capsule,
    door: { x: 130, y: height - 6 },
    lift: { x: width - 16, y: 70 },
    desk,
    serve: [{ x: 100, y: desk.y + desk.h + 8 }, { x: 150, y: desk.y + desk.h + 8 }],
    queue: [0, 1, 2, 3, 4].map((i) => ({ x: 125, y: desk.y + desk.h + 26 + i * 10 })),
    sofas,
    sit: sofas.flatMap((s) => [{ x: s.x + 9, y: s.y + 4 }, { x: s.x + 22, y: s.y + 4 }]),
    staff: [{ x: 100, y: desk.y - 3 }, { x: 150, y: desk.y - 3 }],
    lockers: capsule ? { x: 196, y: 14, w: 52, h: 14 } : null,
  };
}

export interface LobbyGuest {
  id: number;
  kind: "in" | "out";
  color: number;
  pos: Pt;
  path: Pt[];
  phase: "walk" | "queue" | "toDesk" | "service" | "toSofa" | "sit" | "leave";
  timer: number;
  /** 在櫃台前的第幾個服務位置 */
  slot: number;
  /** 排在第幾位（-1 不在排隊） */
  qi: number;
  /** 沙發座位 */
  sit: number;
  gone: boolean;
}

export class HotelLobbySim {
  guests: LobbyGuest[] = [];
  private acc = { in: 0, out: 0 };
  private nextId = 1;
  private sitTaken = new Set<number>();

  constructor(readonly layout: LobbyLayout, private rng: Rng, initial: number) {
    // 一開始：沙發上坐幾個等房的人，櫃台前排一兩位
    const sits = Math.min(layout.sit.length, Math.round(initial * 2));
    for (let i = 0; i < sits; i++) this.addSitter(i);
    const q = Math.min(2, Math.round(initial * 2));
    for (let i = 0; i < q; i++) this.spawn(i % 2 ? "out" : "in", true);
  }

  private color(): number {
    return SHIRTS[Math.floor(this.rng() * SHIRTS.length)]!;
  }

  private addSitter(i: number): void {
    this.sitTaken.add(i);
    this.guests.push({ id: this.nextId++, kind: "in", color: this.color(), pos: { ...this.layout.sit[i]! }, path: [], phase: "sit", timer: 6 + this.rng() * 20, slot: -1, qi: -1, sit: i, gone: false });
  }

  private queueLen(): number {
    return this.guests.filter((g) => g.qi >= 0).length;
  }

  private spawn(kind: "in" | "out", instant = false): void {
    const L = this.layout;
    const qi = this.queueLen();
    if (qi >= L.queue.length) return;
    const g: LobbyGuest = { id: this.nextId++, kind, color: this.color(), pos: { ...(kind === "in" ? L.door : L.lift) }, path: [], phase: "walk", timer: 0, slot: -1, qi, sit: -1, gone: false };
    if (instant) {
      g.pos = { ...L.queue[qi]! };
      g.phase = "queue";
    } else {
      g.path = kind === "in" ? [{ x: L.queue[qi]!.x, y: L.queue[qi]!.y + 16 }, { ...L.queue[qi]! }] : [{ x: L.lift.x - 24, y: L.queue[qi]!.y }, { ...L.queue[qi]! }];
    }
    this.guests.push(g);
  }

  /**
   * @param inRate 每真實秒入住旅客數；@param outRate 每真實秒退房旅客數（都已是畫面示意的放大倍數）
   */
  update(dt: number, inRate: number, outRate: number): void {
    this.acc.in += dt * inRate;
    this.acc.out += dt * outRate;
    if (this.acc.in >= 1) {
      this.acc.in -= 1;
      this.spawn("in");
    }
    if (this.acc.out >= 1) {
      this.acc.out -= 1;
      this.spawn("out");
    }
    const L = this.layout;
    for (const g of this.guests) {
      const done = advance(g.pos, g.path, WALK_SPEED * dt).done;
      switch (g.phase) {
        case "walk":
          if (done) g.phase = "queue";
          break;
        case "queue": {
          // 排最前面、而且櫃台有空：走過去
          if (g.qi === 0 && done) {
            const free = [0, 1].find((s) => !this.guests.some((o) => o.slot === s));
            if (free !== undefined) {
              g.slot = free;
              g.qi = -1;
              g.phase = "toDesk";
              g.path = [{ ...L.serve[free]! }];
              for (const o of this.guests) if (o.qi > 0) this.advanceQueue(o);
            }
          }
          break;
        }
        case "toDesk":
          if (done) {
            g.phase = "service";
            g.timer = 3.5 + this.rng() * 4;
          }
          break;
        case "service":
          g.timer -= dt;
          if (g.timer <= 0) {
            g.slot = -1;
            const free = [...L.sit.keys()].filter((i) => !this.sitTaken.has(i));
            if (g.kind === "in" && free.length && this.rng() < 0.35) {
              g.sit = free[Math.floor(this.rng() * free.length)]!;
              this.sitTaken.add(g.sit);
              g.phase = "toSofa";
              g.path = [{ x: g.pos.x, y: L.sit[g.sit]!.y + 10 }, { ...L.sit[g.sit]! }];
            } else {
              g.phase = "leave";
              g.path = g.kind === "in" ? [{ x: L.lift.x - 24, y: g.pos.y }, { ...L.lift }] : [{ x: L.door.x, y: g.pos.y }, { ...L.door }];
            }
          }
          break;
        case "toSofa":
          if (done) {
            g.phase = "sit";
            g.timer = 8 + this.rng() * 16;
          }
          break;
        case "sit":
          g.timer -= dt;
          if (g.timer <= 0) {
            if (g.sit >= 0) this.sitTaken.delete(g.sit);
            g.sit = -1;
            g.phase = "leave";
            g.path = [{ x: L.lift.x - 30, y: g.pos.y }, { ...L.lift }];
          }
          break;
        case "leave":
          if (done) g.gone = true;
          break;
      }
    }
    if (this.guests.some((g) => g.gone)) this.guests = this.guests.filter((g) => !g.gone);
  }

  private advanceQueue(g: LobbyGuest): void {
    g.qi -= 1;
    g.path = [{ ...this.layout.queue[g.qi]! }];
  }
}

/** 入住／退房的畫面速率（每真實秒）：基準間夜依小時熱度分配；入住傍晚尖峰、退房早上尖峰。1 遊戲小時＝600 真實秒，畫面再放大 4 倍才看得出有人 */
export function lobbyRates(daily: number, hour: number, weekend: boolean): { inRate: number; outRate: number } {
  const inW = hour >= 15 && hour <= 22 ? 1.5 : hour >= 10 && hour <= 14 ? 0.5 : 0.15;
  const outW = hour >= 8 && hour <= 11 ? 2 : hour >= 12 && hour <= 14 ? 0.5 : 0.08;
  let inSum = 0;
  let outSum = 0;
  for (let h = 0; h < 24; h++) {
    inSum += h >= 15 && h <= 22 ? 1.5 : h >= 10 && h <= 14 ? 0.5 : 0.15;
    outSum += h >= 8 && h <= 11 ? 2 : h >= 12 && h <= 14 ? 0.5 : 0.08;
  }
  const scale = (daily * (weekend ? 1.2 : 1) * 4) / 600;
  return { inRate: (scale * inW) / inSum, outRate: (scale * outW) / outSum };
}
