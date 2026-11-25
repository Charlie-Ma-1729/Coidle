// 多商場模擬報告：4 座真人商場＋NPC 商場，跑 3 個賽季，每 6 個真實小時各自隨機行動
// （結盟、聯名活動、送錢、調貨、搶客、反擊）。印出每種行動成功／被擋的次數、被擋的原因、
// 各商場最後的資金與等級、賽季結算與貿易總額，供 docs/balance-report.md 引用。
// 用法：npx tsx --tsconfig tsconfig.json server/src/bots/world.ts [種子]
import { SEASON_MS, STARTER_QUESTS, WORLD_EPOCH_MS, type MallState } from "@coidle/shared";
import { buildApp } from "../app";
import { createRng } from "../sim/rng";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const seed = Number(process.argv[2] ?? 20270101);
const clock = { t: WORLD_EPOCH_MS + DAY };

async function main() {
  const built = buildApp({ config: { dbPath: ":memory:" }, now: () => clock.t });
  const { service, repo } = built;
  const rng = createRng(seed);
  const malls: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { username: `sim${i}`, password: "password123", displayName: `玩家${i}` } });
    const cookie = `coidle_sid=${r.cookies.find((x) => x.name === "coidle_sid")!.value}`;
    const me = (await built.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
    malls.push(service.createMall(me.user.id, `模擬商場${i}`).mallId);
  }
  const cache = (service as unknown as { cache: Map<number, MallState> }).cache;
  for (const id of malls) {
    const s = structuredClone(service.sync(id));
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    s.funds = 30_000_000;
    cache.set(id, s);
  }
  const startFunds = 30_000_000;

  const stat: Record<string, { ok: number; refused: number }> = {};
  const why: Record<string, number> = {};
  const attempt = (kind: string, fn: () => unknown): void => {
    const st = (stat[kind] ??= { ok: 0, refused: 0 });
    try {
      fn();
      st.ok++;
    } catch (e) {
      if ((e as { status?: number }).status === undefined) throw e;
      st.refused++;
      const m = (e as Error).message.replace(/「.*?」|Lv\.\d+|\d+/g, "").slice(0, 28);
      why[`${kind}：${m}`] = (why[`${kind}：${m}`] ?? 0) + 1;
    }
  };

  const end = WORLD_EPOCH_MS + 3 * SEASON_MS + 2 * DAY;
  const t0 = Date.now();
  while (clock.t < end) {
    clock.t += 6 * HOUR;
    service.tickAll();
    for (const id of malls) {
      if (!rng.chance(0.5)) continue;
      const others = service.world.entries().filter((e) => e.key !== `m:${id}`);
      const target = others[rng.int(0, others.length - 1)]!;
      switch (rng.int(0, 7)) {
        case 0:
          attempt("提出結盟", () => service.alliances.propose(id, target.key));
          break;
        case 1:
          for (const a of service.alliances.list(id)) {
            if (a.status === "pending" && a.direction === "in") attempt("回覆邀請", () => service.alliances.respond(id, a.id, rng.chance(0.7)));
            else if (a.status === "active" && rng.chance(0.5)) attempt("聯名活動", () => service.alliances.joint(id, a.id));
          }
          break;
        case 2:
          attempt("送資金", () => service.trade.sendFunds(id, target.key, rng.int(1, 40) * 10_000));
          break;
        case 3: {
          const shop = service.sync(id).shops.find((x) => x.category === "kushikatsu" || x.category === "takoyaki");
          if (shop) attempt("調貨", () => service.trade.sendGoods(id, target.key, shop.id, rng.int(20, 200)));
          break;
        }
        case 4:
          attempt("搶客", () => service.compete.attack(id, target.key, ["tourist", "local", "commuter", "family", "student", "couple"][rng.int(0, 5)]!));
          break;
        case 5: {
          // 被搶客後反擊：打回最近一次搶自己客人的那座商場，同一個客群
          const n = service.sync(id).world.notices.find((x) => x.from);
          if (n?.from) attempt("反擊", () => service.compete.attack(id, n.from!, n.persona ?? "tourist"));
          break;
        }
        case 6:
          for (const a of service.alliances.list(id)) if (a.status === "active" && rng.chance(0.1)) attempt("結束協議", () => service.alliances.end(id, a.id));
          break;
        default:
          break;
      }
    }
  }
  service.tickAll();
  service.tickAll();

  console.log(`種子 ${seed}：模擬 ${Math.round((end - WORLD_EPOCH_MS) / DAY)} 天，耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒\n`);
  console.log("行動            成功   被擋");
  for (const [k, v] of Object.entries(stat)) console.log(`${k.padEnd(10, "　")} ${String(v.ok).padStart(5)} ${String(v.refused).padStart(6)}`);
  console.log("\n最常見的被擋原因（前 8）：");
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log("\n商場      等級  最後資金   對起始 聯名 收到信");
  for (const id of malls) {
    const s = service.sync(id);
    console.log(`模擬商場${malls.indexOf(id)}  ${String(s.level).padStart(3)}  ${(s.funds / 1e6).toFixed(1).padStart(7)}M  ${(((s.funds - startFunds) / startFunds) * 100).toFixed(0).padStart(4)}%  ${s.world.alliances.length}    ${s.world.mailCount}`);
  }
  const trades = repo.recentTrades(100_000);
  const sum = (k: string) => trades.filter((t) => t.kind === k).reduce((a, t) => a + t.amount, 0);
  console.log(`\n貿易：資金 ${trades.filter((t) => t.kind === "funds").length} 筆、共 ${(sum("funds") / 1e6).toFixed(1)}M；貨物 ${trades.filter((t) => t.kind === "goods").length} 筆、共 ${sum("goods")} 份`);
  const seasons = repo.latestSeasons(10);
  console.log(`賽季結算：${seasons.map((x) => `第 ${x.season + 1} 季`).join("、")}`);
  await built.app.close();
}

void main();
