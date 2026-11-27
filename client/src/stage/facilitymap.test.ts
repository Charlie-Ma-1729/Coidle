import { describe, expect, it } from "vitest";
import { makeRng } from "./crowd";
import { CinemaSim, ParkingSim, cinemaSchedule, layoutCinema, layoutParking, parkingFill, SHOW_LEN } from "./facilitymap";
import { showAudience } from "./facilityspec";

describe("停車場平面圖", () => {
  it("車位數等於單位提供的車位，全部在圖內、互不重疊", () => {
    for (const n of [30, 50, 70, 100]) {
      const L = layoutParking(n);
      expect(L.bays).toHaveLength(n);
      const seen = new Set<string>();
      for (const b of L.bays) {
        expect(b.rect.x).toBeGreaterThanOrEqual(0);
        expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(L.width);
        expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(L.height);
        const k = `${b.rect.x},${b.rect.y}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });
});

describe("停車場模擬：車進來停、人下車、人回來上車、車開走", () => {
  it("初始就有一些車停著；進場的車停進空位，沒有兩台車同一格", () => {
    const L = layoutParking(30);
    const sim = new ParkingSim(L, makeRng(1), 0.3);
    expect(sim.occupied).toBe(9);
    for (let i = 0; i < 600; i++) sim.update(0.1, 0.8);
    const bays = new Set<string>();
    const cars = sim.movers().filter((m) => m.kind === "car");
    for (const c of cars) {
      const k = `${Math.round(c.x)},${Math.round(c.y)}`;
      // 停好的車在車格中心；開在路上的不在這個檢查範圍
      if (L.bays.some((b) => Math.abs(b.rect.x + b.rect.w / 2 - c.x) < 0.5 && Math.abs(b.rect.y + b.rect.h / 2 - c.y) < 0.5)) {
        expect(bays.has(k)).toBe(false);
        bays.add(k);
      }
    }
    expect(sim.occupied).toBeGreaterThan(9);
    expect(sim.occupied).toBeLessThanOrEqual(30);
  });

  it("人會下車走向電梯、逛完回來上車，車離開後車位空出來", () => {
    const L = layoutParking(30);
    const sim = new ParkingSim(L, makeRng(2), 0.5);
    const start = sim.occupied;
    let sawWalker = false;
    for (let i = 0; i < 4000; i++) {
      sim.update(0.1, 0); // 打烊：不再進場，人陸續回來開走
      if (sim.movers().some((m) => m.kind === "person")) sawWalker = true;
    }
    expect(start).toBeGreaterThan(0);
    expect(sawWalker).toBe(true);
    expect(sim.occupied).toBe(0);
  });

  it("停滿的時段車位不會超過上限", () => {
    const sim = new ParkingSim(layoutParking(30), makeRng(3), 0);
    for (let i = 0; i < 3000; i++) sim.update(0.1, 1);
    expect(sim.occupied).toBeLessThanOrEqual(30);
  });

  it("停車水位：打烊 0，營業時看人潮", () => {
    expect(parkingFill(0, false)).toBe(0);
    expect(parkingFill(1.5, false)).toBeGreaterThan(parkingFill(0.5, false));
    expect(parkingFill(2, true)).toBeLessThanOrEqual(0.94);
  });
});

describe("影城平面圖與場次", () => {
  it("每間廳的座位都在廳內，門在大廳那一側", () => {
    const L = layoutCinema([100, 100, 120, 120]);
    expect(L.rooms).toHaveLength(4);
    for (const r of L.rooms) {
      for (const s of r.seats) {
        expect(s.x).toBeGreaterThan(r.rect.x);
        expect(s.x).toBeLessThan(r.rect.x + r.rect.w);
        expect(s.y).toBeGreaterThan(r.rect.y);
        expect(s.y).toBeLessThan(r.rect.y + r.rect.h);
      }
      expect(r.door.y).toBe(r.above ? r.rect.y + r.rect.h : r.rect.y);
    }
    expect(L.height).toBeGreaterThan(L.lobby.y + L.lobby.h);
  });

  it("廳橫向排在大廳上方：越多廳越寬、高度不變（整數放大也放得進去）", () => {
    const one = layoutCinema([100]);
    const four = layoutCinema([100, 100, 120, 120]);
    expect(one.rooms).toHaveLength(1);
    expect(four.width).toBeGreaterThan(one.width);
    expect(four.height).toBeLessThanOrEqual(260);
    expect(four.width).toBeLessThanOrEqual(600);
  });

  it("場次：開店後 30 分鐘起，散場在打烊前，每場 120 分", () => {
    const sh = cinemaSchedule(2, 10, 22);
    expect(sh.length).toBeGreaterThan(4);
    for (const s of sh) {
      expect(s.end - s.start).toBe(SHOW_LEN);
      expect(s.end).toBeLessThanOrEqual(22 * 60);
      expect(s.start).toBeGreaterThanOrEqual(10 * 60 + 30);
    }
  });

  it("觀眾數：晚上比早上多，不超過座位的 95%", () => {
    expect(showAudience(100, 40, 20 * 60)).toBeGreaterThan(showAudience(100, 40, 11 * 60));
    expect(showAudience(100, 400, 20 * 60)).toBeLessThanOrEqual(95);
  });
});

describe("影城模擬：開演前進場、坐在位子上、散場後出來", () => {
  const mk = (minute: number) => new CinemaSim(layoutCinema([100]), makeRng(5), 10, 22, minute, () => 30);

  it("開演前沒人，開演時 30 人坐在座位上", () => {
    const sim = mk(10 * 60);
    const first = sim.shows[0]!;
    sim.update(0, first.start - 40);
    expect(sim.movers()).toHaveLength(0);
    // 跑到開演：時間每步 1 分鐘、每步 5 真實秒
    for (let m = first.start - 40; m <= first.start + 10; m++) sim.update(5, m);
    const seated = sim.movers().filter((p) => p.seated);
    expect(seated).toHaveLength(30);
    expect(sim.roomLit(0, first.start + 10)).toBe(true);
    expect(sim.roomLit(0, first.start - 20)).toBe(false);
  });

  it("開演前有人走進來（還沒坐下的人在動）", () => {
    const sim = mk(10 * 60);
    const first = sim.shows[0]!;
    let walking = 0;
    for (let m = first.start - 30; m < first.start - 5; m++) {
      sim.update(3, m);
      walking = Math.max(walking, sim.movers().filter((p) => !p.seated).length);
    }
    expect(walking).toBeGreaterThan(0);
  });

  it("散場後觀眾走出來，最後場內沒人", () => {
    const sim = mk(10 * 60);
    const first = sim.shows[0]!;
    for (let m = first.start - 40; m <= first.end + 20; m++) sim.update(8, m);
    // 第一場的人都走了（第二場的人可能已經在進場）
    const second = sim.shows[1];
    const stillFirst = sim.movers().filter((p) => p.seated).length;
    if (second && first.end + 20 < second.start - 28) expect(stillFirst).toBe(0);
    expect(sim.roomLit(0, first.end + 10)).toBe(false);
  });

  it("從中途開始（時間跳到演到一半）：直接看到人坐在位子上", () => {
    const first = mk(10 * 60).shows[0]!;
    const sim = mk(first.start + 60);
    expect(sim.movers().filter((p) => p.seated)).toHaveLength(30);
  });
});
