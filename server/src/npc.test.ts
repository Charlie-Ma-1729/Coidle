import { afterEach, describe, expect, it } from "vitest";
import { COMPETE_MAX_PER_DAY, COMPETE_NEWBIE_MS, NPC_MALLS, WORLD_EPOCH_MS, internalKey, npcEntry, publicKey, type MallState } from "@coidle/shared";
import { buildApp } from "./app";
import { NPC_BASE_P } from "./world/npcActor";
import { calm, overseerLogin } from "./testutil";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const clock = { t: WORLD_EPOCH_MS + 5 * DAY };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + 5 * DAY;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;

async function reg(a: App, username: string) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName: username } });
  const cookie = `coidle_sid=${res.cookies.find((x) => x.name === "coidle_sid")!.value}`;
  return { cookie, id: a.repo.userByName(username)!.id };
}
const call = (a: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) => a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });
const cacheOf = (a: App) => (a.service as unknown as { cache: Map<number, MallState> }).cache;

/** 一座已經過了新手保護期、等級夠的真人商場 */
async function seasoned(a: App, name: string, level = 3) {
  const u = await reg(a, name);
  const { mallId } = a.service.createMall(u.id, `${name}的商場`);
  calm(a.service, mallId);
  const s = structuredClone(a.service.sync(mallId));
  s.level = level;
  s.funds = 20_000_000;
  cacheOf(a).set(mallId, s);
  a.service.sync(mallId);
  clock.t += COMPETE_NEWBIE_MS + HOUR; // 過了新手保護期
  a.service.sync(mallId);
  return { ...u, mallId, key: `m:${mallId}` };
}

