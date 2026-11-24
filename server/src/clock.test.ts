import { describe, expect, it } from "vitest";
import {
  EVENT_BY_ID,
  PRESENCE_WINDOW_MS,
  SPEED_PRESETS,
  TICKS_PER_DAY,
  TICK_MINUTES,
  effectiveSpeed,
  isPaused,
  newClock,
  realMsAtTick,
  tickAt,
  type MallClock,
} from "@coidle/shared";
import { buildApp } from "./app";
import { advanceTo, applyCommand, createInitialState, migrateState, stepTick } from "./sim";

const HOUR = 3_600_000;
const TICK_MS = TICK_MINUTES * 60_000;
const T0 = Date.UTC(2027, 7, 20, 0, 0, 0); // 真實時間起點
// 遊戲時間在 8 月（颱風季）才有 typhoon_warning 事件
const AUG = (Date.UTC(2027, 7, 1) - 9 * HOUR) / TICK_MS;

describe("clock math", () => {
  it("runs at 4x by default: 6 real hours = 1 game day", () => {
    const c = newClock(0, 1000);
    expect(tickAt(c, 6 * HOUR)).toBe(1000 + TICKS_PER_DAY);
    expect(tickAt(c, 0)).toBe(1000);
  });

  it("each speed preset maps to the documented real hours per game day", () => {
    for (const p of SPEED_PRESETS) {
      const c: MallClock = { ...newClock(0, 0), speed: p.mult };
      expect(tickAt(c, p.realHoursPerDay * HOUR)).toBe(TICKS_PER_DAY);
    }
  });

  it("any hold freezes the clock; the effective speed is 0", () => {
    for (const holds of [{ manual: true }, { idle: true }, { events: ["ev1"] }]) {
      const c = newClock(0, 50);
      Object.assign(c.holds, holds);
      expect(isPaused(c)).toBe(true);
      expect(effectiveSpeed(c)).toBe(0);
      expect(tickAt(c, 100 * HOUR)).toBe(50);
    }
  });

  it("never goes backwards for a clock reading before its anchor", () => {
    const c = newClock(1000, 50);
    expect(tickAt(c, 0)).toBe(50);
  });

  it("realMsAtTick inverts tickAt on a running clock", () => {
    const c: MallClock = { ...newClock(5_000, 100), speed: 0.5 };
    const ms = realMsAtTick(c, 100 + 288);
    expect(tickAt(c, ms)).toBe(100 + 288);
  });
});

