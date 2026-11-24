import { describe, expect, it } from "vitest";
import {
  STARTER_QUESTS,
  CANDIDATE_MAX,
  CANDIDATE_TTL,
  CATEGORY_BY_ID,
  FITOUT_TICKS,
  TECHS,
  TECH_BY_ID,
  TICKS_PER_DAY,
  baselineRevenue,
  leaseEnabled,
  marketRent,
  techBlocker,
  techFx,
  techSlots,
  type MallState,
  type TenantCandidate,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, stepTick, type Command } from "./sim";
import { dailyOverhead, dailyWages } from "./sim/tax";
import { techDaily } from "./sim/tech";

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const mk = (seed = 7, level = 1): MallState => {
  const s = createInitialState(seed, START, 0);
  s.level = level;
  s.funds = 100_000_000; // 科技與營運都要花錢，測試給足資金
  for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0; // 新手任務獎金不干擾金額檢查
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
const done = (s: MallState, ...ids: string[]): MallState => {
  const c = structuredClone(s);
  c.tech.done.push(...ids);
  return c;
};

describe("tech tree data", () => {
  it("ids are unique, prerequisites exist and there are no cycles; every tech has a price, a time and a description", () => {
    expect(new Set(TECHS.map((t) => t.id)).size).toBe(TECHS.length);
    for (const t of TECHS) {
      for (const r of t.requires) expect(TECH_BY_ID[r], `${t.id}→${r}`).toBeDefined();
      expect(t.cost).toBeGreaterThan(0);
      expect(t.ticks).toBeGreaterThan(0);
      expect(t.effectText.length).toBeGreaterThan(3);
      const seen = new Set<string>();
      const walk = (id: string) => {
        expect(seen.has(id), `cycle at ${id}`).toBe(false);
        seen.add(id);
        TECH_BY_ID[id]!.requires.forEach(walk);
        seen.delete(id);
      };
      walk(t.id);
    }
  });

  it("effects combine: multipliers multiply, bonuses add, traffic maps stack, empty is neutral", () => {
    const none = techFx([]);
    expect(none.wageMult).toBe(1);
    expect(none.traffic).toEqual({});
    const fx = techFx(["t_bms", "t_solar"]);
    expect(fx.overheadMult).toBeCloseTo(0.85 * 0.8, 6);
    expect(fx.dailyIdx.touristHeat).toBeCloseTo(0.05, 6);
    const guide = techFx(["t_app", "t_ar"]);
    expect(guide.traffic.tourist).toBeCloseTo(1.06 * 1.06, 6);
    expect(guide.traffic.all).toBeCloseTo(1.03, 6);
    expect(techFx(["t_ai"]).autoRefresh).toBe(true);
    expect(techFx(["t_data"]).forecast).toBe(true);
  });
});

describe("researching technology", () => {
  it("checks level, prerequisites, funds and lab slots", () => {
    const s = mk(7, 1);
    expect(fails(s, { type: "startTech", id: "nope" })).toContain("找不到");
    expect(fails(s, { type: "startTech", id: "t_ar" })).toContain("Lv.3");
    const s3 = mk(7, 3);
    expect(fails(s3, { type: "startTech", id: "t_ar" })).toContain("智慧導覽");
    expect(fails({ ...s, funds: 100 }, { type: "startTech", id: "t_app" })).toBe("資金不足");
    const a = apply(s, { type: "startTech", id: "t_app" });
    expect(a.funds).toBe(s.funds - TECH_BY_ID["t_app"]!.cost);
    expect(fails(a, { type: "startTech", id: "t_bms" })).toContain("Lv.2");
    expect(fails(apply(mk(7, 2), { type: "startTech", id: "t_bms" }), { type: "startTech", id: "t_robot" })).toContain("忙");
    expect(techSlots(5)).toBe(2);
    const rich = mk(7, 5);
    const lv5 = apply(rich, { type: "startTech", id: "t_bms" });
    expect(fails(lv5, { type: "startTech", id: "t_robot" })).toBeNull();
    expect(fails(a, { type: "startTech", id: "t_app" })).toContain("研發中");
  });

  it("runs offline, completes after its time, and cancelling refunds half", () => {
    const s = apply(mk(7, 1), { type: "startTech", id: "t_app" });
    const before = advanceTo(s, s.tick + TECH_BY_ID["t_app"]!.ticks - 2);
    expect(before.tech.done).toEqual([]);
    const after = advanceTo(s, s.tick + TECH_BY_ID["t_app"]!.ticks + 2);
    expect(after.tech.done).toEqual(["t_app"]);
    expect(after.tech.jobs).toEqual([]);
    expect(techBlocker(after, TECH_BY_ID["t_app"]!)).toBe("已經研發完成");
    const c = apply(s, { type: "cancelTech", id: "t_app" });
    expect(c.tech.jobs).toEqual([]);
    expect(c.funds).toBe(s.funds + Math.round(TECH_BY_ID["t_app"]!.cost * 0.5));
  });

  it("technology really changes the numbers: wages, overhead, traffic, capacity and breakdowns", () => {
    const base = mk(7, 5);
    expect(dailyWages(done(base, "t_checkout"))).toBeCloseTo(dailyWages(base) * 0.85, 4);
    expect(dailyOverhead(done(base, "t_bms", "t_solar"))).toBeCloseTo(dailyOverhead(base) * 0.85 * 0.8, 4);
    const groups = (s: MallState) => advanceTo(s, s.tick + 6 * TICKS_PER_DAY).reports.reduce((a, r) => a + r.groups, 0);
    expect(groups(done(base, "t_app", "t_member", "t_ar"))).toBeGreaterThan(groups(base));
    const sat = (s: MallState) => {
      const x = advanceTo(s, s.tick + 10 * TICKS_PER_DAY);
      return (x.localRep + x.touristHeat) / 2;
    };
    expect(sat(done(base, "t_data", "t_robot"))).toBeGreaterThanOrEqual(sat(base));
  });

  it("the AI assistant refreshes tired menus and prepares for inspections without pausing the clock", () => {
    const s = done(mk(7, 4), "t_ai");
    s.shops.forEach((x) => (x.freshness = 30));
    const fundsBefore = s.funds;
    techDaily(s);
    expect(s.shops.every((x) => x.freshness > 30)).toBe(true);
    expect(s.funds).toBeLessThan(fundsBefore);

    let paused = 0;
    let prepared = 0;
    for (let seed = 1; seed < 30; seed++) {
      const t = done(createInitialState(seed, START), "t_ai");
      t.cleanliness = 20; // 沒有 AI 副手時這種狀況會讓時鐘暫停等人
      t.equipment = 20;
      t.inspections.nextAt = { hygiene: t.tick, fire: t.tick + 10_000_000 };
      const halted = stepTick(t, { nobodyPresent: true });
      if (halted) paused++;
      if (t.inspections.pending.some((p) => p.prep !== null)) prepared++;
    }
    expect(paused).toBe(0);
    expect(prepared).toBeGreaterThan(0);
  });

  it("the sustainability techs lift popularity every day", () => {
    const s = done(mk(7, 5), "t_solar", "t_esg");
    s.localRep = 50;
    s.touristHeat = 50;
    techDaily(s);
    expect(s.touristHeat).toBeCloseTo(50.13, 2);
    expect(s.localRep).toBeCloseTo(50.08, 2);
  });
});

describe("leasing: finding tenants", () => {
  it("opens at level 3 (or by flag), and not before", () => {
    expect(leaseEnabled({ flags: {}, level: 2 })).toBe(false);
    expect(leaseEnabled({ flags: {}, level: 3 })).toBe(true);
    expect(leaseEnabled({ flags: { "feature:lease": true }, level: 1 })).toBe(true);
    const s = advanceTo(mk(7, 2), START + 20 * TICKS_PER_DAY);
    expect(s.leasing.candidates).toEqual([]);
  });

  it("brands show up over time with sensible offers; the list is capped and offers expire", () => {
    let s = advanceTo(mk(7, 3), START + 14 * TICKS_PER_DAY);
    expect(s.leasing.candidates.length).toBeGreaterThan(0);
    expect(s.leasing.candidates.length).toBeLessThanOrEqual(CANDIDATE_MAX);
    for (const c of s.leasing.candidates) {
      const cat = CATEGORY_BY_ID[c.category]!;
      expect(c.rent).toBeGreaterThan(marketRent(c.category) * 0.7);
      expect(c.rent).toBeLessThan(marketRent(c.category) * 1.4);
      expect(c.quality).toBeGreaterThanOrEqual(0.5);
      expect(c.quality).toBeLessThanOrEqual(0.95);
      expect(c.expireTick - c.createdTick).toBe(CANDIDATE_TTL);
      expect(s.slots.some((x) => x.zone === cat.zone && !x.shopId)).toBe(true);
    }
    const names = s.leasing.candidates.map((c) => c.brand);
    expect(new Set(names).size).toBe(names.length);
    s.flags["feature:lease"] = false;
    s.level = 1;
    s = advanceTo(s, s.tick + 10 * TICKS_PER_DAY);
    expect(s.leasing.log.length).toBeGreaterThan(0);
  });
});

function withCandidate(over: Partial<TenantCandidate> = {}): { s: MallState; c: TenantCandidate } {
  const s = mk(7, 3);
  const c: TenantCandidate = {
    id: "tc900",
    brand: "七福食堂",
    category: "udon",
    quality: 0.8,
    fame: 60,
    rent: marketRent("udon"),
    commission: 0.1,
    termDays: 30,
    eagerness: 0.9,
    createdTick: s.tick,
    expireTick: s.tick + CANDIDATE_TTL,
    countered: false,
    ...over,
  };
  s.leasing.candidates.push(c);
  s.slots.forEach((x) => {
    if (x.zone === "b1" && x.shopId === null) x.shopId = null;
  });
  return { s, c };
}

describe("leasing: signing and living with tenants", () => {
  it("signing fits out the shop for free and opens it under the brand, rented out", () => {
    const { s, c } = withCandidate();
    const t1 = apply(s, { type: "signTenant", candidateId: c.id });
    expect(t1.funds).toBe(s.funds); // 裝修費用由租戶出
    expect(t1.leasing.candidates).toEqual([]);
    expect(t1.builds[0]!.tenant?.brand).toBe("七福食堂");
    const t2 = advanceTo(t1, t1.tick + FITOUT_TICKS + 2);
    const shop = t2.shops.find((x) => x.name === "七福食堂")!;
    expect(shop.mode).toBe("lease");
    expect(shop.tenant?.rent).toBe(c.rent);
    expect(shop.stock).toBe(0);
    expect(fails(t1, { type: "signTenant", candidateId: c.id })).toContain("不在洽談名單");
    expect(fails(s, { type: "signTenant", candidateId: c.id, slot: 9999 })).toContain("沒有空店面");
  });

  it("the landlord earns rent plus a commission, and pays no wages or stock for a tenant", () => {
    const { s, c } = withCandidate();
    let t = apply(s, { type: "signTenant", candidateId: c.id });
    t = advanceTo(t, t.tick + FITOUT_TICKS + 2);
    const wagesWith = dailyWages(t);
    const direct = structuredClone(t);
    direct.shops.find((x) => x.name === "七福食堂")!.mode = "direct";
    expect(wagesWith).toBeLessThan(dailyWages(direct));
    const before = t.tax.history.length;
    const f0 = t.funds;
    const after = advanceTo(t, t.tick + 5 * TICKS_PER_DAY);
    const shop = after.shops.find((x) => x.name === "七福食堂")!;
    expect(after.funds).toBeGreaterThan(f0);
    expect(after.totalRevenue).toBeGreaterThan(t.totalRevenue);
    expect(shop.tenant!.satisfaction).toBeGreaterThan(30);
    expect(before).toBeLessThanOrEqual(after.tax.history.length);
  });

  it("counter-offers: only once; a keen brand usually accepts a small raise, a tepid one walks away from a big one", () => {
    const { s, c } = withCandidate({ eagerness: 0.95 });
    expect(fails(s, { type: "counterTenant", candidateId: c.id, rentMult: 5 })).toContain("無效");
    let accepted = 0;
    for (let i = 0; i < 40; i++) {
      const t = structuredClone(s);
      t.tick += i * 7;
      const r = apply(t, { type: "counterTenant", candidateId: c.id, rentMult: 1.1 });
      if (r.leasing.candidates[0]?.rent === Math.round((c.rent * 1.1) / 100) * 100) accepted++;
    }
    expect(accepted).toBeGreaterThan(28);
    const once = apply(s, { type: "counterTenant", candidateId: c.id, rentMult: 1.1 });
    if (once.leasing.candidates.length) expect(fails(once, { type: "counterTenant", candidateId: c.id, rentMult: 1.1 })).toContain("只能還一次");

    const tepid = withCandidate({ eagerness: 0.3 });
    let walked = 0;
    for (let i = 0; i < 40; i++) {
      const t = structuredClone(tepid.s);
      t.tick += i * 7;
      if (apply(t, { type: "counterTenant", candidateId: tepid.c.id, rentMult: 1.3 }).leasing.candidates.length === 0) walked++;
    }
    expect(walked).toBeGreaterThan(25);
  });

  it("an unhappy tenant (crushing rent) moves out within days, leaving the slot free and a dent in reputation", () => {
    const { s, c } = withCandidate({ rent: baselineRevenue("udon") * 3, commission: 0.12 });
    let t = apply(s, { type: "signTenant", candidateId: c.id });
    t = advanceTo(t, t.tick + FITOUT_TICKS + 2);
    expect(t.shops.some((x) => x.name === c.brand)).toBe(true);
    t = advanceTo(t, t.tick + 30 * TICKS_PER_DAY);
    expect(t.shops.some((x) => x.name === c.brand)).toBe(false);
    expect(t.leasing.log.some((l) => l.text.includes("撤櫃"))).toBe(true);
    expect(t.slots.filter((x) => x.zone === "b1" && !x.shopId).length).toBeGreaterThan(0);
  });

  it("lease end: a renewal is offered; renew extends, release empties the shop, ignoring it auto-renews a happy tenant", () => {
    const { s, c } = withCandidate({ termDays: 30 });
    let t = apply(s, { type: "signTenant", candidateId: c.id });
    t = advanceTo(t, t.tick + FITOUT_TICKS + 2 + 31 * TICKS_PER_DAY);
    expect(t.leasing.renewals.length + t.shops.filter((x) => x.name === c.brand && x.tenant!.endTick > t.tick).length).toBeGreaterThan(0);
    if (t.leasing.renewals.length === 0) return; // 已經自動續約（滿意度高）
    const r = t.leasing.renewals[0]!;
    const renewed = apply(t, { type: "resolveRenewal", uid: r.uid, action: "renew" });
    const shop = renewed.shops.find((x) => x.name === c.brand)!;
    expect(shop.tenant!.endTick).toBeGreaterThan(renewed.tick + 50 * TICKS_PER_DAY);
    expect(shop.tenant!.rent).toBe(r.rent);
    const released = apply(t, { type: "resolveRenewal", uid: r.uid, action: "release" });
    expect(released.shops.some((x) => x.name === c.brand)).toBe(false);
    const ignored = advanceTo(t, t.tick + 3 * TICKS_PER_DAY);
    expect(ignored.shops.find((x) => x.name === c.brand)?.tenant!.endTick ?? 0).toBeGreaterThan(t.tick);
  });

  it("asking a content tenant for more rent works; a lukewarm one leaves", () => {
    const { s, c } = withCandidate({ termDays: 30 });
    let t = apply(s, { type: "signTenant", candidateId: c.id });
    t = advanceTo(t, t.tick + FITOUT_TICKS + 2 + 29 * TICKS_PER_DAY);
    t.shops.find((x) => x.name === c.brand)!.tenant!.satisfaction = 90;
    t.shops.find((x) => x.name === c.brand)!.tenant!.endTick = t.tick - 1;
    t.leasing.renewals = [{ uid: "rn1", shopId: t.shops.find((x) => x.name === c.brand)!.id, brand: c.brand, rent: 20_000, termDays: 60, deadlineTick: t.tick + 500 }];
    const up = apply(t, { type: "resolveRenewal", uid: "rn1", action: "raise" });
    expect(up.shops.find((x) => x.name === c.brand)!.tenant!.rent).toBe(22_000);
    t.shops.find((x) => x.name === c.brand)!.tenant!.satisfaction = 50;
    const gone = apply(t, { type: "resolveRenewal", uid: "rn1", action: "raise" });
    expect(gone.shops.some((x) => x.name === c.brand)).toBe(false);
  });

  it("terminating early costs 30% of the remaining rent", () => {
    const { s, c } = withCandidate({ termDays: 60 });
    let t = apply(s, { type: "signTenant", candidateId: c.id });
    t = advanceTo(t, t.tick + FITOUT_TICKS + 2);
    const shop = t.shops.find((x) => x.name === c.brand)!;
    const remaining = Math.ceil((shop.tenant!.endTick - t.tick) / TICKS_PER_DAY) * shop.tenant!.rent;
    const r = apply(t, { type: "terminateLease", shopId: shop.id });
    expect(t.funds - r.funds).toBe(Math.round(remaining * 0.3));
    expect(r.shops.some((x) => x.id === shop.id)).toBe(false);
    expect(fails({ ...t, funds: 0 }, { type: "terminateLease", shopId: shop.id })).toContain("資金不足");
    expect(fails(t, { type: "terminateLease", shopId: t.shops[0]!.id })).toContain("不是出租");
  });

  it("converting your own shop to a tenant still works at level 3 and can be reverted", () => {
    const s = mk(7, 3);
    const shop = s.shops[0]!;
    expect(fails(mk(7, 1), { type: "setLease", shopId: shop.id, enabled: true })).toContain("Lv.3");
    const r = apply(s, { type: "setLease", shopId: shop.id, enabled: true, rent: 10_000 });
    const l = r.shops[0]!;
    expect(l.mode).toBe("lease");
    expect(l.tenant?.brand).toBe(shop.name);
    expect(l.rent).toBe(10_000);
    const back = apply(r, { type: "setLease", shopId: shop.id, enabled: false });
    expect(back.shops[0]!.mode).toBe("direct");
    expect(back.shops[0]!.tenant).toBeNull();
  });
});

describe("determinism and migration", () => {
  it("catch-up equals tick-by-tick with tech researching and tenants arriving", () => {
    let base = apply(mk(11, 3), { type: "startTech", id: "t_app" });
    base = advanceTo(base, base.tick + 2 * TICKS_PER_DAY);
    const a = advanceTo(base, base.tick + 8 * TICKS_PER_DAY);
    let b = base;
    for (let i = 0; i < 8 * 6; i++) b = advanceTo(b, b.tick + 48);
    expect(b.leasing).toEqual(a.leasing);
    expect(b.tech).toEqual(a.tech);
    expect(b.funds).toBeCloseTo(a.funds, 2);
  });

  it("migrates v8 to v9 with empty tech and leasing, and clears the old 'lease off' flag", () => {
    const v8 = JSON.parse(JSON.stringify(mk())) as Record<string, unknown> & { shops: Record<string, unknown>[]; flags: Record<string, boolean> };
    v8.version = 8;
    delete v8.tech;
    delete v8.leasing;
    for (const sh of v8.shops) delete sh.tenant;
    v8.flags["feature:lease"] = false;
    const m = migrateState(v8, 0);
    expect(m.version).toBe(12);
    expect(m.tech).toEqual({ done: [], jobs: [] });
    expect(m.leasing.candidates).toEqual([]);
    expect(m.shops.every((x) => x.tenant === null)).toBe(true);
    expect(m.flags["feature:lease"]).toBeUndefined();
  });
});
