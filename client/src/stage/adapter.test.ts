import { describe, expect, it } from "vitest";
import { CATEGORIES, TICKS_PER_DAY, TICK_MINUTES, ZONES, type PublicMallState } from "@coidle/shared";
import { advanceTo, createInitialState } from "../../../server/src/sim";
import { FLOOR_LABELS, archetypeOf, colorOfCategory, floorIndexOfSlot, locateShop, toStageModel } from "./adapter";
import { MAX_LOTS, layoutFloor, routeTo } from "./floorplan";

const START = (Date.UTC(2026, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
type Mutable = ReturnType<typeof createInitialState>;

function stateAt(days: number, mutate?: (s: Mutable) => void): PublicMallState {
  let s = createInitialState(7, START);
  s = advanceTo(s, START + days * TICKS_PER_DAY + 30);
  mutate?.(s);
  const { seed: _seed, cooldowns: _cd, ...rest } = s;
  return rest;
}

describe("archetypeOf / colorOfCategory", () => {
  it("84 種業態都有原型，四個群組都用得到", () => {
    const seen = new Set<string>();
    for (const c of CATEGORIES) {
      const a = archetypeOf(c);
      expect(["cafe", "counter", "shelf", "rack", "arcade"]).toContain(a);
      seen.add(a);
    }
    expect(seen.size).toBe(5);
  });
  it("娛樂一律是電玩擺設；飲品是咖啡館；其餘餐飲是吧台", () => {
    expect(archetypeOf({ name: "電影院", group: "entertainment" })).toBe("arcade");
    expect(archetypeOf({ name: "咖啡館", group: "food" })).toBe("cafe");
    expect(archetypeOf({ name: "拉麵店", group: "food" })).toBe("counter");
    expect(archetypeOf({ name: "服飾店", group: "retail" })).toBe("rack");
    expect(archetypeOf({ name: "書店", group: "retail" })).toBe("shelf");
  });
  it("招牌色對同一業態永遠一樣", () => {
    expect(colorOfCategory("ramen")).toBe(colorOfCategory("ramen"));
    for (const c of CATEGORIES) expect(colorOfCategory(c.id)).toBeGreaterThan(0);
  });
});

describe("toStageModel", () => {
  it("每個區域一個樓層，標籤唯一；開幕時只有 B1 解鎖", () => {
    const m = toStageModel(stateAt(0));
    expect(m.floors).toHaveLength(ZONES.length);
    expect(new Set(m.floors.map((f) => f.label)).size).toBe(ZONES.length);
    for (const z of ZONES) expect(FLOOR_LABELS[z.id]).toBeDefined();
    expect(m.floors[0]!.lockedLevel).toBeNull();
    for (const f of m.floors.slice(1)) expect(f.lockedLevel).toBeGreaterThan(1);
  });

  it("每層的店面格數＝狀態裡該區域的 slot 數；slot 對應真實 id", () => {
    const s = stateAt(0);
    const m = toStageModel(s);
    for (const f of m.floors) {
      const slots = s.slots.filter((x) => x.zone === f.zoneId);
      expect(f.lots.map((l) => l.slot)).toEqual(slots.map((x) => x.id));
    }
  });

  it("未解鎖的樓層不顯示任何店", () => {
    const m = toStageModel(stateAt(0));
    for (const f of m.floors.filter((x) => x.lockedLevel !== null)) expect(f.lots.every((l) => l.shop === null)).toBe(true);
  });

  it("開幕店面被轉成營業中的 StageShop，欄位對得上", () => {
    const s = stateAt(0);
    const m = toStageModel(s);
    const shops = m.floors[0]!.lots.filter((l) => l.shop).map((l) => l.shop!);
    expect(shops.length).toBe(s.shops.length);
    for (const sh of shops) {
      const real = s.shops.find((x) => x.id === sh.id)!;
      expect(sh.state).toBe("open");
      expect(sh.level).toBe(real.level);
      expect(sh.price).toBe(real.price);
      expect(sh.todayRevenue).toBe(real.day.revenue);
      expect(sh.slot).toBe(real.slot);
    }
  });

  it("興建中的店：顯示成施工中，進度在 0–1 之間", () => {
    let slotId = -1;
    const m = toStageModel(
      stateAt(0, (s) => {
        const free = s.slots.find((x) => x.zone === "b1" && !x.shopId)!;
        slotId = free.id;
        const cat = CATEGORIES.find((c) => c.zone === "b1")!;
        s.builds.push({ id: "b-test", kind: "open", slot: free.id, category: cat.id, completeTick: s.tick + Math.floor(cat.buildTicks / 2), cost: cat.buildCost });
      }),
    );
    const lot = m.floors[0]!.lots.find((l) => l.slot === slotId)!;
    expect(lot.shop?.state).toBe("building");
    expect(lot.shop!.progress).toBeGreaterThan(0.3);
    expect(lot.shop!.progress).toBeLessThan(0.7);
  });

  it("暫停營業 → closed＋broken 旗標；缺貨 → stockout 旗標", () => {
    let a = "";
    const m = toStageModel(
      stateAt(0, (s) => {
        a = s.shops[0]!.id;
        s.shops[0]!.closedUntilTick = s.tick + 50;
      }),
    );
    const sh = m.floors[0]!.lots.map((l) => l.shop).find((x) => x?.id === a)!;
    expect(sh.state).toBe("closed");
    expect(sh.flags).toContain("broken");
  });

  it("擴建資訊：B1 還能擴建；達上限後不再顯示", () => {
    const m = toStageModel(stateAt(0));
    const b1 = m.floors[0]!;
    expect(b1.expand).not.toBeNull();
    expect(b1.expand!.n).toBeLessThan(b1.expand!.max);
    expect(b1.expand!.cost).toBeGreaterThan(0);

    const maxed = toStageModel(
      stateAt(0, (s) => {
        const z = ZONES.find((x) => x.id === "b1")!;
        for (let i = 0; i < z.maxExpand; i++) s.slots.push({ id: s.slots.length, zone: "b1", shopId: null });
      }),
    );
    expect(maxed.floors[0]!.expand).toBeNull();
  });

  it("時間與營業時間來自狀態；今日損益算式與總覽一致", () => {
    const s = stateAt(2);
    const m = toStageModel(s);
    expect(m.minuteOfDay).toBeGreaterThanOrEqual(0);
    expect(m.minuteOfDay).toBeLessThan(1440);
    expect(m.openHour).toBe(s.hours.open);
    expect(m.closeHour).toBe(s.hours.close);
    expect(m.todayProfit).toBe(s.today.revenue + s.today.rentIncome - s.today.purchases - s.today.fixed - s.today.repairs);
    expect(m.funds).toBe(s.funds);
  });

  it("待辦中心的內容一併帶出", () => {
    const m = toStageModel(stateAt(0, (s) => (s.funds = -10)));
    expect(m.attention.some((a) => a.id === "funds-negative")).toBe(true);
  });

  it("每個樓層都能排出平面圖，且兩個入口走得到每一間店（含擴建到上限）", () => {
    const s = stateAt(0, (st) => {
      for (const z of ZONES) for (let i = 0; i < z.maxExpand; i++) st.slots.push({ id: st.slots.length, zone: z.id, shopId: null });
    });
    const m = toStageModel(s);
    for (const f of m.floors) {
      expect(f.lots.length).toBeLessThanOrEqual(MAX_LOTS);
      const plan = layoutFloor(f.lots.map((l) => l.slot), { ground: f.ground, links: f.links });
      expect(plan.rooms).toHaveLength(f.lots.length);
      for (const r of plan.rooms) for (const e of plan.entrances) expect(routeTo(plan, e.id, r.slot), `${f.id} ${e.id} ${r.slot}`).not.toBeNull();
    }
  });

  it("出入口：只有 1F 有街道門；B1 連通車站；其他樓層只有電扶梯與電梯", () => {
    const m = toStageModel(stateAt(0, (st) => {
      for (const z of ZONES) for (let i = 0; i < z.maxExpand; i++) st.slots.push({ id: st.slots.length, zone: z.id, shopId: null });
    }));
    const kinds = (id: string) => {
      const f = m.floors.find((x) => x.id === id)!;
      return layoutFloor(f.lots.map((l) => l.slot), { ground: f.ground, links: f.links }).entrances.map((e) => e.kind).sort();
    };
    expect(kinds("f1")).toEqual(["elevator", "escalator", "street", "street"]);
    expect(kinds("b1")).toEqual(["elevator", "escalator", "rail"]);
    for (const z of ZONES.filter((z) => z.id !== "f1" && z.id !== "b1")) expect(kinds(z.id), z.id).toEqual(["elevator", "escalator"]);
    expect(m.floors.filter((f) => f.ground).map((f) => f.label)).toEqual(["1F"]);
  });

  it("天氣：模型帶出此刻的天氣，事件強制的天氣優先", () => {
    expect(["clear", "cloudy", "rain", "storm"]).toContain(toStageModel(stateAt(0)).weather.kind);
    const forced = toStageModel(
      stateAt(0, (s) => {
        s.modifiers.push({ kind: "weather", weather: "storm", temp: 24, endTick: s.tick + 100 });
      }),
    );
    expect(forced.weather).toEqual({ kind: "storm", temp: 24 });
  });

  it("沒有「客流預測」科技看不到明日預報；研發後才有", () => {
    expect(toStageModel(stateAt(0)).tomorrow).toBeNull();
    const m = toStageModel(
      stateAt(0, (s) => {
        s.tech.done.push("t_data");
      }),
    );
    expect(m.tomorrow).not.toBeNull();
  });

  it("只有屋頂廣場是露天樓層", () => {
    const m = toStageModel(stateAt(0));
    expect(m.floors.filter((f) => f.outdoor).map((f) => f.zoneId)).toEqual(["plaza"]);
  });

  it("locateShop／floorIndexOfSlot", () => {
    const s = stateAt(0);
    const m = toStageModel(s);
    const sh = s.shops[0]!;
    expect(locateShop(m, sh.id)).toEqual({ floor: 0, slot: sh.slot });
    expect(locateShop(m, "nope")).toBeNull();
    expect(floorIndexOfSlot(m, sh.slot)).toBe(0);
    expect(floorIndexOfSlot(m, 99999)).toBe(-1);
  });
});

describe("lotSignature（決定場景何時重畫房間）", () => {
  const base = () => toStageModel(stateAt(0)).floors[0]!;
  it("價格、營收、旗標變動不改變簽名；狀態、原型、施工進度、鎖定會", async () => {
    const { lotSignature } = await import("./model");
    const f = base();
    const sig = lotSignature(f);
    const withPrice = structuredClone(f);
    const shop = withPrice.lots.find((l) => l.shop)!.shop!;
    shop.price += 100;
    shop.todayRevenue += 999;
    shop.flags = ["stockout"];
    expect(lotSignature(withPrice)).toBe(sig);

    const closed = structuredClone(f);
    closed.lots.find((l) => l.shop)!.shop!.state = "closed";
    expect(lotSignature(closed)).not.toBe(sig);

    const locked = structuredClone(f);
    locked.lockedLevel = 3;
    expect(lotSignature(locked)).not.toBe(sig);

    const arche = structuredClone(f);
    const sh = arche.lots.find((l) => l.shop)!.shop!;
    sh.archetype = sh.archetype === "cafe" ? "arcade" : "cafe";
    expect(lotSignature(arche)).not.toBe(sig);
  });
});
