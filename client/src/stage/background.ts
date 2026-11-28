/**
 * 商場平面圖的地面層：走道、側廊、中庭、噴水池、手扶梯、服務區塊、出入口。
 * 全部畫在一張離屏 canvas（一次生成、每個版型快取）。
 */
import type { Texture } from "pixi.js";
import { SIDE, TILE, type EndKind, type FloorPlan, type ServiceBlock } from "./floorplan";
import { darken, lighten, makeCanvas, mix, r, toTexture, type Ctx } from "./sprites";

interface Theme {
  tileA: number;
  tileB: number;
  line: number;
  carpet: number;
  carpetHi: number;
  carpetDot: number;
  marbleA: number;
  marbleB: number;
  outside: number;
  block: number;
}

const THEMES: Theme[] = [
  { tileA: 0xd6cfbe, tileB: 0xcac2af, line: 0xb9b09b, carpet: 0x6a3a4a, carpetHi: 0x8a4a5e, carpetDot: 0xb86a82, marbleA: 0xefe8d8, marbleB: 0xe0d7c0, outside: 0x0c0f22, block: 0x2b2742 },
  { tileA: 0x9096aa, tileB: 0x868ca0, line: 0x70768c, carpet: 0x2f4a6a, carpetHi: 0x4a6f9a, carpetDot: 0x7fb0e0, marbleA: 0xbcc2d4, marbleB: 0xaeb4c8, outside: 0x090c1c, block: 0x232a44 },
  { tileA: 0xcfb48a, tileB: 0xc2a47a, line: 0xa98a60, carpet: 0x5a2f2f, carpetHi: 0x7a4545, carpetDot: 0xd09a5a, marbleA: 0xeadbc0, marbleB: 0xdccaa8, outside: 0x120d1c, block: 0x33263a },
  { tileA: 0xc6d2dc, tileB: 0xb8c6d2, line: 0x9eb0c0, carpet: 0x3a3f6a, carpetHi: 0x575e9a, carpetDot: 0xa0a8f0, marbleA: 0xe4ecf4, marbleB: 0xd2dde8, outside: 0x0a0e1e, block: 0x262a48 },
];

export function themeIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % THEMES.length;
}

function ellipse(x: Ctx, col: number, cx: number, cy: number, rx: number, ry: number, alpha = 1): void {
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
    r(x, col, cx - w, cy + dy, w * 2, 1, alpha);
  }
}

function floorRect(x: Ctx, t: Theme, tx: number, ty: number, tw: number, th: number, marble = false): void {
  for (let j = 0; j < th; j++)
    for (let i = 0; i < tw; i++) {
      const odd = (tx + i + ty + j) % 2 === 1;
      r(x, marble ? (odd ? t.marbleA : t.marbleB) : odd ? t.tileA : t.tileB, (tx + i) * TILE, (ty + j) * TILE, TILE, TILE);
      r(x, marble ? mix(t.marbleB, 0x000000, 0.1) : t.line, (tx + i) * TILE, (ty + j) * TILE, TILE, 1, 0.5);
      r(x, marble ? mix(t.marbleB, 0x000000, 0.1) : t.line, (tx + i) * TILE, (ty + j) * TILE, 1, TILE, 0.5);
    }
}

// ───────── 擺設 ─────────

function fountain(x: Ctx, cx: number, cy: number): void {
  ellipse(x, 0x000000, cx, cy + 5, 24, 12, 0.22);
  ellipse(x, 0x8a8472, cx, cy + 2, 22, 12);
  ellipse(x, 0xd6cfbe, cx, cy, 22, 12);
  ellipse(x, 0xefe9da, cx, cy - 1, 20, 10);
  ellipse(x, 0x3f9fd8, cx, cy, 17, 8);
  ellipse(x, 0x6cc6f0, cx, cy, 13, 6);
  ellipse(x, 0x9fe0ff, cx - 2, cy - 1, 7, 3);
  r(x, 0xcfc8b8, cx - 3, cy - 9, 6, 9);
  r(x, 0xefe9da, cx - 3, cy - 9, 2, 9);
  r(x, 0xcfc8b8, cx - 5, cy - 11, 10, 3);
  for (const [dx, dy] of [[-8, -8], [8, -8], [-5, -13], [5, -13], [0, -15], [-11, -2], [11, -2]] as const) r(x, 0xdff4ff, cx + dx, cy + dy, 2, 2, 0.85);
  for (const [dx, dy] of [[-4, -11], [4, -11]] as const) r(x, 0x9fe0ff, cx + dx, cy + dy, 1, 4, 0.8);
}

