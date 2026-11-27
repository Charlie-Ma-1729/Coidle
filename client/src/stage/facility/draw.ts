import type { Graphics } from "pixi.js";
import type { Mover } from "../facilitymap";

/** 設施地圖共用的繪製小工具與配色 */
export const COLORS = {
  floor: 0x3a3f55,
  wall: 0x232842,
  line: 0xc9cde0,
  dark: 0x1c2236,
  skin: 0xf3c9a5,
  yellow: 0xffc857,
} as const;

/** 施工中：變暗並蓋黃黑條紋 */
export function hatch(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x, y, w, h).fill({ color: 0x080a18, alpha: 0.5 });
  for (let yy = y + 2; yy < y + h; yy += 9) g.rect(x, yy, w, 3).fill({ color: COLORS.yellow, alpha: 0.35 });
}

/** 畫車與人：車先畫、人依 y 由上到下畫（下面的蓋住上面的）；坐著的人只畫頭和肩膀 */
export function drawMovers(g: Graphics, list: Mover[]): void {
  for (const m of list) {
    if (m.kind !== "car") continue;
    const w = m.vertical ? 8 : 14;
    const h = m.vertical ? 14 : 8;
    g.rect(m.x - w / 2, m.y - h / 2, w, h).fill(m.color);
    g.rect(m.x - w / 2, m.y - h / 2, w, 1).fill({ color: 0xffffff, alpha: 0.35 });
    if (m.vertical) g.rect(m.x - 3, m.y - 4, 6, 5).fill(COLORS.dark);
    else g.rect(m.x - 4, m.y - 3, 5, 6).fill(COLORS.dark);
  }
  const people = list.filter((m) => m.kind === "person").sort((a, b) => a.y - b.y);
  for (const m of people) drawPerson(g, m.x, m.y, m.color, m.seated);
}

export function drawPerson(g: Graphics, x: number, y: number, color: number, seated = false): void {
  if (seated) {
    g.rect(x - 1.5, y - 3, 3, 3).fill(COLORS.skin);
    g.rect(x - 2, y, 4, 2).fill(color);
  } else {
    g.rect(x - 1.5, y - 5, 3, 3).fill(COLORS.skin);
    g.rect(x - 1.5, y - 2, 3, 4).fill(color);
    g.rect(x - 1.5, y + 2, 1, 2).fill(COLORS.wall);
    g.rect(x + 0.5, y + 2, 1, 2).fill(COLORS.wall);
  }
}
