import { describe, expect, it } from "vitest";
import {
  COMPLAINT_CAUSES,
  COMPLAINT_DEADLINE_TICKS,
  COMPLAINT_OPTIONS,
  EVENTS,
  EVENT_BY_ID,
  LATE_PENALTY,
  MAX_OPEN_COMPLAINTS,
  TICKS_PER_DAY,
  TICK_MINUTES,
  WALK_COOLDOWN_TICKS,
  WALK_SITUATIONS,
  complaintCost,
  complaintIdx,
  defaultComplaintOption,
  reviewIdx,
  type MallState,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, stepTick, type Command } from "./sim";
import { isUnreasonable, noteGrievance, resolveInbox } from "./sim/guests";
import { createRng } from "./sim/rng";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000); // 3 月（沒有颱風季事件）
const DAY = TICKS_PER_DAY;

const must = (r: ReturnType<typeof applyCommand>): MallState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const apply = (s: MallState, c: Command) => must(applyCommand(s, c));

/** 讓一間店缺貨，逼出缺貨客訴 */
function starvedMall(seed = 3): MallState {
  let s = createInitialState(seed, START);
  for (const shop of s.shops) {
    s = apply(s, { type: "setRestock", shopId: shop.id, rule: { enabled: false } });
  }
  for (const shop of s.shops) shop.stock = 0;
  return s;
}

function complaintMall(): MallState {
  const s = createInitialState(5, START);
  const shop = s.shops[0]!;
  const rng = createRng(1);
  for (let i = 0; i < COMPLAINT_CAUSES.stockout.threshold; i++) noteGrievance(s, rng, shop, "local", "stockout");
  return s;
}

describe("pure guest rules", () => {
  it("complaint outcomes: apology/comp/refund help real complaints; declining hurts — unless the guest is a troublemaker", () => {
    expect(complaintIdx("comp", false)).toBeGreaterThan(complaintIdx("apologize", false));
    expect(complaintIdx("decline", false)).toBeLessThan(0);
    expect(complaintIdx("decline", true)).toBeGreaterThan(0);
    expect(complaintIdx("refund", true)).toBe(0); // 被敲詐，花了錢換不到好感
    expect(complaintCost("comp", 1000)).toBe(2000);
    expect(complaintCost("apologize", 1000)).toBe(0);
  });

  it("stance decides the default option by tone", () => {
    expect(defaultComplaintOption("demanding", "firm")).toBe("decline");
    expect(defaultComplaintOption("sincere", "firm")).toBe("apologize");
    expect(defaultComplaintOption("sincere", "soft")).toBe("comp");
    expect(defaultComplaintOption("demanding", "soft")).toBe("apologize");
    expect(defaultComplaintOption("angry", "balanced")).toBe("apologize");
  });

  it("review replies: funny backfires on bad reviews, sincere helps most", () => {
    expect(reviewIdx("funny", 1)).toBeLessThan(0);
    expect(reviewIdx("sincere", 1)).toBeGreaterThan(reviewIdx("polite", 1));
    expect(reviewIdx("funny", 5)).toBeGreaterThan(reviewIdx("polite", 5));
    expect(reviewIdx("ignore", 5)).toBe(0);
  });

  it("every guest event has a valid default option and uses only whitelisted effect types", () => {
    const guest = EVENTS.filter((e) => e.category === "guest");
    expect(guest.length).toBeGreaterThanOrEqual(8);
    for (const e of guest) {
      expect(e.choice, e.id).toBeDefined();
      expect(e.choice!.options.some((o) => o.id === e.choice!.defaultOption)).toBe(true);
    }
  });

  it("every walk situation has options with sane costs", () => {
    for (const sit of Object.values(WALK_SITUATIONS)) {
      expect(sit.options.length).toBeGreaterThanOrEqual(2);
      for (const o of sit.options) {
        expect(o.cost).toBeGreaterThanOrEqual(0);
        expect(o.cost).toBeLessThanOrEqual(10_000);
      }
    }
  });
});

