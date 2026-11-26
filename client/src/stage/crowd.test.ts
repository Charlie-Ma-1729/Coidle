import { describe, expect, it } from "vitest";
import type { Weather } from "@coidle/shared";
import { CrowdSim, UMBRELLA_RANGE, WARMUP_SECONDS, hourWeight, isOpenAt, makeRng, spawnRatePerSec, trafficElapsed, trafficShape } from "./crowd";
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

describe("人潮依伺服器的來客曲線", () => {
  const open = f1.lots[0]!.shop!;

  it("trafficShape：營業時段平均為 1，打烊為 0", () => {
    for (const wk of [false, true]) {
      let sum = 0;
      for (let h = 10; h < 22; h++) sum += trafficShape(h * 60 + 30, 10, 22, wk);
      expect(sum / 12).toBeCloseTo(1, 5);
    }
    expect(trafficShape(3 * 60, 10, 22, false)).toBe(0);
    expect(trafficShape(22 * 60, 10, 22, false)).toBe(0);
  });

  it("平日與假日的時段分布不同；午餐、晚餐尖峰高於下午", () => {
    const wd = [10, 12, 15, 19, 21].map((h) => trafficShape(h * 60 + 30, 10, 22, false));
    const we = [10, 12, 15, 19, 21].map((h) => trafficShape(h * 60 + 30, 10, 22, true));
    expect(wd).not.toEqual(we);
    expect(wd[1]!).toBeGreaterThan(wd[2]!);
    expect(wd[3]!).toBeGreaterThan(wd[2]!);
  });

  it("跨午夜的營業時間：累計小時連續不歸零", () => {
    const a = trafficElapsed(23 * 60, 10, 26, false);
    const b = trafficElapsed(60, 10, 26, false); // 凌晨 1:00
    expect(b).toBeGreaterThan(a);
  });

  it("生成率看的是平均來客率，不會因為當天累計成交增加而愈晚愈擠", () => {
    // 同一家店：每遊戲小時成交 10 團，到了 11 點（開店後 1 小時）與 19 點（開店後 9 小時）累計不同，
    // 但比例一樣 → 扣掉曲線形狀後，每平均小時的生成率應該差不多
    const rateAt = (h: number) => {
      const groups = 10 * trafficElapsed(h * 60, 10, 22, false);
      return spawnRatePerSec({ ...open, todayGroups: groups }, h * 60, 10, 22) / trafficShape(h * 60, 10, 22, false);
    };
    expect(rateAt(19) / rateAt(11)).toBeGreaterThan(0.7);
    expect(rateAt(19) / rateAt(11)).toBeLessThan(1.3);
  });

  it("成交愈多人愈多；還沒成交時也有基本人潮（不會一早空蕩蕩）", () => {
    const at = (g: number) => spawnRatePerSec({ ...open, todayGroups: g }, 11 * 60, 10, 22);
    expect(at(0)).toBeGreaterThan(0);
    expect(at(60)).toBeGreaterThan(at(10));
    expect(at(10)).toBeGreaterThan(at(0));
  });

  it("假日用假日的曲線", () => {
    const wd = spawnRatePerSec(open, 15 * 60, 10, 22, false);
    const we = spawnRatePerSec(open, 15 * 60, 10, 22, true);
    expect(we).not.toBeCloseTo(wd, 6);
  });

  it("warmUp：新建的人潮馬上就是穩態人數，不是從 0 開始", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const shops = shopsOf(f1.lots);
    const cold = new CrowdSim({ plan, rng: makeRng(11) });
    expect(cold.agents.filter((a) => a.kind === "customer")).toHaveLength(0);
    cold.warmUp(WARMUP_SECONDS, shops, 13 * 60, 10, 22);
    const warmN = cold.agents.filter((a) => a.kind === "customer").length;
    expect(warmN).toBeGreaterThan(3);
    // 之後再跑一段，人數與熱身後同量級（沒有暴增也沒有歸零）
    const samples: number[] = [];
    for (let t = 0; t < 60; t += 0.2) {
      cold.update(0.2, shops, 13 * 60, 10, 22);
      samples.push(cold.agents.filter((a) => a.kind === "customer").length);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(warmN).toBeGreaterThan(mean * 0.4);
    expect(warmN).toBeLessThan(mean * 2.5);
  });

  it("一般店面的平均在場人數約 1～6 人，且不超過上限", () => {
    const plan = layoutFloor(f1.lots.map((l) => l.slot), { ground: true });
    const shops = shopsOf(f1.lots);
    const active = f1.lots.filter((l) => isShopActive(l.shop)).length;
    const sim = new CrowdSim({ plan, rng: makeRng(5) });
    sim.warmUp(WARMUP_SECONDS, shops, 13 * 60, 10, 22);
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 120; t += 0.2) {
      sim.update(0.2, shops, 13 * 60, 10, 22);
      sum += sim.agents.length;
      n++;
      expect(sim.agents.length).toBeLessThanOrEqual(100);
    }
    const perShop = sum / n / Math.max(1, active);
    expect(perShop).toBeGreaterThan(0.8);
    expect(perShop).toBeLessThan(6);
  });
});