function escalator(x: Ctx, px: number, py: number, w: number, h: number): void {
  r(x, 0x000000, px - 1, py + h, w + 2, 3, 0.22);
  r(x, 0x4a516e, px - 2, py - 2, w + 4, h + 4);
  r(x, 0x2a2e44, px, py, w, h);
  for (let j = 0; j < h; j += 4) r(x, j % 8 === 0 ? 0x9aa2b8 : 0x7d86a0, px + 3, py + j, w - 6, 3);
  r(x, 0x1a1c2c, px, py, 3, h);
  r(x, 0x1a1c2c, px + w - 3, py, 3, h);
  r(x, 0xf0c040, px + 3, py, w - 6, 2);
  r(x, 0xf0c040, px + 3, py + h - 2, w - 6, 2);
  // 中央分隔：左側往上、右側往下的兩條電扶梯
  r(x, 0x1a1c2c, px + Math.floor(w / 2) - 1, py, 2, h);
  const lx = px + w / 4;
  const rx = px + (w * 3) / 4;
  r(x, 0xffffff, lx - 1, py + 10, 2, 8, 0.75);
  r(x, 0xffffff, lx - 3, py + 12, 6, 2, 0.75);
  r(x, 0xffffff, rx - 1, py + h - 18, 2, 8, 0.75);
  r(x, 0xffffff, rx - 3, py + h - 14, 6, 2, 0.75);
}

function palm(x: Ctx, cx: number, cy: number): void {
  r(x, 0x000000, cx - 9, cy + 8, 18, 3, 0.22);
  r(x, 0x8a5a3a, cx - 6, cy + 1, 12, 9);
  r(x, 0xa8714a, cx - 6, cy + 1, 12, 2);
  r(x, 0x5a3a24, cx - 1, cy - 8, 2, 10);
  for (const [dx, dy, w] of [[-9, -10, 9], [0, -12, 9], [-5, -16, 10], [-12, -6, 7], [4, -7, 8]] as const) {
    r(x, 0x2f8a46, cx + dx, cy + dy, w, 3);
    r(x, 0x58d078, cx + dx + 1, cy + dy, w - 3, 1);
  }
}

function bench(x: Ctx, cx: number, cy: number): void {
  r(x, 0x000000, cx - 12, cy + 2, 24, 3, 0.25);
  r(x, 0x8a5a36, cx - 11, cy - 6, 22, 3);
  r(x, 0x6b4426, cx - 11, cy - 3, 22, 4);
  r(x, 0x8a5a36, cx - 11, cy - 3, 22, 1);
  r(x, 0x4a2f1b, cx - 10, cy + 1, 2, 4);
  r(x, 0x4a2f1b, cx + 8, cy + 1, 2, 4);
}

function vending(x: Ctx, px: number, py: number): void {
  r(x, 0x241f33, px, py, 14, 20);
  r(x, 0xe05f5f, px + 1, py + 1, 12, 18);
  r(x, 0xffffff, px + 2, py + 3, 8, 8, 0.85);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) r(x, [0x4fe3ff, 0xf0c040, 0x52e0a4][i]!, px + 3 + i * 2, py + 4 + j * 3, 1, 2);
  r(x, 0x241f33, px + 3, py + 14, 8, 3);
}

// ───────── 服務區塊（沒有店面的外側欄位）─────────

type BlockKind = "wc" | "stock" | "service" | "elevator" | "stairs" | "atm";

function figure(x: Ctx, px: number, py: number, col: number): void {
  r(x, col, px + 1, py, 3, 3);
  r(x, col, px, py + 3, 5, 4);
  r(x, col, px + 1, py + 7, 1, 3);
  r(x, col, px + 3, py + 7, 1, 3);
}

