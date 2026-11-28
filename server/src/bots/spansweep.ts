/**
 * 大店 vs 小店（樓層空地化的平衡掃描）：同一個業態、同樣 2 格面積，比較
 *   A：1 間 2 格大店　B：2 間 1 格小店（同業互搶客，這是關鍵）　C：1 間 1 格小店（基準）
 * 輸出 40 遊戲日的平均「日營收／日毛利（扣變動成本與人事）／投入建造費／回本天數」。
 *
 * 用法（在 Windows 鏡像資料夾內）：
 *   npx tsx --tsconfig tsconfig.json server/src/bots/spansweep.ts [業態,業態…] [天數] [種子數]
 */
import { CATEGORY_BY_ID, OPEN_PLAN_FLAG, STARTER_QUESTS, liveSlots, shopWagePerDay, spanCostFactor, type MallState } from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, type Command } from "../sim";

const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const CATS = (process.argv[2] ?? "grocery,gym,karaoke,electronics,kids_play,arcade_vr,camera,observatory,art_gallery,claw").split(",");
const DAYS = Number(process.argv[3] ?? 40);
const SEEDS = Number(process.argv[4] ?? 6);

const apply = (s: MallState, c: Command): MallState => {
  const r = applyCommand(s, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

interface Out {
  rev: number;
  gross: number;
  cost: number;
}

function run(cat: string, layout: "big" | "two" | "one"): Out | null {
  const def = CATEGORY_BY_ID[cat]!;
  let rev = 0;
  let gross = 0;
  let cost = 0;
  let n = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    let s = createInitialState(seed, START, 0);
    s.level = 9;
    s.funds = 2_000_000_000;
    s.flags[`zone:${def.zone}`] = true;
    s.flags[OPEN_PLAN_FLAG] = true;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    const free = () => liveSlots(s, def.zone).filter((x) => !x.shopId && !s.builds.some((b) => b.slot === x.id));
    const ids: number[] = [];
    try {
      if (layout === "big") {
        const slot = free().find((x) => applyCommand(s, { type: "buildShop", slot: x.id, category: cat, span: 2 }).ok);
        if (!slot) return null;
        s = apply(s, { type: "buildShop", slot: slot.id, category: cat, span: 2 });
        ids.push(slot.id);
        cost += def.buildCost * spanCostFactor(2);
      } else {
        const k = layout === "two" ? 2 : 1;
        for (let i = 0; i < k; i++) {
          const slot = free()[0]!;
          s = apply(s, { type: "buildShop", slot: slot.id, category: cat });
          ids.push(slot.id);
          cost += def.buildCost;
        }
      }
    } catch {
      return null;
    }
    s = advanceTo(s, s.tick + 2_000);
    const shops = ids.map((id) => s.shops.find((x) => x.slot === id)!);
    const t0 = s.reports.length;
    s = advanceTo(s, s.tick + DAYS * 288);
    let seedRev = 0;
    for (const r of s.reports.slice(t0)) for (const sh of shops) seedRev += r.shops.find((x) => x.id === sh.id)?.revenue ?? 0;
    rev += seedRev;
    gross += seedRev;
    let wage = 0;
    for (const sh of shops) wage += shopWagePerDay(s, s.shops.find((x) => x.id === sh.id)!) * DAYS;
    gross -= wage;
    n++;
  }
  const perDay = (x: number) => x / n / DAYS;
  return { rev: perDay(rev), gross: perDay(gross - rev * def.costRatio), cost: cost / n };
}

const fmt = (o: Out | null): string => (o ? `營收 ${Math.round(o.rev).toLocaleString()}／毛利 ${Math.round(o.gross).toLocaleString()}／建造 ${Math.round(o.cost).toLocaleString()}／回本 ${o.gross > 0 ? Math.round(o.cost / o.gross) : "∞"} 天` : "（放不下）");

for (const cat of CATS) {
  const def = CATEGORY_BY_ID[cat]!;
  const one = run(cat, "one");
  const two = run(cat, "two");
  const big = run(cat, "big");
  const verdict = big && two ? (big.gross > two.gross * 1.05 ? "大店勝" : big.gross < two.gross * 0.95 ? "小店勝" : "接近") : "-";
  console.log(`${cat}（${def.name}）\n  1 間小店：${fmt(one)}\n  2 間小店：${fmt(two)}\n  1 間大店：${fmt(big)}\n  → ${verdict}`);
}
