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
  /** 處理收件匣的客訴／評價；optionId 是客訴處理方式或評價回覆方式 */
  | { type: "resolveInbox"; uid: string; optionId: string }
  /** 巡場：聽聽此刻店裡客人的心聲 */
  | { type: "walkFloor" }
  | { type: "walkAct"; voiceId: string; optionId: string }
  /** 和常客互動：招呼、記住喜好、送小禮、保留／取消專屬座位 */
  | { type: "regularAction"; regularId: string; action: "greet" | "remember" | "gift" | "reserve" | "unreserve" }
  | { type: "setGuestPrefs"; complaintStance?: "soft" | "balanced" | "firm"; autoReplyReviews?: boolean }
  | { type: "setLease"; shopId: string; enabled: boolean; rent?: number; commission?: number };
