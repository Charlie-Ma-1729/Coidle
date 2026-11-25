import type { MallState, PersonaId, TechState } from "./types";

// 科技樹：用資金與（真實）時間研發，離線也會繼續。效果都是「資料」，由模擬統一套用。

export type TechBranch = "guide" | "ops" | "energy" | "tenant";

export interface TechFx {
  /** 薪資倍率（無人結帳、自動化） */
  wageMult?: number;
  /** 水電與清潔維護費倍率 */
  overheadMult?: number;
  cleaningRestoreMult?: number;
  equipmentRestoreMult?: number;
  /** 設備故障機率倍率（越小越穩） */
  breakdownMult?: number;
  /** 各店服務容量倍率 */
  capacityMult?: number;
  /** 客流倍率：all 是所有客人 */
  traffic?: Partial<Record<PersonaId | "all", number>>;
  /** 滿意度加成（0–1 尺度） */
  satBonus?: number;
  /** 常客親密度增加倍率 */
  regularGainMult?: number;
  /** 業態多樣性加成（逛一家帶動逛下一家） */
  diversityBonus?: number;
  /** 客訴累積倍率（越小越少） */
  complaintMult?: number;
  /** 每日人氣 */
  dailyIdx?: { localRep?: number; touristHeat?: number };
  /** 租戶滿意度加成 */
  tenantSat?: number;
  /** 招商候選的品質加成 */
  candidateQuality?: number;
  /** 功能旗標 */
  forecast?: boolean;
  autoRefresh?: boolean;
  autoInspection?: boolean;
}

export interface TechDef {
  id: string;
  name: string;
  icon: string;
  branch: TechBranch;
  desc: string;
  /** 效果的白話說明 */
  effectText: string;
  cost: number;
  /** 研發所需 tick（真實時間依流速換算） */
  ticks: number;
  minLevel: number;
  requires: string[];
  fx: TechFx;
}

export const TECH_BRANCHES: Record<TechBranch, { name: string; icon: string }> = {
  guide: { name: "導覽與客流", icon: "🧭" },
  ops: { name: "營運自動化", icon: "🤖" },
  energy: { name: "能源與永續", icon: "🌱" },
  tenant: { name: "租戶與營收", icon: "🏪" },
};

export const TECHS: TechDef[] = [
  { id: "t_app", name: "智慧導覽 App", icon: "📱", branch: "guide", desc: "館內導覽、優惠推播與樓層查詢，客人更容易找到想去的店。", effectText: "客流 +3%（觀光客 +6%）", cost: 4_000_000, ticks: 288, minLevel: 1, requires: [], fx: { traffic: { all: 1.03, tourist: 1.06 } } },
  { id: "t_member", name: "會員與點數系統", icon: "💳", branch: "guide", desc: "集點、會員價與生日禮，把路過的客人變成熟客。", effectText: "常客親密度成長 +25%；在地客與家庭客流 +5%", cost: 6_000_000, ticks: 432, minLevel: 2, requires: ["t_app"], fx: { regularGainMult: 1.25, traffic: { local: 1.05, family: 1.05 } } },
  { id: "t_data", name: "大數據客流分析", icon: "📊", branch: "guide", desc: "即時掌握各時段、各客群的人流，「營運 → 營業時間」解鎖客流預測。", effectText: "解鎖客流預測；滿意度 +2%", cost: 7_500_000, ticks: 432, minLevel: 3, requires: ["t_app"], fx: { forecast: true, satBonus: 0.02 } },
  { id: "t_ar", name: "AR 導覽", icon: "🥽", branch: "guide", desc: "用手機看見每間店的特色與排隊狀況，逛完一家自然想再逛一家。", effectText: "業態多樣性加成 +0.15；觀光客客流 +6%", cost: 10_000_000, ticks: 576, minLevel: 3, requires: ["t_app"], fx: { diversityBonus: 0.15, traffic: { tourist: 1.06 } } },

  { id: "t_checkout", name: "無人結帳", icon: "🧾", branch: "ops", desc: "自助結帳與行動支付，櫃台人力大幅減少、結帳更快。", effectText: "薪資 −15%；服務容量 +8%；設備故障機率 ×1.4", cost: 7_500_000, ticks: 432, minLevel: 2, requires: [], fx: { wageMult: 0.85, capacityMult: 1.08, breakdownMult: 1.4 } },
  { id: "t_robot", name: "機器人清潔與巡檢", icon: "🧹", branch: "ops", desc: "清潔機器人與巡檢機器人在夜間作業，沒人在的時候也能維持品質。", effectText: "清潔回復 +50%、設備回復 +25%；客訴 −20%", cost: 6_000_000, ticks: 432, minLevel: 2, requires: [], fx: { cleaningRestoreMult: 1.5, equipmentRestoreMult: 1.25, complaintMult: 0.8 } },
  { id: "t_predict", name: "預知保養", icon: "🔧", branch: "ops", desc: "感測器預測設備何時會壞，先修再壞，故障幾乎消失。", effectText: "設備故障機率 ×0.4", cost: 7_500_000, ticks: 432, minLevel: 3, requires: ["t_robot"], fx: { breakdownMult: 0.4 } },
  { id: "t_ai", name: "自動化營運（AI 副手）", icon: "🧠", branch: "ops", desc: "AI 副手會在你離線時自動換新菜單、為稽查做全力準備，讓放著不管也不容易出事。", effectText: "新鮮感太低會自動更新；稽查自動全力備戰", cost: 20_000_000, ticks: 864, minLevel: 4, requires: ["t_checkout", "t_data"], fx: { autoRefresh: true, autoInspection: true } },

  { id: "t_bms", name: "智慧能源管理", icon: "💡", branch: "energy", desc: "依人流調整空調與照明，省下一大筆電費。", effectText: "水電與清潔維護費 −15%", cost: 5_000_000, ticks: 288, minLevel: 2, requires: [], fx: { overheadMult: 0.85 } },
  { id: "t_solar", name: "太陽能屋頂", icon: "☀️", branch: "energy", desc: "屋頂鋪滿太陽能板，既省電又成為形象。", effectText: "水電與清潔維護費再 −20%；觀光熱度每日 +0.05", cost: 15_000_000, ticks: 720, minLevel: 4, requires: ["t_bms"], fx: { overheadMult: 0.8, dailyIdx: { touristHeat: 0.05 } } },
  { id: "t_esg", name: "ESG 永續報告", icon: "🌍", branch: "energy", desc: "公開永續報告與碳足跡，贏得在地與國際的好感。", effectText: "在地口碑與觀光熱度每日各 +0.08；觀光客客流 +4%", cost: 12_500_000, ticks: 576, minLevel: 5, requires: ["t_solar"], fx: { dailyIdx: { localRep: 0.08, touristHeat: 0.08 }, traffic: { tourist: 1.04 } } },

  { id: "t_portal", name: "租戶入口網站", icon: "🖥️", branch: "tenant", desc: "租戶能線上看銷售、報修與申請，滿意度提升，也更容易招到好品牌。", effectText: "租戶滿意度 +8；候選品牌品質 +0.05", cost: 9_000_000, ticks: 432, minLevel: 3, requires: [], fx: { tenantSat: 8, candidateQuality: 0.05 } },
];

