import { afterEach, describe, expect, it } from "vitest";
import { WORLD_EPOCH_MS } from "@coidle/shared";
import { buildApp, type BuildOptions } from "./app";
import { createOverseer, rotateOverseerKey } from "./auth/overseer";
import { overseerLogin } from "./testutil";

const DAY = 86_400_000;
const clock = { t: WORLD_EPOCH_MS + DAY };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make(opts: Partial<BuildOptions> = {}) {
  clock.t = WORLD_EPOCH_MS + DAY;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t, ...opts });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;

async function register(a: App, username: string, displayName = username) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName } });
  const c = res.cookies.find((x) => x.name === "coidle_sid");
  return { res, cookie: c ? `coidle_sid=${c.value}` : "" };
}
const call = (a: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) => a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });

describe("Overseer login by key", () => {
  it("logs in with the key only; the password route and a wrong key are refused", async () => {
    const a = make();
    const { key } = await createOverseer(a.repo, clock.t);
    const bad = await a.app.inject({ method: "POST", url: "/api/auth/overseer", payload: { key: "ovs_" + "x".repeat(43) } });
    expect(bad.statusCode).toBe(401);
    const viaPassword = await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "overseer", password: key } });
    expect(viaPassword.statusCode).toBe(401); // 金鑰不能當密碼用
    const ok = await a.app.inject({ method: "POST", url: "/api/auth/overseer", payload: { key } });
    expect(ok.statusCode).toBe(200);
    const cookie = `coidle_sid=${ok.cookies.find((c) => c.name === "coidle_sid")!.value}`;
    const me = (await call(a, cookie, "GET", "/api/me")).json();
    expect(me.user).toMatchObject({ username: "overseer", role: "overseer" });
  });

  it("locks out repeated wrong keys from the same address, and records every attempt", async () => {
    const a = make();
    const { key } = await createOverseer(a.repo, clock.t);
    for (let i = 0; i < 5; i++) expect((await a.app.inject({ method: "POST", url: "/api/auth/overseer", payload: { key: "ovs_" + "y".repeat(43) } })).statusCode).toBe(401);
    expect((await a.app.inject({ method: "POST", url: "/api/auth/overseer", payload: { key } })).statusCode).toBe(429);
    const actions = a.repo.audit({ limit: 50 }).map((r) => r.action);
    expect(actions.filter((x) => x === "overseer.login.fail")).toHaveLength(5);
    expect(actions).toContain("overseer.login.blocked");
  });

  it("rotating the key kills the old key and every old login; the key never appears in the audit log", async () => {
    const a = make();
    const o = await overseerLogin(a);
    expect((await call(a, o.cookie, "GET", "/api/admin/overview")).statusCode).toBe(200);
    const fresh = await rotateOverseerKey(a.repo, "overseer");
    expect((await call(a, o.cookie, "GET", "/api/admin/overview")).statusCode).toBe(401);
    expect((await a.app.inject({ method: "POST", url: "/api/auth/overseer", payload: { key: o.key } })).statusCode).toBe(401);
    expect((await a.app.inject({ method: "POST", url: "/api/auth/overseer", payload: { key: fresh.key } })).statusCode).toBe(200);
    const dump = JSON.stringify(a.repo.audit({ limit: 100 }));
    expect(dump).not.toContain(o.key);
    expect(dump).not.toContain(fresh.key);
  });

  it("the reserved account names can't be registered, and an Overseer can't change a password or delete the account", async () => {
    const a = make();
    expect((await register(a, "Overseer")).res.statusCode).toBe(400);
    expect((await register(a, "admin")).res.statusCode).toBe(400);
    const o = await overseerLogin(a);
    expect((await call(a, o.cookie, "POST", "/api/me/password", { current: "x", next: "password456" })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "POST", "/api/me/delete", { password: "x" })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "POST", `/api/admin/users/${o.userId}/delete`)).statusCode).toBe(400);
    expect((await call(a, o.cookie, "POST", `/api/admin/users/${o.userId}/reset-password`)).statusCode).toBe(400);
  });
});

