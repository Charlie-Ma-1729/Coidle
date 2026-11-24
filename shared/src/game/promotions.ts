import type { InspectionKind, InspectionOutcome, InspectionPrep, PromoDef } from "./types";

// 優惠活動與稽查的資料與純函式（模擬引擎與介面共用）。

export const MAX_ACTIVE_PROMOS = 2;
export const MAX_QUEUED_PROMOS = 5;
/** 最遠可以預先排程到幾個遊戲日之後 */
export const MAX_SCHEDULE_AHEAD_TICKS = 288 * 14;
export const MAX_PROMO_HISTORY = 12;
/** 促銷疲勞每遊戲日自然消退多少 */
export const PROMO_FATIGUE_DECAY_PER_DAY = 0.04;

export const PROMOS: PromoDef[] = [
  {
    id: "discount_day",
    name: "全館折扣日",
    icon: "🏷️",
    desc: "全館小降價，在地客與學生最買單。便宜讓客人開心，但每筆賺得比較少。",
    durationTicks: 144,
    cost: 20_000,
    cooldownTicks: 288 * 2,
    discount: 0.15,
    traffic: { all: 1.25, local: 1.4, student: 1.3, commuter: 1.15 },
    satBonus: 0.04,
    fatigue: 0.18,
  },
  {
    id: "loyalty",
    name: "集點會員活動",
    icon: "💳",
    desc: "消費集點換小禮。常客的親密度增加得更快，也有助於在地口碑。",
    durationTicks: 576,
    cost: 35_000,
    cooldownTicks: 288 * 4,
    discount: 0,
    traffic: { all: 1.05, local: 1.2, family: 1.15 },
    satBonus: 0.02,
    regularGain: 1.6,
    idx: { which: "localRep", amount: 0.8 },
    fatigue: 0.1,
  },
  {
    id: "bogo",
    name: "買一送一",
    icon: "🎉",
    desc: "短時間的爆量活動。人潮很多，但等於打了七折左右，要小心缺貨和客滿。",
    durationTicks: 72,
    cost: 12_000,
    cooldownTicks: 288 * 3,
    discount: 0.3,
    traffic: { all: 1.5 },
    satBonus: 0.08,
    fatigue: 0.28,
  },
  {
    id: "collab",
    name: "聯名快閃",
    icon: "🤝",
    desc: "和潮牌聯名的限定快閃，吸引觀光客、學生與情侶，也能拉高觀光熱度。",
    durationTicks: 288,
    cost: 90_000,
    cooldownTicks: 288 * 6,
    discount: 0,
    traffic: { all: 1.1, tourist: 1.4, student: 1.4, couple: 1.3 },
    satBonus: 0.03,
    idx: { which: "touristHeat", amount: 1 },
    fatigue: 0.15,
  },
  {
    id: "ads",
    name: "觀光廣告投放",
    icon: "📣",
    desc: "在機場與網路上投放廣告，主要吸引觀光客，持續兩個遊戲日。",
    durationTicks: 576,
    cost: 60_000,
    cooldownTicks: 288 * 5,
    discount: 0,
    traffic: { all: 1, tourist: 1.5 },
    satBonus: 0,
    idx: { which: "touristHeat", amount: 0.5 },
    fatigue: 0.12,
  },
  {
    id: "anniversary",
    name: "週年慶",
    icon: "🎊",
    desc: "全館大型慶典：人潮、口碑、心情都大幅提升。成本高，也很累人，之後一陣子促銷效果會打折。",
    durationTicks: 576,
    cost: 150_000,
    cooldownTicks: 288 * 20,
    discount: 0.12,
    traffic: { all: 1.6 },
    satBonus: 0.05,
    idx: { which: "localRep", amount: 1.5 },
    freshness: 15,
    fatigue: 0.35,
  },
  {
    id: "tasting",
    name: "免費試吃",
    icon: "🍡",
    desc: "請路過的客人試吃小份。能讓店家顯得有新意，客人也更滿意。",
    durationTicks: 72,
    cost: 10_000,
    cooldownTicks: 288,
    discount: 0,
    traffic: { all: 1.15 },
    satBonus: 0.06,
    freshness: 10,
    fatigue: 0.08,
  },
];

