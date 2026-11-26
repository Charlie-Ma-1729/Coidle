import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  FIX_OPTIONS,
  LEGAL_KINDS,
  PATROL_CLEARED_DAYS,
  PATROL_COOLDOWN_TICKS,
  PATROL_ESCALATE_DAYS,
  PATROL_INCIDENT_DAYS,
  PATROL_KINDS,
  PATROL_KIND_ORDER,
  PATROL_MAX_ISSUES,
  PATROL_SPOTS,
  TICKS_PER_DAY,
  TICK_MINUTES,
  ZONES,
  detectChance,
  fixCost,
  issueEvidencePenalty,
  issueInspectionPenalty,
  issueLegalHazard,
  patrolAp,
  patrolKindsFor,
  patrolLevel,
  publicPatrol,
  spotsOf,
  type MallState,
  type PatrolIssue,
  type Shop,
} from "@coidle/shared";
import { applyCommand, createInitialState } from "./sim";
import { resolveInspection } from "./sim/inspections";
import { endPatrol, fixIssue, inspectSpot, patrolDaily, patrolOf, startPatrol } from "./sim/patrol";
import { toPublic } from "./services/mallService";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const DAY = TICKS_PER_DAY;

const must = (r: ReturnType<typeof applyCommand>): MallState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
function mall(seed = 1): MallState {
  const s = createInitialState(seed, START);
  s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
  s.funds = 50_000_000;
  s.tick += 12 * 12; // 中午，營業中
  return s;
}
const foodShop = (s: MallState): Shop => s.shops.find((x) => x.category === "kushikatsu") ?? s.shops[0]!;
let n = 0;
function plant(s: MallState, shop: Shop, kind: string, spot: string, severity = 2, status: PatrolIssue["status"] = "hidden"): PatrolIssue {
  const i: PatrolIssue = { uid: `tp${++n}`, kind, shopId: shop.id, spot, severity, bornTick: s.tick, worsenedTick: s.tick, status, ...(status !== "hidden" ? { hint: "線索" } : {}) };
  patrolOf(s).issues.push(i);
  return i;
}

describe("patrol data covers every floor", () => {
  it("every category has five checkpoints and at least one kind of hidden problem; every zone shows up", () => {
    for (const c of CATEGORIES) {
      const spots = spotsOf(c.id);
      expect(spots.length, c.id).toBe(5);
      for (const sp of spots) expect(PATROL_SPOTS[sp], `${c.id}:${sp}`).toBeDefined();
      expect(patrolKindsFor(c.id).length, c.id).toBeGreaterThan(0);
    }
    for (const z of ZONES) expect(CATEGORIES.some((c) => c.zone === z.id && patrolKindsFor(c.id).length > 0), z.id).toBe(true);
  });

  it("each kind is well formed: valid spots, hints, costs and legal links", () => {
    for (const id of PATROL_KIND_ORDER) {
      const k = PATROL_KINDS[id]!;
      expect(k.id).toBe(id);
      for (const sp of k.spots) expect(PATROL_SPOTS[sp], `${id}:${sp}`).toBeDefined();
      expect(k.hints[0].length).toBeGreaterThan(3);
      expect(k.hints[1].length).toBeGreaterThan(3);
      expect(k.cost).toBeGreaterThan(0);
      expect(k.incident.text.length).toBeGreaterThan(3);
      if (k.legal) expect(LEGAL_KINDS[k.legal.kind], id).toBeDefined();
      if (k.incident.legal) expect(LEGAL_KINDS[k.incident.legal.kind], id).toBeDefined();
      // 這種問題至少會出現在某個業態的某個點
      expect(CATEGORIES.some((c) => patrolKindsFor(c.id).some((x) => x.id === id)), id).toBe(true);
    }
  });

  it("restaurants, shops, entertainment, services and hotels each get their own problems", () => {
    expect(patrolKindsFor("ramen").map((k) => k.id)).toContain("hygiene_corner");
    expect(patrolKindsFor("fashion").map((k) => k.id)).toContain("shoplift");
    expect(patrolKindsFor("bowling").map((k) => k.id)).toContain("ride_safety");
    expect(patrolKindsFor("dental").map((k) => k.id)).toContain("sterilize");
    expect(patrolKindsFor("hotel").map((k) => k.id)).toContain("guest_property");
    expect(patrolKindsFor("fashion").map((k) => k.id)).not.toContain("cold_chain");
  });

  it("the level and action points grow with experience; better observers find more", () => {
    expect(patrolLevel(0)).toBe(0);
    expect(patrolLevel(200)).toBe(10);
    expect(patrolAp(0, false)).toBe(3);
    expect(patrolAp(0, true)).toBe(4);
    expect(patrolAp(200, false)).toBeGreaterThan(patrolAp(0, false));
    expect(detectChance(1, 200)).toBeGreaterThan(detectChance(1, 0));
    expect(detectChance(5, 0)).toBeGreaterThan(detectChance(1, 0));
    expect(detectChance(5, 200)).toBeLessThanOrEqual(0.95);
  });
});

