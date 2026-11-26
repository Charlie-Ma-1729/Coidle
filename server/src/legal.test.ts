import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  EVENT_BY_ID,
  INSURANCE,
  LEGAL_KINDS,
  LEGAL_KIND_ORDER,
  MAX_OPEN_CASES,
  MEDIATION_NOSHOW_FINE,
  TICKS_PER_DAY,
  TICK_MINUTES,
  ZONES,
  defaultLegalOption,
  insurancePayout,
  judgmentOdds,
  lawyerFee,
  legalKindsFor,
  legalOptions,
  settleChance,
  type LawsuitCase,
  type LegalKind,
  type MallState,
  type Shop,
} from "@coidle/shared";
import { applyCommand, createInitialState } from "./sim";
import { spawnEvent } from "./sim/events";
import { applyLegalRisk, faultOf, legalDaily, legalOf, maybeEscalateComplaint, openCase, resolveLegal, resolveLegalDeadlines, setInsurance } from "./sim/legal";
import { createRng } from "./sim/rng";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);

function mall(seed = 1): MallState {
  const s = createInitialState(seed, START);
  s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
  s.funds = 50_000_000;
  return s;
}
const foodShop = (s: MallState): Shop => s.shops.find((x) => legalKindsFor(x.category).includes("food_poison"))!;
function open(s: MallState, kind: LegalKind = "food_poison", seed = 1): LawsuitCase {
  const c = openCase(s, createRng(seed), foodShop(s), kind, "angry");
  if (!c) throw new Error("case not opened");
  return c;
}

describe("legal data covers every floor", () => {
  it("every category has at least one kind of legal trouble, and every zone shows up", () => {
    for (const c of CATEGORIES) expect(legalKindsFor(c.id).length, c.id).toBeGreaterThan(0);
    const zonesWithKinds = new Set(CATEGORIES.filter((c) => legalKindsFor(c.id).length > 0).map((c) => c.zone));
    for (const z of ZONES) expect(zonesWithKinds.has(z.id), z.id).toBe(true);
  });

  it("each kind names real laws, a sane claim range and is reachable by some category", () => {
    for (const k of LEGAL_KIND_ORDER) {
      const def = LEGAL_KINDS[k];
      expect(def.laws.length, k).toBeGreaterThan(0);
      expect(def.claim[0]).toBeLessThan(def.claim[1]);
      expect(CATEGORIES.some((c) => legalKindsFor(c.id).includes(k)), k).toBe(true);
    }
  });

  it("restaurants, shops, entertainment, services and hotels each meet their own kinds of trouble", () => {
    expect(legalKindsFor("ramen")).toContain("food_poison");
    expect(legalKindsFor("fashion")).toContain("defect");
    expect(legalKindsFor("bowling")).toContain("injury");
    expect(legalKindsFor("dental")).toContain("malpractice");
    expect(legalKindsFor("hotel")).toContain("lodging");
  });
});

describe("legal math", () => {
  it("odds sum to 1 and move the right way", () => {
    for (const x of [0, 0.3, 0.6, 1]) {
      const o = judgmentOdds(x);
      expect(o.dismiss + o.partial + o.full).toBeCloseTo(1, 6);
    }
    expect(judgmentOdds(0.9).full).toBeGreaterThan(judgmentOdds(0.2).full);
    expect(judgmentOdds(0.2).dismiss).toBeGreaterThan(judgmentOdds(0.9).dismiss);
    expect(settleChance(0.2, 0.2)).toBeGreaterThan(settleChance(0.9, 0.2));
  });

  it("insurance pays a share above the deductible, capped, and nothing when uninsured", () => {
    expect(insurancePayout(0, 1_000_000)).toBe(0);
    expect(insurancePayout(1, 1_000_000)).toBeCloseTo((1_000_000 - 50_000) * 0.5, 5);
    expect(insurancePayout(2, 100_000_000)).toBe(INSURANCE[2]!.cap);
    expect(insurancePayout(2, 10_000)).toBe(0);
  });

  it("options differ by stage, lawyer is paid once, and defaults follow the stance", () => {
    const base = { claim: 500_000, lawyer: false };
    expect(legalOptions({ ...base, stage: "demand" }).map((o) => o.id)).toEqual(["settle", "negotiate", "lawyer", "refuse"]);
    expect(legalOptions({ ...base, stage: "mediation" }).map((o) => o.id)).toEqual(["settle", "attend", "lawyer", "skip"]);
    expect(legalOptions({ ...base, stage: "trial" }).map((o) => o.id)).toEqual(["settle", "contest", "lawyer"]);
    expect(legalOptions({ ...base, stage: "demand" }).find((o) => o.id === "lawyer")!.cost).toBe(lawyerFee(500_000));
    expect(legalOptions({ ...base, lawyer: true, stage: "demand" }).find((o) => o.id === "lawyer")!.cost).toBe(0);
    expect(defaultLegalOption("demand", "soft")).toBe("settle");
    expect(defaultLegalOption("demand", "firm")).toBe("refuse");
    expect(defaultLegalOption("mediation", "balanced")).toBe("attend");
    expect(defaultLegalOption("trial", "firm")).toBe("contest");
  });
});

