import { CATEGORY_BY_ID, LEVELS } from "./data";
import { playerScore, rivalScore } from "./rivals";
import { REGULARS } from "./regulars";
import { TECHS } from "./tech";
import type { MallState } from "./types";

// 目標、團隊事件、成就、線索收集、商場評鑑星級。全部是資料＋純函式。

// ───────── 目標 ─────────
export type GoalMetric = "groups" | "revenue" | "regularVisits" | "handled" | "walks" | "research" | "signatures" | "promos" | "tenants" | "techs" | "inspections" | "instant";

export interface GoalDef {
  id: string;
  scope: "day" | "week";
  icon: string;
  /** 顯示用的名稱，{n} 會換成目標數字 */
  name: string;
  metric: GoalMetric;
  /** 固定目標；省略時依近期平均（groups／revenue）乘上 scale */
  target?: number;
  scale?: number;
  /** 獎金＝近期平均日營收 × ratio（至少 1 萬） */
  ratio: number;
  minLevel?: number;
  needs?: "lease" | "tech";
}

export const GOALS: GoalDef[] = [
  // 每日
  { id: "d_groups", scope: "day", icon: "👥", name: "今天接待 {n} 組客人", metric: "groups", scale: 1.0, ratio: 0.008 },
  { id: "d_revenue", scope: "day", icon: "💴", name: "今天營收達 ¥{n}", metric: "revenue", scale: 1.05, ratio: 0.01 },
  { id: "d_handled", scope: "day", icon: "💬", name: "處理 {n} 則客訴或評價", metric: "handled", target: 2, ratio: 0.006 },
  { id: "d_walk", scope: "day", icon: "🚶", name: "巡場 {n} 次，聽聽客人怎麼說", metric: "walks", target: 1, ratio: 0.005 },
  { id: "d_regular", scope: "day", icon: "💞", name: "迎接常客造訪 {n} 次", metric: "regularVisits", target: 6, ratio: 0.008, minLevel: 1 },
  { id: "d_promo", scope: "day", icon: "📣", name: "辦 {n} 場優惠活動", metric: "promos", target: 1, ratio: 0.01 },
  { id: "d_clean", scope: "day", icon: "🧹", name: "打烊時館內清潔維持在 80 以上", metric: "instant", target: 1, ratio: 0.006 },
  { id: "d_stock", scope: "day", icon: "📦", name: "今天沒有任何缺貨", metric: "instant", target: 1, ratio: 0.01 },
  // 每週（團隊）
  { id: "w_groups", scope: "week", icon: "👥", name: "本週累計接待 {n} 組客人", metric: "groups", scale: 7.0, ratio: 0.06 },
  { id: "w_revenue", scope: "week", icon: "💴", name: "本週累計營收達 ¥{n}", metric: "revenue", scale: 7.2, ratio: 0.08 },
  { id: "w_handled", scope: "week", icon: "💬", name: "本週處理 {n} 則客訴或評價", metric: "handled", target: 6, ratio: 0.04 },
  { id: "w_regular", scope: "week", icon: "💞", name: "本週常客造訪累計 {n} 次", metric: "regularVisits", target: 40, ratio: 0.05 },
  { id: "w_research", scope: "week", icon: "🧪", name: "本週完成 {n} 次研發", metric: "research", target: 2, ratio: 0.05 },
  { id: "w_signature", scope: "week", icon: "🌟", name: "本週研發出 {n} 道新招牌", metric: "signatures", target: 1, ratio: 0.08 },
  { id: "w_promo", scope: "week", icon: "📣", name: "本週辦 {n} 場優惠活動", metric: "promos", target: 2, ratio: 0.05 },
  { id: "w_walk", scope: "week", icon: "🚶", name: "本週巡場 {n} 次", metric: "walks", target: 4, ratio: 0.03 },
  { id: "w_inspect", scope: "week", icon: "🧼", name: "本週通過 {n} 次稽查", metric: "inspections", target: 1, ratio: 0.05 },
  { id: "w_tenant", scope: "week", icon: "🏪", name: "本週簽下 {n} 個新租戶", metric: "tenants", target: 1, ratio: 0.08, needs: "lease", minLevel: 3 },
  { id: "w_tech", scope: "week", icon: "🔬", name: "本週完成 {n} 項科技研發", metric: "techs", target: 1, ratio: 0.08, needs: "tech", minLevel: 1 },
];
export const GOAL_BY_ID = Object.fromEntries(GOALS.map((g) => [g.id, g])) as Record<string, GoalDef>;
export const DAILY_PICKS = 3;
export const WEEKLY_PICKS = 3;
export const WEEK_DAYS = 7;
/** 一週三項全達成的額外獎勵（週獎金的倍數）與口碑 */
export const WEEK_BONUS_MULT = 1.5;