describe("audit log", () => {
  it("writes who did what to the database and the server console; secrets are masked; denied attempts are kept", async () => {
    const lines: string[] = [];
    const a = make({ auditSink: (l) => lines.push(l) });
    const player = await register(a, "player1", "玩家");
    const { id } = (await call(a, player.cookie, "POST", "/api/malls", { name: "測試" })).json();
    // 一般玩家打管理 API：擋掉並留下紀錄
    expect((await call(a, player.cookie, "POST", `/api/admin/malls/${id}/flags`, { flag: "zone:f1", value: true })).statusCode).toBe(403);
    const o = await overseerLogin(a);
    expect((await call(a, o.cookie, "POST", `/api/admin/malls/${id}/flags`, { flag: "zone:f1", value: true })).statusCode).toBe(200);
    const uid = a.repo.userByName("player1")!.id;
    const rp = await call(a, o.cookie, "POST", `/api/admin/users/${uid}/reset-password`);
    const temp = rp.json().tempPassword as string;

    const rows = a.repo.audit({ limit: 50 });
    const flag = rows.find((r) => r.action === "mall.flag")!;
    expect(flag).toMatchObject({ actor_name: "overseer", target: `mall#${id}` });
    expect(JSON.parse(flag.detail)).toMatchObject({ flag: "zone:f1", value: true, status: 200 });
    expect(rows.some((r) => r.action === "admin.denied" && r.actor_name === "player1")).toBe(true);
    expect(rows.some((r) => r.action === "user.reset-password" && r.target.startsWith(`user#${uid}`))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(temp);

    expect(lines.some((l) => l.startsWith("[audit]") && l.includes("overseer(#") && l.includes("mall.flag") && l.includes(`mall#${id}`))).toBe(true);
    expect(lines.join("\n")).not.toContain(temp);

    const list = (await call(a, o.cookie, "GET", "/api/admin/audit?limit=5")).json().entries as { action: string; actor: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.actor).toBeTruthy();
    const filtered = (await call(a, o.cookie, "GET", "/api/admin/audit?action=mall.")).json().entries as { action: string }[];
    expect(filtered.every((e) => e.action.startsWith("mall."))).toBe(true);
  });

  it("failed admin actions are logged with .failed and the status", async () => {
    const a = make();
    const o = await overseerLogin(a);
    expect((await call(a, o.cookie, "POST", "/api/admin/users/9999/reset-password")).statusCode).toBe(404);
    const row = a.repo.audit({ limit: 5 }).find((r) => r.action.startsWith("http."));
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.detail).status).toBe(404);
  });
});

describe("test mall: independent from the world, owned by the Overseer", () => {
  async function setup() {
    const a = make();
    const charlie = await register(a, "CharlieMa", "CharlieMa");
    const cid = a.repo.userByName("CharlieMa")!.id;
    const other = await register(a, "buddy", "朋友");
    const { id: realId } = (await call(a, other.cookie, "POST", "/api/malls", { name: "真實商場" })).json();
    const mall = a.service.adminCreateTestMall(cid, "測試全開商場");
    const o = await overseerLogin(a);
    return { a, charlie, cid, other, realId: realId as number, testId: mall.mallId, inviteCode: mall.inviteCode, o };
  }

  it("transfers ownership to the Overseer and removes the old owner", async () => {
    const { a, cid, testId, o, charlie } = await setup();
    const r = a.service.adminMakeSandbox(o.userId, testId);
    expect(r).toMatchObject({ mallId: testId, created: false, removed: ["CharlieMa"] });
    const members = a.repo.members(testId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: o.userId, isOwner: true });
    expect(a.repo.member(testId, cid)).toBeUndefined();
    expect((await call(a, charlie.cookie, "GET", `/api/malls/${testId}/state`)).statusCode).toBe(403);
    expect((await call(a, o.cookie, "GET", `/api/malls/${testId}/state`)).statusCode).toBe(200);
    const me = (await call(a, o.cookie, "GET", "/api/me")).json();
    expect(me.malls.map((m: { id: number }) => m.id)).toContain(testId);
  });

  it("never shows up in the directory, rankings or season rewards, and the real malls are untouched", async () => {
    const { a, testId, realId, o } = await setup();
    a.service.adminMakeSandbox(o.userId, testId);
    clock.t += 3 * 3_600_000;
    a.service.tickAll();
    const keys = a.service.world.entries().map((e) => e.key);
    expect(keys).toContain(`m:${realId}`);
    expect(keys).not.toContain(`m:${testId}`);
    expect(a.repo.directoryRows().some((r) => r.mall_id === testId)).toBe(false);
    // 賽季結算也不會把它列進排名
    clock.t += 40 * DAY;
    a.service.tickAll();
    const ranked = a.repo.latestSeasons(5).flatMap((s) => (JSON.parse(s.result_json) as { ranking: { key: string }[] }).ranking.map((r) => r.key));
    expect(ranked).not.toContain(`m:${testId}`);
  });

  it("can't ally, trade, poach or be joined by invite code", async () => {
    const { a, testId, realId, o, inviteCode, other } = await setup();
    a.service.adminMakeSandbox(o.userId, testId);
    const base = `/api/malls/${testId}/world`;
    expect((await call(a, o.cookie, "POST", `${base}/alliance`, { target: `m:${realId}` })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "POST", `${base}/compete`, { target: `m:${realId}`, persona: "tourist" })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "POST", `${base}/trade/funds`, { target: `m:${realId}`, amount: 100000 })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "GET", `${base}/alliances`)).statusCode).toBe(200); // 只讀的清單仍可看
    expect((await call(a, other.cookie, "POST", "/api/malls/join", { code: inviteCode })).statusCode).toBe(403);
    // 反方向：真人商場也找不到它
    const real = `/api/malls/${realId}/world`;
    expect((await call(a, other.cookie, "POST", `${real}/alliance`, { target: `m:${testId}` })).statusCode).toBe(404);
  });

  it("a freshly created sandbox is fully unlocked and owned by the Overseer from the start", async () => {
    const a = make();
    const o = await overseerLogin(a);
    const r = a.service.adminMakeSandbox(o.userId);
    expect(r.created).toBe(true);
    expect(a.repo.isSandbox(r.mallId)).toBe(true);
    expect(a.repo.members(r.mallId).map((m) => m.userId)).toEqual([o.userId]);
    const st = (await call(a, o.cookie, "GET", `/api/malls/${r.mallId}/state`)).json();
    expect(st.level).toBe(8);
    expect(a.service.world.entries().some((e) => e.key === `m:${r.mallId}`)).toBe(false);
  });
});

