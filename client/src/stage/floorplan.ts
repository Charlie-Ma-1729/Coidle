/**
 * 商場平面圖：純函式，單位全是「格」（tile = 16px）。
 *
 * 俯視剖面慣例：每間店背牆在上、地板在下。
 *  - "top" 型：前方開口朝南（門在下緣），面對它下方的走道。
 *  - "bottom" 型：門開在上方牆，從它上方（北邊）的走道進入。
 *
 * 兩種版型（依店面格數）：
 *  - compact（≤ 8 格）：單一走道，上下各一排；中間斷開成十字形中庭。
 *      y=1..6 上排　y=7..10 走道 C0　y=11..16 下排
 *  - island（9–14 格）：雙走道 + 中間一排背靠背的島型店面，左右有側廊環繞，中庭貫穿。
 *      y=1..6 T　C0 y=7..10　I1 y=11..16（朝北進）　I2 y=17..22（朝南出）　C1 y=23..26　B y=27..32
 *
 * 橫向：側廊 3 格 | 左群店面 | 中庭 4 格 | 右群店面 | 側廊 3 格
 */

export const TILE = 16;
export const ROOM_W = 8;
export const WALL_H = 2;
export const FLOOR_H = 4;
export const ROOM_H = WALL_H + FLOOR_H;
export const CORRIDOR_H = 4;
export const SIDE = 3;
export const ATRIUM_W = 4;
export const TOP_Y = 1;
export const MAX_LOTS = 14;
export const COMPACT_MAX = 8;

export interface Pt {
  x: number;
  y: number;
}

export type RoomRow = "top" | "bottom";
export type Layout = "compact" | "island";
/**
 * 客人進出商場的方式。只有 1F（地面層）有對外的街道門；
 * 其他樓層的客人只能搭電扶梯或電梯上下，除非那層另外連通軌道（車站）或停車場。
 */
export type EntranceId = "street-left" | "street-right" | "rail" | "parking" | "escalator" | "elevator";
export type EntranceKind = "street" | "rail" | "parking" | "escalator" | "elevator";
/** 非地面層可以額外連通的外部出入口 */
export type FloorLinkKind = "rail" | "parking";
/** 主走道兩端的樣子 */
export type EndKind = "street" | "rail" | "parking" | "wall";

export interface FloorPlanOptions {
  /** 地面層（1F）：兩端是對外街道門 */
  ground?: boolean;
  /** 非地面層連通的外部出入口（依序放左端、右端） */
  links?: FloorLinkKind[];
}

export interface Entrance {
  id: EntranceId;
  kind: EntranceKind;
  /** 走道行走線上的接點（格） */
  at: Pt;
  /** 客人出現的位置（格）：電扶梯中段、電梯門口；沒有就從接點出現 */
  from?: Pt;
  /** 抽中的相對機率 */
  weight: number;
}

export interface RoomRect {
  slot: number;
  row: RoomRow;
  /** 這間店面對的走道編號 */
  corridor: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 門口在走道行走線上的點（格） */
  door: Pt;
}

export interface Corridor {
  index: number;
  /** 走道上緣（格） */
  y: number;
  h: number;
  /** 行走線的 y（格） */
  laneY: number;
}

export interface Connector {
  id: "left" | "atrium" | "right";
  x: number;
  y0: number;
  y1: number;
}

/** 沒有店面的外側欄位：畫成服務區塊（廁所、機房…） */
export interface ServiceBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  row: RoomRow;
}

export interface FloorPlan {
  layout: Layout;
  /** 版型簽名：背景貼圖快取用 */
  sig: string;
  width: number;
  height: number;
  rooms: RoomRect[];
  corridors: Corridor[];
  connectors: Connector[];
  serviceBlocks: ServiceBlock[];
  /** 中庭範圍（格） */
  atrium: { x0: number; x1: number };
  /** 噴水池中心（格） */
  fountain: Pt;
  /** 手扶梯區塊（格） */
  escalator: { x: number; y: number; w: number; h: number };
  /** 客人進來的入口（地面層才有街道門） */
  entrances: Entrance[];
  /** 主走道左右兩端是什麼（街道門／車站／停車場／實牆） */
  ends: { left: EndKind; right: EndKind };
  mainCorridor: number;
  graph: Graph;
  routes: Map<string, Pt[]>;
}

// ───────── 版型 ─────────