describe("NPC malls look exactly like real malls to players", () => {
  it("public keys map back and forth, and nothing in the public view says NPC", async () => {
    const a = make();
    await seasoned(a, "p1");
    for (const n of NPC_MALLS) {
      const pub = publicKey(`n:${n.id}`);
      expect(pub).toMatch(/^m:90\d\d$/);
      expect(internalKey(pub)).toBe(`n:${n.id}`);
    }
    expect(internalKey("m:5")).toBe("m:5");
    const view = a.service.world.view();
    expect(JSON.stringify(view)).not.toMatch(/"npc"|"n:|NPC/);
    expect(view.entries.every((e) => e.kind === "player" && e.tagline === "")).toBe(true);
  });

  it("an NPC and a real mall go through the same route when a player sends funds", async () => {
    const a = make();
    const p = await seasoned(a, "p1");
    const q = await seasoned(a, "p2");
    const npcPub = publicKey("n:harbor");
    const url = `/api/malls/${p.mallId}/world/trade/funds`;
    const toNpc = await call(a, p.cookie, "POST", url, { target: npcPub, amount: 100_000 });
    const toReal = await call(a, p.cookie, "POST", url, { target: q.key, amount: 100_000 });
    expect(toNpc.statusCode).toBe(200);
    expect(toReal.statusCode).toBe(200);
    expect(Object.keys(toNpc.json()).sort()).toEqual(Object.keys(toReal.json()).sort());
    expect(toNpc.json().received).toBe(toReal.json().received); // 手續費一樣
    expect(a.repo.recentTrades(10).filter((t) => t.kind === "funds")).toHaveLength(2);
    // 限制也一樣：單筆上限
    expect((await call(a, p.cookie, "POST", url, { target: npcPub, amount: 99_999_999 })).statusCode).toBe(400);
  });

  it("goods can be sent to an NPC", async () => {
    const a = make();
    const p = await seasoned(a, "p1");
    const s = structuredClone(a.service.sync(p.mallId));
    const shop = s.shops.find((x) => x.category === "kushikatsu" || x.category === "takoyaki" || x.category === "ramen")!;
    shop.stock = 400;
    cacheOf(a).set(p.mallId, s);
    const r = await call(a, p.cookie, "POST", `/api/malls/${p.mallId}/world/trade/goods`, { target: publicKey("n:skyline"), shopId: shop.id, qty: 40 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ sent: 40, received: 38 });
    expect(typeof r.json().rescue).toBe("boolean");
  });

  it("a player can counter-attack an NPC from the 'from' key in a notice, same as against a real mall", async () => {
    const a = make();
    const npc = a.service.world.entries().find((e) => e.key === "n:harbor")!;
    const p = await seasoned(a, "p1", npc.level); // 等級相同：雙方都有資格出手
    a.service.npcActor.manual("harbor", { action: "poach", target: p.key, persona: "tourist", ignoreLimits: true });
    a.service.sync(p.mallId);
    const notice = a.service.sync(p.mallId).world.notices.find((n) => n.from);
    expect(notice).toBeTruthy();
    expect(notice!.from).toBe(publicKey("n:harbor")); // 通知裡的對方代號是對外代號
    const r = await call(a, p.cookie, "POST", `/api/malls/${p.mallId}/world/compete`, { target: notice!.from, persona: notice!.persona });
    expect(r.statusCode).toBe(200);
    expect(r.json().target).toBe(npc.name);
  });
});

describe("Overseer adjustments to NPC malls", () => {
  it("override rename/level/score/revenue/hidden show up in the directory; expiring ones go away", async () => {
    const a = make();
    const base = a.service.world.entries().find((e) => e.key === "n:airport")!;
    const def = NPC_MALLS.find((n) => n.id === "airport")!;
    a.service.world.npc.set("airport", { name: "新機場商城", levelDelta: 2, scoreMult: 1.2, revenueMult: 2, repDelta: 5, heatDelta: -3 }, clock.t + 2 * HOUR);
    const e = a.service.world.entries().find((x) => x.key === "n:airport")!;
    expect(e.name).toBe("新機場商城");
    expect(e.level).toBe(Math.min(8, npcEntry(def, clock.t, { scoreMult: 1.2 }).level + 2));
    expect(e.score).toBeGreaterThan(base.score);
    expect(e.revenue30).toBeGreaterThan(base.revenue30);
    expect(e.localRep).toBeCloseTo(npcEntry(def, clock.t, { scoreMult: 1.2, repDelta: 5 }).localRep, 1);
    expect(a.service.world.view().entries.some((x) => x.name === "新機場商城")).toBe(true);

    a.service.world.npc.set("airport", { hidden: true });
    expect(a.service.world.entries().some((x) => x.key === "n:airport")).toBe(false);
    expect(a.service.world.view().entries.some((x) => x.key === publicKey("n:airport"))).toBe(false);

    a.service.world.npc.set("airport", { name: "暫時改名" }, clock.t + HOUR);
    clock.t += 2 * HOUR; // 過期
    expect(a.service.world.entries().find((x) => x.key === "n:airport")!.name).toBe(base.name);
  });

  it("clamps what the Overseer types and ignores unknown fields", () => {
    const a = make();
    const ov = a.service.world.npc.set("harbor", { levelDelta: 99, scoreMult: 50, revenueMult: -3, activity: 99, evil: "x", name: "  " });
    expect(ov).toEqual({ levelDelta: 7, scoreMult: 3, revenueMult: 0.1, activity: 5 });
    expect(a.service.world.npc.set("harbor", {})).toBeNull();
    expect(a.service.world.npc.overrides().harbor).toBeUndefined();
    expect(() => a.service.world.npc.set("nope", { levelDelta: 1 })).toThrow();
  });

  it("admin API: list, override, settings, manual action; players are refused; everything is audited", async () => {
    const a = make();
    const p = await seasoned(a, "p1", 3);
    const o = await overseerLogin(a, clock.t);
    expect((await call(a, p.cookie, "GET", "/api/admin/npc")).statusCode).toBe(403);
    const list = (await call(a, o.cookie, "GET", "/api/admin/npc")).json();
    expect(list.npcs).toHaveLength(NPC_MALLS.length);
    expect(list.settings).toMatchObject({ auto: true, activity: 1 });
    expect(list.npcs[0].publicKey).toMatch(/^m:90/);

    expect((await call(a, o.cookie, "POST", "/api/admin/npc/harbor/override", { override: { name: "改名港灣", levelDelta: 1 }, hours: 6 })).statusCode).toBe(200);
    expect(a.service.world.entries().find((e) => e.key === "n:harbor")!.name).toBe("改名港灣");
    expect((await call(a, o.cookie, "POST", "/api/admin/npc/nope/override", { override: {} })).statusCode).toBe(404);

    const act = await call(a, o.cookie, "POST", "/api/admin/npc/harbor/act", { action: "poach", target: publicKey(p.key), persona: "local" });
    expect(act.statusCode).toBe(200);
    expect(act.json().message).toContain("搶客");
    // 規則照常：同一座商場剛被打過（保護期）→ 再打會被擋；勾選忽略上限才打得下去
    expect((await call(a, o.cookie, "POST", "/api/admin/npc/harbor/act", { action: "poach", target: p.key })).statusCode).toBe(400);
    expect((await call(a, o.cookie, "POST", "/api/admin/npc/harbor/act", { action: "poach", target: p.key, ignoreLimits: true })).statusCode).toBe(200);

    expect((await call(a, o.cookie, "POST", "/api/admin/npc/settings", { auto: false, activity: 2 })).json()).toEqual({ auto: false, activity: 2 });
    const actions = (await call(a, o.cookie, "GET", "/api/admin/npc/actions")).json().actions as { action: string; manual: boolean; npcName: string }[];
    expect(actions.filter((x) => x.action === "poach" && x.manual)).toHaveLength(2);
    expect(actions[0]!.npcName).toBe("改名港灣");
    const audited = a.repo.audit({ limit: 50 }).map((r) => r.action);
    for (const want of ["npc.override", "npc.act", "npc.settings"]) expect(audited).toContain(want);
  });
});

describe("NPC actions follow the same rules as players", () => {
  it("poaching respects level eligibility: a much bigger NPC won't hit a small mall, a smaller one may hit a big mall", async () => {
    const a = make();
    const big = await seasoned(a, "big", 6);
    const small = await seasoned(a, "small", 1);
    a.service.world.npc.set("harbor", { levelDelta: -7, scoreMult: 0.3 }); // NPC 很小
    const tiny = a.service.world.entries().find((e) => e.key === "n:harbor")!;
    const bigEntry = a.service.world.playerEntries().find((e) => e.key === big.key)!;
    expect(a.service.compete.npcBlocker(tiny, bigEntry)).toBeNull(); // 小打大可以

    a.service.world.npc.set("harbor", { levelDelta: 7, scoreMult: 3 }); // NPC 很大
    const huge = a.service.world.entries().find((e) => e.key === "n:harbor")!;
    const smallEntry = a.service.world.playerEntries().find((e) => e.key === small.key)!;
    expect(huge.level).toBeGreaterThan(smallEntry.level + 1);
    expect(a.service.compete.npcBlocker(huge, smallEntry)).toContain("大太多"); // 大打小不行
  });

  it("a brand new mall can't be hit; a mall that was just hit is shielded; the attacker has its own cooldown", async () => {
    const a = make();
    const u = await reg(a, "fresh");
    const { mallId } = a.service.createMall(u.id, "新開張");
    a.service.sync(mallId);
    const fresh = a.service.world.playerEntries().find((e) => e.key === `m:${mallId}`)!;
    a.service.world.npc.set("skyline", { levelDelta: 0 });
    const sky = a.service.world.entries().find((e) => e.key === "n:skyline")!;
    expect(a.service.compete.npcBlocker(sky, fresh)).toContain("新手保護");

    const p = await seasoned(a, "vet", 8);
    const vet = a.service.world.playerEntries().find((e) => e.key === p.key)!;
    expect(a.service.compete.npcBlocker(sky, vet)).toBeNull();
    a.service.compete.npcAttack(sky, vet, "tourist");
    expect(a.service.compete.npcBlocker(sky, vet)).toBeTruthy(); // 自己的冷卻（也是對方的保護期）
    const other = a.service.world.entries().find((e) => e.key === "n:harbor")!;
    expect(a.service.compete.npcBlocker(other, vet)).toContain("保護期"); // 對方剛被打過
    const notice = a.service.sync(p.mallId).world.notices.find((n) => n.from);
    expect(notice?.from).toBe(publicKey("n:skyline")); // 被搶客的通知（對外代號）已經送到
  });

  it("the test mall (sandbox) is never a target", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t);
    const box = a.service.adminMakeSandbox(o.userId);
    expect(a.service.world.playerEntries().some((e) => e.key === `m:${box.mallId}`)).toBe(false);
    expect(() => a.service.npcActor.manual("harbor", { action: "poach", target: `m:${box.mallId}`, ignoreLimits: true })).toThrow();
    expect(() => a.service.npcActor.manual("harbor", { action: "propose", target: `m:${box.mallId}` })).toThrow();
  });
});

