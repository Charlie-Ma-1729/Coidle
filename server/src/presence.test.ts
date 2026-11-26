import { afterEach, describe, expect, it } from "vitest";
import { WORLD_EPOCH_MS } from "@coidle/shared";
import { buildApp } from "./app";

const clock = { t: WORLD_EPOCH_MS + 86_400_000 + 3 * 3_600_000 };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + 86_400_000 + 3 * 3_600_000;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;

async function register(a: App, username: string) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName: username } });
  const c = res.cookies.find((x) => x.name === "coidle_sid");
  return { cookie: `coidle_sid=${c!.value}`, id: a.repo.userByName(username)!.id };
}
const call = (a: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) => a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });
const wait = () => new Promise((r) => setTimeout(r, 30));
const membersOf = (a: App, cookie: string, id: number) => call(a, cookie, "GET", `/api/malls/${id}`).then((r) => r.json().members as { userId: number; online?: boolean; lastActiveAt?: number }[]);

describe("成員在場紀錄（只算連著這座商場）", () => {
  it("連上這座商場才算在場；斷線後留下「上次在場」；連著別座商場不算", async () => {
    const a = make();
    const p = await register(a, "p1");
    const q = await register(a, "p2");
    const m1 = (await call(a, p.cookie, "POST", "/api/malls", { name: "商場一" })).json().id as number;
    const code = (await call(a, p.cookie, "GET", `/api/malls/${m1}`)).json().inviteCode as string;
    expect((await call(a, q.cookie, "POST", "/api/malls/join", { code, role: "dining" })).statusCode).toBe(200);
    await a.app.ready();

    let rows = await membersOf(a, p.cookie, m1);
    expect(rows.find((m) => m.userId === q.id)).toMatchObject({ online: false, lastActiveAt: 0 });

    // q 連上自己的另一座商場：在商場一仍然不算在場
    const m2 = (await call(a, q.cookie, "POST", "/api/malls", { name: "商場二" })).json().id as number;
    const other = await a.app.injectWS(`/ws?mall=${m2}`, { headers: { cookie: q.cookie } });
    rows = await membersOf(a, p.cookie, m1);
    expect(rows.find((m) => m.userId === q.id)).toMatchObject({ online: false, lastActiveAt: 0 });

    // 連上商場一
    clock.t += 5_000;
    const ws = await a.app.injectWS(`/ws?mall=${m1}`, { headers: { cookie: q.cookie } });
    rows = await membersOf(a, p.cookie, m1);
    expect(rows.find((m) => m.userId === q.id)).toMatchObject({ online: true, lastActiveAt: clock.t });
    const ws2 = await a.app.injectWS(`/ws?mall=${m1}`, { headers: { cookie: q.cookie } }); // 第二個分頁
    ws.terminate();
    await wait();
    expect((await membersOf(a, p.cookie, m1)).find((m) => m.userId === q.id)?.online).toBe(true); // 還有一個分頁連著

    clock.t += 60_000;
    ws2.terminate();
    await wait();
    rows = await membersOf(a, p.cookie, m1);
    expect(rows.find((m) => m.userId === q.id)).toMatchObject({ online: false, lastActiveAt: clock.t });
    other.terminate();
    await wait();
  });

  it("自己連上就顯示在場", async () => {
    const a = make();
    const p = await register(a, "p1");
    const m1 = (await call(a, p.cookie, "POST", "/api/malls", { name: "商場一" })).json().id as number;
    await a.app.ready();
    const ws = await a.app.injectWS(`/ws?mall=${m1}`, { headers: { cookie: p.cookie } });
    expect((await membersOf(a, p.cookie, m1)).find((m) => m.userId === p.id)?.online).toBe(true);
    ws.terminate();
    await wait();
  });
});