export const PROMO_BY_ID = Object.fromEntries(PROMOS.map((p) => [p.id, p])) as Record<string, PromoDef>;

/** 疲勞讓促銷「加成的部分」打折：疲勞 1.0 時只剩 40% */
export function promoEffectFactor(fatigue: number): number {
  return 1 - 0.6 * Math.min(1, Math.max(0, fatigue));
}

// ───────── 稽查 ─────────

export interface InspectionDef {
  id: InspectionKind;
  name: string;
  icon: string;
  authority: string;
  /** 評分 = 清潔 × wClean + 設備 × wEquip */
  wClean: number;
  wEquip: number;
  /** 突襲時「停業整頓」會關掉哪些店：food＝餐飲類，all＝全部 */
  suspends: "food" | "all";
  noticeText: string;
}

export const INSPECTIONS: Record<InspectionKind, InspectionDef> = {
  hygiene: {
    id: "hygiene",
    name: "食品衛生稽查",
    icon: "🧼",
    authority: "衛生單位",
    wClean: 0.75,
    wEquip: 0.25,
    suspends: "food",
    noticeText: "衛生單位通知：近期將到館內進行食品衛生稽查。",
  },
  fire: {
    id: "fire",
    name: "消防安全檢查",
    icon: "🧯",
    authority: "消防單位",
    wClean: 0.2,
    wEquip: 0.8,
    suspends: "all",
    noticeText: "消防單位通知：近期將到館內進行消防安全檢查。",
  },
};

/** 預告到稽查來之間的時間（遊戲 tick）：約 3–6 遊戲小時 */
export const INSPECTION_NOTICE_MIN_TICKS = 36;
export const INSPECTION_NOTICE_MAX_TICKS = 72;
/** 每個種類平均幾個遊戲日來一次 */
export const INSPECTION_MEAN_DAYS = 8;
/** 突襲（沒預告）的比例 */
export const INSPECTION_SURPRISE_RATE = 0.2;
export const MAX_INSPECTION_LOG = 12;
export const SUSPEND_TICKS = 36;

export const PREP_OPTIONS: { id: InspectionPrep; label: string; cost: number; clean: number; equip: number; hint: string }[] = [
  { id: "none", label: "照常營業", cost: 0, clean: 0, equip: 0, hint: "不花錢，賭一把" },
  { id: "basic", label: "例行整理", cost: 10_000, clean: 8, equip: 0, hint: "大掃除一下，整理資料" },
  { id: "full", label: "全力備戰", cost: 40_000, clean: 20, equip: 10, hint: "請專業公司徹底清潔、檢修設備" },
];

/** 沒有人處理時的預設：花一點小錢做基本整理 */
export const DEFAULT_PREP: InspectionPrep = "basic";

export function prepOption(id: InspectionPrep) {
  return PREP_OPTIONS.find((p) => p.id === id) ?? PREP_OPTIONS[0]!;
}

export function inspectionScore(kind: InspectionKind, cleanliness: number, equipment: number): number {
  const d = INSPECTIONS[kind];
  return Math.round(d.wClean * cleanliness + d.wEquip * equipment);
}

export function inspectionOutcome(score: number): InspectionOutcome {
  if (score >= 80) return "excellent";
  if (score >= 60) return "pass";
  if (score >= 40) return "warning";
  if (score >= 25) return "fine";
  return "suspend";
}

export const OUTCOME_INFO: Record<InspectionOutcome, { label: string; tone: "green" | "cyan" | "amber" | "red"; fine: number; idx: number; compliance: number }> = {
  excellent: { label: "優良", tone: "green", fine: 0, idx: 0.8, compliance: 5 },
  pass: { label: "合格", tone: "cyan", fine: 0, idx: 0, compliance: 2 },
  warning: { label: "限期改善（警告）", tone: "amber", fine: 0, idx: -0.5, compliance: -6 },
  fine: { label: "罰款", tone: "red", fine: 80_000, idx: -1.2, compliance: -12 },
  suspend: { label: "停業整頓", tone: "red", fine: 150_000, idx: -2, compliance: -20 },
};
