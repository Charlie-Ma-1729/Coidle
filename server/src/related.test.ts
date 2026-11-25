import { afterEach, describe, expect, it } from "vitest";
import { RELATED_BLOCK_TEXT, RELATED_TAIL_MS, SEASON_MS, STARTER_QUESTS, WORLD_EPOCH_MS, type MallState } from "@coidle/shared";
import { buildApp } from "./app";
import { calm } from "./testutil";

// 關係企業：同一位玩家經手的商場（現任成員，或一個賽季內離開的成員）不能互相聯名、貿易、搶客，
// 也不能「繞一圈」轉移；同一位玩家一季只領一份獎金。擋的是左手轉右手的作帳、掏空與刷榜。

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
  return { cookie, id: me.user.id as number, name: username };
}
const post = (a: App, cookie: string, url: string, payload: unknown = {}) => a.app.inject({ method: "POST", url, headers: { cookie }, payload: payload as object });

/** 把商場資金調成想要的數字、新手任務標成完成（不然會有任務獎勵干擾） */
function fund(a: App, ids: number[], funds = 20_000_000) {
  const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
  for (const id of ids) {
    const s = structuredClone(a.service.sync(id));
    s.funds = funds;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    cache.set(id, s);
  }
}

/** alice 有兩座商場（A、A2），bob 有一座（B），carol 有一座（C） */
async function world(a: App) {
  const alice = await reg(a, "alice");
  const bob = await reg(a, "bob");
  const carol = await reg(a, "carol");
  const A = a.service.createMall(alice.id, "甲一號").mallId;
  const A2 = a.service.createMall(alice.id, "甲二號").mallId;
  const B = a.service.createMall(bob.id, "乙商場");
  const C = a.service.createMall(carol.id, "丙商場").mallId;
  calm(a.service, A, A2, B.mallId, C);
  fund(a, [A, A2, B.mallId, C]);
  return { alice, bob, carol, A, A2, B: B.mallId, Bcode: B.inviteCode, C };
}

