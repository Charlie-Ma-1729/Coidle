// 產生 PWA 圖示（純 Node，不需要任何圖片工具）。用法：node client/scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
/** 單一像素（座標為 0..1）的顏色：深色漸層底＋霓虹粉的「C」＋青色小方塊（像大樓窗戶） */
function shade(u, v, { rounded, scale }) {
  // scale：內容縮放（maskable 要留安全區，內容縮到 ~70%）
  const x = (u - 0.5) / scale, y = (v - 0.5) / scale;
  let col = mix([11, 16, 32], [32, 14, 64], (u + v) / 2);
  let a = 1;
  if (rounded) {
    const r = 0.22, dx = Math.abs(u - 0.5) - (0.5 - r), dy = Math.abs(v - 0.5) - (0.5 - r);
    if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > r) a = 0;
  }
  const dist = Math.hypot(x, y);
  const ang = (Math.atan2(y, x) * 180) / Math.PI; // -180..180，0 為右
  const inC = dist > 0.2 && dist < 0.3 && !(ang > -38 && ang < 38);
  const glow = Math.exp(-Math.pow((dist - 0.25) / 0.09, 2)) * (Math.abs(ang) > 38 ? 0.35 : 0.05);
  col = mix(col, [255, 62, 165], Math.min(1, glow));
  if (inC) col = [255, 62, 165];
  // 青色窗戶：C 的缺口處三塊
  for (const [wx, wy] of [[0.17, -0.1], [0.17, 0.0], [0.17, 0.1]]) {
    if (Math.abs(x - wx) < 0.045 && Math.abs(y - wy) < 0.03) col = [60, 230, 255];
  }
  return [col[0], col[1], col[2], a * 255];
}
function render(size, opts) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = (py * size + px) * 4;
      buf[o] = a ? r / a : 0; buf[o + 1] = a ? g / a : 0; buf[o + 2] = a ? b / a : 0; buf[o + 3] = a / (SS * SS);
    }
  }
  return png(size, buf);
}

writeFileSync(join(out, "icon-192.png"), render(192, { rounded: true, scale: 1.2 }));
writeFileSync(join(out, "icon-512.png"), render(512, { rounded: true, scale: 1.2 }));
writeFileSync(join(out, "icon-maskable-512.png"), render(512, { rounded: false, scale: 1.0 }));
writeFileSync(join(out, "apple-touch-icon.png"), render(180, { rounded: false, scale: 1.2 }));
console.log("icons written to", out);
