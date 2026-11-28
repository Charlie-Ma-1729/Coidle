import { describe, expect, it } from "vitest";
import { CATEGORY_BY_ID } from "./data";
import type { FinanceState } from "./finance";
import type { DailyReport, Shop } from "./types";
import {
  PRICE_DAILY_BAND,
  PROFIT_MULTIPLE_DAYS,
  PROFIT_WINDOW_DAYS,
  clampToAnchor,
  fixedAssetValue,
  inventoryValue,
  mallBookValue,
  netAssets,
  profitValue,
  type ValuationInput,
} from "./valuation";

const cat = Object.values(CATEGORY_BY_ID).find((c) => !c.facility)!;

const shop = (over: Partial<Shop> = {}): Shop => ({ id: "s1", category: cat.id, level: 1, mode: "direct", stock: 0, incoming: [], ...over }) as unknown as Shop;
const report = (profit: number): DailyReport => ({ profit }) as unknown as DailyReport;
const loan = (outstanding: number) => ({ loans: [{ outstanding }] }) as unknown as FinanceState;
const input = (over: Partial<ValuationInput> = {}): ValuationInput => ({ funds: 0, shops: [], reports: [], equipment: 100, ...over });

describe("net assets", () => {
  it("is just cash when there is nothing else", () => {
    expect(netAssets(input({ funds: 1_000_000 }))).toBe(1_000_000);
    expect(mallBookValue(input({ funds: 1_000_000 }))).toBe(1_000_000);
  });

  it("counts inventory (including incoming) at purchase cost, but not leased shops", () => {
    const unit = cat.refPrice * cat.costRatio;
    expect(inventoryValue({ shops: [shop({ stock: 10, incoming: [{ arriveTick: 1, qty: 5 }] })] })).toBeCloseTo(15 * unit);
    expect(inventoryValue({ shops: [shop({ stock: 10, mode: "lease" })] })).toBe(0);
  });

  it("depreciates shops by equipment condition", () => {
    const worn = fixedAssetValue({ shops: [shop({ level: 2 })], equipment: 0 });
    const fresh = fixedAssetValue({ shops: [shop({ level: 2 })], equipment: 100 });
    expect(worn).toBeCloseTo(cat.buildCost * 2 * 0.4);
    expect(fresh).toBeCloseTo(cat.buildCost * 2 * 0.8);
  });

  it("subtracts loans, and never reports a negative value", () => {
    expect(netAssets(input({ funds: 1_000_000, finance: loan(400_000) }))).toBe(600_000);
    expect(netAssets(input({ funds: 100_000, finance: loan(400_000) }))).toBe(-300_000);
    expect(mallBookValue(input({ funds: 100_000, finance: loan(400_000) }))).toBe(0);
  });

  it("borrowing cash does not raise the value", () => {
    const base = mallBookValue(input({ funds: 1_000_000 }));
    const borrowed = mallBookValue(input({ funds: 3_000_000, finance: loan(2_000_000) }));
    expect(borrowed).toBe(base);
  });

  it("spending cash on stock or equipment moves value, it does not destroy it", () => {
    const before = mallBookValue(input({ funds: 1_000_000, shops: [shop()] }));
    const unit = cat.refPrice * cat.costRatio;
    const after = mallBookValue(input({ funds: 1_000_000 - unit * 100, shops: [shop({ stock: 100 })] }));
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });
});

describe("profit premium", () => {
  it("is zero with no reports, and ignores losses", () => {
    expect(profitValue({ reports: [] })).toBe(0);
    expect(profitValue({ reports: [report(-50_000), report(-10_000)] })).toBe(0);
  });

  it("averages only the last few days", () => {
    const reports = [report(1_000_000_000), ...Array.from({ length: PROFIT_WINDOW_DAYS }, () => report(10_000))];
    expect(profitValue({ reports })).toBe(10_000 * PROFIT_MULTIPLE_DAYS);
  });

  it("ramps up over the first days instead of jumping on one report", () => {
    expect(profitValue({ reports: [report(60_000)] })).toBe((60_000 / PROFIT_WINDOW_DAYS) * PROFIT_MULTIPLE_DAYS);
  });

  it("adds half of the excess over net assets, capped at 100% of net assets", () => {
    const funds = 1_000_000;
    const six = (p: number) => Array.from({ length: PROFIT_WINDOW_DAYS }, () => report(p));
    const modest = mallBookValue(input({ funds, reports: six(40_000) })); // 獲利價值 120 萬
    expect(modest).toBe(funds + Math.round((40_000 * PROFIT_MULTIPLE_DAYS - funds) * 0.5));
    const huge = mallBookValue(input({ funds, reports: [report(50_000_000_000)] }));
    expect(huge).toBe(funds * 2);
  });

  it("never drops below net assets because of weak profit", () => {
    expect(mallBookValue(input({ funds: 1_000_000, reports: [report(-5_000_000)] }))).toBe(1_000_000);
  });
});

describe("daily band", () => {
  it("passes the live value through when there is no anchor", () => {
    expect(clampToAnchor(1_234_567, undefined)).toBe(1_234_567);
    expect(clampToAnchor(1_234_567, 0)).toBe(1_234_567);
  });

  it("limits the move to ±PRICE_DAILY_BAND of the anchor", () => {
    expect(clampToAnchor(2_000_000, 1_000_000)).toBe(Math.round(1_000_000 * (1 + PRICE_DAILY_BAND)));
    expect(clampToAnchor(100_000, 1_000_000)).toBe(Math.round(1_000_000 * (1 - PRICE_DAILY_BAND)));
    expect(clampToAnchor(1_050_000, 1_000_000)).toBe(1_050_000);
  });

  it("stops a one-day cash hoard from jumping the price", () => {
    const anchor = mallBookValue(input({ funds: 1_000_000 }));
    const hoarded = mallBookValue(input({ funds: 5_000_000 }));
    expect(clampToAnchor(hoarded, anchor)).toBe(Math.round(anchor * 1.1));
  });
});
