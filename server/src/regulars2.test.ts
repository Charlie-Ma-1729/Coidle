import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  LIFE_EVENTS,
  LIFE_GIFT_COST,
  MAX_OPEN_VOICES,
  MEMBER_TIERS,
  REGULARS,
  REGULAR_BY_ID,
  REGULAR_KINDS,
  REGULAR_KIND_ORDER,
  REGULAR_TIERS,
  TICKS_PER_DAY,
  TICK_MINUTES,
  VOICE_ADOPT,
  VOICE_AFFINITY,
  ZONES,
  kindHourMult,
  memberAffinityMult,
  memberShare,
  memberTier,
  memberTrafficMult,
  regularTier,
  signupRate,
  type MallState,
  type RegularState,
  type RegularVoice,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState } from "./sim";
import { legalDaily, legalOf, openCase } from "./sim/legal";
import { earnPoints, membersDaily, membersOf } from "./sim/members";
import { regularHelp, regularsDaily, voicesOf } from "./sim/regulars";
import { createRng } from "./sim/rng";
import { makeShop } from "./sim/state";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const DAY = TICKS_PER_DAY;

const reg = (s: MallState, id: string): RegularState => s.regulars.find((r) => r.id === id)!;
function meet(s: MallState, id: string, affinity = 50): RegularState {
  const r = reg(s, id);
  r.met = true;
  r.affinity = affinity;
  r.lastVisitTick = s.tick - 10;
  r.storyStage = REGULAR_BY_ID[id]!.stories.length; // 故事都看過了，才不會因為關係變動順手領到故事獎金
  return r;
}
const must = (r: ReturnType<typeof applyCommand>): MallState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
function mall(seed = 1): MallState {
  const s = createInitialState(seed, START);
  s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
  return s;
}
function voice(s: MallState, regularId: string, topic: RegularVoice["topic"], extra: Partial<RegularVoice> = {}): RegularVoice {
  const v: RegularVoice = { uid: `vo${voicesOf(s).length + 1}`, regularId, shopId: s.shops[0]!.id, topic, text: "測試", createdTick: s.tick, deadlineTick: s.tick + 576, ...extra };
  voicesOf(s).push(v);
  return v;
}

describe("regulars cover every floor", () => {
  it("every zone has at least two regulars whose favourite is on that floor, and every regular has a kind", () => {
    for (const z of ZONES) {
      const n = REGULARS.filter((r) => CATEGORY_BY_ID[r.fav]?.zone === z.id).length;
      expect(n, z.id).toBeGreaterThanOrEqual(2);
    }
    for (const r of REGULARS) {
      expect(r.kind, r.id).toBeDefined();
      expect(REGULAR_KINDS[r.kind!], r.id).toBeDefined();
    }
    for (const k of REGULAR_KIND_ORDER) expect(REGULARS.some((r) => r.kind === k), k).toBe(true);
  });

  it("kinds describe realistic habits: workers come at lunch, families on weekends, elders in the daytime", () => {
    expect(kindHourMult("worker", 12, false)).toBeGreaterThan(kindHourMult("worker", 15, false));
    expect(kindHourMult("worker", 12, true)).toBeLessThan(kindHourMult("worker", 12, false));
    expect(kindHourMult("family", 12, true)).toBeGreaterThan(kindHourMult("family", 12, false));
    expect(kindHourMult("elder", 9, false)).toBeGreaterThan(kindHourMult("elder", 22, false));
    expect(kindHourMult(undefined, 3, true)).toBe(1);
    // 沒有專屬座位或專屬菜單這種東西
    expect(JSON.stringify(REGULAR_KINDS)).not.toContain("專屬");
  });

  it("tiers climb with affinity", () => {
    expect(regularTier(0).id).toBe("new");
    expect(regularTier(20).id).toBe("face");
    expect(regularTier(40).id).toBe("regular");
    expect(regularTier(70).id).toBe("patron");
    expect(regularTier(95).id).toBe("friend");
    expect(REGULAR_TIERS.map((t) => t.min)).toEqual([...REGULAR_TIERS.map((t) => t.min)].sort((a, b) => a - b));
  });
});

