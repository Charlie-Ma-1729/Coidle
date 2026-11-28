import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  DIVIDEND_COOLDOWN_MS,
  EQUITY_MIN_ACCOUNT_AGE_MS,
  EQUITY_MIN_ACTIVE_DAYS,
  EQUITY_MIN_MALL_REVENUE,
  FOUNDING_COST,
  INITIAL_FUNDS,
  INITIAL_SHARES,
  RELATED_STAKE_PCT,
  RELATED_TAIL_MS,
  STARTER_QUESTS,
  WORLD_EPOCH_MS,
  buybackPrice,
  mallBookValue,
  netAssets,
  equityBlocker,
  sharesForCapital,
  splitDividend,
  type EquityStanding,
  type MallState,
} from "@coidle/shared";
import { buildApp } from "./app";
import { MIGRATIONS } from "./db/db";
import { calm } from "./testutil";

// 股權：創辦人起始 100%；持股過半＝實際控制人；退出要先賣給其他股東或請商場回購（撤資）；
// 股利按比例並扣稅；注資換股（先買庫藏股、再發新股）；起始資金是「每位玩家一次」。

const DAY = 86_400_000;
const clock = { t: WORLD_EPOCH_MS + DAY };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + DAY;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;

async function reg(a: App, username: string) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName: username } });
  const cookie = `coidle_sid=${res.cookies.find((x) => x.name === "coidle_sid")!.value}`;
  const me = (await a.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
  return { cookie, id: me.user.id as number };
}
/** 既有測試不是在測股權變現門檻，所以送出前先把成員都視為達標；門檻本身的測試用 raw()（不 vouch） */
const raw = (a: App, cookie: string, url: string, payload: unknown = {}) => a.app.inject({ method: "POST", url, headers: { cookie }, payload: payload as object });
const post = (a: App, cookie: string, url: string, payload: unknown = {}) => {
  a.repo.vouchAllMembers();
  return raw(a, cookie, url, payload);
};
const get = (a: App, cookie: string, url: string) => a.app.inject({ method: "GET", url, headers: { cookie } });
/** 持股加庫藏股＝總股數（永遠成立） */
const conserved = (a: App, mallId: number) => a.repo.holdingsOfMall(mallId).reduce((x, h) => x + h.shares, 0) + a.repo.treasuryOf(mallId) === a.repo.totalSharesOf(mallId);
const funds = (a: App, mallId: number) => Math.round(a.service.sync(mallId).funds);
/** 商場估值（沒跑過整個遊戲日，所以沒有錨點，等於即時估值） */
const worth = (a: App, mallId: number) => mallBookValue(a.service.sync(mallId));

function setFunds(a: App, ids: number[], value = 10_000_000) {
  const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
  for (const id of ids) {
    const s = structuredClone(a.service.sync(id));
    s.funds = value;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    cache.set(id, s);
  }
}

/** alice 開 A、bob 開 B；bob 也是 A 的成員。兩座商場現金都是 1000 萬 */
async function world(a: App) {
  const alice = await reg(a, "alice");
  const bob = await reg(a, "bob");
  const A = a.service.createMall(alice.id, "甲商場");
  const B = a.service.createMall(bob.id, "乙商場").mallId;
  calm(a.service, A.mallId, B);
  setFunds(a, [A.mallId, B]);
  a.service.joinMall(A.inviteCode, bob.id, "ops", 8);
  return { alice, bob, A: A.mallId, B, code: A.inviteCode };
}
const gift = (a: App, from: { cookie: string }, mall: number, to: number, shares: number) => post(a, from.cookie, `/api/malls/${mall}/shares/transfer`, { userId: to, shares });

describe("founder starts with every share", () => {
  it("gives the creator all of the shares, and nobody else any", async () => {
    const a = make();
    const alice = await reg(a, "alice");
    const { mallId } = a.service.createMall(alice.id, "甲商場");
    expect(a.repo.holdingsOfMall(mallId)).toEqual([{ userId: alice.id, displayName: "alice", shares: INITIAL_SHARES, isMember: true }]);
    const view = (await get(a, alice.cookie, `/api/malls/${mallId}/holdings`)).json();
    expect(view.total).toBe(10_000);
    expect(view.holders[0]).toMatchObject({ shares: 10_000, pct: 100, isMember: true, isController: true });
    expect(view.treasury).toBe(0);
  });
});