describe("event pause in the sim", () => {
  /** 找到會讓颱風事件發生的 seed（8 月、沒人在場） */
  function runUntilTyphoon(nobodyPresent: boolean, pauseOnEvents = true) {
    for (let seed = 1; seed < 40; seed++) {
      const s = createInitialState(seed, AUG, 0);
      s.clock.pauseOnEvents = pauseOnEvents;
      for (let i = 0; i < TICKS_PER_DAY * 40; i++) {
        const halted = stepTick(s, { nobodyPresent });
        if (s.pending.some((p) => p.defId === "typhoon_warning")) return { s, halted };
      }
    }
    throw new Error("no typhoon event found");
  }

  it("halts the clock when a pause-flagged event fires and nobody is present", () => {
    const { s, halted } = runUntilTyphoon(true);
    expect(halted).toBe(true);
    const uid = s.pending.find((p) => p.defId === "typhoon_warning")!.uid;
    expect(s.clock.holds.events).toContain(uid);
    expect(isPaused(s.clock)).toBe(true);
  });

  it("does not halt when someone is present, or when the setting is off", () => {
    expect(runUntilTyphoon(false).halted).toBe(false);
    const off = runUntilTyphoon(true, false);
    expect(off.halted).toBe(false);
    expect(isPaused(off.s.clock)).toBe(false);
  });

  it("advanceTo stops at the event tick and re-anchors at the real moment it happened", () => {
    let found: { seed: number; start: ReturnType<typeof createInitialState> } | null = null;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const start = createInitialState(seed, AUG, 0);
      const probe = advanceTo(start, AUG + TICKS_PER_DAY * 40, { nobodyPresent: true });
      if (probe.clock.holds.events.length > 0) found = { seed, start };
    }
    expect(found).not.toBeNull();
    const target = AUG + TICKS_PER_DAY * 40;
    const out = advanceTo(found!.start, target, { nobodyPresent: true });
    expect(out.tick).toBeLessThan(target);
    expect(out.clock.anchorTick).toBe(out.tick);
    // 錨點的真實時間 = 依暫停前的時鐘推算出的「事件發生那一刻」
    expect(out.clock.anchorRealMs).toBeCloseTo(realMsAtTick(found!.start.clock, out.tick), 0);
  });

  it("resolving the event releases the hold; all pending events must be resolved", () => {
    const { s } = runUntilTyphoon(true);
    const uid = s.pending.find((p) => p.defId === "typhoon_warning")!.uid;
    const def = EVENT_BY_ID.typhoon_warning!;
    const r = applyCommand(s, { type: "resolveEvent", uid, optionId: def.choice!.options[0]!.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.clock.holds.events).toEqual([]);
      expect(isPaused(r.state.clock)).toBe(false);
    }
    // 「全部採預設」同樣會解除
    const r2 = applyCommand(s, { type: "resolveAllDefault" });
    expect(r2.ok && r2.state.clock.holds.events).toEqual([]);
  });

  it("migrates a v1 state all the way up, with a clock and no protection fields", () => {
    const v1 = { ...createInitialState(1, 1000, 0), version: 1, protection: true, lastActionTick: 5 } as Record<string, unknown>;
    delete v1.clock;
    const m = migrateState(v1, 123_456);
    expect(m.version).toBe(8);
    expect(m.clock.anchorTick).toBe(1000);
    expect(m.clock.anchorRealMs).toBe(123_456);
    expect("protection" in m).toBe(false);
    expect("lastActionTick" in m).toBe(false);
  });
});

// ───────── 整合：服務層 + API ─────────

type Built = ReturnType<typeof buildApp>;
const opened: Built[] = [];

function makeApp(extra: Parameters<typeof buildApp>[0] = {}) {
  const clock = { t: T0 };
  const sent: { endpoint: string; payload: string }[] = [];
  const b = buildApp({
    config: { dbPath: ":memory:" },
    now: () => clock.t,
    pushSender: async (target, payload) => void sent.push({ endpoint: target.endpoint, payload }),
    ...extra,
  });
  opened.push(b);
  return { ...b, clock, sent };
}

async function login(a: ReturnType<typeof makeApp>, username: string) {
  const res = await a.app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123" } });
  const c = res.cookies.find((x) => x.name === "coidle_sid")!;
  return `coidle_sid=${c.value}`;
}

const call = (a: ReturnType<typeof makeApp>, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  a.app.inject({ method, url, headers: { cookie }, payload: payload as object | undefined });

async function setup(a: ReturnType<typeof makeApp>) {
  const owner = await login(a, "owner");
  const { id, inviteCode } = (await call(a, owner, "POST", "/api/malls", { name: "測試" })).json();
  const friend = await login(a, "friend");
  await call(a, friend, "POST", "/api/malls/join", { code: inviteCode });
  // 商場的亂數種子是隨機的；關掉「遇事暫停」，這裡的測試才不會偶爾被隨機事件攔下（事件暫停本身另有測試）
  await call(a, owner, "POST", `/api/malls/${id}/clock`, { pauseOnEvents: false });
  return { owner, friend, id: id as number };
}

import { afterEach } from "vitest";
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});

