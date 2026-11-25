import { afterEach, describe, expect, it } from "vitest";
import { EVENT_BY_ID, WORLD_EPOCH_MS, weatherNow } from "@coidle/shared";
import { buildApp } from "./app";
import { overseerLogin } from "./testutil";

const DAY = 86_400_000;
const clock = { t: WORLD_EPOCH_MS + 3 * DAY };
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
function make() {
  clock.t = WORLD_EPOCH_MS + 3 * DAY;
  const b = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  opened.push(b);
  return b;
}
type App = ReturnType<typeof make>;
async function register(a: App, username: string) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", displayName: username } });
  return `coidle_sid=${res.cookies.find((x) => x.name === "coidle_sid")!.value}`;
}
const call = (a: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) => a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });

const festival = {
  title: "老街夏日祭典",
  text: "老街這個週末辦夏日祭典，攤販把人潮一路帶進商場，大家都忙得很開心。",
  category: "festival",
  options: [
    { label: "加開夜市攤位，歡迎來玩", effects: [{ t: "traffic", persona: "all", mult: 1.3, ticks: 72 }] },
    { label: "維持原樣，專心做生意", effects: [{ t: "index", which: "localRep", amount: 0.5 }] },
  ],
  weight: 2,
  cooldownDays: 30,
};

describe("Overseer-written random events", () => {
  it("accepts a one-sided festival event and a no-choice announcement (the AI rules don't apply), clamped and whitelisted", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t);
    const r = await call(a, o.cookie, "POST", "/api/admin/events", { event: festival });
    expect(r.statusCode).toBe(200);
    const def = EVENT_BY_ID[r.json().def.id]!;
    expect(def.id.startsWith("ov_")).toBe(true);
    expect(def).toMatchObject({ title: "老街夏日祭典", weight: 2, attention: "auto" });
    expect(def.cooldownTicks).toBe(288 * 30);
    expect(def.choice!.options).toHaveLength(2);

    const notice = await call(a, o.cookie, "POST", "/api/admin/events", { event: { title: "市政公告", text: "今天市政府公告道路施工，客流稍微受影響，請大家多包涵。", category: "crowd", effects: [{ t: "traffic", persona: "commuter", mult: 0.01, ticks: 99999 }] } });
    expect(notice.statusCode).toBe(200);
    const nd = EVENT_BY_ID[notice.json().def.id]!;
    expect(nd.choice).toBeUndefined();
    expect(nd.effects[0]).toMatchObject({ t: "traffic", mult: 0.8, ticks: 144 }); // 夾限
  });

  it("still refuses what is unsafe: unknown effects, simplified characters, real place names, bad shape, duplicates", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t);
    const bad = async (over: Record<string, unknown>) => (await call(a, o.cookie, "POST", "/api/admin/events", { event: { ...festival, ...over } })).statusCode;
    expect(await bad({ options: [{ label: "做一件怪事情吧", effects: [{ t: "giveAdmin" }] }, { label: "維持原樣就好了", effects: [{ t: "funds", amount: 1 }] }] })).toBe(400);
    expect(await bad({ text: "老街这個週末辦夏日祭典，攤販把人潮一路帶進商場，大家都忙得很開心。" })).toBe(400); // 簡體字「这」
    expect(await bad({ text: "大阪的老街這個週末辦夏日祭典，攤販把人潮一路帶進商場，大家都忙得很開心。" })).toBe(400);
    expect(await bad({ category: "weather" })).toBe(400);
    expect(await bad({ options: [festival.options[0]] })).toBe(400);
    expect((await call(a, o.cookie, "POST", "/api/admin/events", { event: festival })).statusCode).toBe(200);
    expect((await call(a, o.cookie, "POST", "/api/admin/events", { event: festival })).statusCode).toBe(400); // 一模一樣
  });

  it("players get the definition (so the card can render); retire makes it never happen again; activate brings it back", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t);
    const player = await register(a, "p1");
    const created = (await call(a, o.cookie, "POST", "/api/admin/events", { event: festival })).json();
    const pub = (await call(a, player, "GET", "/api/content/events")).json().events as { id: string; weight: number }[];
    expect(pub.find((e) => e.id === created.def.id)!.weight).toBe(2);

    expect((await call(a, o.cookie, "POST", `/api/admin/events/${created.id}/retire`)).statusCode).toBe(200);
    expect(EVENT_BY_ID[created.def.id]!.weight).toBe(0);
    expect((await call(a, o.cookie, "POST", `/api/admin/events/${created.id}/activate`)).statusCode).toBe(200);
    expect(EVENT_BY_ID[created.def.id]!.weight).toBe(2);
    expect((await call(a, o.cookie, "POST", `/api/admin/events/${created.id}/activate`)).statusCode).toBe(400);

    const list = (await call(a, o.cookie, "GET", "/api/admin/events")).json();
    expect(list.events.some((e: { model: string }) => e.model === "overseer")).toBe(true);
    expect(list.catalog.some((e: { source: string }) => e.source === "builtin")).toBe(true);
    expect((await call(a, player, "POST", "/api/admin/events", { event: festival })).statusCode).toBe(403);
  });

  it("can fire any event at chosen malls or at every real mall — never at the test mall unless it is named", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t);
    const p1 = await register(a, "p1");
    const p2 = await register(a, "p2");
    const m1 = (await call(a, p1, "POST", "/api/malls", { name: "一號" })).json().id as number;
    const m2 = (await call(a, p2, "POST", "/api/malls", { name: "二號" })).json().id as number;
    const box = a.service.adminMakeSandbox(o.userId).mallId;
    const created = (await call(a, o.cookie, "POST", "/api/admin/events", { event: festival })).json();
    const id = created.def.id as string;
    const pendingOf = (mall: number) => a.service.sync(mall).pending.filter((x) => x.defId === id).length;

    expect((await call(a, o.cookie, "POST", "/api/admin/events/trigger", { eventId: id, malls: [m1] })).json().sent).toBe(1);
    expect([pendingOf(m1), pendingOf(m2), pendingOf(box)]).toEqual([1, 0, 0]);
    expect((await call(a, o.cookie, "POST", "/api/admin/events/trigger", { eventId: id, malls: "all" })).json().sent).toBe(2); // 不含測試商場
    expect(pendingOf(m2)).toBe(1);
    expect(pendingOf(box)).toBe(0);
    expect((await call(a, o.cookie, "POST", "/api/admin/events/trigger", { eventId: id, malls: [box] })).json().sent).toBe(1); // 點名才會送去測試商場
    expect(pendingOf(box)).toBe(1);

    // 內建事件也可以觸發；找不到的事件與格式錯誤都擋掉
    const builtin = a.service.sync(m1) && (await call(a, o.cookie, "GET", "/api/admin/events")).json().catalog.find((e: { source: string; hasChoice: boolean }) => e.source === "builtin" && e.hasChoice).id;
    expect((await call(a, o.cookie, "POST", "/api/admin/events/trigger", { eventId: builtin, malls: [m1] })).statusCode).toBe(200);
    expect((await call(a, o.cookie, "POST", "/api/admin/events/trigger", { eventId: "nope_nope", malls: [m1] })).statusCode).toBe(404);
    expect((await call(a, o.cookie, "POST", "/api/admin/events/trigger", { eventId: id, malls: [] })).statusCode).toBe(400);
    expect(a.repo.audit({ limit: 50 }).some((r) => r.action === "event.trigger")).toBe(true);
  });
});