describe("a mall the Overseer opens through the normal create endpoint", () => {
  it("is a sandbox from the start: not in the directory, not in the world, and audited", async () => {
    const a = make();
    const o = await overseerLogin(a);
    const res = await call(a, o.cookie, "POST", "/api/malls", { name: "管理者的商場" });
    expect(res.statusCode).toBe(200);
    const { id, sandbox } = res.json();
    expect(sandbox).toBe(true);
    expect(a.repo.isSandbox(id)).toBe(true);
    expect(a.repo.directoryRows().some((r) => r.mall_id === id)).toBe(false);
    expect(a.service.world.entries().some((e) => e.key === `m:${id}`)).toBe(false);
    expect(a.repo.members(id).map((m) => m.userId)).toEqual([o.userId]);
    expect(a.repo.audit({ limit: 20 }).some((r) => r.action === "mall.sandbox" && r.target === `mall#${id}`)).toBe(true);
  });

  it("a player's mall is still a normal, public one", async () => {
    const a = make();
    const p = await register(a, "normie", "一般玩家");
    const res = await call(a, p.cookie, "POST", "/api/malls", { name: "一般商場" });
    const { id, sandbox } = res.json();
    expect(sandbox).toBe(false);
    expect(a.repo.isSandbox(id)).toBe(false);
    expect(a.repo.directoryRows().some((r) => r.mall_id === id)).toBe(true);
  });
});

