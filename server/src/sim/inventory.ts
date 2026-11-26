import { CATEGORY_BY_ID, SPOILAGE_PER_DAY, categoryHasStock, familyOf, type MallState } from "@coidle/shared";
import { addLog } from "./state";

/** 日均銷量的移動平均權重：新的一天占多少 */
const AVG_ALPHA = 0.35;
/** 不管賣多少，這個量以內的庫存視為「正常周轉」，不會壞 */
const SAFE_STOCK = 100;

/**
 * 每天結算一次（各店當日統計重置之前）：
 *  - 更新日均銷量（智慧補貨與「庫存夠賣幾天」用）；
 *  - 放太久的貨會壞：只有超過「一天銷量」的那部分庫存會損耗，所以正常周轉不受影響、囤貨才有代價。
 *    易腐的海鮮與蔬果最快，穀物與酒類幾乎不壞。
 */
export function inventoryDaily(s: MallState): void {
  let wasteTotal = 0;
  let worst: { name: string; n: number } | null = null;
  for (const shop of s.shops) {
    const cat = CATEGORY_BY_ID[shop.category];
    if (!cat || !categoryHasStock(cat) || shop.mode === "lease") continue;
    const units = shop.day.units;
    shop.avgDaily = shop.avgDaily === undefined ? units : shop.avgDaily * (1 - AVG_ALPHA) + units * AVG_ALPHA;
    const fam = familyOf(shop.category);
    const rate = fam ? (SPOILAGE_PER_DAY[fam] ?? 0) : 0;
    if (rate <= 0) continue;
    const spoilable = Math.max(0, shop.stock - Math.max(shop.avgDaily, units, SAFE_STOCK));
    const waste = Math.floor(spoilable * rate);
    if (waste <= 0) continue;
    shop.stock -= waste;
    shop.day.waste = (shop.day.waste ?? 0) + waste;
    wasteTotal += waste;
    if (!worst || waste > worst.n) worst = { name: shop.name, n: waste };
  }
  if (worst && wasteTotal >= 15) {
    const text = `🗑️ 囤太多的貨放壞了：共 ${wasteTotal} 份（最多的是「${worst.name}」${worst.n} 份）。備貨天數別設太長，或改用智慧補貨。`;
    addLog(s, "warn", text);
    if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
  }
}
