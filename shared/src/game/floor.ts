// 樓層空地化與可變店面（階段 C，見 docs/floor-open-plan.md）。
//
// 模型（和草案 §1 的差異，2026-11-28 定案）：**格＝slot**。
// - 一個 slot 是一格樓板；`span` 缺＝1。大店佔 2／4 格：把店開在一個 slot 上，另外 span−1 個空 slot 變成「墓碑」（span 0，被這間店吸收）。
// - 樓板面積 `floorArea(s, zone)` ＝ 該區 slot 的 span 總和；resize／拆除只在店與墓碑之間搬格子，面積永遠不變，擴建才會 +1。
//   舊存檔沒有 span，面積＝slot 數，`expansionsOf` 與舊算法相等。
// - `Slot.id === 陣列索引` 永不改、不重排、不刪除；墓碑留在陣列裡，所有「找空地」的地方要用 `liveSlots` 排除。
// - 空的 slot（shopId 為空、沒在施工）都是可流通的格子：要開 span N 的店，就從同區找 N−1 個空的 span-1 slot 吸收。
import type { CategoryDef, MallState, PersonaId, Shop, Slot } from "./types";

export type Span = 1 | 2 | 4;
export const SPANS: readonly Span[] = [1, 2, 4];

/**
 * 大店的經濟（2026-11-28 重調，見 balance-report「大店」）：
 * - 容量線性放大（2 格＝2 倍）；
 * - 吸客力 `spanDraw`：大店在客人挑店時的權重。體驗型（KTV、健身房、親子樂園…）是「目的地」，2 格超過 2 倍；
 *   零售型 2 格約 2 倍（另有 `spanBasket`：每組買得更多）；
 * - 成本有規模經濟：建造費／翻新費 ×1.7、人事 ×1.5（小店 ×1）。
 * 所以同樣面積，大店吸客與容量不輸兩間小店、成本較低；但仍受「同一區空間有限、2 格要併相鄰空格、版面上限」限制，不是無腦最優。
 */
export const SPAN_FACTOR: Record<Span, number> = { 1: 1, 2: 2, 4: 3.6 };
const SPAN_COST: Record<Span, number> = { 1: 1, 2: 1.7, 4: 2.9 };
const SPAN_WAGE: Record<Span, number> = { 1: 1, 2: 1.5, 4: 2.6 };
/** 建造費、翻新費、拆除費按這個係數放大（有規模經濟）；固定資產評價仍按格數線性 */
export const spanCostFactor = (span: Span | undefined): number => SPAN_COST[span ?? 1] ?? 1;
/** 工期 ×√span（避免大店等太久） */
export const spanTicksFactor = (span: Span | undefined): number => Math.sqrt(span ?? 1);
export const spanWageFactor = (span: Span | undefined): number => SPAN_WAGE[span ?? 1] ?? 1;

export const spanFactor = (span: Span | undefined): number => SPAN_FACTOR[span ?? 1] ?? 1;

/** 目的地型業態：大小直接決定能吸多少客（包廂數、器材數、展區） */
export const DESTINATION_CATEGORIES: readonly string[] = ["karaoke", "gym", "kids_play", "arcade_vr", "observatory", "art_gallery", "claw"];
const DRAW_DESTINATION: Record<Span, number> = { 1: 1, 2: 1.5, 4: 2.8 };
const DRAW_RETAIL: Record<Span, number> = { 1: 1, 2: 1.3, 4: 2.3 };
/** 吸客力：客人挑店的權重倍數（小店＝1） */
export const spanDraw = (span: Span | undefined, category: string): number => (DESTINATION_CATEGORIES.includes(category) ? DRAW_DESTINATION : DRAW_RETAIL)[span ?? 1] ?? 1;
/**
 * 大店解鎖的新客層：2 格以上的店，除了原本的客層，還吸引小店吸引不到的客人
 * （KTV 的宴會大包廂＝公司聚會與家族慶生、健身房的團體課程教室＝親子與情侶課…）。
 * demand 是「加到該業態對該客層的需求」上（原本沒有的客層從 0 起算）。
 */
export const BIG_UNLOCK: Record<string, { label: string; demand: Partial<Record<PersonaId, number>> }> = {
  karaoke: { label: "宴會大包廂（公司聚會、家族慶生）", demand: { commuter: 0.5, family: 0.4, tourist: 0.2 } },
  gym: { label: "團體課程教室（親子課、雙人課、團課）", demand: { family: 0.4, couple: 0.3, student: 0.3 } },
  kids_play: { label: "生日派對包場（社區活動、旅客親子）", demand: { local: 0.4, tourist: 0.3 } },
  arcade_vr: { label: "團戰與包場區（公司團康、家庭同樂）", demand: { commuter: 0.5, family: 0.4 } },
  art_gallery: { label: "特展與校外教學", demand: { student: 0.5, commuter: 0.3 } },
  claw: { label: "主題專區（觀光與下班順路）", demand: { tourist: 0.4, commuter: 0.4, local: 0.3 } },
  observatory: { label: "夜景包場與活動", demand: { student: 0.4, commuter: 0.4, local: 0.3 } },
  grocery: { label: "生鮮與熟食區（伴手禮、年輕客）", demand: { tourist: 0.3, student: 0.3, couple: 0.2 } },
  electronics: { label: "體驗與課程區（親子、情侶）", demand: { family: 0.4, couple: 0.3 } },
  camera: { label: "攝影課與沖洗服務（親子、下班族）", demand: { family: 0.4, commuter: 0.3 } },
};
/** 這間店（依大小）對某客層的需求：基本需求＋大店解鎖 */
export const shopDemand = (cat: Pick<CategoryDef, "id" | "demand">, span: Span | undefined, persona: PersonaId): number =>
  (cat.demand[persona] ?? 0) + (span && span > 1 ? BIG_UNLOCK[cat.id]?.demand[persona] ?? 0 : 0);

