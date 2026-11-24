/** 模擬時間單位：1 tick = 5 分鐘 */
export const TICK_MINUTES = 5;
export const TICKS_PER_DAY = (24 * 60) / TICK_MINUTES; // 288

export interface HealthResponse {
  ok: true;
  name: string;
  time: string;
}
