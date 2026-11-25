import { afterAll, describe, expect, it } from "vitest";
import {
  INTERACT_MAX_LAG_TICKS,
  SEASON_MS,
  STARTER_QUESTS,
  TRADE_FEE,
  WORLD_EPOCH_MS,
  allianceCount,
  tradeLimits,
  type MallState,
} from "@coidle/shared";
import { buildApp } from "./app";
import { createRng } from "./sim/rng";
import { calm } from "./testutil";

// 多商場長期模擬：4 座真人商場＋NPC 商場，跑 3 個賽季，每 6 個真實小時各自隨機行動
// （結盟、聯名活動、送錢、調貨、搶客）。檢查所有不變量：沒有例外、錢與貨守恆（只會因手續費變少）、
// 上限沒有被突破、信箱都被消化、賽季都結算且只發一次獎。

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const clock = { t: WORLD_EPOCH_MS + DAY };
const built = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
afterAll(async () => {
  await built.app.close();
});

describe("multi-mall long-run simulation", () => {
  it("keeps every invariant over three seasons of random cross-mall activity", async () => {
    const { service, repo } = built;
    const rng = createRng(20270101);
    const users: number[] = [];
    const malls: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { username: `sim${i}`, password: "password123", displayName: `玩家${i}` } });
      expect(r.statusCode).toBe(200);
      const cookie = `coidle_sid=${r.cookies.find((x) => x.name === "coidle_sid")!.value}`;
      const me = (await built.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
      users.push(me.user.id);
      malls.push(service.createMall(me.user.id, `模擬商場${i}`).mallId);
    }
    calm(service, ...malls); // 遇事暫停會讓商場落後；這裡的落後只由下面「暫停再恢復」的那座商場刻意製造
    const lagger = malls[3]!;
    const caretaker = { id: 0, displayName: "模擬" };
    let refusedWhileLagging = 0;
    const cache = (service as unknown as { cache: Map<number, MallState> }).cache;
    for (const id of malls) {
      const s = structuredClone(service.sync(id));
      for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
      s.funds = 30_000_000; // 給足資金，讓各種行動都有機會發生
      cache.set(id, s);
    }

    let ok = 0;
    let refused = 0;
    const attempt = (fn: () => unknown): void => {
      try {
        fn();
        ok++;
      } catch (e) {
        // 伺服器用 ServiceError 擋下的行動是正常的；其他例外就是 bug
        if ((e as { status?: number }).status === undefined) throw e;
        refused++;
      }
    };

    const end = WORLD_EPOCH_MS + 3 * SEASON_MS + 2 * DAY;
    let steps = 0;
    while (clock.t < end) {
      clock.t += 6 * HOUR;
      steps++;
      // 第 4 座商場週期性地暫停約 8 步（兩個真實日）再恢復：落後伺服器、追趕、追上，期間照樣收發跨商場的信
      if (steps % 60 === 10) service.setClock(lagger, caretaker, { paused: true });
      if (steps % 60 === 18) service.setClock(lagger, caretaker, { paused: false });
      service.tickAll();
      for (const id of malls) {
        if (!rng.chance(0.5)) continue;
        if (id === lagger && service.serverTick() - service.sync(id).tick > INTERACT_MAX_LAG_TICKS) refusedWhileLagging++;
        const others = service.world.entries().filter((e) => e.key !== `m:${id}`);
        const target = others[rng.int(0, others.length - 1)]!;
        switch (rng.int(0, 6)) {
          case 0:
            attempt(() => service.alliances.propose(id, target.key));
            break;
          case 1:
            for (const a of service.alliances.list(id)) {
              if (a.status === "pending" && a.direction === "in") attempt(() => service.alliances.respond(id, a.id, rng.chance(0.7)));
              else if (a.status === "active" && rng.chance(0.5)) attempt(() => service.alliances.joint(id, a.id));
            }
            break;
          case 2:
            attempt(() => service.trade.sendFunds(id, target.key, rng.int(1, 40) * 10_000));
            break;
          case 3: {
            const shop = service.sync(id).shops.find((x) => x.category === "kushikatsu" || x.category === "takoyaki");
            if (shop) attempt(() => service.trade.sendGoods(id, target.key, shop.id, rng.int(20, 200)));
            break;
          }
          case 4:
            attempt(() => service.compete.attack(id, target.key, ["tourist", "local", "commuter", "family", "student", "couple"][rng.int(0, 5)]!));
            break;
          case 5:
            for (const a of service.alliances.list(id)) if (a.status === "active" && rng.chance(0.1)) attempt(() => service.alliances.end(id, a.id));
            break;
          default:
            break;
        }
      }
    }
    // 最後讓所有人收完信、追上伺服器時間
    for (let i = 0; i < 4; i++) {
      clock.t += 6 * HOUR;
      service.tickAll();
    }
    service.tickAll();
    service.tickAll();

    expect(steps).toBeGreaterThan(300);
    expect(refusedWhileLagging).toBeGreaterThan(0); // 落後超過門檻的商場真的被擋過（互動規則有生效）
    for (const id of malls) expect(service.serverTick() - service.sync(id).tick).toBeLessThan(2); // 全部都追上了
    expect(ok).toBeGreaterThan(50); // 真的有很多行動發生
    expect(refused).toBeGreaterThan(0); // 上限與保護真的擋過人

    // ① 狀態健康
    for (const id of malls) {
      const s = service.sync(id);
      expect(Number.isFinite(s.funds)).toBe(true);
      expect(Number.isFinite(s.localRep)).toBe(true);
      expect(s.world.alliances.length).toBeLessThanOrEqual(2);
      expect(s.world.mailCount).toBeGreaterThan(0);
      expect(repo.pendingMailCount(id)).toBe(0); // ② 信箱都被消化
    }

    // ③ 賽季：前 3 季都結算了，每季每座商場最多收到一次獎勵
    const seasons = repo.latestSeasons(10).map((x) => x.season).sort((a, b) => a - b);
    expect(seasons).toEqual([0, 1, 2]);
    for (const id of malls) {
      const mine = service.sync(id).world.seasons.map((x) => x.season);
      expect(new Set(mine).size).toBe(mine.length);
    }

    // ④ 貿易守恆與上限：每筆紀錄的金額在上限內；資金互送的「對方收到」一律 ≤ 轉出的 95%
    const trades = repo.recentTrades(10_000);
    expect(trades.length).toBeGreaterThan(0);
    for (const tr of trades) {
      expect(tr.from_mall).not.toBe(tr.to_mall);
      if (tr.kind === "funds") {
        expect(tr.amount).toBeLessThanOrEqual(tradeLimits(8).fundsPerTx);
        const m = /收到 (\d+)/.exec(tr.detail);
        expect(Number(m![1])).toBeLessThanOrEqual(Math.floor(tr.amount * (1 - TRADE_FEE)));
      }
    }
    // 任何一個 7 天視窗裡，同一方向的資金淨流量都不超過上限
    for (const a of malls) {
      for (const b of malls) {
        if (a === b) continue;
        const sorted = trades.filter((t) => t.kind === "funds" && t.from_mall === a && t.to_mall === b).sort((x, y) => x.ts - y.ts);
        for (const t0 of sorted) {
          const out = sorted.filter((t) => t.ts >= t0.ts - 7 * DAY && t.ts <= t0.ts).reduce((acc, t) => acc + t.amount, 0);
          const back = trades.filter((t) => t.kind === "funds" && t.from_mall === b && t.to_mall === a && t.ts >= t0.ts - 7 * DAY && t.ts <= t0.ts).reduce((acc, t) => acc + t.amount, 0);
          expect(out - back).toBeLessThanOrEqual(tradeLimits(8).fundsNet);
        }
      }
    }

    // ⑤ 沒有任何商場被連續壓到破產（資金仍是正的）
    for (const id of malls) expect(service.sync(id).funds).toBeGreaterThan(0);
    for (const id of malls) expect(allianceCount(service.sync(id))).toBeLessThanOrEqual(2);
  }, 600_000);
});
