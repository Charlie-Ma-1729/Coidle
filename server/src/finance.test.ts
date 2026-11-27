import { describe, expect, it } from "vitest";
import {
  BIZ_INSURANCE,
  CLIMATES,
  LENDERS,
  LOAN_MIN,
  PRODUCTS,
  RESTRUCTURE_MISSED_DAYS,
  TICKS_PER_DAY,
  TICK_MINUTES,
  bizClaimAmount,
  creditClimate,
  debtOf,
  gradeOf,
  loanDue,
  underwrite,
  underwriteInput,
  type Climate,
  type MallState,
  type UnderwriteInput,
} from "@coidle/shared";
import { advanceFully, advanceTo, applyCommand, createInitialState, type Command } from "./sim";
import { financeDaily, financeOf, noteClosure } from "./sim/finance";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const DAY = TICKS_PER_DAY;

const must = (r: ReturnType<typeof applyCommand>): MallState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const apply = (s: MallState, c: Command) => must(applyCommand(s, c));
const fails = (s: MallState, c: Command) => {
  const r = applyCommand(s, c);
  return r.ok ? null : r.error;
};

/** 跑幾天、產生日報，排除稽查與商戰的干擾 */
function mall(days = 10, seed = 7): MallState {
  let s = createInitialState(seed, START);
  s.flags.noWorldShocks = true;
  s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
  for (const id of Object.keys(s.rivals.nextAt)) s.rivals.nextAt[id] = s.tick + 10_000_000;
  s.funds = 20_000_000;
  s = advanceFully(s, s.tick + days * DAY);
  return s;
}

/** 只看審查，不動狀態：手動改快照 */
function input(s: MallState, patch: Partial<UnderwriteInput> = {}): UnderwriteInput {
  return { ...underwriteInput(s), ...patch };
}

describe("授信審查：營運、口碑、信用三類各自影響結果", () => {
  const s = mall();
  const base = input(s, { funds: 5_000_000, avgRevenue: 800_000, avgProfit: 160_000, lossDays: 0, reportDays: 7, localRep: 60, touristHeat: 60, openCases: 0, severeIssues: 0, compliance: 70, overdueTax: 0, recordScore: 70, debt: 0, level: 3 });
  const score = (i: UnderwriteInput, p: keyof typeof PRODUCTS = "working", c: Climate = "normal") => underwrite(i, p, c, undefined).score;

  it("狀況好的商場核准週轉貸款，而且有額度與合理利率", () => {
    const q = underwrite(base, "working", "normal", undefined);
    expect(q.decision).toBe("approve");
    expect(q.limit).toBeGreaterThanOrEqual(LOAN_MIN);
    expect(q.rate).toBeGreaterThan(0);
    expect(q.rate).toBeLessThan(0.006);
    expect(q.reasons.length).toBeGreaterThan(0);
  });

  it("營運變差分數下降：虧損、現金為負、負債高", () => {
    const b = score(base);
    expect(score({ ...base, avgProfit: -200_000, lossDays: 5 })).toBeLessThan(b);
    expect(score({ ...base, funds: -300_000 })).toBeLessThan(b);
    expect(score({ ...base, debt: 20_000_000 })).toBeLessThan(b);
  });

  it("口碑變差分數下降：口碑低、糾紛、巡店嚴重問題", () => {
    const b = score(base);
    expect(score({ ...base, localRep: 20, touristHeat: 20 })).toBeLessThan(b);
    expect(score({ ...base, openCases: 3 })).toBeLessThan(b);
    expect(score({ ...base, severeIssues: 3 })).toBeLessThan(b);
  });

  it("信用變差分數下降：逾期稅單、還款紀錄差、重整中；投保會加分", () => {
    const b = score(base);
    expect(score({ ...base, overdueTax: 2 })).toBeLessThan(b);
    expect(score({ ...base, recordScore: 20 })).toBeLessThan(b);
    expect(score({ ...base, restructuring: true })).toBeLessThan(b);
    expect(score({ ...base, insured: true })).toBeGreaterThan(b);
  });

  it("太差的商場被婉拒並附上理由；婉拒時額度是 0", () => {
    const bad = { ...base, avgProfit: -400_000, lossDays: 6, funds: -500_000, localRep: 10, touristHeat: 10, recordScore: 15, overdueTax: 3, openCases: 3 };
    const q = underwrite(bad, "working", "normal", undefined);
    expect(q.decision).toBe("decline");
    expect(q.limit).toBe(0);
    expect(q.reasons.join("")).toContain("未達");
    expect(gradeOf(q.score)).toBe(q.grade);
  });

  it("三家機構權重不同：重口碑的木霊比重信用的常盤更看重口碑", () => {
    const lowRep = { ...base, localRep: 10, touristHeat: 10, openCases: 2 };
    const drop = (p: "working" | "short") => score(base, p) - score(lowRep, p);
    expect(drop("short")).toBeGreaterThan(drop("working"));
    expect(LENDERS.kodama_securities.weights.rep).toBeGreaterThan(LENDERS.tokiwa_fin.weights.rep);
  });

  it("長期貸付要求商場等級；等級不夠不開放", () => {
    const q = underwrite({ ...base, level: 2 }, "long", "normal", undefined);
    expect(q.available).toBe(false);
    expect(q.decision).toBe("decline");
  });

  it("沒有營運資料時不能核定額度", () => {
    const q = underwrite({ ...base, avgRevenue: 0, reportDays: 0 }, "working", "normal", undefined);
    expect(q.decision === "decline" || q.limit === 0).toBe(true);
  });

  it("緊急授信：評等正常或現金還夠就不給；其他機構都婉拒且現金吃緊才給，額度很小", () => {
    expect(underwrite(base, "emergency", "normal", undefined).decision).toBe("decline");
    const broke = { ...base, funds: -400_000, avgProfit: -400_000, lossDays: 7, localRep: 10, touristHeat: 10, recordScore: 10, overdueTax: 3, openCases: 3, dailyFixed: 300_000 };
    const q = underwrite(broke, "emergency", "normal", undefined);
    expect(q.decision).toBe("approve");
    expect(q.limit).toBeLessThanOrEqual(300_000 * 3);
    // 緊急授信的利率比一般貸款高
    expect(q.rate).toBeGreaterThan(underwrite(base, "working", "normal", undefined).rate);
    // 現金還撐得住就不給
    expect(underwrite({ ...broke, funds: 5_000_000 }, "emergency", "normal", undefined).decision).toBe("decline");
  });
});