describe("friends, remembered preferences and contribution", () => {
  const runDays = (setup: (s: MallState) => void, days = 12, seeds = 5) => {
    let friends = 0;
    let visits = 0;
    let revenue = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const s = mall(seed);
      setup(s);
      const out = advanceTo(s, START + days * DAY);
      const r = reg(out, "afu");
      friends += r.contrib?.friends ?? 0;
      visits += r.visits;
      revenue += r.contrib?.revenue ?? 0;
    }
    return { friends, visits, revenue };
  };

  it("warm regulars bring friends and their value is tracked; cold ones do not", () => {
    const warm = runDays((s) => meet(s, "afu", 80), 20, 8);
    const cold = runDays((s) => meet(s, "afu", 20), 20, 8);
    expect(warm.friends).toBeGreaterThan(0);
    expect(cold.friends).toBe(0);
    expect(warm.revenue).toBeGreaterThan(0);
  });

  it("a regular whose preferences you remember visits more often", () => {
    const plain = runDays((s) => meet(s, "afu", 50), 14, 8);
    const known = runDays((s) => (meet(s, "afu", 50).knowsPrefs = true), 14, 8);
    expect(known.visits).toBeGreaterThan(plain.visits);
  });
});

describe("regulars' voices", () => {
  it("warm regulars speak up on their own, deterministically, up to a cap and one at a time", () => {
    const make = () => {
      const s = mall(3);
      for (const r of REGULARS) meet(s, r.id, 70);
      return s;
    };
    const run = (s: MallState) => {
      for (let d = 0; d < 40; d++) {
        s.tick += DAY;
        regularsDaily(s);
        expect(voicesOf(s).length).toBeLessThanOrEqual(MAX_OPEN_VOICES);
        const ids = voicesOf(s).map((v) => v.regularId);
        expect(new Set(ids).size).toBe(ids.length);
      }
      return voicesOf(s).map((v) => `${v.regularId}:${v.topic}:${v.createdTick}`);
    };
    const a = run(make());
    const b = run(make());
    expect(a).toEqual(b);
  });

  it("only regulars you know well say anything", () => {
    const s = mall(4);
    for (const r of REGULARS) meet(s, r.id, 5);
    for (let d = 0; d < 60; d++) {
      s.tick += DAY;
      regularsDaily(s);
    }
    expect(voicesOf(s).length).toBe(0);
  });

  it("adopting feedback has a real effect and costs the listed price", () => {
    const s = mall();
    const shop = s.shops[0]!;
    meet(s, "afu", 50);
    s.cleanliness = 50;
    s.funds = 1_000_000;
    const v = voice(s, "afu", "dirty");
    const out = must(applyCommand(s, { type: "regularVoice", uid: v.uid, optionId: "adopt" }));
    expect(out.cleanliness).toBeCloseTo(58, 5);
    expect(out.funds).toBe(1_000_000 - VOICE_ADOPT.dirty.cost);
    expect(reg(out, "afu").affinity).toBeCloseTo(50 + VOICE_AFFINITY.adopt, 5);
    expect(reg(out, "afu").contrib?.feedback).toBe(1);
    expect(voicesOf(out).length).toBe(0);

    const t = mall();
    meet(t, "afu", 50);
    const sh = t.shops[0]!;
    sh.freshness = 40;
    const v2 = voice(t, "afu", "stale", { shopId: sh.id });
    const out2 = must(applyCommand(t, { type: "regularVoice", uid: v2.uid, optionId: "adopt" }));
    expect(out2.shops.find((x) => x.id === sh.id)!.freshness).toBe(50);

    const u = mall();
    meet(u, "afu", 50);
    const sh3 = u.shops.find((x) => CATEGORY_BY_ID[x.category]!.refPrice > 0)!;
    sh3.price = Math.round(CATEGORY_BY_ID[sh3.category]!.refPrice * 1.4);
    const v3 = voice(u, "afu", "price", { shopId: sh3.id });
    const out3 = must(applyCommand(u, { type: "regularVoice", uid: v3.uid, optionId: "adopt" }));
    expect(out3.shops.find((x) => x.id === sh3.id)!.price).toBe(Math.round(CATEGORY_BY_ID[sh3.category]!.refPrice * 1.1));
    expect(shop).toBeDefined();
  });

  it("a stock-out complaint triggers an emergency order, 'wish' teaches you their preferences", () => {
    const s = mall();
    meet(s, "afu", 50);
    s.funds = 5_000_000;
    const shop = s.shops.find((x) => x.category === "kushikatsu") ?? s.shops[0]!;
    shop.incoming = [];
    const v = voice(s, "afu", "stockout", { shopId: shop.id });
    const out = must(applyCommand(s, { type: "regularVoice", uid: v.uid, optionId: "adopt" }));
    expect(out.shops.find((x) => x.id === shop.id)!.incoming.reduce((a, b) => a + b.qty, 0)).toBeGreaterThan(0);

    const t = mall();
    meet(t, "afu", 50);
    const w = voice(t, "afu", "wish");
    expect(reg(t, "afu").knowsPrefs).toBe(false);
    const out2 = must(applyCommand(t, { type: "regularVoice", uid: w.uid, optionId: "adopt" }));
    expect(reg(out2, "afu").knowsPrefs).toBe(true);
  });

  it("saying thanks is free; ignoring a voice until it expires costs a little affinity", () => {
    const s = mall();
    meet(s, "afu", 50);
    const funds = s.funds;
    const v = voice(s, "afu", "queue");
    const out = must(applyCommand(s, { type: "regularVoice", uid: v.uid, optionId: "thanks" }));
    expect(out.funds).toBe(funds);
    expect(reg(out, "afu").affinity).toBeCloseTo(50 + VOICE_AFFINITY.thanks, 5);

    const t = mall();
    meet(t, "afu", 50);
    voice(t, "afu", "queue", { deadlineTick: t.tick + 10 });
    t.tick += 20;
    t.regulars.forEach((r) => (r.met = r.id === "afu"));
    regularsDaily(t);
    expect(voicesOf(t).filter((x) => x.topic === "queue").length).toBe(0);
    expect(reg(t, "afu").affinity).toBeLessThan(50);
  });

  it("life events: a gift costs money and pleases, a card is free, doing nothing disappoints", () => {
    expect(LIFE_EVENTS.length).toBeGreaterThanOrEqual(5);
    const s = mall();
    meet(s, "afu", 70);
    const funds = s.funds;
    const v = voice(s, "afu", "life", { detail: "marry" });
    const gift = must(applyCommand(s, { type: "regularVoice", uid: v.uid, optionId: "gift" }));
    expect(gift.funds).toBe(funds - LIFE_GIFT_COST);
    expect(reg(gift, "afu").affinity).toBeCloseTo(70 + VOICE_AFFINITY.gift, 5);
    const t = mall();
    meet(t, "afu", 70);
    const v2 = voice(t, "afu", "life", { detail: "move" });
    const skip = must(applyCommand(t, { type: "regularVoice", uid: v2.uid, optionId: "skip" }));
    expect(reg(skip, "afu").affinity).toBeLessThan(70);
    expect(applyCommand(t, { type: "regularVoice", uid: "nope", optionId: "gift" }).ok).toBe(false);
    expect(applyCommand(t, { type: "regularVoice", uid: v2.uid, optionId: "bogus" }).ok).toBe(false);
  });
});

