import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { buildApp, type BuildOptions } from "./app";

const T0 = Date.UTC(2026, 2, 2, 0, 0, 0); // 真實時間起點
const HOUR = 3_600_000;

type Built = ReturnType<typeof buildApp>;
const opened: Built[] = [];

interface MakeOpts {
  now?: () => number;
  dbPath?: string;
  config?: BuildOptions["config"];
}

function makeApp(opts: MakeOpts = {}) {
  const clock = { t: T0 };
  const b = buildApp({
    config: { dbPath: opts.dbPath ?? ":memory:", ...opts.config },
    now: opts.now ?? (() => clock.t),
  });
  opened.push(b);
  return { ...b, clock };
}
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});

type App = ReturnType<typeof makeApp>;

async function register(a: App, username: string, extra: Record<string, unknown> = {}) {
  const res = await a.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: "password123", ...extra },
  });
  const cookie = res.cookies.find((c) => c.name === "coidle_sid");
  return { res, cookie: cookie ? `coidle_sid=${cookie.value}` : "" };
}
const call = (a: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });

async function setupMall(a: App) {
  const owner = await register(a, "owner");
  const created = await call(a, owner.cookie, "POST", "/api/malls", { name: "測試商場" });
  const { id, inviteCode } = created.json();
  return { owner, id: id as number, inviteCode: inviteCode as string };
}

function waitFor(ws: WebSocket, pred: (m: any) => boolean, ms = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws timeout")), ms);
    const handler = (raw: unknown) => {
      const m = JSON.parse(String(raw));
      if (pred(m)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(m);
      }
    };
    ws.on("message", handler);
  });
}

describe("health", () => {
  it("responds", async () => {
    const a = makeApp();
    const res = await a.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});

describe("auth", () => {
  it("registers, returns me, rejects duplicates and weak passwords", async () => {
    const a = makeApp();
    const { res, cookie } = await register(a, "Alice", { displayName: "愛麗絲" });
    expect(res.statusCode).toBe(200);
    expect(cookie).not.toBe("");
    const me = (await call(a, cookie, "GET", "/api/me")).json();
    expect(me.user.displayName).toBe("愛麗絲");
    expect(me.malls).toEqual([]);
    expect((await register(a, "alice")).res.statusCode).toBe(409); // 不分大小寫
    const weak = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "bob", password: "123" } });
    expect(weak.statusCode).toBe(400);
  });

  it("requires login for protected routes", async () => {
    const a = makeApp();
    expect((await a.app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });

  it("logs in, rejects wrong password, throttles repeated failures", async () => {
    const a = makeApp();
    await register(a, "carol");
    const ok = await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "carol", password: "password123" } });
    expect(ok.statusCode).toBe(200);
    for (let i = 0; i < 8; i++) {
      const bad = await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "carol", password: "wrong-pass" } });
      expect(bad.statusCode).toBe(401);
    }
    const blocked = await a.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "carol", password: "password123" } });
    expect(blocked.statusCode).toBe(429);
  });

  it("logout invalidates the session", async () => {
    const a = makeApp();
    const { cookie } = await register(a, "dave");
    await call(a, cookie, "POST", "/api/auth/logout", {});
    expect((await call(a, cookie, "GET", "/api/me")).statusCode).toBe(401);
  });

  it("signup secret is enforced when configured", async () => {
    const a = makeApp({ config: { signupSecret: "open-sesame" } });
    expect((await register(a, "eve")).res.statusCode).toBe(403);
    expect((await register(a, "eve", { signupSecret: "open-sesame" })).res.statusCode).toBe(200);
  });
});

