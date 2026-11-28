import { CATEGORY_BY_ID, CURRENCY, PERSONA_IDS, summarizeWeatherDay, weatherReportNote, type DailyReport, type MallState, type PersonaId } from "@coidle/shared";
import { flavor, type FlavorMood } from "./flavor";
import { hash32 } from "./rng";

const fmt = (n: number) => `${CURRENCY}${Math.round(n).toLocaleString("en-US")}`;

/** 從風味內容池挑一則符合今天氣氛的小快訊（沒有內容池就不加） */
function pickBlurb(s: MallState, profit: number, complaints: number, events: number): string | null {
  const h = hash32(s.seed ^ 0x51ab, s.tick);
  const mood: FlavorMood = profit < 0 || complaints >= 3 ? "bad" : profit > 0 && h % 3 === 0 ? "good" : h % 2 === 0 ? "season" : "neutral";
  const pool = flavor().news(events > 0 && mood === "neutral" ? "season" : mood);
  return pool.length > 0 ? (pool[(h >>> 4) % pool.length] ?? null) : null;
}

/** 把「剛結束的這一天」結算成日報。呼叫時 s.today 仍是該日資料。 */
export function buildReport(s: MallState): DailyReport {
  const d = s.today;
  const profit = d.revenue + d.rentIncome - d.purchases - d.fixed - d.repairs + (d.invest ?? 0);
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
    level: sh.level,
    price: sh.price,
    refPrice: CATEGORY_BY_ID[sh.category]?.refPrice,
    priceWalks: sh.day.priceWalks ?? 0,
  }));

  const notes: string[] = [];
  // 天氣放在最前面：解釋今天客流為什麼特別多或少
  const weather = summarizeWeatherDay(d.wx, d.temp);
  const weatherNote = weather ? weatherReportNote(weather, s.cleaningLevel) : null;
  if (weatherNote) notes.push(weatherNote);
  const best = shops.slice().sort((a, b) => b.revenue - a.revenue)[0];
  if (best && best.revenue > 0) notes.push(`「${best.name}」是今日冠軍店，賣了 ${fmt(best.revenue)}。`);
  for (const sh of shops) {
    if (sh.stockouts >= 3) notes.push(`「${sh.name}」缺貨 ${sh.stockouts} 次，客人只好跑去別家了。`);
    if (sh.lost >= 5) notes.push(`「${sh.name}」忙不過來，${sh.lost} 組客人排不到位子。`);
    if ((sh.priceWalks ?? 0) >= 5) notes.push(`「${sh.name}」標價太高，${sh.priceWalks} 組客人看了價格就走。`);
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
  if (s.funds < 0) notes.push("帳上資金為負，自動補貨只剩供應商賒帳的額度，快想辦法周轉！可以到「財務 → 融資與保險」看能向哪家金融機構借款。");
  if (s.finance?.restructure) notes.push("🏦 重整中：擴建與大額支出凍結，貸款還清後解除。");
  if ((d.invest ?? 0) !== 0) notes.push(`📈 今天的投資損益 ${(d.invest ?? 0) >= 0 ? "+" : "−"}${fmt(Math.abs(d.invest ?? 0))}（賣股損益與配息，年度決算時併入所得課稅）。`);
  if ((d.interestCost ?? 0) > 0) notes.push(`🏦 今天付了貸款利息 ${fmt(d.interestCost ?? 0)}。`);
  for (const n of d.systemNotes.slice(0, 4)) notes.push(n);
  const blurb = pickBlurb(s, profit, d.complaints, d.events.length);
  if (blurb) notes.push(`📰 ${blurb}`);
  if (d.regularVisits > 0) notes.push(`常客造訪 ${d.regularVisits} 次。`);
  for (const n of d.regularNotes.slice(0, 3)) notes.push(n);
  if (d.complaints > 0) notes.push(`收到 ${d.complaints} 則客訴。`);
  if ((d.legalCost ?? 0) > 0) notes.push(`⚖️ 法律糾紛支出 ${fmt(d.legalCost ?? 0)}（和解金、判決金、律師費，已扣掉保險給付）。`);
  if (s.patrol) {
    const known = s.patrol.issues.filter((i) => i.status !== "hidden");
    const worst = known.slice().sort((a, b) => b.severity - a.severity)[0];
    if (known.length > 0) notes.push(`🚶 已知還沒處理的問題 ${known.length} 件${worst && worst.severity >= 4 ? "，其中有嚴重的，再不處理就要出事了" : ""}。`);
  }
  if (s.members && s.members.count > 0) {
    const m = s.members;
    notes.push(`🪪 會員 ${m.count.toLocaleString("en-US")} 人，今天發出點數 ${fmt(s.today.memberIssued ?? 0)}、兌換 ${fmt(s.today.memberCost ?? 0)}（未使用點數累計 ${fmt(m.points)}）。`);
  }
  for (const c of s.legal?.cases ?? []) notes.push(`⚖️ 「${c.shopName}」的糾紛還在處理中，記得在期限內回應。`);
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
    ...(d.invest ? { invest: d.invest } : {}),
    stockBought: d.stockBought ?? 0,
    stockCost: d.stockCost ?? 0,
    groups: d.groups,
    units: d.units,
    walkouts: d.walkouts,
    priceWalks: d.priceWalks ?? 0,
    avgSat,
    shops,
    localRep: { start: d.startIndex.localRep, end: s.localRep },
    touristHeat: { start: d.startIndex.touristHeat, end: s.touristHeat },
    events: d.events.slice(),
    headline,
    notes,
    guest: { complaints: d.complaints, reviews: d.reviews, avgStars: d.reviews > 0 ? d.starsSum / d.reviews : null },
    weather,
  };
}
