import { CATEGORY_BY_ID } from "./data";
import type { MallState, SupplierDef, SupplierState, SupplyFamily } from "./types";

// 供應商：進貨不再只是一個全域價格倍率，而是和具體的「人」打交道。
// 店名、人名全部虛構。

export const SUPPLY_FAMILIES: Record<SupplyFamily, { name: string; icon: string }> = {
  meat: { name: "肉類", icon: "🥩" },
  seafood: { name: "海鮮", icon: "🐙" },
  grain: { name: "麵與米", icon: "🍜" },
  produce: { name: "蔬果雜貨", icon: "🥬" },
  sweets: { name: "甜點飲品原料", icon: "🧁" },
  goods: { name: "商品批貨", icon: "📦" },
};

export const FAMILY_ORDER: SupplyFamily[] = ["meat", "seafood", "grain", "produce", "sweets", "goods"];

/** 每種需要進貨的業態，原料來自哪一類供應商 */
export const FAMILY_OF: Record<string, SupplyFamily> = {
  kushikatsu: "meat",
  yakiniku: "meat",
  fastfood: "meat",
  curry: "meat",
  fine_dining: "meat",
  takoyaki: "seafood",
  sushi: "seafood",
  izakaya: "seafood",
  ramen: "grain",
  udon: "grain",
  italian: "grain",
  brunch: "grain",
  grocery: "produce",
  hotpot: "produce",
  kissaten: "sweets",
  bubble_tea: "sweets",
  sweets: "sweets",
  bar: "sweets",
  fashion: "goods",
  drugstore: "goods",
  select_shop: "goods",
  electronics: "goods",
  bookstore: "goods",
  stationery: "goods",
  popup: "goods",
};

