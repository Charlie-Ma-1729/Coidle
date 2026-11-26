import { describe, expect, it } from "vitest";
import {
  ANTITRUST_BLOCK_SHARE,
  ANTITRUST_REVIEW_SHARE,
  CORPORATE_FEE_RATE,
  FINANCE_MAX_LAG_TICKS,
  financeBlocker,
  HOLDING_TIERS,
  HOLDING_TIER_INFO,
  antitrustVerdict,
  canSqueezeOut,
  corporateCap,
  corporateCost,
  disclosureCrossing,
  disclosureRequired,
  holdingTier,
  holdingTierOf,
  isTenderTerminal,
  nextTenderState,
  tenderEventsFrom,
  type TenderEvent,
  type TenderState,
} from "./ma";
import { CONTROL_PCT, RELATED_STAKE_PCT, isBigStake, isControlling } from "./equity";
import { TICKS_PER_DAY } from "./data";
import { INTERACT_MAX_LAG_TICKS, interactBlocker } from "./coop";
import { MARKET_FEE_RATE } from "./market";

describe("holding tiers", () => {
  it("tier table is ascending and starts at none", () => {
    expect(HOLDING_TIER_INFO.map((t) => t.tier)).toEqual([...HOLDING_TIERS]);
    for (let i = 1; i < HOLDING_TIER_INFO.length; i++) expect(HOLDING_TIER_INFO[i]!.at).toBeGreaterThan(HOLDING_TIER_INFO[i - 1]!.at);
  });

  it("boundaries: 5% needs to be exceeded, the others are reached", () => {
    expect(holdingTier(0)).toBe("none");
    expect(holdingTier(0.05)).toBe("none");
    expect(holdingTier(0.0501)).toBe("disclosed");
    expect(holdingTier(0.0999)).toBe("disclosed");
    expect(holdingTier(0.1)).toBe("cap");
    expect(holdingTier(0.1999)).toBe("cap");
    expect(holdingTier(0.2)).toBe("related");
    expect(holdingTier(0.333)).toBe("related");
    expect(holdingTier(0.334)).toBe("veto");
    expect(holdingTier(0.5)).toBe("veto");
    expect(holdingTier(0.5001)).toBe("controlling");
    expect(holdingTier(0.666)).toBe("controlling");
    expect(holdingTier(0.667)).toBe("special");
    expect(holdingTier(0.8999)).toBe("special");
    expect(holdingTier(0.9)).toBe("squeeze");
    expect(holdingTier(1)).toBe("squeeze");
  });

  it("clamps out-of-range and non-finite input", () => {
    expect(holdingTier(-1)).toBe("none");
    expect(holdingTier(Number.NaN)).toBe("none");
    expect(holdingTier(7)).toBe("squeeze");
  });

  it("integer version agrees with equity.ts predicates", () => {
    const total = 10_000;
    for (const shares of [0, 1, 500, 501, 999, 1000, 1999, 2000, 3339, 3340, 4999, 5000, 5001, 6669, 6670, 8999, 9000, 10_000]) {
      const tier = holdingTierOf(shares, total);
      const idx = HOLDING_TIERS.indexOf(tier);
      expect(idx >= HOLDING_TIERS.indexOf("related"), `related @${shares}`).toBe(isBigStake(shares, total));
      expect(idx >= HOLDING_TIERS.indexOf("controlling"), `controlling @${shares}`).toBe(isControlling(shares, total));
    }
    expect(holdingTierOf(500, 10_000)).toBe("none");
    expect(holdingTierOf(501, 10_000)).toBe("disclosed");
    expect(holdingTierOf(3340, 10_000)).toBe("veto");
    expect(holdingTierOf(3339, 10_000)).toBe("related");
    expect(holdingTierOf(5, 0)).toBe("none");
  });

  it("constants stay in line with equity.ts", () => {
    expect(RELATED_STAKE_PCT).toBe(0.2);
    expect(CONTROL_PCT).toBe(0.5);
    expect(CORPORATE_FEE_RATE).toBe(MARKET_FEE_RATE);
  });

  it("disclosure and its crossings", () => {
    expect(disclosureRequired(0.05)).toBe(false);
    expect(disclosureRequired(0.06)).toBe(true);
    expect(disclosureCrossing(500, 501, 10_000)).toBe("up");
    expect(disclosureCrossing(600, 900, 10_000)).toBeNull();
    expect(disclosureCrossing(600, 500, 10_000)).toBe("down");
    expect(disclosureCrossing(0, 100, 10_000)).toBeNull();
  });

  it("squeeze-out needs 90%", () => {
    expect(canSqueezeOut(8999, 10_000)).toBe(false);
    expect(canSqueezeOut(9000, 10_000)).toBe(true);
  });
});

