// 決定性亂數（股價引擎 v1／v2 共用）

/** 雜湊：(種子, 字串雜湊, 整數) → 0 到 1 */
export function rnd(seed: number, a: number, b: number, salt: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca6b) ^ Math.imul((b | 0) + salt * 0x27d4eb2f, 0xc2b2ae35)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 近似標準常態（四個均勻亂數相加） */
export function gauss(seed: number, a: number, b: number, salt: number): number {
  return (rnd(seed, a, b, salt) + rnd(seed, a, b, salt + 1) + rnd(seed, a, b, salt + 2) + rnd(seed, a, b, salt + 3) - 2) / 0.5774;
}

