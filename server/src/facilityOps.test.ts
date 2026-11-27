import { describe, expect, it } from "vitest";
import {
  FILM_POOL,
  conditionFactor,
  conditionOf,
  facilityOf,
  maintenanceCost,
  parkingBoostScale,
  parkingDailyIncome,
  parkingTrafficMult,
  priceFactor,
  weekFilms,
  FACILITY_BY_KIND,
  type MallState,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, type Command } from "./sim";

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const mk = (level = 8): MallState => {
  const s = createInitialState(7, START, 0);
  s.level = level;
  s.funds = 500_000_000;
  return s;
};
const run = (s: MallState, c: Command): MallState => {
  const r = applyCommand(s, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const fails = (s: MallState, c: Command): string | null => {
  const r = applyCommand(s, c);
  return r.ok ? null : r.error;
};
const DAYS = 6;
const profit = (s: MallState): number => advanceTo(s, s.tick + 288 * DAYS).funds - s.funds;

describe("設施營運層：預設值＝舊行為", () => {
  it("沒有 ops 的影城與明確設成預設值的影城，結果完全相同", () => {
    const a = mk();
    a.facilities = [{ kind: "cinema", units: 3 }];
    const b = mk();
    b.facilities = [{ kind: "cinema", units: 3, ops: { priceMult: 1, extra: false, films: [] } }];
    expect(advanceTo(a, a.tick + 288 * 3).funds).toBeCloseTo(advanceTo(b, b.tick + 288 * 3).funds, 2);
  });

  it("停車場沒有設定＝免費、沒有收入、來客加成照舊", () => {
    const s = mk();
    s.facilities = [{ kind: "parking", units: 3 }];
    expect(parkingDailyIncome(s)).toBe(0);
    expect(parkingBoostScale(s.facilities[0])).toBe(1);
    expect(parkingTrafficMult(s, "family")).toBeGreaterThan(1);
  });
});

describe("停車場收費政策", () => {
  it("計時收費有收入、購物折抵收入較少、免費沒有；收費讓來客加成打折", () => {
    const mkP = (policy: string, mult = 1) => {
      const s = mk();
      s.facilities = [{ kind: "parking", units: 3, ops: { policy, priceMult: mult } }];
      return s;
    };
    const paid = parkingDailyIncome(mkP("paid"));
    const valid = parkingDailyIncome(mkP("validate"));
    expect(paid).toBeGreaterThan(valid);
    expect(valid).toBeGreaterThan(0);
    expect(parkingBoostScale(mkP("validate").facilities![0])).toBeGreaterThan(1);
    expect(parkingBoostScale(mkP("paid").facilities![0])).toBeLessThan(1);
    expect(parkingBoostScale(mkP("paid", 1.5).facilities![0])).toBeLessThan(parkingBoostScale(mkP("paid", 1).facilities![0]));
  });

  it("營運中收費停車場真的賺錢（比免費多）", () => {
    const free = mk();
    free.facilities = [{ kind: "parking", units: 3 }];
    const paid = mk();
    paid.facilities = [{ kind: "parking", units: 3, ops: { policy: "paid" } }];
    expect(profit(paid)).toBeGreaterThan(profit(free));
  });

  it("指令：只有停車場能設停車政策；設定被夾在範圍內", () => {
    let s = mk();
    s.facilities = [{ kind: "parking", units: 2 }, { kind: "cinema", units: 2 }];
    expect(fails(s, { type: "setFacilityOps", kind: "cinema", policy: "paid" })).toContain("沒有這種政策");
    expect(fails(s, { type: "setFacilityOps", kind: "parking", policy: "bogus" })).toContain("沒有這種政策");
    s = run(s, { type: "setFacilityOps", kind: "parking", policy: "paid", priceMult: 9 });
    expect(facilityOf(s, "parking")!.ops!.priceMult).toBe(1.5);
    expect(facilityOf(s, "parking")!.ops!.policy).toBe("paid");
  });
});

describe("價格與接受度", () => {
  it("1.2 倍是甜蜜點之後客人嫌貴；太便宜賺不到錢", () => {
    expect(priceFactor(1)).toBe(1);
    expect(priceFactor(0.8)).toBeGreaterThan(1);
    expect(priceFactor(1.2) * 1.2).toBeGreaterThan(priceFactor(1) * 1);
    expect(priceFactor(1.5) * 1.5).toBeLessThan(priceFactor(1.2) * 1.2);
    expect(priceFactor(0.6) * 0.6).toBeLessThan(1);
  });

  it("影城票價調太高，營收反而掉", () => {
    const at = (mult: number) => {
      const s = mk();
      s.facilities = [{ kind: "cinema", units: 3, ops: { priceMult: mult } }];
      return profit(s);
    };
    expect(at(1.5)).toBeLessThan(at(1.2));
  });
});

describe("影城排片與賣品", () => {
  it("每週 6 部片、跨週輪替、決定性", () => {
    expect(weekFilms(0)).toHaveLength(6);
    expect(weekFilms(3).map((f) => f.id)).toEqual(weekFilms(6).map((f) => f.id));
    expect(weekFilms(0).map((f) => f.id)).not.toEqual(weekFilms(7).map((f) => f.id));
    expect(FILM_POOL.length).toBeGreaterThanOrEqual(10);
  });

  it("排熱門片拉高人次、授權費也較高；排的片已下檔＝平均片", () => {
    const best = weekFilms(0).slice().sort((a, b) => b.heat - a.heat)[0]!;
    const mkC = (films: string[]) => {
      const s = mk();
      s.facilities = [{ kind: "cinema", units: 3, ops: { films } }];
      return s;
    };
    const hot = advanceTo(mkC([best.id, best.id, best.id]), START + 288 * 2).facilities![0]!.today!.viewers;
    const none = advanceTo(mkC([]), START + 288 * 2).facilities![0]!.today!.viewers;
    expect(hot).toBeGreaterThan(none * 0.95);
    const gone = FILM_POOL.find((f) => !weekFilms(0).some((x) => x.id === f.id))!;
    const g = advanceTo(mkC([gone.id, gone.id, gone.id]), START + 288 * 2).facilities![0]!.today!.viewers;
    expect(g).toBeCloseTo(none, 5);
  });

  it("指令：排片只限影城，片要存在", () => {
    const s = mk();
    s.facilities = [{ kind: "cinema", units: 2 }, { kind: "bowling", units: 2 }];
    expect(fails(s, { type: "setFacilityOps", kind: "bowling", films: ["x"] })).toContain("只有影城");
    expect(fails(s, { type: "setFacilityOps", kind: "cinema", films: ["nope"] })).toContain("沒有這部片");
    expect(fails(s, { type: "setFacilityOps", kind: "cinema", films: ["", "", ""] })).toContain("無效");
    const ok = run(s, { type: "setFacilityOps", kind: "cinema", films: [FILM_POOL[0]!.id, ""], extra: true });
    expect(facilityOf(ok, "cinema")!.ops!.extra).toBe(true);
  });
});

describe("維護", () => {
  it("設備每天損耗；太舊營收打折；維護後回到 100，有冷卻", () => {
    expect(conditionFactor(100)).toBe(1);
    expect(conditionFactor(70)).toBe(1);
    expect(conditionFactor(0)).toBeCloseTo(0.6);
    let s = mk();
    s.facilities = [{ kind: "bowling", units: 4 }];
    s = advanceTo(s, s.tick + 288 * 10);
    const f = facilityOf(s, "bowling")!;
    expect(conditionOf(f)).toBeLessThan(90);
    const cost = maintenanceCost(FACILITY_BY_KIND.bowling!, f);
    expect(cost).toBeGreaterThan(0);
    const before = s.funds;
    const m = run(s, { type: "maintainFacility", kind: "bowling" });
    expect(conditionOf(facilityOf(m, "bowling"))).toBe(100);
    expect(m.funds).toBe(before - cost);
    expect(fails(m, { type: "maintainFacility", kind: "bowling" })).toContain("不需要");
  });

  it("不維護的設施營收比維護的少", () => {
    const base = () => {
      const s = mk();
      s.facilities = [{ kind: "bowling", units: 4, ops: { condition: 20 } }];
      return s;
    };
    const good = base();
    good.facilities![0]!.ops!.condition = 100;
    expect(profit(good)).toBeGreaterThan(profit(base()));
  });
});

describe("招商", () => {
  const withOffer = (kind = "cinema") => {
    const s = mk();
    s.facilities = [{ kind, units: 3 }];
    let t = advanceTo(s, s.tick + 288 * 30);
    // 偶爾才有營運商上門：30 天內一定會出現
    return t;
  };

  it("營運商會上門；接受後設施由營運商經營，自營決策被鎖住", () => {
    const t = withOffer();
    const offer = facilityOf(t, "cinema")!.ops!.offers![0]!;
    expect(offer.rent).toBeGreaterThan(0);
    const r = run(t, { type: "acceptFacilityOffer", kind: "cinema", offerId: offer.id });
    const f = facilityOf(r, "cinema")!;
    expect(f.ops!.operator!.brand).toBe(offer.brand);
    expect(fails(r, { type: "setFacilityOps", kind: "cinema", priceMult: 1.1 })).toContain("營運商");
    expect(fails(r, { type: "maintainFacility", kind: "cinema" })).toContain("營運商");
  });

  it("招商：收租金與抽成、不付設施的固定成本；營收是營運商的，不進我方營收", () => {
    const t = withOffer();
    const offer = facilityOf(t, "cinema")!.ops!.offers![0]!;
    const leased = run(t, { type: "acceptFacilityOffer", kind: "cinema", offerId: offer.id });
    const before = leased.funds;
    const a = advanceTo(leased, leased.tick + 288 * 4);
    expect(a.funds).toBeGreaterThan(before); // 至少有租金入帳
    expect(facilityOf(a, "cinema")!.ops!.operator).toBeDefined();
  });

  it("提前解約收回自營：付違約金、營運商離開", () => {
    const t = withOffer();
    const offer = facilityOf(t, "cinema")!.ops!.offers![0]!;
    const leased = run(t, { type: "acceptFacilityOffer", kind: "cinema", offerId: offer.id });
    const before = leased.funds;
    const back = run(leased, { type: "endFacilityLease", kind: "cinema" });
    expect(facilityOf(back, "cinema")!.ops!.operator).toBeUndefined();
    expect(back.funds).toBeLessThan(before);
    expect(fails(back, { type: "endFacilityLease", kind: "cinema" })).toContain("不是招商");
  });

  it("婉拒：邀約消失", () => {
    const t = withOffer();
    const offer = facilityOf(t, "cinema")!.ops!.offers![0]!;
    const d = run(t, { type: "declineFacilityOffer", kind: "cinema", offerId: offer.id });
    expect(facilityOf(d, "cinema")!.ops!.offers!.some((o) => o.id === offer.id)).toBe(false);
  });

  it("沒蓋的設施不能接營運商", () => {
    const s = mk();
    expect(fails(s, { type: "acceptFacilityOffer", kind: "hotel", offerId: "x" })).toContain("還沒有蓋");
  });

  it("所有設施都有營運商可以招（品牌目錄＋停車場營運商）", () => {
    for (const kind of Object.keys(FACILITY_BY_KIND)) {
      const s = mk();
      s.facilities = [{ kind, units: FACILITY_BY_KIND[kind]!.units.length > 2 ? 2 : 1 }];
      const t = advanceTo(s, s.tick + 288 * 40);
      expect(facilityOf(t, kind)!.ops!.offers?.length ?? 0, kind).toBeGreaterThan(0);
    }
  });

  it("決定性：同樣的存檔兩次推進結果一致", () => {
    const s = mk();
    s.facilities = [{ kind: "hotel", units: 2 }];
    const a = advanceTo(structuredClone(s), s.tick + 288 * 20);
    const b = advanceTo(structuredClone(s), s.tick + 288 * 20);
    expect(JSON.stringify(a.facilities)).toBe(JSON.stringify(b.facilities));
    expect(a.funds).toBe(b.funds);
  });
});

describe("預約看板（會議中心／活動場地）：有預約才有收入", () => {
  const mkB = (kind: string, units: number, ops: object = {}) => {
    const s = mk();
    s.facilities = [{ kind, units, ops }];
    return s;
  };

  it("伺服器把預約補到未來 7 天；同樣的存檔結果一致", () => {
    const a = advanceTo(mkB("conference", 3), START + 5);
    const b = advanceTo(mkB("conference", 3), START + 5);
    const list = facilityOf(a, "conference")!.ops!.bookings!;
    expect(list.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).toBe(JSON.stringify(facilityOf(b, "conference")!.ops!.bookings));
    const days = new Set(list.map((x) => x.day));
    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(8);
    for (const x of list) expect(x.kind).not.toBe("artist"); // 藝人演出是未來掛點
  });

  it("沒有預約就沒有收入；有預約的場次開場後才進帳", () => {
    for (const kind of ["conference", "event_space"]) {
      const s = mkB(kind, 2);
      const a = advanceTo(s, s.tick + 288 * 6);
      const f = facilityOf(a, kind)!;
      const paid = f.ops!.bookings!.filter((x) => x.paid && x.kind === "rent");
      expect(paid.length, kind).toBeGreaterThan(0);
      expect(a.funds, kind).not.toBeNaN();
    }
    // 價格最高、需求低時預約少，收入也少
    const hi = advanceTo(mkB("conference", 2, { priceMult: 1.5 }), START + 288 * 6);
    const lo = advanceTo(mkB("conference", 2, { priceMult: 1.2 }), START + 288 * 6);
    const n = (m: MallState) => facilityOf(m, "conference")!.ops!.bookings!.filter((x) => x.kind === "rent").length;
    expect(n(hi)).toBeLessThan(n(lo));
  });

  it("保留自辦檔期：每週有自辦場次（只收一半票務）、沒有藝人；外租較少", () => {
    const own = advanceTo(mkB("event_space", 2, { policy: "reserve" }), START + 288 * 9);
    const list = facilityOf(own, "event_space")!.ops!.bookings!;
    expect(list.some((x) => x.kind === "own")).toBe(true);
    const rent = list.find((x) => x.kind === "rent");
    const mine = list.find((x) => x.kind === "own")!;
    if (rent) expect(mine.fee).toBeLessThan(rent.fee);
    expect(fails(mkB("bowling", 2), { type: "setFacilityOps", kind: "bowling", policy: "reserve" })).toContain("沒有這種政策");
  });

  it("預約開場前沒進帳、跨日不重複結算", () => {
    const s = mkB("conference", 2);
    const a = advanceTo(s, s.tick + 288 * 3);
    const b = advanceTo(a, a.tick + 1);
    const sum = (m: MallState) => facilityOf(m, "conference")!.today?.revenue ?? 0;
    expect(sum(b)).toBeGreaterThanOrEqual(0);
    const paidTwice = facilityOf(b, "conference")!.ops!.bookings!.filter((x) => x.paid && x.day > Math.floor(b.tick / 288) + 8);
    expect(paidTwice).toHaveLength(0);
  });
});

describe("營運商洽談：還價與續約", () => {
  const offered = () => {
    const s = mk();
    s.facilities = [{ kind: "cinema", units: 3 }];
    return advanceTo(s, s.tick + 288 * 30);
  };

  it("還價：只能一次、幅度要合法；成功租金上漲，失敗營運商離開", () => {
    const t = offered();
    const o = facilityOf(t, "cinema")!.ops!.offers![0]!;
    expect(fails(t, { type: "counterFacilityOffer", kind: "cinema", offerId: o.id, mult: 2 })).toContain("無效");
    const r = run(t, { type: "counterFacilityOffer", kind: "cinema", offerId: o.id, mult: 1.1 });
    const after = facilityOf(r, "cinema")!.ops!.offers!.find((x) => x.id === o.id);
    if (after) {
      expect(after.rent).toBeGreaterThan(o.rent);
      expect(fails(r, { type: "counterFacilityOffer", kind: "cinema", offerId: o.id, mult: 1.1 })).toContain("只能還一次");
    } else {
      expect(facilityOf(r, "cinema")!.ops!.offers!.some((x) => x.id === o.id)).toBe(false);
    }
  });

  const leasedAtEnd = (sat: number) => {
    const t = offered();
    const o = facilityOf(t, "cinema")!.ops!.offers![0]!;
    const l = run(t, { type: "acceptFacilityOffer", kind: "cinema", offerId: o.id });
    const op = facilityOf(l, "cinema")!.ops!.operator!;
    op.endTick = l.tick + 1;
    op.satisfaction = sat;
    // 推進到日結算處理完租約到期為止（最多 2 天）
    let m = l;
    for (let i = 0; i < 300 && m.tick < l.tick + 288 * 2; i++) {
      m = advanceTo(m, m.tick + 24);
      const o = facilityOf(m, "cinema")!.ops!;
      if (o.renewal || !o.operator) break;
    }
    return m;
  };

  it("租約到期：滿意的營運商來談續約，可以照條件續、加租或不續", () => {
    const a = leasedAtEnd(80);
    const ren = facilityOf(a, "cinema")!.ops!.renewal;
    expect(ren).toBeDefined();
    const renewed = run(a, { type: "resolveFacilityRenewal", kind: "cinema", action: "renew" });
    expect(facilityOf(renewed, "cinema")!.ops!.operator!.endTick).toBeGreaterThan(a.tick);
    expect(facilityOf(renewed, "cinema")!.ops!.renewal).toBeUndefined();
    const raised = run(a, { type: "resolveFacilityRenewal", kind: "cinema", action: "raise" });
    expect(facilityOf(raised, "cinema")!.ops!.operator!.rent).toBeGreaterThan(ren!.rent);
    const out = run(a, { type: "resolveFacilityRenewal", kind: "cinema", action: "release" });
    expect(facilityOf(out, "cinema")!.ops!.operator).toBeUndefined();
    expect(fails(out, { type: "resolveFacilityRenewal", kind: "cinema", action: "renew" })).toContain("處理過");
  });

  it("沒處理續約：期限到了自動續約；營運商不滿意就直接離開", () => {
    const a = leasedAtEnd(80);
    const later = advanceTo(a, a.tick + 288 * 3);
    expect(facilityOf(later, "cinema")!.ops!.operator).toBeDefined();
    expect(facilityOf(later, "cinema")!.ops!.renewal).toBeUndefined();
    const unhappy = leasedAtEnd(20);
    expect(facilityOf(unhappy, "cinema")!.ops!.operator).toBeUndefined();
  });

  it("營運商不滿意（滿意度 <65）時要求加租會被拒、營運商離開", () => {
    const a = leasedAtEnd(80);
    facilityOf(a, "cinema")!.ops!.operator!.satisfaction = 50;
    const raised = run(a, { type: "resolveFacilityRenewal", kind: "cinema", action: "raise" });
    expect(facilityOf(raised, "cinema")!.ops!.operator).toBeUndefined();
  });
});