describe("complaints", () => {
  it("accumulated grievances become a complaint with a tone and shop-specific text", () => {
    const s = complaintMall();
    expect(s.inbox).toHaveLength(1);
    const c = s.inbox[0]!;
    expect(c.kind).toBe("complaint");
    expect(c.cause).toBe("stockout");
    expect(["sincere", "angry", "demanding"]).toContain(c.tone);
    expect(c.text).toContain(s.shops[0]!.name);
    expect(c.deadlineTick - c.createdTick).toBe(COMPLAINT_DEADLINE_TICKS);
    expect(s.today.complaints).toBe(1);
  });

  it("a cooldown stops the same shop/cause from immediately complaining again", () => {
    const s = complaintMall();
    const rng = createRng(2);
    for (let i = 0; i < 40; i++) noteGrievance(s, rng, s.shops[0]!, "local", "stockout");
    expect(s.inbox.filter((i) => i.kind === "complaint")).toHaveLength(1);
  });

  it("is capped per day and by open complaints", () => {
    const s = createInitialState(5, START);
    const rng = createRng(3);
    for (const shop of s.shops) {
      for (const cause of ["stockout", "wait", "price", "dirty"] as const) {
        for (let i = 0; i < 30; i++) noteGrievance(s, rng, shop, "local", cause);
      }
    }
    expect(s.inbox.length).toBeLessThanOrEqual(3); // MAX_COMPLAINTS_PER_DAY
    expect(s.inbox.length).toBeLessThanOrEqual(MAX_OPEN_COMPLAINTS);
  });

  it("a starved mall really generates complaints from stockouts in the simulation", () => {
    let s = starvedMall();
    s = advanceTo(s, START + 3 * DAY);
    const all = s.log.filter((l) => l.text.includes("客訴"));
    expect(all.length).toBeGreaterThan(0);
  });

  it("handling a complaint costs money for comp/refund, applies the index change, and removes it", () => {
    let s = complaintMall();
    const item = s.inbox[0]!;
    const shop = s.shops.find((x) => x.id === item.shopId)!;
    const before = { funds: s.funds, rep: s.localRep };
    const unreasonable = isUnreasonable(s, item);
    s = apply(s, { type: "resolveInbox", uid: item.uid, optionId: "comp" });
    expect(s.inbox).toHaveLength(0);
    expect(s.funds).toBe(before.funds - complaintCost("comp", shop.price));
    expect(s.localRep - before.rep).toBeCloseTo(complaintIdx("comp", unreasonable), 5);
  });

  it("rejects invalid options, unknown ids, and unaffordable options", () => {
    const s = complaintMall();
    const item = s.inbox[0]!;
    expect(applyCommand(s, { type: "resolveInbox", uid: item.uid, optionId: "bribe" }).ok).toBe(false);
    expect(applyCommand(s, { type: "resolveInbox", uid: "nope", optionId: "apologize" }).ok).toBe(false);
    const broke = structuredClone(s);
    broke.funds = 10;
    expect(applyCommand(broke, { type: "resolveInbox", uid: item.uid, optionId: "refund" }).ok).toBe(false);
    expect(applyCommand(broke, { type: "resolveInbox", uid: item.uid, optionId: "apologize" }).ok).toBe(true);
  });

  it("unattended complaints are resolved at the deadline using the stance, with a small late penalty", () => {
    for (const stance of ["soft", "balanced", "firm"] as const) {
      let s = complaintMall();
      s = apply(s, { type: "setGuestPrefs", complaintStance: stance });
      const item = s.inbox[0]!;
      const target = item.deadlineTick + 1;
      // 把餘下的時間用逐 tick 推進（營業中的客流也會影響口碑，所以只比較「有沒有處理掉」）
      s = advanceTo(s, target);
      expect(s.inbox.some((i) => i.uid === item.uid)).toBe(false);
      const expected = defaultComplaintOption(item.tone!, stance);
      const logged = s.log.some((l) => l.text.includes("逾期") && l.text.includes(COMPLAINT_OPTIONS.find((o) => o.id === expected)!.label));
      expect(logged, `stance ${stance}`).toBe(true);
    }
    expect(LATE_PENALTY).toBeGreaterThan(0);
  });

  it("when auto-handling can't afford the stance's option it falls back to a free apology", () => {
    let s = complaintMall();
    s = apply(s, { type: "setGuestPrefs", complaintStance: "soft" });
    s.funds = 1;
    const item = s.inbox[0]!;
    const r = resolveInbox(s, item.uid, null);
    expect(r.ok).toBe(true);
    expect(s.funds).toBe(1);
  });

  it("whether a guest is a troublemaker is deterministic but not stored in the state", () => {
    const s = complaintMall();
    const item = s.inbox[0]!;
    expect(isUnreasonable(s, item)).toBe(isUnreasonable(s, item));
    expect(JSON.stringify(item)).not.toMatch(/unreasonable|troublemaker/i);
    // 強勢索討的語氣比誠懇的更常是奧客
    let demanding = 0;
    let sincere = 0;
    for (let n = 1; n <= 400; n++) {
      const base = { ...item, uid: `in${n}` };
      if (isUnreasonable(s, { ...base, tone: "demanding" })) demanding++;
      if (isUnreasonable(s, { ...base, tone: "sincere" })) sincere++;
    }
    expect(demanding).toBeGreaterThan(sincere * 5);
  });
});

