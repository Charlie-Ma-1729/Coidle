import { CATEGORY_BY_ID, TICKS_PER_DAY } from "./data";
import type { CategoryGroup, MallState } from "./types";

// 出租招商：品牌洽談 → 簽約 → 租戶自己裝修與營運 → 每日收租金與營業額抽成。
// 租戶有滿意度：太貴、沒客人、館內髒亂都會讓他們想走；租約到期時可以續約。

/** 出租功能：商場 Lv.3 開放（或用旗標強制開關） */
export function leaseEnabled(s: Pick<MallState, "flags" | "level">): boolean {
  return s.flags["feature:lease"] === true || s.level >= LEASE_MIN_LEVEL;
}

export const LEASE_MIN_LEVEL = 3;
export const CANDIDATE_MAX = 4;
export const CANDIDATE_TTL = 6 * TICKS_PER_DAY;
/** 租戶自己裝修的時間（約 4 遊戲小時） */
export const FITOUT_TICKS = 48;
export const LEASE_TERMS = [30, 60, 90] as const;
export const RENEWAL_TTL = 2 * TICKS_PER_DAY;
/** 提前解約的違約金：剩餘租期租金的 30% */
export const TERMINATE_PENALTY = 0.3;
export const LOW_SAT = 30;
export const LOW_SAT_DAYS = 4;
export const MAX_LEASE_LOG = 20;
/** 還價：租金加幾成。越高被拒的機率越大 */
export const COUNTER_STEPS = [1.1, 1.2, 1.3] as const;

/** 這個業態一間店一天大約賣多少（招商談租金的基準） */
export function baselineRevenue(category: string): number {
  const c = CATEGORY_BY_ID[category];
  return c ? c.refPrice * c.baseCapacity * 90 : 0;
}

/** 行情租金：基準營收的 10% */
export function marketRent(category: string): number {
  return Math.round((baselineRevenue(category) * 0.1) / 100) * 100;
}

const PREFIX = [
  "七福", "月見", "天空", "光明", "朝日", "金鯱", "福丸", "星野", "碧海", "雲井", "春日", "銀杏", "櫻坂", "紅葉", "霓虹", "浪花", "海風", "晴空", "白山", "松風",
  "青葉", "夕凪", "千代", "若草", "常盤", "寶來", "竹下", "葵", "梅鉢", "鶴屋", "港町", "初音", "明石", "天神", "百合", "花扇", "暖簾", "太陽", "彩雲", "瑠璃",
  "桐生", "楓", "三日月", "朱雀", "舞鶴", "飛鳥", "八千代", "芙蓉", "霞", "凜", "和泉", "蒼", "雪華", "茜", "岬", "燈", "萬福", "琥珀", "翡翠", "雙葉",
];
const CORE: Record<CategoryGroup, string[]> = {
  food: ["食堂", "小路", "亭", "屋", "橫丁", "茶房", "本舖", "酒場", "廚房", "家", "庵", "軒"],
  retail: ["商店", "工房", "選物", "雜貨舖", "屋", "百貨", "堂", "商會", "舖", "市"],
  entertainment: ["樂園", "俱樂部", "劇場", "遊藝館", "會館", "廣場", "基地", "天地"],
  service: ["堂", "館", "工作室", "療室", "舍", "所", "庵", "之間"],
};
export const BRAND_PREFIX = PREFIX;

/** 用種子挑一個虛構品牌名（呼叫端負責避開重複） */
export function brandName(group: CategoryGroup, a: number, b: number): string {
  const cores = CORE[group];
  return `${PREFIX[a % PREFIX.length]}${cores[b % cores.length]}`;
}

export function leaseRemainingRent(rent: number, endTick: number, tick: number): number {
  return Math.max(0, Math.ceil((endTick - tick) / TICKS_PER_DAY)) * rent;
}
