import { describe, expect, it } from "vitest";
import { dayLedger, fixedCostBreakdown } from "./ledger";

describe("dayLedger", () => {
  it("進貨不算當天虧損：營運損益只扣賣出商品的成本", () => {
    const l = dayLedger({ revenue: 10_000, rentIncome: 1_000, purchases: 9_000, stockBought: 8_000, stockCost: 3_000, fixed: 2_000, repairs: 0 });
    expect(l.cash).toBe(0);
    expect(l.operating).toBe(5_000);
    expect(l.otherCosts).toBe(1_000);
    expect(l.stockChange).toBe(5_000);
    // 現金變化 = 營運損益 − 庫存變化
    expect(l.cash).toBe(l.operating - l.stockChange);
  });

  it("舊資料沒有進貨欄位時，等於原本的算式", () => {
    const l = dayLedger({ revenue: 500, rentIncome: 0, purchases: 200, fixed: 100, repairs: 50 });
    expect(l.operating).toBe(150);
    expect(l.cash).toBe(150);
  });
});

describe("fixedCostBreakdown", () => {
  const base = { shops: [], hours: { open: 10, close: 22 }, tech: { done: [] }, cleaningLevel: 1, maintenanceLevel: 1, regulars: [] } as never;

  it("每天合計＝水電＋清潔維護＋薪資＋專屬座位；整天均攤到每小時", () => {
    const f = fixedCostBreakdown(base);
    expect(f.perDay).toBeCloseTo(f.utilities + f.upkeep + f.wages + f.reserved, 6);
    expect(f.utilities).toBeGreaterThan(0);
    expect(f.perHour * 24).toBeCloseTo(f.perDay, 6);
  });

  it("打烊時段＝24 − 營業小時數；整天營業就沒有打烊時段", () => {
    const f = fixedCostBreakdown(base);
    expect(f.closedHours).toBe(12);
    expect(f.closedPerDay).toBeCloseTo(f.perDay / 2, 6);
    expect(fixedCostBreakdown({ ...(base as object), hours: { open: 0, close: 24 } } as never).closedHours).toBe(0);
  });
});

describe("dayLedger.fixedClosed", () => {
  it("帶出打烊時段花的固定成本，且不會超過全部固定成本", () => {
    expect(dayLedger({ revenue: 0, rentIncome: 0, purchases: 0, fixed: 1_000, repairs: 0, fixedClosed: 400 }).fixedClosed).toBe(400);
    expect(dayLedger({ revenue: 0, rentIncome: 0, purchases: 0, fixed: 100, repairs: 0, fixedClosed: 400 }).fixedClosed).toBe(100);
    expect(dayLedger({ revenue: 0, rentIncome: 0, purchases: 0, fixed: 100, repairs: 0 }).fixedClosed).toBe(0);
  });
});
