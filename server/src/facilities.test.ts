import { describe, expect, it } from "vitest";
import { CATEGORY_BY_ID, FACILITY_BY_KIND, facilityAmount, facilityFloors, facilityUnits, isCategoryAvailable, parkingTrafficMult, type MallState } from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, type Command } from "./sim";
import { makeShop } from "./sim/state";

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const mk = (level = 3, funds = 100_000_000): MallState => {
  const s = createInitialState(7, START, 0);
  s.level = level;
  s.funds = funds;
  return s;
};
const fails = (s: MallState, c: Command): string | null => {
  const r = applyCommand(s, c);
  return r.ok ? null : r.error;
};

describe("大型設施：地下停車場", () => {
  it("停車場不再是店面：不能開店、不會有租戶候選", () => {
    const s = mk();
    expect(isCategoryAvailable(s, "parking")).toBe(false);
    expect(fails(s, { type: "buildShop", slot: 10, category: "parking" })).toContain("大型設施");
  });

  it("蓋停車層：扣款、施工、落成後車位增加；一次只能蓋一層，也不能超過等級", () => {
    const s = mk(1);
    expect(fails(s, { type: "buildFacility", kind: "parking" })).toContain("Lv.2");
    s.level = 2;
    const cost = FACILITY_BY_KIND.parking!.units[0]!.cost;
    const before = s.funds;
    const r = applyCommand(s, { type: "buildFacility", kind: "parking" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.funds).toBe(before - cost);
    expect(facilityUnits(r.state, "parking")).toBe(0);
    expect(fails(r.state, { type: "buildFacility", kind: "parking" })).toContain("正在興建");
    const done = advanceTo(r.state, r.state.tick + FACILITY_BY_KIND.parking!.units[0]!.ticks + 2);
    expect(facilityUnits(done, "parking")).toBe(1);
    expect(facilityAmount(done, "parking")).toBe(30);
    expect(done.facilities?.[0]?.building).toBeUndefined();
  });

  it("車位越多自駕客越旺，沒蓋就沒影響；效果有上限", () => {
    const none = mk();
    expect(parkingTrafficMult(none, "family")).toBe(1);
    expect(parkingTrafficMult({ facilities: [{ kind: "parking", units: 1 }] }, "family")).toBeGreaterThan(1);
    const big = parkingTrafficMult({ facilities: [{ kind: "parking", units: 4 }] }, "family");
    expect(big).toBeLessThanOrEqual(1.05);
    expect(parkingTrafficMult({ facilities: [{ kind: "parking", units: 4 }] }, "student")).toBe(1);
  });

  it("舊存檔的停車場店面會被轉成設施：冪等、釋放店面格、金錢不變", () => {
    const s = mk();
    const slot = s.slots.find((x) => x.zone === "f1" && !x.shopId)!;
    const shop = makeShop(s, "parking", "停車場", slot.id);
    shop.level = 2;
    slot.shopId = shop.id;
    s.shops.push(shop);
    const funds = s.funds;
    const a = advanceTo(s, s.tick + 1);
    expect(a.shops.some((x) => x.category === "parking")).toBe(false);
    expect(a.slots[slot.id]!.shopId).toBeNull();
    expect(facilityUnits(a, "parking")).toBe(2);
    const b = advanceTo(a, a.tick + 1);
    expect(facilityUnits(b, "parking")).toBe(2);
    expect(b.funds).toBeGreaterThanOrEqual(funds - 5_000_000); // 只有一般營運的進出，沒有憑空生錢或扣錢的轉換
  });

  it("影城：蓋廳、每日有票房、廳越多越賺（遞減）、舊電影院店面被轉成設施", () => {
    expect(isCategoryAvailable(mk(), "cinema")).toBe(false);
    const day = 288;
    const run = (screens: number) => {
      const s = mk(5);
      s.facilities = [{ kind: "cinema", units: screens }];
      const before = s.funds;
      const a = advanceTo(s, s.tick + day * 3);
      return { gain: a.funds - before, rev: a.facilities![0]!.today!.revenue };
    };
    const one = run(1);
    const four = run(4);
    expect(one.rev).toBeGreaterThan(0);
    expect(four.rev).toBeGreaterThan(one.rev);
    expect(four.rev).toBeLessThan(one.rev * 4);

    const s = mk(5);
    const slot = s.slots.find((x) => x.zone === "ent" && !x.shopId)!;
    const shop = makeShop(s, "cinema", "電影院", slot.id);
    shop.level = 3;
    slot.shopId = shop.id;
    s.shops.push(shop);
    const a = advanceTo(s, s.tick + 1);
    expect(a.shops.some((x) => x.category === "cinema")).toBe(false);
    expect(a.slots[slot.id]!.shopId).toBeNull();
    expect(facilityUnits(a, "cinema")).toBe(3);
  });

  it("保齡球館、旅館、膠囊旅館、會議中心、活動場地：不是店面、可興建、有營收；舊店面轉成設施；整棟只有一層畫面", () => {
    for (const kind of ["bowling", "hotel", "capsule_hotel", "conference", "event_space"] as const) {
      const def = FACILITY_BY_KIND[kind]!;
      expect(isCategoryAvailable(mk(8), kind)).toBe(false);
      expect(def.perFloor).toBe(def.units.length); // 單一樓層
      const s = mk(8);
      s.facilities = [{ kind, units: 2 }];
      const before = s.funds;
      const a = advanceTo(s, s.tick + 288 * 3);
      expect(a.facilities![0]!.today!.revenue, kind).toBeGreaterThan(0);
      expect(a.funds - before, kind).not.toBeNaN();
      // 整棟只有一個標準樓層；旅館類只有一樓大廳（客房層先封存）
      expect(facilityFloors(s).filter((f) => f.kind === kind && !f.part)).toHaveLength(FACILITY_BY_KIND[kind]!.lobby ? 0 : 1);

      // 舊存檔的店面轉成設施
      const old = mk(8);
      const slot = old.slots.find((x) => x.zone === CATEGORY_BY_ID[kind]!.zone && !x.shopId)!;
      const shop = makeShop(old, kind, def.name, slot.id);
      shop.level = 2;
      slot.shopId = shop.id;
      old.shops.push(shop);
      const b = advanceTo(old, old.tick + 1);
      expect(b.shops.some((x) => x.category === kind), kind).toBe(false);
      expect(facilityUnits(b, kind), kind).toBe(2);
    }
  });

  it("影城平衡：設施是金錢出口、不是印鈔機（回收期要長）", () => {
    const days = 5;
    const gainPerDay = (screens: number) => {
      const s = mk(5);
      s.facilities = screens > 0 ? [{ kind: "cinema", units: screens }] : [];
      const ref = mk(5);
      return (advanceTo(s, s.tick + 288 * days).funds - advanceTo(ref, ref.tick + 288 * days).funds) / days;
    };
    const cost = (n: number) => FACILITY_BY_KIND.cinema!.units.slice(0, n).reduce((a, u) => a + u.cost, 0);
    expect(cost(1) / gainPerDay(1)).toBeGreaterThan(40); // 第一廳也不能太快回本
    expect(cost(4) / gainPerDay(4)).toBeGreaterThan(120); // 中段約 150～250 遊戲天
    expect(cost(8) / gainPerDay(8)).toBeGreaterThan(300); // 蓋滿比主業慢很多
  });

  it("設施樓層：停車場每層一個地下層、影城每 4 廳一層", () => {
    const s = mk();
    s.facilities = [
      { kind: "parking", units: 2 },
      { kind: "cinema", units: 5 },
    ];
    const fl = facilityFloors(s);
    expect(fl.filter((f) => f.kind === "parking")).toHaveLength(2);
    expect(fl.filter((f) => f.kind === "cinema").map((f) => f.label)).toEqual(["8F", "9F"]);
  });

  it("沒有設施的商場：決定性不變（同種子同結果）", () => {
    const a = advanceTo(mk(), START + 300);
    const b = advanceTo(mk(), START + 300);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("旅館大廳層", () => {
  it("旅館與膠囊旅館有大廳層（有單位或施工中才有），其他設施沒有", () => {
    const s = mk();
    s.facilities = [
      { kind: "hotel", units: 1 },
      { kind: "capsule_hotel", units: 0, building: { completeTick: s.tick + 100, cost: 1 } },
      { kind: "bowling", units: 3 },
    ];
    const fl = facilityFloors(s);
    expect(fl.filter((f) => f.part === "lobby").map((f) => f.label)).toEqual(["旅廳", "膠廳"]);
    expect(fl.filter((f) => f.kind === "bowling")).toHaveLength(1);
    expect(fl.filter((f) => f.kind === "hotel")).toHaveLength(1); // 只有大廳（標準客房層先封存）
  });
});