describe("what the player can see", () => {
  it("hidden problems never leave the server, and hints do not reveal the kind or severity", () => {
    const s = mall();
    const shop = foodShop(s);
    plant(s, shop, "cold_chain", "cold", 4, "hidden");
    plant(s, shop, "hygiene_corner", "back", 3, "hinted");
    plant(s, shop, "gas_oil", "equip", 2, "confirmed");
    const pub = publicPatrol(s.patrol)!;
    expect(pub.issues.length).toBe(2);
    expect(pub.issues.every((i) => i.status !== "hidden")).toBe(true);
    const hinted = pub.issues.find((i) => i.status === "hinted")!;
    expect(hinted.kind).toBe("unknown");
    expect(hinted.severity).toBe(0);
    expect(pub.issues.find((i) => i.status === "confirmed")!.kind).toBe("gas_oil");
    const json = JSON.stringify(toPublic(s));
    expect(json).not.toContain("cold_chain");
    expect(json).not.toContain("hygiene_corner");
    expect(json).toContain("gas_oil");
    // 原狀態沒被改
    expect(patrolOf(s).issues.find((i) => i.kind === "hygiene_corner")!.severity).toBe(3);
  });
});

describe("a patrol", () => {
  it("needs a start, spends action points, forbids repeats and unknown spots, and ends with a report and cooldown", () => {
    let s = mall();
    const shop = foodShop(s);
    expect(applyCommand(s, { type: "patrolInspect", shopId: shop.id, spot: "back" }).ok).toBe(false); // 還沒開始
    s = must(applyCommand(s, { type: "patrolStart" }));
    const sess = () => s.patrol!.session!;
    expect(sess().ap).toBe(3);
    expect(applyCommand(s, { type: "patrolStart" }).ok).toBe(false);
    expect(applyCommand(s, { type: "patrolInspect", shopId: shop.id, spot: "treat" }).ok).toBe(false); // 這間店沒有這個點
    s = must(applyCommand(s, { type: "patrolInspect", shopId: shop.id, spot: "back" }));
    expect(sess().ap).toBe(2);
    expect(applyCommand(s, { type: "patrolInspect", shopId: shop.id, spot: "back" }).ok).toBe(false); // 重複
    s = must(applyCommand(s, { type: "patrolInspect", shopId: shop.id, spot: "cold" }));
    s = must(applyCommand(s, { type: "patrolInspect", shopId: shop.id, spot: "floor" }));
    expect(sess().ap).toBe(0);
    expect(applyCommand(s, { type: "patrolInspect", shopId: shop.id, spot: "restroom" }).ok).toBe(false); // 行動力用完
    s = must(applyCommand(s, { type: "patrolEnd" }));
    expect(s.patrol!.session).toBeNull();
    expect(s.patrol!.report).toMatchObject({ checked: 3 });
    expect(s.patrol!.xp).toBeGreaterThan(0);
    expect(applyCommand(s, { type: "patrolStart" }).ok).toBe(false); // 冷卻中
    s.tick += PATROL_COOLDOWN_TICKS;
    expect(applyCommand(s, { type: "patrolStart" }).ok).toBe(true);
  });

  it("cannot start while closed, and a patrol that runs out of time ends by itself", () => {
    const s = mall();
    expect(startPatrol(s, false).ok).toBe(false);
    expect(startPatrol(s, true).ok).toBe(true);
    s.tick += 100;
    const r = inspectSpot(s, foodShop(s).id, "floor"); // 直接呼叫，才看得到狀態被收掉
    expect(r.ok).toBe(false);
    expect(s.patrol!.session).toBeNull();
    expect(s.patrol!.report).not.toBeNull();
  });

  it("finds planted problems over many tries, confirms them, and the finder gets better with practice", () => {
    let found = 0;
    let missed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = mall(seed);
      const shop = foodShop(s);
      const i = plant(s, shop, "hygiene_corner", "back", 3);
      startPatrol(s, true);
      inspectSpot(s, shop.id, "back");
      expect(inspectSpot(s, shop.id, "back").ok).toBe(false); // 同一趟不能重複
      if (i.status === "hinted") found++;
      else missed++;
    }
    expect(found).toBeGreaterThan(25);
    expect(missed).toBeGreaterThan(0); // 不是每次都看得出來
  });

  it("deepening reveals what it is for 1 AP, and fixing needs a confirmed problem", () => {
    let s = mall();
    const shop = foodShop(s);
    const i = plant(s, shop, "hygiene_corner", "back", 3, "hinted");
    expect(applyCommand(s, { type: "patrolFix", issueId: i.uid, option: "now" }).ok).toBe(false); // 還只是線索
    expect(applyCommand(s, { type: "patrolDeepen", issueId: i.uid }).ok).toBe(false); // 還沒開始巡店
    s = must(applyCommand(s, { type: "patrolStart" }));
    const ap = s.patrol!.session!.ap;
    s = must(applyCommand(s, { type: "patrolDeepen", issueId: i.uid }));
    expect(s.patrol!.session!.ap).toBe(ap - 1);
    expect(s.patrol!.issues.find((x) => x.uid === i.uid)!.status).toBe("confirmed");
    expect(applyCommand(s, { type: "patrolDeepen", issueId: i.uid }).ok).toBe(false);
  });

  it("fix options: now removes it, pro also lifts compliance, schedule is half price and finishes later", () => {
    const costNow = fixCost("hygiene_corner", 3, "now");
    expect(fixCost("hygiene_corner", 3, "schedule")).toBeLessThan(costNow);
    expect(fixCost("hygiene_corner", 3, "pro")).toBeGreaterThan(costNow);
    expect(fixCost("hygiene_corner", 5, "now")).toBeGreaterThan(fixCost("hygiene_corner", 1, "now"));
    expect(FIX_OPTIONS.map((o) => o.id)).toEqual(["now", "schedule", "pro"]);

    let s = mall();
    const shop = foodShop(s);
    const a = plant(s, shop, "hygiene_corner", "back", 3, "confirmed");
    const funds = s.funds;
    expect(fixIssue(s, a.uid, "now").ok).toBe(true); // 直接呼叫（指令會順便領目標獎金，金額不好比）
    expect(funds - s.funds).toBe(costNow);
    expect(s.patrol!.issues.length).toBe(0);
    expect(s.patrol!.cleared[`${shop.id}:back`]).toBeGreaterThan(s.tick + (PATROL_CLEARED_DAYS.now - 1) * DAY);
    expect(s.today.repairs).toBeGreaterThanOrEqual(costNow);

    let t = mall(2);
    const comp = t.inspections.compliance;
    const b = plant(t, foodShop(t), "cold_chain", "cold", 2, "confirmed");
    t = must(applyCommand(t, { type: "patrolFix", issueId: b.uid, option: "pro" }));
    expect(t.inspections.compliance).toBe(Math.min(100, comp + 2));

    let u = mall(3);
    const c = plant(u, foodShop(u), "expired_goods", "cold", 2, "confirmed");
    u = must(applyCommand(u, { type: "patrolFix", issueId: c.uid, option: "schedule" }));
    expect(u.patrol!.issues[0]!.status).toBe("scheduled");
    expect(applyCommand(u, { type: "patrolFix", issueId: c.uid, option: "now" }).ok).toBe(false);
    u.tick += 3 * DAY;
    patrolDaily(u);
    expect(u.patrol!.issues.length).toBe(0);

    const poor = mall(4);
    const d = plant(poor, foodShop(poor), "cold_chain", "cold", 3, "confirmed");
    poor.funds = 10;
    expect(applyCommand(poor, { type: "patrolFix", issueId: d.uid, option: "now" }).ok).toBe(false);
    expect(applyCommand(poor, { type: "patrolFix", issueId: d.uid, option: "bogus" as never }).ok).toBe(false);
  });

  it("chatting with customers costs 1 AP and leaves a voice to answer", () => {
    let s = mall();
    s = must(applyCommand(s, { type: "patrolStart" }));
    const ap = s.patrol!.session!.ap;
    s = must(applyCommand(s, { type: "patrolChat", shopId: foodShop(s).id }));
    expect(s.patrol!.session!.ap).toBe(ap - 1);
    expect(s.walk.voices.length).toBeGreaterThan(0);
    expect(applyCommand(s, { type: "patrolChat", shopId: "nope" }).ok).toBe(false);
  });
});