describe("corporateCap", () => {
  const base = { outstanding: 1_000_000, held: 0, price: 1000, mallCash: 100_000_000, portfolioValue: 0 };

  it("single-stock cap is 10% of outstanding, minus what is already held", () => {
    const r = corporateCap({ ...base, mallCash: 10_000_000_000 });
    expect(r.byStock).toBe(100_000);
    expect(r.maxShares).toBe(100_000);
    expect(r.binding).toBe("stock");
    expect(corporateCap({ ...base, mallCash: 10_000_000_000, held: 40_000 }).maxShares).toBe(60_000);
    expect(corporateCap({ ...base, mallCash: 10_000_000_000, held: 100_000 }).maxShares).toBe(0);
    expect(corporateCap({ ...base, mallCash: 10_000_000_000, held: 150_000 }).maxShares).toBe(0);
  });

  it("total cap is 40% of cash before buying, minus portfolio value", () => {
    const r = corporateCap(base);
    expect(r.byTotal).toBe(40_000); // 40M / 1000
    expect(r.binding).toBe("total");
    expect(corporateCap({ ...base, portfolioValue: 30_000_000 }).maxShares).toBe(10_000);
    expect(corporateCap({ ...base, portfolioValue: 40_000_000 }).maxShares).toBe(0);
    expect(corporateCap({ ...base, portfolioValue: 55_000_000 }).maxShares).toBe(0);
  });

  it("cash must cover cost plus fee; the result is always affordable and maximal", () => {
    for (const cash of [0, 999, 1000, 1004, 1005, 7_777, 123_456]) {
      const r = corporateCap({ outstanding: 1_000_000, held: 0, price: 1000, mallCash: cash * 1000, portfolioValue: -1e12 });
      // portfolioValue negative → total cap is huge; only cash (and 10%) bind
      const c = corporateCost(r.byCash, 1000);
      expect(c.total).toBeLessThanOrEqual(cash * 1000);
      expect(corporateCost(r.byCash + 1, 1000).total).toBeGreaterThan(cash * 1000);
    }
  });

  it("never allows a purchase that breaks any rule, over a sweep of inputs", () => {
    for (const price of [37, 100, 1234.5, 98_765]) {
      for (const cash of [0, 5_000, 1_000_000, 123_456_789]) {
        for (const held of [0, 10, 50_000, 99_999]) {
          for (const pv of [0, 500_000, 60_000_000]) {
            const i = { outstanding: 1_000_000, held, price, mallCash: cash, portfolioValue: pv };
            const r = corporateCap(i);
            expect(Number.isInteger(r.maxShares) && r.maxShares >= 0).toBe(true);
            if (r.maxShares > 0) {
              expect(held + r.maxShares).toBeLessThanOrEqual(100_000);
              expect(corporateCost(r.maxShares, price).total).toBeLessThanOrEqual(cash);
              expect(pv + r.maxShares * price).toBeLessThanOrEqual(cash * 0.4 + price); // 取整數股，最多差不到一股
              expect(pv + (r.maxShares - 1) * price).toBeLessThanOrEqual(cash * 0.4);
            }
          }
        }
      }
    }
  });

  it("degenerate input yields 0 and does not throw", () => {
    expect(corporateCap({ ...base, price: 0 }).maxShares).toBe(0);
    expect(corporateCap({ ...base, outstanding: 0 }).maxShares).toBe(0);
    expect(corporateCap({ ...base, mallCash: -5 }).maxShares).toBe(0);
  });

  it("cost rounds fee up", () => {
    expect(corporateCost(1, 1000)).toEqual({ amount: 1000, fee: 5, total: 1005 });
    expect(corporateCost(1, 1001)).toEqual({ amount: 1001, fee: 6, total: 1007 });
    expect(corporateCost(0, 1000)).toEqual({ amount: 0, fee: 0, total: 0 });
  });
});

