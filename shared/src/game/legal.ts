import { CATEGORY_BY_ID, TICKS_PER_DAY } from "./data";
import type { LawsuitCase, LegalKind, LegalStage, Stance } from "./types";

type CategoryDef = NonNullable<(typeof CATEGORY_BY_ID)[string]>;

// 客訴升級成法律糾紛：依日本的民事程序，請求書（内容証明郵便）→ 示談交渉 → 民事調停 → 訴訟（60 万円以下是少額訴訟）。
// 人名、店名全部虛構；法規名稱與程序依現實整理，僅供遊戲使用，並非法律建議。
// 設計重點：每個業態都有自己會遇到的糾紛種類（餐飲＝食物中毒／過敏、零售＝瑕疵／標示、娛樂＝設施事故、
// 服務＝個資／施術、旅宿＝住客糾紛……），新增業態時只要它的 group／zone 對得上，就自動有對應的糾紛。

export interface LegalKindDef {
  id: LegalKind;
  label: string;
  icon: string;
  /** 適用的日本法規（畫面上顯示） */
  laws: string[];
  /** 一句話說明糾紛的內容 */
  summary: string;
  /** 請求金額範圍（日圓，會依店面等級放大） */
  claim: [number, number];
  /** 哪些業態會遇到：群組、區域，或指定業態（三者任一符合） */
  groups?: string[];
  zones?: string[];
  categories?: string[];
  /** 輸掉時，主管機關可能跟進稽查 */
  inspection?: "hygiene" | "fire";
  /** 原告的假名（只用名字，避免對應到真人） */
  plaintiffs: string[];
}

const FIRST_NAMES = ["田島", "森川", "三浦", "池田", "石橋", "村瀨", "岡野", "宮下", "鈴原", "柴田", "河合", "松井", "福島", "木下", "小野寺"];

export const LEGAL_KINDS: Record<LegalKind, LegalKindDef> = {
  food_poison: {
    id: "food_poison",
    label: "食物中毒",
    icon: "🤢",
    laws: ["食品衛生法", "製造物責任法（PL法）", "民法709條（不法行為）"],
    summary: "客人吃了店裡的東西後上吐下瀉，要求賠償醫療費與精神損失。",
    claim: [200_000, 1_500_000],
    groups: ["food"],
    inspection: "hygiene",
    plaintiffs: FIRST_NAMES,
  },
  allergy: {
    id: "allergy",
    label: "過敏事故",
    icon: "🥜",
    laws: ["食品表示法（過敏原標示）", "民法709條（不法行為）", "民法415條（債務不履行）"],
    summary: "客人指稱沒有標示或沒被告知過敏原，送醫後要求賠償。",
    claim: [100_000, 800_000],
    groups: ["food"],
    inspection: "hygiene",
    plaintiffs: FIRST_NAMES,
  },
  defect: {
    id: "defect",
    label: "商品瑕疵",
    icon: "📦",
    laws: ["製造物責任法（PL法）", "消費者契約法", "民法562條（契約不適合責任）"],
    summary: "客人買到有問題的商品，要求退款加上損害賠償。",
    claim: [50_000, 600_000],
    groups: ["retail"],
    plaintiffs: FIRST_NAMES,
  },
  misleading: {
    id: "misleading",
    label: "不當標示",
    icon: "🏷️",
    laws: ["景品表示法（不當表示）", "消費者契約法（撤銷權）"],
    summary: "客人主張標價、產地或功效與實際不符，要求撤銷契約並賠償。",
    claim: [30_000, 400_000],
    groups: ["retail", "food"],
    plaintiffs: FIRST_NAMES,
  },
  injury: {
    id: "injury",
    label: "設施事故",
    icon: "🩹",
    laws: ["民法717條（工作物責任）", "民法709條（不法行為）", "安全配慮義務"],
    summary: "客人在店裡或設施內受傷，認為場地管理有疏失。",
    claim: [300_000, 3_000_000],
    zones: ["ent", "plaza", "life", "biz", "cul"],
    inspection: "fire",
    plaintiffs: FIRST_NAMES,
  },
  privacy: {
    id: "privacy",
    label: "個資外洩",
    icon: "🔓",
    laws: ["個人情報保護法", "民法709條（不法行為）"],
    summary: "會員或預約客人的個人資料外流，多位客人聯名要求賠償與道歉。",
    claim: [100_000, 1_000_000],
    zones: ["life", "biz", "f1"],
    categories: ["cosmetics", "drugstore", "convenience"],
    plaintiffs: FIRST_NAMES,
  },
  malpractice: {
    id: "malpractice",
    label: "施術糾紛",
    icon: "💆",
    laws: ["民法415條（債務不履行）", "民法709條（不法行為）", "醫療法／各項資格法規"],
    summary: "客人認為診療或施術造成不適或傷害，要求賠償。",
    claim: [300_000, 2_500_000],
    categories: ["clinic", "dental", "spa", "salon", "nail", "yoga", "gym", "daycare"],
    plaintiffs: FIRST_NAMES,
  },
  lodging: {
    id: "lodging",
    label: "住宿糾紛",
    icon: "🛏️",
    laws: ["旅館業法", "民法415條（債務不履行）", "消防法"],
    summary: "住客遺失財物、被超賣房間或設備不良，要求賠償與退費。",
    claim: [200_000, 1_200_000],
    categories: ["hotel", "capsule_hotel", "luggage"],
    inspection: "fire",
    plaintiffs: FIRST_NAMES,
  },
  contract: {
    id: "contract",
    label: "契約糾紛",
    icon: "📑",
    laws: ["民法415條（債務不履行）", "消費者契約法", "特定商取引法"],
    summary: "客人認為服務內容與契約不符，要求解約退費並賠償。",
    claim: [100_000, 900_000],
    categories: ["coworking", "conference", "travel_agency", "event_space", "cram_school", "print_shop", "photo_studio"],
    plaintiffs: FIRST_NAMES,
  },
};

