import type { ComplaintCause, ComplaintTone, PersonaId, ReviewReplyId, Stance, WalkVoice } from "./types";

// 客人互動層的資料與純函式（模擬引擎與介面共用）。
// 文案帶一點關西腔的輕鬆語氣；不點名真實地名與品牌。

export const COMPLAINT_DEADLINE_TICKS = 144; // 12 遊戲小時
export const REVIEW_DEADLINE_TICKS = 288; // 1 遊戲日
export const WALK_COOLDOWN_TICKS = 12; // 1 遊戲小時
export const WALK_VOICE_TTL_TICKS = 36;
export const MAX_OPEN_COMPLAINTS = 8;
export const MAX_OPEN_REVIEWS = 8;
export const MAX_REVIEW_LOG = 24;
/** 同一間店同一種不滿，變成客訴後要隔多久才會再累積 */
export const GRIEVANCE_COOLDOWN_TICKS = 36;
/** 沒在期限內處理，額外的人氣懲罰（溫和但有感） */
export const LATE_PENALTY = 0.2;

export interface CauseDef {
  label: string;
  icon: string;
  /** 累積多少次不滿會變成一則客訴 */
  threshold: number;
  texts: Record<ComplaintTone, string[]>;
}

export const COMPLAINT_CAUSES: Record<ComplaintCause, CauseDef> = {
  stockout: {
    label: "缺貨",
    icon: "📦",
    threshold: 6,
    texts: {
      sincere: ["特地過來，結果「{shop}」賣完了，有點失望。下次可以多備一點嗎？", "想吃「{shop}」好久了，沒想到賣光了……"],
      angry: ["「{shop}」又缺貨！這已經不是第一次了吧？", "排了那麼久隊結果說沒貨，是在耍人嗎？"],
      demanding: ["「{shop}」沒貨？那你們得補償我的車錢跟時間！", "我是專程來的，沒有的話至少招待我一頓吧。"],
    },
  },
  wait: {
    label: "等太久／客滿",
    icon: "⏳",
    threshold: 12,
    texts: {
      sincere: ["「{shop}」人太多，等了很久都沒位子，希望能改善動線。", "排隊時間比預期長很多，小孩都等累了。"],
      angry: ["「{shop}」到底要等到什麼時候？店員都在做什麼！", "客滿就不要讓人排啊，浪費我的時間。"],
      demanding: ["我等了那麼久，今天全部給我免費才說得過去吧。", "要我等可以，那就給我最好的位子跟折扣。"],
    },
  },
  price: {
    label: "太貴",
    icon: "💴",
    threshold: 10,
    texts: {
      sincere: ["「{shop}」的價格比想像中高，份量跟價錢好像不太對稱。", "味道不錯，但這個價錢會讓我猶豫要不要再來。"],
      angry: ["「{shop}」這價錢也太誇張了，是搶錢嗎？", "隔壁老店便宜一半，你們憑什麼賣這麼貴？"],
      demanding: ["這麼貴一定要給我折扣，不然我就到網路上寫差評。", "價錢不合理，請老闆出來跟我談。"],
    },
  },
  dirty: {
    label: "不夠乾淨",
    icon: "🧹",
    threshold: 15,
    texts: {
      sincere: ["館內的地板和桌面有點髒，希望能多注意清潔。", "洗手間有點味道，整體觀感打了折扣。"],
      angry: ["到處黏黏的，這種環境也敢營業？", "桌子都沒擦，我孩子差點碰到髒東西！"],
      demanding: ["環境這麼髒，我要求賠償醫藥費（雖然什麼事都沒發生）。", "我要找你們經理，這種衛生狀況要有人負責。"],
    },
  },
  facility: {
    label: "設備老舊",
    icon: "🔧",
    threshold: 15,
    texts: {
      sincere: ["有幾個設備看起來很老舊，用起來不太安心，請多維護。", "冷氣忽冷忽熱，坐久了有點不舒服。"],
      angry: ["設備三天兩頭壞，到底有沒有在維修啊？", "這種老舊的環境，是想讓客人出事嗎？"],
      demanding: ["設備這樣我受了驚嚇，應該要精神賠償吧！", "你們設備不安全，我要求免費招待當作補償。"],
    },
  },
  quality: {
    label: "品質不佳",
    icon: "👎",
    threshold: 12,
    texts: {
      sincere: ["「{shop}」的東西跟以前比起來好像差了一點，是不是換了供應？", "整體還行，但沒有驚喜，菜單好像很久沒更新了。"],
      angry: ["「{shop}」今天的東西難吃到不行，這也敢收錢？", "品質越來越差，常客都要被你們趕跑了。"],
      demanding: ["這東西根本不能吃，全額退費，還要加賠我的心情。", "請你們老闆親自過來向我道歉，不然沒完沒了。"],
    },
  },
};

