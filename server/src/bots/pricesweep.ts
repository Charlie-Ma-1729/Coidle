// 用法：npx tsx --tsconfig tsconfig.json server/src/bots/pricesweep.ts [天數] [策略] [倍率,逗號分隔]
// 把所有店的標價一起乘上某個倍率，看營收、利潤、客流、離場、口碑怎麼變（確認「全面漲價」不是永遠最賺）。
import { runBot, type BotKind } from "./bots";

const days = Number(process.argv[2] ?? 40);
const kind = (process.argv[3] ?? "lazy") as BotKind;
const mults = (process.argv[4] ?? "0.8,1,1.1,1.2,1.3,1.5,2,3").split(",").map(Number);
const fromDay = Math.floor(days / 2);
console.log(`${kind}，${days} 天，取第 ${fromDay} 天以後的平均（4 個種子）`);
for (const m of mults) {
  const rows = [101, 202, 303, 404].map((seed) => {
    const r = runBot(kind, seed, days, { sampleEvery: 1, mutate: (s) => { for (const sh of s.shops) sh.price = Math.round(sh.price * m); } });
    const late = r.samples.filter((x) => x.day >= fromDay);
    const avg = (f: (x: (typeof late)[number]) => number) => late.reduce((a, x) => a + f(x), 0) / late.length;
    const reps = r.final.reports.slice(-10);
    return {
      rev: avg((x) => x.revenue),
      profit: avg((x) => x.profit),
      groups: avg((x) => x.groups),
      lost: avg((x) => x.lostRatio),
      walks: reps.reduce((a, q) => a + q.walkouts, 0) / reps.length,
      priceWalks: reps.reduce((a, q) => a + (q.priceWalks ?? 0), 0) / reps.length,
      local: r.final.localRep,
      tour: r.final.touristHeat,
    };
  });
  const a = (k: keyof (typeof rows)[number]) => rows.reduce((s, x) => s + x[k], 0) / rows.length;
  console.log(
    `price x${String(m).padEnd(4)} rev/day ${(a("rev") / 1e6).toFixed(2)}M  profit ${(a("profit") / 1e3).toFixed(0).padStart(5)}k  groups ${a("groups").toFixed(0).padStart(4)}  lost ${(a("lost") * 100).toFixed(0).padStart(2)}%  priceWalks/day ${a("priceWalks").toFixed(0).padStart(4)}  rep ${a("local").toFixed(0)}/${a("tour").toFixed(0)}`,
  );
}
