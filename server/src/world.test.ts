import { afterEach, describe, expect, it } from "vitest";
import {
  NPC_MALLS,
  SEASON_MS,
  SEASON_REWARDS,
  STARTER_QUESTS,
  WORLD_EPOCH_MS,
  canCompete,
  npcEntries,
  npcEntry,
  rankEntries,
  seasonAt,
  seasonRange,
  seasonRewardFunds,
  type MallState,
} from "@coidle/shared";
import { buildApp } from "./app";
import { createInitialState, migrateState } from "./sim";
import { applyMail } from "./sim/mail";

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
const get = (a: App, cookie: string, url: string) => a.app.inject({ method: "GET", url, headers: { cookie } });

describe("NPC malls are a pure function of the real time", () => {
  it("are deterministic, bounded, and grow over the first weeks", () => {
    for (const def of NPC_MALLS) {
      const a = npcEntry(def, WORLD_EPOCH_MS + 10 * DAY);
      const b = npcEntry(def, WORLD_EPOCH_MS + 10 * DAY);
      expect(a).toEqual(b);
      for (let d = 0; d < 400; d += 7) {
        const e = npcEntry(def, WORLD_EPOCH_MS + d * DAY);
        expect(e.level).toBeGreaterThanOrEqual(1);
        expect(e.level).toBeLessThanOrEqual(8);
        expect(e.score).toBeGreaterThan(9);
        expect(e.score).toBeLessThanOrEqual(95);
        expect(e.stars).toBeGreaterThanOrEqual(1);
        expect(e.stars).toBeLessThanOrEqual(5);
        expect(e.kind).toBe("npc");
      }
      const early = npcEntry(def, WORLD_EPOCH_MS);
      const late = npcEntry(def, WORLD_EPOCH_MS + 300 * DAY);
      expect(late.score + 6).toBeGreaterThan(early.score); // 起伏有限，長期是往上走
    }
    expect(npcEntries(WORLD_EPOCH_MS + DAY)).toHaveLength(NPC_MALLS.length);
    expect(new Set(NPC_MALLS.map((n) => n.id)).size).toBe(NPC_MALLS.length);
    expect(NPC_MALLS.length).toBeGreaterThanOrEqual(8);
  });

  it("rank entries three ways", () => {
    const list = npcEntries(WORLD_EPOCH_MS + 100 * DAY);
    for (const board of ["score", "revenue", "rep"] as const) {
      const r = rankEntries(list, board);
      expect(r).toHaveLength(list.length);
      expect(new Set(r.map((e) => e.key)).size).toBe(list.length);
    }
    const byScore = rankEntries(list, "score");
    expect(byScore[0]!.score).toBeGreaterThanOrEqual(byScore[1]!.score);
  });
});

describe("competition eligibility (small attacks big, or close levels)", () => {
  it("allows equal, one level apart, and attacking up; refuses big-on-small", () => {
    expect(canCompete(3, 3)).toBe(true);
    expect(canCompete(3, 4)).toBe(true);
    expect(canCompete(1, 8)).toBe(true); // 小打大
    expect(canCompete(4, 3)).toBe(true); // 只差 1
    expect(canCompete(5, 3)).toBe(false); // 大打小
    expect(canCompete(8, 1)).toBe(false);
  });
});

describe("seasons", () => {
  it("are 28 real days and contiguous", () => {
    expect(seasonAt(WORLD_EPOCH_MS)).toBe(0);
    expect(seasonAt(WORLD_EPOCH_MS + SEASON_MS - 1)).toBe(0);
    expect(seasonAt(WORLD_EPOCH_MS + SEASON_MS)).toBe(1);
    expect(seasonRange(1).start).toBe(seasonRange(0).end);
    expect(seasonRewardFunds(1_000_000, 1)).toBe(1_000_000);
    expect(seasonRewardFunds(1_000_000, 5)).toBe(3_000_000);
  });
});

