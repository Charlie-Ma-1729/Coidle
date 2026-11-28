// 人力派遣・教育：全年損益掃描（純函式，不跑模擬）。
// 用法：npx tsx --tsconfig tsconfig.json server/src/bots/ventsweep.ts [店數] [等級]
import { CLASS_OPEN_COST, STAFF_HIRE_COST, VENTURE_BY_KIND, maxClasses, maxWorkers, staffingDay, type StaffingState } from "@coidle/shared";

const shops = Number(process.argv[2] ?? 20);
const level = Number(process.argv[3] ?? 6);
const START_DAY = Math.floor(Date.UTC(2027, 3, 1) / 86_400_000);
const mw = maxWorkers(level);
const mc = maxClasses(level);
const half = Math.round(mw / 2);
const configs: { name: string; w: number; c: number; focus?: "dispatch" | "training"; price?: number }[] = [
  { name: "派遣 10", w: 10, c: 0 },
  { name: `派遣 ${half}`, w: half, c: 0 },
  { name: `派遣 ${mw}`, w: mw, c: 0 },
  { name: "班 2", w: 0, c: Math.min(2, mc) },
  { name: `班 ${mc}`, w: 0, c: mc },
  { name: `派遣 ${half} + 班 2 專攻派遣`, w: half, c: Math.min(2, mc), focus: "dispatch" },
  { name: `派遣 ${half} + 班 2 不專攻`, w: half, c: Math.min(2, mc) },
  { name: `全開 ${mw}+${mc}`, w: mw, c: mc, focus: "dispatch" },
  { name: `派遣 ${half} 報價 1.2`, w: half, c: 0, price: 1.2 },
];
for (const cfg of configs) {
  const v: StaffingState = { since: 0, workers: cfg.w, classes: cfg.c, xp: { dispatch: 0, training: 0 }, hist: [], profit: 0, ...(cfg.focus ? { focus: cfg.focus } : {}), ...(cfg.price ? { priceMult: cfg.price } : {}) };
  const upfront = VENTURE_BY_KIND.staffing!.cost + cfg.w * STAFF_HIRE_COST + cfg.c * CLASS_OPEN_COST;
  let cum = -upfront;
  let payback = -1;
  let year = 0;
  for (let d = 0; d < 365; d++) {
    const r = staffingDay(v, START_DAY + d, shops);
    cum += r.revenue - r.cost;
    year += r.revenue - r.cost;
    if (cfg.w > 0) v.xp.dispatch += cfg.focus === "dispatch" ? 1.5 : 1;
    if (cfg.c > 0) v.xp.training += cfg.focus === "training" ? 1.5 : 1;
    if (payback < 0 && cum >= 0) payback = d + 1;
  }
  console.log(`${cfg.name.padEnd(24)} 投入 ${(upfront / 1e6).toFixed(1)}M  一年淨利 ${(year / 1e6).toFixed(1)}M  日均 ${(year / 365 / 1000).toFixed(0)}k  回收 ${payback < 0 ? "一年內未回收" : `${payback} 天`}`);
}