export const LEGAL_KIND_ORDER = Object.keys(LEGAL_KINDS) as LegalKind[];

/** 這個業態可能遇到哪些糾紛（沒有對應就回傳空陣列；測試會檢查每個業態至少有一種） */
export function legalKindsFor(category: string): LegalKind[] {
  const cat = CATEGORY_BY_ID[category];
  if (!cat) return [];
  return LEGAL_KIND_ORDER.filter((k) => legalKindMatches(LEGAL_KINDS[k], cat));
}

function legalKindMatches(def: LegalKindDef, cat: CategoryDef): boolean {
  if (def.categories?.includes(cat.id)) return true;
  // 群組＋區域同時指定時兩者都要符合；只指定其中一個就只看那一個
  if (def.groups && def.zones) return def.groups.includes(cat.group) && def.zones.includes(cat.zone);
  if (def.groups) return def.groups.includes(cat.group);
  if (def.zones) return def.zones.includes(cat.zone);
  return false;
}

// ───────── 程序、期限、金額 ─────────

export const LEGAL_STAGES: Record<LegalStage, { label: string; law: string; days: number }> = {
  demand: { label: "請求書到達", law: "内容証明郵便による請求", days: 4 },
  mediation: { label: "民事調停", law: "民事調停法（簡易裁判所）", days: 5 },
  trial: { label: "訴訟", law: "民事訴訟法", days: 6 },
};
/** 少額訴訟（60 万円以下）：一次開庭就結案，期限較短 */
export const SMALL_CLAIM_LIMIT = 600_000;
export const SMALL_CLAIM_DAYS = 3;
/** 民事調停無故不出席的過料 */
export const MEDIATION_NOSHOW_FINE = 50_000;
/** 敗訴時加計的遲延損害金（簡化為 5%） */
export const LATE_DAMAGES_RATE = 0.05;
/** 兩件糾紛之間至少間隔幾個遊戲日；同時最多幾件 */
export const LEGAL_COOLDOWN_DAYS = 14;
export const MAX_OPEN_CASES = 2;
export const MAX_CLOSED_KEPT = 12;

export function lawyerFee(claim: number): number {
  return Math.round((150_000 + claim * 0.05) / 1000) * 1000;
}

export function stageDeadline(stage: LegalStage, claim: number): number {
  const days = stage === "trial" && claim <= SMALL_CLAIM_LIMIT ? SMALL_CLAIM_DAYS : LEGAL_STAGES[stage].days;
  return days * TICKS_PER_DAY;
}

// ───────── 保險 ─────────
export interface InsuranceDef {
  name: string;
  /** 每間直營店每日保費 */
  premium: number;
  /** 賠償金（和解金、判決金）保險給付比例 */
  rate: number;
  /** 每件上限 */
  cap: number;
  /** 自負額 */
  deductible: number;
}
export const INSURANCE: InsuranceDef[] = [
  { name: "未投保", premium: 0, rate: 0, cap: 0, deductible: 0 },
  { name: "施設賠償責任保險（基本）", premium: 1_200, rate: 0.5, cap: 1_500_000, deductible: 50_000 },
  { name: "施設・PL 賠償責任保險（完整）", premium: 3_000, rate: 0.8, cap: 6_000_000, deductible: 30_000 },
];

/** 保險給付額（只算賠償金，律師費不在內）；level 是案件成立當時的投保等級 */
export function insurancePayout(level: number, amount: number): number {
  const def = INSURANCE[level] ?? INSURANCE[0]!;
  if (def.rate <= 0) return 0;
  return Math.min(def.cap, Math.max(0, amount - def.deductible) * def.rate);
}

// ───────── 勝算 ─────────

/** 原告主張的強度 0–1：一半看對方有多占理（隱藏），一半看你的證據有多弱 */
export function plaintiffStrength(fault: number, evidence: number, lawyer: boolean): number {
  const e = Math.min(100, evidence + (lawyer ? 15 : 0));
  return Math.min(1, Math.max(0, 0.5 * fault + 0.5 * (1 - e / 100)));
}

