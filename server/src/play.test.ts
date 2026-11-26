import { describe, expect, it } from "vitest";
import {
  ANALYSIS_MAX_POINTS,
  STARTER_QUESTS,
  TECH_BY_ID,
  TECH_EXP_BY_ID,
  actKind,
  makeAnalysisLevel,
  makeLevel,
  normalizePlan,
  planEffects,
  playDifficulty,
  scoreAnalysis,
  scorePlay,
  sequenceAnswer,
  stageSeed,
  techGrade,
  type MallState,
  type PlayInput,
  type TechJob,
  type SlotKind,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, type Command } from "./sim";
import { INGREDIENT_BY_ID } from "./sim/recipes";
import { playSeedOf, syncWorkshop } from "./sim/workshop";

const T0 = 1000;
const mk = (seed = 7): MallState => {
  const s = createInitialState(seed, T0, 0);
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
  return s;
};
const apply = (s: MallState, c: Command): MallState => {
  const r = applyCommand(s, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const fails = (s: MallState, c: Command): string | null => {
  const r = applyCommand(s, c);
  return r.ok ? null : r.error;
};
type Picks = Partial<Record<SlotKind, string>>;
const ZESTY: Picks = { base: "f_pork", season: "f_citrus", method: "f_fry" };
const diffOf = (p: Picks) => playDifficulty(Object.values(p).map((id) => INGREDIENT_BY_ID[id as string]!.cost));

function perfect(seed: number, p: Picks, tweak?: Record<string, number>): PlayInput {
  const d = diffOf(p);
  const prep = makeLevel("sequence", stageSeed(seed, 0), "food", d);
  const kind = actKind("food", p.method);
  const act = makeLevel(kind, stageSeed(seed, 1), "food", d);
  const inputs = act.kind === "rhythm" ? act.beats.slice() : act.kind === "hold" ? act.centers.slice() : [];
  return {
    seed,
    stages: [
      { id: "prep", inputs: prep.kind === "sequence" ? sequenceAnswer(prep) : [] },
      { id: "act", inputs },
    ],
    ...(tweak ? { tweak } : {}),
  };
}

function lv2(seed = 7): MallState {
  const c = structuredClone(mk(seed));
  c.level = 2;
  syncWorkshop(c);
  return c;
}
const shopOf = (s: MallState) => s.shops.find((x) => x.category === "kushikatsu")!;

describe("workshop mini-game scoring", () => {
  it("is deterministic and a perfect play maxes the bonus", () => {
    const seed = 12345;
    const play = perfect(seed, ZESTY);
    const a = scorePlay("food", "f_fry", diffOf(ZESTY), seed, play)!;
    const b = scorePlay("food", "f_fry", diffOf(ZESTY), seed, play)!;
    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThan(0.95);
    expect(a.bonus).toBe(3);
  });

  it("forged / stale / junk input is clamped or ignored", () => {
    const seed = 99;
    expect(scorePlay("food", "f_fry", 2, seed, undefined)).toBeNull();
    expect(scorePlay("food", "f_fry", 2, seed, { seed: seed + 1, stages: [] })).toBeNull();
    const junk = scorePlay("food", "f_fry", 2, seed, { seed, stages: "x" as never, tweak: { a: 99, b: NaN } as never })!;
    expect(junk.score).toBe(0);
    expect(junk.bonus).toBe(0);
    expect(Object.keys(junk.tweak)).toHaveLength(0);
    const spam = scorePlay("food", "f_fry", 8, seed, { seed, stages: [{ id: "act", inputs: Array.from({ length: 500 }, (_, i) => i * 7) }] })!;
    expect(spam.bonus).toBeLessThanOrEqual(3);
    expect(spam.score).toBeLessThan(0.5);
  });

  it("tweak is limited to two valid tags, ±1 each", () => {
    const seed = 5;
    const r = scorePlay("food", "f_fry", 0, seed, { seed, stages: [], tweak: { sweet: 1, salty: -1, spicy: 1, bogus: 1, rich: 5 } })!;
    expect(Object.keys(r.tweak).length).toBeLessThanOrEqual(2);
    for (const v of Object.values(r.tweak)) expect(Math.abs(v)).toBe(1);
    expect(r.tweak.bogus).toBeUndefined();
  });
});

describe("startRnd with play", () => {
  it("no play = old behaviour; a valid play stores its result and rotates the seed", () => {
    const s0 = lv2();
    const sh = shopOf(s0);
    const plain = apply(s0, { type: "startRnd", shopId: sh.id, picks: ZESTY });
    expect(plain.workshop.jobs[0]!.play).toBeUndefined();
    const seed = playSeedOf(structuredClone(s0));
    const played = apply(s0, { type: "startRnd", shopId: sh.id, picks: ZESTY, play: perfect(seed, ZESTY) });
    const job = played.workshop.jobs[0]!;
    expect(job.play?.bonus).toBe(3);
    expect(played.workshop.playSeed).not.toBe(seed);
    expect(played.funds).toBe(plain.funds);
  });

  it("a stale seed is treated as 'auto' (no bonus, no error)", () => {
    const s0 = lv2();
    const sh = shopOf(s0);
    const seed = playSeedOf(structuredClone(s0));
    const r = apply(s0, { type: "startRnd", shopId: sh.id, picks: ZESTY, play: perfect(seed + 1, ZESTY) });
    expect(r.workshop.jobs[0]!.play).toBeUndefined();
  });

  it("catch-up equals tick-by-tick with a played job", () => {
    const s0 = lv2(5);
    const sh = shopOf(s0);
    const seed = playSeedOf(structuredClone(s0));
    const start = apply(s0, { type: "startRnd", shopId: sh.id, picks: ZESTY, play: perfect(seed, ZESTY) });
    const a = advanceTo(start, start.tick + 300, { nobodyPresent: false });
    let b = start;
    for (let i = 0; i < 300; i++) b = advanceTo(b, b.tick + 1, { nobodyPresent: false });
    expect(JSON.stringify(a.workshop)).toBe(JSON.stringify(b.workshop));
  });
});

describe("tech plan & analysis (pure)", () => {
  it("plan is normalised to 100 and the default plan is neutral-ish", () => {
    const n = normalizePlan({ speed: 300, rigor: 0, thrift: 0 });
    expect(n.speed + n.rigor + n.thrift).toBe(100);
    const fast = planEffects(normalizePlan({ speed: 100, rigor: 0, thrift: 0 }));
    const slow = planEffects(normalizePlan({ speed: 0, rigor: 100, thrift: 0 }));
    expect(fast.ticksMult).toBeLessThan(slow.ticksMult);
    expect(fast.costMult).toBeGreaterThan(slow.costMult);
  });

  it("analysis scoring is 0..1, deterministic and rewards the right answers", () => {
    const lv = makeAnalysisLevel(42);
    const right = lv.questions.map((q) => q.truth);
    expect(scoreAnalysis(lv, right)).toBe(1);
    expect(scoreAnalysis(lv, [9, 9, 9])).toBeLessThan(0.5);
    expect(makeAnalysisLevel(42)).toEqual(lv);
  });

  it("grades follow points and luck", () => {
    expect(techGrade(0, 0.99)).toBe(0);
    expect(techGrade(10, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe("tech projects", () => {
  const rich = (s: MallState): MallState => ({ ...structuredClone(s), funds: 50_000_000 });

  it("standard start (no plan) costs exactly the table price and time", () => {
    const s = rich(mk(7));
    const t = TECH_BY_ID["t_app"]!;
    const a = apply(s, { type: "startTech", id: "t_app" });
    const job = a.tech.jobs[0]!;
    expect(s.funds - a.funds).toBe(t.cost);
    expect(job.endTick - job.startTick).toBe(t.ticks);
  });

  it("a plan changes cost and time and is validated/normalised", () => {
    const s = rich(mk(7));
    const t = TECH_BY_ID["t_app"]!;
    const fast = apply(s, { type: "startTech", id: "t_app", plan: { speed: 100, rigor: 0, thrift: 0 } });
    const job = fast.tech.jobs[0]!;
    expect(job.endTick - job.startTick).toBeLessThan(t.ticks);
    expect(job.cost).toBeGreaterThan(t.cost);
    expect(job.plan!.speed + job.plan!.rigor + job.plan!.thrift).toBe(100);
  });

  function runToExperiment(seed = 7): MallState {
    let s = apply(rich(mk(seed)), { type: "startTech", id: "t_app" });
    for (let i = 0; i < 4000 && !s.tech.jobs[0]?.exp; i++) s = advanceTo(s, s.tick + 6, { nobodyPresent: false });
    return s;
  }

  it("an experiment appears mid-way, can be settled with analysis, and is validated", () => {
    const s = runToExperiment();
    const job = s.tech.jobs[0]!;
    expect(job.exp).toBeTruthy();
    expect(fails(s, { type: "techExperiment", id: "nope", optionId: "x" })).toContain("沒有在研發");
    expect(fails(s, { type: "techExperiment", id: job.id, optionId: "bogus" })).not.toBeNull();
    expect(fails(s, { type: "techExperiment", id: job.id, optionId: TECH_EXP_BY_ID[job.exp!.kind]!.options[0]!.id, analysis: [1.5, 0, 0] })).toContain("無效");
    const lv = makeAnalysisLevel(job.seed!);
    const opt = TECH_EXP_BY_ID[job.exp!.kind]!.options[0]!;
    const withA = apply(s, { type: "techExperiment", id: job.id, optionId: opt.id, analysis: lv.questions.map((q) => q.truth) });
    const without = apply(s, { type: "techExperiment", id: job.id, optionId: opt.id });
    const j1 = withA.tech.jobs[0] as TechJob;
    const j0 = without.tech.jobs[0] as TechJob;
    expect(j1.exp).toBeNull();
    expect(j1.expDone).toBe(true);
    expect((j1.points ?? 0) - (j0.points ?? 0)).toBeCloseTo(ANALYSIS_MAX_POINTS, 1);
    expect(fails(withA, { type: "techExperiment", id: job.id, optionId: opt.id })).not.toBeNull();
  });

  it("an unattended experiment falls back to the default and the project still completes with a grade", () => {
    let s = runToExperiment(11);
    s = advanceTo(s, s.tech.jobs[0]!.endTick + 5, { nobodyPresent: false });
    expect(s.tech.jobs).toHaveLength(0);
    expect(s.tech.done).toContain("t_app");
    expect([0, 1, 2]).toContain(s.tech.grades?.["t_app"]);
  });

  it("catch-up equals tick-by-tick with a project running", () => {
    const start = apply(rich(mk(3)), { type: "startTech", id: "t_app", plan: { speed: 30, rigor: 50, thrift: 20 } });
    const a = advanceTo(start, start.tick + 500, { nobodyPresent: false });
    let b = start;
    for (let i = 0; i < 500; i++) b = advanceTo(b, b.tick + 1, { nobodyPresent: false });
    expect(JSON.stringify(a.tech)).toBe(JSON.stringify(b.tech));
    expect(a.funds).toBe(b.funds);
  });

  it("old saves without the new optional fields still finish", () => {
    let s = apply(rich(mk(7)), { type: "startTech", id: "t_app" });
    const j = s.tech.jobs[0]!;
    delete (j as Partial<TechJob>).plan;
    delete (j as Partial<TechJob>).points;
    delete (j as Partial<TechJob>).seed;
    delete (j as Partial<TechJob>).expDone;
    delete (j as Partial<TechJob>).exp;
    s = advanceTo(s, j.endTick + 5, { nobodyPresent: false });
    expect(s.tech.done).toContain("t_app");
  });
});
