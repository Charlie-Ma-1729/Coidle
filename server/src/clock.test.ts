import { describe, expect, it } from "vitest";
import {
  EVENT_BY_ID,
  INTERACT_MAX_LAG_TICKS,
  PRESENCE_WINDOW_MS,
  DEFAULT_SERVER_CLOCK,
  REAL_HOURS_PER_GAME_DAY,
  SPEED_PRESETS,
  TICKS_PER_DAY,
  TICK_MINUTES,
  catchUpMinutes,
  effectiveSpeed,
  isPaused,
  lagTicks,
  newClock,
  realMsAtTick,
  serverRealMsAt,
  serverTickAt,
  tickAt,
  ticksToRealMinutes,
  type MallClock,
} from "@coidle/shared";
import { buildApp } from "./app";
import { openDb } from "./db/db";
import { Repo } from "./db/repo";
import { MallService } from "./services/mallService";
import { advanceTo, applyCommand, createInitialState, migrateState, stepTick } from "./sim";

const HOUR = 3_600_000;
const TICK_MS = TICK_MINUTES * 60_000;
const T0 = Date.UTC(2027, 7, 20, 0, 0, 0); // 真實時間起點
// 遊戲時間在 8 月（颱風季）才有 typhoon_warning 事件
const AUG = (Date.UTC(2027, 7, 1) - 9 * HOUR) / TICK_MS;

