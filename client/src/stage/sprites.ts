/**
 * 程式生成的像素美術（無外部素材）。
 * 全部畫在離屏 canvas，再轉成 Pixi 貼圖（nearest 取樣）。
 * 之後想換手繪圖，只要提供同樣 key 的 atlas 即可。
 */
import { Texture } from "pixi.js";
import type { Archetype } from "./model";
import { ROOM_W, TILE } from "./floorplan";
import { darken, lighten, mix } from "./color";
import { GLYPHS, GLYPH_TONE, glyphPalette, type GlyphKey } from "./glyphs";

// ───────── 小工具 ─────────

const css = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, "0")}`;

export { mix, lighten, darken };

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; x: Ctx } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  return { c, x };
}

export function r(x: Ctx, col: number, px: number, py: number, w: number, h: number, alpha = 1): void {
  x.globalAlpha = alpha;
  x.fillStyle = css(col);
  x.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h));
  x.globalAlpha = 1;
}

export function toTexture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

/** 字元矩陣 → 像素（'.' 透明） */
function matrix(x: Ctx, rows: string[], pal: Record<string, number>, ox: number, oy: number): void {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]!;
      if (ch === ".") continue;
      const col = pal[ch];
      if (col !== undefined) r(x, col, ox + i, oy + j, 1, 1);
    }
  });
}

// ───────── 房間 ─────────

export const ROOM_PX_W = ROOM_W * TILE; // 128
export const ROOM_PX_H = 6 * TILE; // 96
const DOOR_X0 = 56;
const DOOR_X1 = 72;

function wallColors(color: number) {
  const wall = mix(color, 0x1b1830, 0.64);
  return { wall, light: lighten(wall, 0.1), dark: darken(wall, 0.28), deep: darken(wall, 0.5) };
}

function drawFloor(x: Ctx, a: Archetype, color: number): void {
  const y0 = 32;
  switch (a) {
    case "cafe": {
      const a1 = 0xb98a5a;
      const a2 = 0xa97b4e;
      for (let j = 0; j < 8; j++) {
        r(x, j % 2 ? a1 : a2, 0, y0 + j * 8, ROOM_PX_W, 8);
        r(x, darken(a2, 0.25), 0, y0 + j * 8 + 7, ROOM_PX_W, 1);
        for (let k = 0; k < 4; k++) r(x, darken(a2, 0.25), ((k * 37 + j * 19) % 120) + 4, y0 + j * 8, 1, 7);
      }
      break;
    }
    case "counter": {
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 16; i++) r(x, (i + j) % 2 ? 0xd9c9a6 : 0xc9b88f, i * 8, y0 + j * 8, 8, 8);
      break;
    }
    case "shelf": {
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 8; i++) {
          r(x, (i + j) % 2 ? 0xd2d6e0 : 0xc2c7d4, i * 16, y0 + j * 16, 16, 16);
          r(x, 0xb2b8c8, i * 16, y0 + j * 16, 16, 1);
          r(x, 0xb2b8c8, i * 16, y0 + j * 16, 1, 16);
        }
      break;
    }
    case "rack": {
      r(x, 0x7a5d8a, 0, y0, ROOM_PX_W, 64);
      for (let j = 0; j < 64; j += 2) for (let i = (j / 2) % 2 ? 0 : 1; i < ROOM_PX_W; i += 2) r(x, 0x6b4f7a, i, y0 + j, 1, 1);
      r(x, 0xb07fc4, 6, y0 + 4, ROOM_PX_W - 12, 1);
      r(x, 0xb07fc4, 6, y0 + 58, ROOM_PX_W - 12, 1);
      break;
    }
    case "arcade": {
      r(x, 0x1c1830, 0, y0, ROOM_PX_W, 64);
      for (let i = 0; i < 8; i++) r(x, mix(color, 0x1c1830, 0.55), i * 16, y0, 1, 64);
      for (let j = 0; j < 4; j++) r(x, mix(color, 0x1c1830, 0.55), 0, y0 + j * 16, ROOM_PX_W, 1);
      for (let k = 0; k < 14; k++) r(x, lighten(color, 0.4), (k * 53) % 124, y0 + ((k * 31) % 60), 2, 2, 0.8);
      break;
    }
  }
}

function drawWall(x: Ctx, color: number, row: "top" | "bottom"): void {
  const { wall, light, dark, deep } = wallColors(color);
  r(x, wall, 0, 0, ROOM_PX_W, 32);
  for (let i = 4; i < ROOM_PX_W; i += 8) r(x, mix(wall, light, 0.7), i, 3, 1, 25);
  r(x, deep, 0, 0, ROOM_PX_W, 3);
  r(x, light, 0, 3, ROOM_PX_W, 1);
  r(x, dark, 0, 28, ROOM_PX_W, 4);
  r(x, lighten(dark, 0.2), 0, 28, ROOM_PX_W, 1);
  r(x, deep, 0, 31, ROOM_PX_W, 1);
  // 看板（名字由場景文字層疊上去）
  r(x, 0x2a2a38, 42, 0, 1, 5);
  r(x, 0x2a2a38, 85, 0, 1, 5);
  r(x, deep, 35, 4, 58, 14);
  r(x, color, 36, 5, 56, 12);
  r(x, lighten(color, 0.28), 36, 5, 56, 2);
  r(x, darken(color, 0.28), 36, 15, 56, 2);
  if (row === "bottom") {
    // 牆上的門洞：從房內往走道看
    r(x, deep, 53, 8, 22, 24);
    r(x, 0xcfc7b6, 55, 10, 18, 22);
    r(x, 0xc3bba8, 55, 10, 18, 1);
    r(x, lighten(0xcfc7b6, 0.35), 57, 10, 3, 22, 0.5);
    r(x, 0x8a3a3a, 55, 8, 18, 2);
  }
}

function drawSideWalls(x: Ctx, color: number): void {
  const { dark, deep } = wallColors(color);
  r(x, dark, 0, 0, 3, ROOM_PX_H);
  r(x, dark, ROOM_PX_W - 3, 0, 3, ROOM_PX_H);
  r(x, deep, 0, 0, 1, ROOM_PX_H);
  r(x, deep, ROOM_PX_W - 1, 0, 1, ROOM_PX_H);
}

function window_(x: Ctx, px: number, py: number, w: number, h: number): void {
  r(x, 0x241f33, px - 1, py - 1, w + 2, h + 2);
  r(x, 0x6b93c4, px, py, w, h);
  r(x, 0x4a74a6, px, py + Math.floor(h / 2), w, Math.ceil(h / 2));
  r(x, 0xbfe0ff, px + 1, py + 1, 2, h - 2, 0.6);
  r(x, 0x241f33, px + Math.floor(w / 2), py, 1, h);
}

function plate(x: Ctx, col: number, px: number, py: number, w: number, h: number): void {
  r(x, darken(col, 0.45), px, py, w, h);
  r(x, col, px + 1, py + 1, w - 2, h - 2);
  r(x, lighten(col, 0.3), px + 1, py + 1, w - 2, 1);
}

function table(x: Ctx, cx: number, cy: number): void {
  r(x, 0x000000, cx - 8, cy + 6, 16, 3, 0.18);
  r(x, 0x6b4426, cx - 1, cy + 1, 3, 6);
  r(x, 0xf0dcb6, cx - 8, cy - 4, 16, 6);
  r(x, 0xfff3d6, cx - 8, cy - 4, 16, 1);
  r(x, 0xc9ac7c, cx - 8, cy + 1, 16, 1);
  r(x, 0xffffff, cx - 3, cy - 3, 3, 2);
  r(x, 0xe05fa2, cx + 2, cy - 3, 2, 2);
}

function chair(x: Ctx, cx: number, cy: number): void {
  r(x, 0x5a3a22, cx - 3, cy - 6, 6, 3);
  r(x, 0x7a4f2e, cx - 3, cy - 3, 6, 5);
  r(x, 0x4a2f1b, cx - 3, cy + 2, 1, 3);
  r(x, 0x4a2f1b, cx + 2, cy + 2, 1, 3);
}

function stool(x: Ctx, cx: number, cy: number, col: number): void {
  r(x, 0x000000, cx - 5, cy + 4, 10, 2, 0.18);
  r(x, 0x3a2a22, cx - 1, cy, 2, 5);
  r(x, col, cx - 5, cy - 3, 10, 4);
  r(x, lighten(col, 0.3), cx - 5, cy - 3, 10, 1);
}

function cabinet(x: Ctx, cx: number, cy: number, hue: number): void {
  r(x, 0x000000, cx - 7, cy + 14, 14, 2, 0.25);
  r(x, 0x2a2540, cx - 7, cy - 8, 14, 22);
  r(x, 0x3b3560, cx - 7, cy - 8, 14, 2);
  r(x, 0x08060f, cx - 5, cy - 5, 10, 8);
  r(x, hue, cx - 4, cy - 4, 8, 6);
  r(x, lighten(hue, 0.5), cx - 4, cy - 4, 8, 1);
  r(x, 0x4a4470, cx - 6, cy + 4, 12, 4);
  r(x, 0xff5f5f, cx - 4, cy + 5, 2, 2);
  r(x, 0x5fd0ff, cx + 1, cy + 5, 2, 2);
  r(x, 0x1a1630, cx - 6, cy + 9, 12, 5);
}

function drawFurnitureBase(x: Ctx, a: Archetype, color: number): void {
  switch (a) {
    case "cafe": {
      window_(x, 8, 9, 20, 14);
      // 杯子層架
      r(x, 0x5b4030, 98, 20, 24, 2);
      r(x, 0x5b4030, 98, 26, 24, 2);
      for (let i = 0; i < 4; i++) {
        r(x, 0xfff3d6, 100 + i * 6, 16, 4, 4);
        r(x, i % 2 ? 0xe05fa2 : 0x4fe3ff, 100 + i * 6, 22, 4, 4);
      }
      // 吧台檯面與咖啡機
      r(x, 0x000000, 6, 50, 66, 3, 0.2);
      r(x, 0xf0dcb6, 6, 36, 66, 4);
      r(x, 0xfff3d6, 6, 36, 66, 1);
      r(x, 0x3a3a48, 12, 26, 14, 12);
      r(x, 0x56566a, 12, 26, 14, 2);
      r(x, 0xff5f5f, 15, 30, 2, 2);
      r(x, 0x4fe3ff, 20, 30, 2, 2);
      r(x, 0xffffff, 17, 22, 1, 3, 0.5);
      r(x, 0xffffff, 20, 20, 1, 4, 0.4);
      // 桌椅
      chair(x, 70, 74);
      table(x, 88, 66);
      chair(x, 106, 74);
      chair(x, 28, 88);
      table(x, 44, 80);
      chair(x, 60, 88);
      // 盆栽
      r(x, 0x5b3a22, 106, 50, 8, 6);
      r(x, 0x3fae5a, 104, 40, 12, 10);
      r(x, 0x58d078, 107, 38, 6, 6);
      break;
    }
    case "counter": {
      // 廚房層架與酒瓶
      r(x, 0x4a3426, 6, 22, 30, 2);
      r(x, 0x4a3426, 94, 22, 30, 2);
      for (let i = 0; i < 6; i++) {
        r(x, [0x52b788, 0xf0c040, 0xd9534f, 0x4f8fe3][i % 4]!, 8 + i * 5, 14, 3, 8);
        r(x, [0xf0c040, 0x52b788, 0x4f8fe3, 0xd9534f][i % 4]!, 96 + i * 5, 14, 3, 8);
      }
      // 紅燈籠
      for (const lx of [24, 104]) {
        r(x, 0x2a2a38, lx, 8, 1, 3);
        r(x, 0xd9534f, lx - 3, 11, 7, 8);
        r(x, 0xff8a7a, lx - 3, 11, 7, 1);
        r(x, 0x2a2a38, lx - 3, 19, 7, 1);
      }
      // 爐台
      r(x, 0x2d2d3a, 20, 40, 24, 12);
      r(x, 0xff9a3a, 24, 38, 3, 3, 0.9);
      r(x, 0xffd07a, 25, 37, 1, 2);
      r(x, 0xdfdfe8, 74, 40, 20, 12);
      r(x, 0x000000, 14, 66, 100, 3, 0.18);
      r(x, 0xe9d3a6, 12, 52, 104, 4);
      r(x, 0xfff0cc, 12, 52, 104, 1);
      for (let i = 0; i < 5; i++) stool(x, 24 + i * 20, 80, mix(color, 0x3a2a22, 0.35));
      break;
    }
    case "shelf": {
      window_(x, 8, 9, 20, 14);
      for (const sx of [14, 50]) {
        r(x, 0x000000, sx, 62, 18, 3, 0.2);
        r(x, 0x6b7390, sx, 38, 18, 24);
        r(x, 0x8f98b8, sx, 38, 18, 2);
        for (let j = 0; j < 3; j++) {
          r(x, 0x4a516e, sx + 1, 46 + j * 6, 16, 1);
          for (let i = 0; i < 4; i++) r(x, [color, 0xf0c040, 0xe05fa2, 0x52b788][(i + j) % 4]!, sx + 2 + i * 4, 41 + j * 6, 3, 4);
        }
      }
      // 後牆貨架
      r(x, 0x5b4030, 98, 18, 24, 2);
      for (let i = 0; i < 6; i++) r(x, [color, 0xf0c040, 0xe05fa2][i % 3]!, 99 + i * 4, 12, 3, 6);
      // 收銀檯
      r(x, 0x000000, 92, 58, 30, 3, 0.18);
      r(x, 0xe6dccb, 92, 38, 30, 4);
      r(x, 0xffffff, 92, 38, 30, 1);
      r(x, 0x3a3a48, 98, 31, 10, 7);
      r(x, 0x4fe3ff, 100, 33, 6, 3);
      break;
    }
    case "rack": {
      // 鏡子
      r(x, 0x2a2a38, 6, 7, 18, 22);
      r(x, 0xbfe0ff, 8, 9, 14, 18);
      r(x, 0xffffff, 10, 10, 3, 14, 0.5);
      // 衣架
      const rackAt = (rx: number, ry: number, c: number) => {
        r(x, 0x000000, rx - 12, ry + 14, 24, 2, 0.2);
        r(x, 0x8a8aa0, rx - 12, ry, 24, 2);
        r(x, 0x8a8aa0, rx - 12, ry, 2, 15);
        r(x, 0x8a8aa0, rx + 10, ry, 2, 15);
        for (let i = 0; i < 6; i++) r(x, mix(c, [0xffffff, 0x000000, 0xf0c040][i % 3]!, 0.15 * (i % 3)), rx - 10 + i * 4, ry + 2, 3, 9);
      };
      rackAt(30, 52, 0xe05fa2);
      rackAt(64, 44, 0x4fe3ff);
      rackAt(96, 76, 0xf0c040);
      rackAt(34, 80, 0x52b788);
      // 試衣間簾
      r(x, 0x3a2a4a, 100, 33, 22, 3);
      r(x, 0xb04fa2, 101, 36, 20, 24);
      for (let i = 0; i < 20; i += 3) r(x, 0x8a3a82, 101 + i, 36, 1, 24);
      // 櫃檯
      r(x, 0xe6dccb, 38, 36, 28, 4);
      r(x, 0xffffff, 38, 36, 28, 1);
      break;
    }
    case "arcade": {
      for (let i = 0; i < 7; i++) cabinet(x, 14 + i * 16, 26, [0xff5f9f, 0x4fe3ff, 0xf0c040, 0x52e0a4, 0x8a5ff0, 0xff8a3a, 0x4f8fe3][i]!);
      cabinet(x, 36, 66, 0x52e0a4);
      cabinet(x, 52, 66, 0xff5f9f);
      cabinet(x, 92, 66, 0x4fe3ff);
      cabinet(x, 108, 66, 0xf0c040);
      // 兌換獎品檯
      r(x, 0xe6dccb, 94, 84, 30, 4);
      break;
    }
  }
}

/** 蓋在人物上方的前景（吧台前板、前緣矮牆） */
function drawFurnitureFront(x: Ctx, a: Archetype): void {
  switch (a) {
    case "cafe":
      r(x, 0x7a4b2a, 6, 40, 66, 10);
      r(x, 0xa5673a, 6, 40, 66, 1);
      r(x, 0x55341c, 6, 49, 66, 1);
      for (let i = 0; i < 66; i += 11) r(x, 0x6a3f22, 6 + i, 41, 1, 8);
      break;
    case "counter":
      r(x, 0x8a3a30, 12, 56, 104, 10);
      r(x, 0xb2523f, 12, 56, 104, 1);
      r(x, 0x5e251f, 12, 65, 104, 1);
      for (let i = 0; i < 104; i += 13) r(x, 0x752f27, 12 + i, 57, 1, 8);
      break;
    case "shelf":
      r(x, 0x7d7a8a, 92, 46, 30, 10);
      r(x, 0xa6a3b6, 92, 46, 30, 1);
      r(x, 0x56546a, 92, 55, 30, 1);
      break;
    case "rack":
      r(x, 0x7d7a8a, 38, 40, 28, 10);
      r(x, 0xa6a3b6, 38, 40, 28, 1);
      r(x, 0x56546a, 38, 49, 28, 1);
      break;
    case "arcade":
      r(x, 0x7d7a8a, 94, 88, 30, 6);
      r(x, 0xa6a3b6, 94, 88, 30, 1);
      break;
  }
}

export interface RoomTextures {
  base: Texture;
  front: Texture;
}

const roomCache = new Map<string, RoomTextures>();

export function getRoomTextures(a: Archetype, color: number, row: "top" | "bottom"): RoomTextures {
  const key = `${a}_${color}_${row}`;
  const hit = roomCache.get(key);
  if (hit) return hit;

  const b = makeCanvas(ROOM_PX_W, ROOM_PX_H);
  drawFloor(b.x, a, color);
  drawWall(b.x, color, row);
  drawSideWalls(b.x, color);
  if (row === "top") {
    // 門墊
    r(b.x, 0x8a3a3a, DOOR_X0 + 2, 88, DOOR_X1 - DOOR_X0 - 4, 6);
    r(b.x, 0xb04f4f, DOOR_X0 + 2, 88, DOOR_X1 - DOOR_X0 - 4, 1);
  }
  drawFurnitureBase(b.x, a, color);

  const f = makeCanvas(ROOM_PX_W, ROOM_PX_H);
  drawFurnitureFront(f.x, a);
  if (row === "top") {
    // 前緣矮牆（留出門）
    const { dark, deep, light } = wallColors(color);
    r(f.x, dark, 0, 92, DOOR_X0, 4);
    r(f.x, dark, DOOR_X1, 92, ROOM_PX_W - DOOR_X1, 4);
    r(f.x, light, 0, 92, DOOR_X0, 1);
    r(f.x, light, DOOR_X1, 92, ROOM_PX_W - DOOR_X1, 1);
    r(f.x, deep, 0, 95, ROOM_PX_W, 1);
  }

  const out = { base: toTexture(b.c), front: toTexture(f.c) };
  roomCache.set(key, out);
  return out;
}

const emptyCache = new Map<string, Texture>();

/** 空地：還沒蓋店。有「+」招商牌 */
export function getEmptyLotTexture(row: "top" | "bottom"): Texture {
  const hit = emptyCache.get(row);
  if (hit) return hit;
  const { c, x } = makeCanvas(ROOM_PX_W, ROOM_PX_H);
  const wall = 0x2a2840;
  r(x, wall, 0, 0, ROOM_PX_W, 32);
  r(x, darken(wall, 0.4), 0, 0, ROOM_PX_W, 3);
  r(x, darken(wall, 0.25), 0, 28, ROOM_PX_W, 4);
  r(x, 0x1c1b2e, 0, 32, ROOM_PX_W, 64);
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 8; j++) if ((i + j) % 2 === 0) r(x, 0x201f35, i * 8, 32 + j * 8, 8, 8);
  // 虛線框
  for (let i = 8; i < ROOM_PX_W - 8; i += 6) {
    r(x, 0x6a6a9a, i, 38, 3, 1);
    r(x, 0x6a6a9a, i, row === "top" ? 88 : 90, 3, 1);
  }
  for (let j = 38; j < 90; j += 6) {
    r(x, 0x6a6a9a, 8, j, 1, 3);
    r(x, 0x6a6a9a, ROOM_PX_W - 9, j, 1, 3);
  }
  // 木牌
  r(x, 0x4a3426, 41, 14, 46, 16);
  r(x, 0x7a5a3a, 42, 15, 44, 14);
  r(x, 0xffe29a, 56, 19, 16, 1);
  r(x, 0xffe29a, 63, 18, 2, 10);
  r(x, 0xffe29a, 59, 22, 10, 2);
  if (row === "bottom") {
    r(x, 0x201f35, 53, 8, 22, 24);
    r(x, 0xcfc7b6, 55, 10, 18, 22, 0.5);
  }
  const t = toTexture(c);
  emptyCache.set(row, t);
  return t;
}

let scaffoldTex: Texture | null = null;
/** 施工中的鷹架（疊在空地上） */
export function getScaffoldTexture(): Texture {
  if (scaffoldTex) return scaffoldTex;
  const { c, x } = makeCanvas(ROOM_PX_W, ROOM_PX_H);
  const beam = 0xc8903a;
  const dark = 0x7a5420;
  for (const bx of [10, 40, 86, 116]) {
    r(x, dark, bx, 24, 3, 68);
    r(x, beam, bx, 24, 2, 68);
  }
  for (const by of [40, 62, 84]) {
    r(x, dark, 10, by + 2, 109, 3);
    r(x, beam, 10, by, 109, 3);
  }
  // 斜撐
  for (let i = 0; i < 22; i++) {
    r(x, beam, 13 + i, 41 + i, 2, 2);
    r(x, beam, 89 + i, 41 + i, 2, 2);
  }
  // 安全帽 / 三角錐
  for (const cx of [26, 100]) {
    r(x, 0xff8a3a, cx, 86, 8, 6);
    r(x, 0xffffff, cx + 1, 88, 6, 1);
    r(x, 0xff8a3a, cx - 1, 91, 10, 2);
  }
  scaffoldTex = toTexture(c);
  return scaffoldTex;
}

// ───────── 人物 ─────────

export const PERSON_W = 12;
export const PERSON_H = 22;

const SKINS = [0xf4d3b0, 0xe6b88a, 0xc58a5c, 0x8d5a3a];
const HAIRS = [0x2a2018, 0x4a3020, 0x8a5a2a, 0x1c1c28, 0xc8c8d0, 0xd0842a, 0xb03a5a];
const SHIRTS = [0x4f8fe3, 0xe05fa2, 0x52b788, 0xf0c040, 0x8a5ff0, 0xff8a3a, 0xd9534f, 0x4fe3ff, 0xeeeeee, 0x6a6a8a];
const PANTS = [0x2a3050, 0x3a3a48, 0x5a4a3a, 0x20202c, 0x4a5a7a];

export type Frame = "idle" | "stepA" | "stepB" | "sit";

export function personVariantCount(): number {
  return 48;
}

function drawPerson(x: Ctx, v: number, frame: Frame, staff?: { apron: number }): void {
  const skin = SKINS[v % SKINS.length]!;
  const hair = HAIRS[(v * 3 + 1) % HAIRS.length]!;
  const shirt = staff ? 0xf2efe6 : SHIRTS[(v * 7 + 2) % SHIRTS.length]!;
  const pants = PANTS[(v * 5 + 3) % PANTS.length]!;
  const sit = frame === "sit";
  const bob = frame === "stepA" || frame === "stepB" ? 1 : 0;
  const oy = sit ? 4 : 0;

  // 影子
  r(x, 0x000000, 2, 20, 8, 2, 0.28);
  if (!sit) {
    const la = frame === "stepA" ? -1 : frame === "stepB" ? 1 : 0;
    r(x, pants, 3, 14 + (la > 0 ? 1 : 0), 3, 6 - (la > 0 ? 1 : 0));
    r(x, pants, 6, 14 + (la < 0 ? 1 : 0), 3, 6 - (la < 0 ? 1 : 0));
    r(x, darken(pants, 0.4), 3, 19, 3, 1);
    r(x, darken(pants, 0.4), 6, 19, 3, 1);
  }
  // 身體
  const ty = 8 + oy - bob;
  r(x, shirt, 2, ty, 8, 7);
  r(x, lighten(shirt, 0.25), 2, ty, 8, 1);
  r(x, darken(shirt, 0.25), 2, ty + 6, 8, 1);
  if (staff) {
    r(x, staff.apron, 3, ty + 2, 6, 5);
    r(x, lighten(staff.apron, 0.3), 3, ty + 2, 6, 1);
  }
  // 手臂
  const swing = frame === "stepA" ? 1 : frame === "stepB" ? -1 : 0;
  r(x, shirt, 1, ty + 1 + (swing > 0 ? 1 : 0), 1, 5);
  r(x, shirt, 10, ty + 1 + (swing < 0 ? 1 : 0), 1, 5);
  r(x, skin, 1, ty + 6, 1, 1);
  r(x, skin, 10, ty + 6, 1, 1);
  // 頭
  const hy = 1 + oy - bob;
  r(x, skin, 3, hy + 1, 6, 7);
  r(x, hair, 3, hy, 6, 3);
  r(x, hair, 2, hy + 1, 1, 4);
  r(x, hair, 9, hy + 1, 1, 4);
  r(x, 0x20202c, 4, hy + 4, 1, 1);
  r(x, 0x20202c, 7, hy + 4, 1, 1);
  r(x, darken(skin, 0.15), 5, hy + 6, 2, 1);
  if (staff) {
    r(x, 0xffffff, 3, hy - 1, 6, 2);
    r(x, 0xdddddd, 3, hy, 6, 1);
  }
}

const personCache = new Map<string, Texture>();

export function getPersonTexture(variant: number, frame: Frame, staff = false): Texture {
  const key = `${variant}_${frame}_${staff ? "s" : "c"}`;
  const hit = personCache.get(key);
  if (hit) return hit;
  const { c, x } = makeCanvas(PERSON_W, PERSON_H);
  drawPerson(x, variant, frame, staff ? { apron: [0xd9534f, 0x4f8fe3, 0x52b788, 0xf0a030][variant % 4]! } : undefined);
  const t = toTexture(c);
  personCache.set(key, t);
  return t;
}

// ───────── 氣泡圖示 ─────────

export type IconKey = GlyphKey;

const iconCache = new Map<string, Texture>();

export function getBubbleTexture(icon: IconKey, tone?: "urgent" | "decision" | "opportunity"): Texture {
  const key = `${icon}_${tone ?? ""}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const { c, x } = makeCanvas(14, 17);
  const edge = tone === "urgent" ? 0xd9534f : tone === "opportunity" ? 0x3a8fb0 : 0x241f33;
  r(x, edge, 1, 0, 12, 14);
  r(x, edge, 0, 1, 14, 12);
  r(x, 0xfffdf4, 1, 1, 12, 12);
  r(x, 0xfffdf4, 2, 0, 10, 1);
  r(x, edge, 5, 14, 4, 1);
  r(x, 0xfffdf4, 5, 13, 4, 1);
  r(x, edge, 6, 15, 2, 1);
  matrix(x, GLYPHS[icon], glyphPalette(GLYPH_TONE[icon]), 3, 3);
  const t = toTexture(c);
  iconCache.set(key, t);
  return t;
}

