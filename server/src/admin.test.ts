import { afterEach, describe, expect, it } from "vitest";
import { LEVELS, WORLD_EPOCH_MS } from "@coidle/shared";
import { buildApp } from "./app";
import { overseerLogin } from "./testutil";

const DAY = 86_400_000;
const clock = { t: WORLD_EPOCH_MS + DAY + 3 * 3_600_000 };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + DAY + 3 * 3_600_000;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;

async function register(a: App, username: string, displayName = username) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName } });
  const c = res.cookies.find((x) => x.name === "coidle_sid");
  return { cookie: `coidle_sid=${c!.value}`, id: a.repo.userByName(username)!.id };
}
const call = (a: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) => a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });

describe("metrics", () => {
  it("counts online players (spectators and the Overseer excluded), active players and requests, and keeps daily stats", async () => {
    const a = make();
    const p = await register(a, "p1", "玩家一");
    const q = await register(a, "p2", "玩家二");
    const { id } = (await call(a, p.cookie, "POST", "/api/malls", { name: "商場" })).json();
    await call(a, q.cookie, "GET", "/api/me");
    const o = await overseerLogin(a);
    await a.app.ready();

    const real = await a.app.injectWS(`/ws?mall=${id}`, { headers: { cookie: p.cookie } });
    const spec = await a.app.injectWS(`/ws?mall=${id}&spectate=1`, { headers: { cookie: o.cookie } });
    const live = a.metrics.live();
    expect(live).toMatchObject({ online_users: 1, ws_conns: 1, online_malls: 1, users_total: 2, malls_total: 1, active_24h: 2 });
    expect(live.requests).toBeGreaterThan(3);

    const s = a.metrics.sample();
    expect(a.repo.samples(0, clock.t + 1, 10)).toHaveLength(1);
    expect(a.metrics.live().requests).toBe(0); // 週期計數器歸零
    const day = a.metrics.dayOf(s.ts).key;
    const daily = a.repo.dailyStats(5)[0]!;
    expect(daily).toMatchObject({ day, dau: 2, new_users: 2, peak_online: 1, samples: 1 });
    expect(Number(daily.requests)).toBeGreaterThan(3);

    real.terminate();
    spec.terminate();
    await new Promise((r) => setTimeout(r, 30));
    expect(a.metrics.live().online_users).toBe(0);
  });

  it("serves live numbers, ranges, daily rows, and exports CSV/JSON — export is audited", async () => {
    const a = make();
    await register(a, "p1");
    const o = await overseerLogin(a);
    a.metrics.sample();
    clock.t += 60_000;
    a.metrics.sample();

    const live = (await call(a, o.cookie, "GET", "/api/admin/metrics/live")).json();
    expect(live.now.users_total).toBe(1);
    expect(live.recent).toHaveLength(2);
    const range = (await call(a, o.cookie, "GET", `/api/admin/metrics?from=0&to=${clock.t + 1}`)).json();
    expect(range.samples).toHaveLength(2);
    expect((await call(a, o.cookie, "GET", "/api/admin/metrics/daily?days=7")).json().days).toHaveLength(1);

    const csv = await call(a, o.cookie, "GET", `/api/admin/metrics/export?kind=samples&format=csv&from=0&to=${clock.t + 1}`);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    const lines = csv.body.trim().split("\n");
    expect(lines[0]).toBe("ts,online_users,online_malls,ws_conns,active_24h,active_7d,users_total,malls_total,requests,errors,commands,npc_actions,tick_ms,loop_lag_ms,rss_mb,heap_mb,uptime_s");
    expect(lines).toHaveLength(3);
    expect(lines[1]!.split(",")[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const json = await call(a, o.cookie, "GET", "/api/admin/metrics/export?kind=daily&format=json");
    expect(JSON.parse(json.body)).toHaveLength(1);
    expect(a.repo.audit({ limit: 10, action: "metrics.export" }).length).toBe(2);

    // 一般玩家不能看
    const p = await register(a, "p2");
    expect((await call(a, p.cookie, "GET", "/api/admin/metrics/live")).statusCode).toBe(403);
  });
});

describe("Overseer management of users and malls", () => {
  it("renames, logs out, edits funds/level/clock, sends notices, and manages members and the founder — every step audited", async () => {
    const a = make();
    const owner = await register(a, "own", "創辦人");
    const friend = await register(a, "fri", "朋友");
    const { id, inviteCode } = (await call(a, owner.cookie, "POST", "/api/malls", { name: "測試商場" })).json();
    await call(a, friend.cookie, "POST", "/api/malls/join", { code: inviteCode });
    const o = await overseerLogin(a);
    const adm = (url: string, payload?: unknown) => call(a, o.cookie, "POST", `/api/admin${url}`, payload ?? {});

    // 使用者
    expect((await adm(`/users/${friend.id}/rename`, { displayName: "新暱稱" })).statusCode).toBe(200);
    expect(a.repo.userById(friend.id)!.display_name).toBe("新暱稱");
    expect((await adm(`/users/${friend.id}/logout`)).statusCode).toBe(200);
    expect((await call(a, friend.cookie, "GET", "/api/me")).statusCode).toBe(401);

    // 商場
    expect((await adm(`/malls/${id}/rename`, { name: "改名後" })).statusCode).toBe(200);
    expect(a.repo.mallById(id)!.name).toBe("改名後");
    expect((await adm(`/malls/${id}/funds`, { funds: 12_345_678 })).statusCode).toBe(200);
    expect((await adm(`/malls/${id}/funds`, { funds: Number.NaN })).statusCode).toBe(400);
    expect((await adm(`/malls/${id}/level`, { level: 5 })).statusCode).toBe(200);
    expect((await adm(`/malls/${id}/level`, { level: LEVELS.length + 1 })).statusCode).toBe(400);
    const st = (await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json();
    expect(st.funds).toBe(12_345_678);
    expect(st.level).toBe(5);
    expect((await adm(`/malls/${id}/clock`, { paused: true })).statusCode).toBe(200);
    expect((await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json().clock.holds.manual).toBe(true);
    expect((await adm(`/malls/${id}/notice`, { text: "管理者提醒：今晚十點維護" })).statusCode).toBe(200);
    expect((await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json().world.notices[0].text).toContain("今晚十點維護");

    // 成員
    expect((await adm(`/malls/${id}/members`, { userId: friend.id, role: "ops" })).statusCode).toBe(409); // 已經在了
    expect((await adm(`/malls/${id}/owner`, { userId: friend.id })).statusCode).toBe(200);
    expect(a.repo.members(id).find((m) => m.userId === friend.id)!.isOwner).toBe(true);
    expect(a.repo.members(id).find((m) => m.userId === owner.id)!.isOwner).toBe(false);
    expect((await adm(`/malls/${id}/members/${friend.id}/remove`)).statusCode).toBe(200); // 創辦人被移出：自動交棒
    expect(a.repo.members(id).map((m) => [m.userId, m.isOwner])).toEqual([[owner.id, true]]);
    expect((await adm(`/malls/${id}/members/${owner.id}/remove`)).statusCode).toBe(409); // 最後一位不能移
    expect((await adm(`/malls/${id}/members`, { userId: o.userId })).statusCode).toBe(400); // Overseer 不加入商場
    expect((await adm(`/malls/${id}/members`, { userId: friend.id, role: "ops" })).statusCode).toBe(200);
    expect(a.repo.members(id)).toHaveLength(2);

    const actions = a.repo.audit({ limit: 100 }).map((r) => r.action);
    for (const want of ["user.rename", "user.logout-all", "mall.rename", "mall.funds", "mall.level", "mall.clock", "mall.notice", "mall.owner", "mall.member-remove", "mall.member-add"]) {
      expect(actions, want).toContain(want);
    }
  });
});