export function goalLabel(def: GoalDef, target: number): string {
  const n = def.metric === "revenue" ? target.toLocaleString("en-US") : String(target);
  return def.name.replace("{n}", n);
}

/** 目前進度：累計 − 週期開始時的累計；今天還沒結算的接待與營收也算進去 */
export function goalProgress(s: Pick<MallState, "meta" | "today" | "cleanliness" | "shops">, def: GoalDef, period: "day" | "week"): number {
  const p = period === "day" ? s.meta.day : s.meta.week;
  if (def.metric === "instant") {
    if (def.id === "d_clean") return s.cleanliness >= 80 ? 1 : 0;
    if (def.id === "d_stock") return s.shops.every((x) => x.day.stockouts === 0) ? 1 : 0;
    return 0;
  }
  const base = p.base[def.metric] ?? 0;
  let v = (s.meta.tally[def.metric] ?? 0) - base;
  if (def.metric === "groups") v += s.today.groups;
  if (def.metric === "revenue") v += s.today.revenue + s.today.rentIncome;
  if (def.metric === "regularVisits") v += s.today.regularVisits;
  return Math.max(0, v);
}

// ───────── 團隊事件 ─────────
export interface TeamTaskDef {
  id: string;
  label: string;
  cost: number;
}
export interface TeamEventDef {
  id: string;
  icon: string;
  title: string;
  text: string;
  months?: number[];
  tasks: TeamTaskDef[];
  /** 完成獎金＝近期平均日營收 × ratio */
  ratio: number;
  idx: number;
}

export const TEAM_EVENTS: TeamEventDef[] = [
  { id: "team_typhoon", icon: "🌀", title: "颱風前的全館防災", text: "氣象局發布颱風警報，商場需要在風雨來臨前做好準備。需要不同的隊員各自認領一項任務，一起把防災做完。", months: [8, 9, 10], ratio: 0.15, idx: 1.5,
    tasks: [{ id: "sign", label: "加固招牌與玻璃", cost: 20_000 }, { id: "sandbag", label: "備妥沙包與抽水機", cost: 30_000 }, { id: "route", label: "確認逃生動線並廣播", cost: 10_000 }, { id: "notify", label: "通知所有店家與租戶", cost: 5_000 }] },
  { id: "team_yearend", icon: "🎍", title: "跨年倒數籌備", text: "年底的倒數活動是一年一度的大事，燈飾、節目與人流管制都要提前準備。大家分工合作吧。", months: [12], ratio: 0.2, idx: 2,
    tasks: [{ id: "lights", label: "佈置燈飾與倒數看板", cost: 40_000 }, { id: "show", label: "排定倒數節目", cost: 30_000 }, { id: "flow", label: "規劃人流動線與保全", cost: 15_000 }, { id: "snack", label: "準備熱飲與點心", cost: 20_000 }] },
  { id: "team_summer", icon: "🎆", title: "夏日祭典籌備", text: "對面老街要辦夏日祭典，商場想一起參與：攤位、浴衣體驗與煙火觀賞區，都需要人手。", months: [6, 7, 8], ratio: 0.15, idx: 1.5,
    tasks: [{ id: "booth", label: "規劃攤位與抽籤", cost: 25_000 }, { id: "yukata", label: "準備浴衣體驗區", cost: 20_000 }, { id: "view", label: "開放屋頂觀賞區", cost: 15_000 }, { id: "clean", label: "安排活動後的清掃", cost: 10_000 }] },
  { id: "team_spring", icon: "🌸", title: "春季大掃除", text: "新年度開始，商場要來一次徹底的大掃除與設備檢修，讓客人在櫻花季一進門就覺得煥然一新。", months: [3, 4], ratio: 0.12, idx: 1,
    tasks: [{ id: "deep", label: "深層清潔公共區域", cost: 20_000 }, { id: "equip", label: "檢修電梯與空調", cost: 30_000 }, { id: "sign2", label: "更新樓層導覽牌", cost: 15_000 }, { id: "plants", label: "換上春季盆栽與佈置", cost: 10_000 }] },
  { id: "team_anniv", icon: "🎉", title: "商場週年慶籌備", text: "開幕週年快到了！想一起辦個像樣的慶祝：抽獎、折扣與感謝老主顧的小禮物。", ratio: 0.15, idx: 1.5,
    tasks: [{ id: "lottery", label: "準備抽獎獎品", cost: 30_000 }, { id: "gift", label: "包裝老主顧小禮物", cost: 20_000 }, { id: "deco", label: "佈置慶祝裝飾", cost: 15_000 }, { id: "post", label: "製作活動海報與推播", cost: 10_000 }] },
];
export const TEAM_EVENT_BY_ID = Object.fromEntries(TEAM_EVENTS.map((e) => [e.id, e])) as Record<string, TeamEventDef>;
/** 團隊事件的期限：3 個遊戲日（標準流速約 18 個真實小時） */
export const TEAM_EVENT_TICKS = 3 * 288;
export const TEAM_EVENT_GAP_DAYS = 7;
export const TEAM_PARTIAL_RATIO = 0.4;