export const SUPPLIERS: SupplierDef[] = [
  // ── 肉類
  { id: "meat_maru", name: "丸三精肉", family: "meat", price: 1.0, quality: 0.75, reliability: 0.85, lead: 1, bio: "三代經營的老肉鋪，做事一板一眼，從不出大包。" },
  { id: "meat_yama", name: "山下食肉", family: "meat", price: 0.9, quality: 0.62, reliability: 0.7, lead: 1.1, bio: "價格最便宜，缺點是偶爾會「記錯」出貨日。" },
  { id: "meat_kuro", name: "黑門肉鋪", family: "meat", price: 1.15, quality: 0.92, reliability: 0.9, lead: 0.9, bio: "只做高級和牛生意，老闆脾氣很大，但肉真的好。" },
  { id: "meat_import", name: "海外直輸肉品", family: "meat", price: 0.85, quality: 0.8, reliability: 0.6, lead: 1.3, bio: "新開的進口商，價格漂亮，但貨運常常延誤。", hidden: true },
  // ── 海鮮
  { id: "sea_naniwa", name: "浪花水產", family: "seafood", price: 1.0, quality: 0.75, reliability: 0.85, lead: 1, bio: "市場裡最老牌的海鮮批發，大家都叫老闆「阿浪」。" },
  { id: "sea_minato", name: "港口鮮魚組合", family: "seafood", price: 0.92, quality: 0.65, reliability: 0.7, lead: 1, bio: "漁會組合，便宜實惠，但天氣一差就沒貨。" },
  { id: "sea_asaichi", name: "朝市直送屋", family: "seafood", price: 1.2, quality: 0.95, reliability: 0.88, lead: 0.85, bio: "凌晨直送、當日鮮度，價格也是當日最高。" },
  { id: "sea_farm", name: "近海養殖社", family: "seafood", price: 0.88, quality: 0.78, reliability: 0.65, lead: 1.2, bio: "新興的養殖業者，產量穩定但規模還小。", hidden: true },
  // ── 麵與米
  { id: "grain_yoneda", name: "米田製麵所", family: "grain", price: 1.0, quality: 0.78, reliability: 0.88, lead: 1, bio: "自家製麵，湯麵、烏龍麵都靠他們。" },
  { id: "grain_yamato", name: "大和穀物", family: "grain", price: 0.9, quality: 0.64, reliability: 0.75, lead: 1.1, bio: "大量批發，價格漂亮，品質中規中矩。" },
  { id: "grain_roho", name: "老舖麵粉店", family: "grain", price: 1.1, quality: 0.9, reliability: 0.85, lead: 1, bio: "堅持石臼研磨，餐廳主廚們私下的口袋名單。" },
  { id: "grain_organic", name: "有機契作農場", family: "grain", price: 1.05, quality: 0.86, reliability: 0.6, lead: 1.3, bio: "剛起步的契作農場，數量有限，要碰運氣。", hidden: true },
  // ── 蔬果雜貨
  { id: "prod_yaoshou", name: "八百正青果", family: "produce", price: 1.0, quality: 0.75, reliability: 0.85, lead: 1, bio: "市場口碑很好的青果商，什麼菜都拿得到。" },
  { id: "prod_farm", name: "契約農家組合", family: "produce", price: 0.9, quality: 0.7, reliability: 0.72, lead: 1.1, bio: "直接向農家收購，新鮮便宜，產量看天吃飯。" },
  { id: "prod_market", name: "市場問屋", family: "produce", price: 1.05, quality: 0.8, reliability: 0.9, lead: 0.9, bio: "最可靠的批發商，貴一點但從不跳票。" },
  { id: "prod_green", name: "城市垂直農場", family: "produce", price: 1.1, quality: 0.88, reliability: 0.65, lead: 1.1, bio: "大樓裡種菜的新創，標榜無農藥，價格偏高。", hidden: true },
  // ── 甜點飲品原料
  { id: "sweet_kanmi", name: "甘味原料商", family: "sweets", price: 1.0, quality: 0.78, reliability: 0.85, lead: 1, bio: "和菓子、甜點店的老朋友，原料細緻。" },
  { id: "sweet_mame", name: "喫茶豆屋", family: "sweets", price: 0.92, quality: 0.7, reliability: 0.78, lead: 1, bio: "咖啡豆與茶葉專賣，老闆很愛聊天。" },
  { id: "sweet_dairy", name: "乳製品協同", family: "sweets", price: 1.08, quality: 0.85, reliability: 0.8, lead: 0.95, bio: "牧場合作社，牛奶和鮮奶油品質穩定。" },
  { id: "sweet_craft", name: "手作工坊原料行", family: "sweets", price: 1.15, quality: 0.93, reliability: 0.6, lead: 1.2, bio: "新開的精品原料行，限量供應，價格不手軟。", hidden: true },
  // ── 商品批貨
  { id: "goods_tonya", name: "問屋街批發", family: "goods", price: 1.0, quality: 0.72, reliability: 0.85, lead: 1, bio: "老批發街的老店，百貨雜貨樣樣有。" },
  { id: "goods_trade", name: "直營貿易行", family: "goods", price: 0.9, quality: 0.65, reliability: 0.7, lead: 1.2, bio: "走低價路線的貿易商，品牌參差不齊。" },
  { id: "goods_agent", name: "品牌代理商", family: "goods", price: 1.15, quality: 0.9, reliability: 0.9, lead: 0.9, bio: "專營知名品牌代理，授權完整，價格偏高。" },
  { id: "goods_indie", name: "獨立設計師聯盟", family: "goods", price: 1.05, quality: 0.85, reliability: 0.6, lead: 1.3, bio: "一群獨立設計師的集合，商品很有個性。", hidden: true },
];

export const SUPPLIER_BY_ID = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s])) as Record<string, SupplierDef>;

export const SUPPLIER_SWITCH_FEE = 15_000;
export const CONTRACT_CANCEL_FEE = 30_000;
export const CONTRACT_MIN_REL = 30;
export const CONTRACT_DAYS = [7, 14] as const;
export const REL_PER_ORDER = 0.15;
/** 缺貨時，沒有長約或高關係的買家只拿得到這個比例 */
export const SHORTAGE_FILL = 0.6;
/** 向備用供應商臨時補貨（現貨）要多付的比例 */
export const SPOT_PREMIUM = 1.1;
export const PRIORITY_REL = 80;