describe("transferring shares", () => {
  it("moves whole shares to a current member and keeps the total conserved", async () => {
    const a = make();
    const w = await world(a);
    const r = await gift(a, w.alice, w.A, w.bob.id, 2500);
    expect(r.statusCode).toBe(200);
    expect(r.json().holders.map((h: { userId: number; shares: number; pct: number }) => [h.userId, h.shares, h.pct])).toEqual([
      [w.alice.id, 7500, 75],
      [w.bob.id, 2500, 25],
    ]);
    expect(conserved(a, w.A)).toBe(true);
    expect(a.repo.activity(w.A, 5).some((x) => x.text.includes("2,500 股"))).toBe(true);
    expect((await gift(a, w.bob, w.A, w.alice.id, 2500)).statusCode).toBe(200);
    expect(a.repo.holdingsOfMall(w.A)).toHaveLength(1);
  });

  it("refuses fractions, zero, more than you hold, yourself, strangers, and non-holders", async () => {
    const a = make();
    const w = await world(a);
    for (const shares of [0, -5, 1.5, 10_001]) expect((await gift(a, w.alice, w.A, w.bob.id, shares)).statusCode).toBe(400);
    expect((await gift(a, w.alice, w.A, w.alice.id, 10)).statusCode).toBe(400);
    expect((await gift(a, w.bob, w.A, w.alice.id, 10)).statusCode).toBe(403);
    const carol = await reg(a, "carol");
    expect((await gift(a, w.alice, w.A, carol.id, 10)).statusCode).toBe(404);
    expect(a.repo.sharesOf(w.A, w.alice.id)).toBe(INITIAL_SHARES);
  });
});

describe("the controller (over 50%)", () => {
  it("runs the mall once someone holds a majority; the founder title stays put", async () => {
    const a = make();
    const w = await world(a);
    // 少於過半：還是創辦人管事
    await gift(a, w.alice, w.A, w.bob.id, 5000); // 剛好 50%，不算過半
    expect(a.service.authorityOf(w.A)).toBe(w.alice.id);
    await gift(a, w.alice, w.A, w.bob.id, 1); // 5001：過半
    expect(a.service.authorityOf(w.A)).toBe(w.bob.id);
    const members = a.service.members(w.A);
    expect(members.find((m) => m.userId === w.bob.id)).toMatchObject({ isController: true, isOwner: false });
    expect(members.find((m) => m.userId === w.alice.id)).toMatchObject({ isController: false, isOwner: true }); // 創辦人頭銜沒變
    expect(a.repo.activity(w.A, 10).some((x) => x.text.includes("持股過半，成為實際控制人"))).toBe(true);
    // 創辦人不能再請人、改名；實際控制人可以
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/rename`, { name: "新名字" })).statusCode).toBe(403);
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/members/${w.bob.id}/kick`)).statusCode).toBe(403);
    expect((await post(a, w.bob.cookie, `/api/malls/${w.A}/rename`, { name: "新名字" })).statusCode).toBe(200);
    // 邀請碼只有管事的人看得到
    expect((await get(a, w.bob.cookie, `/api/malls/${w.A}`)).json().inviteCode).toBe(w.code);
    expect((await get(a, w.alice.cookie, `/api/malls/${w.A}`)).json().inviteCode).toBeUndefined();
    // 把股份轉回去，創辦人又是管事的人
    await gift(a, w.bob, w.A, w.alice.id, 2);
    expect(a.service.authorityOf(w.A)).toBe(w.alice.id);
  });
});