// ───────── 成就 ─────────
export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** 隱藏成就在解鎖前只顯示「？」 */
  secret?: boolean;
  /** 解鎖獎金（固定） */
  reward?: number;
  /** 稱號：解鎖後可以掛在商場名稱旁 */
  title?: string;
  check: (s: MallState) => boolean;
}

const tally = (s: MallState, k: string) => s.meta.tally[k] ?? 0;
const metRegulars = (s: MallState) => s.regulars.filter((r) => r.met).length;
const days = (s: MallState) => Math.floor((s.tick - s.meta.startTick) / 288);
const tenants = (s: MallState) => s.shops.filter((x) => x.tenant && !x.tenant.own).length;
const branchDone = (s: MallState, b: string) => TECHS.filter((t) => t.branch === b).every((t) => s.tech.done.includes(t.id));

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "a_day1", icon: "🎊", name: "開幕大吉", desc: "商場平安營業滿一個遊戲日", reward: 20_000, check: (s) => days(s) >= 1 },
  { id: "a_day30", icon: "📆", name: "站穩腳步", desc: "商場營業滿 30 個遊戲日", reward: 200_000, title: "新銳", check: (s) => days(s) >= 30 },
  { id: "a_day100", icon: "🏯", name: "老字號的味道", desc: "商場營業滿 100 個遊戲日", reward: 1_000_000, title: "老字號", check: (s) => days(s) >= 100 },
  { id: "a_year", icon: "🎂", name: "週年快樂", desc: "商場營業滿一整年（365 個遊戲日）", reward: 5_000_000, title: "百年計畫", check: (s) => days(s) >= 365 },
  { id: "a_rev1", icon: "💴", name: "累計營收一億", desc: "累計營收達 ¥100,000,000", reward: 100_000, check: (s) => s.totalRevenue >= 1e8 },
  { id: "a_rev2", icon: "💰", name: "累計營收十億", desc: "累計營收達 ¥1,000,000,000", reward: 1_000_000, check: (s) => s.totalRevenue >= 1e9 },
  { id: "a_rev3", icon: "🏦", name: "累計營收百億", desc: "累計營收達 ¥10,000,000,000", reward: 10_000_000, title: "巨擘", check: (s) => s.totalRevenue >= 1e10 },
  { id: "a_lv3", icon: "⬆️", name: "升級！Lv.3", desc: "商場升到 Lv.3", reward: 300_000, check: (s) => s.level >= 3 },
  { id: "a_lv5", icon: "🌆", name: "升級！Lv.5", desc: "商場升到 Lv.5", reward: 1_000_000, check: (s) => s.level >= 5 },
  { id: "a_lvmax", icon: "👑", name: "頂級複合商場", desc: `商場升到最高等級（Lv.${LEVELS.length}）`, reward: 10_000_000, title: "殿堂", check: (s) => s.level >= LEVELS.length },
  { id: "a_shops8", icon: "🏬", name: "八間店的美食街", desc: "同時經營 8 間店", reward: 100_000, check: (s) => s.shops.length >= 8 },
  { id: "a_shops25", icon: "🏙️", name: "大型複合商場", desc: "同時經營 25 間店", reward: 2_000_000, check: (s) => s.shops.length >= 25 },
  { id: "a_regular1", icon: "🤝", name: "第一位熟客", desc: "認識第一位常客", reward: 20_000, check: (s) => metRegulars(s) >= 1 },
  { id: "a_regular_all", icon: "💞", name: "街坊都來了", desc: `認識全部 ${REGULARS.length} 位常客`, reward: 1_500_000, title: "街坊的朋友", check: (s) => metRegulars(s) >= REGULARS.length },
  { id: "a_friend", icon: "🍶", name: "老朋友", desc: "和一位常客的親密度達到 100", reward: 200_000, check: (s) => s.regulars.some((r) => r.affinity >= 100) },
  { id: "a_handle10", icon: "🙇", name: "有問必答", desc: "累計處理 10 則客訴或評價", reward: 50_000, check: (s) => tally(s, "handled") >= 10 },
  { id: "a_handle100", icon: "🛎️", name: "客服達人", desc: "累計處理 100 則客訴或評價", reward: 500_000, title: "服務之星", check: (s) => tally(s, "handled") >= 100 },
  { id: "a_walk20", icon: "🚶", name: "愛巡場的老闆", desc: "巡場 20 次", reward: 100_000, check: (s) => tally(s, "walks") >= 20 },
  { id: "a_research1", icon: "🧪", name: "實驗室誕生", desc: "完成第一次研發", reward: 30_000, check: (s) => tally(s, "research") >= 1 },
  { id: "a_sig1", icon: "🌟", name: "第一道招牌", desc: "研發出第一道隱藏配方的招牌", reward: 200_000, check: (s) => s.workshop.discovered.length >= 1 },
  { id: "a_sig5", icon: "📖", name: "配方收藏家", desc: "發現 5 道隱藏配方", reward: 1_000_000, title: "匠人", check: (s) => s.workshop.discovered.length >= 5 },
  { id: "a_sig15", icon: "🧑‍🍳", name: "傳說的配方", desc: "發現 15 道隱藏配方", reward: 5_000_000, title: "傳說的味道", check: (s) => s.workshop.discovered.length >= 15 },
  { id: "a_oldfriend", icon: "📦", name: "老交情", desc: "和一家供應商的關係達到 80", reward: 300_000, check: (s) => s.supply.suppliers.some((x) => x.relationship >= 80) },
  { id: "a_top", icon: "🏆", name: "評鑑榜首", desc: "在商場評鑑榜上排名第一", reward: 500_000, check: (s) => playerScore(s) >= Math.max(...s.rivals.list.map((r) => rivalScore(r, s.tick))) },
  { id: "a_tenant1", icon: "🏪", name: "第一位房客", desc: "與第一個品牌簽下租約", reward: 100_000, check: (s) => tally(s, "tenants") >= 1 },
  { id: "a_tenant5", icon: "🏢", name: "品牌聚集地", desc: "同時有 5 個簽約租戶", reward: 1_000_000, title: "房東", check: (s) => tenants(s) >= 5 },
  { id: "a_tech1", icon: "🔬", name: "科技的起點", desc: "完成第一項科技研發", reward: 100_000, check: (s) => s.tech.done.length >= 1 },
  { id: "a_tech_branch", icon: "🤖", name: "專精一門", desc: "完成一整條科技線", reward: 1_500_000, check: (s) => ["guide", "ops", "energy", "tenant"].some((b) => branchDone(s, b)) },
  { id: "a_tech_all", icon: "🏙️", name: "科技大樓", desc: "完成所有科技", reward: 10_000_000, title: "近未來", check: (s) => s.tech.done.length >= TECHS.length },
  { id: "a_tax1", icon: "🧾", name: "依法納稅", desc: "繳納第一筆稅金", reward: 0, check: (s) => Object.values(s.tax.totalPaid).some((v) => v > 0) },
  { id: "a_tax_big", icon: "🏛️", name: "納稅大戶", desc: "累計繳納稅金與保險 ¥10 億", reward: 2_000_000, title: "納稅大戶", check: (s) => Object.values(s.tax.totalPaid).reduce((a, b) => a + b, 0) >= 1e9 },
  { id: "a_inspect", icon: "🧼", name: "優良事業所", desc: "累計通過 5 次稽查", reward: 300_000, check: (s) => tally(s, "inspections") >= 5 },
  { id: "a_promo10", icon: "📣", name: "活動名人", desc: "累計辦 10 場優惠活動", reward: 300_000, check: (s) => tally(s, "promos") >= 10 },
  { id: "a_team", icon: "🧑‍🤝‍🧑", name: "大家一起來", desc: "完成一次團隊事件", reward: 500_000, check: (s) => tally(s, "teamDone") >= 1 },
  { id: "a_goals", icon: "🎯", name: "目標達人", desc: "累計達成 30 個目標", reward: 500_000, check: (s) => tally(s, "goalsDone") >= 30 },
  { id: "a_clues10", icon: "🔎", name: "留心的人", desc: "收集 10 則線索", reward: 100_000, secret: true, check: (s) => Object.keys(s.meta.clues).length >= 10 },
  { id: "a_place", icon: "🗺️", name: "我知道這是哪裡", desc: "猜出這座商場的所在地", reward: 3_000_000, title: "在地通", secret: true, check: (s) => s.meta.placeSolved },
];
export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a])) as Record<string, AchievementDef>;

