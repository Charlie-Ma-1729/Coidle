// 可重現的亂數：每個 tick 用 (seed, tick) 衍生獨立亂數流，
// 因此「一次補算 N 個 tick」與「逐 tick 推進」結果完全一致。

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  gauss(): number;
  poisson(lambda: number): number;
  /** 依權重抽一個索引；總權重為 0 時回傳 -1 */
  weighted(weights: number[]): number;
}

export function hash32(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (): number => {
    let u = 0;
    while (u === 0) u = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return {
    next,
    gauss,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda < 30) {
        const L = Math.exp(-lambda);
        let k = 0;
        let p = 1;
        do {
          k++;
          p *= next();
        } while (p > L);
        return k - 1;
      }
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
    },
    weighted: (weights) => {
      let total = 0;
      for (const w of weights) total += w;
      if (total <= 0) return -1;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
  };
}

export function rngForTick(seed: number, tick: number): Rng {
  return createRng(hash32(seed, tick));
}
