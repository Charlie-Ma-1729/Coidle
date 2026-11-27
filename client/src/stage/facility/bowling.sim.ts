import { SHIRTS, WALK_SPEED, advance, type Mover, type Pt } from "../facilitymap";
import type { Rng } from "../crowd";

/** 保齡球館平面圖與模擬：純邏輯、不依賴 Pixi。單位是邏輯像素。 */

export const LANE_PITCH = 18;
export const LOBBY_W = 58;
export const APPROACH_X = 90;
export const FOUL_X = 98;
export const PIN_X = 262;
const TOP = 14;

export interface BowlingLayout {
  width: number;
  height: number;
  lanes: number;
  /** 第 i 道的中線 y */
  laneY: (i: number) => number;
  /** 第 i 道後方的座位點（兩個） */
  seats: (i: number) => Pt[];
  entrance: Pt;
  counter: Pt;
}

export function layoutBowling(lanes: number): BowlingLayout {
  const n = Math.max(1, Math.min(8, lanes));
  const laneY = (i: number) => TOP + i * LANE_PITCH + LANE_PITCH / 2;
  return {
    width: 280,
    height: TOP * 2 + n * LANE_PITCH,
    lanes: n,
    laneY,
    seats: (i) => [{ x: 70, y: laneY(i) - 4 }, { x: 70, y: laneY(i) + 4 }],
    entrance: { x: 0, y: TOP * 2 + n * LANE_PITCH - 12 },
    counter: { x: 24, y: TOP + 8 },
  };
}

interface Bowler {
  id: number;
  color: number;
  pos: Pt;
  path: Pt[];
  seat: Pt;
}

export interface LaneState {
  built: boolean;
  party: Bowler[] | null;
  /** 輪到第幾位 */
  turn: number;
  /** 這一道已經丟了幾球 */
  throws: number;
  phase: "idle" | "arriving" | "wait" | "approach" | "roll" | "hit" | "back" | "leaving";
  timer: number;
  ballX: number;
  /** 10 支瓶：true＝還立著 */
  pins: boolean[];
}

const PIN_POS: Pt[] = [
  { x: 0, y: 0 },
  { x: 3, y: -1.5 }, { x: 3, y: 1.5 },
  { x: 6, y: -3 }, { x: 6, y: 0 }, { x: 6, y: 3 },
  { x: 9, y: -4.5 }, { x: 9, y: -1.5 }, { x: 9, y: 1.5 }, { x: 9, y: 4.5 },
];
/** 瓶子的位置（相對於 PIN_X、該道中線） */
export const PIN_OFFSETS = PIN_POS;

export class BowlingSim {
  readonly lanes: LaneState[];
  private nextId = 1;
  private acc = 0;

  constructor(readonly layout: BowlingLayout, private rng: Rng, builtLanes: boolean[], initialFill = 0.4) {
    this.lanes = Array.from({ length: layout.lanes }, (_, i) => ({ built: builtLanes[i] ?? true, party: null, turn: 0, throws: 0, phase: "idle", timer: 0, ballX: FOUL_X, pins: Array(10).fill(true) }));
    // 一開始就有一些道在打
    const free = this.lanes.map((l, i) => (l.built ? i : -1)).filter((i) => i >= 0).sort(() => this.rng() - 0.5);
    const k = Math.round(free.length * initialFill);
    for (let j = 0; j < k; j++) this.startParty(free[j]!, true);
  }

  /** 正在打球的道數 */
  get busy(): number {
    return this.lanes.filter((l) => l.party).length;
  }

  private startParty(i: number, instant: boolean): void {
    const L = this.lanes[i]!;
    const n = 2 + Math.floor(this.rng() * 3);
    const seats = this.layout.seats(i);
    L.party = Array.from({ length: n }, (_, k) => {
      const seat = { x: seats[k % 2]!.x - Math.floor(k / 2) * 5, y: seats[k % 2]!.y };
      return { id: this.nextId++, color: SHIRTS[Math.floor(this.rng() * SHIRTS.length)]!, pos: instant ? { ...seat } : { ...this.layout.entrance }, path: instant ? [] : [{ ...this.layout.counter }, { x: 40, y: seat.y }, { ...seat }], seat };
    });
    L.turn = 0;
    L.throws = 0;
    L.pins = Array(10).fill(true);
    L.ballX = FOUL_X;
    L.phase = instant ? "wait" : "arriving";
    L.timer = instant ? this.rng() * 3 : 0;
  }