describe("finance lag threshold", () => {
  it("is stricter than the ordinary interaction threshold", () => {
    expect(FINANCE_MAX_LAG_TICKS).toBe(TICKS_PER_DAY);
    expect(FINANCE_MAX_LAG_TICKS).toBeLessThan(INTERACT_MAX_LAG_TICKS);
    expect(financeBlocker(0)).toBeNull();
    expect(financeBlocker(FINANCE_MAX_LAG_TICKS)).toBeNull();
    expect(financeBlocker(FINANCE_MAX_LAG_TICKS + 1)).toMatch(/落後/);
    // 一般互動還放行、金融操作已擋的區間
    expect(interactBlocker(2 * TICKS_PER_DAY)).toBeNull();
    expect(financeBlocker(2 * TICKS_PER_DAY)).not.toBeNull();
  });
});

describe("tender offer state machine", () => {
  const states: TenderState[] = ["announced", "antitrust_review", "open", "succeeded", "failed", "blocked", "withdrawn", "squeezing", "completed"];
  const events: TenderEvent[] = ["review", "open", "block", "extend", "succeed", "fail", "withdraw", "settle", "squeeze", "finish"];

  it("walks the happy path, with and without review", () => {
    expect(nextTenderState("announced", "open")).toBe("open");
    expect(nextTenderState("announced", "review")).toBe("antitrust_review");
    expect(nextTenderState("antitrust_review", "open")).toBe("open");
    expect(nextTenderState("open", "extend")).toBe("open");
    expect(nextTenderState("open", "succeed")).toBe("succeeded");
    expect(nextTenderState("succeeded", "settle")).toBe("completed");
    expect(nextTenderState("succeeded", "squeeze")).toBe("squeezing");
    expect(nextTenderState("squeezing", "finish")).toBe("completed");
  });

  it("failure paths", () => {
    expect(nextTenderState("open", "fail")).toBe("failed");
    expect(nextTenderState("antitrust_review", "block")).toBe("blocked");
    expect(nextTenderState("announced", "withdraw")).toBe("withdrawn");
    expect(nextTenderState("open", "withdraw")).toBe("withdrawn");
  });

  it("rejects illegal moves", () => {
    expect(nextTenderState("announced", "succeed")).toBeNull();
    expect(nextTenderState("announced", "squeeze")).toBeNull();
    expect(nextTenderState("open", "block")).toBeNull();
    expect(nextTenderState("succeeded", "withdraw")).toBeNull(); // 成立後不能撤回
    expect(nextTenderState("squeezing", "withdraw")).toBeNull();
    expect(nextTenderState("open", "open")).toBeNull();
  });

  it("terminal states have no way out", () => {
    for (const s of states.filter(isTenderTerminal)) {
      for (const e of events) expect(nextTenderState(s, e), `${s}/${e}`).toBeNull();
      expect(tenderEventsFrom(s)).toEqual([]);
    }
    expect(states.filter(isTenderTerminal).sort()).toEqual(["blocked", "completed", "failed", "withdrawn"]);
  });

  it("every non-terminal state can reach a terminal state, and tenderEventsFrom matches nextTenderState", () => {
    for (const s of states) {
      for (const e of events) expect(tenderEventsFrom(s).includes(e)).toBe(nextTenderState(s, e) !== null);
    }
    const reach = (s: TenderState, seen = new Set<TenderState>()): boolean => {
      if (isTenderTerminal(s)) return true;
      if (seen.has(s)) return false;
      seen.add(s);
      return tenderEventsFrom(s).some((e) => {
        const n = nextTenderState(s, e)!;
        return n !== s && reach(n, seen);
      });
    };
    for (const s of states) expect(reach(s), s).toBe(true);
  });
});

describe("antitrust", () => {
  it("clear / review / blocked by combined market share", () => {
    expect(antitrustVerdict(0)).toBe("clear");
    expect(antitrustVerdict(ANTITRUST_REVIEW_SHARE)).toBe("clear");
    expect(antitrustVerdict(ANTITRUST_REVIEW_SHARE + 0.001)).toBe("review");
    expect(antitrustVerdict(ANTITRUST_BLOCK_SHARE)).toBe("review");
    expect(antitrustVerdict(ANTITRUST_BLOCK_SHARE + 0.001)).toBe("blocked");
    expect(antitrustVerdict(Number.NaN)).toBe("clear");
  });
});
