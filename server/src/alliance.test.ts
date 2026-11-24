import { afterEach, describe, expect, it } from "vitest";
import {
  ALLIANCE_INVITE_MS,
  ALLIANCE_MAX_ACTIVE,
  ALLIANCE_REAL_MS,
  JOINT_PROMO_COOLDOWN_MS,
  STARTER_QUESTS,
  TICKS_PER_DAY,
  WORLD_EPOCH_MS,
  allianceCount,
  jointPromoCost,
  npcAcceptsAlliance,
  rivalMult,
  type MallState,
} from "@coidle/shared";
import { buildApp } from "./app";
import { advanceTo, createInitialState } from "./sim";

const DAY = 86_400_000;
const clock = { t: WORLD_EPOCH_MS + DAY };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + DAY;
  const b = buildApp({ config: { dbPath: ":memory:", adminToken: null }, now: () => clock.t });
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
const get = (a: App, cookie: string, url: string) => a.app.inject({ method: "GET", url, headers: { cookie } });

async function twoMalls(a: App) {
  const u1 = await reg(a, "alice");
  const u2 = await reg(a, "bob");
  const m1 = a.service.createMall(u1.id, "愛麗絲商場").mallId;
  const m2 = a.service.createMall(u2.id, "鮑伯商場").mallId;
  for (const id of [m1, m2]) {
    const s = a.service.sync(id) as MallState;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0; // 新手獎金不干擾金額檢查
  }
  return { u1, u2, m1, m2 };
}