describe("leaving means settling your shares", () => {
  it("won't let you walk away with shares; selling back to the mall (撤資) lets you go", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 1000);
    const left = await post(a, w.bob.cookie, `/api/malls/${w.A}/leave`);
    expect(left.statusCode).toBe(409);
    expect(left.json().error).toContain("股份");
    const before = funds(a, w.A);
    const value = worth(a, w.A);
    const r = await post(a, w.bob.cookie, `/api/malls/${w.A}/shares/buyback`, { shares: 1000 });
    expect(r.statusCode).toBe(200);
    const price = buybackPrice(1000, value, INITIAL_SHARES); // 估值 9 折
    expect(price).toBe(Math.floor(value * 0.1 * 0.9));
    expect(a.repo.walletOf(w.bob.id)).toBe(price);
    expect(funds(a, w.A)).toBe(before - price);
    expect(a.repo.treasuryOf(w.A)).toBe(1000);
    expect(conserved(a, w.A)).toBe(true);
    expect((await post(a, w.bob.cookie, `/api/malls/${w.A}/leave`)).statusCode).toBe(200);
  });

  it("caps one buyback at half of the mall's cash and never empties the shareholder list", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 6000);
    const big = await post(a, w.bob.cookie, `/api/malls/${w.A}/shares/buyback`, { shares: 6000 }); // 估值 9 折 > 現金一半 500 萬
    expect(big.statusCode).toBe(409);
    expect(a.repo.sharesOf(w.A, w.bob.id)).toBe(6000);
    expect((await post(a, w.bob.cookie, `/api/malls/${w.A}/shares/buyback`, { shares: 3000 })).statusCode).toBe(200);
    // 最後一位股東不能把股份全部賣回去
    await gift(a, w.bob, w.A, w.alice.id, 3000);
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/shares/buyback`, { shares: 7000 })).statusCode).toBe(409);
  });

  it("sells to another shareholder only when they agree and can pay", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 2500);
    const value = worth(a, w.A);
    const o = await post(a, w.bob.cookie, `/api/malls/${w.A}/shares/offer`, { userId: w.alice.id, shares: 1000 });
    expect(o.statusCode).toBe(200);
    const offer = o.json().offers[0];
    expect(offer.price).toBe(Math.round(value * 0.1)); // 估值，不打折
    // 只有被出價的人看得到、能同意；錢包不夠付會被擋
    expect((await post(a, w.bob.cookie, `/api/shares/offers/${offer.id}/respond`, { accept: true })).statusCode).toBe(403);
    expect((await post(a, w.alice.cookie, `/api/shares/offers/${offer.id}/respond`, { accept: true })).statusCode).toBe(402);
    a.repo.addCash(w.alice.id, 5_000_000);
    expect((await post(a, w.alice.cookie, `/api/shares/offers/${offer.id}/respond`, { accept: true })).statusCode).toBe(200);
    expect(a.repo.sharesOf(w.A, w.bob.id)).toBe(1500);
    expect(a.repo.walletOf(w.bob.id)).toBe(offer.price);
    expect(a.repo.walletOf(w.alice.id)).toBe(5_000_000 - offer.price);
    expect(conserved(a, w.A)).toBe(true);
    // 拒絕與取消
    const o2 = (await post(a, w.bob.cookie, `/api/malls/${w.A}/shares/offer`, { userId: w.alice.id, shares: 100 })).json().offers[0];
    expect((await post(a, w.alice.cookie, `/api/shares/offers/${o2.id}/respond`, { accept: false })).statusCode).toBe(200);
    expect(a.repo.offerById(o2.id)).toBeUndefined();
  });
});

describe("dividends", () => {
  it("splits by holding, withholds tax, and keeps the rest in the mall", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 2500);
    // 沒有權限的人、太小、太大都擋下
    expect((await post(a, w.bob.cookie, `/api/malls/${w.A}/dividend`, { amount: 1_000_000 })).statusCode).toBe(403);
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/dividend`, { amount: 5_000 })).statusCode).toBe(400);
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/dividend`, { amount: 3_500_000 })).statusCode).toBe(409); // > 現金 30%
    const r = await post(a, w.alice.cookie, `/api/malls/${w.A}/dividend`, { amount: 1_000_000 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ paid: 1_000_000, tax: 200_000 });
    expect(a.repo.walletOf(w.alice.id)).toBe(600_000); // 75% = 75 萬，扣 20%
    expect(a.repo.walletOf(w.bob.id)).toBe(200_000); // 25% = 25 萬，扣 20%
    expect(funds(a, w.A)).toBe(9_000_000);
    // 兩次之間要冷卻
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/dividend`, { amount: 100_000 })).statusCode).toBe(409);
    a.repo.setLastDividendAt(w.A, clock.t - DIVIDEND_COOLDOWN_MS - 1);
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/dividend`, { amount: 100_000 })).statusCode).toBe(200);
  });

  it("treasury shares get nothing and rounding never pays out more than the amount", () => {
    const r = splitDividend(1_000_001, 10_000, [
      { userId: 1, shares: 3333 },
      { userId: 2, shares: 3333 },
      { userId: 3, shares: 3334 },
    ]);
    expect(r.paid).toBeLessThanOrEqual(1_000_001);
    expect(r.lines.every((l) => l.net + l.tax === l.gross)).toBe(true);
    const withTreasury = splitDividend(1_000_000, 10_000, [{ userId: 1, shares: 8000 }]); // 其餘 2000 股是庫藏股
    expect(withTreasury.paid).toBe(800_000);
  });
});

describe("putting capital in", () => {
  it("buys treasury shares first, then issues new ones at book value, once the controller agrees", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 1000);
    const buyPrice = buybackPrice(1000, worth(a, w.A), INITIAL_SHARES);
    await post(a, w.bob.cookie, `/api/malls/${w.A}/shares/buyback`, { shares: 1000 }); // 庫藏股 1000，商場付出回購款
    expect(a.repo.treasuryOf(w.A)).toBe(1000);
    a.repo.addCash(w.bob.id, 3_000_000);
    const cash = funds(a, w.A);
    const value = worth(a, w.A);
    const est = sharesForCapital(3_000_000, value, 9_000); // 流通在外 9000 股（庫藏股不算）
    const req = await post(a, w.bob.cookie, `/api/malls/${w.A}/capital`, { amount: 3_000_000 });
    expect(req.json()).toMatchObject({ applied: false });
    expect(a.repo.sharesOf(w.A, w.bob.id)).toBe(0); // 還沒核准
    const pending = (await get(a, w.alice.cookie, `/api/malls/${w.A}/shares/offers`)).json().requests[0];
    expect(pending.amount).toBe(3_000_000);
    expect((await post(a, w.bob.cookie, `/api/capital/${pending.id}/respond`, { accept: true })).statusCode).toBe(403); // 自己不能核准
    expect((await post(a, w.alice.cookie, `/api/capital/${pending.id}/respond`, { accept: true })).statusCode).toBe(200);
    expect(a.repo.sharesOf(w.A, w.bob.id)).toBe(est.shares);
    expect(a.repo.treasuryOf(w.A)).toBe(0); // 庫藏股先賣光
    expect(a.repo.totalSharesOf(w.A)).toBe(10_000 + (est.shares - 1000)); // 其餘是新發
    expect(a.repo.walletOf(w.bob.id)).toBe(buyPrice + 3_000_000 - est.cost); // 撤資拿到的錢 + 補進去的 300 萬 − 實際花費
    expect(funds(a, w.A)).toBe(cash + est.cost);
    expect(conserved(a, w.A)).toBe(true);
    // 每股估值沒變（不稀釋價值，只稀釋比例）
    expect((worth(a, w.A))/ (9_000 + est.shares)).toBeCloseTo(value / 9_000, 0);
  });

  it("goes straight through when the controller invests, and refuses what the wallet can't cover", async () => {
    const a = make();
    const w = await world(a);
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/capital`, { amount: 1_000_000 })).statusCode).toBe(402);
    a.repo.addCash(w.alice.id, 1_000_000);
    const est = sharesForCapital(1_000_000, worth(a, w.A), INITIAL_SHARES); // 每股＝估值 ÷ 1 萬股，不是現金
    const r = await post(a, w.alice.cookie, `/api/malls/${w.A}/capital`, { amount: 1_000_000 });
    expect(r.json()).toMatchObject({ applied: true, shares: est.shares });
    expect(est.shares).toBeLessThan(1000); // 估值比現金高，同樣一百萬換得到的股數比只看現金時少
    expect(a.repo.totalSharesOf(w.A)).toBe(10_000 + est.shares);
    expect(a.repo.walletOf(w.alice.id)).toBe(1_000_000 - est.cost);
  });
});