type RowKind = "T" | "I1" | "I2" | "B";

interface RowSpec {
  kind: RowKind;
  row: RoomRow;
  corridor: number;
  y: number;
}

function rowSpecs(layout: Layout): RowSpec[] {
  if (layout === "compact") {
    return [
      { kind: "T", row: "top", corridor: 0, y: TOP_Y },
      { kind: "B", row: "bottom", corridor: 0, y: TOP_Y + ROOM_H + CORRIDOR_H },
    ];
  }
  const c0 = TOP_Y + ROOM_H;
  const i1 = c0 + CORRIDOR_H;
  const i2 = i1 + ROOM_H;
  const c1 = i2 + ROOM_H;
  return [
    { kind: "T", row: "top", corridor: 0, y: TOP_Y },
    { kind: "I1", row: "bottom", corridor: 0, y: i1 },
    { kind: "I2", row: "top", corridor: 1, y: i2 },
    { kind: "B", row: "bottom", corridor: 1, y: c1 + CORRIDOR_H },
  ];
}

/** 每排放幾間：compact 上排多一個；island 平均分，餘數從上排開始補 */
export function rowCounts(n: number): { layout: Layout; counts: number[] } {
  const total = Math.min(n, MAX_LOTS);
  if (total <= COMPACT_MAX) {
    const t = Math.ceil(total / 2);
    return { layout: "compact", counts: [t, total - t] };
  }
  const base = Math.floor(total / 4);
  const rem = total % 4;
  return { layout: "island", counts: [0, 1, 2, 3].map((i) => base + (i < rem ? 1 : 0)) };
}

/** 這層的入口：地面層兩端是街道；其他樓層只有電扶梯與電梯，加上連通的車站／停車場 */
function buildEntrances(width: number, escalator: FloorPlan["escalator"], corridors: Corridor[], mainLane: number, opts: FloorPlanOptions): { entrances: Entrance[]; ends: FloorPlan["ends"] } {
  const ground = !!opts.ground;
  const links = ground ? [] : [...new Set(opts.links ?? [])].slice(0, 2);
  const ends: FloorPlan["ends"] = ground ? { left: "street", right: "street" } : { left: links[0] ?? "wall", right: links[1] ?? "wall" };

  const shareOuter = ground ? 0.8 : 0.45 * links.length;
  const lift = 1 - shareOuter;
  const entrances: Entrance[] = [];
  const left = { x: 0.5, y: mainLane };
  const right = { x: width - 0.5, y: mainLane };
  if (ground) {
    entrances.push({ id: "street-left", kind: "street", at: left, weight: 0.45 }, { id: "street-right", kind: "street", at: right, weight: 0.35 });
  } else {
    if (ends.left !== "wall") entrances.push({ id: ends.left as "rail" | "parking", kind: ends.left as "rail" | "parking", at: left, weight: 0.45 });
    if (ends.right !== "wall") entrances.push({ id: ends.right as "rail" | "parking", kind: ends.right as "rail" | "parking", at: right, weight: 0.45 });
  }
  // 電扶梯：中庭那座，客人從中段走上來；電梯：右上角電梯廳，客人從門口走出來
  const escX = escalator.x + escalator.w / 2;
  entrances.push({ id: "escalator", kind: "escalator", at: { x: escX, y: mainLane }, from: { x: escX, y: escalator.y + escalator.h - 1 }, weight: lift * 0.6 });
  entrances.push({
    id: "elevator",
    kind: "elevator",
    at: { x: width - SIDE / 2, y: corridors[0]!.laneY },
    from: { x: width - SIDE / 2, y: corridors[0]!.y - 0.4 },
    weight: lift * 0.4,
  });
  return { entrances, ends };
}

/** 依權重抽一個入口（r 為 0–1 的亂數） */
export function pickEntrance(plan: FloorPlan, r: number): Entrance {
  const total = plan.entrances.reduce((a, e) => a + e.weight, 0);
  let t = r * total;
  for (const e of plan.entrances) {
    t -= e.weight;
    if (t < 0) return e;
  }
  return plan.entrances[plan.entrances.length - 1]!;
}