function pictogram(x: Ctx, kind: BlockKind, cx: number, cy: number): void {
  switch (kind) {
    case "wc":
      figure(x, cx - 8, cy - 5, 0x4fb4ff);
      figure(x, cx + 3, cy - 5, 0xff7fb6);
      r(x, 0xffffff, cx, cy - 5, 1, 10, 0.6);
      break;
    case "stock":
      r(x, 0xc8903a, cx - 7, cy - 1, 6, 6);
      r(x, 0xc8903a, cx + 1, cy - 1, 6, 6);
      r(x, 0xe8b060, cx - 4, cy - 6, 8, 6);
      r(x, 0x7a5420, cx - 7, cy + 1, 14, 1, 0.6);
      break;
    case "service":
      r(x, 0xcfd3e0, cx - 4, cy - 4, 8, 8);
      r(x, 0x2a2e44, cx - 2, cy - 2, 4, 4);
      for (const [dx, dy] of [[-6, -1], [5, -1], [-1, -6], [-1, 5]] as const) r(x, 0xcfd3e0, cx + dx, cy + dy, 2, 2);
      break;
    case "elevator":
      r(x, 0xff5f5f, cx - 5, cy - 3, 3, 3);
      r(x, 0x52e0a4, cx + 2, cy - 3, 3, 3);
      break;
    case "stairs":
      for (let i = 0; i < 4; i++) r(x, 0xcfd3e0, cx - 7 + i * 3, cy + 4 - i * 3, 14 - i * 3, 2);
      break;
    case "atm":
      r(x, 0x4fe3ff, cx - 4, cy - 4, 8, 5);
      r(x, 0xf0c040, cx - 3, cy + 3, 6, 2);
      break;
  }
}

/** 一個封閉的服務區塊：牆在上、地板在下（俯視剖面）；門在朝走道那側 */
function block(x: Ctx, t: Theme, px: number, py: number, w: number, h: number, kind: BlockKind, row: "top" | "bottom"): void {
  const wall = t.block;
  r(x, darken(wall, 0.45), px, py, w, h);
  r(x, wall, px + 1, py + 1, w - 2, 30);
  r(x, lighten(wall, 0.1), px + 1, py + 1, w - 2, 1);
  r(x, darken(wall, 0.2), px + 1, py + 27, w - 2, 4);
  // 地板：深色斜紋，表示不開放
  r(x, darken(wall, 0.3), px + 1, py + 32, w - 2, h - 33);
  for (let i = 0; i < w; i += 6) r(x, darken(wall, 0.15), px + i, py + 32 + ((i / 6) % 2) * 3, 3, 3);
  // 銘牌
  const cx = px + w / 2;
  r(x, 0x14121f, cx - 14, py + 5, 28, 15);
  r(x, mix(wall, 0xffffff, 0.12), cx - 13, py + 6, 26, 13);
  pictogram(x, kind, cx, py + 13);
  // 門
  const dy = row === "top" ? py + h - 20 : py + 8;
  r(x, 0x14121f, cx - 8, dy, 16, 20);
  r(x, mix(0x7d8398, wall, 0.2), cx - 7, dy + 1, 14, 19);
  r(x, 0x5a6078, cx, dy + 1, 1, 19);
  r(x, 0xf0c040, cx - 3, dy + 10, 1, 2);
  r(x, 0xf0c040, cx + 2, dy + 10, 1, 2);
}

const KIND_CYCLE: BlockKind[] = ["wc", "stock", "service"];

function drawServiceBlock(x: Ctx, t: Theme, b: ServiceBlock, i: number): void {
  block(x, t, b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE, KIND_CYCLE[i % KIND_CYCLE.length]!, b.row);
}

// ───────── 主走道兩端 ─────────

