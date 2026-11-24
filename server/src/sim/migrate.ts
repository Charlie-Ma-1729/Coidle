import { initialSupply, newClock, type MallState } from "@coidle/shared";
import { initialRegulars } from "./regulars";
import { newLeasingState } from "./leasing";
import { initGoals, newMetaState } from "./meta";
import { newTaxState } from "./tax";
import { newTechState } from "./tech";
import { newInspectionState, newPromoState, newRivalsState, newWorkshopState } from "./state";
import { syncWorkshop } from "./workshop";

/**
 * 把舊版存檔升到目前版本。
 * v1 → v2：加入每座商場自己的時鐘；移除保全模式（protection／lastActionTick）。
 * v2 → v3：加入客人互動層（收件匣、評價紀錄、不滿累積、處理偏好、巡場）。
 * v3 → v4：加入常客名冊。
 * v4 → v5：加入優惠活動與稽查。
 * v5 → v6：加入供應商與 NPC 對手商場。
 * v6 → v7：加入研發工坊（素材、食譜本、菜單）。
 * v7 → v8：加入稅務與法規（消費稅、法人稅等、固定資產稅、社會保險、獎金）。
 * v8 → v9：加入科技樹與出租招商（租戶、候選品牌、續約）。
 * v9 → v10：加入目標、團隊事件、成就與線索收集。
 */
export function migrateState(raw: unknown, nowMs: number): MallState {
  const s = raw as Record<string, unknown> & { version?: number; tick: number; today?: Record<string, unknown> };
  if (s.version === 10) return s as unknown as MallState;
  if (s.version === 1 || s.version === undefined) {
    delete s.protection;
    delete s.lastActionTick;
    s.clock = newClock(nowMs, s.tick);
    s.version = 2;
  }
  if (s.version === 2) {
    s.grievances = {};
    s.inbox = [];
    s.reviewLog = [];
    s.guestPrefs = { complaintStance: "balanced", autoReplyReviews: true };
    s.walk = { nextTick: 0, voices: [] };
    if (s.today) Object.assign(s.today, { complaints: 0, reviews: 0, starsSum: 0 });
    s.version = 3;
  }
  if (s.version === 3) {
    s.regulars = initialRegulars();
    if (s.today) Object.assign(s.today, { regularNotes: [], regularVisits: 0 });
    s.version = 4;
  }
  if (s.version === 4) {
    s.promos = newPromoState();
    s.inspections = newInspectionState(s.tick);
    if (s.today) Object.assign(s.today, { systemNotes: [] });
    s.version = 5;
  }
  if (s.version === 5) {
    s.supply = initialSupply();
    s.rivals = newRivalsState((s.level as number | undefined) ?? 1, s.tick);
    s.version = 6;
  }
  if (s.version === 6) {
    s.workshop = newWorkshopState();
    for (const shop of (s.shops as { menu?: unknown[] }[]) ?? []) shop.menu = [];
    s.version = 7;
    syncWorkshop(s as unknown as MallState);
  }
  if (s.version === 7) {
    s.tax = newTaxState();
    if (s.today) Object.assign(s.today, { outTax: 0, inTax: 0, fixedCredit: 0 });
    s.version = 8;
  }
  if (s.version === 8) {
    s.tech = newTechState();
    s.leasing = newLeasingState(s.tick);
    for (const shop of (s.shops as { tenant?: unknown }[]) ?? []) shop.tenant = null;
    const flags = (s.flags ?? {}) as Record<string, boolean>;
    if (flags["feature:lease"] === false) delete flags["feature:lease"];
    s.version = 9;
  }
  if (s.version === 9) {
    s.meta = newMetaState(s.tick);
    initGoals(s as unknown as MallState);
    s.version = 10;
  }
  return s as unknown as MallState;
}
