import type { DayWeather, Weather } from "@coidle/shared";
import type { FloorLinkKind } from "./floorplan";
import type { GlyphKey } from "./glyphs";

/**
 * 場景只依賴這份精簡模型，不直接吃整個 PublicMallState：
 * - Phase 0：由 fixtures.ts 手寫資料（不需伺服器）
 * - Phase 2：由轉接器從 PublicMallState 產生
 */

/** 店面原型：84 種業種只對應到少數幾種室內擺設 */
export type Archetype = "cafe" | "counter" | "shelf" | "rack" | "arcade";

export type ShopFlag = "complaint" | "stockout" | "broken" | "stale" | "regular";

export type LotState = "open" | "closed" | "building" | "empty";

export interface StageShop {
  id: string;
  slot: number;
  name: string;
  /** 業種名稱（顯示用） */
  category: string;
  archetype: Archetype;
  /** 招牌主色（0xRRGGBB） */
  color: number;
  level: number;
  mode: "direct" | "lease";
  state: LotState;
  price: number;
  stock: number;
  freshness: number;
  todayRevenue: number;
  todayGroups: number;
  flags: ShopFlag[];
  /** 0–1，施工進度（state = building） */
  progress?: number;
}

export interface StageLot {
  slot: number;
  shop: StageShop | null;
}

export interface ExpandState {
  /** 已擴建幾個／上限 */
  n: number;
  max: number;
  cost: number;
  canBuy: boolean;
  reason: string | null;
}

export interface StageFloor {
  id: string;
  label: string;
  name: string;
  lots: StageLot[];
  /** 地面層（1F）：主走道兩端是對外街道門；其他樓層客人只能搭電扶梯／電梯 */
  ground?: boolean;
  /** 露天樓層（屋頂廣場）：風雨直接打在整層上 */
  outdoor?: boolean;
  /** 非地面層另外連通的外部出入口（車站連通道、停車場） */
  links?: FloorLinkKind[];
  /** 這個樓層對應的區域 id（真實資料才有） */
  zoneId?: string;
  description?: string;
  /** 尚未解鎖時，需要的商場等級；已解鎖為 null */
  lockedLevel?: number | null;
  /** 可擴建時的資訊；已達上限或未解鎖為 null */
  expand?: ExpandState | null;
}

export type Severity = "urgent" | "decision" | "opportunity" | "info";

export type HubId = "operate" | "guests" | "develop" | "finance" | "world";

/** 點待辦項目的主要動作要去哪裡 */
export type AttentionTarget =
  | { kind: "shop"; shopId: string }
  | { kind: "hub"; hub: HubId; tab?: string }
  | { kind: "menu"; page: "goals" | "achievements" | "help" | "all" }
  | { kind: "event"; uid: string }
  | { kind: "inspection"; uid: string };

/** 待辦中心的單一項目（由 ui/attention.ts 從真實狀態產生） */
export interface AttentionItem {
  id: string;
  severity: Severity;
  icon: GlyphKey;
  title: string;
  detail?: string;
  cta: string;
  target: AttentionTarget;
}

/** 項目若指向某間店，回傳店 id（場景氣泡與樓層紅點用） */
export function attentionShopId(it: AttentionItem): string | null {
  return it.target.kind === "shop" ? it.target.shopId : null;
}

export interface StageModel {
  mallName: string;
  floors: StageFloor[];
  funds: number;
  todayProfit: number;
  todayRevenue: number;
  todayGroups: number;
  level: number;
  stars: number;
  localRep: number;
  touristHeat: number;
  cleanliness: number;
  equipment: number;
  /** 遊戲內時間，從 0 點起算的分鐘數 */
  minuteOfDay: number;
  dateLabel: string;
  weekend: boolean;
  /** 清潔等級（0 不做、1 標準、2 加強）：決定下雨天會不會加派清潔員 */
  cleaningLevel: 0 | 1 | 2;
  /** 此刻的天氣（含事件強制的天氣） */
  weather: Weather;
  /** 明日預報；沒有「客流預測」科技時為 null */
  tomorrow: DayWeather | null;
  openHour: number;
  closeHour: number;
  attention: AttentionItem[];
}

/** 平面圖的版型鍵：店面格或出入口條件變了才需要重排平面圖 */
export function planKey(floor: StageFloor): string {
  return floor.lots.map((l) => l.slot).join(",") + "|" + (floor.ground ? "g" : "") + (floor.links ?? []).join("+");
}

/** 營業中才會有人潮與店員 */
export function isShopActive(s: StageShop | null | undefined): s is StageShop {
  return !!s && s.state === "open";
}

/** 會改變房間外觀的欄位（狀態、原型、招牌色、施工進度、鎖定）；其他欄位變動不需要重畫房間 */
export function lotSignature(floor: StageFloor): string {
  return (
    (floor.lockedLevel ?? "") +
    "|" +
    floor.lots.map((l) => `${l.slot}:${l.shop?.state ?? "-"}:${l.shop?.archetype ?? ""}:${l.shop?.color ?? ""}:${Math.round((l.shop?.progress ?? 0) * 20)}`).join("|")
  );
}
