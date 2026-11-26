import { TICKS_PER_DAY } from "./data";
import { SUPPLIERS } from "./supply";
import type { ShockKind, SupplierShock, SupplyFamily } from "./types";

// 全服供應衝擊：罷工、颱風、食安回收、海關延誤……同一家供應商出事，所有用它的商場都會受影響。
// 排程是「伺服器 tick」的純函式（固定的世界種子），所以：
//  - 每座商場各自模擬都會算出同一份排程，不需要信件、不需要資料庫；
//  - 落後的商場補算、新開的商場，結果都一致（決定性）。
// 商場自己的關係／長約只決定「被衝擊時自己拿到多少貨」，不影響排程本身。

const WORLD_SHOCK_SEED = 0x5c0c1d1e;

export interface ShockKindDef {
  label: string;
  icon: string;
  weight: number;
  /** 持續天數範圍（遊戲日） */
  days: [number, number];
  /** 基礎供貨比例範圍 */
  fill: [number, number];
  /** 預告提前量（tick，288＝1 遊戲日）；0＝沒有預告 */
  warn: [number, number];
  /** 限定哪些供應家族會發生；沒寫＝全部 */
  families?: SupplyFamily[];
  /** 預告時的說明 */
  warnText: string;
  startText: string;
  endText: string;
  /** 漲價型：價格倍率範圍 */
  price?: [number, number];
}

export const SHOCK_KINDS: Record<ShockKind, ShockKindDef> = {
  strike: {
    label: "罷工",
    icon: "✊",
    weight: 3,
    days: [2, 5],
    fill: [0.15, 0.35],
    warn: [144, 288],
    warnText: "工會表決通過罷工案",
    startText: "開始罷工，出貨大減",
    endText: "復工了，慢慢恢復供貨",
  },
  typhoon: {
    label: "颱風／風雪",
    icon: "🌀",
    weight: 2.5,
    days: [1, 3],
    fill: [0.3, 0.55],
    warn: [72, 216],
    families: ["seafood", "produce", "grain", "meat", "sweets", "drinks", "goods", "apparel"],
    warnText: "氣象局發布警報，物流可能中斷",
    startText: "受天候影響，物流中斷、出貨吃緊",
    endText: "天候轉好，物流恢復中",
  },
  recall: {
    label: "食安回收",
    icon: "⚠️",
    weight: 1.6,
    days: [2, 4],
    fill: [0.1, 0.3],
    warn: [0, 0],
    families: ["meat", "seafood", "grain", "produce", "sweets", "drinks", "beauty", "medical"],
    warnText: "",
    startText: "發生回收事件，整批貨下架檢查",
    endText: "檢查完畢，恢復出貨",
  },
  customs: {
    label: "海關延誤",
    icon: "🛃",
    weight: 1.8,
    days: [2, 5],
    fill: [0.45, 0.7],
    warn: [72, 144],
    families: ["goods", "apparel", "beauty", "tech", "culture", "drinks", "venue", "seafood", "meat"],
    warnText: "港口與海關塞船，進口貨可能延誤",
    startText: "海關塞船，進口貨大量延誤",
    endText: "海關疏通，貨陸續到齊",
  },
  poor_harvest: {
    label: "歉收",
    icon: "🌾",
    weight: 1.6,
    days: [4, 9],
    fill: [0.4, 0.65],
    warn: [144, 288],
    families: ["grain", "produce", "sweets", "meat", "drinks"],
    warnText: "產地傳出歉收，收成不如預期",
    startText: "歉收造成缺貨，供應吃緊",
    endText: "新一季收成上市，供貨回穩",
  },
  ban: {
    label: "禁令／休漁",
    icon: "🚫",
    weight: 1,
    days: [3, 6],
    fill: [0.2, 0.4],
    warn: [144, 288],
    families: ["seafood", "meat", "medical", "beauty"],
    warnText: "主管機關公告管制措施",
    startText: "管制措施生效，供貨受限",
    endText: "管制解除，恢復供貨",
  },
  bankrupt: {
    label: "倒閉",
    icon: "💥",
    weight: 0.5,
    days: [6, 10],
    fill: [0, 0],
    warn: [0, 0],
    warnText: "",
    startText: "宣布倒閉，完全停止出貨",
    endText: "由新東家接手，重新開始供貨",
  },
  price_spike: {
    label: "行情飆漲",
    icon: "📈",
    weight: 2.2,
    days: [3, 7],
    fill: [1, 1],
    warn: [72, 216],
    warnText: "原料行情劇烈波動，供應商醞釀調價",
    startText: "宣布調漲價格",
    endText: "行情回穩，價格調回",
    price: [1.2, 1.5],
  },
};