describe("directory API", () => {
  it("needs a login, lists real malls and NPC malls, and exposes only public fields", async () => {
    const a = make();
    expect((await a.app.inject({ method: "GET", url: "/api/world" })).statusCode).toBe(401);
    const u1 = await reg(a, "alice");
    const u2 = await reg(a, "bob");
    const m1 = a.service.createMall(u1.id, "愛麗絲的商場").mallId;
    const m2 = a.service.createMall(u2.id, "鮑伯的商場").mallId;

    const res = await get(a, u1.cookie, "/api/world");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const keys = body.entries.map((e: { key: string }) => e.key);
    expect(keys).toContain(`m:${m1}`);
    expect(keys).toContain(`m:${m2}`);
    expect(keys).toContain("n:harbor");
    expect(body.entries.filter((e: { kind: string }) => e.kind === "npc")).toHaveLength(NPC_MALLS.length);
    expect(body.season.index).toBe(0);

    // 只有公開欄位：沒有資金、成員、庫存、種子…
    const allowed = new Set(["key", "kind", "name", "tagline", "level", "stars", "score", "localRep", "touristHeat", "revenue30", "shops", "topCategory", "updatedAt"]);
    for (const e of body.entries) for (const k of Object.keys(e)) expect(allowed.has(k), k).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/funds|inviteCode|seed|members/);
    const mine = body.entries.find((e: { key: string }) => e.key === `m:${m1}`);
    expect(mine.name).toBe("愛麗絲的商場");
    expect(mine.shops).toBe(5);
    expect(mine.level).toBe(1);
  });

  it("renaming a mall updates the directory right away", async () => {
    const a = make();
    const u = await reg(a, "carol");
    const id = a.service.createMall(u.id, "舊名字").mallId;
    a.service.renameMall(id, u.id, "新名字");
    const e = a.service.world.entries().find((x) => x.key === `m:${id}`)!;
    expect(e.name).toBe("新名字");
  });

  it("a dissolved mall disappears from the directory", async () => {
    const a = make();
    const u = await reg(a, "dave");
    const id = a.service.createMall(u.id, "要解散的商場").mallId;
    a.service.dissolveMall(id);
    expect(a.service.world.entries().some((x) => x.key === `m:${id}`)).toBe(false);
  });
});

describe("season settlement and the mailbox", () => {
  const seed = (a: App, mallId: number, over: { level?: number; score?: number; revenue30?: number; ageDays?: number }) => {
    a.repo.upsertDirectory({
      mallId,
      name: `商場${mallId}`,
      level: over.level ?? 3,
      stars: 4,
      score: over.score ?? 90,
      localRep: 70,
      touristHeat: 70,
      revenue30: over.revenue30 ?? 5_000_000,
      shops: 12,
      topCategory: "拉麵",
      createdAt: WORLD_EPOCH_MS - (over.ageDays ?? 10) * DAY,
      updatedAt: clock.t,
    });
  };

  it("pays the winner, a participation bonus, nothing to brand-new or idle malls — exactly once", async () => {
    const a = make();
    const win = await reg(a, "winner");
    const mid = await reg(a, "middle");
    const fresh = await reg(a, "fresh");
    const idle = await reg(a, "idle");
    const m1 = a.service.createMall(win.id, "冠軍").mallId;
    const m2 = a.service.createMall(mid.id, "普通").mallId;
    const m3 = a.service.createMall(fresh.id, "新手").mallId;
    const m4 = a.service.createMall(idle.id, "沒營收").mallId;
    seed(a, m1, { level: 4, score: 95 });
    seed(a, m2, { level: 2, score: 12 }); // 分數比所有 NPC 都低
    seed(a, m3, { level: 2, score: 60, ageDays: -25 }); // 季末前一週內才開幕，太新
    seed(a, m4, { level: 2, score: 60, revenue30: 0 }); // 沒營收

    expect(a.service.world.settleSeasons()).toEqual([]); // 第 0 季還沒結束
    clock.t = WORLD_EPOCH_MS + SEASON_MS + DAY; // 進入第 1 季
    const done = a.service.world.settleSeasons();
    expect(done).toHaveLength(1);
    expect(done[0]!.season).toBe(0);
    expect(done[0]!.ranking[0]!.key).toBe(`m:${m1}`);
    expect(done[0]!.ranking.some((r) => r.kind === "npc")).toBe(true);

    expect(a.repo.pendingMailCount(m1)).toBe(1);
    expect(a.repo.pendingMailCount(m2)).toBe(1);
    expect(a.repo.pendingMailCount(m3)).toBe(0);
    expect(a.repo.pendingMailCount(m4)).toBe(0);
    expect(a.service.world.settleSeasons()).toEqual([]); // 不會重複發獎
    expect(a.repo.pendingMailCount(m1)).toBe(1);

    // 商場同步時收下獎勵
    const before = createInitialState(1, 0, 0).funds;
    const s1 = a.service.sync(m1);
    expect(s1.world.seasons).toHaveLength(1);
    expect(s1.world.seasons[0]).toMatchObject({ season: 0, rank: 1, title: SEASON_REWARDS[0]!.title });
    expect(s1.world.seasons[0]!.reward).toBe(seasonRewardFunds(SEASON_REWARDS[0]!.base, 4));
    expect(s1.funds).toBeGreaterThan(before); // 賺到的營業額還沒大過獎金的量級，至少不會少
    expect(s1.world.notices[0]!.text).toContain("第 1 季結算");
    expect(a.repo.pendingMailCount(m1)).toBe(0);

    const s2 = a.service.sync(m2);
    expect(s2.world.seasons[0]!.title).toBe("參賽商場");
    expect(s2.world.seasons[0]!.rank).toBeGreaterThan(3);
    // 再同步不會重複入帳
    expect(a.service.sync(m1).world.seasons).toHaveLength(1);
  });

  it("a long outage only settles the most recent seasons", async () => {
    const a = make();
    const u = await reg(a, "eve");
    const id = a.service.createMall(u.id, "長期停機").mallId;
    seed(a, id, { ageDays: 400 });
    clock.t = WORLD_EPOCH_MS + 10 * SEASON_MS + DAY;
    expect(a.service.world.settleSeasons().map((r) => r.season)).toEqual([7, 8, 9]);
  });

  it("mail is held until its delivery time, and a paused mall still receives it without its time moving", async () => {
    const a = make();
    const u = await reg(a, "frank");
    const id = a.service.createMall(u.id, "暫停中的商場").mallId;
    a.service.setClock(id, { id: u.id, displayName: u.name }, { paused: true });
    const t0 = a.service.sync(id);
    const funds0 = t0.funds;
    a.repo.addMail(id, "notice", { text: "對面的商場寄來一封問候信" }, clock.t, clock.t + 60_000);

    expect(a.service.sync(id).world.notices).toHaveLength(0); // 還沒到時間
    clock.t += 61_000;
    const s = a.service.sync(id);
    expect(s.world.notices[0]!.text).toContain("問候");
    expect(s.tick).toBe(t0.tick); // 暫停中，時間沒有動
    expect(s.funds).toBe(funds0);
    expect(a.repo.pendingMailCount(id)).toBe(0);
  });
});