describe("Overseer weather", () => {
  it("sets the weather everywhere (except the test mall) or in named malls, for a chosen length; the sim reads it", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t);
    const p1 = await register(a, "p1");
    const m1 = (await call(a, p1, "POST", "/api/malls", { name: "一號" })).json().id as number;
    const box = a.service.adminMakeSandbox(o.userId).mallId;

    const r = await call(a, o.cookie, "POST", "/api/admin/weather", { kind: "storm", temp: 24, hours: 10, malls: "all" });
    expect(r.json().sent).toBe(1);
    const s = a.service.sync(m1);
    expect(weatherNow(s)).toMatchObject({ kind: "storm", temp: 24 });
    const mod = s.modifiers.find((m) => m.kind === "weather")!;
    expect("endTick" in mod && mod.endTick - s.tick).toBeGreaterThanOrEqual(119);
    expect(s.world.notices[0]!.text).toContain("暴風雨");
    expect(weatherNow(a.service.sync(box)).kind).not.toBe("storm"); // 測試商場沒有被波及

    expect((await call(a, o.cookie, "POST", "/api/admin/weather", { kind: "clear", temp: 36, hours: 6, malls: [m1, box] })).json().sent).toBe(2);
    expect(weatherNow(a.service.sync(m1))).toMatchObject({ kind: "clear", temp: 36 }); // 取代原本的天氣
    expect(weatherNow(a.service.sync(box)).kind).toBe("clear");

    expect((await call(a, o.cookie, "POST", "/api/admin/weather", { kind: "meteor", malls: "all" })).statusCode).toBe(400);
    expect((await call(a, o.cookie, "POST", "/api/admin/weather", { kind: "rain", malls: [] })).statusCode).toBe(400);
    expect((await call(a, p1, "POST", "/api/admin/weather", { kind: "rain", malls: "all" })).statusCode).toBe(403);
    expect(a.repo.audit({ limit: 20, action: "weather.set" })).toHaveLength(2);
  });

  it("the weather runs out on time", async () => {
    const a = make();
    const o = await overseerLogin(a, clock.t);
    const p1 = await register(a, "p1");
    const m1 = (await call(a, p1, "POST", "/api/malls", { name: "一號" })).json().id as number;
    await call(a, o.cookie, "POST", "/api/admin/weather", { kind: "storm", temp: 20, hours: 2, malls: [m1] });
    expect(weatherNow(a.service.sync(m1)).kind).toBe("storm");
    clock.t += 3 * 3_600_000; // 2 遊戲小時 ≈ 30 真實分鐘（標準流速），3 小時一定過了
    a.service.tickAll();
    expect(a.service.sync(m1).modifiers.some((m) => m.kind === "weather")).toBe(false);
  });
});
