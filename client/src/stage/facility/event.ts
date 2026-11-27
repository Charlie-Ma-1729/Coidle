import type { Graphics } from "pixi.js";
import type { VenueSpec } from "../facilityspec";
import { COLORS, drawPerson, hatch } from "./draw";
import { EventSim, eventCrowd, layoutEvent } from "./event.sim";
import type { FacilityFactory } from "./types";

type Spec = VenueSpec;

const LIGHTS = [0xe05fa2, 0x4f8fe3, 0xf0c040, 0x52b788];

/** 活動場地：屋頂廣場。活動前觀眾從入口進場、擠到舞台前；活動中表演者上台、燈光閃動、觀眾隨節奏搖擺；散場後離開，平時有人逛攤位 */
export const eventView: FacilityFactory<Spec> = (spec, rng, clock) => {
  const builtN = spec.units.filter((u) => u.built).length;
  const L = layoutEvent(Math.max(1, spec.units.length));
  const sim = new EventSim(L, rng, clock.open, clock.close, clock.minute % 1440, builtN ? eventCrowd(spec.daily, L.spots.length, clock.weekend) : 0);
  let t = 0;
  return {
    size: { w: L.width, h: L.height },
    drawStatic(g: Graphics) {
      // 地面：棋盤格磚
      for (let y = 0; y < L.height; y += 10) for (let x = 0; x < L.width; x += 10) g.rect(x, y, 10, 10).fill((x / 10 + y / 10) % 2 ? 0x41476a : 0x3a3f5e);
      // 舞台
      g.rect(L.stage.x, L.stage.y, L.stage.w, L.stage.h).fill(0x2d2438).rect(L.stage.x, L.stage.y + L.stage.h - 4, L.stage.w, 4).fill(0x6a4a3a);
      g.rect(L.stage.x - 4, L.stage.y - 4, 4, L.stage.h + 4).fill(0x1c2236).rect(L.stage.x + L.stage.w, L.stage.y - 4, 4, L.stage.h + 4).fill(0x1c2236);
      // 觀眾區（地墊）
      g.rect(L.pit.x, L.pit.y, L.pit.w, L.pit.h).fill({ color: 0x20243a, alpha: 0.55 });
      // 攤位
      L.stalls.forEach((s, i) => {
        g.rect(s.x, s.y, s.w, s.h).fill(0x6a4a3a);
        g.rect(s.x - 1, s.y, s.w + 2, 4).fill(LIGHTS[i % LIGHTS.length]!);
        for (let k = 0; k < s.w; k += 4) g.rect(s.x + k, s.y + 4, 2, 2).fill({ color: 0xffffff, alpha: 0.5 });
      });
      // 入口閘門與售票亭
      g.rect(L.gate.x - 14, L.gate.y - 2, 28, 6).fill(COLORS.dark).rect(L.gate.x - 10, L.gate.y - 1, 20, 2).fill(0x4f8fe3);
      g.rect(L.booth.x, L.booth.y, L.booth.w, L.booth.h).fill(0xb07a4a).rect(L.booth.x, L.booth.y, L.booth.w, 3).fill(0xd9534f);
      // 屋頂欄杆
      g.rect(0, 0, L.width, 2).fill(0x9aa3b8).rect(0, 0, 2, L.height).fill(0x9aa3b8).rect(L.width - 2, 0, 2, L.height).fill(0x9aa3b8);
      if (!builtN) hatch(g, 0, 0, L.width, L.height);
    },
    update(dt, c) {
      t += dt;
      sim.update(dt, c.minute % 1440);
    },
    drawDynamic(g, c) {
      const live = sim.live(c.minute % 1440);
      // 舞台燈光
      for (let i = 0; i < 6; i++) {
        const on = live ? Math.sin(t * 5 + i) > -0.3 : false;
        g.rect(L.stage.x + 8 + i * 20, L.stage.y + 1, 6, 3).fill(on ? LIGHTS[(i + Math.floor(t * 2)) % LIGHTS.length]! : 0x2d3142);
        if (on) g.rect(L.stage.x + 6 + i * 20, L.stage.y + 4, 10, 18).fill({ color: LIGHTS[(i + Math.floor(t * 2)) % LIGHTS.length]!, alpha: 0.12 });
      }
      if (live) L.performers.forEach((p, i) => drawPerson(g, p.x, p.y + Math.sin(t * 6 + i) * 1.2, [0xe05fa2, 0xf0c040, 0x4f8fe3][i]!));
      // 人：看活動的人隨節奏搖擺
      const people = sim.movers().sort((a, b) => a.y - b.y);
      for (const m of people) drawPerson(g, m.x, m.y + (live && Math.abs(m.y - (L.pit.y + L.pit.h / 2)) < L.pit.h ? Math.sin(t * 4 + m.id) * 0.7 : 0), m.color);
    },
  };
};
