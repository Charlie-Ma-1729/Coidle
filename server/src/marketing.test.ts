import { describe, expect, it } from "vitest";
import {
  STARTER_QUESTS,
  DEFAULT_PREP,
  INSPECTIONS,
  MAX_ACTIVE_PROMOS,
  MAX_QUEUED_PROMOS,
  OUTCOME_INFO,
  PREP_OPTIONS,
  PROMOS,
  PROMO_BY_ID,
  PROMO_FATIGUE_DECAY_PER_DAY,
  TICKS_PER_DAY,
  TICK_MINUTES,
  inspectionOutcome,
  inspectionScore,
  isPaused,
  promoEffectFactor,
  type MallState,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, stepTick, type Command } from "./sim";
import { maybeSpawnInspection, resolveInspection } from "./sim/inspections";
import { createRng } from "./sim/rng";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const DAY = TICKS_PER_DAY;

const must = (r: ReturnType<typeof applyCommand>): MallState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const apply = (s: MallState, c: Command) => must(applyCommand(s, c));
const fails = (s: MallState, c: Command) => !applyCommand(s, c).ok;

/** 稽查測試用：讓稽查排程不要干擾（把下一次都排得很遠） */
function noInspections(s: MallState): MallState {
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0; // 新手任務的獎金不要干擾這裡的金額檢查
  s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
  return s;
}

describe("promo data", () => {
  it("has unique ids and sane numbers", () => {
    const ids = new Set<string>();
    for (const p of PROMOS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.durationTicks).toBeGreaterThan(0);
      expect(p.cost).toBeGreaterThan(0);
      expect(p.discount).toBeGreaterThanOrEqual(0);
      expect(p.discount).toBeLessThanOrEqual(0.5);
      expect(p.fatigue).toBeGreaterThan(0);
      for (const m of Object.values(p.traffic)) expect(m).toBeGreaterThanOrEqual(0.5);
    }
    expect(PROMOS.length).toBeGreaterThanOrEqual(6);
  });

  it("fatigue only discounts the bonus part", () => {
    expect(promoEffectFactor(0)).toBe(1);
    expect(promoEffectFactor(1)).toBeCloseTo(0.4, 5);
    expect(promoEffectFactor(2)).toBeCloseTo(0.4, 5); // 夾限
    expect(promoEffectFactor(-1)).toBe(1);
  });
});