describe("opening cases", () => {
  it("opens with a request letter, a deadline and a cooldown, and caps the number of open cases", () => {
    const s = mall();
    const c = open(s);
    expect(c.stage).toBe("demand");
    expect(c.deadlineTick).toBeGreaterThan(s.tick);
    expect(c.claim).toBeGreaterThanOrEqual(10_000);
    expect(c.history.length).toBe(1);
    expect(s.today.systemNotes.some((n) => n.includes("請求書"))).toBe(true);
    expect(openCase(s, createRng(2), foodShop(s), "allergy", null)).toBeNull(); // 冷卻中
    legalOf(s).nextAt = 0;
    expect(openCase(s, createRng(2), foodShop(s), "allergy", null)).not.toBeNull();
    legalOf(s).nextAt = 0;
    expect(legalOf(s).cases.length).toBe(MAX_OPEN_CASES);
    expect(openCase(s, createRng(3), foodShop(s), "allergy", null)).toBeNull(); // 上限
  });

  it("the other side's real merit is hidden from the state and follows the complaint tone", () => {
    const s = mall();
    const c = open(s);
    expect(JSON.stringify(c)).not.toContain("fault");
    const sincere = { uid: "lw5", tone: "sincere" as const };
    const demanding = { uid: "lw5", tone: "demanding" as const };
    expect(faultOf(s, sincere)).toBeGreaterThan(faultOf(s, demanding));
  });

  it("an allergy event ignored is likely to turn into a case, a careful answer rarely does", () => {
    let ignored = 0;
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const option of ["ignore", "check"] as const) {
        const s = mall(seed);
        spawnEvent(s, EVENT_BY_ID.allergy_guest!, createRng(seed));
        const r = applyCommand(s, { type: "resolveEvent", uid: s.pending[0]!.uid, optionId: option });
        if (!r.ok) throw new Error(r.error);
        if (option === "ignore") ignored += (r.state.legal?.cases.length ?? 0) > 0 ? 1 : 0;
        else checked += (r.state.legal?.cases.length ?? 0) > 0 ? 1 : 0;
      }
    }
    expect(ignored).toBeGreaterThan(10);
    expect(checked).toBe(0);
  });

  it("applyLegalRisk only hits shops of a matching kind", () => {
    const s = mall();
    applyLegalRisk(s, "malpractice", 1, createRng(1)); // 起手的店都是餐飲，沒有人會遇到施術糾紛
    expect(legalOf(s).cases.length).toBe(0);
    applyLegalRisk(s, "food_poison", 1, createRng(1));
    expect(legalOf(s).cases.length).toBe(1);
  });

  it("badly handled serious complaints sometimes escalate; mild apologies almost never", () => {
    let hard = 0;
    let soft = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const a = mall(seed);
      maybeEscalateComplaint(a, { uid: `in${seed}`, shopId: foodShop(a).id, cause: "quality", tone: "demanding", option: "decline", byDefault: true, unreasonable: false });
      hard += legalOf(a).cases.length;
      const b = mall(seed);
      maybeEscalateComplaint(b, { uid: `in${seed}`, shopId: foodShop(b).id, cause: "quality", tone: "sincere", option: "refund", byDefault: false, unreasonable: false });
      soft += legalOf(b).cases.length;
    }
    expect(hard).toBeGreaterThan(soft * 5);
    expect(hard).toBeGreaterThan(10);
    // 缺貨、等太久這類不會變成法律糾紛
    const s = mall();
    maybeEscalateComplaint(s, { uid: "in1", shopId: foodShop(s).id, cause: "stockout", tone: "demanding", option: "decline", byDefault: true, unreasonable: true });
    expect(legalOf(s).cases.length).toBe(0);
  });

  it("a messy, poorly kept mall is sued more often than a clean one", () => {
    const count = (clean: number, equip: number) => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const s = mall(seed);
        s.cleanliness = clean;
        s.equipment = equip;
        s.inspections.compliance = clean < 50 ? 20 : 90;
        s.tick += seed * 7;
        legalDaily(s);
        n += legalOf(s).cases.length;
      }
      return n;
    };
    expect(count(10, 10)).toBeGreaterThan(count(90, 90) * 3);
  });
});

