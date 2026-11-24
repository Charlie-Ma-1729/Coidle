import type { RestockRule } from "./types";

/** 玩家指令：前端送出、伺服器驗證並套用 */
export type Command =
  | { type: "touch" }
  | { type: "setPrice"; shopId: string; price: number }
  | { type: "setHours"; open: number; close: number }
  | { type: "setRestock"; shopId: string; rule: Partial<RestockRule> }
  | { type: "orderStock"; shopId: string; qty: number }
  | { type: "setCleaning"; level: 0 | 1 | 2 }
  | { type: "setMaintenance"; level: 0 | 1 | 2 }
  | { type: "buildShop"; slot: number; category: string }
  | { type: "upgradeShop"; shopId: string }
  | { type: "refreshShop"; shopId: string }
  | { type: "resolveEvent"; uid: string; optionId: string }
  | { type: "resolveAllDefault" }
  | { type: "setLease"; shopId: string; enabled: boolean; rent?: number; commission?: number };
