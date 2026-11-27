import type { Graphics } from "pixi.js";
import { CinemaSim, layoutCinema } from "../facilitymap";
import { showAudience, type FacilitySpec } from "../facilityspec";
import { COLORS, drawMovers, hatch } from "./draw";
import type { FacilityFactory } from "./types";

type Spec = Extract<FacilitySpec, { kind: "cinema" }>;

/** 影城：觀眾開演前進場、坐到位子上、散場走出；放映中銀幕亮起 */
export const cinemaView: FacilityFactory<Spec> = (spec, rng, clock) => {
  const L = layoutCinema(spec.rooms.map((r) => r.seats));
  const built = spec.rooms.map((r) => r.built);
  const sim = new CinemaSim(L, rng, clock.open, clock.close, clock.minute % 1440, (room, start) => (built[room] ? showAudience(spec.rooms[room]!.seats, spec.showBase, start) : 0));
  return {
    size: { w: L.width, h: L.height },
    drawStatic(g: Graphics) {
      g.rect(0, 0, L.width, L.height).fill(COLORS.wall);
      // 大廳
      g.rect(L.lobby.x, L.lobby.y, L.lobby.w, L.lobby.h).fill(0x4a3b5c);
      for (let x = L.lobby.x; x < L.lobby.x + L.lobby.w; x += 16) g.rect(x, L.lobby.y + L.lobby.h - 3, 8, 2).fill({ color: 0x6a5a82, alpha: 0.6 });
      g.rect(L.counter.x, L.counter.y, L.counter.w, L.counter.h).fill(0xb07a4a);
      g.rect(L.counter.x, L.counter.y, L.counter.w, 2).fill(0xd9a066);
      g.rect(L.snack.x, L.snack.y, L.snack.w, L.snack.h).fill(0xd9534f);
      g.rect(L.snack.x, L.snack.y, L.snack.w, 2).fill(0xf0c040);
      for (let x = L.lobby.x + 70; x < L.lobby.x + L.lobby.w - 70; x += 18) g.rect(x, L.lobby.y + 2, 10, 12).fill([0x4f8fe3, 0xe05fa2, 0xf0a030, 0x52b788][Math.floor(x / 18) % 4]!);
      // 入口（左）
      g.rect(0, L.entrance.y - 9, 10, 18).fill(COLORS.dark);
      g.rect(1, L.entrance.y - 8, 4, 16).fill(0x4f8fe3);
      L.rooms.forEach((room, i) => {
        const r = room.rect;
        g.rect(r.x, r.y, r.w, r.h).fill(0x2b2040);
        g.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2).fill(0x3b2a4a);
        for (const seat of room.grid) g.rect(seat.x - 3, seat.y - 2, 6, 5).fill(0x9a3b4a).rect(seat.x - 3, seat.y - 2, 6, 1).fill(0xc2566a);
        g.rect(room.door.x - 6, room.door.y - 1, 12, 3).fill(COLORS.yellow);
        if (!built[i]) hatch(g, r.x, r.y, r.w, r.h);
      });
    },
    update(dt, c) {
      sim.update(dt, c.minute % 1440);
    },
    drawDynamic(g, c) {
      const m = c.minute % 1440;
      L.rooms.forEach((room, i) => {
        const lit = !!built[i] && sim.roomLit(i, m);
        g.rect(room.screen.x, room.screen.y, room.screen.w, room.screen.h).fill(lit ? 0xe8f0ff : 0x2d3142);
        if (lit) g.rect(room.screen.x, room.screen.y + (room.above ? 4 : -2), room.screen.w, 2).fill({ color: 0xe8f0ff, alpha: 0.18 });
        if (built[i] && !lit) g.rect(room.rect.x + 1, room.rect.y + 1, room.rect.w - 2, room.rect.h - 2).fill({ color: 0x080a18, alpha: 0.35 });
      });
      drawMovers(g, sim.movers());
    },
  };
};
