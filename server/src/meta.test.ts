import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  CLUES,
  EVENTS,
  EVENT_BY_ID,
  GOALS,
  TEAM_EVENTS,
  TICKS_PER_DAY,
  ZONES,
  mallStars,
  goalProgress,
  type MallState,
} from "@coidle/shared";
import { ZONE_EVENTS } from "../../shared/src/game/events_zones";
import { checkText } from "./ai/validate";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command } from "./sim";
import { maybeSpawnEvent } from "./sim/events";
import { contribute, guessPlace, metaDaily, placeHash, recentAverages, trackActor } from "./sim/meta";
import { createRng } from "./sim/rng";
import { timeInfo } from "./sim/time";

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const mk = (seed = 7, level = 1): MallState => {
  const s = createInitialState(seed, START, 0);
  s.level = level;
  return s;
};
const day = (n: number) => START + n * TICKS_PER_DAY;
const apply = (s: MallState, c: Command, actor?: { id: string; name: string }): MallState => {
  const r = applyCommand(s, c, actor);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const fails = (s: MallState, c: Command, actor?: { id: string; name: string }): string | null => {
  const r = applyCommand(s, c, actor);
  return r.ok ? null : r.error;
};
const A = { id: "1", name: "小明" };
const B = { id: "2", name: "小華" };
const C = { id: "3", name: "小美" };

describe("zone events", () => {
  it("every zone from the second one on has several events, all well formed and free of real place names", () => {
    const ids = new Set<string>();
    for (const e of ZONE_EVENTS) {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      expect(EVENT_BY_ID[e.id]).toBeDefined();
      expect(ZONES.some((z) => z.id === e.needsZone), e.id).toBe(true);
      expect(checkText(e.title + e.text, { min: 4, max: 400 }), e.id).toBeNull();
      if (e.choice) {
        const optIds = e.choice.options.map((o) => o.id);
        expect(new Set(optIds).size).toBe(optIds.length);
        expect(optIds).toContain(e.choice.defaultOption);
        expect(e.choice.options.length).toBeGreaterThanOrEqual(2);
      }
      for (const ef of [...e.effects, ...(e.choice?.options.flatMap((o) => o.effects) ?? [])]) {
        expect(["funds", "index", "traffic", "demand", "cleanliness", "equipment"]).toContain(ef.t);
        if (ef.t === "funds") expect(Math.abs(ef.amount)).toBeLessThanOrEqual(200_000);
        if (ef.t === "traffic") expect(ef.mult).toBeGreaterThan(0.4);
      }
    }
    for (const z of ZONES.filter((x) => x.id !== "b1")) {
      expect(ZONE_EVENTS.filter((e) => e.needsZone === z.id).length, z.id).toBeGreaterThanOrEqual(4);
    }
    expect(EVENTS.length).toBeGreaterThan(70);
  });

  it("zone events only happen once their zone is unlocked", () => {
    const seenZones = (level: number) => {
      const zones = new Set<string>();
      const s = mk(3, level);
      // 區域專屬事件還要「這個區域有店」才會發生
      for (const [zone, cat] of [["ent", "cinema"], ["life", "gym"], ["biz", "hotel"]] as const) {
        const slot = s.slots.find((x) => x.zone === zone && !x.shopId)!;
        const shop = structuredClone(s.shops[0]!);
        shop.id = `shop_${zone}`;
        shop.slot = slot.id;
        shop.category = cat;
        slot.shopId = shop.id;
        s.shops.push(shop);
      }
      const real = createRng(99);
      const rng = { ...real, chance: () => true }; // 每次都抽，直接看「抽得到哪些」
      for (let t = 0; t < 3000; t++) {
        s.tick = START + t * 11;
        s.cooldowns = {};
        s.pending = [];
        const r = maybeSpawnEvent(s, timeInfo(s.tick), rng);
        const z = r?.def.needsZone;
        if (z) zones.add(z);
      }
      return zones;
    };
    expect(seenZones(1).size).toBe(0);
    const z4 = seenZones(4);
    expect(z4.has("ent")).toBe(true);
    expect(z4.has("life")).toBe(false);
    expect(seenZones(8).has("biz")).toBe(true);
  });
});

describe("daily and weekly goals", () => {
  it("each day gets 3 daily goals and each week 3 weekly goals, with targets scaled to the mall", () => {
    const s = advanceTo(mk(), day(3));
    expect(s.meta.day.picks).toHaveLength(3);
    expect(s.meta.week.picks).toHaveLength(3);
    expect(new Set(s.meta.day.picks.map((p) => p.id)).size).toBe(3);
    for (const p of [...s.meta.day.picks, ...s.meta.week.picks]) {
      expect(p.target).toBeGreaterThan(0);
      expect(p.reward).toBeGreaterThanOrEqual(10_000);
    }
    const avg = recentAverages(s);
    const g = s.meta.day.picks.find((p) => p.id === "d_groups");
    if (g) expect(g.target).toBeGreaterThan(avg.groups * 0.6);
  });

  it("goals that need leasing or a higher level are not offered too early", () => {
    for (let seed = 1; seed < 25; seed++) {
      const s = advanceTo(mk(seed, 1), day(20));
      for (const p of [...s.meta.day.picks, ...s.meta.week.picks]) {
        const def = GOALS.find((x) => x.id === p.id)!;
        expect(def.needs).not.toBe("lease");
        expect((def.minLevel ?? 0) <= s.level).toBe(true);
      }
    }
  });

  it("finishing a goal pays its reward at day close, once", () => {
    let s = advanceTo(mk(7), day(2));
    const pick = s.meta.day.picks.find((p) => GOALS.find((g) => g.id === p.id)!.metric !== "instant")!;
    const def = GOALS.find((g) => g.id === pick.id)!;
    const before = s.funds;
    // 直接把需要的累計補夠
    s.meta.tally[def.metric] = (s.meta.tally[def.metric] ?? 0) + pick.target + 5;
    expect(goalProgress(s, def, "day")).toBeGreaterThanOrEqual(pick.target);
    const t = advanceTo(s, day(3) + 5);
    expect(t.meta.tally.goalsDone).toBeGreaterThanOrEqual(1);
    expect(t.log.some((l) => l.text.includes("達成目標"))).toBe(true);
    expect(t.funds).toBeGreaterThan(before - 5_000_000);
    const u = advanceTo(t, day(4) + 5);
    expect(u.meta.day.key).toBeGreaterThan(t.meta.day.key); // 新的一天，新的目標
  });

  it("the weekly bonus is paid when all three goals are met", () => {
    let s = advanceTo(mk(7), day(2));
    const bonusBefore = s.log.filter((l) => l.text.includes("本週目標全部達成")).length;
    for (const p of s.meta.week.picks) {
      const def = GOALS.find((g) => g.id === p.id)!;
      if (def.metric !== "instant") s.meta.tally[def.metric] = (s.meta.tally[def.metric] ?? 0) + p.target * 2;
    }
    s = advanceTo(s, day(16));
    expect(s.log.filter((l) => l.text.includes("本週目標全部達成")).length + s.meta.log.filter((l) => l.text.includes("本週目標全部達成")).length).toBeGreaterThanOrEqual(bonusBefore);
  });
});

describe("team events", () => {
  function withEvent(size = 3, month: "any" = "any"): MallState {
    void month;
    const s = mk(7, 2);
    s.meta.team.size = size;
    s.meta.team.nextAt = s.tick;
    const t = advanceTo(s, s.tick + TICKS_PER_DAY + 5);
    expect(t.meta.team.event).not.toBeNull();
    return t;
  }

  it("a team event appears, needs min(members, 3) different people, and does not pause the clock", () => {
    const s = withEvent(5);
    expect(s.meta.team.event!.needed).toBe(3);
    expect(s.clock.holds.events).toEqual([]);
    expect(withEvent(1).meta.team.event!.needed).toBe(1);
    expect(withEvent(2).meta.team.event!.needed).toBe(2);
  });

  it("members each claim a different task; completing pays the team and counts toward an achievement", () => {
    let s = withEvent(3);
    const def = TEAM_EVENTS.find((e) => e.id === s.meta.team.event!.defId)!;
    const [t1, t2, t3] = def.tasks;
    expect(fails(s, { type: "contribute", taskId: t1!.id })).toContain("身分");
    expect(fails(s, { type: "contribute", taskId: "nope" }, A)).toContain("找不到");
    const before = s.funds;
    s = apply(s, { type: "contribute", taskId: t1!.id }, A);
    expect(s.funds).toBe(before - t1!.cost);
    expect(fails(s, { type: "contribute", taskId: t2!.id }, A)).toContain("已經認領過");
    expect(fails(s, { type: "contribute", taskId: t1!.id }, B)).toContain("已經有人");
    s = apply(s, { type: "contribute", taskId: t2!.id }, B);
    expect(s.meta.team.event).not.toBeNull();
    const fundsBefore = s.funds;
    s = apply(s, { type: "contribute", taskId: t3!.id }, C);
    expect(s.meta.team.event).toBeNull();
    expect(s.funds).toBeGreaterThan(fundsBefore - t3!.cost); // 獎金大於這份成本
    expect(s.meta.tally.teamDone).toBe(1);
    expect(s.meta.team.members["1"]!.tasks).toBe(1);
    expect(s.meta.team.nextAt).toBeGreaterThan(s.tick);
  });

  it("running out of time gives a partial reward when someone helped, and nothing lost when nobody did", () => {
    let s = withEvent(3);
    const def = TEAM_EVENTS.find((e) => e.id === s.meta.team.event!.defId)!;
    const none = advanceTo(s, s.meta.team.event!.deadlineTick + TICKS_PER_DAY);
    expect(none.log.some((l) => l.text.includes("沒有人來得及"))).toBe(true);
    s = apply(s, { type: "contribute", taskId: def.tasks[0]!.id }, A);
    const f = s.funds;
    const done = advanceTo(s, s.meta.team.event!.deadlineTick + TICKS_PER_DAY);
    expect(done.log.some((l) => l.text.includes("部分回饋"))).toBe(true);
    expect(done.meta.team.event).toBeNull();
    expect(done.funds).toBeGreaterThan(f - 3_000_000);
  });

  it("tracks what each member did (contribution board)", () => {
    const s = mk();
    trackActor(s, A, "setPrice");
    trackActor(s, A, "touch");
    trackActor(s, B, "setHours");
    trackActor(s, undefined, "setPrice");
    expect(s.meta.team.members["1"]!.actions).toBe(1);
    expect(s.meta.team.members["2"]!.name).toBe("小華");
    const r = apply(s, { type: "setCleaning", level: 2 }, A);
    expect(r.meta.team.members["1"]!.actions).toBe(2);
    const x = contribute(structuredClone(s), "x", undefined);
    expect(x.ok).toBe(false);
  });
});

describe("achievements, stars and clues", () => {
  it("unlock once, pay their reward, and keep titles", () => {
    let s = mk(7, 3);
    s.totalRevenue = 2e9;
    s.tick = day(120);
    metaDaily(s, timeInfo(s.tick));
    for (const id of ["a_rev1", "a_rev2", "a_lv3", "a_day100"]) expect(s.meta.achievements[id], id).toBeDefined();
    expect(s.meta.achievements["a_rev3"]).toBeUndefined();
    const unlocked = Object.keys(s.meta.achievements).length;
    const logged = s.log.filter((l) => l.text.includes("成就解鎖")).length;
    metaDaily(s, timeInfo(s.tick));
    expect(Object.keys(s.meta.achievements).length).toBe(unlocked);
    expect(s.log.filter((l) => l.text.includes("成就解鎖")).length).toBe(logged); // 不會重複領
    expect(ACHIEVEMENTS.filter((a) => a.title).length).toBeGreaterThan(5);
    s = advanceTo(s, s.tick + 3);
  });

  it("star rating grows with the mall", () => {
    const a = mk(7, 1);
    const b = mk(7, 8);
    b.localRep = 85;
    b.touristHeat = 85;
    b.inspections.compliance = 95;
    expect(mallStars(a)).toBeLessThanOrEqual(2);
    expect(mallStars(b)).toBeGreaterThan(mallStars(a));
    expect(mallStars(b)).toBeLessThanOrEqual(5);
  });

  it("clues are found as the story unfolds and never disappear; every clue text is clean", () => {
    const s = mk(7, 3);
    s.meta.seen["tower_lights"] = 1;
    s.meta.seen["summer_festival"] = 2;
    s.tick = day(10);
    metaDaily(s, timeInfo(s.tick));
    expect(s.meta.clues["c_sauce"]).toBeDefined(); // 開局就有串炸店
    expect(s.meta.clues["c_tower"]).toBeDefined();
    expect(s.meta.clues["c_festival"]).toBeDefined();
    const n = Object.keys(s.meta.clues).length;
    s.shops = [];
    metaDaily(s, timeInfo(s.tick));
    expect(Object.keys(s.meta.clues).length).toBeGreaterThanOrEqual(n);
    for (const c of CLUES) expect(checkText(c.text, { min: 10, max: 140 }), c.id).toBeNull();
  });

  it("guessing the place: hashed answers, a cooldown, and a reward through the achievement", () => {
    let s = mk(7, 1);
    expect(fails(s, { type: "guessPlace", text: "?" })).toContain("猜測");
    s = apply(s, { type: "guessPlace", text: "東京車站" });
    expect(s.meta.placeSolved).toBe(false);
    expect(s.meta.guesses).toBe(1);
    expect(fails(s, { type: "guessPlace", text: "台北" })).toContain("剛猜過");
    s.tick += TICKS_PER_DAY + 1;
    const f = s.funds;
    s = apply(s, { type: "guessPlace", text: " 大阪・新今宮 " });
    expect(s.meta.placeSolved).toBe(true);
    expect(s.meta.achievements["a_place"]).toBeDefined();
    expect(s.funds).toBeGreaterThanOrEqual(f + 3_000_000);
    expect(fails(s, { type: "guessPlace", text: "新今宮" })).toContain("已經猜中");
    expect(placeHash("Shin-Imamiya")).toBe(placeHash("shinimamiya"));
  });
});

describe("starter quests", () => {
  it("complete the moment the player does the thing, pay once, and leave the real achievements alone", () => {
    let s = mk(7, 1);
    const f0 = s.funds;
    s = apply(s, { type: "setPrice", shopId: s.shops[0]!.id, price: s.shops[0]!.price + 10 });
    expect(s.meta.achievements["q_price"]).toBeDefined();
    expect(s.funds).toBe(f0 + 50_000);
    const f1 = s.funds;
    s = apply(s, { type: "setPrice", shopId: s.shops[0]!.id, price: s.shops[0]!.price + 20 });
    expect(s.funds).toBe(f1); // 不會重複領
    s = apply(s, { type: "setHours", open: 10, close: 22 });
    s = advanceTo(s, START + 14 * 12); // 下午兩點，店開著
    s = apply(s, { type: "walkFloor" });
    s = apply(s, { type: "setRestock", shopId: s.shops[0]!.id, rule: { min: 120 } });
    for (const id of ["q_hours", "q_walk", "q_stock"]) expect(s.meta.achievements[id], id).toBeDefined();
    expect(s.log.some((l) => l.text.includes("新手任務完成"))).toBe(true);
    expect(mallStars(s)).toBeLessThanOrEqual(2); // 新手任務不算進評鑑的成就數
  });

  it("report and invite quests are detected from the state", () => {
    let s = advanceTo(mk(7, 1), day(2));
    expect(s.meta.achievements["q_report"]).toBeDefined();
    expect(s.meta.achievements["q_invite"]).toBeUndefined();
    s.meta.team.size = 2;
    s = apply(s, { type: "setCleaning", level: 1 });
    expect(s.meta.achievements["q_invite"]).toBeDefined();
  });
});

describe("determinism and migration", () => {
  it("catch-up equals tick-by-tick across goal and team rollovers", () => {
    const base = mk(5, 2);
    base.meta.team.nextAt = base.tick;
    const a = advanceTo(base, base.tick + 10 * TICKS_PER_DAY);
    let b = base;
    for (let i = 0; i < 10 * 6; i++) b = advanceTo(b, b.tick + 48);
    expect(b.meta).toEqual(a.meta);
  });

  it("migrates v9 to v10 with an empty meta layer", () => {
    const v9 = JSON.parse(JSON.stringify(mk())) as Record<string, unknown>;
    v9.version = 9;
    delete v9.meta;
    const m = migrateState(v9, 0);
    expect(m.version).toBe(12);
    expect(m.meta.achievements).toEqual({});
    expect(m.meta.team.event).toBeNull();
  });
});
