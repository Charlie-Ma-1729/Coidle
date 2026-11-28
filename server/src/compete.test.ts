import { afterEach, describe, expect, it } from "vitest";
import {
  COMPETE_COOLDOWN_MS,
  COMPETE_MAX_PER_DAY,
  COMPETE_NEWBIE_MS,
  COMPETE_SHIELD_MS,
  COMPETE_SELF_MULT,
  COMPETE_TARGET_MULT,
  STARTER_QUESTS,
  WORLD_EPOCH_MS,
  competeCost,
  type MallState,
} from "@coidle/shared";
import { publicKey } from "@coidle/shared";
import { buildApp } from "./app";
import { createInitialState } from "./sim";
import { applyMail } from "./sim/mail";
import { calm } from "./testutil";

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

/** 三座商場：甲、乙、丙。先放著過了新手保護期，再把等級與資金調成想要的樣子 */
async function trio(a: App, levels: [number, number, number] = [3, 3, 3]) {
  const users = [await reg(a, "alice"), await reg(a, "bob"), await reg(a, "carol")];
  const malls = users.map((u, i) => a.service.createMall(u.id, `商場${i}`).mallId);
  calm(a.service, ...malls);
  clock.t += COMPETE_NEWBIE_MS + 1000;
  const cache = (a.service as unknown as { cache: Map<number, MallState> }).cache;
  malls.forEach((id, i) => {
    const s = structuredClone(a.service.sync(id));
    s.level = levels[i]!;
    s.funds = 50_000_000;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    cache.set(id, s);
  });
  clock.t += 61_000;
  malls.forEach((id) => a.service.sync(id)); // 更新名錄（等級）
  return { users, malls, cache };
}
const hit = (a: App, who: { cookie: string }, from: number, target: string, persona = "local") => post(a, who.cookie, `/api/malls/${from}/world/compete`, { target, persona });

describe("eligibility", () => {
  it("allows equal levels, one level above, and attacking up; refuses attacking much smaller malls", async () => {
    const a = make();
    const t = await trio(a, [3, 3, 3]);
    const set = (i: number, lv: number) => {
      const s = structuredClone(a.service.sync(t.malls[i]!));
      s.level = lv;
      t.cache.set(t.malls[i]!, s);
    };
    const alice = t.users[0]!;
    // 乙調成 Lv.1：甲(Lv.3) 比乙大 2 級 → 不行
    set(1, 1);
    clock.t += 61_000;
    a.service.sync(t.malls[1]!);
    const refused = await hit(a, alice, t.malls[0]!, `m:${t.malls[1]}`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain("大太多");
    // 乙 Lv.2：差 1 級 → 可以
    set(1, 2);
    clock.t += 61_000;
    a.service.sync(t.malls[1]!);
    expect((await hit(a, alice, t.malls[0]!, `m:${t.malls[1]}`)).statusCode).toBe(200);
    // 丙 Lv.6：甲(Lv.3) 以小打大 → 可以（過了冷卻之後）
    set(2, 6);
    clock.t += COMPETE_COOLDOWN_MS + 61_000;
    a.service.sync(t.malls[2]!);
    expect((await hit(a, alice, t.malls[0]!, `m:${t.malls[2]}`)).statusCode).toBe(200);
  });
});

describe("a successful attack", () => {
  it("costs the attacker, boosts them on that persona, and dents the target only a little", async () => {
    const a = make();
    const t = await trio(a);
    const alice = t.users[0]!;
    const f0 = a.service.sync(t.malls[0]!).funds;
    const r = await hit(a, alice, t.malls[0]!, `m:${t.malls[1]}`, "tourist");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ cost: competeCost(3), target: "商場1", persona: "tourist", hurt: true });
    const sa = a.service.sync(t.malls[0]!);
    const sb = a.service.sync(t.malls[1]!);
    expect(f0 - sa.funds).toBeGreaterThanOrEqual(competeCost(3) - 1);
    const has = (s: MallState, mult: number) => s.modifiers.some((m) => m.kind === "traffic" && m.persona === "tourist" && m.mult === mult);
    expect(has(sa, COMPETE_SELF_MULT)).toBe(true);
    expect(has(sb, COMPETE_TARGET_MULT)).toBe(true);
    expect(sb.world.notices[0]!.text).toContain("商場0");
    expect(sa.world.notices[0]!.text).toContain("商場1");
    // 第三方沒有任何影響
    const third = a.service.sync(t.malls[2]!);
    expect(third.modifiers.some((m) => m.kind === "traffic" && "mult" in m && (m.mult === COMPETE_SELF_MULT || m.mult === COMPETE_TARGET_MULT))).toBe(false);
    expect(third.world.notices).toHaveLength(0);
  });

  it("attacking an NPC mall works too (and the answer looks the same as for a real mall)", async () => {
    const a = make();
    const t = await trio(a);
    const npc = a.service.world.entries().find((e) => e.kind === "npc" && e.level >= 2 && e.level <= 5)!;
    expect(npc).toBeTruthy();
    const s = structuredClone(a.service.sync(t.malls[0]!));
    s.level = Math.max(1, npc.level - 1); // 小打大
    t.cache.set(t.malls[0]!, s);
    const r = await hit(a, t.users[0]!, t.malls[0]!, publicKey(npc.key)); // 玩家只看得到對外代號
    expect(r.statusCode).toBe(200);
    expect(r.json().hurt).toBe(true);
  });
});

