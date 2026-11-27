import { describe, expect, it } from "vitest";
import { makeRng } from "../crowd";
import { BowlingSim, bowlingFill, layoutBowling } from "./bowling.sim";
import { ConferenceSim, conferenceAttendance, conferenceSchedule, layoutConference } from "./conference.sim";
import { EventSim, eventCrowd, eventSchedule, layoutEvent } from "./event.sim";
import { HotelSim, hotelOccupancy, layoutHotel } from "./hotel.sim";

describe("保齡球館", () => {
  it("平面圖：每道有座位、位置不重疊；道數越多越高", () => {
    const a = layoutBowling(2);
    const b = layoutBowling(8);
    expect(b.height).toBeGreaterThan(a.height);
    for (let i = 0; i < 8; i++) expect(b.seats(i)[0]!.y).toBeGreaterThan(i > 0 ? b.seats(i - 1)[0]!.y : 0);
  });

  it("客人入場到球道、輪流投球（球滾、瓶倒）、打完離開，道空出來", () => {
    const L = layoutBowling(4);
    const sim = new BowlingSim(L, makeRng(1), [true, true, true, true], 0);
    let sawRoll = false;
    let sawFallen = false;
    for (let i = 0; i < 4000; i++) {
      sim.update(0.1, 0.8);
      for (const lane of sim.lanes) {
        if (lane.phase === "roll") sawRoll = true;
        if (lane.pins.some((p) => !p)) sawFallen = true;
      }
    }
    expect(sawRoll).toBe(true);
    expect(sawFallen).toBe(true);
    for (let i = 0; i < 8000; i++) sim.update(0.1, 0); // 打烊
    expect(sim.busy).toBe(0);
  });

  it("沒蓋好的球道不會有人", () => {
    const sim = new BowlingSim(layoutBowling(3), makeRng(2), [true, false, false], 0.9);
    for (let i = 0; i < 600; i++) sim.update(0.1, 1);
    expect(sim.lanes[1]!.party).toBeNull();
    expect(sim.lanes[2]!.party).toBeNull();
  });

  it("使用率：晚上比白天高，打烊 0", () => {
    expect(bowlingFill(100, 0, 10, 4, false)).toBe(0);
    expect(bowlingFill(100, 1.5, 10, 4, false)).toBeGreaterThan(bowlingFill(100, 0.3, 10, 4, false));
  });
});

describe("旅館／膠囊旅館（一個標準樓層）", () => {
  it("平面圖：房數一致，門都在走道上", () => {
    for (const [n, cap] of [[10, false], [24, true]] as const) {
      const L = layoutHotel(n, cap);
      expect(L.rooms).toHaveLength(n);
      for (const r of L.rooms) expect(r.door.y).toBe(L.laneY);
    }
  });

  it("入住：晚上旅客拉著行李走進房間、燈亮；早上退房離開", () => {
    const L = layoutHotel(10, false);
    const sim = new HotelSim(L, makeRng(3), 1, 14 * 60);
    expect(sim.lit.some(Boolean)).toBe(false); // 下午 2 點：前一晚的客人已退房、新客還沒到
    let walking = 0;
    for (let m = 14 * 60; m <= 23 * 60; m += 2) {
      sim.update(3, m);
      walking = Math.max(walking, sim.walkers.length);
    }
    expect(walking).toBeGreaterThan(0);
    expect(sim.lit.filter(Boolean).length).toBe(10);
    // 隔天早上 11 點前全部退房
    for (let m = 23 * 60; m < 24 * 60; m += 2) sim.update(3, m);
    for (let m = 0; m <= 11 * 60 + 30; m += 2) sim.update(3, m);
    expect(sim.lit.filter(Boolean).length).toBe(0);
  });

  it("時間跳很多：直接是該有的樣子", () => {
    const sim = new HotelSim(layoutHotel(10, false), makeRng(4), 1, 12 * 60);
    sim.update(0.1, 23 * 60);
    expect(sim.lit.filter(Boolean).length).toBe(10);
  });

  it("住房率：不超過 97%，假日較高", () => {
    expect(hotelOccupancy(1000, 10, false)).toBeLessThanOrEqual(0.97);
    expect(hotelOccupancy(5, 10, true)).toBeGreaterThan(hotelOccupancy(5, 10, false));
  });
});