describe("a starting grant is one per player", () => {
  it("lets a newcomer put their grant in at the mall's valuation, once", async () => {
    const a = make();
    const w = await world(a);
    const carol = await reg(a, "carol");
    const est = sharesForCapital(INITIAL_FUNDS, worth(a, w.A), INITIAL_SHARES);
    const joined = await post(a, carol.cookie, "/api/malls/join", { code: w.code });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().grantShares).toBe(est.shares); // 200 萬 ÷ 每股估值
    expect(a.repo.totalSharesOf(w.A)).toBe(10_000 + est.shares);
    expect(funds(a, w.A)).toBe(10_000_000 + est.cost);
    expect(a.service.contributeGrant(w.A, carol.id)).toEqual({ contributed: false, shares: 0 }); // 只有一次
    expect(a.repo.foundedCount(carol.id)).toBe(1);
  });

  it("makes every mall after the first cost real money", async () => {
    const a = make();
    const dan = await reg(a, "dan");
    const first = await post(a, dan.cookie, "/api/malls", { name: "第一座" });
    expect(first.statusCode).toBe(200); // 免費
    const second = await post(a, dan.cookie, "/api/malls", { name: "第二座" });
    expect(second.statusCode).toBe(402);
    expect(second.json().error).toContain("自己出資");
    a.repo.addCash(dan.id, FOUNDING_COST);
    expect((await post(a, dan.cookie, "/api/malls", { name: "第二座" })).statusCode).toBe(200);
    expect(a.repo.walletOf(dan.id)).toBe(0);
    expect(FOUNDING_COST).toBe(INITIAL_FUNDS);
    expect((await get(a, dan.cookie, "/api/me/wealth")).json().foundCost).toBe(FOUNDING_COST);
  });

  it("keeps a member with 0 shares from operating the mall until they hold at least 1", async () => {
    const a = make();
    const w = await world(a); // bob 是 A 的成員、自己開過 B（沒領起始資金），在 A 沒有股份
    expect(a.repo.sharesOf(w.A, w.bob.id)).toBe(0);
    expect((await get(a, w.bob.cookie, `/api/malls/${w.A}`)).json().myShares).toBe(0); // 畫面據此顯示提示、藏起操作
    const cmd = { command: { type: "nope" } };
    const blocked = await post(a, w.bob.cookie, `/api/malls/${w.A}/commands`, cmd);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toContain("1 股");
    expect((await post(a, w.bob.cookie, `/api/malls/${w.A}/clock`, { paused: true })).statusCode).toBe(403);
    expect((await post(a, w.alice.cookie, `/api/malls/${w.A}/commands`, cmd)).statusCode).not.toBe(403); // 有股份的人不受影響
    a.repo.setShares(w.A, w.bob.id, 1);
    expect((await post(a, w.bob.cookie, `/api/malls/${w.A}/commands`, cmd)).statusCode).not.toBe(403);
  });

  it("tops up a running mall to one grant per member and splits it evenly (admin, once)", async () => {
    const a = make();
    const w = await world(a); // alice 創辦 A，bob 是 A 的成員但自己開過 B（已用過起始資金）
    const carol = await reg(a, "carol");
    const dave = await reg(a, "dave");
    a.service.joinMall(w.code, carol.id, "ops", 8);
    a.service.joinMall(w.code, dave.id, "ops", 8);
    const before = funds(a, w.A);
    const r = a.service.adminSettleGrants(w.A);
    expect(r.grantees.sort()).toEqual(["carol", "dave"]);
    expect(r.topUp).toBe(2 * INITIAL_FUNDS); // 兩位沒用過起始資金的成員各補一份
    expect(funds(a, w.A)).toBe(before + r.topUp);
    // 創辦人與兩位成員三人均分（bob 已經用過自己的起始資金，這座商場沒有他的份）
    expect(a.repo.sharesOf(w.A, carol.id)).toBe(3333);
    expect(a.repo.sharesOf(w.A, dave.id)).toBe(3333);
    expect(a.repo.sharesOf(w.A, w.alice.id)).toBe(3334);
    expect(conserved(a, w.A)).toBe(true);
    expect(a.service.adminSettleGrants(w.A).topUp).toBe(0); // 做過就不再做
  });
});