describe("the days between patrols", () => {
  it("hidden problems appear on their own, deterministically, within caps; sloppy malls get more", () => {
    const run = (clean: number, equip: number, comp: number, seed = 1) => {
      const s = mall(seed);
      s.cleanliness = clean;
      s.equipment = equip;
      s.inspections.compliance = comp;
      for (let d = 0; d < 20; d++) {
        s.tick += DAY;
        s.cleanliness = clean;
        s.equipment = equip;
        patrolDaily(s);
      }
      return s;
    };
    const a = run(60, 60, 60);
    const b = run(60, 60, 60);
    expect(a.patrol!.issues.map((i) => `${i.kind}:${i.spot}:${i.shopId}`)).toEqual(b.patrol!.issues.map((i) => `${i.kind}:${i.spot}:${i.shopId}`));
    let good = 0;
    let messy = 0;
    for (let seed = 1; seed <= 20; seed++) {
      good += run(95, 95, 95, seed).patrol!.issues.length + run(95, 95, 95, seed).patrol!.incidents;
      messy += run(10, 10, 10, seed).patrol!.issues.length + run(10, 10, 10, seed).patrol!.incidents;
    }
    expect(messy).toBeGreaterThan(good);
    for (const i of run(10, 10, 10).patrol!.issues) {
      expect(i.severity).toBeGreaterThanOrEqual(1);
      expect(i.severity).toBeLessThanOrEqual(5);
    }
    expect(run(10, 10, 10).patrol!.issues.length).toBeLessThanOrEqual(PATROL_MAX_ISSUES);
  });

  it("an unhandled problem gets worse, hurts, and finally becomes an incident", () => {
    const s = mall();
    const shop = foodShop(s);
    const i = plant(s, shop, "equipment_wear", "equip", 1);
    const equip0 = s.equipment;
    s.tick += PATROL_ESCALATE_DAYS * DAY;
    patrolDaily(s);
    expect(patrolOf(s).issues.find((x) => x.uid === i.uid)!.severity).toBe(2);
    expect(s.equipment).toBeLessThan(equip0);
    for (let d = 0; d < 12; d++) {
      s.tick += DAY;
      patrolDaily(s);
    }
    expect(patrolOf(s).issues.find((x) => x.uid === i.uid)?.severity ?? 5).toBe(5);
    const funds = s.funds;
    for (let d = 0; d < PATROL_INCIDENT_DAYS + 2; d++) {
      s.tick += DAY;
      patrolDaily(s);
    }
    expect(patrolOf(s).incidents).toBeGreaterThan(0);
    expect(patrolOf(s).issues.find((x) => x.uid === i.uid)).toBeUndefined();
    expect(s.funds).toBeLessThan(funds); // 事故要花錢
    expect(shop.closedUntilTick).toBeGreaterThan(0); // 設備故障停業
  });

  it("scheduled problems stop getting worse; cleared spots do not grow new problems for a while", () => {
    const s = mall();
    const shop = foodShop(s);
    const i = plant(s, shop, "hygiene_corner", "back", 2, "scheduled");
    i.fixTick = s.tick + 10 * DAY;
    s.tick += 4 * DAY;
    patrolDaily(s);
    expect(patrolOf(s).issues.find((x) => x.uid === i.uid)!.severity).toBe(2);
    patrolOf(s).cleared[`${shop.id}:back`] = s.tick + 5 * DAY;
    patrolOf(s).cleared[`${shop.id}:cold`] = s.tick - 1;
    patrolDaily(s);
    expect(patrolOf(s).cleared[`${shop.id}:cold`]).toBeUndefined(); // 過期的標記被清掉
  });
});

