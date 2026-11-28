import type { Climate, LoanProduct } from "./finance";
import type { PlayInput, RestockRule, SlotKind, TechPlan } from "./types";

/** 玩家指令：前端送出、伺服器驗證並套用 */
export type Command =
  | { type: "touch" }
  | { type: "setPrice"; shopId: string; price: number }
  | { type: "setHours"; open: number; close: number }
  /** 概念定位：第一次免費，之後要付費並有冷卻 */
  | { type: "setConcept"; id: string }
  | { type: "setRestock"; shopId: string; rule: Partial<RestockRule> }
  /** 統一補貨頁：把同一組規則套到多間店（例如整層樓） */
  | { type: "setRestockMany"; shopIds: string[]; rule: Partial<RestockRule> }
  | { type: "orderStock"; shopId: string; qty: number; /** 急件：貴三成、交期縮短 */ rush?: boolean }
  | { type: "setCleaning"; level: 0 | 1 | 2 }
  | { type: "setMaintenance"; level: 0 | 1 | 2 }
  | {
      type: "buildShop";
      slot: number;
      category: string;
      /** 店名（沒有＝依業態自動命名） */
      name?: string;
      /** 佔幾格（缺＝1；要開了「樓層空地化」旗標，且在業態 footprint 允許的大小內） */
      span?: 1 | 2 | 4;
      /** 要一起吸收的空格（規劃模式；缺＝自動挑同區的空格） */
      cells?: number[];
    }
  /** 拆除自營店變回空地（拆除費＝建造費×格數×25%，同區 1 遊戲日冷卻；要開了「樓層空地化」旗標） */
  | { type: "demolishShop"; shopId: string }
  /** 自營店改店名（出租中的租戶店名由品牌決定） */
  | { type: "renameShop"; shopId: string; name: string }
  /** 自營店歇業：店面空出來，庫存與工坊進度作廢，不退費 */
  | { type: "closeShop"; shopId: string }
  | { type: "upgradeShop"; shopId: string }
  /** 搬遷：把店搬到同商場另一個空店面，要花錢也要工期（期間歇業） */
  | { type: "moveShop"; shopId: string; toSlot: number }
  /** 擴建：在已開放的區域多蓋一個店面（越蓋越貴） */
  | { type: "expandZone"; zone: string }
  | { type: "buildFacility"; kind: string }
  /** 設施的營運設定（價格倍率、政策、加值服務、每廳排片）；只改有給的欄位 */
  | { type: "setFacilityOps"; kind: string; priceMult?: number; policy?: string; extra?: boolean; films?: string[] }
  /** 維護設備（設備狀態回到 100） */
  | { type: "maintainFacility"; kind: string }
  /** 招商：接受 / 婉拒營運商的邀約、提前解約收回自營 */
  | { type: "acceptFacilityOffer"; kind: string; offerId: string }
  | { type: "declineFacilityOffer"; kind: string; offerId: string }
  /** 還價（把租金加 10–30%，只能一次）與租約到期的續約決定 */
  | { type: "counterFacilityOffer"; kind: string; offerId: string; mult: number }
  | { type: "resolveFacilityRenewal"; kind: string; action: "renew" | "raise" | "release" }
  | { type: "endFacilityLease"; kind: string }
  | { type: "refreshShop"; shopId: string }
  | { type: "resolveEvent"; uid: string; optionId: string }
  | { type: "resolveAllDefault" }
  /** 處理收件匣的客訴／評價；optionId 是客訴處理方式或評價回覆方式 */
  | { type: "resolveInbox"; uid: string; optionId: string }
  /** 巡場：聽聽此刻店裡客人的心聲 */
  | { type: "patrolStart" }
  | { type: "patrolInspect"; shopId: string; spot: string }
  | { type: "patrolChat"; shopId: string }
  | { type: "patrolDeepen"; issueId: string }
  | { type: "patrolFix"; issueId: string; option: "now" | "schedule" | "pro" }
  | { type: "patrolEnd" }
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
  | { type: "legalAction"; uid: string; optionId: string }
  | { type: "setInsurance"; level: number }
  | { type: "setSupplyPrefs"; autoFallback?: boolean; /** 指定某類貨品的首選備用供應商；supplierId 為 null＝取消指定 */ backup?: { family: string; supplierId: string | null } }
  /** 商戰：刺探情報、簽合作協議、反制活動、商戰姿態 */
  | { type: "rivalIntel"; rivalId: string }
  | { type: "rivalPact"; rivalId: string }
  | { type: "rivalCounter"; rivalId: string }
  | { type: "setRivalStance"; stance: "defend" | "neutral" | "aggressive" }
  /** 和常客互動：招呼、記住喜好、送小禮、保留／取消專屬座位 */
  | { type: "regularAction"; regularId: string; action: "greet" | "remember" | "gift" }
  | { type: "regularVoice"; uid: string; optionId: string }
  | { type: "setMembership"; rate: number }
  /** 研發工坊：開始研發（每間店同時一件）、取消、處理試吃結果、菜單上下架 */
  | { type: "startRnd"; shopId: string; picks: Partial<Record<SlotKind, string>>; /** 小遊戲的輸入（沒有＝自動，不加成） */ play?: PlayInput }
  | { type: "foundGroup"; name: string }
  | { type: "renameGroup"; name: string }
  | { type: "foundVenture"; kind: string }
  | { type: "staffingOps"; workers?: number; classes?: number; priceMult?: number; tuitionMult?: number; focus?: "dispatch" | "training" | "none" }
  | { type: "resolveStaffingEvent"; optionId: string }
  | { type: "cancelRnd"; shopId: string }
  | { type: "resolveRndEvent"; shopId: string; optionId: string }
  | { type: "tastingAction"; uid: string; action: "list" | "keep" | "discard"; slotIndex?: number }
  | { type: "listDish"; shopId: string; dishId: string; slotIndex?: number }
  | { type: "unlistDish"; shopId: string; slotIndex: number }
  | { type: "discardDish"; dishId: string }
  | { type: "setGuestPrefs"; complaintStance?: "soft" | "balanced" | "firm"; autoReplyReviews?: boolean }
  /** 科技樹：研發、取消（退回一半費用） */
  | { type: "startTech"; id: string; /** 立項配置（沒有＝標準） */ plan?: TechPlan }
  | { type: "techExperiment"; id: string; optionId: string; /** 數據判讀的答案（沒有＝沒判讀） */ analysis?: number[] }
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
  | { type: "setLease"; shopId: string; enabled: boolean; rent?: number; commission?: number }
  /** 向金融機構借款。terms 由伺服器填入（授信氣候），前端送的會被覆蓋 */
  | { type: "takeLoan"; product: LoanProduct; amount: number; terms?: { climate: Climate } }
  /** 還款：指定哪一筆（loanId）與金額；沒給金額＝還清那一筆 */
  | { type: "repayLoan"; loanId: string; amount?: number }
  /** 營業中斷險：0＝退保 */
  | { type: "setBizInsurance"; level: number };
