/**
 * 裝飾性人潮：由店面狀態推導生成率，沿著走道圖走進店面、停留、離開。
 * 不影響伺服器帳目——數字以伺服器為準，這裡只負責「看起來有人」。
 * 純邏輯、不依賴 Pixi，可單元測試（輸入 rng 即可確定性重現）。
 */
import { TIME_SCALE, hourlyTraffic, isWet, weatherTrafficAverage, type Weather } from "@coidle/shared";
import { FURNITURE } from "./furniture";
import { TILE, patrolEnds, pickEntrance, routeTo, type FloorPlan, type RoomRect } from "./floorplan";
import { isShopActive, type StageShop } from "./model";

export type Rng = () => number;

/** mulberry32：小而快的確定性亂數 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PxPt {
  x: number;
  y: number;
}

export type AgentKind = "customer" | "cleaner";
export type AgentPhase = "walk" | "dwell" | "done";

export interface Agent {
  id: number;
  kind: AgentKind;
  variant: number;
  x: number;
  y: number;
  /** 面向：-1 左、1 右 */
  face: 1 | -1;
  phase: AgentPhase;
  moving: boolean;
  sitting: boolean;
  /** 目的店（slot）；路過者為 null */
  slot: number | null;
  path: PxPt[];
  speed: number;
  dwell: number;
  /** 停留結束後的離場路徑（進店時預先算好） */
  back: PxPt[];
  /** 撐著傘（下雨天從街門進來的人，走進館內就收傘） */
  umbrella: boolean;
  /** 出現時的 x（像素）：離入口夠遠就收傘 */
  originX: number;
}

/** 走離入口這麼遠（像素）就收傘 */
export const UMBRELLA_RANGE = 56;

/** 營業時間內的相對人潮（午餐與晚餐尖峰） */
export function hourWeight(minuteOfDay: number): number {
  const h = minuteOfDay / 60;
  const bump = (c: number, w: number, a: number) => a * Math.exp(-((h - c) * (h - c)) / (2 * w * w));
  return 0.55 + bump(12.5, 1.1, 0.9) + bump(19, 1.4, 1.1);
}

export function isOpenAt(minuteOfDay: number, openHour: number, closeHour: number): boolean {
  const h = minuteOfDay / 60;
  return (h >= openHour && h < closeHour) || (closeHour > 24 && h < closeHour - 24);
}

// ───────── 人潮量：依伺服器的真實來客曲線換算 ─────────
// 伺服器每個遊戲小時抽出多少「團」客人（step.ts runCustomers），畫面就照同樣的比例與分布生成人。
// 只換算比例，不影響帳目；VISUAL_SCALE 是讓畫面「看得出來有人」的示意放大倍數。

/** 1 遊戲小時 = 幾個真實秒（遊戲時間 = 真實時間 × TIME_SCALE） */
export const GAME_HOUR_REAL_SECONDS = 3600 / TIME_SCALE;
/** 一團客人平均幾人（各客群 party 的粗略平均） */
const AVG_PARTY = 2;
/** 示意放大倍數：一般店面同時在場約 1～5 人 */
export const VISUAL_SCALE = 4;
/** 剛開店還沒有成交時的先驗：PRIOR_GROUPS 團／PRIOR_HOURS 小時（避免早上空蕩蕩） */
const PRIOR_GROUPS = 4;
const PRIOR_HOURS = 0.5;
/** 熱身秒數：略大於「走進店＋停留＋走出去」的時間，開場就達到穩態人數 */
export const WARMUP_SECONDS = 25;

interface ShapeTable {
  /** 營業時段內每個小時的相對流量（營業時段平均 = 1），依開店後第幾小時排列 */
  perHour: number[];
  openHour: number;
}
const shapeCache = new Map<string, ShapeTable>();

function shapeTable(openHour: number, closeHour: number, weekend: boolean): ShapeTable {
  const key = `${openHour}|${closeHour}|${weekend ? 1 : 0}`;
  let t = shapeCache.get(key);
  if (!t) {
    const traffic = hourlyTraffic(weekend);
    const raw: number[] = [];
    for (let h = Math.floor(openHour); h < closeHour; h++) raw.push(traffic[h % 24] ?? 0);
    const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length) || 1;
    t = { perHour: raw.map((v) => v / mean), openHour: Math.floor(openHour) };
    shapeCache.set(key, t);
  }
  return t;
}

/** 開店後經過的小時數（過午夜時連續計算） */
function hoursSinceOpen(minuteOfDay: number, openHour: number): number {
  let d = minuteOfDay / 60 - openHour;
  if (d < 0) d += 24;
  return d;
}