describe("help in a crisis", () => {
  it("only well-liked regulars of that kind of shop count, and elders weigh double", () => {
    const s = mall();
    const shop = s.shops.find((x) => x.category === "kushikatsu")!;
    expect(regularHelp(s, shop)).toBe(0);
    meet(s, "afu", 70); // 長者：2
    expect(regularHelp(s, shop)).toBe(2);
    meet(s, "chen", 70); // 業界人士：2，最愛也是串炸
    expect(regularHelp(s, shop)).toBe(4);
    meet(s, "emma", 30); // 親密度不夠
    expect(regularHelp(s, shop)).toBe(4);
  });

  it("they raise your evidence in a lawsuit and are credited for it", () => {
    const base = mall(5);
    const helped = mall(5);
    meet(helped, "afu", 80);
    const shop = (st: MallState) => st.shops.find((x) => x.category === "kushikatsu")!;
    const a = openCase(base, createRng(1), shop(base), "food_poison", "angry")!;
    const b = openCase(helped, createRng(1), shop(helped), "food_poison", "angry")!;
    expect(b.evidence).toBeGreaterThan(a.evidence);
    expect(reg(helped, "afu").contrib?.help).toBe(1);
    expect(legalOf(helped).cases[0]!.history.some((h) => h.text.includes("老主顧"))).toBe(true);
  });
});