// ───────── 小物 ─────────

/** 雨傘（下雨天從街門進來的客人撐著）：三種顏色，錨點在傘柄底端 */
const UMBRELLA_COLORS = [0xe05f5f, 0x4a8fd8, 0xf0c040];
const umbrellaTex: Texture[] = [];
export const UMBRELLA_H = 11;
export function getUmbrellaTexture(variant: number): Texture {
  const i = Math.abs(variant) % UMBRELLA_COLORS.length;
  const hit = umbrellaTex[i];
  if (hit) return hit;
  const col = UMBRELLA_COLORS[i]!;
  const { c, x } = makeCanvas(16, UMBRELLA_H);
  // 傘面（半圓，下緣呈波浪）
  for (const [y, x0, w] of [[0, 5, 6], [1, 3, 10], [2, 2, 12], [3, 1, 14]] as const) r(x, col, x0, y, w, 1);
  r(x, lighten(col, 0.35), 5, 0, 3, 1);
  r(x, lighten(col, 0.35), 3, 1, 3, 1);
  for (let k = 1; k < 15; k += 4) r(x, darken(col, 0.3), k, 3, 2, 1);
  // 傘柄
  r(x, 0x4a2f1b, 7, 4, 2, 6);
  r(x, 0x4a2f1b, 6, 9, 2, 1);
  const t = toTexture(c);
  umbrellaTex[i] = t;
  return t;
}

/** 柔邊光暈（夜間的燈光）：白色放射漸層，用 tint 上色、add 混合疊在夜色上 */
let glowTex: Texture | null = null;
export function getGlowTexture(): Texture {
  if (glowTex) return glowTex;
  const S = 64;
  const { c, x } = makeCanvas(S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  glowTex = Texture.from(c);
  glowTex.source.scaleMode = "linear"; // 光暈要平滑，不能是像素塊
  return glowTex;
}

let shadowTex: Texture | null = null;
export function getSelectTexture(): Texture {
  if (shadowTex) return shadowTex;
  const { c, x } = makeCanvas(ROOM_PX_W, ROOM_PX_H);
  const col = 0xffffff;
  for (let i = 0; i < ROOM_PX_W; i += 1) {
    if (i % 4 < 2) {
      r(x, col, i, 0, 1, 1);
      r(x, col, i, ROOM_PX_H - 1, 1, 1);
    }
  }
  for (let j = 0; j < ROOM_PX_H; j += 1) {
    if (j % 4 < 2) {
      r(x, col, 0, j, 1, 1);
      r(x, col, ROOM_PX_W - 1, j, 1, 1);
    }
  }
  shadowTex = toTexture(c);
  return shadowTex;
}
