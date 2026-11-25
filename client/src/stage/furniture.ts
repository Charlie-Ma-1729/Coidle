import type { Archetype } from "./model";

export interface Spot {
  x: number;
  y: number;
  sit?: boolean;
}

export interface Furniture {
  spots: Spot[];
  staff: Spot[];
}

/** 各原型的客人落腳點與店員站位（房間局部像素，腳底座標）。純資料，不依賴 Pixi。 */
export const FURNITURE: Record<Archetype, Furniture> = {
  cafe: {
    spots: [
      { x: 78, y: 72, sit: true },
      { x: 98, y: 72, sit: true },
      { x: 34, y: 86, sit: true },
      { x: 56, y: 86, sit: true },
      { x: 110, y: 52 },
    ],
    staff: [{ x: 30, y: 47 }],
  },
  counter: {
    spots: [
      { x: 24, y: 88, sit: true },
      { x: 44, y: 88, sit: true },
      { x: 64, y: 88, sit: true },
      { x: 84, y: 88, sit: true },
      { x: 104, y: 88, sit: true },
    ],
    staff: [
      { x: 36, y: 61 },
      { x: 88, y: 61 },
    ],
  },
  shelf: {
    spots: [
      { x: 40, y: 72 },
      { x: 40, y: 88 },
      { x: 76, y: 76 },
      { x: 20, y: 80 },
      { x: 84, y: 90 },
    ],
    staff: [{ x: 106, y: 55 }],
  },
  rack: {
    spots: [
      { x: 20, y: 72 },
      { x: 46, y: 84 },
      { x: 80, y: 74 },
      { x: 62, y: 62 },
      { x: 100, y: 88 },
    ],
    staff: [{ x: 52, y: 47 }],
  },
  arcade: {
    spots: [
      { x: 20, y: 54 },
      { x: 52, y: 54 },
      { x: 84, y: 54 },
      { x: 106, y: 54 },
      { x: 60, y: 86 },
    ],
    staff: [{ x: 108, y: 90 }],
  },
};