/** 此刻的相對流量：伺服器各客群的時段曲線加總，營業時段平均為 1；打烊為 0。weekend＝休息日（用假日曲線） */
export function trafficShape(minuteOfDay: number, openHour: number, closeHour: number, weekend: boolean): number {
  if (!isOpenAt(minuteOfDay, openHour, closeHour)) return 0;
  const t = shapeTable(openHour, closeHour, weekend);
  return t.perHour[Math.min(t.perHour.length - 1, Math.floor(hoursSinceOpen(minuteOfDay, openHour)))] ?? 1;
}

/** 開店到現在累計的「平均小時」（流量曲線的積分）：用來把當天累計成交換算成每平均小時的來客率 */
export function trafficElapsed(minuteOfDay: number, openHour: number, closeHour: number, weekend: boolean): number {
  const t = shapeTable(openHour, closeHour, weekend);
  const d = Math.max(0, hoursSinceOpen(minuteOfDay, openHour));
  const idx = Math.min(t.perHour.length, Math.floor(d));
  let sum = 0;
  for (let i = 0; i < idx; i++) sum += t.perHour[i] ?? 0;
  if (idx < t.perHour.length) sum += (d - idx) * (t.perHour[idx] ?? 0);
  return sum;
}

/** 每個真實秒鐘的顧客生成率（單店）。比例＝這家店當天的平均來客率 × 此刻的伺服器流量曲線 */
export function spawnRatePerSec(
  shop: StageShop | null | undefined,
  minuteOfDay: number,
  openHour: number,
  closeHour: number,
  weekend = false,
): number {
  if (!isShopActive(shop)) return 0;
  if (!isOpenAt(minuteOfDay, openHour, closeHour)) return 0;
  const perAvgHour = (shop.todayGroups + PRIOR_GROUPS) / (trafficElapsed(minuteOfDay, openHour, closeHour, weekend) + PRIOR_HOURS);
  let rate = ((perAvgHour * trafficShape(minuteOfDay, openHour, closeHour, weekend)) / GAME_HOUR_REAL_SECONDS) * AVG_PARTY * VISUAL_SCALE;
  if (shop.flags.includes("stockout")) rate *= 0.3;
  if (shop.flags.includes("stale")) rate *= 0.7;
  if (shop.flags.includes("complaint")) rate *= 0.85;
  return rate;
}

export interface CrowdConfig {
  plan: FloorPlan;
  rng: Rng;
  maxAgents?: number;
}

const px = (p: { x: number; y: number }): PxPt => ({ x: p.x * TILE, y: p.y * TILE });

export class CrowdSim {
  readonly agents: Agent[] = [];
  private nextId = 1;
  private acc = new Map<number, number>();
  private max: number;
  private wet = false;
  /** 天氣造成的人潮疏密（雨天變少、晴天略多）；與伺服器的客流規則同一份係數 */
  private scale = 1;

  /** 依天氣調整：人潮疏密、是否撐傘 */
  setWeather(w: Weather): void {
    this.wet = isWet(w);
    this.scale = weatherTrafficAverage(w);
  }

  constructor(private cfg: CrowdConfig) {
    this.max = cfg.maxAgents ?? 100;
  }

  /** 效能吃緊時調低人潮上限（已在場的人照常走完，只是不再生成新的） */
  setMax(n: number): void {
    this.max = n;
  }

  /** 清潔員：沿主走道來回走（有客訴、下雨時才出現） */
  ensureCleaner(on: boolean): void {
    this.ensureCleaners(on ? 1 : 0);
  }

  /** 維持 n 位清潔員（有客訴 1 位；簽了清潔的話下雨、颱風天加派）。從走道兩端交錯出發、錯開行走線 */
  ensureCleaners(n: number): void {
    const have = this.agents.filter((a) => a.kind === "cleaner");
    for (let i = have.length; i < n; i++) {
      const [a, b] = patrolEnds(this.cfg.plan).map(px) as [PxPt, PxPt];
      const from = i % 2 === 0 ? a : b;
      const to = i % 2 === 0 ? b : a;
      const dy = 5 + (i % 3) * 5;
      this.agents.push({
        id: this.nextId++,
        kind: "cleaner",
        variant: 3,
        x: from.x,
        y: from.y + dy,
        face: from.x < to.x ? 1 : -1,
        phase: "walk",
        moving: true,
        sitting: false,
        slot: null,
        path: [{ x: to.x, y: to.y + dy }],
        speed: 14 + (i % 2) * 3,
        dwell: 0,
        back: [],
        umbrella: false,
        originX: from.x,
      });
    }
    for (let i = have.length - 1; i >= n; i--) this.agents.splice(this.agents.indexOf(have[i]!), 1);
  }