describe("clock math", () => {
  it("runs at 6x by default: 4 real hours = 1 game day", () => {
    const c = newClock(0, 1000);
    expect(tickAt(c, 4 * HOUR)).toBe(1000 + TICKS_PER_DAY);
    expect(tickAt(c, 0)).toBe(1000);
    expect(REAL_HOURS_PER_GAME_DAY).toBe(4);
  });

  it("each speed preset maps to the documented real hours per game day (when not capped by the server)", () => {
    for (const p of SPEED_PRESETS) {
      const c: MallClock = { ...newClock(0, 0), speed: p.mult };
      expect(tickAt(c, Math.round(p.realHoursPerDay * HOUR))).toBe(TICKS_PER_DAY);
    }
    // 只剩追趕用的四檔：比伺服器同速還慢的檔位已經移除
    expect(SPEED_PRESETS.map((p) => p.mult)).toEqual([6, 3, 2, 1]);
  });

  it("a mall never runs ahead of the server clock: synced malls run at exactly 1x whatever the speed setting", () => {
    const sc = { anchorRealMs: 0, anchorTick: 5000 };
    for (const p of SPEED_PRESETS) {
      const c: MallClock = { ...newClock(0, 5000), speed: p.mult };
      expect(tickAt(c, 4 * HOUR, sc)).toBe(5000 + TICKS_PER_DAY);
      expect(tickAt(c, 4 * HOUR, sc)).toBeLessThanOrEqual(serverTickAt(4 * HOUR, sc));
    }
  });

  it("a lagging mall catches up at its chosen speed and is then clamped to the server", () => {
    const sc = { anchorRealMs: 0, anchorTick: 10_000 };
    // 落後 600 tick；以 6× 追趕：每個伺服器 tick 追 5 個 → 120 個伺服器 tick 追上
    const c: MallClock = { ...newClock(0, 9400), speed: 6 };
    expect(lagTicks(9400, 0, sc)).toBe(600);
    expect(tickAt(c, 0, sc)).toBe(9400);
    const halfway = 60 * (TICK_MS / 6); // 60 個伺服器 tick 的真實毫秒
    expect(serverTickAt(halfway, sc) - tickAt(c, halfway, sc)).toBe(300);
    const done = Math.ceil(120 * (TICK_MS / 6)) + 1000;
    expect(tickAt(c, done, sc)).toBe(serverTickAt(done, sc));
    expect(catchUpMinutes(600, 6)).toBeCloseTo((120 * TICK_MINUTES) / 6, 6);
    // 追趕速度和伺服器一樣快：永遠追不上，落後的量固定不變
    const slow: MallClock = { ...newClock(0, 9400), speed: 1 };
    expect(serverTickAt(100 * HOUR, sc) - tickAt(slow, 100 * HOUR, sc)).toBe(600);
    expect(catchUpMinutes(600, 1)).toBe(Infinity);
  });

  it("ticksToRealMinutes follows the catch-up model once a lag is given", () => {
    // 沒給 lag：照流速本身（測試商場）
    expect(ticksToRealMinutes(288, 1)).toBe(240);
    expect(ticksToRealMinutes(288, 6)).toBe(40);
    // 已追上（lag 0）：不管追趕速度是多少，都是 1×（4 小時＝1 遊戲日）
    expect(ticksToRealMinutes(288, 6, 0)).toBe(240);
    // 落後 600、6× 追趕：前 720 個 tick（=120×6）用 6× 走完，之後 1×
    expect(ticksToRealMinutes(720, 6, 600)).toBeCloseTo(120 * (TICK_MINUTES / 6), 6);
    expect(ticksToRealMinutes(720 + 288, 6, 600)).toBeCloseTo((120 + 288) * (TICK_MINUTES / 6), 6);
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

  it("realMsAtTick inverts tickAt on a running clock, with and without the server cap", () => {
    const c: MallClock = { ...newClock(5_000, 100), speed: 2 };
    const ms = realMsAtTick(c, 100 + 288);
    expect(tickAt(c, ms)).toBe(100 + 288);
    // 有夾限：走到某個 tick 的時刻不會早於伺服器走到它的時刻
    const sc = { anchorRealMs: 0, anchorTick: 100 + 288 * 4 };
    const capped = realMsAtTick(c, 100 + 288 * 8, sc);
    expect(capped).toBeGreaterThanOrEqual(serverRealMsAt(100 + 288 * 8, sc));
    expect(tickAt(c, capped + 1000, sc)).toBeGreaterThanOrEqual(100 + 288 * 8);
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
    expect(m.version).toBe(13);
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
  // 商場的亂數種子是隨機的；關掉「遇事暫停」，這裡的測試才不會偶爾被隨機事件攔下（事件暫停本身另有測試）。
  // 追趕速度設成 1×：這組測試要看精準的「4 真實小時＝1 遊戲日」；追趕本身另有測試
  await call(a, owner, "POST", `/api/malls/${id}/clock`, { pauseOnEvents: false, speed: "standard" });
  return { owner, friend, id: id as number };
}

import { afterEach } from "vitest";
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});

describe("clock API and service", () => {
  it("a synced mall runs at exactly 4 real hours per game day, whatever catch-up speed a member picked", async () => {
    const a = makeApp();
    const { owner, friend, id } = await setup(a);
    const t0 = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick;

    const r = await call(a, friend, "POST", `/api/malls/${id}/clock`, { speed: "turbo" }); // 追趕速度 6×，但已經同步
    expect(r.statusCode).toBe(200);
    expect(r.json().clock.speed).toBe(6);

    a.clock.t += 4 * HOUR;
    a.service.tickAll();
    const t1 = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick;
    expect(t1 - t0).toBe(TICKS_PER_DAY); // 剛好 1 個遊戲日：不能比伺服器快
    expect(a.service.serverTick() - t1).toBeLessThanOrEqual(1);

    // 活動紀錄會寫下是誰調的
    const feed = (await call(a, owner, "GET", `/api/malls/${id}/activity`)).json();
    expect(feed[0].text).toContain("追趕速度");
  });

  it("the slow presets are gone: only the four catch-up speeds are accepted", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    for (const old of ["slow", "relaxed"]) expect((await call(a, owner, "POST", `/api/malls/${id}/clock`, { speed: old })).statusCode).toBe(400);
    for (const p of SPEED_PRESETS) expect((await call(a, owner, "POST", `/api/malls/${id}/clock`, { speed: p.id })).statusCode).toBe(200);
  });

  it("every state the player gets carries the server tick, so the screen can show how far behind the mall is", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    const s0 = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();
    expect(s0.serverTick).toBe(a.service.serverTick());
    expect(s0.serverTick - s0.tick).toBeLessThanOrEqual(1);
    expect(a.service.summary(id)?.lag).toBeLessThanOrEqual(1);

    // 暫停 1 個真實小時：商場不動，伺服器往前走，差距就是 1/4 遊戲日
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: true });
    const tick = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick;
    a.clock.t += HOUR;
    const s1 = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();
    expect(s1.tick).toBe(tick);
    expect(s1.serverTick - s1.tick).toBe(TICKS_PER_DAY / 4);
    expect(a.service.summary(id)).toMatchObject({ lag: TICKS_PER_DAY / 4, paused: true });
  });

  it("changing speed never makes time jump", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    a.clock.t += 3 * HOUR;
    const before = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick;
    const after = (await call(a, owner, "POST", `/api/malls/${id}/clock`, { speed: "turbo" })).json().tick;
    expect(after).toBe(before);
  });

  it("a paused mall falls behind the server, and catches up at the chosen speed until it is synced again", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    a.clock.t += HOUR;
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: true });
    a.clock.t += 8 * HOUR; // 暫停 8 小時＝落後 2 個遊戲日
    a.service.tickAll();
    const lagged = a.service.sync(id);
    // 商場的 tick 由自己的錨點推算，和伺服器 tick 的小數進位最多差 1 個 tick
    const lagNow = () => a.service.serverTick() - a.service.sync(id).tick;
    expect(Math.abs(lagNow() - 2 * TICKS_PER_DAY)).toBeLessThanOrEqual(1);
    expect(Math.abs(lagged.clock.lag! - 2 * TICKS_PER_DAY)).toBeLessThanOrEqual(1);

    // 以 1× 恢復：和伺服器同速，落後的量固定不變，永遠追不上
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: false });
    a.clock.t += 6 * HOUR;
    a.service.tickAll();
    expect(Math.abs(lagNow() - 2 * TICKS_PER_DAY)).toBeLessThanOrEqual(1);

    // 改成 6× 追趕：lag/(v−1) 個伺服器 tick 後追上；之後回到 1×
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { speed: "turbo" });
    const before = a.service.sync(id).tick;
    a.clock.t += 2 * HOUR; // 追趕需要約 96 分鐘
    a.service.tickAll();
    const synced = a.service.sync(id);
    expect(lagNow()).toBeLessThanOrEqual(1);
    expect(synced.clock.lag).toBeLessThanOrEqual(1);
    expect(synced.tick - before).toBeGreaterThanOrEqual(2 * TICKS_PER_DAY + 140); // 補回了 2 個遊戲日（576），外加這兩小時本身（144）
    const t1 = synced.tick;
    a.clock.t += 4 * HOUR;
    a.service.tickAll();
    expect(a.service.sync(id).tick - t1).toBe(TICKS_PER_DAY); // 追上後 1×
  });

  it("clocks left at the old slow speeds (0.25×, 0.5×, 72-hour) are lifted to 1× without making time jump", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    for (const old of [0.25, 0.5, 1 / 12]) {
      a.service.sync(id).clock.speed = old;
      a.clock.t += 3 * HOUR;
      const st = a.service.sync(id);
      expect(st.clock.speed).toBe(1);
      const tick = st.tick;
      a.clock.t += 4 * HOUR;
      a.service.tickAll();
      expect((await call(a, owner, "GET", `/api/malls/${id}/state`)).json().tick - tick).toBe(TICKS_PER_DAY);
    }
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
    expect(resumed.tick).toBe(paused.tick); // 暫停期間不補算（落後的部分由追趕處理）
    a.clock.t += 4 * HOUR;
    a.service.tickAll();
    const later = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();
    expect(later.tick - resumed.tick).toBe(TICKS_PER_DAY); // 1× 恢復：每 4 真實小時 1 遊戲日
  });

  it("a mall that is too far behind cannot start cross-mall interactions until it catches up", async () => {
    const a = makeApp();
    const { owner, id } = await setup(a);
    const rival = await login(a, "rival");
    const other = (await call(a, rival, "POST", "/api/malls", { name: "對方" })).json().id as number;
    await call(a, rival, "POST", `/api/malls/${other}/clock`, { pauseOnEvents: false, speed: "standard" });
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: true });
    a.clock.t += 24 * HOUR; // 暫停 1 真實日＝落後 6 個遊戲日，超過 5 日門檻
    a.service.tickAll();
    expect(a.service.serverTick() - a.service.sync(id).tick).toBeGreaterThan(INTERACT_MAX_LAG_TICKS);
    const refused = await call(a, owner, "POST", `/api/malls/${id}/world/alliance`, { target: `m:${other}` });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain("落後");
    // 恢復並用 6× 追趕之後就可以了
    await call(a, owner, "POST", `/api/malls/${id}/clock`, { paused: false, speed: "turbo" });
    a.clock.t += 6 * HOUR;
    a.service.tickAll();
    expect(a.service.serverTick() - a.service.sync(id).tick).toBeLessThanOrEqual(1);
    const ok = await call(a, owner, "POST", `/api/malls/${id}/world/alliance`, { target: `m:${other}` });
    expect(ok.statusCode).toBe(200);
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
    // 在「最後一次造訪 + 2 天」暫停：2 真實日 = 12 遊戲日（4 小時＝1 遊戲日）
    expect(frozen.tick - start.tick).toBe(12 * TICKS_PER_DAY);

    // 回來開啟畫面：自動恢復，且不補算暫停期間（落後的部分由追趕處理）
    const back = (await call(a, owner, "GET", `/api/malls/${id}/state`)).json();
    expect(back.clock.holds.idle).toBe(false);
    expect(back.tick).toBe(frozen.tick);
    a.clock.t += 4 * HOUR;
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
        a.clock.t += 4 * HOUR;
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
    a.clock.t += 4 * HOUR;
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

