import { describe, expect, it } from "vitest";
import { ATRIUM_W, MAX_LOTS, ROOM_H, ROOM_W, SIDE, layoutFloor, patrolEnds, pickEntrance, roomOfSlot, routeTo, rowCounts, type FloorPlan } from "./floorplan";

const slots = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("rowCounts", () => {
  it("≤8 格用單走道（上排多一個），9 格以上用雙走道島型", () => {
    expect(rowCounts(1)).toEqual({ layout: "compact", counts: [1, 0] });
    expect(rowCounts(4)).toEqual({ layout: "compact", counts: [2, 2] });
    expect(rowCounts(7)).toEqual({ layout: "compact", counts: [4, 3] });
    expect(rowCounts(8)).toEqual({ layout: "compact", counts: [4, 4] });
    expect(rowCounts(9)).toEqual({ layout: "island", counts: [3, 2, 2, 2] });
    expect(rowCounts(12)).toEqual({ layout: "island", counts: [3, 3, 3, 3] });
    expect(rowCounts(14)).toEqual({ layout: "island", counts: [4, 4, 3, 3] });
  });
  it("超過上限的店面格被截掉", () => {
    const c = rowCounts(30);
    expect(c.counts.reduce((a, b) => a + b, 0)).toBe(MAX_LOTS);
  });
});

