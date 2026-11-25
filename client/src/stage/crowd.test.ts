import { describe, expect, it } from "vitest";
import type { Weather } from "@coidle/shared";
import { CrowdSim, UMBRELLA_RANGE, hourWeight, isOpenAt, makeRng, spawnRatePerSec } from "./crowd";
import { buildDemoModel } from "./fixtures";
import { TILE, layoutFloor, roomOfSlot } from "./floorplan";
import { isShopActive, type StageShop } from "./model";

const model = buildDemoModel();
const f1 = model.floors[1]!;
const shopsOf = (lots: typeof f1.lots) => new Map<number, StageShop | null>(lots.map((l) => [l.slot, l.shop]));

function run(sim: CrowdSim, shops: Map<number, StageShop | null>, seconds: number, minute = 13 * 60) {
  for (let t = 0; t < seconds; t += 0.05) sim.update(0.05, shops, minute, 10, 22);
}

describe("crowd 生成率", () => {
  const open = f1.lots[0]!.shop!;
  it("營業中才有人；打烊與空地、施工中都是 0", () => {
    expect(spawnRatePerSec(open, 13 * 60, 10, 22)).toBeGreaterThan(0);
    expect(spawnRatePerSec(open, 3 * 60, 10, 22)).toBe(0);
    expect(spawnRatePerSec(null, 13 * 60, 10, 22)).toBe(0);
    expect(spawnRatePerSec({ ...open, state: "building" }, 13 * 60, 10, 22)).toBe(0);
    expect(spawnRatePerSec({ ...open, state: "closed" }, 13 * 60, 10, 22)).toBe(0);
  });
  it("缺貨與沒新鮮感會讓人變少，午餐尖峰比下午多", () => {
    const base = spawnRatePerSec(open, 12 * 60 + 30, 10, 22);
    expect(spawnRatePerSec({ ...open, flags: ["stockout"] }, 12 * 60 + 30, 10, 22)).toBeLessThan(base);
    expect(spawnRatePerSec({ ...open, flags: ["stale"] }, 12 * 60 + 30, 10, 22)).toBeLessThan(base);
    expect(hourWeight(12.5 * 60)).toBeGreaterThan(hourWeight(15.5 * 60));
  });
  it("營業時間判斷", () => {
    expect(isOpenAt(10 * 60, 10, 22)).toBe(true);
    expect(isOpenAt(22 * 60, 10, 22)).toBe(false);
  });
});

describe("CrowdSim", () => {
  it("顧客會進店、停留，之後離場（不會永遠卡在場上）", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const sim = new CrowdSim({ plan, rng: makeRng(1) });
    const shops = shopsOf(f1.lots);
    let sawDwell = false;
    let peak = 0;
    for (let t = 0; t < 60; t += 0.05) {
      sim.update(0.05, shops, 13 * 60, 10, 22);
      peak = Math.max(peak, sim.agents.length);
      if (sim.agents.some((a) => a.phase === "dwell")) sawDwell = true;
    }
    expect(peak).toBeGreaterThan(3);
    expect(sawDwell).toBe(true);
    // 打烊後不再生成，場上的人最終走光
    for (let t = 0; t < 120; t += 0.05) sim.update(0.05, shops, 23 * 60, 10, 22);
    expect(sim.agents.filter((a) => a.kind === "customer")).toHaveLength(0);
  });

  it("只會去營業中的店，目的地永遠是有效店面", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const sim = new CrowdSim({ plan, rng: makeRng(7) });
    const shops = shopsOf(f1.lots);
    const bad = new Set(f1.lots.filter((l) => !isShopActive(l.shop)).map((l) => l.slot));
    for (let t = 0; t < 60; t += 0.05) {
      sim.update(0.05, shops, 13 * 60, 10, 22);
      for (const a of sim.agents) if (a.slot !== null) expect(bad.has(a.slot)).toBe(false);
    }
  });

  it("確定性：同一個種子、同樣輸入 → 同樣結果", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const shops = shopsOf(f1.lots);
    const snap = (seed: number) => {
      const sim = new CrowdSim({ plan, rng: makeRng(seed) });
      run(sim, shops, 30);
      return sim.agents.map((a) => [a.id, Math.round(a.x), Math.round(a.y), a.slot]);
    };
    expect(snap(42)).toEqual(snap(42));
  });

  it("人數有上限", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const sim = new CrowdSim({ plan, rng: makeRng(3), maxAgents: 10 });
    run(sim, shopsOf(f1.lots), 90);
    expect(sim.agents.length).toBeLessThanOrEqual(10);
  });

  it("進店路徑的終點落在該店房間內", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const sim = new CrowdSim({ plan, rng: makeRng(11) });
    run(sim, shopsOf(f1.lots), 20);
    for (const a of sim.agents.filter((x) => x.slot !== null && x.phase === "walk" && x.back.length > 0)) {
      const room = roomOfSlot(plan, a.slot!)!;
      const end = a.path[a.path.length - 1]!;
      expect(end.x).toBeGreaterThanOrEqual(room.x * TILE);
      expect(end.x).toBeLessThanOrEqual((room.x + room.w) * TILE);
      expect(end.y).toBeGreaterThanOrEqual(room.y * TILE);
      expect(end.y).toBeLessThanOrEqual((room.y + room.h) * TILE);
    }
  });

  it("非地面層：客人只從電扶梯或電梯出現，不會從走道兩端的牆走出來", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot));
    const sim = new CrowdSim({ plan, rng: makeRng(9) });
    const shops = shopsOf(f1.lots);
    const spawnPts = plan.entrances.map((e) => e.from!);
    const seen = new Set<number>();
    for (let t = 0; t < 120; t += 0.05) {
      const before = new Set(sim.agents.map((a) => a.id));
      sim.update(0.05, shops, 13 * 60, 10, 22);
      for (const a of sim.agents) {
        if (before.has(a.id) || a.kind !== "customer" || seen.has(a.id)) continue;
        seen.add(a.id);
        // 剛出現的位置（走了不到一個 tick 的距離內）要在某個入口的出現點上
        expect(spawnPts.some((p) => Math.hypot(a.x - p.x * TILE, a.y - p.y * TILE) < 3), `agent ${a.id} @ ${a.x},${a.y}`).toBe(true);
        // 走道兩端（街道門的位置）不會有人冒出來；電梯廳在側廊內側，所以只排除最外 1 格
        expect(a.x).toBeGreaterThan(TILE);
        expect(a.x).toBeLessThan((plan.width - 1) * TILE);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("清潔員：開關可切換，不佔用人數上限邏輯", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const sim = new CrowdSim({ plan, rng: makeRng(5) });
    sim.ensureCleaner(true);
    expect(sim.agents.filter((a) => a.kind === "cleaner")).toHaveLength(1);
    sim.ensureCleaner(true);
    expect(sim.agents.filter((a) => a.kind === "cleaner")).toHaveLength(1);
    sim.ensureCleaner(false);
    expect(sim.agents.filter((a) => a.kind === "cleaner")).toHaveLength(0);
  });
});