describe("alliances between two player malls", () => {
  it("invite → accept → both malls get the bonus; either side can end it", async () => {
    const a = make();
    const { u1, u2, m1, m2 } = await twoMalls(a);
    const r = await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().alliances[0]).toMatchObject({ status: "pending", direction: "out", partnerName: "鮑伯商場" });

    // 對方收到通知、看到邀請
    const s2 = a.service.sync(m2);
    expect(s2.world.notices[0]!.text).toContain("愛麗絲商場");
    const inbox = (await get(a, u2.cookie, `/api/malls/${m2}/world/alliances`)).json().alliances;
    expect(inbox[0]).toMatchObject({ status: "pending", direction: "in", partnerName: "愛麗絲商場" });
    expect(allianceCount(s2)).toBe(0); // 還沒接受，沒有效果

    const ok = await post(a, u2.cookie, `/api/malls/${m2}/world/alliance/${inbox[0].id}/respond`, { accept: true });
    expect(ok.statusCode).toBe(200);
    const sa = a.service.sync(m1);
    const sb = a.service.sync(m2);
    expect(allianceCount(sa)).toBe(1);
    expect(allianceCount(sb)).toBe(1);
    expect(sa.world.alliances[0]!.partner).toBe("鮑伯商場");
    expect(sa.world.alliances[0]!.endTick - sa.tick).toBe(28 * TICKS_PER_DAY);
    // 導客加成有效，且不超過上限
    expect(rivalMult(sa, "local")).toBeGreaterThan(rivalMult({ ...sa, world: { ...sa.world, alliances: [] } }, "local"));

    // 任何一方都能結束，雙方都收到通知
    const end = await post(a, u1.cookie, `/api/malls/${m1}/world/alliance/${inbox[0].id}/end`);
    expect(end.statusCode).toBe(200);
    expect(end.json().alliances).toEqual([]);
    expect(allianceCount(a.service.sync(m1))).toBe(0);
    const after = a.service.sync(m2);
    expect(allianceCount(after)).toBe(0);
    expect(after.world.notices[0]!.text).toContain("結束了");
  });

  it("declining and ignoring both end the invitation; a pair can try again afterwards", async () => {
    const a = make();
    const { u1, u2, m1, m2 } = await twoMalls(a);
    await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` });
    // 不能重複邀請
    expect((await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` })).statusCode).toBe(400);
    const id = (await get(a, u2.cookie, `/api/malls/${m2}/world/alliances`)).json().alliances[0].id;
    expect((await post(a, u2.cookie, `/api/malls/${m2}/world/alliance/${id}/respond`, { accept: false })).statusCode).toBe(200);
    expect(a.service.sync(m1).world.notices[0]!.text).toContain("婉拒");

    // 再邀請一次，這次不回覆 → 逾時視為婉拒
    await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` });
    clock.t += ALLIANCE_INVITE_MS + 1000;
    a.service.tickAll();
    expect((await get(a, u1.cookie, `/api/malls/${m1}/world/alliances`)).json().alliances).toEqual([]);
    expect(a.service.sync(m1).world.notices[0]!.text).toContain("沒有回覆");
    const late = (await get(a, u2.cookie, `/api/malls/${m2}/world/alliances`)).json().alliances;
    expect(late).toEqual([]);
  });

  it("only members can act; only the invited mall can answer; strangers and bad input are refused", async () => {
    const a = make();
    const { u1, u2, m1, m2 } = await twoMalls(a);
    const stranger = await reg(a, "mallory");
    expect((await post(a, stranger.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` })).statusCode).toBe(403);
    expect((await a.app.inject({ method: "POST", url: `/api/malls/${m1}/world/alliance`, payload: { target: `m:${m2}` } })).statusCode).toBe(401);
    expect((await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m1}` })).statusCode).toBe(400); // 自己
    expect((await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: "m:9999" })).statusCode).toBe(404);
    expect((await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, {})).statusCode).toBe(400);
    await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` });
    const id = (await get(a, u2.cookie, `/api/malls/${m2}/world/alliances`)).json().alliances[0].id;
    // 發起方自己不能替對方接受
    expect((await post(a, u1.cookie, `/api/malls/${m1}/world/alliance/${id}/respond`, { accept: true })).statusCode).toBe(404);
    expect((await post(a, u2.cookie, `/api/malls/${m2}/world/alliance/${id}/respond`, { accept: "yes" })).statusCode).toBe(400);
    // 外人不能結束別人的協議
    expect((await post(a, stranger.cookie, `/api/malls/${m1}/world/alliance/${id}/end`)).statusCode).toBe(403);
  });

  it("caps active alliances per mall", async () => {
    const a = make();
    const { u1, m1 } = await twoMalls(a);
    const others: number[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await reg(a, `friend${i}`);
      others.push(a.service.createMall(u.id, `朋友${i}`).mallId);
    }
    for (const [i, m] of others.entries()) {
      const r = await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m}` });
      if (i < 3) expect(r.statusCode).toBe(200); // 邀請可以先送（上限 3 份）
    }
    // 對方一一接受，第 3 份會因為名額滿而失敗
    let accepted = 0;
    for (const [i, m] of others.entries()) {
      const owner = (a.repo.members(m)[0]!).userId;
      const cookie = `coidle_sid=${(await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `friend${i}`, password: "password123" } })).cookies[0]!.value}`;
      const id = (await get(a, cookie, `/api/malls/${m}/world/alliances`)).json().alliances[0].id;
      const r = await post(a, cookie, `/api/malls/${m}/world/alliance/${id}/respond`, { accept: true });
      if (r.statusCode === 200) accepted++;
      expect(owner).toBeGreaterThan(0);
    }
    expect(accepted).toBe(ALLIANCE_MAX_ACTIVE);
  });

  it("expires after its term and leaves both malls without a bonus", async () => {
    const a = make();
    const { u1, u2, m1, m2 } = await twoMalls(a);
    await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` });
    const id = (await get(a, u2.cookie, `/api/malls/${m2}/world/alliances`)).json().alliances[0].id;
    await post(a, u2.cookie, `/api/malls/${m2}/world/alliance/${id}/respond`, { accept: true });
    expect(allianceCount(a.service.sync(m1))).toBe(1);
    clock.t += ALLIANCE_REAL_MS + 1000;
    a.service.tickAll();
    expect(allianceCount(a.service.sync(m1))).toBe(0);
    expect(allianceCount(a.service.sync(m2))).toBe(0);
    expect(a.service.sync(m1).world.notices[0]!.text).toContain("到期");
  });

  it("dissolving a mall ends its alliances and tells the partner", async () => {
    const a = make();
    const { u1, u2, m1, m2 } = await twoMalls(a);
    await post(a, u1.cookie, `/api/malls/${m1}/world/alliance`, { target: `m:${m2}` });
    const id = (await get(a, u2.cookie, `/api/malls/${m2}/world/alliances`)).json().alliances[0].id;
    await post(a, u2.cookie, `/api/malls/${m2}/world/alliance/${id}/respond`, { accept: true });
    a.service.dissolveMall(m1);
    const s = a.service.sync(m2);
    expect(allianceCount(s)).toBe(0);
    expect(s.world.notices[0]!.text).toContain("已經不在了");
  });
});