describe("NPC automatic actions", () => {
  async function world() {
    const a = make();
    const p = await seasoned(a, "p1", 3);
    await seasoned(a, "p2", 3);
    return { a, p };
  }

  it("is rare by default (about one action per NPC every three days) and logs everything it does", async () => {
    expect(NPC_BASE_P).toBeCloseTo(1 / 72, 5);
    const { a } = await world();
    for (let i = 0; i < 24 * 12; i++) {
      clock.t += HOUR;
      a.service.tickAll();
    }
    const n = a.repo.npcActions(500).filter((r) => r.manual === 0 && r.action !== "respond").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(NPC_MALLS.length * 12 * 0.7); // 12 天 × 8 座 NPC ＝ 96 個 NPC 日，預期約 32 次，遠低於每天一次
  });

  it("'auto off' and 'activity 0' stop all voluntary actions, and hidden NPCs stay quiet", async () => {
    const { a } = await world();
    a.service.world.npc.setAuto(false);
    for (let i = 0; i < 24 * 6; i++) {
      clock.t += HOUR;
      a.service.tickAll();
    }
    expect(a.repo.npcActions(100).length).toBe(0);
    a.service.world.npc.setAuto(true);
    a.service.world.npc.setActivity(0);
    for (let i = 0; i < 24 * 6; i++) {
      clock.t += HOUR;
      a.service.tickAll();
    }
    expect(a.repo.npcActions(100).length).toBe(0);
    a.service.world.npc.setActivity(5);
    for (const n of NPC_MALLS) a.service.world.npc.set(n.id, { hidden: true });
    for (let i = 0; i < 24 * 3; i++) {
      clock.t += HOUR;
      a.service.tickAll();
    }
    expect(a.repo.npcActions(100).length).toBe(0);
  });

  it("at the highest activity the NPCs do act, never beyond the shared caps, and never touch the test mall", async () => {
    const { a } = await world();
    const o = await overseerLogin(a, clock.t);
    const box = a.service.adminMakeSandbox(o.userId);
    a.service.world.npc.setActivity(5);
    for (let i = 0; i < 24 * 8; i++) {
      clock.t += HOUR;
      a.service.tickAll();
    }
    const acts = a.repo.npcActions(1000);
    expect(acts.length).toBeGreaterThan(5);
    expect(acts.some((x) => x.target_key === `m:${box.mallId}`)).toBe(false);
    // 同一座商場一天最多被針對 2 次，每個 NPC 一天最多 3 次出手
    const attacks = a.repo.db.prepare("SELECT ts, attacker, target_key FROM attacks WHERE attacker < 0").all() as { ts: number; attacker: number; target_key: string }[];
    for (const t of attacks) {
      expect(attacks.filter((x) => x.target_key === t.target_key && x.ts > t.ts - DAY && x.ts <= t.ts).length).toBeLessThanOrEqual(2);
      expect(attacks.filter((x) => x.attacker === t.attacker && x.ts > t.ts - DAY && x.ts <= t.ts).length).toBeLessThanOrEqual(COMPETE_MAX_PER_DAY);
    }
  });

  it("answers a player's alliance invitation by itself after the delay, with the same notice a real mall would send", async () => {
    const { a, p } = await world();
    a.service.world.npc.set("harbor", { scoreMult: 3 }); // 一定婉拒
    await call(a, p.cookie, "POST", `/api/malls/${p.mallId}/world/alliance`, { target: publicKey("n:harbor") });
    clock.t += 5 * HOUR;
    a.service.tickAll();
    expect(a.service.sync(p.mallId).world.notices.some((n) => n.text.includes("婉拒了你們的聯名邀請"))).toBe(true);
    expect(a.repo.npcActions(10).some((r) => r.action === "respond")).toBe(true);
  });

  it("an NPC sometimes retaliates when a player poaches it (with a delay), still under the same rules", async () => {
    const a = make();
    const p = await seasoned(a, "p1", a.service.world.entries().find((e) => e.key === "n:harbor")!.level);
    let retaliated = 0;
    for (let i = 0; i < 60 && retaliated === 0; i++) {
      clock.t += 9 * HOUR; // 過了自己的冷卻與對方的保護期
      const s = structuredClone(a.service.sync(p.mallId));
      s.funds = 20_000_000;
      cacheOf(a).set(p.mallId, s);
      const r = await call(a, p.cookie, "POST", `/api/malls/${p.mallId}/world/compete`, { target: publicKey("n:harbor"), persona: "tourist" });
      if (r.statusCode !== 200) continue;
      a.service.tickAll();
      retaliated = a.repo.npcActions(50).filter((x) => x.action === "retaliate").length;
    }
    expect(retaliated).toBeGreaterThan(0);
    // 回敬的 poach_hit 信會在 1–5 小時之後才送到
    const pending = a.repo.db.prepare("SELECT deliver_at, created_at FROM mall_mailbox WHERE kind = 'poach_hit' AND to_mall = ?").all(p.mallId) as { deliver_at: number; created_at: number }[];
    expect(pending.some((m) => m.deliver_at > m.created_at)).toBe(true);
  });
});