  /**
   * 預先跑一段時間（0.2 秒步長）：新建或切回這層時，讓場上直接是穩態人數，不從空蕩蕩開始。
   * 場上已有的人照常繼續走。
   */
  warmUp(seconds: number, shops: Map<number, StageShop | null>, minuteOfDay: number, openHour: number, closeHour: number, weekend = false): void {
    for (let t = 0; t < seconds; t += 0.2) this.update(0.2, shops, minuteOfDay, openHour, closeHour, weekend);
  }

  update(dt: number, shops: Map<number, StageShop | null>, minuteOfDay: number, openHour: number, closeHour: number, weekend = false): void {
    const { plan } = this.cfg;
    // 生成
    for (const room of plan.rooms) {
      const shop = shops.get(room.slot);
      const rate = spawnRatePerSec(shop, minuteOfDay, openHour, closeHour, weekend) * this.scale;
      if (rate <= 0) continue;
      const acc = (this.acc.get(room.slot) ?? 0) + rate * dt;
      if (acc >= 1 && this.agents.length < this.max) {
        this.acc.set(room.slot, acc - 1);
        this.spawnCustomer(room, shop!);
      } else this.acc.set(room.slot, Math.min(acc, 1.2));
    }
    // 移動
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i]!;
      if (a.phase === "dwell") {
        a.moving = false;
        a.dwell -= dt;
        if (a.dwell <= 0) {
          a.phase = "walk";
          a.sitting = false;
          a.path = a.back;
          a.back = [];
        }
        continue;
      }
      if (a.umbrella && Math.abs(a.x - a.originX) > UMBRELLA_RANGE) a.umbrella = false;
      if (a.phase === "walk") {
        let budget = a.speed * dt;
        a.moving = true;
        while (budget > 0 && a.path.length > 0) {
          const t = a.path[0]!;
          const dx = t.x - a.x;
          const dy = t.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d <= budget) {
            a.x = t.x;
            a.y = t.y;
            a.path.shift();
            budget -= d;
            if (Math.abs(dx) > 0.01) a.face = dx > 0 ? 1 : -1;
          } else {
            a.x += (dx / d) * budget;
            a.y += (dy / d) * budget;
            if (Math.abs(dx) > 0.01) a.face = dx > 0 ? 1 : -1;
            budget = 0;
          }
        }
        if (a.path.length === 0) {
          if (a.kind === "cleaner") {
            const [p, q] = patrolEnds(plan).map(px) as [PxPt, PxPt];
            const mid = (p.x + q.x) / 2;
            const t = a.x > mid ? p : q;
            a.path = [{ x: t.x, y: a.y }];
          } else if (a.back.length > 0 && a.slot !== null && a.dwell > 0) {
            a.phase = "dwell";
            a.moving = false;
          } else {
            a.phase = "done";
          }
        }
      }
      if (a.phase === "done") this.agents.splice(i, 1);
    }
  }

  private spawnCustomer(room: RoomRect, shop: StageShop): void {
    const { plan, rng } = this.cfg;
    const entrance = pickEntrance(plan, rng());
    const route = routeTo(plan, entrance.id, room.slot);
    if (!route || route.length === 0) return;

    // 走道上稍微錯開，避免所有人走同一條線
    const jy = (rng() - 0.5) * 9;
    const pts = route.map((p, i) => ({ x: p.x * TILE, y: p.y * TILE + (i < route.length - 1 ? jy : 0) }));
    // 電扶梯／電梯：客人從設施本體走出來，離場時也走回去
    if (entrance.from) pts.unshift(px(entrance.from));

    const furn = FURNITURE[shop.archetype];
    const spot = furn.spots[Math.floor(rng() * furn.spots.length)]!;
    const doorX = room.door.x * TILE;
    const spotX = room.x * TILE + spot.x + (rng() - 0.5) * 3;
    const spotY = room.y * TILE + spot.y;
    // 進出房間的內側點
    const gate: PxPt = room.row === "top" ? { x: doorX, y: (room.y + room.h) * TILE - 6 } : { x: doorX, y: (room.y + 2) * TILE + 8 };

    const start = pts[0]!;
    const toDoor: PxPt[] = [...pts.slice(1), gate, { x: spotX, y: spotY }];
    const back: PxPt[] = [gate, ...pts.slice().reverse()];

    const next = pts[1] ?? gate;
    this.agents.push({
      id: this.nextId++,
      kind: "customer",
      variant: Math.floor(rng() * 48),
      x: start.x,
      y: start.y,
      face: next.x >= start.x ? 1 : -1,
      phase: "walk",
      moving: true,
      sitting: !!spot.sit,
      slot: room.slot,
      path: toDoor,
      speed: 26 + rng() * 10,
      dwell: 7 + rng() * 14,
      back,
      // 下雨天從街上走進來的人撐著傘，進了室內就收起來
      umbrella: this.wet && entrance.kind === "street",
      originX: start.x,
    });
  }
}
