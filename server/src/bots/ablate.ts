// 功能消融：同樣的 5 間店，每次只打開一種「選配的主動玩法」，看它值不值得。
import { runBot, type Features } from "./bots";
const days = Number(process.argv[2] ?? 60);
const seeds = [101, 202, 303];
const off = { promo: false, research: false, regulars: false, refresh: false, upkeep: false };
const cases: [string, Partial<Features>][] = [
  ["nothing(lazy-ish)", { ...off }],
  ["upkeep only", { ...off, upkeep: true }],
  ["refresh only", { ...off, refresh: true }],
  ["promo only", { ...off, promo: true }],
  ["research only", { ...off, research: true }],
  ["regulars only", { ...off, regulars: true }],
  ["everything", {}],
];
for (const [name, features] of cases) {
  let rev = 0, funds = 0, idx = 0, aff = 0, sig = 0;
  for (const seed of seeds) {
    const r = runBot("tender", seed, days, { sampleEvery: 1000, features });
    const s = r.final;
    const recent = s.reports.slice(-14);
    rev += recent.reduce((a, x) => a + x.revenue, 0) / recent.length;
    funds += s.funds; idx += (s.localRep + s.touristHeat) / 2;
    const met = s.regulars.filter((x) => x.met); aff += met.reduce((a, x) => a + x.affinity, 0) / Math.max(1, met.length);
    sig += s.workshop.discovered.length;
  }
  const n = seeds.length;
  console.log(`${name.padEnd(20)} rev/day(last14)=${(rev / n / 1e6).toFixed(2)}M  funds=${(funds / n / 1e6).toFixed(1)}M  index=${(idx / n).toFixed(1)}  affinity=${(aff / n).toFixed(0)}  signatures=${(sig / n).toFixed(1)}`);
}