describe("授信氣候：跟著該企業的股價走勢", () => {
  it("股價走弱收緊、走強寬鬆、平穩正常", () => {
    expect(creditClimate(-0.1, -0.05).level).toBe("tight");
    expect(creditClimate(0.1, 0.05).level).toBe("loose");
    expect(creditClimate(0.01, -0.01).level).toBe("normal");
    expect(creditClimate(Number.NaN, Number.NaN).level).toBe("normal");
  });

  it("寬鬆時額度較大、利率較低；收緊相反", () => {
    const s = mall();
    const i = input(s, { funds: 5_000_000, avgRevenue: 800_000, avgProfit: 160_000, lossDays: 0, reportDays: 7, localRep: 60, touristHeat: 60, openCases: 0, severeIssues: 0, compliance: 70, overdueTax: 0, recordScore: 70, debt: 0, level: 6 });
    const loose = underwrite(i, "working", "loose", undefined);
    const tight = underwrite(i, "working", "tight", undefined);
    expect(loose.limit).toBeGreaterThan(tight.limit);
    expect(loose.rate).toBeLessThan(tight.rate);
    expect(CLIMATES.loose.limitMult).toBeGreaterThan(CLIMATES.tight.limitMult);
  });

  it("木霊証券行情熱絡時門檻放寬", () => {
    expect(CLIMATES.loose.minScoreAdj).toBeLessThan(0);
    expect(CLIMATES.tight.minScoreAdj).toBeGreaterThan(0);
  });
});