describe("a big stake counts as running the mall", () => {
  it("keeps A and B related after the holder is removed, until the stake drops below 20% and a season passes", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 2500);
    a.service.kickMember(w.A, w.alice.id, w.bob.id); // 被請出的人仍握有股份
    expect(a.repo.sharesOf(w.A, w.bob.id)).toBe(2500);
    clock.t += RELATED_TAIL_MS + DAY; // 離開紀錄早就過期
    expect(a.service.related(w.A, w.B)).toBe(true); // 但持股 ≥ 20%，仍視同經手
    expect(a.service.holdings(w.A).holders.find((h) => h.userId === w.bob.id)).toMatchObject({ isMember: false, shares: 2500 });
    // 非成員股東把股份轉回現任成員；掉到 20% 以下的那一刻留下紀錄，一個賽季內仍算關係企業
    expect((await gift(a, w.bob, w.A, w.alice.id, 1000)).statusCode).toBe(200); // 2500 → 1500
    expect(a.service.related(w.A, w.B)).toBe(true);
    clock.t += RELATED_TAIL_MS + DAY;
    expect(a.service.related(w.A, w.B)).toBe(false);
  });

  it("does not link two malls just because someone holds a few shares", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, INITIAL_SHARES * RELATED_STAKE_PCT - 1);
    a.service.kickMember(w.A, w.alice.id, w.bob.id);
    clock.t += RELATED_TAIL_MS + DAY;
    expect(a.service.related(w.A, w.B)).toBe(false);
  });
});

