// 樓層空地化與可變店面（階段 C，見 docs/floor-open-plan.md）。
//
// 模型（和草案 §1 的差異，2026-11-28 定案）：**格＝slot**。
// - 一個 slot 是一格樓板；`span` 缺＝1。大店佔 2／4 格：把店開在一個 slot 上，另外 span−1 個空 slot 變成「墓碑」（span 0，被這間店吸收）。
// - 樓板面積 `floorArea(s, zone)` ＝ 該區 slot 的 span 總和；resize／拆除只在店與墓碑之間搬格子，面積永遠不變，擴建才會 +1。
//   舊存檔沒有 span，面積＝slot 數，`expansionsOf` 與舊算法相等。
// - `Slot.id === 陣列索引` 永不改、不重排、不刪除；墓碑留在陣列裡，所有「找空地」的地方要用 `liveSlots` 排除。
// - 空的 slot（shopId 為空、沒在施工）都是可流通的格子：要開 span N 的店，就從同區找 N−1 個空的 span-1 slot 吸收。
import type { CategoryDef, MallState, Shop, Slot } from "./types";

export type Span = 1 | 2 | 4;
export const SPANS: readonly Span[] = [1, 2, 4];

/** 容量與人事隨 span 放大的係數（略低於線性，避免「全部做大店」變成最優解；數字待機器人調） */
export const SPAN_FACTOR: Record<Span, number> = { 1: 1, 2: 1.8, 4: 3.2 };
/** 建造費、翻新費、固定資產評價按格數線性放大 */
export const spanCostFactor = (span: Span | undefined): number => span ?? 1;
/** 工期 ×√span（避免大店等太久） */
export const spanTicksFactor = (span: Span | undefined): number => Math.sqrt(span ?? 1);

export const spanFactor = (span: Span | undefined): number => SPAN_FACTOR[span ?? 1] ?? 1;

/** 拆除費：建造費 × span × 這個比例（含裝潢報廢，不退款） */
export const DEMOLISH_FEE_RATE = 0.25;
/** 同一區域兩次拆除之間的冷卻（遊戲日） */
export const DEMOLISH_COOLDOWN_DAYS = 1;
/** 擴建面積上限的硬上限（island 版型寬度與地圖捲動；預設維持 14） */
export const MAX_AREA = 14;

/** 每個業態可選的大小；缺＝只有 1 格。階段 C 開旗標之前，所有店一律 span 1 */
export const FOOTPRINT_BY_CATEGORY: Record<string, { options: Span[]; default: Span }> = {
  grocery: { options: [1, 2, 4], default: 2 },
  gym: { options: [1, 2, 4], default: 2 },
  kids_play: { options: [1, 2, 4], default: 2 },
  arcade_vr: { options: [1, 2, 4], default: 2 },
  claw: { options: [1, 2], default: 1 },
  karaoke: { options: [1, 2, 4], default: 2 },
  observatory: { options: [1, 2, 4], default: 2 },
  electronics: { options: [1, 2, 4], default: 2 },
  camera: { options: [1, 2], default: 1 },
  art_gallery: { options: [1, 2, 4], default: 2 },
};

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
    const tombs = s.slots.filter((x) => x.zone === slot.zone && x.span === 0).map((x) => x.id);
    const need = cur - span;
    if (tombs.length < need) return { ok: false, error: "格子資料不一致，無法縮小", ...none };
    return { ok: true, absorb: [], revive: tombs.slice(0, need) };
  }
  const need = span - cur;
  const free = s.slots.filter((x) => x.zone === slot.zone && x.id !== slot.id && isLiveSlot(x) && slotSpan(x) === 1 && !slotBusy(s, x)).map((x) => x.id);
  if (cells && cells.length > 0) {
    if (cells.length !== need || new Set(cells).size !== need) return { ok: false, error: `要再選 ${need} 個空格`, ...none };
    if (!cells.every((c) => free.includes(c))) return { ok: false, error: "選的格子不是同區的空格", ...none };
    return { ok: true, absorb: cells, revive: [] };
  }
  if (free.length < need) return { ok: false, error: `這個區域的空地不夠（要 ${span} 格，現在只有 ${free.length + cur} 格連同這格）`, ...none };
  const after = free.filter((id) => id > slot.id);
  const before = free.filter((id) => id < slot.id).reverse();
  return { ok: true, absorb: [...after, ...before].slice(0, need), revive: [] };
}

/** 套用 planResize 的結果（只動 slot 的 span） */
export function applyResize(s: Pick<MallState, "slots">, slotId: number, span: Span, plan: ResizePlan): void {
  for (const id of plan.absorb) s.slots[id]!.span = 0;
  for (const id of plan.revive) delete s.slots[id]!.span;
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