function drawEnd(x: Ctx, t: Theme, kind: EndKind, side: "left" | "right", W: number, my: number, mh: number): void {
  const dx = side === "left" ? 0 : W - 12;
  const sx = side === "left" ? 4 : W - 44;
  const sign = (col: number) => {
    r(x, 0x241f33, sx - 1, my - 8, 42, 8);
    r(x, col, sx, my - 7, 40, 6);
  };
  r(x, 0x241f33, dx, my, 12, mh);
  switch (kind) {
    case "street":
      r(x, 0x8fc4e8, dx + 2, my + 4, 8, mh - 8);
      r(x, 0xdff2ff, dx + 3, my + 5, 2, mh - 10, 0.6);
      r(x, 0x241f33, dx + 6, my + 4, 1, mh - 8);
      sign(0xff5f9f);
      r(x, 0xffffff, sx + 2, my - 5, 36, 2, 0.8);
      break;
    case "rail": {
      // 通往車站的地下連通道：深色通道、驗票閘門、藍色指示牌與小電車
      r(x, 0x14121f, dx + 2, my + 4, 8, mh - 8);
      for (let i = 0; i < 3; i++) r(x, 0x3a4060 + i * 0x080808, dx + 2, my + 8 + i * 16, 8, 3);
      for (const gy of [my + 20, my + 40]) {
        r(x, 0xcfd3e0, dx + 3, gy, 6, 3);
        r(x, 0x52e0a4, dx + 4, gy + 1, 4, 1);
      }
      sign(0x2f8fd0);
      const cx = sx + 20;
      r(x, 0xffffff, cx - 8, my - 6, 16, 4);
      r(x, 0x2f8fd0, cx - 6, my - 5, 3, 2);
      r(x, 0x2f8fd0, cx - 1, my - 5, 3, 2);
      r(x, 0x2f8fd0, cx + 4, my - 5, 3, 2);
      break;
    }
    case "parking": {
      // 停車場連通口：紅白柵欄與藍底 P 字牌
      r(x, 0x2a2e44, dx + 2, my + 4, 8, mh - 8);
      for (let i = 0; i < 6; i++) r(x, i % 2 === 0 ? 0xe05f5f : 0xffffff, dx + 2, my + 8 + i * 8, 8, 4);
      sign(0x2f6fd0);
      const cx = sx + 20;
      r(x, 0xffffff, cx - 3, my - 6, 2, 4);
      r(x, 0xffffff, cx - 1, my - 6, 4, 1);
      r(x, 0xffffff, cx - 1, my - 4, 4, 1);
      r(x, 0xffffff, cx + 2, my - 5, 1, 2);
      break;
    }
    case "wall": {
      // 實牆＋館內導覽圖：這層沒有對外的門，進出只能靠電扶梯與電梯
      r(x, mix(t.block, 0x000000, 0.25), dx + 2, my + 2, 8, mh - 4);
      r(x, lighten(t.block, 0.1), side === "left" ? dx + 2 : dx + 9, my + 2, 1, mh - 4);
      const mx = side === "left" ? dx + 4 : dx + 3;
      r(x, 0x14121f, mx - 1, my + 20, 8, 24);
      r(x, 0x4a6f9a, mx, my + 21, 6, 22);
      r(x, 0xdff2ff, mx + 1, my + 24, 4, 1, 0.8);
      r(x, 0xdff2ff, mx + 1, my + 28, 4, 1, 0.8);
      r(x, 0xf0c040, mx + 2, my + 33, 2, 2);
      break;
    }
  }
}

// ───────── 主函式 ─────────

const cache = new Map<string, Texture>();