describe("cash-out / buy-in never profits", () => {
  it("caps a buyback at the stake's share of net assets, however high the valuation premium", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 1000);
    const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
    const st = cache.get(w.A)!;
    const nav = netAssets(st);
    st.valuationAnchor = Math.round(nav * 2); // 昨天收盤估值是淨資產的 2 倍：今天估值 ≈ 淨資產 × 1.8
    expect(a.service.holdings(w.A).equityValue!).toBeGreaterThan(nav * 1.5);
    const r = await post(a, w.bob.cookie, `/api/malls/${w.A}/shares/buyback`, { shares: 1000 });
    expect(r.statusCode).toBe(200);
    const got = a.repo.walletOf(w.bob.id);
    expect(got).toBeLessThanOrEqual(Math.round(nav * 0.1) + 1); // 1000/10000 股 × 淨資產，領不到溢價
    expect(got).toBeGreaterThan(0);
  });

  it("buys in at no less than net assets per share, even when yesterday's anchor lags below it", async () => {
    const a = make();
    const w = await world(a);
    const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
    const st = cache.get(w.A)!;
    const nav = netAssets(st);
    st.valuationAnchor = Math.round(nav / 2); // 估值被夾在 0.55 × 淨資產：舊算法能用 5 折買進
    a.repo.addCash(w.alice.id, 1_000_000);
    const before = a.repo.sharesOf(w.A, w.alice.id);
    const total = a.repo.totalSharesOf(w.A);
    await post(a, w.alice.cookie, `/api/malls/${w.A}/capital`, { amount: 1_000_000 }); // 管事的人自己注資，直接成交
    const bought = a.repo.sharesOf(w.A, w.alice.id) - before;
    expect(bought).toBeGreaterThan(0);
    expect(1_000_000 / bought).toBeGreaterThanOrEqual(nav / total - 1); // 每股價 ≥ 淨資產每股
    expect(conserved(a, w.A)).toBe(true);
  });
});