describe("what unhandled problems cost elsewhere", () => {
  it("hurt inspection scores, raise legal risk and weaken evidence", () => {
    const s = mall();
    const shop = foodShop(s);
    expect(issueInspectionPenalty(s.patrol, "hygiene")).toBe(0);
    plant(s, shop, "hygiene_corner", "back", 4);
    plant(s, shop, "cold_chain", "cold", 3, "hinted");
    expect(issueInspectionPenalty(s.patrol, "hygiene")).toBe(8);
    expect(issueInspectionPenalty(s.patrol, "fire")).toBe(0);
    expect(issueLegalHazard(s.patrol, shop.id).total).toBeGreaterThan(0);
    expect(issueLegalHazard(s.patrol, shop.id).kinds.map((k) => k[0])).toContain("food_poison");
    expect(issueLegalHazard(s.patrol, "other").total).toBe(0);
    expect(issueEvidencePenalty(s.patrol, shop.id)).toBeGreaterThan(0);

    const clean = mall(2);
    clean.cleanliness = 100;
    clean.equipment = 100;
    resolveInspection(clean, "hygiene", "none", true);
    const base = clean.inspections.log[0]!.score;
    const dirty = mall(2);
    dirty.cleanliness = 100;
    dirty.equipment = 100;
    plant(dirty, foodShop(dirty), "hygiene_corner", "back", 5);
    resolveInspection(dirty, "hygiene", "none", true);
    expect(dirty.inspections.log[0]!.score).toBeLessThan(base);
  });

  it("endPatrol without a patrol is refused", () => {
    expect(endPatrol(mall()).ok).toBe(false);
  });
});