describe("clock API and service", () => {
  it("any member can slow the clock down, and the game day length follows the preset", async () => {
    const a = makeApp();
    const { owner, friend, id } = await setup(a);
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { pauseOnEvents: false }); // 不受隨機暫停事件影響
    const t0 = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick;

    const r = await call(a, friend, "POST", `/api/malls/${id}/clock`, { speed: "slow" }); // 24 小時 / 遊戲日
    expect(r.statusCode).toBe(200);
    expect(r.json().clock.speed).toBe(0.25);

    a.clock.t += 24 * HOUR;
    a.service.tickAll();
    const t1 = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick;
    expect(t1 - t0).toBe(TICKS_PER_DAY); // 剛好 1 個遊戲日

    // 活動紀錄會寫下是誰調的
    const feed = (await call(a, owner, "GET", `/api/malls/${id}/activity`)).json();
    expect(feed[0].text).toContain("慢活");
  });

  it("changing speed never makes time jump", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    a.clock.t += 3 * HOUR;
    const before = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick;
    const after = (await call(a, owner, "POST", `/api/malls/${id}/clock`, { speed: "glacial" })).json().tick;
    expect(after).toBe(before);
  });

  it("pause freezes everything: no income, no costs, no ticks; resume continues from the same place", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    a.clock.t += 2 * HOUR;
    const paused = (await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: true })).json();
    a.clock.t += 40 * HOUR; // 暫停期間過了很久
    a.service.tickAll();
    const during = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();
    expect(during.tick).toBe(paused.tick);
    expect(during.funds).toBe(paused.funds);

    const resumed = (await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: false })).json();
    expect(resumed.tick).toBe(paused.tick); // 不補算暫停期間
    a.clock.t += 6 * HOUR;
    a.service.tickAll();
    const later = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();
    expect(later.tick - resumed.tick).toBe(TICKS_PER_DAY);
  });

  it("validates clock input and rejects non-members", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    const outsider = await login(a, "outsider");
    expect((await call(a, outsider, "POST", `/api/malls/${id}/clock`, { paused: true })).statusCode).toBe(403);
    expect((await call(a, owner, "POST", `/api/malls/${id}/clock`, { speed: "ludicrous" })).statusCode).toBe(400);
    expect((await call(a, owner, "POST", `/api/malls/${id}/clock`, { idlePauseDays: 99 })).statusCode).toBe(400);
    expect((await call(a, owner, "POST", `/api/malls/${id}/clock`, {})).statusCode).toBe(400);
    expect((await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: "yes" })).statusCode).toBe(400);
  });

  it("idle pause triggers at the exact threshold and resumes (without catch-up) when someone visits", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    // 關掉遇事暫停：8 個遊戲日內稽查預告會先把時鐘停住，這裡只想測「久未上線」本身
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { idlePauseDays: 2, pauseOnEvents: false });
    const start = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();

    a.clock.t += 10 * 24 * HOUR; // 10 天沒人上線
    a.service.tickAll();
    const frozen = a.service.getState(id, false);
    expect(frozen.clock.holds.idle).toBe(true);
    // 在「最後一次造訪 + 2 天」暫停：2 真實日 = 8 遊戲日
    expect(frozen.tick - start.tick).toBe(8 * TICKS_PER_DAY);

    // 回來開啟畫面：自動恢復，且不補算暫停期間
    const back = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();
    expect(back.clock.holds.idle).toBe(false);
    expect(back.tick).toBe(frozen.tick);
    a.clock.t += 6 * HOUR;
    a.service.tickAll();
    expect(a.service.getState(id, false).tick - back.tick).toBe(TICKS_PER_DAY);
  });

  it("idle pause stays off by default", async () => {
    const a = makeApp();
    const { id } = await setup(a);
    a.clock.t += 30 * 24 * HOUR;
    a.service.tickAll();
    expect(a.service.getState(id, false).clock.holds.idle).toBe(false);
  });
});