export const COMPLAINT_TONES: Record<ComplaintTone, { label: string; hint: string }> = {
  sincere: { label: "誠懇", hint: "語氣平和，像是真的遇到問題" },
  angry: { label: "憤怒", hint: "情緒很大，但多半有所本" },
  demanding: { label: "強勢索討", hint: "一開口就要補償，要小心是奧客" },
};

export interface ComplaintOption {
  id: "apologize" | "comp" | "refund" | "decline";
  label: string;
  hint: string;
  /** 費用 = costMult × 該店售價 */
  costMult: number;
}

export const COMPLAINT_OPTIONS: ComplaintOption[] = [
  { id: "apologize", label: "誠懇道歉", hint: "免費，態度最重要", costMult: 0 },
  { id: "comp", label: "招待一份", hint: "請客賠罪（約 2 倍售價）", costMult: 2 },
  { id: "refund", label: "全額退費", hint: "花錢消災（約 3 倍售價）", costMult: 3 },
  { id: "decline", label: "婉拒申訴", hint: "店家沒有疏失時堅守立場", costMult: 0 },
];

export function complaintCost(optionId: string, shopPrice: number): number {
  const o = COMPLAINT_OPTIONS.find((x) => x.id === optionId);
  return Math.round((o?.costMult ?? 0) * shopPrice);
}

/**
 * 處理客訴帶來的人氣變化。
 * unreasonable＝這位其實是奧客：道歉換不到什麼，花錢是被占便宜，婉拒反而贏得旁人好感。
 */
export function complaintIdx(optionId: string, unreasonable: boolean): number {
  if (unreasonable) {
    return { apologize: 0.1, comp: 0.2, refund: 0, decline: 0.4 }[optionId] ?? 0;
  }
  return { apologize: 0.35, comp: 0.7, refund: 0.6, decline: -0.9 }[optionId] ?? 0;
}

/** 沒人處理時，依「處理偏好」自動選哪個選項 */
export function defaultComplaintOption(tone: ComplaintTone, stance: Stance): ComplaintOption["id"] {
  if (stance === "soft") return tone === "demanding" ? "apologize" : "comp";
  if (stance === "firm") return tone === "demanding" ? "decline" : "apologize";
  return "apologize";
}

export const STANCES: { id: Stance; label: string; hint: string }[] = [
  { id: "soft", label: "保守", hint: "多花點錢息事寧人（強勢索討者只道歉）" },
  { id: "balanced", label: "平衡", hint: "一律先誠懇道歉" },
  { id: "firm", label: "強硬", hint: "強勢索討者婉拒，其餘道歉" },
];

// ───────── 評價 ─────────

export const REVIEW_REPLIES: { id: ReviewReplyId; label: string; hint: string }[] = [
  { id: "polite", label: "禮貌感謝", hint: "穩穩的，不出錯" },
  { id: "funny", label: "幽默回應", hint: "好評加分，差評小心翻車" },
  { id: "sincere", label: "誠懇道歉／改進", hint: "差評最有效" },
  { id: "ignore", label: "不回覆", hint: "什麼都不會發生" },
];

/** 回覆評價的人氣變化 */
export function reviewIdx(reply: ReviewReplyId | "auto", stars: number): number {
  const bucket = stars >= 4 ? "high" : stars === 3 ? "mid" : "low";
  const table: Record<string, Record<string, number>> = {
    high: { polite: 0.2, funny: 0.4, sincere: 0.1, ignore: 0, auto: 0.1 },
    mid: { polite: 0.25, funny: 0.2, sincere: 0.35, ignore: 0, auto: 0.1 },
    low: { polite: 0.1, funny: -0.4, sincere: 0.55, ignore: -0.1, auto: 0.05 },
  };
  return table[bucket]?.[reply] ?? 0;
}

