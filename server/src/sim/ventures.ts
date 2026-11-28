import {
  CLASS_OPEN_COST,
  CONSUMPTION_STANDARD,
  GROUP_FEE,
  GROUP_MIN_LEVEL,
  GROUP_MIN_REVENUE,
  STAFFING_EVENTS,
  STAFFING_EVENT_BY_ID,
  STAFFING_EVENT_DAYS,
  STAFFING_EVENT_PCT,
  STAFF_HIRE_COST,
  STAFF_RELEASE_DAYS,
  STAFF_WAGE,
  VENTURE_BY_KIND,
  cleanGroupName,
  maxClasses,
  maxWorkers,
  staffingDay,
  staffingPayroll,
  taxPortion,
  type MallState,
  type StaffingLine,
  type StaffingState,
  type TimeInfo,
} from "@coidle/shared";
import { createRng, hash32 } from "./rng";
import { addLog } from "./state";

type Err = string | null;

const HIST_DAYS = 30;
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

/** 設立集團：商場成為母公司。條件＝等級、累計營收、設立費 */
export function foundGroup(s: MallState, rawName: string): Err {
  if (s.group) return "已經設立過集團了";
  const name = cleanGroupName(rawName);
  if (!name) return "集團名稱要 1–16 個字";
  if (s.level < GROUP_MIN_LEVEL) return `商場要達到 Lv.${GROUP_MIN_LEVEL} 才能設立集團`;
  if (s.totalRevenue < GROUP_MIN_REVENUE) return `累計營收要達到 ${money(GROUP_MIN_REVENUE)} 才能設立集團（目前 ${money(s.totalRevenue)}）`;
  if (s.funds < GROUP_FEE) return `資金不足（設立費 ${money(GROUP_FEE)}）`;
  s.funds -= GROUP_FEE;
  s.today.fixed += GROUP_FEE;
  s.group = { name, foundedTick: s.tick };
  addLog(s, "build", `🏢 設立集團「${name}」！商場成為母公司，之後可以開辦事業。`);
  return null;
}

export function renameGroup(s: MallState, rawName: string): Err {
  if (!s.group) return "還沒有設立集團";
  const name = cleanGroupName(rawName);
  if (!name) return "集團名稱要 1–16 個字";
  s.group.name = name;
  return null;
}

export function foundVenture(s: MallState, kind: string, time: { day: number }): Err {
  const def = VENTURE_BY_KIND[kind];
  if (!def) return "沒有這種事業";
  if (!s.group) return "要先設立集團才能開辦事業";
  if (s.level < def.minLevel) return `商場要達到 Lv.${def.minLevel} 才能開辦「${def.name}」`;
  if (s.ventures?.[def.kind]) return `已經開辦「${def.name}」了`;
  if (s.funds < def.cost) return `資金不足（開辦費 ${money(def.cost)}）`;
  s.funds -= def.cost;
  s.today.fixed += def.cost;
  s.ventures ??= {};
  const v: StaffingState = { since: time.day, workers: 0, classes: 0, xp: { dispatch: 0, training: 0 }, hist: [], profit: -def.cost };
  s.ventures.staffing = v;
  addLog(s, "build", `${def.icon} 集團開辦新事業「${def.name}」！`);
  return null;
}

export interface StaffingOpsCmd {
  workers?: number;
  classes?: number;
  priceMult?: number;
  tuitionMult?: number;
  focus?: StaffingLine | "none";
}

/** 調整人力派遣・教育：人數、班數、報價、學費、專攻。一次只能做合法的組合；錢一次扣完 */
export function staffingOps(s: MallState, cmd: StaffingOpsCmd): Err {
  const v = s.ventures?.staffing;
  if (!v) return "還沒有開辦這個事業";
  const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  let cost = 0;
  let workers = v.workers;
  let classes = v.classes;
  if (cmd.workers !== undefined) {
    if (!isNum(cmd.workers) || !Number.isInteger(cmd.workers) || cmd.workers < 0) return "人數無效";
    if (cmd.workers > maxWorkers(s.level)) return `以現在的規模，派遣人員最多 ${maxWorkers(s.level)} 人`;
    if (cmd.workers > v.workers) cost += (cmd.workers - v.workers) * STAFF_HIRE_COST;
    else cost += (v.workers - cmd.workers) * STAFF_WAGE * STAFF_RELEASE_DAYS;
    workers = cmd.workers;
  }
  if (cmd.classes !== undefined) {
    if (!isNum(cmd.classes) || !Number.isInteger(cmd.classes) || cmd.classes < 0) return "班數無效";
    if (cmd.classes > maxClasses(s.level)) return `以現在的規模，最多開 ${maxClasses(s.level)} 班`;
    if (cmd.classes > v.classes) cost += (cmd.classes - v.classes) * CLASS_OPEN_COST;
    classes = cmd.classes;
  }
  if (cmd.priceMult !== undefined && (!isNum(cmd.priceMult) || cmd.priceMult < 0.7 || cmd.priceMult > 1.5)) return "報價倍率要在 0.7–1.5 之間";
  if (cmd.tuitionMult !== undefined && (!isNum(cmd.tuitionMult) || cmd.tuitionMult < 0.7 || cmd.tuitionMult > 1.5)) return "學費倍率要在 0.7–1.5 之間";
  if (cmd.focus !== undefined && cmd.focus !== "none" && cmd.focus !== "dispatch" && cmd.focus !== "training") return "專攻無效";
  if (cost > 0 && s.funds < cost) return `資金不足（要 ${money(cost)}）`;
  if (cost > 0) {
    s.funds -= cost;
    s.today.fixed += cost;
    v.profit -= cost;
  }
  v.workers = workers;
  v.classes = classes;
  if (cmd.priceMult !== undefined) v.priceMult = Math.round(cmd.priceMult * 100) / 100;
  if (cmd.tuitionMult !== undefined) v.tuitionMult = Math.round(cmd.tuitionMult * 100) / 100;
  if (cmd.focus !== undefined) {
    if (cmd.focus === "none") delete v.focus;
    else v.focus = cmd.focus;
  }
  return null;
}