export const SHOCK_KIND_ORDER = Object.keys(SHOCK_KINDS) as ShockKind[];

/** 最長可能的衝擊（含預告）有幾個遊戲日，往前回看這麼多天就一定找得到所有還在生效的 */
const MAX_LOOKBACK_DAYS = 12;

export interface WorldShock extends SupplierShock {
  supplierId: string;
  family: SupplyFamily;
}

function mix(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, [lo, hi]: [number, number]) => lo + (hi - lo) * r();

const dayCache = new Map<number, WorldShock[]>();

/** 「開始日」落在第 day 天（伺服器日）的所有衝擊 */
export function shocksStartingOnDay(day: number): WorldShock[] {
  const hit = dayCache.get(day);
  if (hit) return hit;
  const r = stream(mix(WORLD_SHOCK_SEED, day + 1_000_003));
  const out: WorldShock[] = [];
  // 平均每天約 0.7 件；偶爾一天兩件
  const count = (r() < 0.5 ? 1 : 0) + (r() < 0.2 ? 1 : 0) + (r() < 0.12 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const kind = SHOCK_KIND_ORDER[pickWeighted(r, SHOCK_KIND_ORDER.map((k) => SHOCK_KINDS[k].weight))]!;
    const def = SHOCK_KINDS[kind];
    const pool = SUPPLIERS.filter((x) => !def.families || def.families.includes(x.family));
    // 可靠度低的供應商更容易出事
    const sup = pool[pickWeighted(r, pool.map((x) => 0.6 + (1 - x.reliability) * 2))]!;
    const startTick = day * TICKS_PER_DAY + Math.floor(r() * TICKS_PER_DAY);
    const lead = Math.round(between(r, def.warn));
    const days = def.days[0] + Math.floor(r() * (def.days[1] - def.days[0] + 1));
    const shock: WorldShock = {
      id: `${day}.${i}`,
      supplierId: sup.id,
      family: sup.family,
      kind,
      warnTick: Math.max(0, startTick - lead),
      startTick,
      endTick: startTick + days * TICKS_PER_DAY,
      fill: Math.round(between(r, def.fill) * 100) / 100,
    };
    if (def.price) shock.priceMult = Math.round(between(r, def.price) * 100) / 100;
    out.push(shock);
  }
  if (dayCache.size > 400) dayCache.clear();
  dayCache.set(day, out);
  return out;
}

function pickWeighted(r: () => number, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let x = r() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i] ?? 0;
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/**
 * 此刻（含預告期）有效的衝擊，每家供應商只留一件（開始得較晚的蓋過較早的）。
 * 預告期＝tick 已到 warnTick 但還沒到 startTick。
 */
export function activeSupplyShocks(tick: number): Map<string, WorldShock> {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const found: WorldShock[] = [];
  for (let d = Math.max(0, day - MAX_LOOKBACK_DAYS); d <= day + 1; d++) {
    for (const sh of shocksStartingOnDay(d)) {
      if (sh.warnTick <= tick && tick < sh.endTick) found.push(sh);
    }
  }
  found.sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id));
  const out = new Map<string, WorldShock>();
  for (const sh of found) out.set(sh.supplierId, sh);
  return out;
}

/** 衝擊已經生效（過了預告期）嗎 */
export function shockIsLive(sh: Pick<SupplierShock, "startTick" | "endTick">, tick: number): boolean {
  return sh.startTick <= tick && tick < sh.endTick;
}