describe("清潔員人數", () => {
  const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });

  it("可以同時有好幾位，從走道兩端交錯出發、行走線錯開；減少時從最後一位開始撤", () => {
    const sim = new CrowdSim({ plan, rng: makeRng(5) });
    sim.ensureCleaners(3);
    const cs = sim.agents.filter((a) => a.kind === "cleaner");
    expect(cs).toHaveLength(3);
    expect(new Set(cs.map((c) => Math.round(c.y))).size).toBe(3); // 不會疊在同一條線上
    expect(cs[0]!.x).not.toBe(cs[1]!.x); // 兩端交錯
    sim.ensureCleaners(1);
    expect(sim.agents.filter((a) => a.kind === "cleaner")).toHaveLength(1);
    sim.ensureCleaners(0);
    expect(sim.agents.filter((a) => a.kind === "cleaner")).toHaveLength(0);
  });

  it("人數不變時不重複生成；跑一陣子後還是同樣人數，而且一直在主走道上來回走", () => {
    const sim = new CrowdSim({ plan, rng: makeRng(5) });
    const lane = plan.corridors[plan.mainCorridor]!.laneY * TILE;
    for (let t = 0; t < 60; t += 0.05) {
      sim.ensureCleaners(2);
      sim.update(0.05, new Map(), 13 * 60, 10, 22);
    }
    const cs = sim.agents.filter((a) => a.kind === "cleaner");
    expect(cs).toHaveLength(2);
    for (const c of cs) expect(Math.abs(c.y - lane)).toBeLessThan(20);
  });
});

describe("天氣對人潮的影響", () => {
  const rain: Weather = { kind: "rain", temp: 19 };
  const clear: Weather = { kind: "clear", temp: 24 };
  const storm: Weather = { kind: "storm", temp: 24 };

  const count = (w: Weather, ground: boolean) => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground });
    const sim = new CrowdSim({ plan, rng: makeRng(21), maxAgents: 500 });
    sim.setWeather(w);
    const seen = new Set<number>();
    const umbrellas = new Set<number>();
    const shops = shopsOf(f1.lots);
    for (let t = 0; t < 240; t += 0.05) {
      sim.update(0.05, shops, 13 * 60, 10, 22);
      for (const a of sim.agents) {
        if (a.kind !== "customer" || seen.has(a.id)) continue;
        seen.add(a.id);
        if (a.umbrella) umbrellas.add(a.id);
      }
    }
    return { spawned: seen.size, umbrellas: umbrellas.size };
  };

  it("雨天人變少、颱風天更少（與伺服器的客流係數一致）", () => {
    const c = count(clear, true).spawned;
    const r = count(rain, true).spawned;
    const s = count(storm, true).spawned;
    expect(r).toBeLessThan(c);
    expect(s).toBeLessThan(r * 0.7);
  });

  it("下雨天從街門進來的人撐傘；沒有街門的樓層沒有人撐傘；晴天沒有", () => {
    expect(count(rain, true).umbrellas).toBeGreaterThan(0);
    expect(count(rain, false).umbrellas).toBe(0);
    expect(count(clear, true).umbrellas).toBe(0);
  });

  it("走進館內就收傘", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const sim = new CrowdSim({ plan, rng: makeRng(5) });
    sim.setWeather(rain);
    const shops = shopsOf(f1.lots);
    let opened = 0;
    let closed = 0;
    for (let t = 0; t < 90; t += 0.05) {
      sim.update(0.05, shops, 13 * 60, 10, 22);
      for (const a of sim.agents) {
        if (a.kind !== "customer") continue;
        const away = Math.abs(a.x - a.originX);
        if (a.umbrella) {
          opened++;
          expect(away).toBeLessThanOrEqual(UMBRELLA_RANGE + 4);
        } else if (away > UMBRELLA_RANGE + 40) closed++;
      }
    }
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(0);
  });
});
