import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY, TICK_MINUTES, type PublicMallState } from "@coidle/shared";
import { advanceTo, createInitialState } from "../../../../server/src/sim";
import { hubSummary } from "./summary";

const START = (Date.UTC(2026, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
type Mutable = ReturnType<typeof createInitialState>;
function stateAt(days: number, mutate?: (s: Mutable) => void): PublicMallState {
  let s = createInitialState(7, START);
  s = advanceTo(s, START + days * TICKS_PER_DAY + 30);
  mutate?.(s);
  const { seed: _seed, cooldowns: _cd, ...rest } = s;
  return rest;
}
const val = (pills: { label: string; value: string }[], label: string) => pills.find((p) => p.label === label)?.value;

describe("hubSummary", () => {
  it("每個樞紐都有 1–3 個摘要數字", () => {
    const s = stateAt(1);
    for (const h of ["operate", "guests", "develop", "finance", "world"] as const) {
      const p = hubSummary(s, h);
      expect(p.length).toBeGreaterThanOrEqual(1);
      expect(p.length).toBeLessThanOrEqual(3);
    }
  });
  it("營運：營業時間、整潔、設備", () => {
    const p = hubSummary(stateAt(0, (s) => ((s.hours = { open: 9, close: 23 }), (s.cleanliness = 61.4), (s.equipment = 47.6))), "operate");
    expect(val(p, "營業")).toBe("09:00–23:00");
    expect(val(p, "整潔")).toBe("61%");
    expect(val(p, "設備")).toBe("48%");
  });
  it("客人：常客數只在有人遇見後才出現", () => {
    expect(val(hubSummary(stateAt(0), "guests"), "常客")).toBeUndefined();
    expect(val(hubSummary(stateAt(0, (s) => (s.regulars[0]!.met = true)), "guests"), "常客")).toBe("1");
  });
  it("財務：待繳只在有帳單時出現，且含延滯金", () => {
    expect(val(hubSummary(stateAt(0), "finance"), "待繳")).toBeUndefined();
    const p = hubSummary(
      stateAt(0, (s) => s.tax.bills.push({ uid: "b", kind: "property", label: "x", amount: 1000, createdTick: 0, dueTick: s.tick + 5, paid: 400, lateFee: 50 })),
      "finance",
    );
    expect(val(p, "待繳")).toBe("¥650");
  });
});
