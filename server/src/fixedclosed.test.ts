import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY, fixedCostBreakdown } from "@coidle/shared";
import { advanceFully, createInitialState } from "./sim";

// 2027-04-01 00:00 JST
const APR1 = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;

describe("打烊時段的固定成本", () => {
  it("整天均攤：只記打烊時段花掉的那一份，約等於 打烊小時數／24", () => {
    const s0 = createInitialState(11, APR1, 0);
    s0.hours = { open: 10, close: 22 };
    const s = advanceFully(s0, APR1 + TICKS_PER_DAY - 1);
    const fixed = s.today.fixed;
    const closed = s.today.fixedClosed ?? 0;
    expect(fixed).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(0);
    expect(closed).toBeLessThan(fixed);
    // 沒有雨天加派清潔時剛好是 12/24；有的話營業時段多一點，所以只抓大概
    expect(closed / fixed).toBeGreaterThan(0.4);
    expect(closed / fixed).toBeLessThan(0.55);
    // 與畫面上的說明一致：每天總固定成本 ≈ 明細合計
    const b = fixedCostBreakdown(s);
    expect(fixed).toBeGreaterThanOrEqual(b.perDay * 0.95);
  });

  it("整天營業就沒有打烊時段的固定成本", () => {
    const s0 = createInitialState(11, APR1, 0);
    s0.hours = { open: 0, close: 24 };
    const s = advanceFully(s0, APR1 + TICKS_PER_DAY - 1);
    expect(s.today.fixedClosed ?? 0).toBe(0);
  });
});