describe("resolving cases", () => {
  it("settling at the demand stage pays 80% quietly and closes the case without a reputation hit", () => {
    const s = mall();
    const c = open(s);
    const funds = s.funds;
    const local = s.localRep;
    const r = resolveLegal(s, c.uid, "settle");
    expect(r.ok).toBe(true);
    expect(funds - s.funds).toBe(Math.round(c.claim * 0.8));
    expect(s.localRep).toBe(local);
    expect(legalOf(s).cases.length).toBe(0);
    expect(legalOf(s).closed[0]).toMatchObject({ outcome: "settled", paid: Math.round(c.claim * 0.8) });
    expect(s.today.legalCost).toBe(Math.round(c.claim * 0.8));
  });

  it("insurance covers part of the settlement but never the lawyer's fee", () => {
    const s = mall();
    expect(setInsurance(s, 2).ok).toBe(true);
    expect(setInsurance(s, 2).ok).toBe(false);
    expect(setInsurance(s, 9).ok).toBe(false);
    const c = open(s);
    expect(c.insured).toBe(2);
    const gross = Math.round(c.claim * 0.8);
    const funds = s.funds;
    resolveLegal(s, c.uid, "settle");
    expect(funds - s.funds).toBe(gross - Math.round(insurancePayout(2, gross)));
    expect(legalOf(s).totalInsured).toBeGreaterThan(0);
  });

  it("a failed negotiation moves on to mediation, then to a trial; the lawyer is paid only once", () => {
    // 找一個一路談不攏的種子（協商與調停都失敗），再驗證階段與費用
    for (let seed = 1; seed <= 300; seed++) {
      const s = mall(seed);
      const c = open(s, "food_poison", seed);
      c.evidence = 10; // 證據很弱，協商幾乎不會成功
      const f0 = s.funds;
      resolveLegal(s, c.uid, "lawyer");
      if ((c.stage as string) !== "mediation") continue;
      expect(c.lawyer).toBe(true);
      expect(f0 - s.funds).toBe(lawyerFee(c.claim));
      const f1 = s.funds;
      resolveLegal(s, c.uid, "lawyer");
      if ((c.stage as string) !== "trial") continue;
      expect(f1 - s.funds).toBe(0); // 已委任，不再收律師費
      return;
    }
    throw new Error("no unlucky seed found");
  });

  it("skipping mediation costs the fine and goes to trial; small claims have a shorter deadline", () => {
    const s = mall();
    const c = open(s);
    c.claim = 400_000;
    resolveLegal(s, c.uid, "refuse");
    expect(c.stage).toBe("mediation");
    const funds = s.funds;
    resolveLegal(s, c.uid, "skip");
    expect(c.stage).toBe("trial");
    expect(funds - s.funds).toBe(MEDIATION_NOSHOW_FINE);
    expect(c.deadlineTick - c.stageTick).toBe(3 * TICKS_PER_DAY); // 少額訴訟
  });

  it("trial verdicts include dismissals, partial and full losses; losing hurts reputation and can bring an inspection", () => {
    const seen = new Set<string>();
    let lostChecked = false;
    for (let seed = 1; seed <= 400 && seen.size < 3; seed++) {
      const s = mall(seed);
      const c = open(s, "food_poison", seed);
      c.stage = "trial";
      c.evidence = 40;
      const local = s.localRep;
      const before = s.inspections.nextAt.hygiene!;
      const r = resolveLegal(s, c.uid, "contest");
      expect(r.ok).toBe(true);
      const out = legalOf(s).closed[0]!;
      seen.add(out.outcome);
      if (out.outcome === "lost") {
        expect(s.localRep).toBeLessThan(local);
        expect(s.inspections.nextAt.hygiene!).toBeLessThan(before);
        expect(out.paid).toBe(Math.round(c.claim * 1.05));
        lostChecked = true;
      }
      if (out.outcome === "dismissed") expect(out.paid).toBe(0);
    }
    expect([...seen].sort()).toEqual(["dismissed", "lost", "partial"]);
    expect(lostChecked).toBe(true);
  });

  it("good evidence and a lawyer win more often than weak evidence without one", () => {
    const wins = (evidence: number, lawyer: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const s = mall(seed);
        const c = open(s, "food_poison", seed);
        c.stage = "trial";
        c.evidence = evidence;
        c.lawyer = lawyer;
        resolveLegal(s, c.uid, "contest");
        if (legalOf(s).closed[0]!.outcome === "dismissed") n++;
      }
      return n;
    };
    expect(wins(85, true)).toBeGreaterThan(wins(25, false) * 2);
  });

  it("is deterministic: the same case resolves the same way, whenever it is resolved", () => {
    const a = mall(7);
    const b = structuredClone(a);
    const ca = open(a, "food_poison", 7);
    const cb = open(b, "food_poison", 7);
    b.tick += 100;
    expect(cb.claim).toBe(ca.claim);
    resolveLegal(a, ca.uid, "negotiate");
    resolveLegal(b, cb.uid, "negotiate");
    expect(legalOf(a).closed.length).toBe(legalOf(b).closed.length);
    expect(a.legal!.cases.map((x) => x.stage)).toEqual(b.legal!.cases.map((x) => x.stage));
  });

  it("an overdue case is handled by the stance setting, and falls back to a free option when broke", () => {
    const s = mall();
    s.guestPrefs.complaintStance = "soft";
    const c = open(s);
    s.tick = c.deadlineTick;
    resolveLegalDeadlines(s);
    expect(legalOf(s).cases.length).toBe(0); // soft＝直接示談
    expect(legalOf(s).closed[0]!.outcome).toBe("settled");

    const t = mall(2);
    t.guestPrefs.complaintStance = "soft";
    const d = open(t, "food_poison", 2);
    t.funds = 0;
    t.tick = d.deadlineTick;
    resolveLegalDeadlines(t);
    expect(t.legal!.cases.length + t.legal!.closed.length).toBe(1); // 沒錢示談，改走不花錢的路
    expect(t.legal!.cases[0]?.stage ?? "closed").not.toBe("demand");

    const u = mall(3);
    u.guestPrefs.complaintStance = "firm";
    const e = open(u, "food_poison", 3);
    u.tick = e.deadlineTick;
    resolveLegalDeadlines(u);
    expect(u.legal!.cases[0]!.stage).toBe("mediation"); // firm＝拒絕，直接進調停
  });

  it("insurance premiums are charged daily per direct shop", () => {
    const s = mall();
    setInsurance(s, 1);
    const funds = s.funds;
    const shops = s.shops.filter((x) => x.mode === "direct").length;
    legalDaily(s);
    expect(funds - s.funds).toBe(INSURANCE[1]!.premium * shops);
  });

  it("commands: legalAction and setInsurance work through applyCommand, with validation", () => {
    const s = mall();
    const c = open(s);
    const bad = applyCommand(s, { type: "legalAction", uid: c.uid, optionId: "nope" });
    expect(bad.ok).toBe(false);
    const missing = applyCommand(s, { type: "legalAction", uid: "lw999", optionId: "settle" });
    expect(missing.ok).toBe(false);
    const ok = applyCommand(s, { type: "legalAction", uid: c.uid, optionId: "settle" });
    expect(ok.ok).toBe(true);
    const ins = applyCommand(s, { type: "setInsurance", level: 1 });
    expect(ins.ok && ins.state.legal?.insurance).toBe(1);
    expect(applyCommand(s, { type: "setInsurance", level: 5 }).ok).toBe(false);
  });
});
