import type { RestockRule, SlotKind } from "./types";

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
  /** 排程優惠活動；省略 startTick 代表現在開始。預算在排程時付掉，開始前取消會全額退回。 */
  | { type: "schedulePromo"; defId: string; startTick?: number }
  | { type: "cancelPromo"; uid: string }
  /** 稽查預告後備戰（none＝照常、basic＝例行整理、full＝全力備戰） */
  | { type: "prepareInspection"; uid: string; level: "none" | "basic" | "full" }
  /** 供應商：換主力、簽／解長約、離線時的自動備援 */
  | { type: "chooseSupplier"; family: string; supplierId: string }
  | { type: "signContract"; supplierId: string; days: number }
  | { type: "cancelContract"; supplierId: string }
  | { type: "setSupplyPrefs"; autoFallback?: boolean }
  /** 商戰：刺探情報、簽合作協議、反制活動、商戰姿態 */
  | { type: "rivalIntel"; rivalId: string }
  | { type: "rivalPact"; rivalId: string }
  | { type: "rivalCounter"; rivalId: string }
  | { type: "setRivalStance"; stance: "defend" | "neutral" | "aggressive" }
  /** 和常客互動：招呼、記住喜好、送小禮、保留／取消專屬座位 */
  | { type: "regularAction"; regularId: string; action: "greet" | "remember" | "gift" | "reserve" | "unreserve" }
  /** 研發工坊：開始研發（每間店同時一件）、取消、處理試吃結果、菜單上下架 */
  | { type: "startRnd"; shopId: string; picks: Partial<Record<SlotKind, string>> }
  | { type: "cancelRnd"; shopId: string }
  | { type: "tastingAction"; uid: string; action: "list" | "keep" | "discard"; slotIndex?: number }
  | { type: "listDish"; shopId: string; dishId: string; slotIndex?: number }
  | { type: "unlistDish"; shopId: string; slotIndex: number }
  | { type: "discardDish"; dishId: string }
  | { type: "setGuestPrefs"; complaintStance?: "soft" | "balanced" | "firm"; autoReplyReviews?: boolean }
  /** 科技樹：研發、取消（退回一半費用） */
  | { type: "startTech"; id: string }
  | { type: "cancelTech"; id: string }
  /** 招商：簽約（可指定店面）、還價（租金加幾成）、婉拒、處理續約、提前解約 */
  | { type: "signTenant"; candidateId: string; slot?: number }
  | { type: "counterTenant"; candidateId: string; rentMult: number }
  | { type: "declineTenant"; candidateId: string }
  | { type: "resolveRenewal"; uid: string; action: "renew" | "raise" | "release" }
  | { type: "terminateLease"; shopId: string }
  /** 團隊事件：認領一項任務（需要不同隊員各自認領；身分由伺服器填入） */
  | { type: "contribute"; taskId: string }
  /** 猜猜這座商場像是哪裡（只留含蓄線索，答案以雜湊比對） */
  | { type: "guessPlace"; text: string }
  | { type: "setLease"; shopId: string; enabled: boolean; rent?: number; commission?: number };
