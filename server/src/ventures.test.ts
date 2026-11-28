import { describe, expect, it } from "vitest";
import {
  CLASS_OPEN_COST,
  GROUP_FEE,
  GROUP_MIN_REVENUE,
  STAFFING_EVENTS,
  STAFF_HIRE_COST,
  STAFF_WAGE,
  STARTER_QUESTS,
  VENTURE_BY_KIND,
  dispatchSeason,
  maxClasses,
  maxWorkers,
  specMult,
  staffingDay,
  trainingSeason,
  type MallState,
  type StaffingState,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command } from "./sim";

// 集團與第一個事業（人力派遣・教育）：設立條件、經營指令、每日結算、事件、專攻、決定性與舊存檔相容。

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000; // 2027-04-01 JST 0 點附近
const DAY = 288;
const mk = (level = 5, funds = 500_000_000): MallState => {
  const s = createInitialState(7, START, 0);
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
  s.level = level;
  s.funds = funds;
  s.totalRevenue = GROUP_MIN_REVENUE + 1;
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
const withGroup = (s = mk()): MallState => apply(s, { type: "foundGroup", name: "測試集團" });
const withVenture = (s = withGroup()): MallState => apply(s, { type: "foundVenture", kind: "staffing" });

describe("group founding", () => {
  it("needs level, cumulative revenue, cash and a valid name; only once", () => {
    expect(fails(mk(4), { type: "foundGroup", name: "A集團" })).toMatch(/Lv\.5/);
    const poorRev = mk();
    poorRev.totalRevenue = 1;
    expect(fails(poorRev, { type: "foundGroup", name: "A集團" })).toMatch(/累計營收/);
    expect(fails(mk(5, 100), { type: "foundGroup", name: "A集團" })).toMatch(/資金不足/);
    expect(fails(mk(), { type: "foundGroup", name: "" })).toMatch(/名稱/);
    expect(fails(mk(), { type: "foundGroup", name: "一二三四五六七八九十一二三四五六七" })).toMatch(/名稱/);
    const s = mk();
    const g = apply(s, { type: "foundGroup", name: "  朝日　集團 " });
    expect(g.group?.name).toBe("朝日 集團");
    expect(s.funds - g.funds).toBe(GROUP_FEE);
    expect(fails(g, { type: "foundGroup", name: "B集團" })).toMatch(/已經設立/);
  });

  it("can be renamed after founding, not before", () => {
    expect(fails(mk(), { type: "renameGroup", name: "X" })).toMatch(/還沒有設立/);
    const g = apply(withGroup(), { type: "renameGroup", name: "新名字" });
    expect(g.group?.name).toBe("新名字");
  });
});

describe("opening the staffing venture", () => {
  it("needs a group, level and cash; costs the opening fee once", () => {
    expect(fails(mk(), { type: "foundVenture", kind: "staffing" })).toMatch(/設立集團/);
    expect(fails(withGroup(), { type: "foundVenture", kind: "nope" })).toMatch(/沒有這種事業/);
    const g = withGroup();
    const v = apply(g, { type: "foundVenture", kind: "staffing" });
    expect(g.funds - v.funds).toBe(VENTURE_BY_KIND.staffing!.cost);
    expect(v.ventures?.staffing).toMatchObject({ workers: 0, classes: 0 });
    expect(fails(v, { type: "foundVenture", kind: "staffing" })).toMatch(/已經開辦/);
    const poor = withGroup();
    poor.funds = 1000;
    expect(fails(poor, { type: "foundVenture", kind: "staffing" })).toMatch(/資金不足/);
  });
});

describe("staffing operations", () => {
  it("hiring and opening classes cost money, are capped by level, and releasing costs severance", () => {
    const s = withVenture();
    expect(fails(s, { type: "staffingOps", workers: maxWorkers(s.level) + 1 })).toMatch(/最多/);
    expect(fails(s, { type: "staffingOps", classes: maxClasses(s.level) + 1 })).toMatch(/最多/);
    expect(fails(s, { type: "staffingOps", workers: -1 })).toMatch(/無效/);
    expect(fails(s, { type: "staffingOps", priceMult: 3 })).toMatch(/倍率/);
    const a = apply(s, { type: "staffingOps", workers: 10, classes: 2, focus: "dispatch" });
    expect(s.funds - a.funds).toBe(10 * STAFF_HIRE_COST + 2 * CLASS_OPEN_COST);
    expect(a.ventures!.staffing).toMatchObject({ workers: 10, classes: 2, focus: "dispatch" });
    const b = apply(a, { type: "staffingOps", workers: 4, focus: "none" });
    expect(a.funds - b.funds).toBe(6 * STAFF_WAGE * 5);
    expect(b.ventures!.staffing!.focus).toBeUndefined();
    const broke = { ...structuredClone(a), funds: 10 };
    expect(fails(broke, { type: "staffingOps", workers: 20 })).toMatch(/資金不足/);
  });

  it("does nothing without the venture", () => {
    expect(fails(mk(), { type: "staffingOps", workers: 1 })).toMatch(/還沒有開辦/);
  });
});

describe("daily settlement", () => {
  it("revenue and costs go through the mall books; idle people and classes still cost money", () => {
    const base = apply(withVenture(), { type: "staffingOps", workers: 20, classes: 2 });
    const s = structuredClone(base);
    const d = advanceTo(s, s.tick + 3 * DAY);
    const v = d.ventures!.staffing!;
    expect(v.hist.length).toBeGreaterThanOrEqual(2);
    // 事業的累計損益 = 每日（營收 − 成本）的總和 − 當初開辦與調整的花費
    const ops = apply(withGroup(), { type: "foundVenture", kind: "staffing" });
    const spent = ops.funds - base.funds; // 招募與開班
    const sum = v.hist.reduce((a, r) => a + r.revenue - r.cost, 0);
    expect(Math.round(v.profit)).toBe(Math.round(-VENTURE_BY_KIND.staffing!.cost - spent + sum));
    // 閒置照付：沒有人也沒有班，成本是 0；有人有班但需求為 0 的情況成本仍在
    const none = advanceTo(structuredClone(withVenture()), s.tick + 2 * DAY).ventures!.staffing!;
    expect(none.hist.every((r) => r.cost === 0 && r.revenue === 0)).toBe(true);
    // 日報營收包含事業營收（走同一套帳）
    expect(d.reports.length).toBeGreaterThan(0);
  });

  it("is deterministic and catching up equals running in steps", () => {
    const base = apply(withVenture(), { type: "staffingOps", workers: 15, classes: 1, focus: "training" });
    const a = advanceTo(structuredClone(base), base.tick + 9 * DAY);
    const mid = advanceTo(structuredClone(base), base.tick + 4 * DAY);
    const b = advanceTo(mid, base.tick + 9 * DAY);
    expect(b.ventures).toEqual(a.ventures);
    expect(Math.round(b.funds)).toBe(Math.round(a.funds));
  });

  it("old saves without group or ventures are untouched", () => {
    const s = mk();
    const m = migrateState(structuredClone(s), 0);
    expect(m.group).toBeUndefined();
    expect(m.ventures).toBeUndefined();
    const later = advanceTo(structuredClone(s), s.tick + 2 * DAY);
    expect(later.ventures).toBeUndefined();
  });
});

describe("seasons, specialisation and the market", () => {
  it("April is the busy season for both lines; August is quiet for dispatch", () => {
    const april = Math.floor(START / DAY) + 3; // 4 月初
    const aug = april + 120;
    expect(dispatchSeason(april)).toBeGreaterThan(dispatchSeason(aug));
    expect(trainingSeason(april)).toBeGreaterThan(1.2);
  });

  it("specialisation has a cap and diminishing returns; focus beats no focus; spreading thin costs", () => {
    expect(specMult(0, true)).toBe(1);
    expect(specMult(10_000, true)).toBeLessThanOrEqual(1.12 + 1e-9);
    expect(specMult(80, true)).toBeGreaterThan(specMult(40, true));
    expect(specMult(80, true) - specMult(40, true)).toBeLessThan(specMult(40, true) - specMult(0, true));
    expect(specMult(80, false)).toBeLessThan(specMult(80, true));
    const base: StaffingState = { since: 0, workers: 20, classes: 2, xp: { dispatch: 0, training: 0 }, hist: [], profit: 0 };
    const day = Math.floor(START / DAY) + 3;
    const spread = staffingDay(base, day, 8);
    const solo = staffingDay({ ...base, classes: 0 }, day, 8);
    const soloT = staffingDay({ ...base, workers: 0 }, day, 8);
    // 兩條線一起開要付管理費（旺季客滿時收入不變，但淨利比各自單開的總和少）
    const net = (r: { revenue: number; cost: number }) => r.revenue - r.cost;
    expect(net(spread)).toBeLessThan(net(solo) + net(soloT));
  });

  it("charging far above the tolerance loses demand (no free money from pricing)", () => {
    const v: StaffingState = { since: 0, workers: 30, classes: 0, xp: { dispatch: 0, training: 0 }, hist: [], profit: 0 };
    const day = Math.floor(START / DAY) + 3;
    const fair = staffingDay({ ...v, priceMult: 1.2 }, day, 8).revenue;
    const greedy = staffingDay({ ...v, priceMult: 1.5 }, day, 8).revenue;
    expect(greedy).toBeLessThan(fair);
  });
});

describe("events", () => {
  const run = (days: number) => {
    let s = apply(withVenture(), { type: "staffingOps", workers: 20 });
    let seen: MallState | null = null;
    for (let i = 0; i < days && !seen; i++) {
      s = advanceTo(s, s.tick + DAY);
      if (s.ventures?.staffing?.event) seen = structuredClone(s);
    }
    return seen;
  };

  it("an event eventually appears, can be resolved once, and unresolved ones fall back to the default", () => {
    const s = run(200);
    expect(s).not.toBeNull();
    const ev = STAFFING_EVENTS.find((e) => e.id === s!.ventures!.staffing!.event!.id)!;
    expect(fails(s!, { type: "resolveStaffingEvent", optionId: "nope" })).toMatch(/沒有這個選項/);
    const paid = ev.options.find((o) => o.costDays > 0)!;
    const done = apply(s!, { type: "resolveStaffingEvent", optionId: paid.id });
    expect(done.ventures!.staffing!.event).toBeUndefined();
    expect(done.funds).toBeLessThan(s!.funds);
    expect(fails(done, { type: "resolveStaffingEvent", optionId: paid.id })).toMatch(/沒有待處理/);
    // 不理它：兩天後自動採預設
    const later = advanceTo(structuredClone(s!), s!.tick + 3 * DAY);
    expect(later.ventures!.staffing!.event?.id === ev.id).toBe(false);
    expect(later.log.some((l) => l.text.includes("自動採預設"))).toBe(true);
  });

  it("is deterministic for the same state", () => {
    const a = run(200);
    const b = run(200);
    expect(a!.ventures).toEqual(b!.ventures);
  });
});
