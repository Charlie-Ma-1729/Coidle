// 每日隨機：讓「同樣的情境」不會每天都給同樣的結果。
// 全部由 (seed, 日, 鍵) 決定（不吃 rng 流、不碰真實時間），所以同 (seed, tick) 同結果；期望值皆為 1，不改平均營收。
import { CATEGORY_BY_ID, dayOfTick, type MallState, type PersonaId } from "@coidle/shared";
import { hash32 } from "./rng";

/** 字串雜湊成整數（鍵用） */
function keyHash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** 約略常態分佈（三個均勻亂數相加再標準化），截在 ±2σ 內 */
function zOf(seed: number, salt: number, day: number, key: string): number {
  const base = hash32(seed ^ salt, day * 9973 + keyHash(key));
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += hash32(base, i + 1) / 4294967296;
  const z = (sum - 1.5) / Math.sqrt(0.25); // 三個 U(0,1) 的變異數 = 3/12 = 0.25
  return Math.max(-2, Math.min(2, z));
}

function logNormal(z: number, sd: number): number {
  return Math.exp(sd * z - (sd * sd) / 2);
}

/** 每日業態需求雜訊：單價愈高（客組少）幅度愈大，日用品較小（標準差約 17%～25%） */
export function categoryNoise(s: Pick<MallState, "seed">, category: string, tick: number): number {
  const cat = CATEGORY_BY_ID[category];
  const price = cat?.refPrice ?? 1000;
  const sd = 0.17 + 0.08 * Math.max(0, Math.min(1, Math.log10(price / 500) / 1.7));
  return logNormal(zOf(s.seed, 0x1d3a, dayOfTick(tick), category), sd);
}

/** 天氣／節慶／事件對這個業態的影響，每天強弱不同：回傳指數（約 0.7～1.3），用在 demandMult ** j */
export function effectStrength(s: Pick<MallState, "seed">, category: string, tick: number): number {
  const z = zOf(s.seed, 0x4be1, dayOfTick(tick), category);
  return 1 + 0.2 * z; // z 在 ±2 內 → 0.6～1.4
}

/** 每日客群雜訊（約 ±10%）：今天學生多、明天上班族多 */
export function personaNoise(s: Pick<MallState, "seed">, persona: PersonaId, tick: number): number {
  return logNormal(zOf(s.seed, 0x2f77, dayOfTick(tick), persona), 0.14);
}