  /** @param fill 這個時段想有幾成的球道在打（0–1）；打烊 0，球友打完就離開 */
  update(dt: number, fill: number): void {
    const built = this.lanes.filter((l) => l.built).length;
    if (this.busy < fill * built) {
      this.acc += dt * 0.25;
      if (this.acc >= 1) {
        this.acc = 0;
        const free = this.lanes.map((l, i) => (l.built && !l.party ? i : -1)).filter((i) => i >= 0);
        if (free.length) this.startParty(free[Math.floor(this.rng() * free.length)]!, false);
      }
    }
    this.lanes.forEach((L, i) => this.stepLane(L, i, dt, fill));
  }

  private stepLane(L: LaneState, i: number, dt: number, fill: number): void {
    if (!L.party) return;
    for (const b of L.party) advance(b.pos, b.path, WALK_SPEED * 1.1 * dt);
    const y = this.layout.laneY(i);
    const who = L.party[L.turn % L.party.length]!;
    switch (L.phase) {
      case "arriving":
        if (L.party.every((b) => b.path.length === 0)) {
          L.phase = "wait";
          L.timer = 1 + this.rng() * 2;
        }
        break;
      case "wait":
        L.timer -= dt;
        if (L.timer <= 0) {
          if (L.throws >= L.party.length * 6 || fill <= 0.01) {
            L.phase = "leaving";
            for (const b of L.party) b.path = [{ x: 40, y: b.seat.y }, { ...this.layout.entrance }];
          } else {
            L.phase = "approach";
            who.path = [{ x: APPROACH_X, y: y + (this.rng() - 0.5) * 3 }];
          }
        }
        break;
      case "approach":
        if (who.path.length === 0) {
          L.phase = "roll";
          L.ballX = FOUL_X;
        }
        break;
      case "roll":
        L.ballX += 85 * dt;
        if (L.ballX >= PIN_X - 2) {
          // 撞倒幾支（還立著的裡面隨機倒一些；全倒就重擺）
          const standing = L.pins.map((p, k) => (p ? k : -1)).filter((k) => k >= 0);
          const down = Math.min(standing.length, 3 + Math.floor(this.rng() * 8));
          standing.sort(() => this.rng() - 0.5).slice(0, down).forEach((k) => (L.pins[k] = false));
          L.phase = "hit";
          L.timer = 0.9;
        }
        break;
      case "hit":
        L.timer -= dt;
        if (L.timer <= 0) {
          L.throws += 1;
          if (L.throws % 2 === 0 || L.pins.every((p) => !p)) L.pins = Array(10).fill(true);
          L.ballX = FOUL_X;
          L.phase = "back";
          who.path = [{ ...who.seat }];
        }
        break;
      case "back":
        if (who.path.length === 0) {
          L.turn += 1;
          L.phase = "wait";
          L.timer = 1.2 + this.rng() * 2.5;
        }
        break;
      case "leaving":
        if (L.party.every((b) => b.path.length === 0)) {
          L.party = null;
          L.phase = "idle";
          L.pins = Array(10).fill(true);
          L.ballX = FOUL_X;
        }
        break;
    }
  }

  movers(): Mover[] {
    const out: Mover[] = [];
    for (const L of this.lanes) for (const b of L.party ?? []) out.push({ id: b.id, kind: "person", x: b.pos.x, y: b.pos.y, color: b.color, vertical: true, seated: false });
    return out;
  }
}

/** 這個時段保齡球道大約有幾成在打：依基準日人次、時段熱度、單位容量與周轉算出；打烊 0 */
export function bowlingFill(daily: number, hourWeight: number, weightSum: number, units: number, weekend: boolean): number {
  if (hourWeight <= 0 || weightSum <= 0 || units <= 0) return 0;
  // 一個時段內來的人次 ÷ 每道每小時能打的人次（約 4 人 × 10 局／營業 12 小時 ≈ 3.3 人次／道・小時）
  const perHour = (daily * (weekend ? 1.25 : 1) * hourWeight) / weightSum;
  return Math.min(0.95, Math.max(0.1, perHour / (units * 3.3)));
}
