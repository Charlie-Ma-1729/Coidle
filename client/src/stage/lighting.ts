/**
 * 日夜光線與效能調節：純函式，不依賴 Pixi，可單元測試。
 *  - dayTint：一天裡整個畫面的色調（清晨暖橘 → 白天無 → 黃昏橘 → 夜晚深藍）
 *  - lampLevel：燈光亮度 0–1（白天 0、入夜 1），店面與走道的燈依這個亮起
 *  - PerfGovernor：量到幀率持續偏低時，降低人潮上限與幀率上限，保住手機的底線
 */
import { isOpenAt } from "./crowd";
import { mix } from "./color";

export interface Tint {
  color: number;
  alpha: number;
}

const NIGHT = 0x0a1038;

/** [小時, 顏色, 不透明度]：一天的色調關鍵點，之間線性內插 */
const KEYS: readonly (readonly [number, number, number])[] = [
  [0, NIGHT, 0.5],
  [5, NIGHT, 0.48],
  [6.5, 0xff9a5a, 0.2],
  [8, 0xffd9a0, 0.05],
  [9.5, 0xffd9a0, 0],
  [16, 0xffd9a0, 0],
  [17.5, 0xff8a4a, 0.14],
  [19, 0x3a2a6a, 0.3],
  [20.5, NIGHT, 0.44],
  [24, NIGHT, 0.5],
];

const hourOf = (minute: number): number => (((minute / 60) % 24) + 24) % 24;

/** 這一刻的天色（不含「商場有沒有營業」） */
export function dayTint(minute: number): Tint {
  const h = hourOf(minute);
  for (let i = 1; i < KEYS.length; i++) {
    const a = KEYS[i - 1]!;
    const b = KEYS[i]!;
    if (h <= b[0]) {
      const t = (h - a[0]) / (b[0] - a[0]);
      return { color: mix(a[1], b[1], t), alpha: a[2] + (b[2] - a[2]) * t };
    }
  }
  const last = KEYS[KEYS.length - 1]!;
  return { color: last[1], alpha: last[2] };
}

/** 燈光亮度：白天 0，傍晚漸亮，夜晚 1，清晨漸暗 */
export function lampLevel(minute: number): number {
  const h = hourOf(minute);
  if (h <= 6) return 1;
  if (h < 8.5) return 1 - (h - 6) / 2.5;
  if (h < 16.5) return 0;
  if (h < 19) return (h - 16.5) / 2.5;
  return 1;
}

/** 整個畫面的色調：天色，加上商場打烊時的暗沉 */
export function stageTint(minute: number, open: number, close: number): Tint {
  const t = dayTint(minute);
  if (isOpenAt(minute, open, close)) return t;
  return { color: mix(t.color, NIGHT, 0.6), alpha: Math.max(t.alpha, 0.42) };
}

// ───────── 效能調節 ─────────

/** 0 = 全開；1 = 人潮減到約六成；2 = 人潮減到約三分之一、幀率上限 30 */
export type PerfLevel = 0 | 1 | 2;

export const CROWD_CAP: Record<PerfLevel, number> = { 0: 70, 1: 40, 2: 24 };
export const FPS_CAP: Record<PerfLevel, number> = { 0: 60, 1: 60, 2: 30 };

export class PerfGovernor {
  level: PerfLevel = 0;
  private low = 0;
  private high = 0;

  /**
   * 每秒餵一次目前幀率。連續 3 秒低於 40 fps 就降一級；
   * 連續 20 秒都在 55 fps 以上才升回一級（避免來回跳）。
   * 已經是 30 fps 上限時，幀率本來就會落在 30 上下，所以只看「是否低於上限的八成」。
   */
  sample(fps: number): PerfLevel {
    const cap = FPS_CAP[this.level];
    const bad = fps < Math.min(40, cap * 0.8);
    const good = fps >= Math.min(55, cap * 0.92);
    this.low = bad ? this.low + 1 : 0;
    this.high = good ? this.high + 1 : 0;
    if (this.low >= 3 && this.level < 2) {
      this.level = (this.level + 1) as PerfLevel;
      this.low = 0;
      this.high = 0;
    } else if (this.high >= 20 && this.level > 0) {
      this.level = (this.level - 1) as PerfLevel;
      this.low = 0;
      this.high = 0;
    }
    return this.level;
  }
}