export function layoutFloor(slots: number[], opts: FloorPlanOptions = {}): FloorPlan {
  const n = Math.min(slots.length, MAX_LOTS);
  const { layout, counts } = rowCounts(n);
  const specs = rowSpecs(layout);

  // 每排左右各幾間（左多一間）
  const split = counts.map((k) => ({ left: Math.ceil(k / 2), right: Math.floor(k / 2) }));
  const cL = Math.max(1, ...split.map((s) => s.left));
  const cR = Math.max(1, ...split.map((s) => s.right));

  const x0 = SIDE + cL * ROOM_W; // 中庭左緣
  const x1 = x0 + ATRIUM_W;
  const width = x1 + cR * ROOM_W + SIDE;

  const corridors: Corridor[] = [];
  const c0y = TOP_Y + ROOM_H;
  corridors.push({ index: 0, y: c0y, h: CORRIDOR_H, laneY: c0y + 2 });
  if (layout === "island") {
    const c1y = c0y + CORRIDOR_H + ROOM_H * 2;
    corridors.push({ index: 1, y: c1y, h: CORRIDOR_H, laneY: c1y + 2 });
  }
  const mainCorridor = corridors.length - 1;
  const height = specs[specs.length - 1]!.y + ROOM_H + 1;

  const rooms: RoomRect[] = [];
  const serviceBlocks: ServiceBlock[] = [];
  // 第 i 個店面（依加蓋順序）固定落在「第 i % 排數 排、該排第 floor(i / 排數) 格」：
  // 每排內的順序是 左1（最靠中庭）、右1、左2、右2…。這樣擴建只會在尾端多出一格，
  // 已經蓋好的店面不會被換位置（排的數量與每排格數剛好和 rowCounts 一致）。
  specs.forEach((spec, ri) => {
    const sp = split[ri]!;
    const cor = corridors[spec.corridor]!;
    const rowSlots = slots.slice(0, n).filter((_, i) => i % specs.length === ri);
    const place = (x: number, slot: number) => {
      rooms.push({ slot, row: spec.row, corridor: spec.corridor, x, y: spec.y, w: ROOM_W, h: ROOM_H, door: { x: x + ROOM_W / 2, y: cor.laneY } });
    };
    // 左群：靠中庭那側對齊（右對齊），外側多出的欄位做服務區塊
    for (let i = 0; i < cL; i++) {
      const x = SIDE + i * ROOM_W;
      if (i >= cL - sp.left) place(x, rowSlots[(cL - 1 - i) * 2]!);
      else serviceBlocks.push({ x, y: spec.y, w: ROOM_W, h: ROOM_H, row: spec.row });
    }
    // 右群：靠中庭那側起排
    for (let i = 0; i < cR; i++) {
      const x = x1 + i * ROOM_W;
      if (i < sp.right) place(x, rowSlots[i * 2 + 1]!);
      else serviceBlocks.push({ x, y: spec.y, w: ROOM_W, h: ROOM_H, row: spec.row });
    }
  });

  const connectors: Connector[] = [
    { id: "left", x: SIDE / 2, y0: corridors[0]!.laneY, y1: corridors[mainCorridor]!.laneY },
    { id: "atrium", x: x0 + 3, y0: corridors[0]!.laneY, y1: corridors[mainCorridor]!.laneY },
    { id: "right", x: width - SIDE / 2, y0: corridors[0]!.laneY, y1: corridors[mainCorridor]!.laneY },
  ];

  const mainLane = corridors[mainCorridor]!.laneY;

  // 中庭擺設
  const fountain: Pt = layout === "compact" ? { x: x0 + 1.5, y: TOP_Y + 3.4 } : { x: x0 + 1.5, y: corridors[0]!.y + CORRIDOR_H + ROOM_H };
  const escY = layout === "compact" ? corridors[0]!.y + CORRIDOR_H + 1 : corridors[1]!.y + CORRIDOR_H + 1;
  const escalator = { x: x0 + 0.3, y: escY, w: 2.6, h: 4 };
  const { entrances, ends } = buildEntrances(width, escalator, corridors, mainLane, opts);

  const plan: FloorPlan = {
    layout,
    sig: `${layout}-${cL}-${cR}-${counts.join(".")}-${ends.left[0]}${ends.right[0]}`,
    width,
    height,
    rooms,
    corridors,
    connectors,
    serviceBlocks,
    atrium: { x0, x1 },
    fountain,
    escalator,
    entrances,
    ends,
    mainCorridor,
    graph: { nodes: [], adj: [], index: new Map() },
    routes: new Map(),
  };
  plan.graph = buildGraph(plan);
  return plan;
}