// ───────── 線索收集（含蓄地提示這座商場在哪裡） ─────────
export interface ClueDef {
  id: string;
  icon: string;
  text: string;
  /** 發現的條件 */
  when: (s: MallState) => boolean;
}
const seen = (s: MallState, id: string) => (s.meta.seen[id] ?? 0) > 0;
const has = (s: MallState, c: string) => s.shops.some((x) => x.category === c);
const regAff = (s: MallState, id: string, a: number) => (s.regulars.find((r) => r.id === id)?.affinity ?? 0) >= a;

export const CLUES: ClueDef[] = [
  { id: "c_sauce", icon: "🍢", text: "串炸店的牆上貼著一張老舊的告示：「沾醬，只能沾一次。」客人們都很自覺。", when: (s) => has(s, "kushikatsu") },
  { id: "c_tako", icon: "🐙", text: "章魚燒師傅說：「我們這一帶，家家戶戶都有一個章魚燒鐵板，就像別的地方有電鍋。」", when: (s) => has(s, "takoyaki") },
  { id: "c_aunt", icon: "🗣️", text: "阿富叔說話時總愛在句尾加一句「なんでやねん」，連觀光客都學會了。", when: (s) => regAff(s, "afu", 30) },
  { id: "c_tower", icon: "🗼", text: "夜裡從屋頂往對面看，老街那頭有一座會變換顏色的高塔，據說明天的天氣就藏在顏色裡。", when: (s) => seen(s, "tower_lights") },
  { id: "c_baseball", icon: "⚾", text: "球隊贏球的晚上，整條街的人會一起唱同一首歌，唱到嗓子啞掉。", when: (s) => seen(s, "team_win") },
  { id: "c_airport", icon: "✈️", text: "站前的電車線有一班直通機場，班機一誤點，月台就擠滿了拖著行李箱的旅客。", when: (s) => seen(s, "airport_chaos") },
  { id: "c_festival", icon: "🥁", text: "夏天有一場以河為舞台的大祭典，鼓聲能傳好幾條街，船上的燈籠像一串星星。", when: (s) => seen(s, "summer_festival") },
  { id: "c_rain", icon: "☔", text: "梅雨季的雨像是永遠下不完，老街的阿嬤說：「這時候最適合在店裡吃熱呼呼的炸物。」", when: (s) => seen(s, "rainy_season") },
  { id: "c_zoo", icon: "🦁", text: "週末的家庭客裡，常有人說「剛從動物園出來」，孩子們手上還拿著獅子的氣球。", when: (s) => (s.meta.tally.groups ?? 0) >= 30_000 && s.level >= 2 },
  { id: "c_shopping", icon: "🔌", text: "往北走一段，有條專賣電器與動漫周邊的老街，假日滿滿都是打扮成角色的年輕人。", when: (s) => seen(s, "z_cul_cosplay") || has(s, "electronics") },
  { id: "c_view", icon: "🏙️", text: "展望台往南看是一座像是被切開的高樓，往北看是一座老塔，兩座塔之間就是這座商場。", when: (s) => has(s, "observatory") },
  { id: "c_izakaya", icon: "🍶", text: "老街的立飲酒館傍晚就擠滿了人，大家站著喝、站著聊，一杯酒的價錢便宜得讓人不好意思。", when: (s) => has(s, "izakaya") || s.level >= 6 },
  { id: "c_fugu", icon: "🐡", text: "景觀餐廳的主廚說，最有名的冬季料理，是一種要有執照才能處理的河中怪魚。", when: (s) => has(s, "fine_dining") || has(s, "sushi") },
  { id: "c_neon", icon: "💡", text: "老街的霓虹招牌亮起時，每一塊都是手工彎出來的：一隻巨大的螃蟹、一個笑得很開的廚師。", when: (s) => (s.meta.tally.groups ?? 0) >= 10_000 },
  { id: "c_showa", icon: "📻", text: "「昭和」是這裡的口頭禪：老店、老味道、老朋友。商場的人說，我們是來跟昭和做鄰居的。", when: (s) => s.workshop.discovered.includes("rc_r_showa") || regAff(s, "obaa", 30) },
  { id: "c_community", icon: "🏘️", text: "這一帶住著很多辛苦工作了一輩子的人。老街的互助會長說：「歡迎來，但請記得，這裡是大家的家。」", when: (s) => (s.meta.tally.tenants ?? 0) >= 1 || s.level >= 4 },
  { id: "c_year", icon: "🎍", text: "跨年時，老街的小廟前會排起長長的隊伍，人們雙手合十，一起迎接新的一年。", when: (s) => seen(s, "year_end_countdown") || seen(s, "z_plaza_fireworks") },
  { id: "c_bank", icon: "🏦", text: "財務部的人說：消費稅、法人稅、固定資產稅，什麼都有，連 8% 和 10% 的差別都得記住。", when: (s) => Object.values(s.tax.totalPaid).some((v) => v > 0) },
  { id: "c_zones", icon: "🚉", text: "車站的出口標示有三種語言，其中一種是你每天都在聽的關西腔。", when: (s) => s.level >= 3 },
  { id: "c_map", icon: "🗺️", text: "有位旅客把你們的商場標在地圖上，說：「就在那座塔的腳下，過了鐵道就是。」", when: (s) => (s.meta.clues ? Object.keys(s.meta.clues).length >= 8 : false) },
];
export const CLUE_BY_ID = Object.fromEntries(CLUES.map((c) => [c.id, c])) as Record<string, ClueDef>;

