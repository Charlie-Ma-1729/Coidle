import type { Graphics } from "pixi.js";
import type { VenueSpec } from "../facilityspec";
import { BowlingSim, APPROACH_X, FOUL_X, LOBBY_W, PIN_OFFSETS, PIN_X, bowlingFill, layoutBowling } from "./bowling.sim";
import { COLORS, drawMovers, hatch } from "./draw";
import type { FacilityFactory } from "./types";
import { hourShare } from "./util";

type Spec = VenueSpec;

/** 保齡球館：客人到櫃台租鞋、走到球道後方座位，輪流上前投球、球滾過去撞倒球瓶、走回座位，打完離開 */
export const bowlingView: FacilityFactory<Spec> = (spec, rng, clock) => {
  const L = layoutBowling(spec.units.length);
  const built = spec.units.map((u) => u.built);
  const builtCount = built.filter(Boolean).length;
  const fillNow = (c: typeof clock) => {
    const { w, sum } = hourShare("bowling", c);
    return bowlingFill(spec.daily, w, sum, Math.max(1, builtCount), c.weekend);
  };
  const sim = new BowlingSim(L, rng, built, builtCount ? fillNow(clock) : 0);
  return {
    size: { w: L.width, h: L.height },
    drawStatic(g: Graphics) {
      g.rect(0, 0, L.width, L.height).fill(COLORS.wall);
      // 大廳地板、櫃台、鞋架
      g.rect(2, 2, LOBBY_W - 2, L.height - 4).fill(0x3b3355);
      g.rect(10, 6, 36, 8).fill(0xb07a4a).rect(10, 6, 36, 2).fill(0xd9a066);
      for (let k = 0; k < 4; k++) g.rect(48 + (k % 2) * 4, 8 + Math.floor(k / 2) * 5, 3, 4).fill([0xd9534f, 0x4f8fe3, 0xf0c040, 0x52b788][k]!);
      g.rect(0, L.entrance.y - 9, 4, 18).fill(COLORS.dark).rect(1, L.entrance.y - 8, 2, 16).fill(0x4f8fe3);
      for (let i = 0; i < L.lanes; i++) {
        const y = L.laneY(i);
        // 座位區與球道
        g.rect(LOBBY_W, y - 8, APPROACH_X + 6 - LOBBY_W, 16).fill(0x2f2a48);
        g.rect(64, y - 7, 10, 14).fill(0x7a3b4a);
        g.rect(FOUL_X - 6, y - 7, PIN_X + 20 - (FOUL_X - 6), 14).fill(0xc98f4f); // 木地板球道
        for (let x = FOUL_X; x < PIN_X; x += 14) g.rect(x, y - 6, 1, 12).fill({ color: 0xa5743a, alpha: 0.6 });
        g.rect(FOUL_X - 6, y - 7, PIN_X + 20 - (FOUL_X - 6), 1).fill(0x3a3f55); // 溝
        g.rect(FOUL_X - 6, y + 6, PIN_X + 20 - (FOUL_X - 6), 1).fill(0x3a3f55);
        g.rect(FOUL_X, y - 6, 1, 12).fill(0xffffff); // 犯規線
        g.rect(PIN_X + 14, y - 7, 6, 14).fill(0x1c2236); // 球瓶後方的機器
        g.rect(APPROACH_X - 4, y - 6, 2, 12).fill({ color: 0xffc857, alpha: 0.5 });
        if (!built[i]) hatch(g, LOBBY_W, y - 8, L.width - LOBBY_W, 16);
      }
    },
    update(dt, c) {
      sim.update(dt, builtCount ? fillNow(c) : 0);
    },
    drawDynamic(g) {
      sim.lanes.forEach((lane, i) => {
        if (!lane.built) return;
        const y = L.laneY(i);
        PIN_OFFSETS.forEach((p, k) => {
          if (lane.pins[k]) g.rect(PIN_X + p.x - 1, y + p.y - 1, 2, 2).fill(0xf2f2f7);
          else if (lane.phase === "hit" || lane.phase === "back") g.rect(PIN_X + p.x + 6, y + p.y * 2.2 - 1, 2, 1).fill({ color: 0xf2f2f7, alpha: 0.35 });
        });
        if (lane.phase === "roll") g.rect(lane.ballX - 1.5, y - 1.5, 3, 3).fill(0x2d3142).rect(lane.ballX - 1.5, y - 1.5, 1, 1).fill(0x9aa3b8);
      });
      drawMovers(g, sim.movers());
    },
  };
};