describe("related malls cannot deal with each other", () => {
  it("blocks funds, goods, alliance invitations and competing between two malls of the same player", async () => {
    const a = make();
    const w = await world(a);
    const base = `/api/malls/${w.A}/world`;
    const funds = await post(a, w.alice.cookie, `${base}/trade/funds`, { target: `m:${w.A2}`, amount: 100_000 });
    expect(funds.statusCode).toBe(400);
    expect(funds.json().error).toContain("關係企業");
    const goods = await post(a, w.alice.cookie, `${base}/trade/goods`, { target: `m:${w.A2}`, shopId: "x", qty: 50 });
    expect(goods.statusCode).toBe(400);
    expect(goods.json().error).toBe(RELATED_BLOCK_TEXT);
    const ally = await post(a, w.alice.cookie, `${base}/alliance`, { target: `m:${w.A2}` });
    expect(ally.statusCode).toBe(400);
    expect(ally.json().error).toBe(RELATED_BLOCK_TEXT);
    const fight = await post(a, w.alice.cookie, `${base}/compete`, { target: `m:${w.A2}`, persona: "tourist" });
    expect(fight.statusCode).toBe(400);
    expect(fight.json().error).toBe(RELATED_BLOCK_TEXT);
    // 沒有任何資金離開
    expect(a.repo.recentTrades(10)).toHaveLength(0);
    // 對沒有關係的商場照常可以
    const ok = await post(a, w.alice.cookie, `${base}/trade/funds`, { target: `m:${w.C}`, amount: 100_000 });
    expect(ok.statusCode).toBe(200);
  });

  it("tells a player which malls are related, and nobody else's", async () => {
    const a = make();
    const w = await world(a);
    const mine = await a.app.inject({ method: "GET", url: `/api/malls/${w.A}/world/alliances`, headers: { cookie: w.alice.cookie } });
    expect(mine.json().related).toEqual([`m:${w.A2}`]);
    const theirs = await a.app.inject({ method: "GET", url: `/api/malls/${w.C}/world/alliances`, headers: { cookie: w.carol.cookie } });
    expect(theirs.json().related).toEqual([]);
  });

  it("ends existing alliances the moment two allied malls gain a common operator", async () => {
    const a = make();
    const w = await world(a);
    const base = `/api/malls/${w.A}/world`;
    expect((await post(a, w.alice.cookie, `${base}/alliance`, { target: `m:${w.B}` })).statusCode).toBe(200);
    const pending = a.service.alliances.list(w.B).find((x) => x.status === "pending")!;
    expect((await post(a, w.bob.cookie, `/api/malls/${w.B}/world/alliance/${pending.id}/respond`, { accept: true })).statusCode).toBe(200);
    expect(a.service.alliances.list(w.A).filter((x) => x.status === "active")).toHaveLength(1);

    // alice 用邀請碼加入 bob 的商場：兩座商場從此有共同的經營者
    a.service.joinMall(w.Bcode, w.alice.id, "ops", 8);
    expect(a.service.related(w.A, w.B)).toBe(true);
    expect(a.service.alliances.list(w.A)).toHaveLength(0);
    expect(a.service.alliances.list(w.B)).toHaveLength(0);
    // 雙方都收到通知
    expect(a.service.sync(w.A).world.alliances.filter((x) => x.endTick > a.service.sync(w.A).tick)).toHaveLength(0);
    const again = await post(a, w.alice.cookie, `${base}/alliance`, { target: `m:${w.B}` });
    expect(again.statusCode).toBe(400);
  });

  it("keeps counting a member for a season after they leave, then lets go", async () => {
    const a = make();
    const w = await world(a);
    a.service.joinMall(w.Bcode, w.alice.id, "ops", 8);
    expect(a.service.related(w.A, w.B)).toBe(true);
    // 退出也一樣：加入、轉完、退出的做法行不通
    a.service.leaveMall(w.B, w.alice.id);
    a.service.setClock(w.A, { id: 0, displayName: "測試" }, { idlePauseDays: null }); // 跳過好幾天也不要因為久未上線而落後
    expect(a.service.related(w.A, w.B)).toBe(true);
    const funds = await post(a, w.alice.cookie, `/api/malls/${w.A}/world/trade/funds`, { target: `m:${w.B}`, amount: 100_000 });
    expect(funds.statusCode).toBe(400);
    clock.t += RELATED_TAIL_MS + DAY;
    expect(a.service.related(w.A, w.B)).toBe(false);
    for (let i = 0; i < 5; i++) a.service.sync(w.A); // 一次補算有上限，分幾次把跳過的日子補完
    const later = await post(a, w.alice.cookie, `/api/malls/${w.A}/world/trade/funds`, { target: `m:${w.B}`, amount: 100_000 });
    expect(later.json().error ?? "ok").toBe("ok");
    expect(later.statusCode).toBe(200);
  });

  it("a kicked member still counts as related for a season", async () => {
    const a = make();
    const w = await world(a);
    a.service.joinMall(w.Bcode, w.alice.id, "ops", 8);
    a.service.kickMember(w.B, w.bob.id, w.alice.id);
    expect(a.service.related(w.A, w.B)).toBe(true);
  });

  it("stops money going around a circle through a third mall", async () => {
    const a = make();
    const w = await world(a);
    const out = await post(a, w.alice.cookie, `/api/malls/${w.A}/world/trade/funds`, { target: `m:${w.C}`, amount: 100_000 });
    expect(out.statusCode).toBe(200);
    // carol 收到 alice 這一群的錢：不能再轉給 alice 的另一座商場
    const circle = await post(a, w.carol.cookie, `/api/malls/${w.C}/world/trade/funds`, { target: `m:${w.A2}`, amount: 50_000 });
    expect(circle.statusCode).toBe(400);
    expect(circle.json().error).toContain("繞一圈");
    // 直接還給原來那座沒問題
    const back = await post(a, w.carol.cookie, `/api/malls/${w.C}/world/trade/funds`, { target: `m:${w.A}`, amount: 50_000 });
    expect(back.statusCode).toBe(200);
    // 一週之後就不再算繞圈
    clock.t += 8 * DAY;
    a.service.setClock(w.C, { id: 0, displayName: "測試" }, { idlePauseDays: null });
    for (let i = 0; i < 3; i++) for (const id of [w.A, w.A2, w.C]) a.service.sync(id);
    fund(a, [w.C]);
    const later = await post(a, w.carol.cookie, `/api/malls/${w.C}/world/trade/funds`, { target: `m:${w.A2}`, amount: 50_000 });
    expect(later.statusCode).toBe(200);
  });

  it("does not affect NPC malls", async () => {
    const a = make();
    const w = await world(a);
    const npc = a.service.world.entries().find((e) => e.kind === "npc")!;
    expect(() => a.service.trade.sendFunds(w.A, npc.key, 100_000)).not.toThrow();
  });
});

describe("one season reward per player", () => {
  it("pays only the better-ranked of one player's malls", async () => {
    const a = make();
    const w = await world(a);
    const row = (mallId: number, score: number) =>
      a.repo.upsertDirectory({ mallId, name: `商場${mallId}`, level: 3, stars: 4, score, localRep: 70, touristHeat: 70, revenue30: 5_000_000, shops: 12, topCategory: "拉麵", stockouts: 0, createdAt: WORLD_EPOCH_MS - 10 * DAY, updatedAt: clock.t });
    row(w.A, 95);
    row(w.A2, 94); // 同一位玩家的第二座：榜上第二名，但不再領獎
    row(w.B, 60);
    row(w.C, 50);
    clock.t = WORLD_EPOCH_MS + SEASON_MS + DAY;
    a.service.world.settleSeasons();
    expect(a.repo.pendingMailCount(w.A)).toBe(1);
    expect(a.repo.pendingMailCount(w.A2)).toBe(0);
    expect(a.repo.pendingMailCount(w.B)).toBe(1);
    expect(a.repo.pendingMailCount(w.C)).toBe(1);
  });
});