describe("貸款：借、還、固定條款", () => {
  it("借款入帳、條款固定寫進貸款；前端沒帶 terms 就當正常氣候", () => {
    const s0 = mall();
    const q = underwrite(underwriteInput(s0), "working", "normal", s0.finance);
    expect(q.decision).not.toBe("decline");
    const amount = Math.min(q.limit, 2_000_000);
    const s1 = apply(s0, { type: "takeLoan", product: "working", amount });
    expect(s1.funds).toBe(s0.funds + amount);
    const loan = s1.finance!.loans[0]!;
    expect(loan.principal).toBe(amount);
    expect(loan.dailyRate).toBe(q.rate);
    expect(loan.lender).toBe("tokiwa_fin");
    expect(loan.dueTick).toBe(s0.tick + PRODUCTS.working.termDays * DAY);
    // 收緊氣候下借，利率較高，而且之後不會變
    const s2 = apply(s0, { type: "takeLoan", product: "working", amount, terms: { climate: "tight" } });
    expect(s2.finance!.loans[0]!.dailyRate).toBeGreaterThan(loan.dailyRate);
  });

  it("超過核定額度、金額太小、同一產品重複借都被擋", () => {
    const s0 = mall();
    const q = underwrite(underwriteInput(s0), "working", "normal", s0.finance);
    expect(fails(s0, { type: "takeLoan", product: "working", amount: q.limit + 1_000_000 })).toContain("核定額度");
    expect(fails(s0, { type: "takeLoan", product: "working", amount: 1000 })).toContain("至少");
    const s1 = apply(s0, { type: "takeLoan", product: "working", amount: Math.min(q.limit, 1_000_000) });
    expect(fails(s1, { type: "takeLoan", product: "working", amount: LOAN_MIN })).toContain("還沒還清");
  });

  it("每日還款：本金一期加利息從資金扣，利息進日報支出，帳目守恆", () => {
    const s0 = mall();
    const amount = 1_000_000;
    let s = apply(s0, { type: "takeLoan", product: "working", amount });
    const loan = s.finance!.loans[0]!;
    const due = loanDue(loan, s.tick);
    const funds = s.funds;
    const repairs = s.today.repairs;
    financeDaily(s);
    expect(s.funds).toBe(funds - due.total);
    expect(s.finance!.loans[0]!.outstanding).toBe(amount - due.principal);
    expect(s.today.interestCost).toBe(due.interest);
    expect(s.today.repairs).toBe(repairs + due.interest); // 利息算進支出（可扣抵）；本金不算支出
    expect(s.finance!.totalInterest).toBe(due.interest);
    expect(debtOf(s.finance)).toBe(amount - due.principal);
    s = s0; // 不影響原狀態
    expect(s.finance?.loans ?? []).toHaveLength(0);
  });

  it("部分還款、提前還清；還清後有冷卻不能立刻再借同一種", () => {
    const s0 = mall();
    let s = apply(s0, { type: "takeLoan", product: "working", amount: 1_000_000 });
    const id = s.finance!.loans[0]!.id;
    s = apply(s, { type: "repayLoan", loanId: id, amount: 400_000 });
    expect(s.finance!.loans[0]!.outstanding).toBe(600_000);
    expect(fails(s, { type: "repayLoan", loanId: "nope" })).toContain("找不到");
    expect(fails(s, { type: "repayLoan", loanId: id, amount: -5 })).toContain("無效");
    s = apply(s, { type: "repayLoan", loanId: id });
    expect(s.finance!.loans).toHaveLength(0);
    expect(s.finance!.history.at(-1)!.outcome).toBe("early");
    expect(s.finance!.score).toBeGreaterThan(60);
    const q = underwrite(underwriteInput(s), "working", "normal", s.finance);
    expect(q.decision).toBe("decline");
    expect(q.reasons.join("")).toContain("剛還清");
  });

  it("準時還款慢慢加信用分；沒繳足扣分", () => {
    const s0 = mall();
    const s = apply(s0, { type: "takeLoan", product: "working", amount: 1_000_000 });
    const before = s.finance!.score;
    financeDaily(s);
    expect(s.finance!.score).toBeGreaterThan(before);
    const t = apply(s0, { type: "takeLoan", product: "working", amount: 1_000_000 });
    t.funds = 0;
    const b2 = t.finance!.score;
    financeDaily(t);
    expect(t.finance!.score).toBeLessThan(b2);
    expect(t.finance!.loans[0]!.missedDays).toBe(1);
  });
});