describe("promotions", () => {
  it("starting one now spends the budget and activates it immediately", () => {
    let s = createInitialState(1, START);
    noInspections(s);
    const funds = s.funds;
    s = apply(s, { type: "schedulePromo", defId: "discount_day" });
    expect(s.funds).toBe(funds - PROMO_BY_ID.discount_day!.cost);
    expect(s.promos.active).toHaveLength(1);
    expect(s.promos.active[0]!.endTick - s.promos.active[0]!.startTick).toBe(PROMO_BY_ID.discount_day!.durationTicks);
    expect(s.promos.fatigue).toBeCloseTo(PROMO_BY_ID.discount_day!.fatigue, 5);
  });

  /** 讓商場走到早上 10 點（開門），並備好庫存，再開始活動比較 */
  function atOpening(seed: number): MallState {
    let s = noInspections(createInitialState(seed, START));
    s.shops.forEach((x) => (x.stock = 5000));
    s = advanceTo(s, START + 10 * 12); // 10:00
    return s;
  }
  const totals = (st: MallState) => {
    let n = 0;
    let sum = 0;
    for (const p of Object.keys(st.today.satN) as (keyof typeof st.today.satN)[]) {
      n += st.today.satN[p];
      sum += st.today.satSum[p];
    }
    return { groups: st.today.groups, units: st.today.units, revenue: st.today.revenue, sat: n ? sum / n : 0 };
  };

  it("draws more customers than the same mall without a promo", () => {
    let withPromo = 0;
    let without = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const base = atOpening(seed);
      const promo = apply(structuredClone(base), { type: "schedulePromo", defId: "anniversary" });
      without += totals(advanceTo(base, base.tick + 120)).groups;
      withPromo += totals(advanceTo(promo, promo.tick + 120)).groups;
    }
    expect(withPromo).toBeGreaterThan(without * 1.2);
  });

  it("discounts reduce revenue per unit sold but raise satisfaction", () => {
    let perA = 0;
    let perB = 0;
    let satA = 0;
    let satB = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const base = atOpening(seed);
      const promo = apply(structuredClone(base), { type: "schedulePromo", defId: "bogo" });
      const a = totals(advanceTo(base, base.tick + 60));
      const b = totals(advanceTo(promo, promo.tick + 60));
      perA += a.revenue / Math.max(1, a.units);
      perB += b.revenue / Math.max(1, b.units);
      satA += a.sat;
      satB += b.sat;
    }
    expect(perB).toBeLessThan(perA); // 打折：每份賺得少
    expect(satB).toBeGreaterThan(satA); // 但客人更開心
  });

  it("ends on time, records results and logs them", () => {
    let s = noInspections(createInitialState(2, START));
    s.shops.forEach((x) => (x.stock = 5000));
    s = apply(s, { type: "schedulePromo", defId: "tasting" });
    const def = PROMO_BY_ID.tasting!;
    s = advanceTo(s, s.tick + def.durationTicks + 2);
    expect(s.promos.active).toHaveLength(0);
    expect(s.promos.history).toHaveLength(1);
    expect(s.promos.history[0]!.defId).toBe("tasting");
    expect(s.promos.lastEnd.tasting).toBeGreaterThan(0);
    expect(s.log.some((l) => l.text.includes("活動結束") && l.text.includes("免費試吃"))).toBe(true);
  });

  it("validates: unknown, past, too far, duplicate, cooldown, funds, limits", () => {
    let s = noInspections(createInitialState(2, START));
    s.funds = 10_000_000;
    expect(fails(s, { type: "schedulePromo", defId: "nope" })).toBe(true);
    expect(fails(s, { type: "schedulePromo", defId: "tasting", startTick: s.tick - 1 })).toBe(true);
    expect(fails(s, { type: "schedulePromo", defId: "tasting", startTick: s.tick + 288 * 15 })).toBe(true);
    expect(fails(s, { type: "schedulePromo", defId: "tasting", startTick: 1.5 })).toBe(true);
    const poor = structuredClone(s);
    poor.funds = 100;
    expect(fails(poor, { type: "schedulePromo", defId: "tasting" })).toBe(true);

    s = apply(s, { type: "schedulePromo", defId: "tasting" });
    expect(fails(s, { type: "schedulePromo", defId: "tasting" })).toBe(true); // 重複
    s = apply(s, { type: "schedulePromo", defId: "bogo" });
    expect(s.promos.active).toHaveLength(MAX_ACTIVE_PROMOS);
    expect(fails(s, { type: "schedulePromo", defId: "ads" })).toBe(true); // 同時最多 2 個（現在開始）

    // 排程到未來可以，但總數有上限
    let q = noInspections(createInitialState(2, START));
    q.funds = 100_000_000;
    const future = q.tick + 288 * 3;
    const ids = PROMOS.map((p) => p.id);
    for (let i = 0; i < MAX_QUEUED_PROMOS; i++) q = apply(q, { type: "schedulePromo", defId: ids[i]!, startTick: future + i });
    expect(fails(q, { type: "schedulePromo", defId: ids[MAX_QUEUED_PROMOS]!, startTick: future + 50 })).toBe(true);

    // 剛辦完的活動還在冷卻
    let c = noInspections(createInitialState(2, START));
    c = apply(c, { type: "schedulePromo", defId: "tasting" });
    c = advanceTo(c, c.tick + PROMO_BY_ID.tasting!.durationTicks + 2);
    expect(fails(c, { type: "schedulePromo", defId: "tasting" })).toBe(true);
    c = advanceTo(c, c.tick + PROMO_BY_ID.tasting!.cooldownTicks + 2);
    expect(applyCommand(c, { type: "schedulePromo", defId: "tasting" }).ok).toBe(true);
  });

  it("scheduled promos start at their time; cancelling before that refunds in full", () => {
    let s = noInspections(createInitialState(4, START));
    const funds = s.funds;
    const at = s.tick + 100;
    s = apply(s, { type: "schedulePromo", defId: "collab", startTick: at });
    expect(s.promos.scheduled).toHaveLength(1);
    expect(s.promos.active).toHaveLength(0);
    expect(s.funds).toBe(funds - PROMO_BY_ID.collab!.cost);

    const cancelled = apply(s, { type: "cancelPromo", uid: s.promos.scheduled[0]!.uid });
    expect(cancelled.funds).toBe(funds);
    expect(cancelled.promos.scheduled).toHaveLength(0);

    s = advanceTo(s, at + 1);
    expect(s.promos.scheduled).toHaveLength(0);
    expect(s.promos.active[0]!.defId).toBe("collab");
    expect(s.promos.active[0]!.startTick).toBe(at);
    expect(fails(s, { type: "cancelPromo", uid: s.promos.active[0]!.uid })).toBe(true); // 開始後不能取消
  });

  it("when too many are active, a due promo waits for a free slot", () => {
    let s = noInspections(createInitialState(4, START));
    s = apply(s, { type: "schedulePromo", defId: "tasting" }); // 72 ticks
    s = apply(s, { type: "schedulePromo", defId: "bogo" }); // 72 ticks
    s = apply(s, { type: "schedulePromo", defId: "ads", startTick: s.tick + 10 });
    s = advanceTo(s, s.tick + 30);
    expect(s.promos.scheduled.map((x) => x.defId)).toEqual(["ads"]);
    expect(s.promos.active.every((a) => a.defId !== "ads")).toBe(true);
    s = advanceTo(s, s.tick + 80);
    expect(s.promos.active.some((a) => a.defId === "ads")).toBe(true);
  });

  it("repeated promos wear off: fatigue weakens the next one and decays daily", () => {
    let s = noInspections(createInitialState(5, START));
    s.funds = 50_000_000;
    s = apply(s, { type: "schedulePromo", defId: "anniversary" });
    expect(s.promos.active[0]!.factor).toBe(1);
    s = apply(s, { type: "schedulePromo", defId: "collab" });
    expect(s.promos.active.find((a) => a.defId === "collab")!.factor).toBeLessThan(0.9);
    const f0 = s.promos.fatigue;
    s = advanceTo(s, s.tick + 3 * DAY);
    expect(s.promos.fatigue).toBeLessThan(f0);
    expect(s.promos.fatigue).toBeGreaterThanOrEqual(f0 - 4 * PROMO_FATIGUE_DECAY_PER_DAY - 1e-9);
  });

  it("the loyalty promo makes positive regular affinity gains larger", () => {
    const a = noInspections(createInitialState(1, START));
    const r = a.regulars.find((x) => x.id === "afu")!;
    r.met = true;
    r.affinity = 15;
    r.lastVisitTick = a.tick; // 剛上門，才能招呼
    const normal = apply(a, { type: "regularAction", regularId: "afu", action: "greet" }).regulars.find((x) => x.id === "afu")!.affinity - 15;
    const promo = apply(structuredClone(a), { type: "schedulePromo", defId: "loyalty" });
    const boosted = apply(promo, { type: "regularAction", regularId: "afu", action: "greet" }).regulars.find((x) => x.id === "afu")!.affinity - 15;
    expect(normal).toBeCloseTo(1, 5);
    expect(boosted).toBeCloseTo(1.6, 5);
    expect(boosted).toBeGreaterThan(normal);
  });

  it("promos count the day's activity in the daily report", () => {
    let s = noInspections(createInitialState(6, START));
    s.shops.forEach((x) => (x.stock = 5000));
    s = apply(s, { type: "schedulePromo", defId: "tasting" });
    s = advanceTo(s, START + DAY + 5);
    expect(s.reports[0]!.notes.some((n) => n.includes("免費試吃"))).toBe(true);
  });
});