describe("reviews", () => {
  it("each game day produces a few reviews with star ratings that track satisfaction", () => {
    let s = createInitialState(9, START);
    s = advanceTo(s, START + 4 * DAY + 5);
    const reviews = [...s.inbox.filter((i) => i.kind === "review"), ...s.reviewLog];
    expect(reviews.length).toBeGreaterThanOrEqual(3);
    for (const r of s.inbox.filter((i) => i.kind === "review")) {
      expect(r.stars).toBeGreaterThanOrEqual(1);
      expect(r.stars).toBeLessThanOrEqual(5);
    }
    const lastReport = s.reports.at(-1)!;
    expect(lastReport.guest?.reviews).toBeGreaterThan(0);
  });

  it("replying updates the index and records the reply; ignoring does nothing", () => {
    let s = createInitialState(9, START);
    s = advanceTo(s, START + 2 * DAY + 5);
    const review = s.inbox.find((i) => i.kind === "review")!;
    expect(review).toBeDefined();
    const before = s.localRep + s.touristHeat;
    s = apply(s, { type: "resolveInbox", uid: review.uid, optionId: "sincere" });
    expect(s.inbox.some((i) => i.uid === review.uid)).toBe(false);
    expect(s.reviewLog[0]!.reply).toBe("sincere");
    expect(s.localRep + s.touristHeat - before).toBeCloseTo(reviewIdx("sincere", review.stars!), 5);
    expect(applyCommand(s, { type: "resolveInbox", uid: review.uid, optionId: "polite" }).ok).toBe(false); // 已處理
  });

  it("unanswered reviews expire to an automatic polite reply when enabled, or nothing when disabled", () => {
    for (const auto of [true, false]) {
      let s = createInitialState(9, START);
      s = apply(s, { type: "setGuestPrefs", autoReplyReviews: auto });
      s = advanceTo(s, START + 5 * DAY);
      const expired = s.reviewLog;
      expect(expired.length).toBeGreaterThan(0);
      for (const r of expired) expect(r.reply).toBe(auto ? "auto" : null);
    }
  });

  it("never keeps more open reviews than the cap", () => {
    let s = createInitialState(9, START);
    s = advanceTo(s, START + 12 * DAY);
    expect(s.inbox.filter((i) => i.kind === "review").length).toBeLessThanOrEqual(8);
    expect(s.reviewLog.length).toBeLessThanOrEqual(24);
  });
});

