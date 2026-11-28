import { EMPLOYER_SOCIAL_RATE } from "./tax";
import { priceFactor } from "./facilityOps";
import { calendarDay } from "./calendar";

// ───────── 集團與事業（階段 3） ─────────
// 商場長成「集團」之後，可以開辦事業（子公司）。事業是 `MallState.ventures` 的選填欄位，收支進同一套每日帳／稅／報表。
// 這個檔案只有規則與資料（純函式）；結算在 server/src/sim/ventures.ts。

export const GROUP_MIN_LEVEL = 5;
/** 累計營收達這個數字才能設立集團（勤勞玩家約第 80–100 天；2026-11-29 從 2 億調高到 5 億） */
export const GROUP_MIN_REVENUE = 500_000_000;
/** 設立集團（控股公司）的登記與專家費用 */
export const GROUP_FEE = 10_000_000;
export const GROUP_NAME_MAX = 16;

export type VentureKind = "staffing";

export interface VentureDef {
  kind: VentureKind;
  name: string;
  icon: string;
  /** 開辦費 */
  cost: number;
  minLevel: number;
  blurb: string;
}

export const VENTURE_DEFS: VentureDef[] = [
  {
    kind: "staffing",
    name: "人力派遣・教育",
    icon: "🧑‍🏫",
    cost: 15_000_000,
    minLevel: 4,
    blurb: "派遣業在四月新年度與年末補人最忙；補習班在新學期最旺。手上人力與班級要跟著季節調，閒置的人與教室照樣付錢。",
  },
];
export const VENTURE_BY_KIND: Record<string, VentureDef> = Object.fromEntries(VENTURE_DEFS.map((d) => [d.kind, d]));

/** 集團名稱檢查：1–16 字、不含控制字元 */
export function cleanGroupName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (/[\u0000-\u001f<>]/.test(t)) return null;
  return t.length >= 1 && [...t].length <= GROUP_NAME_MAX ? t : null;
}

export interface GroupState {
  name: string;
  foundedTick: number;
}

// ───────── 專攻（通用層，之後的事業共用） ─────────
/** 專精度加成上限 +12%（專攻的領域滿額，沒專攻的領域只拿一半），有遞減 */
export const SPEC_MAX = 0.12;
export const SPEC_SCALE = 80;
/** 兩條線都開卻沒有專攻：兩邊都分心打折 */
export const DISTRACTION_MULT = 0.94;
/** 兩條線都開的管理費（占收入） */
export const MULTI_LINE_FEE = 0.025;

export function specMult(xp: number, focused: boolean): number {
  return 1 + SPEC_MAX * (1 - Math.exp(-Math.max(0, xp) / SPEC_SCALE)) * (focused ? 1 : 0.5);
}

// ───────── 人力派遣・教育 ─────────
export type StaffingLine = "dispatch" | "training";

export const STAFF_WAGE = 9_500; // 一位派遣人員一天的薪資
export const STAFF_RATE = 13_800; // 派遣報價（每人每日）
export const STAFF_HIRE_COST = 180_000; // 招募與訓練
export const STAFF_RELEASE_DAYS = 5; // 資遣：5 天薪水
export const STAFF_BASE_DEMAND = 30; // 一天的派遣需求（人日）
export const CLASS_OPEN_COST = 1_200_000;
export const CLASS_SEATS = 30;
export const CLASS_UPKEEP = 40_000; // 一班一天的講師與教室
export const TUITION = 1_750; // 一位學生一天
export const TRAIN_BASE_POOL = 72; // 一天想上課的人數

export const maxWorkers = (level: number): number => Math.min(80, 20 + 10 * Math.max(0, level - 4));
export const maxClasses = (level: number): number => Math.min(6, 2 + Math.max(0, level - 4));

export interface StaffingDay {
  day: number;
  demand: number;
  placed: number;
  students: number;
  revenue: number;
  cost: number;
}

export interface StaffingState {
  /** 開辦的遊戲日序 */
  since: number;
  workers: number;
  classes: number;
  priceMult?: number;
  tuitionMult?: number;
  focus?: StaffingLine;
  xp: { dispatch: number; training: number };
  /** 大客戶縮編等造成的營收折扣（到期失效；until 是遊戲日序） */
  slump?: { until: number; mult: number };
  /** 等待處理的事件（逾時採預設；deadline 是遊戲日序） */
  event?: { id: string; deadline: number };
  last?: StaffingDay;
  hist: StaffingDay[];
  profit: number;
}

export interface VenturesState {
  staffing?: StaffingState;
}

/** 派遣需求的季節：四月新年度與年末最忙，盛夏較淡；假日少 */
export function dispatchSeason(day: number): number {
  const c = calendarDay(day);
  const month = ({ 4: 1.7, 3: 1.25, 12: 1.35, 1: 0.9, 8: 0.85, 5: 1.1 } as Record<number, number>)[c.m] ?? 1;
  return month * (c.offDay ? 0.55 : 1);
}

/** 想上課的人的季節：四月新學期最旺，夏季講習與秋季開學、一月受験期也高 */
export function trainingSeason(day: number): number {
  const c = calendarDay(day);
  const month = ({ 4: 1.9, 3: 1.2, 7: 1.1, 8: 1.1, 9: 1.15, 1: 1.15, 12: 0.85 } as Record<number, number>)[c.m] ?? 1;
  return month * (c.offDay ? 1.1 : 1);
}

