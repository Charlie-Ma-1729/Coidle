import type { Graphics } from "pixi.js";
import { COLORS, drawPerson, hatch } from "./draw";
import { HotelLobbySim, layoutLobby, lobbyRates } from "./hotellobby.sim";
import type { VenueSpec } from "../facilityspec";
import type { FacilityFactory } from "./types";

/** 旅館／膠囊旅館的一樓大廳：入住的旅客拉行李進門、在櫃台前排隊辦理，有人先坐沙發等房、再搭電梯上樓；退房的旅客從電梯下來、到櫃台辦理後離開 */
export const hotelLobbyView: FacilityFactory<VenueSpec> = (spec, rng, clock) => {
  const capsule = spec.kind === "capsule_hotel";
  const L = layoutLobby(capsule);
  const builtAny = spec.units.some((u) => u.built);
  const rates = (m: number, weekend: boolean) => lobbyRates(spec.daily, Math.floor(m / 60) % 24, weekend);
  const sim = new HotelLobbySim(L, rng, builtAny ? Math.min(1, spec.daily / 30) : 0);
  return {
    size: { w: L.width, h: L.height },
    drawStatic(g: Graphics) {
      g.rect(0, 0, L.width, L.height).fill(COLORS.wall);
      g.rect(4, 4, L.width - 8, L.height - 8).fill(capsule ? 0x3a4560 : 0x4a3b5c);
      for (let y = 8; y < L.height - 8; y += 16) for (let x = 8 + ((y / 16) % 2) * 8; x < L.width - 8; x += 16) g.rect(x, y, 8, 8).fill({ color: 0xffffff, alpha: 0.04 }); // 地磚
      // 櫃台
      g.rect(L.desk.x, L.desk.y, L.desk.w, L.desk.h).fill(0xb07a4a);
      g.rect(L.desk.x, L.desk.y, L.desk.w, 3).fill(0xd9a066);
      g.rect(L.desk.x + 8, L.desk.y + 4, 12, 5).fill(COLORS.dark); // 電腦
      g.rect(L.desk.x + L.desk.w - 20, L.desk.y + 4, 12, 5).fill(COLORS.dark);
      g.rect(L.desk.x + 40, L.desk.y - 6, 30, 5).fill(0xe8e8ee); // 招牌
      g.rect(L.desk.x + 42, L.desk.y - 5, 26, 3).fill(0x4f8fe3);
      if (L.lockers) {
        // 置物櫃牆
        g.rect(L.lockers.x, L.lockers.y, L.lockers.w, L.lockers.h).fill(0x2d3142);
        for (let x = L.lockers.x + 2; x < L.lockers.x + L.lockers.w - 2; x += 6) g.rect(x, L.lockers.y + 2, 5, L.lockers.h - 4).fill(0x6aa8e8).rect(x + 3, L.lockers.y + 6, 1, 2).fill(0xffc857);
      }
      // 排隊的欄杆
      for (const q of L.queue) g.rect(q.x - 9, q.y - 3, 1, 6).fill({ color: COLORS.yellow, alpha: 0.7 }).rect(q.x + 9, q.y - 3, 1, 6).fill({ color: COLORS.yellow, alpha: 0.7 });
      // 沙發與小茶几
      for (const s of L.sofas) {
        g.rect(s.x, s.y, s.w, s.h).fill(0x7a3b4a).rect(s.x, s.y, s.w, 3).fill(0xa5566a);
        g.rect(s.x + s.w + 6, s.y + 2, 8, 8).fill(0xb07a4a);
      }
      // 盆栽
      for (const p of [{ x: 14, y: 20 }, { x: 14, y: 124 }, { x: 236, y: 124 }]) g.rect(p.x - 3, p.y, 6, 5).fill(0x6a4a3a).rect(p.x - 4, p.y - 6, 8, 6).fill(0x3f8f5a);
      // 電梯（右）
      g.rect(L.width - 22, L.lift.y - 22, 18, 44).fill(0x4a5072);
      for (const dy of [-14, 4]) g.rect(L.width - 20, L.lift.y + dy, 14, 14).fill(COLORS.dark).rect(L.width - 14, L.lift.y + dy + 1, 1, 12).fill(0x9aa3b8);
      // 入口（下）：旋轉門
      g.rect(L.door.x - 14, L.height - 8, 28, 6).fill(COLORS.dark);
      g.rect(L.door.x - 12, L.height - 7, 10, 4).fill(0x6aa8e8).rect(L.door.x + 2, L.height - 7, 10, 4).fill(0x6aa8e8);
      if (!builtAny) hatch(g, 4, 4, L.width - 8, L.height - 8);
    },
    update(dt, c) {
      if (!builtAny) return;
      const r = rates(c.minute, c.weekend);
      sim.update(dt, r.inRate, r.outRate);
    },
    drawDynamic(g) {
      if (builtAny) for (const p of L.staff) drawPerson(g, p.x, p.y, 0x2d3142);
      const list = [...sim.guests].sort((a, b) => a.pos.y - b.pos.y);
      for (const gst of list) {
        drawPerson(g, gst.pos.x, gst.pos.y, gst.color, gst.phase === "sit");
        if (gst.phase !== "sit") g.rect(gst.pos.x + 2, gst.pos.y + 1, 3, 3).fill(0x8a5ff0); // 行李
      }
    },
  };
};