/** 零售（有庫存）業態：品項更齊，每組客人買得更多 */
export const spanBasket = (span: Span | undefined): number => ({ 1: 1, 2: 1.15, 4: 1.3 })[span ?? 1] ?? 1;

/** 拆除費：建造費 × span × 這個比例（含裝潢報廢，不退款） */
export const DEMOLISH_FEE_RATE = 0.25;
/** 同一區域兩次拆除之間的冷卻（遊戲日） */
export const DEMOLISH_COOLDOWN_DAYS = 1;
/** 擴建面積上限的硬上限（island 版型寬度與地圖捲動；預設維持 14） */
export const MAX_AREA = 14;

/**
 * 每個業態可選的大小；缺＝只有 1 格。階段 C 開旗標之前，所有店一律 span 1。
 * 目前只開放 1／2 格：2 格＝左右相鄰的兩間併成一間寬房間；4 格（2×2）要背靠背房間合併，
 * 而機器人模擬顯示 4 格的邊際營收近乎零（見 balance-report），暫不開放（型別與係數保留）。
 */
export const FOOTPRINT_BY_CATEGORY: Record<string, { options: Span[]; default: Span }> = {
  grocery: { options: [1, 2], default: 2 },
  gym: { options: [1, 2], default: 2 },
  kids_play: { options: [1, 2], default: 2 },
  arcade_vr: { options: [1, 2], default: 2 },
  claw: { options: [1, 2], default: 1 },
  karaoke: { options: [1, 2], default: 2 },
  observatory: { options: [1, 2], default: 2 },
  electronics: { options: [1, 2], default: 2 },
  camera: { options: [1, 2], default: 1 },
  art_gallery: { options: [1, 2], default: 2 },
};

/**
 * 版面幾何（要和 client 的 floorplan.rowCounts 一致）：一區有 n 格時，最多能併出幾間「2 格寬」的店。
 * ≤8 格＝2 排（走道上下各一排，每排上限各 4），9–14 格＝4 排（島型）。每排左右兩群（隔著中庭），
 * 兩格併成一間要在同一群內左右相鄰，所以一群 k 格最多併 floor(k/2) 間。
 * 畫面端的平面圖會把併店的格子重新安排到相鄰的位置（見 client/src/stage/floorplan.ts）。
 */
export const COMPACT_CELLS = 8;
export function mergeCapacity(n: number): number {
  const total = Math.min(Math.max(0, n), MAX_AREA);
  let counts: number[];
  if (total <= COMPACT_CELLS) {
    const t = Math.ceil(total / 2);
    counts = [t, total - t];
  } else {
    const base = Math.floor(total / 4);
    const rem = total % 4;
    counts = [0, 1, 2, 3].map((i) => base + (i < rem ? 1 : 0));
  }
  return counts.reduce((a, c) => a + Math.floor(Math.ceil(c / 2) / 2) + Math.floor(Math.floor(c / 2) / 2), 0);
}

/** 這一區已經併了幾間大店（墓碑格數） */
export const mergedCount = (s: Pick<MallState, "slots">, zone: string): number => s.slots.filter((x) => x.zone === zone && x.span === 0).length;

export function footprintOf(cat: Pick<CategoryDef, "id">): { options: Span[]; default: Span } {
  return FOOTPRINT_BY_CATEGORY[cat.id] ?? { options: [1], default: 1 };
}

/** 伺服器旗標：開了才允許 span > 1、拆除（每座商場一個，sandbox 先試；或環境變數 OPEN_PLAN_ENABLED=1 全服啟用） */
export const OPEN_PLAN_FLAG = "feature:open_plan";
export const openPlanEnabled = (s: Pick<MallState, "flags">): boolean => s.flags[OPEN_PLAN_FLAG] === true;

export const slotSpan = (x: Pick<Slot, "span">): number => x.span ?? 1;
/** 墓碑（span 0）：被大店吸收的格子，不顯示、不算空地 */
export const isLiveSlot = (x: Pick<Slot, "span">): boolean => x.span !== 0;

/** 活著的 slot（排除墓碑）；傳 zone 就只看那一區 */
export function liveSlots(s: Pick<MallState, "slots">, zone?: string): Slot[] {
  return s.slots.filter((x) => isLiveSlot(x) && (zone === undefined || x.zone === zone));
}

