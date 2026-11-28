import { describe, expect, it } from "vitest";
import {
  CATEGORY_BY_ID,
  FAN_DAILY_IDX,
  GIFT_COOLDOWN_TICKS,
  GIFT_COST,
  GREET_COOLDOWN_TICKS,
  GREET_WINDOW_TICKS,
  regularIsHere,
  MAX_FAN_IDX,
  PERSONA_BY_ID,
  REGULARS,
  REGULAR_BY_ID,
  REGULAR_DRIFT_AFTER_TICKS,
  RESERVE_FEE,
  RESERVE_UPKEEP_PER_DAY,
  TICKS_PER_DAY,
  TICK_MINUTES,
  type MallState,
  type RegularState,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, stepTick, type Command } from "./sim";
import { regularsDaily } from "./sim/regulars";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const DAY = TICKS_PER_DAY;

const must = (r: ReturnType<typeof applyCommand>): MallState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const apply = (s: MallState, c: Command) => must(applyCommand(s, c));
const reg = (s: MallState, id: string): RegularState => s.regulars.find((r) => r.id === id)!;

/** 直接讓某位常客「已認識」，方便測互動 */
function meet(s: MallState, id: string, affinity = 20): RegularState {
  const r = reg(s, id);
  r.met = true;
  r.affinity = affinity;
  return r;
}

describe("roster data", () => {
  it("has unique ids and valid references", () => {
    const ids = new Set<string>();
    for (const r of REGULARS) {
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
      expect(PERSONA_BY_ID[r.persona], r.id).toBeDefined();
      expect(CATEGORY_BY_ID[r.fav], `${r.id} fav`).toBeDefined();
      if (r.alt) expect(CATEGORY_BY_ID[r.alt], `${r.id} alt`).toBeDefined();
      expect(r.budget).toBeGreaterThan(1);
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(5);
    }
    expect(REGULARS.length).toBeGreaterThanOrEqual(12);
  });

  it("stories unlock in ascending affinity order with sensible rewards", () => {
    for (const r of REGULARS) {
      expect(r.stories.length).toBeGreaterThanOrEqual(2);
      let last = 0;
      for (const st of r.stories) {
        expect(st.at).toBeGreaterThan(last);
        expect(st.at).toBeLessThanOrEqual(100);
        expect(st.text.length).toBeGreaterThan(10);
        expect(st.reward.funds ?? 0).toBeLessThanOrEqual(100_000);
        expect(st.reward.idx ?? 0).toBeLessThanOrEqual(2);
        last = st.at;
      }
    }
  });

  it("every regular is anchored to a category that exists in some zone", () => {
    const zones = new Set(Object.values(CATEGORY_BY_ID).map((c) => c.zone));
    for (const r of REGULARS) expect(zones.has(CATEGORY_BY_ID[r.fav]!.zone)).toBe(true);
  });
});

describe("meeting regulars", () => {
  it("starts with everyone unmet", () => {
    const s = createInitialState(1, START);
    expect(s.regulars).toHaveLength(REGULARS.length);
    expect(s.regulars.every((r) => !r.met && r.affinity === 0)).toBe(true);
  });

  it("regulars whose favourite shop exists show up; others stay hidden", () => {
    let s = createInitialState(2, START);
    s = advanceTo(s, START + 6 * DAY);
    const metIds = s.regulars.filter((r) => r.met).map((r) => r.id);
    expect(metIds.length).toBeGreaterThanOrEqual(3);
    // 戲院還沒蓋，影迷不可能出現
    expect(reg(s, "sakura").met).toBe(false);
    expect(reg(s, "coach").met).toBe(false);
    // 每位出現的常客，都至少有一間喜歡的店（最愛或第二選擇）
    for (const id of metIds) {
      const def = REGULAR_BY_ID[id]!;
      expect(s.shops.some((x) => x.category === def.fav || x.category === def.alt)).toBe(true);
    }
    expect(s.log.some((l) => l.text.includes("新常客登場"))).toBe(true);
  });

  it("opening a new kind of shop eventually brings its regular", () => {
    let s = createInitialState(3, START);
    expect(reg(s, "obaa").met).toBe(false);
    const slot = s.slots.find((x) => x.zone === "b1" && x.shopId === null)!;
    s = apply(s, { type: "buildShop", slot: slot.id, category: "udon" });
    s = advanceTo(s, START + 14 * DAY);
    expect(s.shops.some((x) => x.category === "udon")).toBe(true);
    expect(reg(s, "obaa").met || reg(s, "tanaka").met).toBe(true);
  });
});