describe("one player, several malls", () => {
  it("a player can run two malls at once; commands and the member lists stay separate", async () => {
    const a = make();
    const p = await register(a, "multi", "分身");
    const m1 = (await call(a, p.cookie, "POST", "/api/malls", { name: "一號店" })).json().id as number;
    // 第一座商場用免費的起始資金；第二座要自己出資（從個人錢包）
    expect((await call(a, p.cookie, "POST", "/api/malls", { name: "二號店" })).statusCode).toBe(402);
    a.repo.addCash((await call(a, p.cookie, "GET", "/api/me")).json().user.id, 2_000_000);
    const m2 = (await call(a, p.cookie, "POST", "/api/malls", { name: "二號店" })).json().id as number;
    const me = (await call(a, p.cookie, "GET", "/api/me")).json();
    expect(me.malls.map((m: { id: number }) => m.id)).toEqual([m1, m2]);
    const s1 = (await call(a, p.cookie, "GET", `/api/malls/${m1}/state`)).json();
    const fundsBefore2 = (await call(a, p.cookie, "GET", `/api/malls/${m2}/state`)).json().funds as number;
    const shop = s1.shops[0];
    const before2 = (await call(a, p.cookie, "GET", `/api/malls/${m2}/state`)).json();
    const res = await call(a, p.cookie, "POST", `/api/malls/${m1}/commands`, { command: { type: "setPrice", shopId: shop.id, price: shop.price + 20 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().shops[0].price).toBe(shop.price + 20);
    const after2 = (await call(a, p.cookie, "GET", `/api/malls/${m2}/state`)).json();
    expect(after2.funds).toBe(fundsBefore2);
    expect(after2.shops[0].price).toBe(before2.shops[0].price);
    expect((await call(a, p.cookie, "GET", `/api/malls/${m1}`)).json().members).toHaveLength(1);
  });
});

describe("spectating (read-only)", () => {
  async function mall(a: App) {
    const owner = await register(a, "owner1", "創辦人");
    const { id } = (await call(a, owner.cookie, "POST", "/api/malls", { name: "被旁觀的商場" })).json();
    return { owner, id: id as number };
  }

  it("the Overseer can read any mall, can't act in it, and doesn't count as being present", async () => {
    const a = make();
    const { owner, id } = await mall(a);
    const stranger = await register(a, "stranger");
    const o = await overseerLogin(a);
    expect((await call(a, stranger.cookie, "GET", `/api/malls/${id}/state`)).statusCode).toBe(403);

    const shop = (await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json().shops[0];
    const visit0 = a.service.sync(id).clock.lastVisitRealMs;
    clock.t += 2 * 3_600_000;
    const st = await call(a, o.cookie, "GET", `/api/malls/${id}/state`);
    expect(st.statusCode).toBe(200);
    expect(a.service.sync(id).clock.lastVisitRealMs).toBe(visit0); // 旁觀不算「有人來過」
    const info = (await call(a, o.cookie, "GET", `/api/malls/${id}`)).json();
    expect(info.inviteCode).toBeUndefined();
    expect(info.members).toHaveLength(1);
    expect((await call(a, o.cookie, "GET", `/api/malls/${id}/activity`)).statusCode).toBe(200);
    expect((await call(a, o.cookie, "GET", `/api/malls/${id}/world/alliances`)).statusCode).toBe(200);

    // 只能看：所有會改變商場的操作都拒絕
    expect((await call(a, o.cookie, "POST", `/api/malls/${id}/commands`, { command: { type: "setPrice", shopId: shop.id, price: shop.price + 10 } })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "POST", `/api/malls/${id}/clock`, { paused: true })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "POST", `/api/malls/${id}/world/alliance`, { target: "n:harbor" })).statusCode).toBe(403);
    expect((await call(a, o.cookie, "POST", `/api/malls/${id}/leave`)).statusCode).toBe(403);

    // 稽核紀錄：旁觀只記一次（10 分鐘內重複打開不洗版）
    expect(a.repo.audit({ limit: 50, action: "spectate" }).filter((r) => r.target === `mall#${id}`)).toHaveLength(1);
    clock.t += 11 * 60_000;
    await call(a, o.cookie, "GET", `/api/malls/${id}/state`);
    expect(a.repo.audit({ limit: 50, action: "spectate" })).toHaveLength(2);
  });

  it("a spectator socket gets the state but is not counted as someone present; a normal player can't spectate", async () => {
    const a = make();
    const { owner, id } = await mall(a);
    const stranger = await register(a, "stranger");
    const o = await overseerLogin(a);
    await a.app.ready();
    const connections = () => (a.service as unknown as { connections: Map<number, number> }).connections.get(id) ?? 0;

    const ws = await a.app.injectWS(`/ws?mall=${id}&spectate=1`, { headers: { cookie: o.cookie } });
    const got = new Promise<{ type: string }>((resolve) => ws.on("message", (raw: unknown) => resolve(JSON.parse(String(raw)))));
    ws.send(JSON.stringify({ type: "sync" }));
    expect((await got).type).toBe("state");
    expect(connections()).toBe(0);

    const bad = await a.app.injectWS(`/ws?mall=${id}&spectate=1`, { headers: { cookie: stranger.cookie } });
    expect(await new Promise<number>((r) => bad.on("close", (c: number) => r(c)))).toBe(4403);

    const real = await a.app.injectWS(`/ws?mall=${id}`, { headers: { cookie: owner.cookie } });
    expect(connections()).toBe(1);
    real.terminate();
    ws.terminate();
  });
});