export const REVIEW_TEXTS: Record<"high" | "mid" | "low", string[]> = {
  high: [
    "「{shop}」真的太好吃了！整家店氣氛也很棒，一定會再來。",
    "服務親切、環境乾淨，「{shop}」是這次旅行最推薦的一家。",
    "價錢實在、味道道地，「{shop}」讓人吃了就想回頭。",
    "老闆很有人情味，「{shop}」的味道讓我想起小時候。",
  ],
  mid: [
    "「{shop}」中規中矩，沒有地雷也沒有驚喜。",
    "東西不錯但人有點多，等了一下才吃到「{shop}」。",
    "整體還可以，只是價錢稍微偏高，會考慮再來。",
  ],
  low: [
    "「{shop}」讓人有點失望，跟網路上的評價差很多。",
    "等很久、環境也不太乾淨，這次體驗不太好。",
    "價錢偏高、份量偏少，「{shop}」不會再來了。",
    "服務跟品質都不穩定，希望店家好好檢討。",
  ],
};

export const PERSONA_TAG: Record<PersonaId, string> = {
  tourist: "旅行中的客人",
  local: "在地常客",
  commuter: "下班順路的上班族",
  family: "帶小孩的家長",
  student: "學生",
  couple: "約會中的情侶",
};

// ───────── 巡場 ─────────

export interface WalkOption {
  id: string;
  label: string;
  cost: number;
  /** 人氣變化（依這位客人的類型套到在地口碑／觀光熱度） */
  idx: number;
  /** 順手整理環境 */
  clean?: number;
}

export interface WalkSituation {
  id: string;
  mood: WalkVoice["mood"];
  texts: string[];
  options: WalkOption[];
}

export const WALK_SITUATIONS: Record<string, WalkSituation> = {
  stockout: {
    id: "stockout",
    mood: "annoyed",
    texts: ["「{shop}」又賣完了？我特地來的耶……", "欸，「{shop}」沒貨了嗎？那我要吃什麼啦。"],
    options: [
      { id: "recommend", label: "誠懇道歉並推薦別家", cost: 0, idx: 0.25 },
      { id: "snack", label: "送一份小點心賠罪", cost: 3000, idx: 0.5 },
    ],
  },
  queue: {
    id: "queue",
    mood: "annoyed",
    texts: ["「{shop}」排了好久，小孩都不耐煩了。", "前面還有好幾組嗎？再等下去我要走了。"],
    options: [
      { id: "ticket", label: "發號碼牌、說明預估時間", cost: 0, idx: 0.3 },
      { id: "tea", label: "請大家喝冰麥茶", cost: 4000, idx: 0.55 },
    ],
  },
  dirty: {
    id: "dirty",
    mood: "angry",
    texts: ["這邊的地板黏黏的，誰來管一下啊？", "桌子怎麼都沒擦，看了就沒胃口。"],
    options: [
      { id: "clean_now", label: "立刻叫人整理乾淨", cost: 5000, idx: 0.3, clean: 6 },
      { id: "sorry", label: "道歉，馬上處理", cost: 0, idx: 0.15 },
    ],
  },
  pricey: {
    id: "pricey",
    mood: "annoyed",
    texts: ["「{shop}」好像比隔壁貴不少耶……", "這個價錢，我還是再想想好了。"],
    options: [
      { id: "explain", label: "介紹食材與用心之處", cost: 0, idx: 0.2 },
      { id: "coupon", label: "遞上下次折價券", cost: 3000, idx: 0.45 },
    ],
  },
  happy: {
    id: "happy",
    mood: "happy",
    texts: ["「{shop}」好好吃！下次要帶朋友一起來！", "這家店的氣氛真好，待著就覺得放鬆。"],
    options: [
      { id: "chat", label: "聊幾句、聽聽想法", cost: 0, idx: 0.35 },
      { id: "photo", label: "請他們幫忙拍照打卡", cost: 0, idx: 0.5 },
      { id: "card", label: "送一張會員卡", cost: 2000, idx: 0.6 },
    ],
  },
  lost: {
    id: "lost",
    mood: "curious",
    texts: ["請問……車站要往哪邊走啊？我們迷路了。", "不好意思，哪裡有好吃的當地小吃？"],
    options: [
      { id: "guide", label: "親切指路並推薦店家", cost: 0, idx: 0.4 },
      { id: "map", label: "遞上商場導覽地圖", cost: 500, idx: 0.3 },
    ],
  },
};
