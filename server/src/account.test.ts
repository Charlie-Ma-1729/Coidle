import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { overseerLogin } from "./testutil";

const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
const make = () => {
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => Date.UTC(2026, 10, 24) });
  opened.push(b);
  return b;
};
type App = ReturnType<typeof make>;

async function reg(a: App, username: string, displayName = username) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName } });
  const c = res.cookies.find((x) => x.name === "coidle_sid");
  return `coidle_sid=${c!.value}`;
}
const post = (a: App, cookie: string, url: string, payload: unknown = {}) => {
  a.repo.vouchAllMembers(); // 不是在測股權變現門檻：成員先視為達標
  return a.app.inject({ method: "POST", url, headers: { cookie }, payload: payload as object });
};
const get = (a: App, cookie: string, url: string) => a.app.inject({ method: "GET", url, headers: { cookie } });

/** 離開商場前要先把股份處理掉：這裡用「請商場回購（撤資）」全部賣回去 */
async function settle(a: App, cookie: string, mallId: number) {
  const me = (await get(a, cookie, "/api/me")).json().user.id as number;
  const mine = (await get(a, cookie, `/api/malls/${mallId}/holdings`)).json().holders.find((h: { userId: number }) => h.userId === me);
  if (mine) expect((await post(a, cookie, `/api/malls/${mallId}/shares/buyback`, { shares: mine.shares })).statusCode).toBe(200);
}

async function team(a: App) {
  const owner = await reg(a, "owner", "創辦人");
  const { id, inviteCode } = (await post(a, owner, "/api/malls", { name: "測試商場" })).json();
  const friend = await reg(a, "friend", "朋友");
  await post(a, friend, "/api/malls/join", { code: inviteCode });
  const third = await reg(a, "third", "第三人");
  await post(a, third, "/api/malls/join", { code: inviteCode });
  const info = (await get(a, owner, `/api/malls/${id}`)).json();
  const uid = (name: string) => info.members.find((m: { displayName: string }) => m.displayName === name).userId as number;
  return { owner, friend, third, id: id as number, uid };
}

describe("profile and password", () => {
  it("changes the display name (and tells the team), and validates it", async () => {
    const a = make();
    const t = await team(a);
    expect((await post(a, t.friend, "/api/me/profile", { displayName: "" })).statusCode).toBe(400);
    const r = await post(a, t.friend, "/api/me/profile", { displayName: "新名字" });
    expect(r.json().displayName).toBe("新名字");
    expect((await get(a, t.friend, "/api/me")).json().user.displayName).toBe("新名字");
    expect((await get(a, t.owner, `/api/malls/${t.id}`)).json().members.some((m: { displayName: string }) => m.displayName === "新名字")).toBe(true);
  });

  it("changing the password needs the current one, logs other devices out, and the new password works", async () => {
    const a = make();
    const first = await reg(a, "carol");
    const other = (await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "carol", password: "password123" } })).cookies.find((c) => c.name === "coidle_sid")!;
    const second = `coidle_sid=${other.value}`;
    expect((await post(a, first, "/api/me/password", { current: "wrong-one", next: "newpassword1" })).statusCode).toBe(403);
    expect((await post(a, first, "/api/me/password", { current: "password123", next: "short" })).statusCode).toBe(400);
    expect((await post(a, first, "/api/me/password", { current: "password123", next: "password123" })).statusCode).toBe(400);
    expect((await post(a, first, "/api/me/password", { current: "password123", next: "newpassword1" })).statusCode).toBe(200);
    expect((await get(a, first, "/api/me")).statusCode).toBe(200); // 目前這個裝置保留
    expect((await get(a, second, "/api/me")).statusCode).toBe(401); // 其他裝置被登出
    const old = await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "carol", password: "password123" } });
    expect(old.statusCode).toBe(401);
    const fresh = await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "carol", password: "newpassword1" } });
    expect(fresh.statusCode).toBe(200);
  });

  it("throttles repeated wrong current-passwords", async () => {
    const a = make();
    const c = await reg(a, "dave");
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await post(a, c, "/api/me/password", { current: "nope-nope", next: "newpassword1" })).statusCode;
    expect(last).toBe(429);
  });
});