describe("valuation band", () => {
  it("keeps the share price within ±10% of yesterday's closing valuation, whatever today's cash does", async () => {
    const a = make();
    const w = await world(a);
    const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
    const live = worth(a, w.A);
    cache.get(w.A)!.valuationAnchor = Math.round(live / 2); // 昨天收盤只有現在的一半：今天最多只能漲 10%
    const view = a.service.holdings(w.A);
    expect(view.equityValue).toBe(Math.round((live / 2) * 1.1));
    expect(view.sharePrice).toBeCloseTo(((live / 2) * 1.1) / 10_000, 1);
    expect(view.mallCash).toBe(10_000_000); // 現金照實顯示，只是不再等於股價基準
  });
});

describe("personal holdings", () => {
  it("values a stake as its share of the mall's valuation, plus the wallet", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 2500);
    a.repo.addCash(w.bob.id, 123_456);
    const cash = funds(a, w.A);
    const value = worth(a, w.A);
    const bobWealth = (await get(a, w.bob.cookie, "/api/me/wealth")).json();
    expect(bobWealth.stakes).toHaveLength(2); // B 的 100% 加上 A 的 25%
    expect(bobWealth.stakes.find((s: { mallId: number }) => s.mallId === w.A)).toMatchObject({ shares: 2500, pct: 25, mallCash: cash, value: Math.round(value * 0.25), isMember: true });
    expect(bobWealth.cash).toBe(123_456);
    expect(bobWealth.totalValue).toBe(bobWealth.stakes.reduce((x: number, s: { value: number }) => x + s.value, 0) + 123_456);
  });
});

describe("shares never disappear", () => {
  it("hands a deleted account's shares to whoever runs the mall", async () => {
    const a = make();
    const w = await world(a);
    await gift(a, w.alice, w.A, w.bob.id, 3000);
    a.service.deleteAccount(w.bob.id);
    expect(a.repo.sharesOf(w.A, w.alice.id)).toBe(INITIAL_SHARES);
    expect(conserved(a, w.A)).toBe(true);
  });
});

describe("migrations v11 and v12", () => {
  it("gives every existing mall to its founder (or its earliest member), and records who already founded", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const sql of MIGRATIONS.slice(0, 10)) db.exec(sql);
    const u = db.prepare("INSERT INTO users (username, username_lc, pass_hash, display_name, created_at) VALUES (?, ?, 'x', ?, 0)");
    for (const n of ["a", "b", "c", "d"]) u.run(n, n, n);
    const m = db.prepare("INSERT INTO malls (name, invite_code, seed, created_at) VALUES (?, ?, 1, 0)");
    for (const n of ["M1", "M2"]) m.run(n, n);
    const ms = db.prepare("INSERT INTO memberships (mall_id, user_id, role, is_owner, joined_at) VALUES (?, ?, 'ops', ?, ?)");
    ms.run(1, 1, 0, 10); // M1：2 號是創辦人
    ms.run(1, 2, 1, 20);
    ms.run(2, 4, 0, 5); // M2：沒有創辦人，最早加入的是 4 號
    ms.run(2, 3, 0, 9);
    db.exec(MIGRATIONS[10]!);
    expect(db.prepare("SELECT mall_id, user_id, shares FROM holdings ORDER BY mall_id").all()).toEqual([
      { mall_id: 1, user_id: 2, shares: 10_000 },
      { mall_id: 2, user_id: 4, shares: 10_000 },
    ]);
    db.exec(MIGRATIONS[11]!);
    expect(db.prepare("SELECT total_shares, treasury_shares FROM malls ORDER BY id").all()).toEqual([
      { total_shares: 10_000, treasury_shares: 0 },
      { total_shares: 10_000, treasury_shares: 0 },
    ]);
    // 已經開過商場的創辦人視為用過起始資金；其他人還沒用
    expect(db.prepare("SELECT id, founded_count FROM users ORDER BY id").all()).toEqual([
      { id: 1, founded_count: 0 },
      { id: 2, founded_count: 1 },
      { id: 3, founded_count: 0 },
      { id: 4, founded_count: 0 },
    ]);
    db.close();
  });
});

