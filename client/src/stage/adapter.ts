/**
 * 轉接層：PublicMallState → StageModel。
 * 場景只認 StageModel；真實資料與示範資料（fixtures）走同一條路。
 * 純函式、不依賴 DOM／Pixi。
 */
import { CATEGORY_BY_ID, ZONES, expandInfo, isZoneUnlocked, mallStars, timeInfo, type CategoryDef, type PublicMallState, type Shop } from "@coidle/shared";
import { dateText } from "../format";
import { buildAttention, shopFlagsFrom } from "../ui/attention";
import type { FloorLinkKind } from "./floorplan";
import type { Archetype, ShopFlag, StageFloor, StageLot, StageModel, StageShop } from "./model";

/** 區域 → 樓層標籤（依區域階層由下往上） */
export const FLOOR_LABELS: Record<string, string> = { b1: "B1", f1: "1F", ent: "2F", cul: "3F", life: "4F", dining: "5F", plaza: "6F", biz: "7F" };

/** 只有地面層（1F）有對外的街道門；其他樓層客人只能搭電扶梯或電梯 */
export const GROUND_ZONE = "f1";

/** 例外：B1 是「連通車站的地下美食街」（區域設定），多一條車站連通道。停車場是 1F 的業態，已在地面層。 */
export const FLOOR_LINKS: Record<string, FloorLinkKind[]> = { b1: ["rail"] };

const CAFE_RE = /咖啡|茶|甜點|蛋糕|麵包|烘焙|冰|飲|果汁|輕食|早餐|可麗餅|鬆餅/;
const RACK_RE = /服|衣|鞋|包|飾|美妝|化妝|藥妝|配件|選物|精品|珠寶|眼鏡|美容|SPA|診所|造型|美髮|美甲/;

/** 84 種業態只對應到 5 種室內擺設 */
export function archetypeOf(cat: Pick<CategoryDef, "name" | "group">): Archetype {
  switch (cat.group) {
    case "food":
      return CAFE_RE.test(cat.name) ? "cafe" : "counter";
    case "retail":
      return RACK_RE.test(cat.name) ? "rack" : "shelf";
    case "entertainment":
      return "arcade";
    case "service":
      return RACK_RE.test(cat.name) ? "rack" : "shelf";
  }
}

const SIGN_COLORS = [0xd9534f, 0xf0a030, 0x52b788, 0x4f8fe3, 0xe05fa2, 0x8a5ff0, 0x3a8fb0, 0xb07a4a, 0xf0c040, 0x6fae5e, 0xc0504d, 0xe8a0c0];

/** 同一種業態永遠同一個招牌色 */
export function colorOfCategory(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SIGN_COLORS[h % SIGN_COLORS.length]!;
}

function toStageShop(s: PublicMallState, shop: Shop, flags: Set<ShopFlag>): StageShop {
  const cat = CATEGORY_BY_ID[shop.category];
  const closed = shop.closedUntilTick > s.tick;
  return {
    id: shop.id,
    slot: shop.slot,
    name: shop.name,
    category: cat?.name ?? shop.category,
    archetype: cat ? archetypeOf(cat) : "shelf",
    color: colorOfCategory(shop.category),
    level: shop.level,
    mode: shop.mode,
    state: closed ? "closed" : "open",
    price: shop.price,
    stock: shop.stock,
    freshness: shop.freshness,
    todayRevenue: shop.day.revenue,
    todayGroups: shop.day.groups,
    flags: [...flags],
  };
}

export function toStageModel(s: PublicMallState, userId?: string | number | null): StageModel {
  const attention = buildAttention(s, userId);
  const flagMap = shopFlagsFrom(attention);
  const shopBySlot = new Map<number, Shop>();
  for (const sh of s.shops) shopBySlot.set(sh.slot, sh);
  const buildBySlot = new Map<number, (typeof s.builds)[number]>();
  for (const b of s.builds) if (b.kind === "open") buildBySlot.set(b.slot, b);

  const floors: StageFloor[] = ZONES.map((z) => {
    const unlocked = isZoneUnlocked(s, z.id);
    const slots = s.slots.filter((x) => x.zone === z.id);
    const lots: StageLot[] = slots.map((slot) => {
      if (!unlocked) return { slot: slot.id, shop: null };
      const shop = slot.shopId ? s.shops.find((x) => x.id === slot.shopId) : shopBySlot.get(slot.id);
      if (shop) return { slot: slot.id, shop: toStageShop(s, shop, flagMap.get(shop.id) ?? new Set()) };
      const task = buildBySlot.get(slot.id);
      if (task) {
        const cat = CATEGORY_BY_ID[task.category ?? ""];
        const total = Math.max(1, (cat?.buildTicks ?? 144) + 0);
        const left = Math.max(0, task.completeTick - s.tick);
        return {
          slot: slot.id,
          shop: {
            id: `build:${task.id}`,
            slot: slot.id,
            name: cat?.name ?? "新店",
            category: cat?.name ?? "",
            archetype: cat ? archetypeOf(cat) : "shelf",
            color: colorOfCategory(task.category ?? ""),
            level: 1,
            mode: "direct",
            state: "building",
            price: 0,
            stock: 0,
            freshness: 0,
            todayRevenue: 0,
            todayGroups: 0,
            flags: [],
            progress: Math.min(1, Math.max(0, 1 - left / total)),
          },
        };
      }
      return { slot: slot.id, shop: null };
    });
    const info = unlocked && z.maxExpand > 0 ? expandInfo(s, z.id) : null;
    return {
      id: z.id,
      zoneId: z.id,
      label: FLOOR_LABELS[z.id] ?? z.id,
      name: z.name.replace(/^\S+\s/, ""),
      description: z.description,
      lots,
      ground: z.id === GROUND_ZONE,
      links: FLOOR_LINKS[z.id] ?? [],
      lockedLevel: unlocked ? null : z.unlockLevel,
      expand: info && info.n < info.max ? { n: info.n, max: info.max, cost: info.cost, canBuy: info.canBuy, reason: info.reason } : null,
    };
  });

  const t = timeInfo(s.tick);
  const d = s.today;
  return {
    mallName: "",
    floors,
    funds: s.funds,
    todayProfit: d.revenue + d.rentIncome - d.purchases - d.fixed - d.repairs,
    todayRevenue: d.revenue + d.rentIncome,
    todayGroups: d.groups,
    level: s.level,
    stars: mallStars(s as never),
    localRep: s.localRep,
    touristHeat: s.touristHeat,
    cleanliness: s.cleanliness,
    equipment: s.equipment,
    minuteOfDay: t.hour * 60 + t.minute,
    dateLabel: dateText(s.tick),
    weekend: t.weekend,
    openHour: s.hours.open,
    closeHour: s.hours.close,
    attention,
  };
}

/** slot id → 所在樓層索引（找不到回傳 -1） */
export function floorIndexOfSlot(model: StageModel, slot: number): number {
  return model.floors.findIndex((f) => f.lots.some((l) => l.slot === slot));
}

/** 店 id → [樓層索引, slot]；找不到回傳 null */
export function locateShop(model: StageModel, shopId: string): { floor: number; slot: number } | null {
  for (let i = 0; i < model.floors.length; i++) {
    const lot = model.floors[i]!.lots.find((l) => l.shop?.id === shopId);
    if (lot) return { floor: i, slot: lot.slot };
  }
  return null;
}