describe("inspection rules", () => {
  it("scores combine cleanliness and equipment by kind, and map to outcomes", () => {
    expect(inspectionScore("hygiene", 100, 0)).toBe(75);
    expect(inspectionScore("fire", 100, 0)).toBe(20);
    expect(inspectionScore("fire", 0, 100)).toBe(80);
    expect(inspectionOutcome(95)).toBe("excellent");
    expect(inspectionOutcome(70)).toBe("pass");
    expect(inspectionOutcome(50)).toBe("warning");
    expect(inspectionOutcome(30)).toBe("fine");
    expect(inspectionOutcome(10)).toBe("suspend");
    expect(OUTCOME_INFO.suspend.fine).toBeGreaterThan(OUTCOME_INFO.fine.fine);
    expect(PREP_OPTIONS.find((p) => p.id === DEFAULT_PREP)).toBeDefined();
  });
});

describe("inspections in play", () => {
  /** 讓某種稽查立刻到期，逐 tick 推進到出現預告；回傳該狀態 */
  function withNotice(kind: "hygiene" | "fire" = "hygiene"): MallState {
    for (let seed = 1; seed < 60; seed++) {
      const s = createInitialState(seed, START);
      s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
      s.inspections.nextAt[kind] = s.tick;
      stepTick(s);
      if (s.inspections.pending.length > 0) return s;
    }
    throw new Error("no notice produced");
  }

  it("first inspections are not immediate and the mall starts with a decent compliance score", () => {
    const s = createInitialState(1, START);
    expect(s.inspections.nextAt.hygiene).toBeGreaterThanOrEqual(START + 3 * DAY);
    expect(s.inspections.compliance).toBeGreaterThanOrEqual(60);
    expect(s.inspections.pending).toEqual([]);
  });

  it("a notice gives a few game hours to prepare and logs the warning", () => {
    const s = withNotice();
    const n = s.inspections.pending[0]!;
    expect(n.kind).toBe("hygiene");
    expect(n.inspectTick - n.notifiedTick).toBeGreaterThanOrEqual(36);
    expect(n.inspectTick - n.notifiedTick).toBeLessThanOrEqual(72);
    expect(n.prep).toBeNull();
    expect(s.log.some((l) => l.text.includes(INSPECTIONS.hygiene.authority))).toBe(true);
    // 同一種稽查在處理完之前不會重複預告
    const again = createRng(1);
    expect(maybeSpawnInspection(s, again)).toBeNull();
  });

  it("preparing costs money and improves the score inputs; double prep and unknown ids are rejected", () => {
    let s = withNotice("fire");
    s.cleanliness = 50;
    s.equipment = 50;
    const n = s.inspections.pending[0]!;
    const funds = s.funds;
    s = apply(s, { type: "prepareInspection", uid: n.uid, level: "full" });
    expect(s.funds).toBe(funds - PREP_OPTIONS.find((p) => p.id === "full")!.cost);
    expect(s.cleanliness).toBe(70);
    expect(s.equipment).toBe(60);
    expect(s.inspections.pending[0]!.prep).toBe("full");
    expect(fails(s, { type: "prepareInspection", uid: n.uid, level: "basic" })).toBe(true);
    expect(fails(s, { type: "prepareInspection", uid: "nope", level: "basic" })).toBe(true);
    expect(fails(withNotice(), { type: "prepareInspection", uid: "ins999", level: "full" })).toBe(true);
    const poor = withNotice();
    poor.funds = 5;
    expect(fails(poor, { type: "prepareInspection", uid: poor.inspections.pending[0]!.uid, level: "full" })).toBe(true);
    const bad = withNotice();
    expect(fails(bad, { type: "prepareInspection", uid: bad.inspections.pending[0]!.uid, level: "bribe" as never })).toBe(true);
  });

  it("at the appointed time an unprepared mall gets the default tidy-up, then a result and compliance change", () => {
    let s = withNotice();
    const n = s.inspections.pending[0]!;
    const before = s.inspections.compliance;
    s = advanceTo(s, n.inspectTick + 2);
    expect(s.inspections.pending).toHaveLength(0);
    const res = s.inspections.log[0]!;
    expect(res.kind).toBe("hygiene");
    expect(res.prep).toBe(DEFAULT_PREP);
    expect(res.surprise).toBe(false);
    expect(["excellent", "pass"]).toContain(res.outcome); // 預設設定的商場很乾淨
    expect(s.inspections.compliance).toBeGreaterThan(before);
    expect(s.reports.length === 0 ? s.today.systemNotes.length : 1).toBeGreaterThan(0);
  });

  it("a neglected mall gets fined or shut down, loses compliance and index", () => {
    const s = createInitialState(7, START);
    s.cleanliness = 5;
    s.equipment = 5;
    const funds = s.funds;
    const rep = s.localRep;
    const comp = s.inspections.compliance;
    resolveInspection(s, "hygiene", "none", true);
    const res = s.inspections.log[0]!;
    expect(res.outcome).toBe("suspend");
    expect(res.fine).toBe(OUTCOME_INFO.suspend.fine);
    expect(s.funds).toBe(funds - res.fine);
    expect(s.localRep).toBeLessThan(rep);
    expect(s.inspections.compliance).toBe(comp + OUTCOME_INFO.suspend.compliance);
    // 食品衛生稽查：餐飲店被勒令停業整頓
    expect(s.shops.every((x) => x.closedUntilTick > s.tick)).toBe(true);
    const fire = createInitialState(7, START);
    fire.cleanliness = 100;
    fire.equipment = 5;
    resolveInspection(fire, "fire", null, true);
    expect(fire.inspections.log[0]!.outcome).toBe("suspend");
  });

  it("a clean, maintained mall earns praise", () => {
    const s = createInitialState(7, START);
    s.cleanliness = 100;
    s.equipment = 100;
    const rep = s.localRep;
    resolveInspection(s, "hygiene", "full", false);
    expect(s.inspections.log[0]!.outcome).toBe("excellent");
    expect(s.localRep).toBeGreaterThan(rep);
    expect(s.inspections.compliance).toBeLessThanOrEqual(100);
  });

  it("surprise inspections produce a result immediately with no notice", () => {
    let found = false;
    for (let seed = 1; seed < 80 && !found; seed++) {
      const s = createInitialState(seed, START);
      s.inspections.nextAt = { hygiene: s.tick, fire: s.tick + 10_000_000 };
      stepTick(s);
      if (s.inspections.log.length > 0) {
        found = true;
        expect(s.inspections.log[0]!.surprise).toBe(true);
        expect(s.inspections.pending).toHaveLength(0);
      }
    }
    expect(found).toBe(true);
  });

  it("low compliance brings inspections more often", () => {
    const gaps = (compliance: number) => {
      let total = 0;
      let n = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const s = createInitialState(seed, START);
        s.inspections.compliance = compliance;
        s.inspections.nextAt = { hygiene: s.tick, fire: s.tick + 10_000_000 };
        s.shops.forEach((x) => (x.stock = 5000));
        stepTick(s);
        total += s.inspections.nextAt.hygiene! - s.tick;
        n++;
      }
      return total / n;
    };
    expect(gaps(20)).toBeLessThan(gaps(90));
  });

  it("with nobody present a notice pauses the clock; preparing it (or all defaults) resumes", () => {
    let found: MallState | null = null;
    for (let seed = 1; seed < 80 && !found; seed++) {
      const s = createInitialState(seed, START);
      s.cleanliness = 20; // 狀況差、預設備戰也過不了，才值得暫停等人處理
      s.equipment = 20;
      s.inspections.nextAt = { hygiene: s.tick, fire: s.tick + 10_000_000 };
      const halted = stepTick(s, { nobodyPresent: true });
      if (halted && s.inspections.pending.length > 0) found = s;
    }
    expect(found).not.toBeNull();
    const s = found!;
    const uid = s.inspections.pending[0]!.uid;
    expect(s.clock.holds.events).toContain(uid);
    expect(isPaused(s.clock)).toBe(true);

    const a = apply(s, { type: "prepareInspection", uid, level: "basic" });
    expect(a.clock.holds.events).not.toContain(uid);
    expect(isPaused(a.clock)).toBe(false);

    const b = apply(s, { type: "resolveAllDefault" });
    expect(b.clock.holds.events).toEqual([]);
    expect(b.inspections.pending[0]!.prep).toBe(DEFAULT_PREP);
    expect(fails(b, { type: "resolveAllDefault" })).toBe(true); // 沒有東西可處理了

    // 有人在場就不暫停
    let present = false;
    for (let seed = 1; seed < 80 && !present; seed++) {
      const t = createInitialState(seed, START);
      t.inspections.nextAt = { hygiene: t.tick, fire: t.tick + 10_000_000 };
      const halted = stepTick(t, { nobodyPresent: false });
      if (t.inspections.pending.length > 0) {
        present = true;
        expect(halted).toBe(false);
        expect(t.clock.holds.events).toEqual([]);
      }
    }
    expect(present).toBe(true);
  });
});

describe("determinism and migration", () => {
  it("catch-up equals tick-by-tick with promos and inspections in play", () => {
    const a = createInitialState(11, START);
    a.funds = 5_000_000;
    a.inspections.nextAt = { hygiene: a.tick + 50, fire: a.tick + 120 };
    const withPromo = apply(a, { type: "schedulePromo", defId: "discount_day" });
    const big = advanceTo(withPromo, START + 3 * DAY);
    const b = structuredClone(withPromo);
    for (let i = 0; i < 3 * DAY; i++) stepTick(b);
    expect(b).toEqual(big);
  });

  it("migrates v4 to v5 with empty promos and scheduled inspections", () => {
    const v4 = { ...createInitialState(1, 500), version: 4 } as unknown as Record<string, unknown>;
    delete v4.promos;
    delete v4.inspections;
    const m = migrateState(v4, 0);
    expect(m.version).toBe(13);
    expect(m.promos.active).toEqual([]);
    expect(m.inspections.nextAt.hygiene).toBeGreaterThan(500);
    expect(m.today.systemNotes).toEqual([]);
  });
});
