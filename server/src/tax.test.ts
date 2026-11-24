import { describe, expect, it } from "vitest";
import {
  BONUS_FACTOR,
  CATEGORY_BY_ID,
  EMPLOYER_SOCIAL_RATE,
  LICENSES,
  SUPPLIERS,
  TICKS_PER_DAY,
  assessedValue,
  billOutstanding,
  consumptionRate,
  corporateTax,
  invoiceCreditRate,
  laborCostFactor,
  licenseOf,
  purchaseRate,
  supplierCreditRate,
  taxPortion,
  PROPERTY_TAX_RATE,
  type MallState,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command } from "./sim";
import { dailyWages, settleBills } from "./sim/tax";
import { timeInfo } from "./sim/time";

// 遊戲日曆：2027-04-01 00:00（會計年度的第一天）
const APR1 = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const day = (n: number) => APR1 + n * TICKS_PER_DAY;
const apply = (s: MallState, c: Command): MallState => {
  const r = applyCommand(s, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const mk = (seed = 7) => createInitialState(seed, APR1, 0);
const sum = (s: MallState, k: "social" | "property" | "bonus" | "consumption" | "corporate") => s.tax.bills.filter((b) => b.kind === k);
const paidOf = (s: MallState, k: string) => s.tax.history.filter((h) => h.kind === k).reduce((a, h) => a + h.amount, 0);

describe("tax math (Japan, simplified)", () => {
  it("consumption tax: 8% reduced for take-out food, 10% otherwise, exempt for insured medical and licensed daycare", () => {
    expect(consumptionRate("grocery")).toBe(0.08);
    expect(consumptionRate("bubble_tea")).toBe(0.08);
    expect(consumptionRate("ramen")).toBe(0.1); // 店內用餐
    expect(consumptionRate("fashion")).toBe(0.1);
    expect(consumptionRate("clinic")).toBe(0);
    expect(taxPortion(1100, 0.1)).toBeCloseTo(100, 6);
    expect(taxPortion(1080, 0.08)).toBeCloseTo(80, 6);
    expect(taxPortion(500, 0)).toBe(0);
    expect(purchaseRate("meat")).toBe(0.08);
    expect(purchaseRate("goods")).toBe(0.1);
  });

  it("invoice system transitional credit follows the (revised) schedule by date", () => {
    expect(invoiceCreditRate("2025-01-01")).toBe(0.8);
    expect(invoiceCreditRate("2027-04-01")).toBe(0.7);
    expect(invoiceCreditRate("2028-10-01")).toBe(0.5);
    expect(invoiceCreditRate("2031-04-01")).toBe(0.3);
    expect(invoiceCreditRate("2032-01-01")).toBe(0);
    const small = SUPPLIERS.find((x) => x.invoice === false)!;
    const reg = SUPPLIERS.find((x) => x.invoice === undefined)!;
    expect(supplierCreditRate(small, "2027-04-01")).toBe(0.7);
    expect(supplierCreditRate(reg, "2027-04-01")).toBe(1);
  });

  it("corporate tax: SME 15% up to ¥8M then 23.2%, plus local taxes, business tax, defense tax and the per-capita levy", () => {
    const small = corporateTax(8_000_000);
    expect(small.national).toBe(1_200_000);
    expect(small.defense).toBe(0); // 法人稅額 120 萬 < 500 萬
    expect(small.business).toBe(4_000_000 * 0.035 + 4_000_000 * 0.053);
    const big = corporateTax(100_000_000);
    expect(big.national).toBe(Math.round(1_200_000 + 92_000_000 * 0.232));
    expect(big.defense).toBe(Math.round((big.national - 5_000_000) * 0.04));
    expect(big.effective).toBeGreaterThan(0.3);
    expect(big.effective).toBeLessThan(0.42);
    expect(corporateTax(-5_000_000).total).toBe(180_000); // 虧損也要繳均等割
    expect(corporateTax(0).national).toBe(0);
  });

  it("labor law: night work (after 22:00) and shifts beyond 14 hours cost 25% more", () => {
    expect(laborCostFactor(10, 22)).toBe(1);
    expect(laborCostFactor(9, 23)).toBeCloseTo(1 + (0.25 * 1) / 14, 6);
    expect(laborCostFactor(8, 24)).toBeGreaterThan(laborCostFactor(10, 22));
    expect(laborCostFactor(6, 24)).toBeGreaterThan(laborCostFactor(8, 24));
  });

  it("licenses: every license is attached to a real category", () => {
    for (const c of Object.keys(LICENSES)) expect(CATEGORY_BY_ID[c], c).toBeDefined();
    expect(licenseOf("ramen")?.law).toContain("食品衛生法");
    expect(licenseOf("arcade_vr")?.law).toContain("風營法");
    expect(licenseOf("fashion")).toBeNull();
  });
});

describe("bills on the calendar", () => {
  it("does nothing scary on day one; first monthly bills appear on the 1st of next month", () => {
    const s = advanceTo(mk(), day(5));
    expect(s.tax.bills).toEqual([]);
    const m = advanceTo(mk(), day(31));
    const social = sum(m, "social").concat(m.tax.history.filter((h) => h.kind === "social") as never);
    expect(social.length).toBeGreaterThan(0);
  });

  it("social insurance equals the employer rate on last month's payroll and is auto-paid", () => {
    let s = advanceTo(mk(), day(30) + 5); // 剛過 5/1 之前：已到 5 月 1 日
    expect(timeInfo(s.tick).date).toBe("2027-05-01");
    const bill = sum(s, "social")[0] ?? null;
    const paid = paidOf(s, "social");
    const wages = dailyWages(s) * 30;
    expect(bill ? bill.amount : paid).toBeCloseTo(wages * EMPLOYER_SOCIAL_RATE, -3);
    s = advanceTo(s, day(30) + 25 * TICKS_PER_DAY + 10);
    expect(sum(s, "social")).toEqual([]); // 到期已自動扣款
    expect(paidOf(s, "social")).toBeGreaterThan(0);
  });

  it("quarterly consumption tax = output tax − input tax, settled at the start of the next quarter", () => {
    const s = advanceTo(mk(), day(91) + 30); // 7/1
    expect(timeInfo(s.tick).date.startsWith("2027-07-0")).toBe(true);
    const due = sum(s, "consumption")[0];
    expect(due).toBeDefined();
    const gross = s.totalRevenue;
    expect(due!.amount).toBeGreaterThan(gross * 0.03);
    expect(due!.amount).toBeLessThan(gross * 0.1); // 進項扣抵後，一定比銷項少
  });

  it("property tax comes in June, September, December and February (a quarter each)", () => {
    let s = mk();
    const seen: number[] = [];
    for (let d = 1; d <= 340; d++) {
      s = advanceTo(s, day(d) + 20);
      const t = timeInfo(s.tick);
      if (t.date.endsWith("-01") && s.tax.bills.some((b) => b.kind === "property" && b.createdTick > s.tick - 2 * TICKS_PER_DAY)) seen.push(t.month);
    }
    expect(seen).toEqual([6, 9, 12, 2]);
    const b = assessedValue(s) * PROPERTY_TAX_RATE;
    expect(b).toBeGreaterThan(25_000_000);
  });

  it("bonus in June and December costs about 0.4 months of payroll plus insurance", () => {
    const s = advanceTo(mk(), day(61) + 30); // 6/1
    expect(timeInfo(s.tick).date).toBe("2027-06-01");
    const bonus = sum(s, "bonus")[0]!;
    expect(bonus.amount).toBeCloseTo(dailyWages(s) * 31 * BONUS_FACTOR * (1 + EMPLOYER_SOCIAL_RATE), -4);
  });

  it("year-end closing: corporate tax is billed in April, interim in October, and losses carry forward", () => {
    let s = mk();
    s = advanceTo(s, day(183) + 30); // 10/1
    expect(timeInfo(s.tick).date).toBe("2027-10-01");
    expect(s.tax.fy.profit).toBeGreaterThan(0);
    s = advanceTo(s, day(366) + 30); // 次年 4/1
    expect(timeInfo(s.tick).date).toBe("2028-04-01");
    expect(s.tax.lastYearCorporate).toBeGreaterThan(1_000_000);
    expect(s.log.some((l) => l.text.includes("年度決算"))).toBe(true);
    expect(s.tax.fy.profit).toBeLessThan(5_000_000); // 新年度重新累積
  });

  it("a loss year pays only the levy, and the loss reduces next year's taxable income", () => {
    let s = mk();
    s.tax.fy.profit = -1e12;
    s = advanceTo(s, day(366) + 30);
    expect(s.tax.lossCarry).toBeGreaterThan(0);
  });
});

describe("paying", () => {
  it("not enough cash: pays what it can, charges a late fee each day, and drags compliance down; paying later clears it", () => {
    let s = mk();
    s.tax.bills.push({ uid: "tx900", kind: "property", label: "測試帳單", amount: 10_000_000, createdTick: s.tick, dueTick: s.tick, paid: 0, lateFee: 0 });
    s.funds = 3_000_000;
    settleBills(s);
    expect(s.funds).toBe(0);
    expect(billOutstanding(s.tax.bills[0]!)).toBe(7_000_000);
    const comp = s.inspections.compliance;
    s.tick += TICKS_PER_DAY + 1;
    settleBills(s);
    expect(s.tax.bills[0]!.lateFee).toBeGreaterThan(0);
    expect(s.inspections.compliance).toBeLessThan(comp);
    s.funds = 20_000_000;
    s.tick += TICKS_PER_DAY * 3;
    settleBills(s);
    expect(s.tax.bills).toEqual([]);
    expect(s.tax.history[0]!.late).toBe(true);
    expect(s.funds).toBeLessThan(20_000_000 - 7_000_000);
  });

  it("negative cash never goes further negative from tax payments", () => {
    const s = mk();
    s.funds = -500_000;
    s.tax.bills.push({ uid: "tx901", kind: "social", label: "測試", amount: 1_000_000, createdTick: s.tick, dueTick: s.tick, paid: 0, lateFee: 0 });
    settleBills(s);
    expect(s.funds).toBe(-500_000);
  });

  it("a consumption-tax refund (input > output) pays the mall", () => {
    let s = mk();
    s.tax.quarter = { outputTax: 0, inputTax: 1e9 };
    const before = s.funds;
    s = advanceTo(s, day(91) + 30);
    expect(s.tax.history.some((h) => h.kind === "consumption" && h.amount < 0)).toBe(true);
    expect(s.funds).toBeGreaterThan(before - 100_000_000);
  });
});

describe("licenses on opening a shop", () => {
  it("costs the license fee on top of the build cost and takes longer", () => {
    const s = mk();
    s.level = 5;
    const bar = CATEGORY_BY_ID["izakaya"]!;
    const slot = s.slots.find((x) => x.zone === "dining")!;
    s.flags["zone:dining"] = true;
    const lic = licenseOf("izakaya")!;
    const r = apply(s, { type: "buildShop", slot: slot.id, category: "izakaya" });
    expect(s.funds - r.funds).toBe(bar.buildCost + lic.fee);
    expect(r.builds[0]!.completeTick - s.tick).toBe(bar.buildTicks + lic.extraTicks);
    // 沒有許認可的業態維持原價
    const f1 = s.slots.find((x) => x.zone === "f1")!;
    s.flags["zone:f1"] = true;
    const r2 = apply(s, { type: "buildShop", slot: f1.id, category: "fashion" });
    expect(s.funds - r2.funds).toBe(CATEGORY_BY_ID["fashion"]!.buildCost);
  });
});

describe("determinism and migration", () => {
  it("catch-up equals tick-by-tick across a month boundary", () => {
    const a = advanceTo(mk(3), day(32));
    let b = mk(3);
    for (let i = 0; i < 32 * 6; i++) b = advanceTo(b, b.tick + 48);
    expect(b.tax).toEqual(a.tax);
    expect(b.funds).toBeCloseTo(a.funds, 2);
  });

  it("migrates v7 to v8 with an empty tax ledger", () => {
    const v7 = JSON.parse(JSON.stringify(mk())) as Record<string, unknown> & { today: Record<string, unknown> };
    v7.version = 7;
    delete v7.tax;
    delete v7.today.outTax;
    const m = migrateState(v7, 0);
    expect(m.version).toBe(8);
    expect(m.tax.bills).toEqual([]);
    expect(m.today.outTax).toBe(0);
  });
});