describe("layoutFloor", () => {
  const sizes = Array.from({ length: 14 }, (_, i) => i + 1);

  it.each(sizes)("n=%i：每個店面格都有房間，slot 對得上", (n) => {
    const p = layoutFloor(slots(n));
    expect(p.rooms.map((r) => r.slot).sort((a, b) => a - b)).toEqual(slots(n));
    for (const s of slots(n)) expect(roomOfSlot(p, s)).toBeDefined();
  });

  it.each(sizes)("n=%i：房間不重疊、都在地圖範圍內", (n) => {
    const p = layoutFloor(slots(n));
    for (const a of p.rooms) {
      expect(a.x).toBeGreaterThanOrEqual(SIDE);
      expect(a.x + a.w).toBeLessThanOrEqual(p.width - SIDE);
      expect(a.y).toBeGreaterThanOrEqual(1);
      expect(a.y + a.h).toBeLessThanOrEqual(p.height);
    }
    for (let i = 0; i < p.rooms.length; i++)
      for (let j = i + 1; j < p.rooms.length; j++) {
        const a = p.rooms[i]!;
        const b = p.rooms[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
  });

  it.each(sizes)("n=%i：房間不會蓋到中庭", (n) => {
    const p = layoutFloor(slots(n));
    for (const r of p.rooms) {
      const hitsAtrium = r.x < p.atrium.x1 && r.x + r.w > p.atrium.x0;
      expect(hitsAtrium).toBe(false);
    }
    expect(p.atrium.x1 - p.atrium.x0).toBe(ATRIUM_W);
  });

  it.each(sizes)("n=%i：房間緊貼它面對的走道，門在行走線上", (n) => {
    const p = layoutFloor(slots(n));
    for (const r of p.rooms) {
      const cor = p.corridors[r.corridor]!;
      if (r.row === "top") expect(r.y + r.h).toBe(cor.y);
      else expect(r.y).toBe(cor.y + cor.h);
      expect(r.door.y).toBe(cor.laneY);
      expect(r.door.x).toBe(r.x + ROOM_W / 2);
      expect(r.h).toBe(ROOM_H);
    }
  });

  it.each(sizes)("n=%i：每排的房間數＋服務區塊數＝欄位數（沒有空洞）", (n) => {
    const p = layoutFloor(slots(n));
    const cols = (p.width - SIDE * 2 - ATRIUM_W) / ROOM_W;
    const rowsY = new Set([...p.rooms.map((r) => r.y), ...p.serviceBlocks.map((b) => b.y)]);
    for (const y of rowsY) {
      const rooms = p.rooms.filter((r) => r.y === y).length;
      const blocks = p.serviceBlocks.filter((b) => b.y === y).length;
      expect(rooms + blocks).toBe(cols);
    }
  });

  it("版型：8 格以內單走道；9 格以上雙走道且高度更高", () => {
    const a = layoutFloor(slots(8));
    const b = layoutFloor(slots(12));
    expect(a.layout).toBe("compact");
    expect(a.corridors).toHaveLength(1);
    expect(b.layout).toBe("island");
    expect(b.corridors).toHaveLength(2);
    expect(b.height).toBeGreaterThan(a.height);
  });

  it("island：兩排背靠背，朝向正確（朝北的門在上、朝南的開口在下）", () => {
    const p = layoutFloor(slots(12));
    const ys = [...new Set(p.rooms.map((r) => r.y))].sort((a, b) => a - b);
    expect(ys).toHaveLength(4);
    const rows = ys.map((y) => p.rooms.find((r) => r.y === y)!.row);
    expect(rows).toEqual(["top", "bottom", "top", "bottom"]);
    const corr = ys.map((y) => p.rooms.find((r) => r.y === y)!.corridor);
    expect(corr).toEqual([0, 0, 1, 1]);
  });

  it("擴建：店面格變多，寬或高會增加，版型簽名改變", () => {
    const a = layoutFloor(slots(6));
    const b = layoutFloor(slots(10));
    expect(b.sig).not.toBe(a.sig);
    expect(b.width * b.height).toBeGreaterThan(a.width * a.height);
  });
});

describe("路徑圖", () => {
  const check = (p: FloorPlan) => {
    for (const r of p.rooms)
      for (const e of p.entrances) {
        const route = routeTo(p, e.id, r.slot);
        expect(route, `${e.id}>${r.slot}`).not.toBeNull();
        const pts = route!;
        expect(pts[0]).toEqual(e.at);
        expect(pts[pts.length - 1]).toEqual(r.door);
        // 每一段只沿水平或垂直走（走道行走線／垂直連接線）
        for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y).toBe(true);
      }
  };

  it.each([2, 5, 8, 9, 12, 14])("n=%i：每個入口（街道門、電扶梯、電梯、車站）都走得到每一間店", (n) => {
    check(layoutFloor(slots(n), { ground: true }));
    check(layoutFloor(slots(n)));
    check(layoutFloor(slots(n), { links: ["rail", "parking"] }));
  });

  it("island：去上走道的店要繞側廊或中庭（路線經過垂直連接線）", () => {
    const p = layoutFloor(slots(12), { ground: true });
    const top = p.rooms.find((r) => r.corridor === 0)!;
    const route = routeTo(p, "street-left", top.slot)!;
    const lanes = new Set(route.map((q) => q.y));
    expect(lanes.has(p.corridors[0]!.laneY)).toBe(true);
    expect(lanes.has(p.corridors[1]!.laneY)).toBe(true);
  });

  it("路線有快取、不存在的店回傳 null", () => {
    const p = layoutFloor(slots(6), { ground: true });
    expect(routeTo(p, "street-left", 1)).toBe(routeTo(p, "street-left", 1));
    expect(routeTo(p, "street-left", 999)).toBeNull();
    // 沒有這個入口（非地面層沒有街道門）
    expect(routeTo(layoutFloor(slots(6)), "street-left", 1)).toBeNull();
  });

  it("只有地面層有街道門；其他樓層只有電扶梯與電梯", () => {
    for (const n of [4, 8, 12]) {
      const ground = layoutFloor(slots(n), { ground: true });
      expect(ground.entrances.filter((e) => e.kind === "street")).toHaveLength(2);
      expect(ground.ends).toEqual({ left: "street", right: "street" });

      const upper = layoutFloor(slots(n));
      expect(upper.entrances.map((e) => e.kind).sort()).toEqual(["elevator", "escalator"]);
      expect(upper.ends).toEqual({ left: "wall", right: "wall" });
      // 外部的出入口都落在走道兩端；電扶梯、電梯的入口在館內
      for (const e of upper.entrances) {
        expect(e.at.x).toBeGreaterThan(1);
        expect(e.at.x).toBeLessThan(upper.width - 1);
        expect(e.from).toBeDefined();
      }
    }
  });

  it("例外：連通車站／停車場的樓層多一個外部出入口；地面層不重複加", () => {
    const rail = layoutFloor(slots(8), { links: ["rail"] });
    expect(rail.entrances.map((e) => e.kind).sort()).toEqual(["elevator", "escalator", "rail"]);
    expect(rail.ends).toEqual({ left: "rail", right: "wall" });
    expect(rail.entrances.find((e) => e.kind === "rail")!.at.x).toBeLessThan(1);

    const both = layoutFloor(slots(8), { links: ["rail", "parking"] });
    expect(both.ends).toEqual({ left: "rail", right: "parking" });
    expect(both.entrances.find((e) => e.kind === "parking")!.at.x).toBeGreaterThan(both.width - 1);

    const ground = layoutFloor(slots(8), { ground: true, links: ["rail"] });
    expect(ground.entrances.some((e) => e.kind === "rail")).toBe(false);
    // 出入口不同，背景貼圖的快取鍵也要不同
    expect(new Set([layoutFloor(slots(8)).sig, rail.sig, both.sig, ground.sig]).size).toBe(4);
  });

  it("入口抽中的機率合理：非地面層幾乎都是電扶梯（約 6 成）與電梯", () => {
    const p = layoutFloor(slots(8));
    const hit = { escalator: 0, elevator: 0 };
    for (let i = 0; i < 1000; i++) hit[pickEntrance(p, i / 1000).kind as "escalator" | "elevator"]++;
    expect(hit.escalator).toBeGreaterThan(550);
    expect(hit.escalator).toBeLessThan(650);
    expect(hit.escalator + hit.elevator).toBe(1000);
  });

  it("清潔員巡邏兩端在主走道上", () => {
    const p = layoutFloor(slots(12));
    const [a, b] = patrolEnds(p);
    expect(a.y).toBe(p.corridors[p.mainCorridor]!.laneY);
    expect(b.x).toBeGreaterThan(a.x);
  });
});
