import type { Graphics } from "pixi.js";
import { trafficShape } from "../crowd";
import { ParkingSim, layoutParking, parkingFill } from "../facilitymap";
import type { FacilitySpec } from "../facilityspec";
import { COLORS, drawMovers, hatch } from "./draw";
import type { FacilityFactory } from "./types";

type Spec = Extract<FacilitySpec, { kind: "parking" }>;

/** 地下停車場：車從坡道進來停進空位、人下車走向電梯、逛完回來上車開走 */
export const parkingView: FacilityFactory<Spec> = (spec, rng, clock) => {
  const L = layoutParking(spec.spaces);
  const shape = trafficShape(clock.minute, clock.open, clock.close, clock.weekend);
  const sim = new ParkingSim(L, rng, spec.built ? parkingFill(shape, clock.weekend) : 0);
  return {
    size: { w: L.width, h: L.height + 14 },
    drawStatic(g: Graphics) {
      g.rect(0, 0, L.width, L.height + 14).fill(COLORS.wall);
      g.rect(4, 4, L.width - 8, L.height - 8).fill(COLORS.floor);
      // 區塊之間的牆
      for (let b = 1; b < L.blocks; b++) g.rect(4, 10 + b * (18 * 2 + 16 + 6) - 6, L.width - 8, 6).fill(COLORS.wall);
      // 車格線
      for (const bay of L.bays) {
        g.rect(bay.rect.x, bay.rect.y, 1, bay.rect.h).fill({ color: COLORS.line, alpha: 0.7 });
        g.rect(bay.rect.x + bay.rect.w, bay.rect.y, 1, bay.rect.h).fill({ color: COLORS.line, alpha: 0.7 });
        g.rect(bay.rect.x, bay.row === 0 ? bay.rect.y : bay.rect.y + bay.rect.h - 1, bay.rect.w, 1).fill({ color: COLORS.line, alpha: 0.7 });
      }
      // 車道中線
      for (let b = 0; b < L.blocks; b++) {
        const y = 10 + b * (18 * 2 + 16 + 6) + 18 + 8;
        for (let x = 20; x < L.width - 30; x += 10) g.rect(x, y, 5, 1).fill({ color: COLORS.yellow, alpha: 0.5 });
      }
      // 坡道（左）與車道
      g.rect(L.laneX - 8, 4, 16, L.height - 4).fill({ color: 0x2d3142, alpha: 0.9 });
      for (let y = 6; y < L.height; y += 12) g.rect(L.laneX - 1, y, 2, 6).fill({ color: COLORS.yellow, alpha: 0.6 });
      g.rect(L.laneX - 12, L.height - 4, 24, 14).fill(COLORS.dark);
      for (let i = 0; i < 4; i++) g.rect(L.laneX - 10 + i * 6, L.height, 3, 8).fill({ color: COLORS.yellow, alpha: 0.8 });
      // 電梯廳（右）
      g.rect(L.width - 22, 4, 18, L.height - 8).fill(0x4a5072);
      g.rect(L.width - 14, L.door.y - 8, 10, 16).fill(COLORS.dark);
      g.rect(L.width - 13, L.door.y - 7, 4, 14).fill(0x9aa3b8);
      g.rect(L.width - 8, L.door.y - 7, 3, 14).fill(0x9aa3b8);
      if (!spec.built) hatch(g, 4, 4, L.width - 8, L.height - 8);
    },
    update(dt, c) {
      if (!spec.built) return;
      sim.update(dt, parkingFill(trafficShape(c.minute, c.open, c.close, c.weekend), c.weekend));
    },
    drawDynamic(g) {
      drawMovers(g, sim.movers());
    },
  };
};
