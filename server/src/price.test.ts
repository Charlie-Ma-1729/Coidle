// 售價不設限：只要是 ¥1 以上的整數就接受；真正的煞車是客人嫌貴（PRICE_TOLERANCE）。
import { describe, expect, it } from "vitest";
import { CATEGORY_BY_ID, PRICE_HARD_MAX } from "@coidle/shared";
import { applyCommand } from "./sim/commands";
import { createInitialState } from "./sim/state";

describe("setPrice", () => {
  const price = (cmdPrice: number) => {
    const s = createInitialState(1, 0, 0);
    const shop = s.shops.find((x) => x.category === "grocery")!;
    const r = applyCommand(s, { type: "setPrice", shopId: shop.id, price: cmdPrice });
    if (!r.ok) throw new Error(r.error);
    return r.state.shops.find((x) => x.id === shop.id)!.price;
  };

  it("accepts prices far beyond the old 2.5x cap", () => {
    const ref = CATEGORY_BY_ID.grocery!.refPrice;
    expect(price(ref * 2.5 + 1)).toBe(ref * 2.5 + 1);
    expect(price(ref * 50)).toBe(ref * 50);
  });

  it("accepts prices below half the reference, but never below ¥1", () => {
    expect(price(100)).toBe(100);
    expect(price(0)).toBe(1);
    expect(price(-5)).toBe(1);
  });

  it("still keeps a technical ceiling and rejects non-numbers", () => {
    expect(price(1e15)).toBe(PRICE_HARD_MAX);
    const s = createInitialState(1, 0, 0);
    expect(applyCommand(s, { type: "setPrice", shopId: s.shops[0]!.id, price: Number.NaN }).ok).toBe(false);
  });
});