describe("會議中心", () => {
  it("平面圖：座位都在廳內；最多 6 間", () => {
    const L = layoutConference([60, 60, 60, 60, 60, 60, 60]);
    expect(L.halls).toHaveLength(6);
    for (const h of L.halls) for (const s of h.seats) {
      expect(s.x).toBeGreaterThan(h.rect.x);
      expect(s.x).toBeLessThan(h.rect.x + h.rect.w);
      expect(s.y).toBeGreaterThan(h.rect.y);
      expect(s.y).toBeLessThan(h.rect.y + h.rect.h);
    }
  });

  it("場次落在營業時段內，每場 90 分", () => {
    const sh = conferenceSchedule(2, 9, 22);
    expect(sh.length).toBeGreaterThan(4);
    for (const s of sh) expect(s.end - s.start).toBe(90);
  });

  it("報到入座、散會後到大廳茶歇、再離開", () => {
    const sim = new ConferenceSim(layoutConference([60]), makeRng(5), 8, 22, 8 * 60, () => 30);
    const first = sim.sessions[0]!;
    let walking = 0;
    for (let m = first.start - 30; m <= first.start + 5; m++) {
      sim.update(5, m);
      walking = Math.max(walking, sim.movers().filter((p) => !p.seated).length);
    }
    expect(walking).toBeGreaterThan(0);
    expect(sim.movers().filter((p) => p.seated)).toHaveLength(30);
    expect(sim.live(0, first.start + 10)).toBe(true);
    for (let m = first.start + 5; m <= first.end + 8; m++) sim.update(4, m);
    expect(sim.movers().filter((p) => p.seated)).toHaveLength(0);
    expect(sim.live(0, first.end + 5)).toBe(false);
    // 茶歇的人最後離開（下一場開始前）
    for (let m = first.end + 8; m <= first.end + 60; m++) sim.update(8, m);
    expect(sim.movers().length).toBeLessThanOrEqual(30); // 只剩下一場提早到的人
  });

  it("出席人數：假日少一半、不超過席數 95%", () => {
    expect(conferenceAttendance(100, 2, 60, true)).toBeLessThan(conferenceAttendance(100, 2, 60, false));
    expect(conferenceAttendance(10_000, 1, 60, false)).toBeLessThanOrEqual(57);
  });
});

describe("活動場地", () => {
  it("平面圖：觀眾站位在觀眾區內；活動區越多站位越多", () => {
    const a = layoutEvent(1);
    const b = layoutEvent(4);
    expect(b.spots.length).toBeGreaterThan(a.spots.length);
    for (const s of b.spots) {
      expect(s.x).toBeGreaterThanOrEqual(b.pit.x);
      expect(s.x).toBeLessThanOrEqual(b.pit.x + b.pit.w);
      expect(s.y).toBeLessThanOrEqual(b.pit.y + b.pit.h);
    }
  });

  it("場次在營業時段內", () => {
    expect(eventSchedule(10, 22)).toHaveLength(2);
    expect(eventSchedule(10, 16)).toHaveLength(1);
  });

  it("活動前觀眾進場擠到舞台前，活動中舞台亮，散場後離開", () => {
    const sim = new EventSim(layoutEvent(2), makeRng(6), 10, 22, 16 * 60, 40);
    const main = sim.shows[1]!;
    for (let m = main.start - 45; m <= main.start + 5; m++) sim.update(6, m);
    expect(sim.live(main.start + 5)).toBe(true);
    const watching = sim.movers().length;
    expect(watching).toBeGreaterThanOrEqual(40);
    for (let m = main.start + 5; m <= main.end + 20; m++) sim.update(6, m);
    expect(sim.live(main.end + 5)).toBe(false);
    expect(sim.movers().length).toBeLessThan(watching / 2 + 12); // 剩下逛攤位的人
  });

  it("主場觀眾數：假日較多、不超過站位", () => {
    expect(eventCrowd(50, 200, true)).toBeGreaterThan(eventCrowd(50, 200, false));
    expect(eventCrowd(5000, 100, false)).toBe(100);
  });
});

describe("旅館大廳", () => {
  it("入住與退房的旅客排隊、到櫃台辦理，入住的人去電梯（有人先坐沙發），退房的人從門離開", async () => {
    const { HotelLobbySim, layoutLobby, lobbyRates } = await import("./hotellobby.sim");
    const L = layoutLobby(false);
    const sim = new HotelLobbySim(L, makeRng(8), 0.3);
    let served = 0;
    let sat = false;
    for (let i = 0; i < 6000; i++) {
      sim.update(0.1, 0.25, 0.1);
      if (sim.guests.some((g) => g.phase === "service")) served++;
      if (sim.guests.some((g) => g.phase === "sit" && g.timer < 20 && g.timer > 0)) sat = true;
      expect(sim.guests.length).toBeLessThan(40); // 不會無限累積
    }
    expect(served).toBeGreaterThan(0);
    expect(sat).toBe(true);
  });

  it("櫃台最多同時服務 2 位，排隊最多 5 位", async () => {
    const { HotelLobbySim, layoutLobby } = await import("./hotellobby.sim");
    const sim = new HotelLobbySim(layoutLobby(true), makeRng(9), 0);
    for (let i = 0; i < 3000; i++) {
      sim.update(0.1, 2, 2);
      expect(sim.guests.filter((g) => g.slot >= 0).length).toBeLessThanOrEqual(2);
      expect(sim.guests.filter((g) => g.qi >= 0).length).toBeLessThanOrEqual(5);
    }
  });

  it("速率：入住傍晚尖峰、退房早上尖峰", async () => {
    const { lobbyRates } = await import("./hotellobby.sim");
    expect(lobbyRates(10, 18, false).inRate).toBeGreaterThan(lobbyRates(10, 9, false).inRate);
    expect(lobbyRates(10, 9, false).outRate).toBeGreaterThan(lobbyRates(10, 18, false).outRate);
  });
});