export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<string, TechDef>;
export const TECH_CANCEL_REFUND = 0.5;
/** 同時能研發幾項：Lv.5 以上多一個研究室 */
export function techSlots(level: number): number {
  return level >= 5 ? 2 : 1;
}

const NEUTRAL: Required<Pick<TechFx, "wageMult" | "overheadMult" | "cleaningRestoreMult" | "equipmentRestoreMult" | "breakdownMult" | "capacityMult" | "satBonus" | "regularGainMult" | "diversityBonus" | "complaintMult" | "tenantSat" | "candidateQuality">> = {
  wageMult: 1,
  overheadMult: 1,
  cleaningRestoreMult: 1,
  equipmentRestoreMult: 1,
  breakdownMult: 1,
  capacityMult: 1,
  satBonus: 0,
  regularGainMult: 1,
  diversityBonus: 0,
  complaintMult: 1,
  tenantSat: 0,
  candidateQuality: 0,
};

export interface TechSummary extends Required<Pick<TechFx, "wageMult" | "overheadMult" | "cleaningRestoreMult" | "equipmentRestoreMult" | "breakdownMult" | "capacityMult" | "satBonus" | "regularGainMult" | "diversityBonus" | "complaintMult" | "tenantSat" | "candidateQuality">> {
  traffic: Record<string, number>;
  dailyIdx: { localRep: number; touristHeat: number };
  forecast: boolean;
  autoRefresh: boolean;
  autoInspection: boolean;
}

const cache = new Map<string, TechSummary>();

/** 把已完成的科技效果合併起來（倍率相乘、加成相加）。結果會快取，供模擬每個 tick 呼叫。 */
export function techFx(done: readonly string[]): TechSummary {
  const key = done.join(",");
  const hit = cache.get(key);
  if (hit) return hit;
  const out: TechSummary = { ...NEUTRAL, traffic: {}, dailyIdx: { localRep: 0, touristHeat: 0 }, forecast: false, autoRefresh: false, autoInspection: false };
  for (const id of done) {
    const fx = TECH_BY_ID[id]?.fx;
    if (!fx) continue;
    for (const k of ["wageMult", "overheadMult", "cleaningRestoreMult", "equipmentRestoreMult", "breakdownMult", "capacityMult", "regularGainMult", "complaintMult"] as const) {
      if (fx[k] !== undefined) out[k] *= fx[k]!;
    }
    for (const k of ["satBonus", "diversityBonus", "tenantSat", "candidateQuality"] as const) {
      if (fx[k] !== undefined) out[k] += fx[k]!;
    }
    for (const [p, m] of Object.entries(fx.traffic ?? {})) out.traffic[p] = (out.traffic[p] ?? 1) * m!;
    out.dailyIdx.localRep += fx.dailyIdx?.localRep ?? 0;
    out.dailyIdx.touristHeat += fx.dailyIdx?.touristHeat ?? 0;
    out.forecast ||= !!fx.forecast;
    out.autoRefresh ||= !!fx.autoRefresh;
    out.autoInspection ||= !!fx.autoInspection;
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

export function techTrafficMult(done: readonly string[], persona: PersonaId): number {
  const t = techFx(done).traffic;
  return (t.all ?? 1) * (t[persona] ?? 1);
}

/** 這項科技現在能不能開始研發；不行就回傳原因 */
export function techBlocker(s: Pick<MallState, "level" | "tech">, def: TechDef): string | null {
  if (s.tech.done.includes(def.id)) return "已經研發完成";
  if (s.tech.jobs.some((j) => j.id === def.id)) return "研發中";
  if (s.level < def.minLevel) return `需要商場 Lv.${def.minLevel}`;
  const missing = def.requires.filter((r) => !s.tech.done.includes(r));
  if (missing.length > 0) return `需要先研發：${missing.map((m) => TECH_BY_ID[m]?.name ?? m).join("、")}`;
  if (s.tech.jobs.length >= techSlots(s.level)) return "研究室都在忙";
  return null;
}

export type { TechState };