export function newSupplierState(def: SupplierDef): SupplierState {
  return {
    id: def.id,
    discovered: !def.hidden,
    relationship: def.hidden ? 0 : 10,
    status: "ok",
    statusUntil: 0,
    priceMult: 1,
    priceUntil: 0,
    contract: null,
    orders: 0,
  };
}

export function initialSupply(): { suppliers: SupplierState[]; choice: Record<string, string>; autoFallback: boolean } {
  const choice: Record<string, string> = {};
  for (const fam of FAMILY_ORDER) {
    const first = SUPPLIERS.find((x) => x.family === fam && !x.hidden);
    if (first) choice[fam] = first.id;
  }
  return { suppliers: SUPPLIERS.map(newSupplierState), choice, autoFallback: true };
}

type SupplyView = Pick<MallState, "supply" | "tick">;

export function supplierState(s: Pick<MallState, "supply">, id: string): SupplierState | undefined {
  return s.supply.suppliers.find((x) => x.id === id);
}

export function familyOf(category: string): SupplyFamily | null {
  return FAMILY_OF[category] ?? null;
}

/** 關係好有折扣：50 以上 5%，80 以上 10% */
export function relDiscount(rel: number): number {
  return rel >= 80 ? 0.9 : rel >= 50 ? 0.95 : 1;
}

/** 這家供應商此刻的價格倍率（含暫時漲跌、長約鎖價、關係折扣） */
export function supplierPriceNow(s: SupplyView, st: SupplierState, def: SupplierDef): number {
  const hiked = st.priceUntil > s.tick ? st.priceMult : 1;
  const base = def.price * hiked;
  const price = st.contract && st.contract.untilTick > s.tick ? st.contract.lockedMult : base;
  return price * relDiscount(st.relationship);
}

/** 沒有長約、關係也一般的情況下的市價（簽長約時鎖定的就是這個） */
export function supplierMarketPrice(s: SupplyView, st: SupplierState, def: SupplierDef): number {
  return def.price * (st.priceUntil > s.tick ? st.priceMult : 1);
}

export function supplierUnavailable(st: SupplierState, tick: number): boolean {
  return st.status !== "ok" && st.status !== "shortage" && st.statusUntil > tick;
}

export function hasContract(st: SupplierState, tick: number): boolean {
  return !!st.contract && st.contract.untilTick > tick;
}

/** 這個店目前進貨的供應商（主力） */
export function chosenSupplier(s: Pick<MallState, "supply">, family: SupplyFamily): { def: SupplierDef; st: SupplierState } | null {
  const id = s.supply.choice[family];
  const def = id ? SUPPLIER_BY_ID[id] : undefined;
  const st = id ? supplierState(s, id) : undefined;
  return def && st ? { def, st } : null;
}

/** 這一業態的每份進貨成本，要再乘上多少（主力供應商的價格） */
export function supplierCostMult(s: SupplyView, category: string): number {
  const fam = familyOf(category);
  if (!fam) return 1;
  const c = chosenSupplier(s, fam);
  return c ? supplierPriceNow(s, c.st, c.def) : 1;
}

/** 用得到這類貨品的直營店數 */
export function familyShopCount(s: Pick<MallState, "shops">, family: SupplyFamily): number {
  return s.shops.filter((x) => x.mode === "direct" && familyOf(x.category) === family && CATEGORY_BY_ID[x.category]).length;
}

/** 供應商對店家口味的影響：品質好的供應商讓店家更有口碑（±6% 左右） */
export function supplierQualityFactor(s: Pick<MallState, "supply">, category: string): number {
  const fam = familyOf(category);
  if (!fam) return 1;
  const c = chosenSupplier(s, fam);
  return c ? 1 + (c.def.quality - 0.75) * 0.3 : 1;
}
