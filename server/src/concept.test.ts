import { describe, expect, it } from "vitest";
import { CONCEPT_COOLDOWN_TICKS, STARTER_QUESTS, TICKS_PER_DAY, conceptChangeCost, type MallState } from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState } from "./sim";
import { demandMult, trafficMult } from "./sim/state";

// 概念定位：第一次免費，之後要付費並有冷卻；定位會改變各客群的客流與各業態的需求，
// 不會改別的狀態，而且舊存檔（沒有這個欄位）照常運作。

const fresh = (): MallState => {
  const s = createInitialState(7, 1000, 0);
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
  return s;
};
const ok = (s: MallState, id: string): MallState => {
  const r = applyCommand(s, { type: "setConcept", id });
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const fail = (s: MallState, id: string): string => {
  const r = applyCommand(s, { type: "setConcept", id });
  if (r.ok) throw new Error("expected failure");
  return r.error;
};

describe("setConcept", () => {
  it("the first pick is free, and old saves without the field still work", () => {
    const s = fresh();
    expect(s.concept).toBeUndefined();
    const f = s.funds;
    const next = ok(s, "family");
    expect(next.funds).toBe(f);
    expect(next.concept).toEqual({ id: "family", since: s.tick });
    // 沒有 concept 的舊狀態經過 migrateState 之後還是正常
    const old = migrateState(JSON.parse(JSON.stringify(s)), 0);
    expect(old.concept).toBeUndefined();
    expect(trafficMult(old, "family", old.tick)).toBeGreaterThan(0);
  });

  it("rejects unknown concepts and the one you already have", () => {
    const s = fresh();
    expect(fail(s, "casino")).toContain("找不到");
    expect(fail(s, "general")).toContain("目前就是");
    expect(fail(ok(s, "foodie"), "foodie")).toContain("目前就是");
  });

  it("charges for later changes and enforces the cooldown", () => {
    let s = ok(fresh(), "foodie");
    expect(fail(s, "trend")).toContain("剛換過");
    s = { ...s, tick: s.tick + CONCEPT_COOLDOWN_TICKS, funds: 10_000_000 };
    const cost = conceptChangeCost(s.level);
    const f = s.funds;
    const next = ok(s, "trend");
    expect(f - next.funds).toBe(cost);
    expect(next.concept).toEqual({ id: "trend", since: s.tick });
    // 錢不夠
    const poor = { ...next, tick: next.tick + CONCEPT_COOLDOWN_TICKS, funds: cost - 1 };
    expect(fail(poor, "night")).toContain("資金不足");
    // 還剩幾天說得清楚
    const early = { ...s, tick: s.concept!.since + CONCEPT_COOLDOWN_TICKS - 3 * TICKS_PER_DAY };
    expect(fail(early, "night")).toContain("3 個遊戲日");
  });

  it("shifts who comes and what they want, and nothing for the default", () => {
    const base = fresh();
    const fam = ok(base, "family");
    const t = base.tick;
    expect(trafficMult(fam, "family", t)).toBeGreaterThan(trafficMult(base, "family", t));
    expect(trafficMult(fam, "couple", t)).toBeLessThan(trafficMult(base, "couple", t));
    expect(demandMult(fam, "arcade_vr", t)).toBeGreaterThan(demandMult(base, "arcade_vr", t));
    // 預設定位（綜合型）完全不影響：和沒選過一模一樣
    expect(trafficMult({ ...base, concept: { id: "general", since: 0 } }, "local", t)).toBe(trafficMult(base, "local", t));
  });

  it("is deterministic: the same commands and ticks give the same result", () => {
    const run = () => {
      let s = ok(fresh(), "tourist");
      s = advanceTo(s, s.tick + 2 * TICKS_PER_DAY);
      return JSON.stringify([s.funds, s.totalRevenue, s.concept]);
    };
    expect(run()).toBe(run());
  });
});