/** 猜地點：只比對雜湊，程式碼裡不放答案本身 */
export const PLACE_HASHES = ["d67516287c898a6a71ade603", "e90f378f774e50f65f52ad89", "3012ba4c52f98a6aaaf05afd", "5b9d76a77efc434f02ee3094", "2fbd5f4da1fb6d2f267e3164", "8c1f99e83218313e10d5032e", "70c435a21e9799bb72d0be99", "279e471afc6067bfcbe52ffb", "17b64084c5b699bfc22c87d6", "c8fd6fb1f3808493c41eeaf8", "bfe60d500e9ec73ea169637a", "3cf06e75a91387c1d95dfc56", "c8b69e9a20c84a1f503f237b", "0729fa0ed3c2c0ac0918aba0"];
export const PLACE_HASH_SALT = "coidle-place:";
export const PLACE_GUESS_COOLDOWN = 288;
export function normalizeGuess(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 40);
}
export const PLACE_REWARD = 3_000_000;

// ───────── 商場評鑑星級 ─────────
/** 綜合分數 0–100：等級、口碑、合規、成就、規模與多樣性 */
export function mallScore(s: MallState): number {
  const lv = (s.level / LEVELS.length) * 35;
  const idx = (((s.localRep + s.touristHeat) / 2) / 100) * 25;
  const comp = (s.inspections.compliance / 100) * 10;
  const ach = (Object.keys(s.meta.achievements).filter((k) => ACHIEVEMENT_BY_ID[k]).length / ACHIEVEMENTS.length) * 15;
  const cats = new Set(s.shops.map((x) => CATEGORY_BY_ID[x.category]?.group)).size;
  const div = (Math.min(cats, 4) / 4) * 5 + Math.min(1, s.shops.length / 30) * 10;
  return Math.max(0, Math.min(100, lv + idx + comp + ach + div));
}
export function mallStars(s: MallState): number {
  return Math.max(1, Math.min(5, Math.ceil(mallScore(s) / 20)));
}