describe("重整：逾期後進入重整並強制出租，還清解除，不會死局", () => {
  function overdue(): MallState {
    const s0 = mall();
    expect(s0.shops.filter((x) => x.mode === "direct").length).toBeGreaterThanOrEqual(3);
    const s = apply(s0, { type: "takeLoan", product: "working", amount: 1_000_000 });
    return s;
  }

  it("連續逾期達門檻才進重整，並把營收最低的店轉成出租（至少留一間直營）", () => {
    const s = overdue();
    const direct0 = s.shops.filter((x) => x.mode === "direct").length;
    for (let d = 0; d < RESTRUCTURE_MISSED_DAYS - 1; d++) {
      s.funds = 0;
      financeDaily(s);
      s.tick += DAY;
    }
    expect(s.finance!.restructure).toBeNull();
    s.funds = 0;
    financeDaily(s);
    const rs = s.finance!.restructure;
    expect(rs).not.toBeNull();
    expect(rs!.reason).toBe("overdue");
    expect(rs!.forcedShops.length).toBeGreaterThanOrEqual(1);
    expect(s.shops.filter((x) => x.mode === "direct").length).toBe(direct0 - rs!.forcedShops.length);
    expect(s.shops.filter((x) => x.mode === "direct").length).toBeGreaterThanOrEqual(1);
    for (const id of rs!.forcedShops) expect(s.shops.find((x) => x.id === id)!.mode).toBe("lease");
  });

  it("重整期間擴建、升級、立項凍結；被強制出租的店不能自己改回，還清後解除", () => {
    const s = overdue();
    for (let d = 0; d < RESTRUCTURE_MISSED_DAYS; d++) {
      s.funds = 0;
      financeDaily(s);
      s.tick += DAY;
    }
    expect(s.finance!.restructure).not.toBeNull();
    s.funds = 50_000_000;
    const forced = s.finance!.restructure!.forcedShops[0]!;
    const shopId = s.shops.find((x) => x.mode === "direct")!.id;
    expect(fails(s, { type: "upgradeShop", shopId })).toContain("重整");
    expect(fails(s, { type: "expandZone", zone: "b1" })).toContain("重整");
    expect(fails(s, { type: "setLease", shopId: forced, enabled: false })).toContain("重整");
    // 還清貸款 → 解除
    const loanId = s.finance!.loans[0]!.id;
    const done = apply(s, { type: "repayLoan", loanId });
    expect(done.finance!.restructure).toBeNull();
    expect(fails(done, { type: "upgradeShop", shopId })).toBeNull(); // 解除後可以升級了
    const back = apply(done, { type: "setLease", shopId: forced, enabled: false });
    expect(back.shops.find((x) => x.id === forced)!.mode).toBe("direct");
  });

  it("重整中仍逾期，隔幾天會再多轉一批；租金進帳後有錢就自動還款", () => {
    const s = overdue();
    for (let d = 0; d < RESTRUCTURE_MISSED_DAYS; d++) {
      s.funds = 0;
      financeDaily(s);
      s.tick += DAY;
    }
    const first = s.finance!.restructure!.forcedShops.length;
    for (let d = 0; d < 4; d++) {
      s.funds = 0;
      financeDaily(s);
      s.tick += DAY;
    }
    expect(s.finance!.restructure!.forcedShops.length).toBeGreaterThanOrEqual(first);
    // 有錢之後，下一個結算日就把逾期的補繳，連續逾期歸零
    s.funds = 10_000_000;
    financeDaily(s);
    expect(s.finance!.loans[0]!.missedDays).toBe(0);
  });

  it("緊急授信：評等太差、現金吃緊才給；借了當下就進重整，錢進帳", () => {
    const s0 = mall();
    s0.funds = -800_000;
    s0.localRep = 5;
    s0.touristHeat = 5;
    const fin = financeOf(s0);
    fin.score = 5;
    s0.reports = s0.reports.map((r) => ({ ...r, profit: -300_000, revenue: 100_000 }));
    const q = underwrite(underwriteInput(s0), "emergency", "normal", s0.finance);
    expect(q.decision === "approve" || q.decision === "reduced").toBe(true);
    expect(q.limit).toBeGreaterThanOrEqual(LOAN_MIN);
    const s1 = apply(s0, { type: "takeLoan", product: "emergency", amount: q.limit });
    expect(s1.funds).toBe(s0.funds + q.limit);
    expect(s1.finance!.restructure?.reason).toBe("emergency");
    expect(s1.finance!.loans[0]!.emergency).toBe(true);
  });

  it("資金為負的商場也不會完全鎖死：其他產品都婉拒時，緊急授信還開著", () => {
    const s0 = mall();
    s0.funds = -2_000_000;
    s0.localRep = 5;
    s0.touristHeat = 5;
    financeOf(s0).score = 0;
    s0.reports = s0.reports.map((r) => ({ ...r, profit: -500_000, revenue: 50_000 }));
    const i = underwriteInput(s0);
    for (const p of ["working", "short", "long"] as const) expect(underwrite(i, p, "normal", s0.finance).decision).toBe("decline");
    expect(underwrite(i, "emergency", "normal", s0.finance).limit).toBeGreaterThanOrEqual(LOAN_MIN);
  });
});

