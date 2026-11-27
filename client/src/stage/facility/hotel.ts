import type { Graphics } from "pixi.js";
import type { VenueSpec } from "../facilityspec";
import { COLORS, drawPerson, hatch } from "./draw";
import { HotelSim, hotelOccupancy, layoutHotel } from "./hotel.sim";
import type { FacilityFactory } from "./types";

type Spec = VenueSpec;

/** 旅館／膠囊旅館：只示範一個標準樓層——旅客搭電梯上來、拉著行李走到房間進去（燈亮）、退房離開，清潔員推車打掃 */
export const hotelView: FacilityFactory<Spec> = (spec, rng, clock) => {
  const capsule = spec.kind === "capsule_hotel";
  const perFloor = spec.units[0]?.amount ?? 10;
  const L = layoutHotel(perFloor, capsule);
  const builtAny = spec.units.some((u) => u.built);
  const total = spec.units.filter((u) => u.built).reduce((a, u) => a + u.amount, 0);
  const sim = new HotelSim(L, rng, builtAny ? hotelOccupancy(spec.daily, total, clock.weekend) : 0, clock.minute % 1440);
  return {
    size: { w: L.width, h: L.height },
    drawStatic(g: Graphics) {
      g.rect(0, 0, L.width, L.height).fill(COLORS.wall);
      // 走道（地毯）與電梯廳
      g.rect(L.corridor.x, L.corridor.y, L.corridor.w, L.corridor.h).fill(0x5a3d58);
      for (let x = L.corridor.x + 4; x < L.corridor.x + L.corridor.w; x += 10) g.rect(x, L.laneY, 5, 1).fill({ color: 0xd9a066, alpha: 0.5 });
      g.rect(L.elevator.x, L.elevator.y, L.elevator.w, L.elevator.h).fill(0x4a5072);
      g.rect(L.elevator.x + 2, L.elevator.y + 2, 6, L.elevator.h - 4).fill(COLORS.dark);
      g.rect(L.elevator.x + 3, L.elevator.y + 3, 2, L.elevator.h - 6).fill(0x9aa3b8);
      g.rect(L.elevator.x + 5, L.elevator.y + 3, 2, L.elevator.h - 6).fill(0x9aa3b8);
      for (const r of L.rooms) {
        g.rect(r.rect.x, r.rect.y, r.rect.w, r.rect.h).fill(0x2b2040);
        g.rect(r.rect.x + 1, r.rect.y + 1, r.rect.w - 2, r.rect.h - 2).fill(capsule ? 0x31405e : 0x3b2a4a);
        if (capsule) {
          // 艙位：枕頭與棉被
          g.rect(r.rect.x + 2, r.rect.y + (r.above ? 3 : r.rect.h - 9), r.rect.w - 4, 6).fill(0xe8e8ee);
          g.rect(r.rect.x + 2, r.rect.y + (r.above ? 9 : r.rect.h - 15), r.rect.w - 4, 8).fill(0x4f8fe3);
        } else {
          // 床、床頭櫃、窗
          const by = r.above ? r.rect.y + 4 : r.rect.y + r.rect.h - 14;
          g.rect(r.rect.x + 4, by, r.rect.w - 12, 10).fill(0xe8e8ee);
          g.rect(r.rect.x + 4, by + (r.above ? 5 : 0), r.rect.w - 12, 5).fill(0x4f8fe3);
          g.rect(r.rect.x + r.rect.w - 7, by + 2, 4, 5).fill(0xb07a4a);
          g.rect(r.rect.x + 5, r.above ? r.rect.y + 1 : r.rect.y + r.rect.h - 3, r.rect.w - 10, 2).fill(0x6aa8e8);
        }
        // 房門（面向走道）
        g.rect(r.door.x - 2, r.above ? r.rect.y + r.rect.h - 1 : r.rect.y, 4, 2).fill(COLORS.yellow);
      }
      if (!builtAny) hatch(g, 0, 0, L.width, L.height);
    },
    update(dt, c) {
      sim.update(dt, c.minute % 1440);
    },
    drawDynamic(g) {
      for (const r of L.rooms) {
        if (sim.lit[r.i]) g.rect(r.rect.x + 1, r.rect.y + 1, r.rect.w - 2, r.rect.h - 2).fill({ color: 0xffd98a, alpha: 0.28 });
        else if (builtAny) g.rect(r.rect.x + 1, r.rect.y + 1, r.rect.w - 2, r.rect.h - 2).fill({ color: 0x080a18, alpha: 0.3 });
        if (sim.doorOpen[r.i]! > 0) g.rect(r.door.x - 2, r.above ? r.rect.y + r.rect.h : r.rect.y - 2, 4, 3).fill(0xfff3c4);
      }
      for (const w of sim.walkers) {
        drawPerson(g, w.pos.x, w.pos.y, w.color);
        if (w.bag) g.rect(w.pos.x + 2, w.pos.y + 1, 3, 3).fill(0x8a5ff0);
      }
      if (sim.maid) {
        const m = sim.maid;
        g.rect(m.pos.x + 2, m.pos.y, 5, 4).fill(0xe8e8ee);
        g.rect(m.pos.x + 2, m.pos.y, 5, 1).fill(0x52b788); // 推車
        drawPerson(g, m.pos.x, m.pos.y, 0x52b788);
      }
    },
  };
};