// ───────── 新手任務 ─────────
export interface StarterQuest {
  id: string;
  icon: string;
  name: string;
  hint: string;
  reward: number;
  check: (s: MallState) => boolean;
}
const cmd = (s: MallState, type: string) => (s.meta.tally[`cmd_${type}`] ?? 0) > 0;
/** 完成會自動領獎金；用「q_」開頭的 id 記在成就表裡 */
export const STARTER_QUESTS: StarterQuest[] = [
  { id: "q_look", icon: "🏬", name: "逛逛你的店", hint: "到「樓層」點開任何一間店，看看它的售價、庫存與經營狀況。", reward: 30_000, check: (s) => cmd(s, "touch") || s.tick > s.meta.startTick + 6 },
  { id: "q_price", icon: "🏷️", name: "調整一次售價", hint: "在店面詳情改價格：定太高客人跑掉，定太低又賺不到。", reward: 50_000, check: (s) => cmd(s, "setPrice") },
  { id: "q_hours", icon: "🕒", name: "設定營業時間", hint: "到「更多 → 營運」看客流曲線，把營業時間調到尖峰時段。", reward: 50_000, check: (s) => cmd(s, "setHours") },
  { id: "q_stock", icon: "📦", name: "設定補貨或手動進貨", hint: "缺貨會讓客人白跑一趟。在店面詳情設定自動補貨，或手動進一批。", reward: 50_000, check: (s) => cmd(s, "setRestock") || cmd(s, "orderStock") },
  { id: "q_walk", icon: "🚶", name: "巡場一次", hint: "到「客人」分頁按「巡場」，聽聽此刻店裡客人的心聲。", reward: 50_000, check: (s) => cmd(s, "walkFloor") },
  { id: "q_report", icon: "📰", name: "迎接第一份日報", hint: "每個遊戲日結束會出一份日報（標準流速約 6 個真實小時）。回來看看賺了多少。", reward: 50_000, check: (s) => s.reports.length >= 1 },
  { id: "q_build", icon: "🏗️", name: "開一間新店", hint: "到「樓層」點空的店面招商開店。業態越多元，整體客流越大。", reward: 100_000, check: (s) => cmd(s, "buildShop") },
  { id: "q_promo", icon: "📣", name: "辦一場優惠活動", hint: "到「更多 → 行銷」排一場活動，客流會增加，客人也更滿意。", reward: 50_000, check: (s) => cmd(s, "schedulePromo") },
  { id: "q_research", icon: "🧪", name: "試做一次研發", hint: "到「工坊」選素材試做新菜或新品，運氣好會做出隱藏的招牌。", reward: 100_000, check: (s) => cmd(s, "startRnd") },
  { id: "q_invite", icon: "👥", name: "邀請一位朋友", hint: "到「更多 → 團隊」複製邀請碼給朋友。團隊事件需要不同的隊員一起完成。", reward: 200_000, check: (s) => s.meta.team.size >= 2 },
];
export const STARTER_BY_ID = Object.fromEntries(STARTER_QUESTS.map((q) => [q.id, q])) as Record<string, StarterQuest>;