export interface JudgmentOdds {
  dismiss: number;
  partial: number;
  full: number;
}
export function judgmentOdds(x: number): JudgmentOdds {
  const full = Math.min(0.75, Math.max(0.02, 1.4 * x - 0.5));
  const dismiss = Math.min(0.85, Math.max(0.03, 0.9 - 1.2 * x));
  const partial = Math.max(0, 1 - full - dismiss);
  const total = full + dismiss + partial;
  return { dismiss: dismiss / total, partial: partial / total, full: full / total };
}

/** 協商／調停成功的機率；plus＝律師等加成 */
export function settleChance(x: number, base: number, plus = 0): number {
  return Math.min(0.9, Math.max(0.05, base + 0.55 * (1 - x) + plus));
}

// ───────── 各階段的選項（畫面與引擎共用） ─────────

export interface LegalOption {
  id: string;
  label: string;
  /** 立刻要付的錢（示談金、律師費、過料）；賭博性質的選項是 0，結果出來才付 */
  cost: number;
  desc: string;
  /** 這個選項是否包含律師費（資金不足時不可選） */
  lawyer?: boolean;
}

export function legalOptions(c: Pick<LawsuitCase, "stage" | "claim" | "lawyer">): LegalOption[] {
  const claim = c.claim;
  const fee = lawyerFee(claim);
  const yen = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;
  if (c.stage === "demand") {
    return [
      { id: "settle", label: "誠意道歉並支付示談金", cost: Math.round(claim * 0.8), desc: `付 ${yen(claim * 0.8)}，簽示談書（含保密條款），不會留下紀錄也不影響口碑。` },
      { id: "negotiate", label: "自己出面協商", cost: 0, desc: `不花錢，成功的話以約 ${yen(claim * 0.35)} 和解；談不攏對方會聲請民事調停。` },
      { id: "lawyer", label: "委任律師交涉", cost: c.lawyer ? 0 : fee, lawyer: !c.lawyer, desc: `${c.lawyer ? "已委任律師，不再收費。" : `律師費 ${yen(fee)}。`}證據力提高，協商成功率大增，成功約 ${yen(claim * 0.3)} 和解。` },
      { id: "refuse", label: "拒絕請求", cost: 0, desc: "不理會。對方會直接聲請民事調停。" },
    ];
  }
  if (c.stage === "mediation") {
    return [
      { id: "settle", label: "出席並接受調停條件", cost: Math.round(claim * 0.5), desc: `付 ${yen(claim * 0.5)}，調停成立、案件結束。` },
      { id: "attend", label: "自己出席調停", cost: 0, desc: `有機會以約 ${yen(claim * 0.35)} 調停成立；不成立就進入訴訟。` },
      { id: "lawyer", label: "律師陪同出席", cost: c.lawyer ? 0 : fee, lawyer: !c.lawyer, desc: `${c.lawyer ? "已委任律師，不再收費。" : `律師費 ${yen(fee)}。`}調停成立機率較高，約 ${yen(claim * 0.3)} 成立。` },
      { id: "skip", label: "不出席", cost: MEDIATION_NOSHOW_FINE, desc: `無正當理由缺席會被處過料 ${yen(MEDIATION_NOSHOW_FINE)}，調停不成立，對方會提起訴訟。` },
    ];
  }
  const small = claim <= SMALL_CLAIM_LIMIT;
  return [
    { id: "settle", label: "裁判上的和解", cost: Math.round(claim * 0.5), desc: `付 ${yen(claim * 0.5)}，法官勸諭下和解，案件結束。` },
    { id: "contest", label: `自己應訴${small ? "（少額訴訟，一次開庭結案）" : ""}`, cost: 0, desc: "靠自己的證據與陳述，判決結果出來才知道賠多少（敗訴要加計遲延損害金，且會被報導）。" },
    { id: "lawyer", label: "委任律師應訴", cost: c.lawyer ? 0 : fee, lawyer: !c.lawyer, desc: `${c.lawyer ? "已委任律師，不再收費。" : `律師費 ${yen(fee)}。`}證據力提高，大幅降低敗訴機率。` },
  ];
}

/** 逾期沒處理時，依「客訴處理偏好」自動選的選項 */
export function defaultLegalOption(stage: LegalStage, stance: Stance): string {
  if (stance === "soft") return "settle";
  if (stage === "demand") return stance === "firm" ? "refuse" : "negotiate";
  if (stage === "mediation") return "attend";
  return "contest";
}

/** 好聽一點的案件名 */
export function caseTitle(c: Pick<LawsuitCase, "kind" | "shopName">): string {
  return `${LEGAL_KINDS[c.kind].icon} ${c.shopName}・${LEGAL_KINDS[c.kind].label}`;
}