describe("membership (points card)", () => {
  it("share, tiers and bonuses grow with members and have diminishing returns", () => {
    expect(memberShare(0)).toBe(0);
    expect(memberShare(1500)).toBeCloseTo(0.5, 5);
    expect(memberShare(10_000_000)).toBeLessThanOrEqual(0.6);
    expect(memberTier(0).id).toBe("general");
    expect(memberTier(300).id).toBe("silver");
    expect(memberTier(1500).id).toBe("gold");
    expect(memberTier(6000).id).toBe("platinum");
    expect(MEMBER_TIERS.length).toBe(4);
    const t3 = memberTrafficMult({ rate: 3, count: 1500 });
    const t5 = memberTrafficMult({ rate: 5, count: 1500 });
    expect(t3).toBeGreaterThan(1);
    expect(t5).toBeGreaterThan(t3);
    expect(t5 - 1).toBeLessThan((t3 - 1) * (5 / 3)); // 回饋率加到 5/3 倍，效果沒有跟著放大那麼多
    expect(memberTrafficMult(undefined)).toBe(1);
    expect(memberAffinityMult({ rate: 0, count: 5000 })).toBe(1);
    expect(memberAffinityMult({ rate: 3, count: 1500 })).toBeGreaterThan(1);
    expect(signupRate(0)).toBe(0);
    expect(signupRate(5)).toBeGreaterThan(signupRate(1));
  });

  it("setting the rate is validated; points are a liability and only cost money when redeemed", () => {
    let s = mall();
    const locked = applyCommand(s, { type: "setMembership", rate: 3 });
    expect(locked.ok).toBe(false); // 沒研發「會員與點數系統」不能發點數
    s.tech.done.push("t_member");
    expect(applyCommand(s, { type: "setMembership", rate: 4 }).ok).toBe(false);
    expect(applyCommand(s, { type: "setMembership", rate: 0 }).ok).toBe(false); // 已經是 0
    s = must(applyCommand(s, { type: "setMembership", rate: 3 }));
    expect(s.members!.rate).toBe(3);
    s.members!.count = 1500;
    const funds = s.funds;
    earnPoints(s, 100_000);
    expect(s.members!.points).toBeCloseTo(100_000 * 0.5 * 0.03, 5);
    expect(s.funds).toBe(funds); // 發點數當下沒花錢
    s.today.groups = 0;
    membersDaily(s);
    expect(s.members!.totalRedeemed).toBeGreaterThan(0);
    expect(funds - s.funds).toBe(s.members!.totalRedeemed); // 兌換時才付錢
    expect(s.today.memberCost).toBe(s.members!.totalRedeemed);
  });

  it("with the card on, members sign up and the mall levels up its tier; without it they drift away", () => {
    const on = mall();
    membersOf(on).rate = 3;
    for (let d = 0; d < 60; d++) {
      on.today.groups = 800;
      membersDaily(on);
    }
    expect(on.members!.count).toBeGreaterThan(500);
    const off = mall();
    membersOf(off).count = 1000;
    for (let d = 0; d < 60; d++) membersDaily(off);
    expect(off.members!.count).toBeLessThan(1000);
    expect(off.members!.count).toBeGreaterThan(700);
  });

  it("a mall with the card on earns points in real play, and reports them", () => {
    let s = mall(2);
    s.tech.done.push("t_member");
    s = must(applyCommand(s, { type: "setMembership", rate: 3 }));
    s.members!.count = 800;
    const out = advanceTo(s, START + 4 * DAY);
    expect(out.members!.totalIssued).toBeGreaterThan(0);
    expect(out.members!.totalRedeemed).toBeGreaterThan(0);
    expect(out.reports.some((r) => r.notes.some((n) => n.includes("會員")))).toBe(true);
  });

  it("members' data can leak: a big membership puts shops that keep personal data at legal risk", () => {
    const count = (members: number) => {
      let opened = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const s = mall(seed);
        s.shops.push(makeShop(s, "cosmetics", "美妝", 99));
        s.members = { rate: 3, count: members, points: 0, totalIssued: 0, totalRedeemed: 0, totalExpired: 0, lastDayIssued: 0, lastDayRedeemed: 0 };
        s.cleanliness = 100;
        s.equipment = 100;
        s.inspections.compliance = 100;
        s.tick += seed * 3;
        legalDaily(s);
        if (legalOf(s).cases.some((c) => c.kind === "privacy")) opened++;
      }
      return opened;
    };
    expect(count(100_000_000)).toBeGreaterThan(10);
    expect(count(100)).toBe(0);
  });
});

describe("the catalogue still lines up", () => {
  it("every regular's favourite and alternative exist as categories, and all 8 zones are reachable", () => {
    for (const r of REGULARS) {
      expect(CATEGORY_BY_ID[r.fav], r.id).toBeDefined();
      if (r.alt) expect(CATEGORY_BY_ID[r.alt], r.id).toBeDefined();
      expect(REGULAR_BY_ID[r.id]).toBe(r);
    }
    expect(new Set(CATEGORIES.map((c) => c.zone)).size).toBe(8);
  });
});