describe("walking the floor", () => {
  /** 營業時間內的狀態（早上 11 點） */
  function openMall(): MallState {
    let s = createInitialState(11, START);
    s = advanceTo(s, START + Math.round(11.5 * 12) + 12 * 4); // 讓店裡有點營業紀錄
    return s;
  }

  it("is refused while the mall is closed", () => {
    const s = createInitialState(11, START); // START 是凌晨 0 點，打烊中
    const r = applyCommand(s, { type: "walkFloor" });
    expect(r.ok).toBe(false);
  });

  it("produces 3–5 voices tied to real shop situations, then has a cooldown", () => {
    let s = openMall();
    const voices = (st: MallState) => st.walk.voices;
    s = apply(s, { type: "walkFloor" });
    expect(voices(s).length).toBeGreaterThanOrEqual(1);
    expect(voices(s).length).toBeLessThanOrEqual(5);
    for (const v of voices(s)) {
      expect(s.shops.some((x) => x.id === v.shopId)).toBe(true);
      expect(WALK_SITUATIONS[v.situation]).toBeDefined();
      expect(v.text.length).toBeGreaterThan(5);
    }
    expect(s.walk.nextTick).toBe(s.tick + WALK_COOLDOWN_TICKS);
    expect(applyCommand(s, { type: "walkFloor" }).ok).toBe(false); // 冷卻中
  });

  it("acting on a voice costs money, applies effects and removes the voice", () => {
    let s = openMall();
    s = apply(s, { type: "walkFloor" });
    const v = s.walk.voices[0]!;
    const opt = WALK_SITUATIONS[v.situation]!.options.find((o) => o.cost > 0) ?? WALK_SITUATIONS[v.situation]!.options[0]!;
    const funds = s.funds;
    s = apply(s, { type: "walkAct", voiceId: v.id, optionId: opt.id });
    expect(s.funds).toBe(funds - opt.cost);
    expect(s.walk.voices.some((x) => x.id === v.id)).toBe(false);
    expect(applyCommand(s, { type: "walkAct", voiceId: v.id, optionId: opt.id }).ok).toBe(false);
  });

  it("rejects unknown options and unaffordable actions; stale voices vanish", () => {
    let s = openMall();
    s = apply(s, { type: "walkFloor" });
    const v = s.walk.voices[0]!;
    expect(applyCommand(s, { type: "walkAct", voiceId: v.id, optionId: "nonsense" }).ok).toBe(false);
    const poor = structuredClone(s);
    poor.funds = 0;
    const costly = WALK_SITUATIONS[v.situation]!.options.find((o) => o.cost > 0);
    if (costly) expect(applyCommand(poor, { type: "walkAct", voiceId: v.id, optionId: costly.id }).ok).toBe(false);
    const late = structuredClone(s);
    late.tick = v.expireTick + 1;
    expect(applyCommand(late, { type: "walkAct", voiceId: v.id, optionId: WALK_SITUATIONS[v.situation]!.options[0]!.id }).ok).toBe(false);
  });

  it("a mall with stockouts and queues hears about them on the floor", () => {
    let s = starvedMall(21);
    s = advanceTo(s, START + Math.round(13 * 12) + 24);
    let sawStockout = false;
    for (let tries = 0; tries < 6 && !sawStockout; tries++) {
      const r = applyCommand(s, { type: "walkFloor" });
      if (r.ok) {
        s = r.state;
        sawStockout = s.walk.voices.some((v) => v.situation === "stockout");
      }
      s = advanceTo(s, s.tick + WALK_COOLDOWN_TICKS + 1);
    }
    expect(sawStockout).toBe(true);
  });
});

describe("guest events", () => {
  it("resolving a guest event applies its effects and respects the default when ignored", () => {
    const def = EVENT_BY_ID.allergy_guest!;
    let s = createInitialState(2, START);
    s.pending.push({ uid: "ev50", defId: def.id, deadlineTick: s.tick + 200 });
    const funds = s.funds;
    s = apply(s, { type: "resolveEvent", uid: "ev50", optionId: "check" });
    expect(s.funds).toBe(funds - 8_000);

    let t = createInitialState(2, START);
    t.pending.push({ uid: "ev51", defId: def.id, deadlineTick: t.tick + 3 });
    t = advanceTo(t, t.tick + 10);
    expect(t.pending.some((p) => p.uid === "ev51")).toBe(false);
    expect(t.log.some((l) => l.text.includes("沒人回應") && l.text.includes("客人說自己過敏"))).toBe(true);
  });
});

describe("determinism and migration with the guest layer", () => {
  it("catch-up equals stepping tick by tick, including complaints, reviews and guests", () => {
    const a = advanceTo(starvedMall(4), START + 3 * DAY);
    let b = starvedMall(4);
    for (let i = 0; i < 3 * DAY; i++) stepTick(b);
    expect(b).toEqual(a);
  });

  it("migrates v2 states to v3 with empty guest data", () => {
    const v2 = { ...createInitialState(1, 100), version: 2 } as unknown as Record<string, unknown>;
    for (const k of ["grievances", "inbox", "reviewLog", "guestPrefs", "walk"]) delete v2[k];
    const m = migrateState(v2, 0);
    expect(m.version).toBe(5);
    expect(m.inbox).toEqual([]);
    expect(m.guestPrefs.complaintStance).toBe("balanced");
    expect(m.walk.voices).toEqual([]);
  });
});
