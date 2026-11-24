import { newClock, type MallState } from "@coidle/shared";

/**
 * 把舊版存檔升到目前版本。
 * v1 → v2：加入每座商場自己的時鐘；移除保全模式（protection／lastActionTick）。
 * v2 → v3：加入客人互動層（收件匣、評價紀錄、不滿累積、處理偏好、巡場）。
 */
export function migrateState(raw: unknown, nowMs: number): MallState {
  const s = raw as Record<string, unknown> & { version?: number; tick: number; today?: Record<string, unknown> };
  if (s.version === 3) return s as unknown as MallState;
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
  return s as unknown as MallState;
}
