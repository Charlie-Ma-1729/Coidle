// 用法：npx tsx --tsconfig tsconfig.json server/src/bots/run.ts [天數] [種子數] [策略,逗號分隔]
import { runBot, type BotKind } from "./bots";

const days = Number(process.argv[2] ?? 60);
const seeds = Number(process.argv[3] ?? 2);
const kinds = ((process.argv[4] ?? "diligent,periodic,lazy,chaotic").split(",") as BotKind[]);
const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${Math.round(n)}`);

for (const kind of kinds) {
  for (let seed = 1; seed <= seeds; seed++) {
    const t0 = Date.now();
    const r = runBot(kind, seed * 101, days, { sampleEvery: Math.max(7, Math.floor(days / 8)) });
    console.log(`\n== ${kind} seed=${seed * 101}  ${days}d  pauses=${r.pauses} (${(r.pauses / days).toFixed(2)}/day)  broke=${r.broke}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (r.pauses > 0) console.log("pause sources:", Object.entries(r.pauseBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" "));
    console.log("day   funds   lv  local tour  profit    rev groups lost%  stk  shops reg aff  cmp dish sig rank");
    for (const x of r.samples) {
      console.log(
        `${String(x.day).padStart(3)} ${fmt(x.funds).padStart(7)} ${String(x.level).padStart(3)} ${x.local.toFixed(0).padStart(5)} ${x.tourist.toFixed(0).padStart(4)} ${fmt(x.profit).padStart(7)} ${fmt(x.revenue).padStart(6)} ${String(x.groups).padStart(6)} ${(x.lostRatio * 100).toFixed(0).padStart(4)}% ${String(x.stockouts).padStart(4)} ${String(x.shops).padStart(5)} ${String(x.metRegulars).padStart(3)} ${x.avgAffinity.toFixed(0).padStart(3)} ${String(x.complaints).padStart(4)} ${String(x.dishes).padStart(4)} ${String(x.signatures).padStart(3)} ${String(x.rivalRank).padStart(4)}`,
      );
    }
  }
}