describe("visits", () => {
  it("good service raises affinity, counts visits and produces tips", () => {
    // 每日隨機加入後亂數序列改變；30 個種子平均上門次數與舊版相近，但種子 4 這 8 天剛好沒人來，換一個
    let s = createInitialState(1, START);
    const r = meet(s, "afu", 35);
    const startFunds = s.funds;
    s = advanceTo(s, START + 8 * DAY);
    const after = reg(s, "afu");
    expect(after.visits).toBeGreaterThan(0);
    expect(after.affinity).toBeGreaterThan(r.affinity);
    expect(after.tipsTotal).toBeGreaterThan(0);
    expect(s.funds).toBeGreaterThan(startFunds);
    expect(s.reports.some((rp) => rp.notes.some((n) => n.includes("常客造訪")))).toBe(true);
  });

  it("stockouts make regulars upset and lose affinity; the report says so", () => {
    let s = createInitialState(4, START);
    meet(s, "afu", 50);
    for (const shop of s.shops) {
      s = apply(s, { type: "setRestock", shopId: shop.id, rule: { enabled: false } });
    }
    for (const shop of s.shops) shop.stock = 0;
    s = advanceTo(s, START + 4 * DAY);
    expect(reg(s, "afu").affinity).toBeLessThan(50);
    expect(s.reports.some((rp) => rp.notes.some((n) => n.includes("缺貨")))).toBe(true);
  });

  it("prices above a regular's budget drive them away", () => {
    let s = createInitialState(4, START);
    meet(s, "afu", 50);
    for (const shop of s.shops) {
      const cat = CATEGORY_BY_ID[shop.category]!;
      s = apply(s, { type: "setPrice", shopId: shop.id, price: Math.round(cat.refPrice * 2.4) });
    }
    s = advanceTo(s, START + 4 * DAY);
    const after = reg(s, "afu");
    expect(after.affinity).toBeLessThan(50);
    expect(after.visits).toBe(0);
  });

  it("an extremely dirty mall also upsets them", () => {
    let s = createInitialState(4, START);
    meet(s, "afu", 50);
    s.cleanliness = 5;
    s = apply(s, { type: "setCleaning", level: 0 });
    s = advanceTo(s, START + 3 * DAY);
    expect(reg(s, "afu").affinity).toBeLessThan(50);
  });

  it("a visit counts as a real sale in the day's numbers and satisfaction samples", () => {
    let s = createInitialState(4, START);
    meet(s, "afu", 80);
    s = advanceTo(s, START + 2 * DAY + 1);
    const rp = s.reports[0]!;
    expect(rp.groups).toBeGreaterThan(0);
    expect(rp.avgSat.local).not.toBeNull();
  });
});

describe("stories, drift and word of mouth", () => {
  it("crossing an affinity threshold unlocks a story once, with its reward", () => {
    let s = createInitialState(5, START);
    const r = meet(s, "afu", 29.9);
    // 手動推高親密度模擬「成功造訪」之後的檢查：用互動指令跨過門檻
    s = apply(s, { type: "regularAction", regularId: "afu", action: "remember" }); // +2 → 31.9
    expect(reg(s, "afu").storyStage).toBe(1);
    expect(r.storyStage).toBe(0); // 原物件沒被改動
    expect(s.log.some((l) => l.text.includes("《老位子》"))).toBe(true);
    expect(s.today.regularNotes.some((n) => n.includes("老位子"))).toBe(true);
    const funds = s.funds;
    reg(s, "afu").lastVisitTick = s.tick; // 剛上門，才聊得到
    s = apply(s, { type: "regularAction", regularId: "afu", action: "greet" }); // 不會再次解鎖同一個故事
    expect(reg(s, "afu").storyStage).toBe(1);
    expect(s.funds).toBe(funds);
  });

  it("a very high affinity can unlock several stories in a row", () => {
    let s = createInitialState(5, START);
    meet(s, "afu", 70);
    s = apply(s, { type: "regularAction", regularId: "afu", action: "remember" });
    expect(reg(s, "afu").storyStage).toBe(2);
  });

  it("regulars who stop coming drift away slowly, but never below a floor", () => {
    const s = createInitialState(6, START);
    const r = meet(s, "afu", 40);
    r.lastVisitTick = s.tick - REGULAR_DRIFT_AFTER_TICKS - 10;
    regularsDaily(s);
    expect(r.affinity).toBeCloseTo(39.5, 5);
    r.affinity = 5;
    regularsDaily(s);
    expect(r.affinity).toBe(5);
  });

  it("devoted fans add a little word-of-mouth each day, capped", () => {
    const s = createInitialState(6, START);
    for (const def of REGULARS) meet(s, def.id, 90);
    const before = s.localRep + s.touristHeat;
    regularsDaily(s);
    const gained = s.localRep + s.touristHeat - before;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThanOrEqual(MAX_FAN_IDX + 1e-9);
    expect(FAN_DAILY_IDX).toBeGreaterThan(0);
  });
});

