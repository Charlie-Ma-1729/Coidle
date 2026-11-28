import { describe, expect, it } from "vitest";
import { buybackPrice, issuePrice, sharesForCapital, stakeValue } from "@coidle/shared";

// 守恆：撤資（A）→ 注資（B）→ 再撤資 → 再注資 … 怎麼繞，玩家在「淨資產」上的份額都不會增加。
// 價格規則：撤資價 ≤ min(估值 × 0.9, 持股在淨資產上的份額)；注資價 ＝ max(估值, 淨資產) 的每股價（不低於 100）。

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

interface Mall {
  nav: number;
  /** 估值（含獲利溢價，再被每日浮動帶夾過：可能略低於淨資產，也可能到 2.2 倍） */
  value: number;
  total: number;
}

function randomMall(r: () => number): Mall {
  const nav = Math.round(500_000 + r() * 200_000_000);
  const value = Math.round(nav * (0.9 + r() * 1.3));
  const total = Math.round(1_000 + r() * 200_000);
  return { nav, value, total };
}

/** 注資：回傳玩家拿到的股數、花費，以及注資後他在淨資產上的份額；mall 會被更新 */
function inject(m: Mall, amount: number) {
  const entry = Math.max(m.value, m.nav);
  const { shares, cost } = sharesForCapital(amount, entry, m.total);
  m.nav += cost;
  m.value += cost; // 估值跟著現金增加（每股估值不變）
  m.total += shares;
  return { shares, cost, claim: (shares / m.total) * m.nav };
}

describe("撤資 → 注資不獲利（資金守恆）", () => {
  it("撤資價不超過持股在淨資產上的份額；獲利溢價領不成現金", () => {
    // 估值 = 淨資產 × 2（溢價拉滿）：以前 9 折＝1.8 倍，現在封頂在 1.0 倍
    const price = buybackPrice(1_000, 20_000_000, 10_000, 10_000_000);
    expect(price).toBe(stakeValue(1_000, 10_000_000, 10_000)); // 1,000,000
    expect(buybackPrice(1_000, 20_000_000, 10_000)).toBe(1_800_000); // 舊算法（沒帶淨資產）
    // 沒溢價時仍是 9 折
    expect(buybackPrice(1_000, 10_000_000, 10_000, 10_000_000)).toBe(900_000);
    // 估值落在淨資產下方（浮動帶落後）：取較低的 9 折
    expect(buybackPrice(1_000, 8_000_000, 10_000, 10_000_000)).toBe(720_000);
  });

  it("任意兩座商場：撤 A → 注 B，換回的淨資產份額 ≤ 拿出去的", () => {
    const r = rng(20261129);
    for (let i = 0; i < 5_000; i++) {
      const A = randomMall(r);
      const B = randomMall(r);
      const sell = Math.max(1, Math.floor(A.total * (0.01 + r() * 0.5)));
      const claimA = (sell / A.total) * A.nav;
      const cash = buybackPrice(sell, A.value, A.total, A.nav);
      expect(cash, `case ${i}`).toBeLessThanOrEqual(claimA + 1);
      if (cash < 1) continue;
      const got = inject(B, cash);
      expect(got.cost).toBeLessThanOrEqual(cash);
      expect(got.claim, `case ${i}`).toBeLessThanOrEqual(claimA + 1);
    }
  });

  it("A、B 來回繞很多圈，淨資產份額只會單調下降", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const A = randomMall(r);
      const B = randomMall(r);
      let sharesA = Math.floor(A.total * 0.4);
      let sharesB = 0;
      let claim = (sharesA / A.total) * A.nav;
      for (let hop = 0; hop < 12; hop++) {
        // A 撤資 → B 注資
        const sell = Math.max(1, Math.floor(sharesA * 0.5));
        if (sell > sharesA) break;
        const cash = buybackPrice(sell, A.value, A.total, A.nav);
        A.nav -= cash;
        A.value = Math.max(0, A.value - cash);
        A.total -= sell; // 變成庫藏股，不計入流通
        sharesA -= sell;
        const into = inject(B, cash);
        sharesB += into.shares;
        // B 撤資 → A 注資（把錢換回 A 的股份）
        const back = Math.max(1, Math.floor(sharesB * 0.5));
        if (back > sharesB || sharesB < 1) continue;
        const cash2 = buybackPrice(back, B.value, B.total, B.nav);
        B.nav -= cash2;
        B.value = Math.max(0, B.value - cash2);
        B.total -= back;
        sharesB -= back;
        const again = inject(A, cash2);
        sharesA += again.shares;
        const now = (sharesA / A.total) * A.nav + (sharesB / B.total) * B.nav;
        expect(now, `case ${i} hop ${hop}`).toBeLessThanOrEqual(claim * 1.001 + 2);
        claim = now;
      }
    }
  });

  it("同一座商場撤資再原價買回一定虧（9 折）", () => {
    const r = rng(99);
    for (let i = 0; i < 1_000; i++) {
      const m = randomMall(r);
      const sell = Math.max(1, Math.floor(m.total * 0.2));
      const cash = buybackPrice(sell, m.value, m.total, m.nav);
      const outstanding = m.total - sell;
      const entry = Math.max(m.value - cash, m.nav - cash);
      const { shares, cost } = sharesForCapital(cash, Math.max(entry, 0), outstanding);
      // 買回的股數不會比賣出的多（以同一時點、同一每股價計）
      const rebuyPrice = issuePrice(Math.max(m.value, m.nav), m.total);
      expect(Math.floor(cash / rebuyPrice)).toBeLessThanOrEqual(sell);
      expect(cost).toBeLessThanOrEqual(cash);
      expect(shares).toBeGreaterThanOrEqual(0);
    }
  });
});