/** 樓板面積（格）：同區 slot 的 span 總和。resize／拆除不改變它，擴建 +1 */
export function floorArea(s: Pick<MallState, "slots">, zone: string): number {
  let a = 0;
  for (const x of s.slots) if (x.zone === zone) a += slotSpan(x);
  return a;
}

/** 這個 slot 現在被占用（有店，或有施工中的工程） */
export function slotBusy(s: Pick<MallState, "builds">, x: Pick<Slot, "id" | "shopId">): boolean {
  return !!x.shopId || s.builds.some((b) => b.slot === x.id);
}

/** 已被店（含施工中）占用的格數 */
export function usedCells(s: Pick<MallState, "slots" | "builds">, zone: string): number {
  let a = 0;
  for (const x of s.slots) if (x.zone === zone && isLiveSlot(x) && slotBusy(s, x)) a += slotSpan(x);
  return a;
}

export const freeCells = (s: Pick<MallState, "slots" | "builds">, zone: string): number => floorArea(s, zone) - usedCells(s, zone);

export interface ResizePlan {
  ok: boolean;
  error?: string;
  /** 要被吸收成墓碑的 slot（放大時） */
  absorb: number[];
  /** 要復活成空格的墓碑 slot（縮小時） */
  revive: number[];
}

/**
 * 把一個「空的」slot 改成 span 格寬的計畫（純函式，client／server 共用）。
 * 放大：從同區找空的 span-1 slot（先找編號在後面的、再找前面的）吸收；縮小：復活墓碑。
 * `cells` 可由玩家指定要吸收哪幾格（規劃模式），沒給就自動挑。
 */
export function planResize(s: Pick<MallState, "slots" | "builds">, slotId: number, span: Span, cells?: number[]): ResizePlan {
  const none = { absorb: [] as number[], revive: [] as number[] };
  const slot = s.slots[slotId];
  if (!slot || !isLiveSlot(slot)) return { ok: false, error: "店面無效", ...none };
  if (slotBusy(s, slot)) return { ok: false, error: "這個店面已被使用或正在施工", ...none };
  const cur = slotSpan(slot);
  if (span === cur) return { ok: true, ...none };
  if (span < cur) {
    const mine = s.slots.filter((x) => x.zone === slot.zone && x.span === 0 && x.into === slot.id).map((x) => x.id);
    const rest = s.slots.filter((x) => x.zone === slot.zone && x.span === 0 && x.into !== slot.id).map((x) => x.id);
    const need = cur - span;
    const tombs = [...mine, ...rest]; // 舊資料沒有 into 時退回「同區任一墓碑」
    if (tombs.length < need) return { ok: false, error: "格子資料不一致，無法縮小", ...none };
    return { ok: true, absorb: [], revive: tombs.slice(0, need) };
  }
  if (span !== 2) return { ok: false, error: "這個大小目前不開放", ...none };
  const free = s.slots.filter((x) => x.zone === slot.zone && x.id !== slot.id && isLiveSlot(x) && slotSpan(x) === 1 && !slotBusy(s, x)).map((x) => x.id);
  // 2 格＝併進 1 個同區空格；平面圖會把兩格排在一起，但同一區能併幾間受版面限制
  const zoneCells = s.slots.filter((x) => x.zone === slot.zone).length;
  if (mergedCount(s, slot.zone) + 1 > mergeCapacity(zoneCells)) return { ok: false, error: `這一區的版面最多併 ${mergeCapacity(zoneCells)} 間大店，空地不夠再併`, ...none };
  if (cells && cells.length > 0) {
    if (cells.length !== 1) return { ok: false, error: "要再選 1 個空格", ...none };
    if (!free.includes(cells[0]!)) return { ok: false, error: "選的格子不是同區的空格", ...none };
    return { ok: true, absorb: cells, revive: [] };
  }
  if (free.length < 1) return { ok: false, error: "這個區域的空地不夠，沒有空格可以併進來", ...none };
  const after = free.filter((id) => id > slot.id);
  const before = free.filter((id) => id < slot.id).reverse();
  return { ok: true, absorb: [([...after, ...before][0])!], revive: [] };
}

/** 套用 planResize 的結果（只動 slot 的 span） */
export function applyResize(s: Pick<MallState, "slots">, slotId: number, span: Span, plan: ResizePlan): void {
  for (const id of plan.absorb) {
    s.slots[id]!.span = 0;
    s.slots[id]!.into = slotId;
  }
  for (const id of plan.revive) {
    delete s.slots[id]!.span;
    delete s.slots[id]!.into;
  }
  const slot = s.slots[slotId]!;
  if (span === 1) delete slot.span;
  else slot.span = span;
}

/** 這個區域放得下的大小（給畫面列選項用；已含「同區空地夠不夠」） */
export function availableSpans(s: Pick<MallState, "slots" | "builds">, slotId: number, cat: Pick<CategoryDef, "id">): Span[] {
  const opts = footprintOf(cat).options;
  return opts.filter((sp) => planResize(s, slotId, sp).ok);
}

export const shopSpan = (shop: Pick<Shop, "span">): Span => shop.span ?? 1;