describe("equity cash-out gate (throwaway accounts)", () => {
  const std = (o: Partial<EquityStanding> = {}): EquityStanding => ({ accountCreatedAt: 0, activeDays: EQUITY_MIN_ACTIVE_DAYS, mallRevenue: EQUITY_MIN_MALL_REVENUE, vouched: false, ...o });
  const NOW = EQUITY_MIN_ACCOUNT_AGE_MS + 1;

  it("needs account age, distinct active game days and real mall revenue", () => {
    expect(equityBlocker(std(), NOW)).toBeNull();
    expect(equityBlocker(std({ accountCreatedAt: NOW - 1000 }), NOW)).toContain("帳號建立還不夠久");
    expect(equityBlocker(std({ activeDays: EQUITY_MIN_ACTIVE_DAYS - 1 }), NOW)).toContain("經營紀錄");
    expect(equityBlocker(std({ mallRevenue: EQUITY_MIN_MALL_REVENUE - 1 }), NOW)).toContain("營業額");
    expect(equityBlocker(std({ accountCreatedAt: NOW - 1000, activeDays: 0, mallRevenue: 0, vouched: true }), NOW)).toBeNull();
  });

  it("counts at most one active day per game day, no matter how many commands", async () => {
    const a = make();
    const alice = await reg(a, "alice");
    const { mallId } = a.service.createMall(alice.id, "甲商場");
    for (let i = 0; i < 50; i++) a.repo.recordActiveDay(mallId, alice.id, 20_000);
    expect(a.repo.equityStanding(alice.id, { days: 8, revenue: 0 }).activeDays).toBe(1);
    a.repo.recordActiveDay(mallId, alice.id, 20_001);
    expect(a.repo.equityStanding(alice.id, { days: 8, revenue: 0 }).activeDays).toBe(2);
  });

  it("blocks transfer, offer, accept and buyback for fresh accounts", async () => {
    const a = make();
    const w = await world(a);
    const r = await raw(a, w.alice.cookie, `/api/malls/${w.A}/shares/transfer`, { userId: w.bob.id, shares: 100 });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toContain("帳號建立");
    expect((await raw(a, w.alice.cookie, `/api/malls/${w.A}/shares/offer`, { userId: w.bob.id, shares: 100 })).statusCode).toBe(403);
    expect((await raw(a, w.alice.cookie, `/api/malls/${w.A}/shares/buyback`, { shares: 100 })).statusCode).toBe(403);
    expect(a.repo.sharesOf(w.A, w.alice.id)).toBe(INITIAL_SHARES);
    expect(conserved(a, w.A)).toBe(true);
  });

  it("blocks when only the receiver is a fresh/idle account", async () => {
    const a = make();
    const w = await world(a);
    a.repo.vouchAllMembers();
    const carol = await reg(a, "carol");
    a.service.joinMall(w.code, carol.id, "ops", 8);
    const r = await raw(a, w.alice.cookie, `/api/malls/${w.A}/shares/transfer`, { userId: carol.id, shares: 100 });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toContain("對方");
  });
});

describe("holdings view exposes the cash-out blocker", () => {
  it("shows the reason to a fresh account and nothing once vouched", async () => {
    const a = make();
    const alice = await reg(a, "alice");
    const { mallId } = a.service.createMall(alice.id, "甲商場");
    const before = (await get(a, alice.cookie, `/api/malls/${mallId}/holdings`)).json();
    expect(before.cashOutBlocker).toContain("帳號建立");
    a.repo.vouchAllMembers();
    const after = (await get(a, alice.cookie, `/api/malls/${mallId}/holdings`)).json();
    expect(after.cashOutBlocker).toBeNull();
  });
});