export function roomOfSlot(plan: FloorPlan, slot: number): RoomRect | undefined {
  return plan.rooms.find((r) => r.slot === slot);
}

// ───────── 路徑圖 ─────────
// 節點：走道行走線 × 垂直連接線的交點、各店門口、兩個入口。
// 邊：同一條走道行走線上相鄰節點、同一條垂直連接線上相鄰節點。

export interface Graph {
  nodes: Pt[];
  adj: number[][];
  index: Map<string, number>;
}

const keyOf = (p: Pt): string => `${p.x},${p.y}`;

function buildGraph(plan: FloorPlan): Graph {
  const g: Graph = { nodes: [], adj: [], index: new Map() };
  const add = (p: Pt): number => {
    const k = keyOf(p);
    const hit = g.index.get(k);
    if (hit !== undefined) return hit;
    g.nodes.push(p);
    g.adj.push([]);
    g.index.set(k, g.nodes.length - 1);
    return g.nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!g.adj[a]!.includes(b)) g.adj[a]!.push(b);
    if (!g.adj[b]!.includes(a)) g.adj[b]!.push(a);
  };

  const laneNodes = new Map<number, number[]>(); // laneY → 節點
  const vertNodes = new Map<number, number[]>(); // connector x → 節點
  const push = (m: Map<number, number[]>, k: number, v: number) => m.set(k, [...(m.get(k) ?? []), v]);

  for (const cor of plan.corridors) {
    for (const cn of plan.connectors) {
      const i = add({ x: cn.x, y: cor.laneY });
      push(laneNodes, cor.laneY, i);
      push(vertNodes, cn.x, i);
    }
  }
  for (const room of plan.rooms) push(laneNodes, room.door.y, add(room.door));
  for (const e of plan.entrances) push(laneNodes, e.at.y, add(e.at));

  for (const [, ids] of laneNodes) {
    const sorted = [...new Set(ids)].sort((a, b) => g.nodes[a]!.x - g.nodes[b]!.x);
    for (let i = 1; i < sorted.length; i++) link(sorted[i - 1]!, sorted[i]!);
  }
  for (const [, ids] of vertNodes) {
    const sorted = [...new Set(ids)].sort((a, b) => g.nodes[a]!.y - g.nodes[b]!.y);
    for (let i = 1; i < sorted.length; i++) link(sorted[i - 1]!, sorted[i]!);
  }
  return g;
}

function dijkstra(g: Graph, from: number, to: number): number[] | null {
  const dist = g.nodes.map(() => Infinity);
  const prev = g.nodes.map(() => -1);
  const done = g.nodes.map(() => false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && (u === -1 || dist[i]! < dist[u]!)) u = i;
    if (u === -1 || dist[u] === Infinity) return null;
    if (u === to) break;
    done[u] = true;
    for (const v of g.adj[u]!) {
      const d = dist[u]! + Math.abs(g.nodes[u]!.x - g.nodes[v]!.x) + Math.abs(g.nodes[u]!.y - g.nodes[v]!.y);
      if (d < dist[v]!) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev[c]!) path.push(c);
  return path.reverse();
}

/** 從某個入口走到某間店門口的路線（格）。結果有快取；找不到回傳 null。 */
export function routeTo(plan: FloorPlan, entrance: EntranceId, slot: number): Pt[] | null {
  const key = `${entrance}>${slot}`;
  const cached = plan.routes.get(key);
  if (cached) return cached;
  const room = roomOfSlot(plan, slot);
  if (!room) return null;
  const from = plan.entrances.find((e) => e.id === entrance);
  if (!from) return null;
  const a = plan.graph.index.get(keyOf(from.at));
  const b = plan.graph.index.get(keyOf(room.door));
  if (a === undefined || b === undefined) return null;
  const ids = dijkstra(plan.graph, a, b);
  if (!ids) return null;
  const pts = ids.map((i) => plan.graph.nodes[i]!);
  plan.routes.set(key, pts);
  return pts;
}

/** 走道上供清潔員巡邏的兩端（格） */
export function patrolEnds(plan: FloorPlan): [Pt, Pt] {
  const lane = plan.corridors[plan.mainCorridor]!.laneY;
  return [
    { x: 3, y: lane },
    { x: plan.width - 3, y: lane },
  ];
}