describe("joint promotion", () => {
  async function allied(a: App) {
    const t = await twoMalls(a);
    await post(a, t.u1.cookie, `/api/malls/${t.m1}/world/alliance`, { target: `m:${t.m2}` });
    const id = (await get(a, t.u2.cookie, `/api/malls/${t.m2}/world/alliances`)).json().alliances[0].id as number;
    await post(a, t.u2.cookie, `/api/malls/${t.m2}/world/alliance/${id}/respond`, { accept: true });
    return { ...t, id };
  }

  it("costs the organiser, boosts both malls, and has a cooldown", async () => {
    const a = make();
    const t = await allied(a);
    const f1 = a.service.sync(t.m1).funds;
    const f2 = a.service.sync(t.m2).funds;
    const r = await post(a, t.u1.cookie, `/api/malls/${t.m1}/world/alliance/${t.id}/joint`);
    expect(r.statusCode).toBe(200);
    expect(r.json().cost).toBe(jointPromoCost(1));
    const s1 = a.service.sync(t.m1);
    const s2 = a.service.sync(t.m2);
    expect(f1 - s1.funds).toBeGreaterThanOrEqual(jointPromoCost(1) - 1); // 付錢的一方
    expect(s2.funds).toBeGreaterThanOrEqual(f2 - 1); // 夥伴不用付錢
    for (const s of [s1, s2]) expect(s.modifiers.some((m) => m.kind === "traffic" && m.persona === "all" && m.mult > 1)).toBe(true);
    expect(s2.world.notices[0]!.text).toContain("聯名活動");

    // 冷卻：3 個真實日內不能再辦
    const again = await post(a, t.u2.cookie, `/api/malls/${t.m2}/world/alliance/${t.id}/joint`);
    expect(again.statusCode).toBe(400);
    clock.t += JOINT_PROMO_COOLDOWN_MS + 1000;
    expect((await post(a, t.u2.cookie, `/api/malls/${t.m2}/world/alliance/${t.id}/joint`)).statusCode).toBe(200);
  });

  it("is refused when the funds are short or the alliance is not active", async () => {
    const a = make();
    const t = await allied(a);
    const poor = structuredClone(a.service.sync(t.m1));
    poor.funds = 1000;
    // 直接把商場改窮（走伺服器內部的快取與存檔）
    (a.service as unknown as { cache: Map<number, MallState> }).cache.set(t.m1, poor);
    expect((await post(a, t.u1.cookie, `/api/malls/${t.m1}/world/alliance/${t.id}/joint`)).statusCode).toBe(400);
    expect((await post(a, t.u1.cookie, `/api/malls/${t.m1}/world/alliance/9999/joint`)).statusCode).toBe(404);
  });
});

describe("alliances with NPC malls", () => {
  it("an NPC accepts when you are close enough in score, otherwise explains why", async () => {
    expect(npcAcceptsAlliance(50, 42)).toBe(true);
    expect(npcAcceptsAlliance(50, 41.9)).toBe(false);

    const a = make();
    const u = await reg(a, "carol");
    const id = a.service.createMall(u.id, "新商場").mallId;
    a.service.sync(id);
    const entries = a.service.world.entries();
    const mine = entries.find((e) => e.key === `m:${id}`)!;
    const easy = entries.filter((e) => e.kind === "npc").find((e) => npcAcceptsAlliance(e.score, mine.score));
    const hard = entries.filter((e) => e.kind === "npc").find((e) => !npcAcceptsAlliance(e.score, mine.score));
    if (easy) {
      const r = await post(a, u.cookie, `/api/malls/${id}/world/alliance`, { target: easy.key });
      expect(r.statusCode).toBe(200);
      expect(r.json().alliances[0]).toMatchObject({ status: "active", partnerKind: "npc", partnerName: easy.name });
      expect(allianceCount(a.service.sync(id))).toBe(1);
    }
    if (hard) {
      const r = await post(a, u.cookie, `/api/malls/${id}/world/alliance`, { target: hard.key });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toContain("不夠格");
    }
    expect(easy || hard).toBeTruthy();
  });

  it("the combined co-op bonus (pacts + alliances) never exceeds +6%", () => {
    const s: MallState = createInitialState(1, 0, 0);
    const base = rivalMult(s, "local");
    s.world.alliances = [
      { id: 1, partner: "甲", endTick: 1e9 },
      { id: 2, partner: "乙", endTick: 1e9 },
      { id: 3, partner: "丙", endTick: 1e9 },
    ];
    for (const r of s.rivals.list) r.pactUntil = 1e9;
    expect(rivalMult(s, "local") - base).toBeLessThanOrEqual(0.0601);
  });
});

describe("determinism with alliances", () => {
  it("catch-up equals tick-by-tick while an alliance modifier is active", () => {
    const s = createInitialState(5, 0, 0);
    s.level = 3;
    s.world.alliances = [{ id: 1, partner: "夥伴", endTick: 20 * TICKS_PER_DAY }];
    const a = advanceTo(s, 8 * TICKS_PER_DAY);
    let b = s;
    for (let i = 0; i < 8; i++) b = advanceTo(b, b.tick + TICKS_PER_DAY);
    expect(b.funds).toBeCloseTo(a.funds, 2);
    expect(b.world).toEqual(a.world);
  });
});
