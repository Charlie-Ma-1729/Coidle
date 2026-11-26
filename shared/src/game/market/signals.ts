// 世界訊號：都是「某一遊戲日已發生」的值（約 −1 到 1），股價引擎 v1／v2 共用。
import { calendarDay } from "../calendar";
import { dayWeather } from "../weather";

/** 世界訊號對價格的最大影響（對數尺度，約 ±3%） */
export const SIGNAL_AMPLITUDE = 0.03;

export type SignalId = "travel" | "holiday" | "payday" | "wet" | "extreme" | "heat" | "moving" | "fiscal" | "season" | "yearend";

interface SignalDef {
  label: string;
  fn: (day: number) => number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const SIGNALS: Record<SignalId, SignalDef> = {
  travel: {
    label: "長假與連休",
    fn: (d) => {
      const c = calendarDay(d);
      if (c.tags.includes("golden_week") || c.tags.includes("obon") || c.tags.includes("new_year")) return 1;
      if (c.tags.includes("long_weekend")) return 0.6;
      if (c.tags.includes("year_end")) return 0.4;
      if (c.tags.includes("holiday")) return 0.3;
      if (c.tags.includes("weekend")) return 0.15;
      return 0;
    },
  },
  holiday: {
    label: "假日",
    fn: (d) => {
      const c = calendarDay(d);
      return c.offDay ? (c.streak ? 0.9 : 0.55) : 0;
    },
  },
  payday: { label: "發薪日", fn: (d) => (calendarDay(d).tags.includes("payday") ? 1 : 0) },
  wet: {
    label: "雨天（負面）",
    fn: (d) => {
      const w = dayWeather(d);
      return w.kind === "storm" ? -1 : w.kind === "rain" ? -0.5 : 0;
    },
  },
  extreme: {
    label: "酷暑與嚴寒",
    fn: (d) => {
      const t = dayWeather(d).temp;
      if (t >= 32 || t <= 4) return 1;
      if (t >= 29 || t <= 8) return 0.45;
      return 0;
    },
  },
  heat: { label: "氣溫（越熱越好）", fn: (d) => clamp((dayWeather(d).temp - 18) / 12, -1, 1) },
  moving: { label: "搬家旺季", fn: (d) => (calendarDay(d).tags.includes("moving_season") ? 1 : 0) },
  fiscal: {
    label: "年度末",
    fn: (d) => {
      const m = calendarDay(d).m;
      return m === 3 ? 0.8 : m === 2 ? 0.4 : 0;
    },
  },
  season: {
    label: "換季寒暖差",
    fn: (d) => clamp(Math.abs(dayWeather(d).temp - dayWeather(d - 3).temp) / 8, 0, 1),
  },
  yearend: {
    label: "年末年始",
    fn: (d) => {
      const c = calendarDay(d);
      return c.tags.includes("year_end") || c.tags.includes("new_year") ? 1 : 0;
    },
  },
};

/** 某檔標的在某遊戲日的訊號水位（對數尺度）：近 3 個遊戲日（今天、昨天、前天）已發生訊號的加權平均 */
export function signalLevel(signals: [SignalId, number][], day: number): number {
  if (signals.length === 0) return 0;
  const raw = (d: number) => signals.reduce((a, [id, w]) => a + w * SIGNALS[id].fn(d), 0);
  const tilt = 0.5 * raw(day) + 0.3 * raw(day - 1) + 0.2 * raw(day - 2);
  return SIGNAL_AMPLITUDE * clamp(tilt, -1, 1);
}
