// 用法：npx tsx --tsconfig tsconfig.json server/src/bots/catsweep.ts [天數] [其他店倍率] [業態1,業態2,...] [倍率,逗號分隔]
// 分業態驗證最佳標價：一間商場放 5 間店，只動「其中一間」的標價倍率，其餘店固定在「其他店倍率」，
// 看這間店（與整座商場）的毛利怎麼變。毛利＝營收 − 賣出份數 × 參考價 × 成本比（和遊戲內損益用的估算一樣）。
// 例：catsweep.ts 24 1 kushikatsu,takoyaki,ramen,kissaten,grocery
import { CATEGORY_BY_ID, type MallState } from "@coidle/shared";
import { runBot } from "./bots";
import { makeShop } from "../sim/state";

const days = Number(process.argv[2] ?? 24);
const others = Number(process.argv[3] ?? 1);
const cats = (process.argv[4] ?? "kushikatsu,takoyaki,ramen,kissaten,grocery").split(",");
const mults = (process.argv[5] ?? "0.8,1,1.2,1.4,1.6,2,2.5").split(",").map(Number);
const seeds = [101, 202, 303];
const keep = Math.max(6, Math.floor(days / 2));

function setup(s: MallState, target: string, m: number): void {
  // 換成指定的 5 間業態，每間一個位子
  cats.forEach((c, i) => {
    const old = s.shops[i];
    const slot = s.slots[i];
    if (!slot) return;
    const shop = makeShop(s, c, `${c}`, slot.id);
    if (old) s.shops[i] = shop;
    else s.shops.push(shop);
    slot.shopId = shop.id;
    shop.price = Math.max(1, Math.round(shop.price * (c === target ? m : others)));
  });
  s.shops.length = cats.length;
}

console.log(`其他店 ×${others}，${days} 天（取最後 ${keep} 天平均），${seeds.length} 個種子；業態：${cats.join(" ")}`);
for (const target of cats) {
  const cat = CATEGORY_BY_ID[target]!;
  console.log(`\n【${target}】參考價 ${cat.refPrice}，成本比 ${cat.costRatio}`);
  let best = { m: 0, g: -1 };
  for (const m of mults) {
    const acc = { units: 0, gross: 0, rev: 0, walks: 0, mall: 0, local: 0, n: 0 };
    for (const seed of seeds) {
      const r = runBot("lazy", seed, days, { sampleEvery: 1, mutate: (s) => setup(s, target, m) });
      const reps = r.final.reports.slice(-keep);
      for (const rep of reps) {
        let mall = 0;
        for (const sh of rep.shops) {
          const c = CATEGORY_BY_ID[sh.category]!;
          const g = sh.revenue - sh.units * c.refPrice * c.costRatio;
          mall += g;
          if (sh.category === target) {
            acc.units += sh.units;
            acc.rev += sh.revenue;
            acc.gross += g;
            acc.walks += sh.priceWalks ?? 0;
          }
        }
        acc.mall += mall;
        acc.n++;
      }
      acc.local += r.final.localRep;
    }
    const n = acc.n;
    const gross = acc.gross / n;
    if (gross > best.g) best = { m, g: gross };
    console.log(
      `  ×${String(m).padEnd(4)} 該店 份數 ${(acc.units / n).toFixed(0).padStart(4)}  營收 ${(acc.rev / n / 1e3).toFixed(0).padStart(4)}k  毛利 ${(gross / 1e3).toFixed(0).padStart(4)}k  嫌貴 ${(acc.walks / n).toFixed(0).padStart(4)}  | 全商場毛利 ${(acc.mall / n / 1e3).toFixed(0).padStart(5)}k  口碑 ${(acc.local / seeds.length).toFixed(0)}`,
    );
  }
  console.log(`  → 該店毛利最高在 ×${best.m}`);
}
