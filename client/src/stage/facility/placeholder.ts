import type { Graphics } from "pixi.js";
import type { VenueSpec } from "../facilityspec";
import { COLORS, hatch } from "./draw";
import type { FacilityFactory } from "./types";

type Spec = VenueSpec;

/** 還沒有專屬地圖的設施：只畫一塊地板，每個單位一格（蓋好的亮、施工中的畫施工條紋） */
export const placeholderView: FacilityFactory<Spec> = (spec) => {
  const cell = 56;
  const w = 16 + spec.units.length * (cell + 8);
  const h = 96;
  return {
    size: { w, h },
    drawStatic(g: Graphics) {
      g.rect(0, 0, w, h).fill(COLORS.wall);
      spec.units.forEach((u, i) => {
        const x = 8 + i * (cell + 8);
        g.rect(x, 12, cell, h - 24).fill(COLORS.floor);
        if (!u.built) hatch(g, x, 12, cell, h - 24);
      });
    },
    update() {},
    drawDynamic() {},
  };
};