describe("mail application is safe and clamped", () => {
  const mk = (): MallState => {
    const s = createInitialState(3, 1000, 0);
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    return s;
  };

  it("clamps absurd rewards, ignores unknown kinds and bad payloads", () => {
    const s = mk();
    const f0 = s.funds;
    applyMail(s, { id: 1, kind: "season_reward", payload: { funds: 9e12, rank: -5, of: 1e9, season: 3, title: "稱號".repeat(50) } });
    expect(s.funds - f0).toBe(50_000_000);
    expect(s.world.seasons[0]!.rank).toBe(1);
    expect(s.world.seasons[0]!.of).toBe(999);
    expect(s.world.seasons[0]!.title.length).toBeLessThanOrEqual(20);

    const f1 = s.funds;
    applyMail(s, { id: 2, kind: "free_money", payload: { funds: 1e9 } });
    applyMail(s, { id: 3, kind: "season_reward", payload: { funds: "lots" } });
    expect(s.funds).toBe(f1);
    expect(s.world.mailCount).toBe(3);
  });

  it("keeps only the latest notices and seasons", () => {
    const s = mk();
    for (let i = 0; i < 30; i++) applyMail(s, { id: i, kind: "notice", payload: { text: `通知 ${i}` } });
    expect(s.world.notices).toHaveLength(20);
    expect(s.world.notices[0]!.text).toBe("通知 29");
    for (let i = 0; i < 20; i++) applyMail(s, { id: i, kind: "season_reward", payload: { funds: 1000, rank: 4, of: 9, season: i, title: "參賽商場" } });
    expect(s.world.seasons).toHaveLength(12);
  });

  it("migrates v11 saves with an empty world record", () => {
    const v11 = JSON.parse(JSON.stringify(mk())) as Record<string, unknown>;
    v11.version = 11;
    delete v11.world;
    const m = migrateState(v11, 0);
    expect(m.version).toBe(13);
    expect(m.world).toEqual({ seasons: [], notices: [], mailCount: 0, alliances: [] });
  });
});
