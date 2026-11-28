// 集團事業的機器人對照：同種子同策略，開／關「集團與事業」各跑一次，比較終局資金與事業損益。
// 用法：npx tsx --tsconfig tsconfig.json server/src/bots/ventrun.ts [天數] [種子數] [策略]
// 注意：後期有大額一次性進帳，終局資金差有 ±40M 雜訊，要看事業自己的損益（venture）才準。
import { runBot, type BotKind } from "./bots";

const days = Number(process.argv[2] ?? 120);
const seeds = Number(process.argv[3] ?? 2);
const kind = (process.argv[4] ?? "diligent") as BotKind;
const fmt = (n: number) => `${(n / 1e6).toFixed(1)}M`;

for (let seed = 1; seed <= seeds; seed++) {
  const off = runBot(kind, seed * 101, days, { sampleEvery: days });
  const on = runBot(kind, seed * 101, days, { sampleEvery: days, features: { venture: true } });
  const v = on.final.ventures?.staffing;
  console.log(
    `${kind} seed=${seed * 101} ${days}d  關：資金 ${fmt(off.final.funds)}  開：資金 ${fmt(on.final.funds)}  差 ${fmt(on.final.funds - off.final.funds)}  broke=${on.broke}` +
      `  集團=${on.final.group?.name ?? "（未設立）"}  事業：人員 ${v?.workers ?? 0}、累計損益 ${v ? fmt(v.profit) : "—"}、近 30 天 ${v ? fmt(v.hist.reduce((a, r) => a + r.revenue - r.cost, 0)) : "—"}`,
  );
}