/** 處理事件：付費、風險用 (種子, 日, 選項) 的雜湊決定（重放結果相同） */
function applyStaffingOption(s: MallState, v: StaffingState, optionId: string, day: number, auto: boolean): Err {
  const ev = v.event && STAFFING_EVENT_BY_ID[v.event.id];
  const opt = ev?.options.find((o) => o.id === optionId);
  if (!ev || !opt) return "沒有這個選項";
  const payroll = Math.max(staffingPayroll(v), STAFF_WAGE);
  const cost = Math.round(opt.costDays * payroll);
  if (cost > 0) {
    if (s.funds < cost) return `資金不足（要 ${money(cost)}）`;
    s.funds -= cost;
    s.today.fixed += cost;
    v.profit -= cost;
  }
  let note = "";
  if (opt.risk) {
    const roll = createRng(hash32(hash32(s.seed ^ 0x57a9, day), opt.id.length * 977 + opt.id.charCodeAt(0))).next();
    if (roll < opt.risk.p) {
      if (opt.risk.effect === "fine") {
        const fine = Math.round(opt.risk.value * payroll);
        s.funds -= fine;
        s.today.fixed += fine;
        v.profit -= fine;
        note = `，被罰款 ${money(fine)}`;
      } else if (opt.risk.effect === "quit") {
        const gone = Math.floor(v.workers * opt.risk.value);
        v.workers -= gone;
        note = gone > 0 ? `，走了 ${gone} 位人員` : "";
      } else {
        v.slump = { until: day + 3, mult: opt.risk.value };
        note = "，接下來幾天營收變少";
      }
    }
  }
  delete v.event;
  addLog(s, "info", `${ev.icon} 人力派遣・教育：${ev.title}→${opt.label}${auto ? "（沒人處理，自動採預設）" : ""}${note}。`);
  return null;
}

export function resolveStaffingEvent(s: MallState, optionId: string, time: { day: number }): Err {
  const v = s.ventures?.staffing;
  if (!v) return "還沒有開辦這個事業";
  if (!v.event) return "現在沒有待處理的事";
  return applyStaffingOption(s, v, String(optionId), time.day, false);
}

/** 每日結算（在日報之前）：營收與成本進同一套每日帳，事件出現與逾時處理，專精度累積 */
export function venturesDaily(s: MallState, time: TimeInfo): void {
  const v = s.ventures?.staffing;
  if (!v) return;
  const day = time.day;
  // 逾時的事件：採預設
  if (v.event && v.event.deadline <= day) {
    const ev = STAFFING_EVENT_BY_ID[v.event.id];
    if (ev) applyStaffingOption(s, v, ev.defaultOption, day, true);
    else delete v.event;
  }
  if (v.slump && v.slump.until <= day) delete v.slump;
  const r = staffingDay(v, day, s.shops.length, v.slump?.mult ?? 1);
  s.funds += r.revenue - r.cost;
  s.today.revenue += r.revenue;
  s.totalRevenue += r.revenue;
  s.today.fixed += r.cost;
  s.today.outTax += taxPortion(r.revenue, CONSUMPTION_STANDARD);
  v.profit += r.revenue - r.cost;
  v.last = r;
  v.hist.push(r);
  if (v.hist.length > HIST_DAYS) v.hist.splice(0, v.hist.length - HIST_DAYS);
  // 專精度：有開的線每天累積，專攻的線快一些
  if (v.workers > 0) v.xp.dispatch += v.focus === "dispatch" ? 1.5 : 1;
  if (v.classes > 0) v.xp.training += v.focus === "training" ? 1.5 : 1;
  // 新事件（只有手上有人才會被查或被挖）
  if (!v.event && v.workers > 0) {
    const h = hash32(s.seed ^ 0x3c71, day);
    if (h % 100 < STAFFING_EVENT_PCT) {
      const ev = STAFFING_EVENTS[hash32(h, 17) % STAFFING_EVENTS.length]!;
      v.event = { id: ev.id, deadline: day + STAFFING_EVENT_DAYS };
      addLog(s, "info", `${ev.icon} 人力派遣・教育：${ev.title}。${STAFFING_EVENT_DAYS} 天內處理，沒處理就採預設。`);
    }
  }
}