describe("malls, membership and commands", () => {
  it("creates a mall, lets a friend join by invite code, and blocks outsiders", async () => {
    const a = makeApp();
    const { owner, id, inviteCode } = await setupMall(a);
    const friend = await register(a, "friend");
    const outsider = await register(a, "outsider");

    expect((await call(a, friend.cookie, "GET", `/api/malls/${id}/state`)).statusCode).toBe(403);
    const joined = await call(a, friend.cookie, "POST", "/api/malls/join", { code: inviteCode.toLowerCase(), role: "dining" });
    expect(joined.statusCode).toBe(200);
    expect((await call(a, friend.cookie, "GET", `/api/malls/${id}/state`)).statusCode).toBe(200);
    expect((await call(a, outsider.cookie, "GET", `/api/malls/${id}/state`)).statusCode).toBe(403);
    expect((await call(a, friend.cookie, "POST", "/api/malls/join", { code: inviteCode })).statusCode).toBe(409);
    expect((await call(a, outsider.cookie, "POST", "/api/malls/join", { code: "ZZZZZZZZ" })).statusCode).toBe(404);

    const info = (await call(a, owner.cookie, "GET", `/api/malls/${id}`)).json();
    expect(info.members).toHaveLength(2);
    expect(info.inviteCode).toBe(inviteCode);
    expect((await call(a, friend.cookie, "GET", `/api/malls/${id}`)).json().inviteCode).toBeUndefined();
    expect((await call(a, friend.cookie, "POST", `/api/malls/${id}/invite/regenerate`, {})).statusCode).toBe(403);
    const regen = await call(a, owner.cookie, "POST", `/api/malls/${id}/invite/regenerate`, {});
    expect(regen.json().inviteCode).not.toBe(inviteCode);
  });

  it("enforces the member limit", async () => {
    const a = makeApp({ config: { maxMembers: 2 } });
    const { inviteCode } = await setupMall(a);
    const f1 = await register(a, "f1");
    const f2 = await register(a, "f2");
    expect((await call(a, f1.cookie, "POST", "/api/malls/join", { code: inviteCode })).statusCode).toBe(200);
    expect((await call(a, f2.cookie, "POST", "/api/malls/join", { code: inviteCode })).statusCode).toBe(409);
  });

  it("applies commands, rejects invalid ones, and records team activity", async () => {
    const a = makeApp();
    const { owner, id } = await setupMall(a);
    const state0 = (await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json();
    expect(state0.seed).toBeUndefined();
    const shop = state0.shops[0];

    const ok = await call(a, owner.cookie, "POST", `/api/malls/${id}/commands`, {
      command: { type: "setPrice", shopId: shop.id, price: shop.price + 100 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().shops[0].price).toBe(shop.price + 100);

    const bad = await call(a, owner.cookie, "POST", `/api/malls/${id}/commands`, { command: { type: "setHours", open: 10, close: 11 } });
    expect(bad.statusCode).toBe(422);
    expect((await call(a, owner.cookie, "POST", `/api/malls/${id}/commands`, { command: "oops" })).statusCode).toBe(400);
    expect((await call(a, owner.cookie, "POST", `/api/malls/${id}/commands`, { command: { type: "nuke" } })).statusCode).toBe(422);

    const feed = (await call(a, owner.cookie, "GET", `/api/malls/${id}/activity`)).json();
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toContain("調整了");
  });

  it("admin flag API is disabled without token and works with it", async () => {
    const a = makeApp({ config: { adminToken: "adm" } });
    const { owner, id } = await setupMall(a);
    const denied = await a.app.inject({ method: "POST", url: `/api/admin/malls/${id}/flags`, payload: { flag: "zone:f1", value: true } });
    expect(denied.statusCode).toBe(403);
    const ok = await a.app.inject({
      method: "POST",
      url: `/api/admin/malls/${id}/flags`,
      headers: { "x-admin-token": "adm" },
      payload: { flag: "zone:f1", value: true },
    });
    expect(ok.statusCode).toBe(200);
    const st = (await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json();
    expect(st.flags["zone:f1"]).toBe(true);

    const b = makeApp(); // 沒設 ADMIN_TOKEN：永遠拒絕，連空字串 token 都不行
    const none = await b.app.inject({
      method: "POST",
      url: "/api/admin/malls/1/flags",
      headers: { "x-admin-token": "" },
      payload: { flag: "zone:f1", value: true },
    });
    expect(none.statusCode).toBe(403);
  });
});

describe("offline progress", () => {
  it("the mall keeps earning while nobody is online", async () => {
    const a = makeApp();
    const { owner, id } = await setupMall(a);
    await call(a, owner.cookie, "POST", `/api/malls/${id}/clock`, { pauseOnEvents: false }); // 這個測試只看離線賺錢，不受隨機的暫停事件影響
    const before = (await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json();
    a.clock.t += 18 * HOUR; // 離線 18 真實小時 ＝ 3 個遊戲日
    a.service.tickAll(); // 排程
    const after = (await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json();
    expect(after.tick).toBeGreaterThan(before.tick + 288 * 2);
    expect(after.reports.length).toBeGreaterThanOrEqual(2);
    expect(after.funds).toBeGreaterThan(before.funds);
  });

  it("survives a server restart and catches up from the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coidle-"));
    const dbPath = join(dir, "t.db");
    try {
      let clockT = T0;
      const a1 = makeApp({ dbPath, now: () => clockT });
      const { owner, id } = await setupMall(a1);
      const cookie = owner.cookie;
      await call(a1, cookie, "POST", `/api/malls/${id}/clock`, { pauseOnEvents: false });
      const s1 = (await call(a1, cookie, "GET", `/api/malls/${id}/state`)).json();
      await a1.app.close();
      opened.pop();

      clockT += 12 * HOUR; // 伺服器停了 12 小時
      const a2 = makeApp({ dbPath, now: () => clockT });
      const s2 = (await call(a2, cookie, "GET", `/api/malls/${id}/state`)).json();
      expect(s2.tick).toBeGreaterThan(s1.tick + 288);
      expect(s2.funds).not.toBe(s1.funds);
    } finally {
      await Promise.all(opened.splice(0).map((b) => b.app.close()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("websocket", () => {
  it("rejects unauthenticated sockets", async () => {
    const a = makeApp();
    await setupMall(a);
    await a.app.ready();
    const ws = await a.app.injectWS("/ws?mall=1");
    const code = await new Promise<number>((r) => ws.on("close", (c) => r(c)));
    expect(code).toBe(4401);
  });

  it("pushes state to every member when one of them acts", async () => {
    const a = makeApp();
    const { owner, id, inviteCode } = await setupMall(a);
    const friend = await register(a, "friend");
    await call(a, friend.cookie, "POST", "/api/malls/join", { code: inviteCode });
    await a.app.ready();

    const wsOwner = await a.app.injectWS(`/ws?mall=${id}`, { headers: { cookie: owner.cookie } });
    const wsFriend = await a.app.injectWS(`/ws?mall=${id}`, { headers: { cookie: friend.cookie } });
    const snapshot = waitFor(wsFriend, (m) => m.type === "state");
    wsFriend.send(JSON.stringify({ type: "sync" })); // 要求一份快照（連線瞬間的那份可能早於監聽）
    await snapshot;

    const state = (await call(a, owner.cookie, "GET", `/api/malls/${id}/state`)).json();
    const shop = state.shops[0];
    const gotState = waitFor(wsFriend, (m) => m.type === "state" && m.state.shops[0].price === shop.price + 50);
    const gotActivity = waitFor(wsFriend, (m) => m.type === "activity");
    await call(a, owner.cookie, "POST", `/api/malls/${id}/commands`, {
      command: { type: "setPrice", shopId: shop.id, price: shop.price + 50 },
    });
    expect((await gotState).type).toBe("state");
    expect((await gotActivity).entry.text).toContain("調整了");
    wsOwner.terminate();
    wsFriend.terminate();
  });

  it("pushes a fresh state when the scheduler ticks while players are away", async () => {
    const a = makeApp();
    const { owner, id } = await setupMall(a);
    await a.app.ready();
    const ws = await a.app.injectWS(`/ws?mall=${id}`, { headers: { cookie: owner.cookie } });
    const firstP = waitFor(ws, (m) => m.type === "state");
    ws.send(JSON.stringify({ type: "sync" }));
    const first = await firstP;
    const next = waitFor(ws, (m) => m.type === "state" && m.state.tick > first.state.tick);
    a.clock.t += 2 * HOUR;
    a.service.tickAll();
    expect((await next).state.reports).toBeDefined();
    ws.terminate();
  });
});
