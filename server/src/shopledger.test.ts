import { describe, expect, it } from "vitest";
import { CATEGORY_BY_ID, mallBreakdown, shopLedger, type MallState } from "@coidle/shared";
import { createInitialState } from "./sim";
import { makeShop } from "./sim/state";

// 2027-04-01 12:00 JST
const NOON = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000 + 144;
const mk = (): MallState => {
  const s = createInitialState(3, NOON, 0);
  s.hours = { open: 10, close: 22 };
  return s;
};

describe("shopLedger：誰賺、誰賠、為什麼", () => {
  it("營收蓋過成本和薪資＝賺，只留毛利說明", () => {
    const s = mk();
    const shop = makeShop(s, "ramen", "A 拉麵", 0);
    shop.day.revenue = 200_000;
    shop.day.units = 200;
    shop.day.cost = 66_000;
    const l = shopLedger(s, shop, 0.5);
    expect(l.verdict).toBe("profit");
    expect(l.net).toBeCloseTo(200_000 - 66_000 - l.wage, 6);
    expect(l.reasons.every((r) => r.tone === "info")).toBe(true);
  });

  it("標價低於成本、缺貨、嫌太貴，都會列為賠錢原因", () => {
    const s = mk();
    const cat = CATEGORY_BY_ID.ramen!;
    const shop = makeShop(s, "ramen", "B 拉麵", 1);
    shop.price = Math.floor(cat.refPrice * cat.costRatio) - 10;
    shop.day.stockouts = 4;
    shop.day.priceWalks = 5;
    const l = shopLedger(s, shop, 0.5);
    expect(l.verdict).toBe("loss");
    const text = l.reasons.map((r) => r.text).join("\n");
    expect(text).toContain("低於每份成本");
    expect(text).toContain("缺貨 4 次");
    expect(text).toContain("嫌太貴");
    expect(l.reasons.length).toBeLessThanOrEqual(4);
  });

  it("開門前沒營收的店：說明是薪資整天均攤，不是店有問題", () => {
    const s = mk();
    const shop = makeShop(s, "ramen", "C 拉麵", 2);
    const l = shopLedger(s, shop, 6 / 24);
    expect(l.verdict).toBe("loss");
    expect(l.wage).toBeGreaterThan(0);
    expect(l.reasons[0]!.text).toContain("還沒開門");
  });

  it("每份有賺但客人少：說明是薪資攤不平", () => {
    const s = mk();
    const shop = makeShop(s, "ramen", "D 拉麵", 3);
    shop.day.revenue = 5_000;
    shop.day.cost = 1_500;
    shop.day.units = 5;
    const l = shopLedger(s, shop, 0.6);
    expect(l.verdict).toBe("loss");
    expect(l.reasons.map((r) => r.text).join("")).toContain("攤不平");
  });

  it("出租店：只有抽成，沒有成本與薪資", () => {
    const s = mk();
    const shop = makeShop(s, "ramen", "E 租戶", 4);
    shop.mode = "lease";
    shop.commission = 0.1;
    shop.rent = 30_000;
    shop.day.revenue = 100_000;
    const l = shopLedger(s, shop, 0.5);
    expect(l.net).toBeCloseTo(10_000, 6);
    expect(l.wage).toBe(0);
    expect(l.verdict).toBe("profit");
  });
});

describe("mallBreakdown：各店損益 − 共用成本 − 其他支出 ＝ 營運損益", () => {
  it("加起來剛好等於營運損益，賺最多的排前面", () => {
    const s = mk();
    const a = makeShop(s, "ramen", "A", 0);
    const b = makeShop(s, "ramen", "B", 1);
    a.day.revenue = 300_000;
    a.day.cost = 99_000;
    b.day.revenue = 1_000;
    b.day.cost = 330;
    s.shops = [b, a];
    const d = { revenue: 301_000, rentIncome: 0, purchases: 99_330 + 12_000, fixed: 150_000, repairs: 5_000, stockBought: 99_330, stockCost: 99_330 };
    const m = mallBreakdown(s, d, 0.5);
    expect(m.shops[0]!.name).toBe("A");
    expect(m.shopsNet - m.publicCosts - m.otherCosts).toBeCloseTo(m.operating, 6);
    expect(m.publicCosts).toBeGreaterThan(0);
    expect(m.otherCosts).toBeCloseTo(12_000 + 5_000, 6); // 其他支出 + 維修
  });
});
