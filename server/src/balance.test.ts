import { describe, expect, it } from "vitest";
import { CATEGORY_BY_ID, TICKS_PER_DAY } from "@coidle/shared";
import { advanceTo, applyCommand, type Command } from "./sim";
import { runBot } from "./bots/bots";

// 平衡回歸測試：用機器人玩家跑幾十個遊戲日，確認「不會破產、離線懲罰溫和但有感、暫停不會太頻繁」。
// 數值調整後如果這些條件被打破，就代表經濟被調壞了。

const recentRevenue = (r: ReturnType<typeof runBot>) => {
  const rs = r.final.reports.slice(-14);
  return rs.reduce((a, x) => a + x.revenue, 0) / rs.length;
};
const idx = (r: ReturnType<typeof runBot>) => (r.final.localRep + r.final.touristHeat) / 2;

describe("balance with bot players", () => {
  const seeds = [101, 202];

  it("nobody goes bankrupt by playing normally, even doing nothing at all", () => {
    for (const seed of seeds) {
      for (const kind of ["diligent", "periodic", "lazy"] as const) {
        const r = runBot(kind, seed, 50, { sampleEvery: 50 });
        expect(r.broke, `${kind}/${seed}`).toBe(false);
        expect(r.final.funds, `${kind}/${seed}`).toBeGreaterThan(0);
      }
    }
  }, 600_000);

  it("neglect is mild but noticeable: a tended mall beats an untended one on popularity and income", () => {
    let tendedIdx = 0, lazyIdx = 0, tendedRev = 0, lazyRev = 0;
    for (const seed of seeds) {
      const tended = runBot("tender", seed, 56, { sampleEvery: 100 });
      const lazy = runBot("lazy", seed, 56, { sampleEvery: 100 });
      tendedIdx += idx(tended); lazyIdx += idx(lazy);
      tendedRev += recentRevenue(tended); lazyRev += recentRevenue(lazy);
    }
    expect(tendedIdx - lazyIdx).toBeGreaterThan(2 * seeds.length); // 人氣明顯較高
    expect(tendedRev / lazyRev).toBeGreaterThan(1.03); // 營收較高
    expect(tendedRev / lazyRev).toBeLessThan(1.6); // 但不是天差地別（溫和）
    expect(lazyIdx / seeds.length).toBeGreaterThan(30); // 放著不管也不會崩到底
  }, 600_000);

  it("'pause on important events' stays rare for an absent player (target: at most ~1 per real day)", () => {
    for (const seed of seeds) {
      const r = runBot("lazy", seed, 60, { sampleEvery: 100 });
      expect(r.pauses / 60).toBeLessThan(0.25); // 每遊戲日 0.25 次 ＝ 每真實日 1 次
    }
  }, 600_000);

  it("an active player grows: more shops, levels up, regulars warm up", () => {
    const r = runBot("diligent", 101, 60, { sampleEvery: 100 });
    expect(r.final.shops.length).toBeGreaterThan(8);
    expect(r.final.level).toBeGreaterThanOrEqual(2);
    const met = r.final.regulars.filter((x) => x.met);
    expect(met.length).toBeGreaterThanOrEqual(8);
    expect(met.reduce((a, x) => a + x.affinity, 0) / met.length).toBeGreaterThan(25);
    expect(idx(r)).toBeGreaterThan(50);
  }, 600_000);

  it("a chaotic mall can always be rescued by going back to sane settings", () => {
    const r = runBot("chaotic", 101, 30, { sampleEvery: 100 });
    let s = r.final;
    const run = (c: Command) => {
      const x = applyCommand(s, c);
      if (x.ok) s = x.state;
    };
    run({ type: "setHours", open: 10, close: 22 });
    run({ type: "setCleaning", level: 1 });
    run({ type: "setMaintenance", level: 1 });
    for (const sh of s.shops) {
      run({ type: "setPrice", shopId: sh.id, price: CATEGORY_BY_ID[sh.category]!.refPrice });
      run({ type: "setRestock", shopId: sh.id, rule: { enabled: true } });
      // 帳上資金為負時自動補貨會暫停（避免越買越虧），玩家要手動進一批貨把店撐起來
      if (s.funds <= 0) run({ type: "orderStock", shopId: sh.id, qty: 200 });
    }
    const before = s.funds;
    for (let d = 0; d < 20; d++) s = advanceTo(s, s.tick + TICKS_PER_DAY);
    expect(s.funds).toBeGreaterThan(before);
    expect((s.localRep + s.touristHeat) / 2).toBeGreaterThan(35);
  }, 600_000);
});
