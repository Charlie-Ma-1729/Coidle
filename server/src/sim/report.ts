import { CURRENCY, PERSONA_IDS, type DailyReport, type MallState, type PersonaId } from "@coidle/shared";

const fmt = (n: number) => `${CURRENCY}${Math.round(n).toLocaleString("en-US")}`;

/** 把「剛結束的這一天」結算成日報。呼叫時 s.today 仍是該日資料。 */
export function buildReport(s: MallState): DailyReport {
  const d = s.today;
  const profit = d.revenue + d.rentIncome - d.purchases - d.fixed - d.repairs;
  const avgSat = Object.fromEntries(
    PERSONA_IDS.map((p) => [p, d.satN[p] > 0 ? d.satSum[p] / d.satN[p] : null]),
  ) as Record<PersonaId, number | null>;

  const shops = s.shops.map((sh) => ({
    id: sh.id,
    name: sh.name,
    category: sh.category,
    revenue: sh.day.revenue,
    units: sh.day.units,
    stockouts: sh.day.stockouts,
    lost: sh.day.lost,
  }));

  const notes: string[] = [];
  const best = shops.slice().sort((a, b) => b.revenue - a.revenue)[0];
  if (best && best.revenue > 0) notes.push(`「${best.name}」是今日冠軍店，賣了 ${fmt(best.revenue)}。`);
  for (const sh of shops) {
    if (sh.stockouts >= 3) notes.push(`「${sh.name}」缺貨 ${sh.stockouts} 次，客人只好跑去別家了。`);
    if (sh.lost >= 5) notes.push(`「${sh.name}」忙不過來，${sh.lost} 組客人排不到位子。`);
  }
  for (const sh of s.shops) {
    if (sh.mode === "direct" && sh.freshness < 50) notes.push(`「${sh.name}」的菜單有點老氣了，客人覺得沒新鮮感。`);
  }
  const dl = s.localRep - d.startIndex.localRep;
  const dt = s.touristHeat - d.startIndex.touristHeat;
  if (Math.abs(dl) >= 1) notes.push(`在地口碑 ${dl > 0 ? "上升" : "下滑"} ${Math.abs(dl).toFixed(1)}。`);
  if (Math.abs(dt) >= 1) notes.push(`觀光熱度 ${dt > 0 ? "上升" : "下滑"} ${Math.abs(dt).toFixed(1)}。`);
  if (s.cleanliness < 40) notes.push("館內越來越髒了，客人開始皺眉頭。");
  if (s.equipment < 40) notes.push("設備老舊，再不維護恐怕會出狀況。");
  if (s.funds < 0) notes.push("帳上資金為負，自動補貨已暫停，快想辦法周轉！");
  if (d.regularVisits > 0) notes.push(`常客造訪 ${d.regularVisits} 次。`);
  for (const n of d.regularNotes.slice(0, 3)) notes.push(n);
  if (d.complaints > 0) notes.push(`收到 ${d.complaints} 則客訴。`);
  if (d.reviews > 0) notes.push(`網路上多了 ${d.reviews} 則評價，平均 ${(d.starsSum / d.reviews).toFixed(1)} 顆星。`);
  if (d.events.length > 0) notes.push(`今日事件：${d.events.join("、")}。`);

  let headline: string;
  if (d.groups === 0) headline = "整天沒客人上門，營業時間是不是設錯啦？";
  else if (profit > 0) headline = `進帳 ${fmt(profit)}，ぼちぼち賺到了！`;
  else headline = `今天虧了 ${fmt(-profit)}……明天再加油啦。`;

  return {
    day: d.day,
    date: new Date(d.day * 86_400_000).toISOString().slice(0, 10),
    revenue: d.revenue,
    rentIncome: d.rentIncome,
    purchases: d.purchases,
    fixed: d.fixed,
    repairs: d.repairs,
    profit,
    groups: d.groups,
    units: d.units,
    walkouts: d.walkouts,
    avgSat,
    shops,
    localRep: { start: d.startIndex.localRep, end: s.localRep },
    touristHeat: { start: d.startIndex.touristHeat, end: s.touristHeat },
    events: d.events.slice(),
    headline,
    notes,
    guest: { complaints: d.complaints, reviews: d.reviews, avgStars: d.reviews > 0 ? d.starsSum / d.reviews : null },
  };
}