describe("interactions", () => {
  it("cannot interact with someone you have not met", () => {
    const s = createInitialState(7, START);
    for (const action of ["greet", "remember", "gift"] as const) {
      expect(applyCommand(s, { type: "regularAction", regularId: "afu", action }).ok).toBe(false);
    }
    expect(applyCommand(s, { type: "regularAction", regularId: "nobody", action: "greet" }).ok).toBe(false);
  });

  it("greet is free, helps, and has a cooldown", () => {
    let s = createInitialState(7, START);
    meet(s, "afu", 20).lastVisitTick = s.tick;
    const funds = s.funds;
    s = apply(s, { type: "regularAction", regularId: "afu", action: "greet" });
    expect(reg(s, "afu").affinity).toBeCloseTo(21, 5);
    expect(s.funds).toBe(funds);
    expect(applyCommand(s, { type: "regularAction", regularId: "afu", action: "greet" }).ok).toBe(false);
    s = advanceTo(s, s.tick + GREET_COOLDOWN_TICKS + 1);
    reg(s, "afu").lastVisitTick = s.tick; // 又上門一趟
    expect(applyCommand(s, { type: "regularAction", regularId: "afu", action: "greet" }).ok).toBe(true);
  });

  it("can only greet a regular who has just come by, once per visit", () => {
    let s = createInitialState(7, START);
    meet(s, "afu", 20); // 還沒上門過
    const away = applyCommand(s, { type: "regularAction", regularId: "afu", action: "greet" });
    expect(away.ok).toBe(false);
    expect(away.ok === false && away.error).toContain("不在店裡");
    reg(s, "afu").lastVisitTick = s.tick;
    s = advanceTo(s, s.tick + GREET_WINDOW_TICKS - 1);
    expect(regularIsHere(reg(s, "afu"), s.tick)).toBe(true);
    s = apply(s, { type: "regularAction", regularId: "afu", action: "greet" });
    expect(regularIsHere(reg(s, "afu"), s.tick)).toBe(false); // 這一趟已經聊過
    // 久了就走了：就算冷卻過了、沒有新的上門，也聊不到
    s = advanceTo(s, s.tick + GREET_COOLDOWN_TICKS + 1);
    expect(applyCommand(s, { type: "regularAction", regularId: "afu", action: "greet" }).ok).toBe(false);
  });

  it("remember works once and unlocks the preferences", () => {
    let s = createInitialState(7, START);
    meet(s, "afu", 20);
    s = apply(s, { type: "regularAction", regularId: "afu", action: "remember" });
    expect(reg(s, "afu").knowsPrefs).toBe(true);
    expect(applyCommand(s, { type: "regularAction", regularId: "afu", action: "remember" }).ok).toBe(false);
  });

  it("gifts cost money, need funds, and have a cooldown", () => {
    let s = createInitialState(7, START);
    meet(s, "afu", 20);
    const funds = s.funds;
    s = apply(s, { type: "regularAction", regularId: "afu", action: "gift" });
    expect(s.funds).toBe(funds - GIFT_COST);
    expect(reg(s, "afu").affinity).toBeCloseTo(23, 5);
    expect(applyCommand(s, { type: "regularAction", regularId: "afu", action: "gift" }).ok).toBe(false);
    const poor = structuredClone(createInitialState(7, START));
    meet(poor, "afu", 20);
    poor.funds = GIFT_COST - 1;
    expect(applyCommand(poor, { type: "regularAction", regularId: "afu", action: "gift" }).ok).toBe(false);
    s = advanceTo(s, s.tick + GIFT_COOLDOWN_TICKS + 1);
    expect(applyCommand(s, { type: "regularAction", regularId: "afu", action: "gift" }).ok).toBe(true);
  });

  it("the old reserved-seat feature is retired: old saves get their fee back and the seat is cancelled", () => {
    const s = createInitialState(7, START);
    meet(s, "afu", 50).reserved = true;
    meet(s, "hana", 50).reserved = true;
    const funds = s.funds;
    regularsDaily(s);
    expect(reg(s, "afu").reserved).toBe(false);
    expect(reg(s, "hana").reserved).toBe(false);
    expect(s.funds).toBe(funds + 2 * RESERVE_FEE);
    expect(applyCommand(s, { type: "regularAction", regularId: "afu", action: "reserve" as never }).ok).toBe(false);
    const again = s.funds;
    regularsDaily(s);
    expect(s.funds).toBe(again); // 只退一次
    expect(RESERVE_UPKEEP_PER_DAY).toBeGreaterThan(0);
  });

  it("rejects unknown actions", () => {
    const s = createInitialState(7, START);
    meet(s, "afu", 20);
    const r = applyCommand(s, { type: "regularAction", regularId: "afu", action: "marry" as never });
    expect(r.ok).toBe(false);
  });
});

describe("determinism and migration", () => {
  it("catch-up equals tick-by-tick with regulars in play", () => {
    const a = createInitialState(9, START);
    meet(a, "afu", 40);
    meet(a, "tanaka", 20);
    const big = advanceTo(a, START + 3 * DAY);
    const b = structuredClone(a);
    for (let i = 0; i < 3 * DAY; i++) stepTick(b);
    expect(b).toEqual(big);
  });

  it("migrates v3 to v4 with an empty roster state", () => {
    const v3 = { ...createInitialState(1, 100), version: 3 } as unknown as Record<string, unknown>;
    delete v3.regulars;
    (v3.today as Record<string, unknown>).regularNotes = undefined;
    const m = migrateState(v3, 0);
    expect(m.version).toBe(13);
    expect(m.regulars).toHaveLength(REGULARS.length);
    expect(m.today.regularNotes).toEqual([]);
  });
});