describe("pause on important events (service level)", () => {
  /** 讓商場落在 8 月颱風季，並放到沒人在場的狀態，直到事件把時鐘停住 */
  async function driveToTyphoonPause(present: boolean) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = makeApp({ pushSender: undefined });
      const sent: string[] = [];
      a.push["sender"] = async (_t: unknown, p: string) => void sent.push(p);
      const { owner, id } = await setup(a);
      // 手動把狀態調成 8 月初
      const s = a.service["load"](id);
      s.tick = AUG;
      s.clock.anchorTick = AUG;
      s.clock.anchorRealMs = a.clock.t;
      s.seed = attempt + 1;
      s.clock.pauseOnEvents = true; // 這組測試正是要測遇事暫停
      a.repo.addPushSub(1, "https://push.example/abc", "p256dhkeyvalue", "authkeyvalue", a.clock.t);
      if (present) a.service.addConnection(id, 1);
      else s.clock.lastVisitRealMs = a.clock.t - 2 * HOUR; // 最近沒人操作
      for (let day = 0; day < 40; day++) {
        a.clock.t += 6 * HOUR;
        a.service.tickAll();
        const cur = a.service.getState(id, false);
        if (cur.pending.some((p) => p.defId === "typhoon_warning") || cur.clock.holds.events.length > 0) return { a, owner, id, sent };
      }
    }
    throw new Error("no typhoon found");
  }

  it("pauses, notifies once, and a member resolving the event resumes the clock", async () => {
    const { a, owner, id, sent } = await driveToTyphoonPause(false);
    const frozen = a.service.getState(id, false);
    expect(frozen.clock.holds.events.length).toBe(1);
    expect(isPaused(frozen.clock)).toBe(true);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]).toContain("商場已暫停"); // 可能是颱風，也可能是供應商缺貨／稽查預告

    // 時間一直過去，狀態不動（事件期限也不會流失）
    a.clock.t += 50 * HOUR;
    a.service.tickAll();
    expect(a.service.getState(id, false).tick).toBe(frozen.tick);
    expect(a.service.getState(id, false).pending.length).toBe(1);

    // 有人來處理：採預設並恢復
    const r = await call(a, owner, "POST", `/api/malls/${id}/commands`, { command: { type: "resolveAllDefault" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().clock.holds.events).toEqual([]);
    const resumedTick = r.json().tick;
    a.clock.t += 6 * HOUR;
    a.service.tickAll();
    expect(a.service.getState(id, false).tick - resumedTick).toBe(TICKS_PER_DAY);
  });

  it("does not pause while a member is present (event stays visible for them to handle)", async () => {
    const { a, id } = await driveToTyphoonPause(true);
    const cur = a.service.getState(id, false);
    expect(cur.clock.holds.events).toEqual([]);
    expect(cur.pending.some((p) => p.defId === "typhoon_warning")).toBe(true);
  });
});

describe("push subscription API", () => {
  it("stores subscriptions, requires login and https endpoints, and can unsubscribe", async () => {
    const a = makeApp();
    const cookie = await login(a, "pusher");
    expect((await a.app.inject({ method: "POST", url: "/api/push/subscribe", payload: {} })).statusCode).toBe(401);
    const bad = await call(a, cookie, "POST", "/api/push/subscribe", { endpoint: "http://insecure.example/x", keys: { p256dh: "aaaaaaaaaaaa", auth: "bbbbbbbbbbbb" } });
    expect(bad.statusCode).toBe(400);
    const ok = await call(a, cookie, "POST", "/api/push/subscribe", { endpoint: "https://push.example/endpoint1", keys: { p256dh: "aaaaaaaaaaaa", auth: "bbbbbbbbbbbb" } });
    expect(ok.statusCode).toBe(200);
    const { id } = (await call(a, cookie, "POST", "/api/malls", { name: "M" })).json();
    expect(a.repo.pushSubsForMall(id)).toHaveLength(1);
    await call(a, cookie, "POST", "/api/push/unsubscribe", { endpoint: "https://push.example/endpoint1" });
    expect(a.repo.pushSubsForMall(id)).toHaveLength(0);
  });

  it("throttles notifications per mall", async () => {
    const a = makeApp();
    const cookie = await login(a, "pusher2");
    const { id } = (await call(a, cookie, "POST", "/api/malls", { name: "M" })).json();
    a.repo.addPushSub(1, "https://push.example/e2", "aaaaaaaaaaaa", "bbbbbbbbbbbb", a.clock.t);
    a.push.notify(id, { title: "t", body: "b" });
    a.push.notify(id, { title: "t", body: "b" });
    expect(a.sent).toHaveLength(1);
    a.clock.t += 11 * 60_000;
    a.push.notify(id, { title: "t", body: "b" });
    expect(a.sent).toHaveLength(2);
  });

  it("presence window constant is sane", () => {
    expect(PRESENCE_WINDOW_MS).toBe(15 * 60_000);
  });
});
