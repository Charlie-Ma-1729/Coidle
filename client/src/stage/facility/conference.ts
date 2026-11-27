import type { Graphics } from "pixi.js";
import type { VenueSpec } from "../facilityspec";
import { ConferenceSim, conferenceAttendance, layoutConference } from "./conference.sim";
import { COLORS, drawMovers, drawPerson, hatch } from "./draw";
import type { FacilityFactory } from "./types";

type Spec = VenueSpec;

/** 會議中心：與會者到櫃台報到、走進會議廳入座，簡報者站講台、螢幕亮；散會後到大廳茶歇聊天再離開 */
export const conferenceView: FacilityFactory<Spec> = (spec, rng, clock) => {
  const L = layoutConference(spec.units.map((u) => u.amount));
  const built = spec.units.map((u) => u.built);
  const builtCount = built.filter(Boolean).length;
  const seats = spec.units[0]?.amount ?? 60;
  const sim = new ConferenceSim(L, rng, clock.open, clock.close, clock.minute % 1440, (hall) => (built[hall] ? conferenceAttendance(spec.daily, Math.max(1, builtCount), seats, clock.weekend) : 0));
  return {
    size: { w: L.width, h: L.height },
    drawStatic(g: Graphics) {
      g.rect(0, 0, L.width, L.height).fill(COLORS.wall);
      // 大廳
      g.rect(L.lobby.x, L.lobby.y, L.lobby.w, L.lobby.h).fill(0x3d4560);
      for (let x = L.lobby.x; x < L.lobby.x + L.lobby.w; x += 16) g.rect(x, L.lobby.y + L.lobby.h - 3, 8, 2).fill({ color: 0x5a6486, alpha: 0.6 });
      g.rect(L.desk.x, L.desk.y, L.desk.w, L.desk.h).fill(0xb07a4a).rect(L.desk.x, L.desk.y, L.desk.w, 2).fill(0xd9a066); // 報到櫃台
      g.rect(L.coffee.x, L.coffee.y, L.coffee.w, L.coffee.h).fill(0xe8e8ee).rect(L.coffee.x + 4, L.coffee.y + 1, 6, 5).fill(0xd9534f).rect(L.coffee.x + 14, L.coffee.y + 1, 6, 5).fill(0xf0c040); // 茶點桌
      for (const c of L.chat) g.rect(c.x - 3, c.y - 2, 6, 4).fill({ color: 0x9aa3b8, alpha: 0.5 }); // 小圓桌
      g.rect(0, L.entrance.y - 9, 10, 18).fill(COLORS.dark).rect(1, L.entrance.y - 8, 4, 16).fill(0x4f8fe3);
      L.halls.forEach((h, i) => {
        const r = h.rect;
        g.rect(r.x, r.y, r.w, r.h).fill(0x242a44).rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2).fill(0x34405e);
        for (const s of h.grid) g.rect(s.x - 3, s.y - 2, 6, 4).fill(0x3a8fb0).rect(s.x - 3, s.y - 2, 6, 1).fill(0x6ec3e0);
        g.rect(h.door.x - 6, h.door.y - 1, 12, 3).fill(COLORS.yellow);
        if (!built[i]) hatch(g, r.x, r.y, r.w, r.h);
      });
    },
    update(dt, c) {
      sim.update(dt, c.minute % 1440);
    },
    drawDynamic(g, c) {
      const m = c.minute % 1440;
      L.halls.forEach((h, i) => {
        const live = !!built[i] && sim.live(i, m);
        g.rect(h.screen.x, h.screen.y, h.screen.w, h.screen.h).fill(live ? 0xe8f0ff : 0x2d3142);
        if (live) drawPerson(g, h.podium.x, h.podium.y, 0xe8e8ee); // 簡報者
        else if (built[i]) g.rect(h.rect.x + 1, h.rect.y + 1, h.rect.w - 2, h.rect.h - 2).fill({ color: 0x080a18, alpha: 0.3 });
      });
      drawMovers(g, sim.movers());
    },
  };
};