export function getFloorBackground(plan: FloorPlan, key: string): Texture {
  const full = `${key}|${plan.sig}`;
  const hit = cache.get(full);
  if (hit) return hit;

  const t = THEMES[themeIndex(key)]!;
  const W = plan.width * TILE;
  const H = plan.height * TILE;
  const { c, x } = makeCanvas(W, H);

  // 外圍
  r(x, t.outside, 0, 0, W, H);
  for (let i = 0; i < 70; i++) r(x, mix(t.outside, 0xffffff, 0.08), (i * 97) % W, (i * 53) % H, 2, 2);

  const { x0, x1 } = plan.atrium;
  const lastCor = plan.corridors[plan.corridors.length - 1]!;
  const bottomEdge = plan.height - 1; // 最下方可用 tile 的下緣

  // 地面：走道 → 側廊 → 中庭（中庭最後畫，蓋過走道交會處）
  for (const cor of plan.corridors) floorRect(x, t, 0, cor.y, plan.width, cor.h);
  floorRect(x, t, 0, 1, SIDE, bottomEdge - 1);
  floorRect(x, t, plan.width - SIDE, 1, SIDE, bottomEdge - 1);
  floorRect(x, t, x0, 1, x1 - x0, bottomEdge - 1, true);

  // 地毯帶（中庭處斷開）
  for (const cor of plan.corridors) {
    const cy = cor.laneY * TILE - 8;
    for (const [sx, ex] of [[0, x0 * TILE], [x1 * TILE, W]] as const) {
      r(x, t.carpet, sx, cy, ex - sx, 16);
      r(x, t.carpetHi, sx, cy, ex - sx, 1);
      r(x, t.carpetHi, sx, cy + 15, ex - sx, 1);
      for (let i = sx + 4; i < ex - 4; i += 8) r(x, t.carpetDot, i, cy + 7, 4, 2);
    }
    // 走道上下緣的陰影（牆面投下）
    r(x, 0x000000, 0, cor.y * TILE, W, 4, 0.22);
    r(x, 0x000000, 0, (cor.y + cor.h) * TILE - 3, W, 3, 0.16);
  }

  // 中庭兩側的地面金線
  r(x, 0xb89a4a, x0 * TILE, TILE, 1, (bottomEdge - 1) * TILE, 0.7);
  r(x, 0xb89a4a, x1 * TILE - 1, TILE, 1, (bottomEdge - 1) * TILE, 0.7);

  // 服務區塊（沒店面的欄位）
  plan.serviceBlocks.forEach((b, i) => drawServiceBlock(x, t, b, i));

  // 側廊盡頭的區塊：左上廁所、右上電梯、左下樓梯、右下提款機
  const topH = 6;
  const bottomY = plan.height - 1 - topH;
  block(x, t, 0, TILE, SIDE * TILE, topH * TILE, "wc", "top");
  block(x, t, (plan.width - SIDE) * TILE, TILE, SIDE * TILE, topH * TILE, "elevator", "top");
  block(x, t, 0, bottomY * TILE, SIDE * TILE, topH * TILE, "stairs", "bottom");
  block(x, t, (plan.width - SIDE) * TILE, bottomY * TILE, SIDE * TILE, topH * TILE, "atm", "bottom");
  // island 版型：兩條走道之間的側廊是行人通道（保持地板），只放盆栽
  if (plan.layout === "island") {
    const sideMidTop = (plan.corridors[0]!.y + plan.corridors[0]!.h) * TILE;
    const sideMidBottom = plan.corridors[1]!.y * TILE;
    for (const px of [0.9, plan.width - 0.9]) {
      palm(x, px * TILE, sideMidTop + 3 * TILE);
      palm(x, px * TILE, sideMidBottom - 2 * TILE);
    }
  }

  // 中庭擺設
  const f = plan.fountain;
  fountain(x, f.x * TILE, f.y * TILE);
  const e = plan.escalator;
  escalator(x, e.x * TILE, e.y * TILE, e.w * TILE, e.h * TILE);
  if (plan.layout === "island") {
    // 上方中庭：棕櫚與長椅
    const ty = 4 * TILE;
    palm(x, (x0 + 0.9) * TILE, ty);
    palm(x, (x1 - 0.9) * TILE, ty);
    bench(x, (x0 + 2) * TILE, ty + 22);
  } else {
    palm(x, (x0 + 0.7) * TILE, (plan.corridors[0]!.y + plan.corridors[0]!.h + 5.2) * TILE);
    palm(x, (x1 - 0.7) * TILE, (plan.corridors[0]!.y + plan.corridors[0]!.h + 5.2) * TILE);
  }

  // 走道邊緣的盆栽與長椅（放在相鄰店面的交界，避開門口）
  for (const cor of plan.corridors) {
    const xs = new Set<number>();
    for (const room of plan.rooms) {
      if (room.corridor !== cor.index) continue;
      if (plan.rooms.some((o) => o.corridor === cor.index && o.row === room.row && o.x + o.w === room.x)) xs.add(room.x);
    }
    [...xs]
      .sort((a, b) => a - b)
      .forEach((bx, i) => {
        const px = bx * TILE;
        if (i % 3 === 0) palm(x, px, (cor.y + cor.h) * TILE - 12);
        else if (i % 3 === 1) bench(x, px, (cor.y + cor.h) * TILE - 8);
        else palm(x, px, cor.y * TILE + 22);
      });
  }
  // 自動販賣機（第一條走道的左段）
  vending(x, (SIDE + 0.5) * TILE, plan.corridors[0]!.y * TILE + 4);

  // 主走道兩端：只有 1F 是對外的玻璃自動門；其他樓層是實牆，或連通車站／停車場
  const my = lastCor.y * TILE;
  const mh = lastCor.h * TILE;
  for (const side of ["left", "right"] as const) drawEnd(x, t, plan.ends[side], side, W, my, mh);

  // 天花燈暈
  for (const cor of plan.corridors) {
    for (let i = 0; i < plan.width; i += 5) {
      const lx = i * TILE + 24;
      if (lx > x0 * TILE - 8 && lx < x1 * TILE + 8) continue;
      const ly = cor.y * TILE;
      r(x, 0xfff1b8, lx - 14, ly + 20, 28, 24, 0.05);
      r(x, 0xfff1b8, lx - 9, ly + 25, 18, 14, 0.07);
      r(x, 0xfff1b8, lx - 4, ly + 30, 8, 5, 0.1);
    }
  }

  const tex = toTexture(c);
  cache.set(full, tex);
  return tex;
}