describe("營業中斷險", () => {
  it("投保後意外停業會理賠，有上限；保費每日扣", () => {
    const s = mall();
    const shop = s.shops.find((x) => x.mode === "direct")!;
    const a = apply(s, { type: "setBizInsurance", level: 1 });
    const shopA = a.shops.find((x) => x.id === shop.id)!;
    noteClosure(a, shopA, 36);
    const funds = a.funds;
    const direct = a.shops.filter((x) => x.mode === "direct").length;
    financeDaily(a);
    const prem = BIZ_INSURANCE[1]!.premium * direct;
    const claim = a.today.insuranceClaim ?? 0;
    expect(a.funds).toBe(funds - prem + claim);
    expect(claim).toBeLessThanOrEqual(BIZ_INSURANCE[1]!.cap);
    expect(a.finance!.claims).toEqual({});
    expect(a.finance!.totalClaimed).toBe(claim);
    // 沒投保就不理賠
    const none = mall();
    noteClosure(none, none.shops[0]!, 36);
    expect(none.finance).toBeUndefined();
  });

  it("理賠金額和停業時間、方案成正比；完整險比基本險賠得多", () => {
    expect(bizClaimAmount(2, 300_000, 72)).toBeGreaterThan(bizClaimAmount(1, 300_000, 72));
    expect(bizClaimAmount(1, 300_000, 72)).toBeGreaterThan(bizClaimAmount(1, 300_000, 18));
    expect(bizClaimAmount(0, 300_000, 72)).toBe(0);
  });

  it("方案無效或重複設定會被擋", () => {
    const s = mall();
    expect(fails(s, { type: "setBizInsurance", level: 9 })).toContain("無效");
    const a = apply(s, { type: "setBizInsurance", level: 1 });
    expect(fails(a, { type: "setBizInsurance", level: 1 })).toContain("已經");
  });
});

describe("底線補強", () => {
  it("手動進貨要付得起；資金不足就不能把帳拉得更深", () => {
    const s = mall();
    const shop = s.shops.find((x) => x.mode === "direct" && ["ramen", "kushikatsu", "takoyaki", "udon", "curry", "grocery"].includes(x.category)) ?? s.shops.find((x) => x.mode === "direct")!;
    s.funds = 0;
    const err = fails(s, { type: "orderStock", shopId: shop.id, qty: 50 });
    expect(err).not.toBeNull();
  });
});

describe("決定性：追趕與一次補算等價", () => {
  it("有貸款、保險的商場，分段推進與一次補算得到同樣的狀態", () => {
    let base = mall(6, 11);
    base = apply(base, { type: "setBizInsurance", level: 1 });
    base = apply(base, { type: "takeLoan", product: "working", amount: 1_000_000 });
    const t = base.tick + 5 * DAY;
    const once = advanceTo(structuredClone(base), t);
    let step = structuredClone(base);
    for (let k = 1; k <= 5; k++) step = advanceTo(step, base.tick + k * DAY);
    expect(step.tick).toBe(once.tick);
    expect(step.funds).toBe(once.funds);
    expect(JSON.stringify(step.finance)).toBe(JSON.stringify(once.finance));
    // 一路推進到期的貸款最後會結清或持續還款，不會出現負的本金
    for (const l of once.finance!.loans) expect(l.outstanding).toBeGreaterThanOrEqual(0);
  });

  it("舊存檔沒有 finance 欄位也能照常運作（可選欄位）", () => {
    const s = mall(3, 5);
    expect(s.finance).toBeUndefined();
    const t = advanceTo(s, s.tick + DAY);
    expect(t.tick).toBeGreaterThan(s.tick);
  });
});