describe("server clock initialisation and mail timing", () => {
  const mkRepoWithMalls = (ticks: number[], now: number) => {
    const repo = new Repo(openDb(":memory:"));
    const ids = ticks.map((tick, i) => {
      const id = repo.createMall(`商場${i}`, `CODE${i}`, i + 1, now);
      const s = createInitialState(i + 1, tick, now);
      s.clock.speed = 6;
      s.clock.pauseOnEvents = false;
      repo.saveState(id, tick, JSON.stringify(s), now);
      return id;
    });
    return { repo, ids };
  };

  it("a database that already has malls: the server clock starts at the most advanced mall, nobody is ahead, everyone catches up", () => {
    const now = T0;
    const { repo, ids } = mkRepoWithMalls([1000, 5000, 3000], now);
    expect(repo.hasServerClock()).toBe(false);
    let t = now;
    const service = new MallService(repo, () => t);
    expect(repo.hasServerClock()).toBe(true);
    expect(service.serverTick()).toBe(5000);
    for (const id of ids) expect(service.sync(id).tick).toBeLessThanOrEqual(service.serverTick());
    expect(service.sync(ids[0]!).clock.lag).toBe(4000);
    t += 12 * HOUR; // 6× 追趕：4000 tick 的落後在 12 真實小時內追上（約 11 小時）
    service.tickAll();
    for (const id of ids) {
      const s = service.sync(id);
      expect(s.tick).toBe(service.serverTick());
      expect(s.clock.lag).toBe(0);
    }
    // 重啟（同一個資料庫再建一次服務）不會重設伺服器時鐘
    const again = new MallService(repo, () => t + 5 * HOUR);
    expect(again.serverClock).toEqual(service.serverClock);
  });

  it("a brand-new database uses the default anchor", () => {
    const repo = new Repo(openDb(":memory:"));
    const service = new MallService(repo, () => T0);
    expect(service.serverClock).toEqual(DEFAULT_SERVER_CLOCK);
    expect(service.serverTick()).toBe(serverTickAt(T0));
  });

  it("timed mail waits until the mall's own clock reaches its tick; a paused mall keeps it pending", () => {
    const now = T0;
    const { repo, ids } = mkRepoWithMalls([5000, 5000], now);
    let t = now;
    const service = new MallService(repo, () => t);
    const [a, b] = ids as [number, number];
    // 對 a 寄一封「3 個遊戲日後」才生效的信，對 b 也一樣
    const at = service.serverTick() + 3 * TICKS_PER_DAY;
    for (const id of [a, b]) repo.addMail(id, "notice", { text: "未來的通知" }, t, t, at);
    // b 先暫停：時間不走，信一直放著
    service.setClock(b, { id: 0, displayName: "測試" }, { paused: true });
    t += 3 * 4 * HOUR - HOUR; // 還差 1 真實小時（6 個遊戲小時）才到
    service.sync(a);
    expect(service.sync(a).world.notices).toHaveLength(0);
    expect(repo.pendingMailCount(a)).toBe(1);
    t += 2 * HOUR;
    const sa = service.sync(a);
    expect(sa.world.notices.map((n) => n.text)).toEqual(["未來的通知"]);
    expect(sa.world.notices[0]!.tick).toBe(at); // 信是在「剛好那個 tick」套用的，不是事後補上
    expect(repo.pendingMailCount(a)).toBe(0);
    const sb = service.sync(b);
    expect(sb.world.notices).toHaveLength(0);
    expect(repo.pendingMailCount(b)).toBe(1);
    service.setClock(b, { id: 0, displayName: "測試" }, { paused: false, speed: "turbo" });
    t += 12 * HOUR;
    expect(service.sync(b).world.notices.map((n) => n.tick)).toEqual([at]); // 恢復追趕後，模擬到那個 tick 才收到
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