describe("team management", () => {
  it("only the founder can kick, transfer, and rename; members can leave", async () => {
    const a = make();
    const t = await team(a);
    expect((await post(a, t.friend, `/api/malls/${t.id}/members/${t.uid("第三人")}/kick`)).statusCode).toBe(403);
    expect((await post(a, t.friend, `/api/malls/${t.id}/transfer`, { userId: t.uid("朋友") })).statusCode).toBe(403);
    expect((await post(a, t.friend, `/api/malls/${t.id}/rename`, { name: "新名" })).statusCode).toBe(403);
    expect((await post(a, t.owner, `/api/malls/${t.id}/members/${t.uid("創辦人")}/kick`)).statusCode).toBe(400); // 不能踢自己

    expect((await post(a, t.owner, `/api/malls/${t.id}/rename`, { name: "新商場名" })).json().name).toBe("新商場名");
    const kicked = await post(a, t.owner, `/api/malls/${t.id}/members/${t.uid("第三人")}/kick`);
    expect(kicked.json().members.length).toBe(2);
    expect((await get(a, t.third, `/api/malls/${t.id}`)).statusCode).toBe(403); // 被請走後進不來

    // 帶著股份不能走：要先賣給其他股東或撤資
    expect((await post(a, t.friend, `/api/malls/${t.id}/leave`)).statusCode).toBe(409);
    await settle(a, t.friend, t.id);
    const left = await post(a, t.friend, `/api/malls/${t.id}/leave`);
    expect(left.json().dissolved).toBe(false);
    expect((await get(a, t.owner, `/api/malls/${t.id}`)).json().members.length).toBe(1);
  });

  it("the founder must transfer before leaving; after that they can leave and the new founder gets the invite code", async () => {
    const a = make();
    const t = await team(a);
    expect((await post(a, t.owner, `/api/malls/${t.id}/leave`)).statusCode).toBe(409);
    expect((await post(a, t.owner, `/api/malls/${t.id}/transfer`, { userId: 99999 })).statusCode).toBe(404);
    // 創辦人持股過半時，管事的是實際控制人（見 docs/equity.md）；先讓出一些股份、沒人過半，邀請碼才跟著創辦人頭銜走
    expect((await post(a, t.owner, `/api/malls/${t.id}/shares/transfer`, { userId: t.uid("朋友"), shares: 6000 })).statusCode).toBe(200); // 剩下的股份撤資時不會超過商場現金的一半
    expect((await post(a, t.owner, `/api/malls/${t.id}/transfer`, { userId: t.uid("朋友") })).statusCode).toBe(200);
    expect((await get(a, t.friend, `/api/malls/${t.id}`)).json().inviteCode).toBeTruthy();
    expect((await get(a, t.owner, `/api/malls/${t.id}`)).json().inviteCode).toBeUndefined();
    await settle(a, t.owner, t.id);
    expect((await post(a, t.owner, `/api/malls/${t.id}/leave`)).statusCode).toBe(200);
    expect((await get(a, t.owner, "/api/me")).json().malls).toEqual([]);
  });

  it("the last member leaving dissolves the mall", async () => {
    const a = make();
    const c = await reg(a, "solo");
    const { id } = (await post(a, c, "/api/malls", { name: "一個人的商場" })).json();
    expect((await post(a, c, `/api/malls/${id}/leave`)).json().dissolved).toBe(true);
    expect(a.repo.mallById(id)).toBeUndefined();
  });
});

describe("deleting an account", () => {
  it("needs the password, refuses while founding a mall with other members, and cleans up otherwise", async () => {
    const a = make();
    const t = await team(a);
    expect((await post(a, t.owner, "/api/me/delete", { password: "wrong-pw" })).statusCode).toBe(403);
    expect((await post(a, t.owner, "/api/me/delete", { password: "password123" })).statusCode).toBe(409);
    const gone = await post(a, t.friend, "/api/me/delete", { password: "password123" });
    expect(gone.statusCode).toBe(200);
    expect((await get(a, t.friend, "/api/me")).statusCode).toBe(401);
    expect((await get(a, t.owner, `/api/malls/${t.id}`)).json().members.length).toBe(2);
    expect(a.repo.userByName("friend")).toBeUndefined();
    const login = await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "friend", password: "password123" } });
    expect(login.statusCode).toBe(401);
  });
});

describe("admin: overview, password reset and deletion", () => {
  it("needs an Overseer login; lists users and malls; resets a password; deletes users and malls", async () => {
    const a = make();
    const t = await team(a);
    expect((await a.app.inject({ url: "/api/admin/overview" })).statusCode).toBe(401);
    expect((await a.app.inject({ url: "/api/admin/overview", headers: { cookie: t.owner } })).statusCode).toBe(403); // 一般玩家（連創辦人）也不行
    const H = (await overseerLogin(a)).headers;
    const ov = (await a.app.inject({ url: "/api/admin/overview", headers: H })).json();
    expect(ov.users.filter((u: { role: string }) => u.role === "player").length).toBe(3);
    expect(ov.malls[0]).toMatchObject({ id: t.id, members: 3, level: 1 });
    expect(JSON.stringify(ov)).not.toContain("pass_hash");

    const rp = await a.app.inject({ method: "POST", url: `/api/admin/users/${t.uid("朋友")}/reset-password`, headers: H });
    const temp = rp.json().tempPassword as string;
    expect(temp.length).toBeGreaterThanOrEqual(10);
    expect((await get(a, t.friend, "/api/me")).statusCode).toBe(401); // 舊的登入全部失效
    expect((await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "friend", password: temp } })).statusCode).toBe(200);
    expect((await a.app.inject({ method: "POST", url: "/api/admin/users/9999/reset-password", headers: H })).statusCode).toBe(404);

    // 強制刪除創辦人：創辦人轉給最早加入的其他成員
    const del = await a.app.inject({ method: "POST", url: `/api/admin/users/${t.uid("創辦人")}/delete`, headers: H });
    expect(del.statusCode).toBe(200);
    const after = a.repo.members(t.id);
    expect(after.length).toBe(2);
    expect(after.some((m) => m.isOwner)).toBe(true);

    expect((await a.app.inject({ method: "POST", url: `/api/admin/malls/${t.id}/delete`, headers: H })).statusCode).toBe(200);
    expect(a.repo.mallById(t.id)).toBeUndefined();
  });
});