describe("limits and protection", () => {
  it("has a cooldown and a daily cap for the attacker", async () => {
    const a = make();
    const t = await trio(a);
    const alice = t.users[0]!;
    const m = (n: number) => `m:${t.malls[n]}`;
    expect((await hit(a, alice, t.malls[0]!, m(1))).statusCode).toBe(200);
    const cd = await hit(a, alice, t.malls[0]!, m(2));
    expect(cd.statusCode).toBe(400);
    expect(cd.json().error).toContain("冷卻");
    clock.t += COMPETE_COOLDOWN_MS + 1000;
    expect((await hit(a, alice, t.malls[0]!, m(2))).statusCode).toBe(200);
    clock.t += COMPETE_COOLDOWN_MS + 1000;
    const npc = a.service.world.entries().find((e) => e.kind === "npc" && e.level >= 2 && e.level <= 4)!;
    expect((await hit(a, alice, t.malls[0]!, npc.key)).statusCode).toBe(200);
    clock.t += COMPETE_COOLDOWN_MS + 1000;
    const capped = await hit(a, alice, t.malls[0]!, m(1));
    expect(capped.statusCode).toBe(400);
    expect(COMPETE_MAX_PER_DAY).toBe(3);
  });

  it("protects a freshly hit mall, shows it publicly, and ends the shield later", async () => {
    const a = make();
    const t = await trio(a);
    await hit(a, t.users[0]!, t.malls[0]!, `m:${t.malls[2]}`);
    const second = await hit(a, t.users[1]!, t.malls[1]!, `m:${t.malls[2]}`);
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toContain("保護期");
    const view = (await a.app.inject({ method: "GET", url: "/api/world", headers: { cookie: t.users[1]!.cookie } })).json();
    expect(view.shields[`m:${t.malls[2]}`]).toBeGreaterThan(clock.t);
    clock.t += COMPETE_SHIELD_MS + 1000;
    expect((await hit(a, t.users[1]!, t.malls[1]!, `m:${t.malls[2]}`)).statusCode).toBe(200);
    // 保護期過了，但每天被針對最多 2 次
    clock.t += COMPETE_SHIELD_MS + 1000;
    const third = await hit(a, t.users[0]!, t.malls[0]!, `m:${t.malls[2]}`);
    expect(third.statusCode).toBe(400);
    expect(third.json().error).toContain("太多次");
  });

  it("brand-new malls cannot be targeted", async () => {
    const a = make();
    const t = await trio(a);
    const u = await reg(a, "newbie");
    const fresh = a.service.createMall(u.id, "新手商場").mallId;
    calm(a.service, fresh);
    const s = structuredClone(a.service.sync(fresh));
    s.level = 3; // 等級夠接近，單純測新手保護
    t.cache.set(fresh, s);
    clock.t += 61_000;
    a.service.sync(fresh);
    const r = await hit(a, t.users[0]!, t.malls[0]!, `m:${fresh}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("新手保護");
  });

  it("allies cannot attack each other", async () => {
    const a = make();
    const t = await trio(a);
    await post(a, t.users[0]!.cookie, `/api/malls/${t.malls[0]}/world/alliance`, { target: `m:${t.malls[1]}` });
    const inv = (await a.app.inject({ method: "GET", url: `/api/malls/${t.malls[1]}/world/alliances`, headers: { cookie: t.users[1]!.cookie } })).json().alliances[0];
    await post(a, t.users[1]!.cookie, `/api/malls/${t.malls[1]}/world/alliance/${inv.id}/respond`, { accept: true });
    const r = await hit(a, t.users[0]!, t.malls[0]!, `m:${t.malls[1]}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("盟友");
  });

  it("rejects bad input, strangers, self, and short funds", async () => {
    const a = make();
    const t = await trio(a);
    const alice = t.users[0]!;
    const bob = t.users[1]!;
    expect((await hit(a, alice, t.malls[0]!, `m:${t.malls[1]}`, "alien")).statusCode).toBe(400);
    expect((await hit(a, alice, t.malls[0]!, `m:${t.malls[0]}`)).statusCode).toBe(400);
    expect((await hit(a, alice, t.malls[0]!, "m:9999")).statusCode).toBe(404);
    expect((await hit(a, bob, t.malls[0]!, `m:${t.malls[1]}`)).statusCode).toBe(403); // 不是甲的成員
    const poor = structuredClone(a.service.sync(t.malls[0]!));
    poor.funds = 1000;
    t.cache.set(t.malls[0]!, poor);
    const r = await hit(a, alice, t.malls[0]!, `m:${t.malls[1]}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("資金");
  });
});

describe("mail effects are clamped", () => {
  it("never lets a hit exceed -15% or a gain exceed +20%, and ignores unknown personas", () => {
    const s = createInitialState(1, 1000, 0);
    applyMail(s, { id: 1, kind: "poach_hit", payload: { persona: "local", mult: 0.01, ticks: 99999, who: "某商場" } });
    applyMail(s, { id: 2, kind: "poach_gain", payload: { persona: "tourist", mult: 50, ticks: 1, who: "某商場" } });
    applyMail(s, { id: 3, kind: "poach_hit", payload: { persona: "robot", mult: 0.5 } });
    const mods = s.modifiers.filter((m) => m.kind === "traffic") as unknown as { persona: string; mult: number; endTick: number }[];
    expect(mods).toHaveLength(2);
    expect(mods.find((m) => m.persona === "local")!.mult).toBe(0.85);
    expect(mods.find((m) => m.persona === "local")!.endTick - s.tick).toBeLessThanOrEqual(288);
    expect(mods.find((m) => m.persona === "tourist")!.mult).toBe(1.2);
  });
});

describe("counter-attack support", () => {
  it("a hit notice remembers who hit us and which customers were taken; bad keys are dropped", () => {
    const s = createInitialState(1, 1000, 0);
    applyMail(s, { id: 1, kind: "poach_hit", payload: { persona: "student", mult: 0.9, ticks: 288, who: "對手百貨", key: "m:7" } });
    expect(s.world.notices[0]).toMatchObject({ from: "m:7", persona: "student" });
    applyMail(s, { id: 2, kind: "poach_hit", payload: { persona: "local", mult: 0.9, ticks: 288, who: "對手百貨", key: "npc:evil" } });
    expect(s.world.notices[0]!.from).toBeUndefined();
    applyMail(s, { id: 3, kind: "poach_gain", payload: { persona: "local", mult: 1.1, ticks: 288, who: "對手百貨", key: "m:7" } });
    expect(s.world.notices[0]!.from).toBeUndefined(); // 自己發動的不會有反擊
  });
});

describe("economic impact stays bounded (balance regression)", () => {
  const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
  const base = (seed = 21): MallState => {
    const s = createInitialState(seed, START, 0);
    s.level = 3;
    s.funds = 100_000_000;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    return s;
  };
  const revenue = (s: MallState) => s.totalRevenue;

  it("being hit at the maximum rate costs a mall well under 15% of a week's revenue", async () => {
    const { advanceTo } = await import("./sim");
    const calm = advanceTo(base(), START + 8 * 288);
    let hit = base();
    // 每天被打 2 次（對不同客群）——保護期與每日上限允許的最大頻率
    for (let d = 0; d < 7; d++) {
      for (const persona of ["tourist", "local"]) applyMail(hit, { id: d, kind: "poach_hit", payload: { persona, mult: COMPETE_TARGET_MULT, ticks: 288, who: "對手" } });
      hit = advanceTo(hit, hit.tick + 288);
    }
    hit = advanceTo(hit, START + 8 * 288);
    const loss = 1 - revenue(hit) / revenue(calm);
    expect(loss).toBeGreaterThan(0);
    expect(loss).toBeLessThan(0.15);
  });

  it("a poaching campaign pays back at least some of its cost but never more than a few times over", async () => {
    const { advanceTo } = await import("./sim");
    // 每日隨機（客群雜訊、錢包、購買量）讓單一種子的差額被雜訊淹沒，所以取多個種子的平均
    const seeds = [21, 22, 23, 24, 25, 26];
    let gain = 0;
    for (const seed of seeds) {
      const calm = advanceTo(base(seed), START + 6 * 288);
      let boosted = base(seed);
      for (let d = 0; d < 3; d++) {
        applyMail(boosted, { id: d, kind: "poach_gain", payload: { persona: "tourist", mult: COMPETE_SELF_MULT, ticks: 288, who: "對手" } });
        boosted = advanceTo(boosted, boosted.tick + 2 * 288);
      }
      gain += (revenue(boosted) - revenue(calm)) / seeds.length;
    }
    const spent = 3 * competeCost(3);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(spent * 6); // 不是無本生意
  });
});