export const staffingPrice = (v: StaffingState): number => Math.min(1.5, Math.max(0.7, v.priceMult ?? 1));
export const tuitionPrice = (v: StaffingState): number => Math.min(1.5, Math.max(0.7, v.tuitionMult ?? 1));
export const staffingPayroll = (v: StaffingState): number => v.workers * STAFF_WAGE * (1 + EMPLOYER_SOCIAL_RATE);

/** 一天的結算（純函式）：需求隨季節與商場規模，成交受人手與座位限制，薪資與教室不論有沒有生意都照付 */
export function staffingDay(v: StaffingState, day: number, shops: number, slump = 1): StaffingDay {
  const scale = 1 + 0.03 * Math.max(0, shops - 5); // 商場越大，周邊的人力與課程需求越多
  const both = v.workers > 0 && v.classes > 0;
  const focusD = v.focus === "dispatch";
  const focusT = v.focus === "training";
  const dm = specMult(v.xp.dispatch, focusD) * (both && !focusD ? DISTRACTION_MULT : 1);
  const tm = specMult(v.xp.training, focusT) * (both && !focusT ? DISTRACTION_MULT : 1);
  // 專精度與分心是「單價」的差別（口碑好的業者報得起價），不是需求量；需求只看季節、商場規模與報價
  const demand = STAFF_BASE_DEMAND * dispatchSeason(day) * scale * priceFactor(staffingPrice(v));
  const placed = Math.min(v.workers, demand);
  const pool = TRAIN_BASE_POOL * trainingSeason(day) * scale * priceFactor(tuitionPrice(v));
  const students = Math.min(v.classes * CLASS_SEATS, pool);
  const gross = (placed * STAFF_RATE * staffingPrice(v) * dm + students * TUITION * tuitionPrice(v) * tm) * slump;
  const fee = both ? gross * MULTI_LINE_FEE : 0;
  const cost = staffingPayroll(v) + v.classes * CLASS_UPKEEP + fee;
  return {
    day,
    demand: Math.round(demand * 10) / 10,
    placed: Math.round(placed * 10) / 10,
    students: Math.round(students * 10) / 10,
    revenue: Math.round(gross),
    cost: Math.round(cost),
  };
}

/** 研修班對商場的好處：三班以上、練過一段時間，店員的研發手藝 +1（有上限） */
export const TRAINING_SKILL_CLASSES = 3;
export const TRAINING_SKILL_XP = 60;
export function trainingSkillBonus(ventures: VenturesState | undefined): number {
  const v = ventures?.staffing;
  return v && v.classes >= TRAINING_SKILL_CLASSES && v.xp.training >= TRAINING_SKILL_XP ? 1 : 0;
}

// ───────── 事件 ─────────
export interface StaffingOption {
  id: string;
  label: string;
  hint: string;
  /** 費用＝目前一天薪資的倍數 */
  costDays: number;
  /** 另有 p 的機率發生 effect */
  risk?: { p: number; effect: "fine" | "quit" | "slump"; value: number };
}
export interface StaffingEvent {
  id: string;
  icon: string;
  title: string;
  text: string;
  options: StaffingOption[];
  defaultOption: string;
}

export const STAFFING_EVENTS: StaffingEvent[] = [
  {
    id: "labor_audit",
    icon: "📋",
    title: "勞動局來查派遣契約",
    text: "主管機關抽查派遣業者的契約與勞動條件，文件要補齊。",
    defaultOption: "brave",
    options: [
      { id: "fix", label: "請顧問補齊文件", hint: "花 0.6 天薪資，安全過關", costDays: 0.6 },
      { id: "brave", label: "自己應付", hint: "不花錢，40% 機率被罰款（約 2.5 天薪資）", costDays: 0, risk: { p: 0.4, effect: "fine", value: 2.5 } },
    ],
  },
  {
    id: "client_cancel",
    icon: "📉",
    title: "大客戶臨時縮編",
    text: "一家長期客戶宣布縮減外包人力，接下來幾天的訂單會變少。",
    defaultOption: "absorb",
    options: [
      { id: "resell", label: "趕快轉派其他客戶", hint: "花 0.4 天薪資，把損失降到最低", costDays: 0.4 },
      { id: "absorb", label: "吃下這波損失", hint: "不花錢，接下來 3 天營收打 8 折", costDays: 0, risk: { p: 1, effect: "slump", value: 0.8 } },
    ],
  },
  {
    id: "poaching",
    icon: "🧲",
    title: "同業來挖角",
    text: "別家派遣公司開出更高的薪水，想把你的人帶走。",
    defaultOption: "let_go",
    options: [
      { id: "retain", label: "加薪留人", hint: "花 1.2 天薪資，人都留下", costDays: 1.2 },
      { id: "let_go", label: "任他們去", hint: "不花錢，50% 機率走掉一成人手", costDays: 0, risk: { p: 0.5, effect: "quit", value: 0.1 } },
    ],
  },
];
export const STAFFING_EVENT_BY_ID: Record<string, StaffingEvent> = Object.fromEntries(STAFFING_EVENTS.map((e) => [e.id, e]));
/** 每天出事件的機率（%）與處理期限（遊戲日） */
export const STAFFING_EVENT_PCT = 6;
export const STAFFING_EVENT_DAYS = 2;
