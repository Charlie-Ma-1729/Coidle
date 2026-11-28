/**
 * 股權：每座商場一開始發行 INITIAL_SHARES 股，創辦人 100%。
 * 股份和「成員／職位」是兩回事——成員是營運權（誰能下指令），股份是比例（分紅、控制權、退場結算用）。
 * 總股數會因為「注資換股」增加（`malls.total_shares`），所以所有比例都是「持股 ÷ 這座商場的總股數」。
 *
 * - 持股過半（> 50%）＝實際控制人，管事的是他；創辦人頭銜只有一個、不會變。
 * - 持股 ≥ 20% 視同經手：離開（被請出）後仍是關係企業。
 * - 錢進出商場只有這幾條路：股利（按比例、扣稅）、商場回購（9 折、有上限）、注資換股（按估值，見 valuation.ts）。
 * 延伸方向見 docs/equity.md。
 */

import { INITIAL_FUNDS } from "./data";

/** 新商場一開始發行的股數（整數；之後會因為注資換股增加） */
export const INITIAL_SHARES = 10_000;
/** 單座商場總股數的上限（避免整數過大） */
export const MAX_TOTAL_SHARES = 1_000_000;
/** 持股達這個比例就視同經手：兩座商場有同一位 ≥ 20% 的股東，就是關係企業 */
export const RELATED_STAKE_PCT = 0.2;
/** 持股「超過」這個比例（過半）就是這座商場的實際控制人 */
export const CONTROL_PCT = 0.5;
/** 持股過半者的頭銜。創辦人（is_owner）永遠只有一位、不會變；實際控制人是現在真正掌控商場的人，可以換 */
export const CONTROLLER_TITLE = "實際控制人";
/** 商場回購的價格＝估值 × 這個折數（留一點給留下來的人，也避免拿回購當提款機） */
export const BUYBACK_DISCOUNT = 0.9;
/** 一次回購最多只能動用商場現金的這個比例（超過請改賣給其他股東，或分次賣） */
export const BUYBACK_MAX_CASH_PCT = 0.5;
/** 股利：一次最多發商場現金的這個比例（留資金給營運） */
export const DIVIDEND_MAX_CASH_PCT = 0.3;
/** 股利：兩次之間至少隔這麼久（真實時間，約 12 遊戲日），避免每天把錢往外搬 */
export const DIVIDEND_COOLDOWN_MS = 2 * 86_400_000;
/** 股利：一次最少發這麼多（太小沒意義，也擋洗紀錄） */
export const DIVIDEND_MIN = 10_000;
/** 股利所得的扣繳稅率（個人收到股利時先扣，稅款離開遊戲；日本上市股利約 20%） */
export const DIVIDEND_TAX_RATE = 0.2;
/** 注資換股：每股最低價（商場現金很少時也不會發出天文數字的股數） */
export const MIN_SHARE_PRICE = 100;
/** 給其他股東的出價、注資申請的有效期限（真實時間） */
export const OFFER_TTL_MS = 3 * 86_400_000;

/**
 * 股權變現門檻（防免洗帳號：開小號 → 股份集中 → 套現）。轉讓、出價、同意買進、撤資都要過：
 * 帳號夠老，而且在某座商場「真的有在營運」。營運不用點擊次數量化（腳本能狂點），而是兩個被時間與模擬綁住的指標：
 * 1. 活躍遊戲日：有多少個不同的遊戲日下過會改變商場的指令（一天最多算 1，1 遊戲日＝真實 4 小時）
 * 2. 商場自加入以來由模擬產生的累計營業額（客人真的來買；點擊刷不出來）
 */
export const EQUITY_MIN_ACCOUNT_AGE_MS = 3 * 86_400_000;
export const EQUITY_MIN_ACTIVE_DAYS = 8;
export const EQUITY_MIN_MALL_REVENUE = 300_000;

export interface EquityStanding {
  /** 帳號建立時間（ms） */
  accountCreatedAt: number;
  /** 所有成員身分中最好的一座：活躍遊戲日、加入後的商場營業額；或是舊制度前就在的成員（視為達標） */
  activeDays: number;
  mallRevenue: number;
  vouched: boolean;
}

/** 回傳 null＝可以；否則是給玩家看的原因 */
export function equityBlocker(st: EquityStanding, nowMs: number): string | null {
  if (st.vouched) return null;
  const age = nowMs - st.accountCreatedAt;
  if (age < EQUITY_MIN_ACCOUNT_AGE_MS) {
    const hrs = Math.ceil((EQUITY_MIN_ACCOUNT_AGE_MS - age) / 3_600_000);
    return `帳號建立還不夠久，股權變現要滿 ${EQUITY_MIN_ACCOUNT_AGE_MS / 86_400_000} 天（還差約 ${hrs} 小時）`;
  }
  if (st.activeDays < EQUITY_MIN_ACTIVE_DAYS) {
    return `還沒有足夠的經營紀錄：要在 ${EQUITY_MIN_ACTIVE_DAYS} 個不同的遊戲日實際經營過商場（目前 ${st.activeDays} 個）`;
  }
  if (st.mallRevenue < EQUITY_MIN_MALL_REVENUE) {
    return `商場還沒有足夠的實際營業額：你加入後要累計 ¥${EQUITY_MIN_MALL_REVENUE.toLocaleString("en-US")}（目前 ¥${Math.round(st.mallRevenue).toLocaleString("en-US")}）`;
  }
  return null;
}

/**
 * 起始資金是「每位玩家一次」，不是「每座商場一次」：第一座商場的 INITIAL_FUNDS 是免費的起始資金（視為創辦人投入），
 * 之後每開一座新商場，就要從個人錢包拿出同樣一筆錢當創業資金——所以多開帳號、多開商場都不能憑空生錢。
 */
export const FOUNDING_COST = INITIAL_FUNDS;

/** 持股比例（0–1） */
export const stakeFraction = (shares: number, total: number): number => (total > 0 ? shares / total : 0);
/** 持股百分比，小數 2 位 */
export const sharePct = (shares: number, total: number = INITIAL_SHARES): number => Math.round(stakeFraction(shares, total) * 10_000) / 100;
/** 持股過半＝實際控制人（整數運算，不受小數影響） */
export const isControlling = (shares: number, total: number): boolean => shares * 2 > total;
/** 持股 ≥ 20% 視同經手 */
export const isBigStake = (shares: number, total: number): boolean => shares * 5 >= total;
// 下面四個函式的 value＝商場的股權估值（見 valuation.ts 的 mallBookValue，再夾進每日浮動帶），不是現金。
/** 這些股份按估值（估值 × 比例）值多少 */
export const stakeValue = (shares: number, value: number, total: number): number => Math.round((Math.max(0, value) * shares) / total);
/** 商場回購這些股份要付多少（估值 × 折數，取整數） */
export const buybackPrice = (shares: number, value: number, total: number): number => Math.floor(stakeValue(shares, value, total) * BUYBACK_DISCOUNT);
/** 注資換股／出售庫藏股的每股價：估值每股，但不低於 MIN_SHARE_PRICE */
export const issuePrice = (value: number, total: number): number => Math.max(MIN_SHARE_PRICE, Math.max(0, value) / total);

/** 注資 amount 能換到幾股、實際要付多少（整數股；價格是每股 price，進位到整數元；付的不會超過 amount） */
export function sharesForCapital(amount: number, value: number, total: number): { shares: number; cost: number; price: number } {
  const price = issuePrice(value, total);
  let shares = Math.floor(amount / price);
  let cost = Math.ceil(shares * price);
  while (shares > 0 && cost > amount) {
    shares--;
    cost = Math.ceil(shares * price);
  }
  return { shares, cost, price };
}

export interface DividendLine {
  userId: number;
  /** 稅前 */
  gross: number;
  tax: number;
  /** 進錢包的 */
  net: number;
}

/**
 * 把一次股利按持股分給股東：每人 floor(總額 × 持股 / 總股數)，零頭留在商場；
 * 庫藏股（商場自己持有的）不領。回傳每人明細，商場實際支出＝各人稅前加總。
 */
export function splitDividend(amount: number, total: number, holders: { userId: number; shares: number }[]): { lines: DividendLine[]; paid: number; tax: number } {
  const lines = holders
    .filter((h) => h.shares > 0)
    .map((h) => {
      const gross = Math.floor((amount * h.shares) / total);
      const tax = Math.round(gross * DIVIDEND_TAX_RATE);
      return { userId: h.userId, gross, tax, net: gross - tax };
    })
    .filter((l) => l.gross > 0);
  return { lines, paid: lines.reduce((a, l) => a + l.gross, 0), tax: lines.reduce((a, l) => a + l.tax, 0) };
}

/** 一份出售股份的出價：賣方把股份按估值賣給另一位股東，對方同意並付得起才成交 */
export interface ShareOfferView {
  id: number;
  mallId: number;
  fromId: number;
  fromName: string;
  toId: number;
  toName: string;
  shares: number;
  /** 成交價（出價當下的估值；成交時照這個價收付） */
  price: number;
  expiresAt: number;
}

/** 一份注資申請：成員想投入一筆錢換股份，由實際控制人（沒有就是創辦人）決定要不要收 */
export interface CapitalRequestView {
  id: number;
  mallId: number;
  userId: number;
  userName: string;
  amount: number;
  expiresAt: number;
  /** 照現在的估值，這筆錢能換到幾股（核准時以當下價格重算） */
  estShares: number;
}

/** 一位股東在一座商場的持股 */
export interface HolderInfo {
  userId: number;
  displayName: string;
  shares: number;
  /** 百分比，小數 2 位 */
  pct: number;
  /** 現在還是不是這座商場的成員（被請出的人仍可持股，只是沒有營運權；自己離開要先處理掉股份） */
  isMember: boolean;
  /** 持股過半 */
  isController: boolean;
}

export interface HoldingsView {
  /** 流通在外的股數（已發行 − 庫藏股）；比例、控制權、價格都用它算，注資換股會讓它增加 */
  total: number;
  /** 達到這個股數就視同經手（總股數的 20%） */
  relatedAt: number;
  holders: HolderInfo[];
  /** 這座商場的所有相關的人（現任成員與股東）：想把股份轉給誰、出價賣給誰時從這裡選 */
  people: { userId: number; displayName: string; isMember: boolean }[];
  /** 商場自己持有的庫藏股（被回購、還沒賣出；沒有投票權也不領股利）。持股人加庫藏股＝總股數 */
  treasury: number;
  /** 請求者目前不能撤資／轉讓／出價的原因（股權變現門檻）；null 或沒有＝可以。只有「看股權表」那支 API 會帶 */
  cashOutBlocker?: string | null;
  /** 商場現金（四捨五入），算股利與回購的上限用 */
  mallCash: number;
  /** 商場估值（淨資產＋獲利溢價，夾進每日浮動帶）；回購、注資、出價的價錢都用它算。舊版伺服器沒有 */
  equityValue?: number;
  /** 注資換股現在每股多少錢 */
  sharePrice: number;
  /** 這次最多能發多少股利（現金的 30%，且還在冷卻中就是 0） */
  dividendMax: number;
  /** 下次最早能發股利的時間（真實時間 ms；0＝現在就可以） */
  dividendReadyAt: number;
}

/** 一位玩家在各商場的持股與價值（商場估值 × 持股比例；估值見 valuation.ts，不含商場持有的股票與 IPO） */
export interface StakeView {
  mallId: number;
  mallName: string;
  shares: number;
  pct: number;
  /** 商場帳上現金 */
  mallCash: number;
  /** 這份持股對應的現金（四捨五入到整數） */
  value: number;
  isMember: boolean;
}

export interface WealthView {
  stakes: StakeView[];
  /** 再開一座新商場要自己出多少錢（從個人錢包；0＝你還有一次免費的起始資金） */
  foundCost: number;
  /** 個人錢包的現金（賣股份、被商場回購、領股利的錢進這裡；可以拿去注資換股、買股票） */
  cash: number;
  /** 股票市場的持股市值（用現在的股價算） */
  portfolio: number;
  /** 商場以公司資金持有的上市股票市值（法人投資，由自己是管事的商場帶來；沒有為 0） */
  corporate: number;
  /** 商場持股帳面價值 + 股票市值 + 個人現金 */
  totalValue: number;
}

/** 資產快照（每個遊戲日一筆） */
export interface WealthPoint {
  day: number;
  cash: number;
  stakes: number;
  stocks: number;
  corporate: number;
  total: number;
}

/** 股票損益彙總 */
export interface StockSummaryView {
  trades: number;
  /** 已實現損益（賣出，扣手續費後；負數＝虧損） */
  realized: number;
  fees: number;
  tax: number;
  /** 配息（稅後） */
  dividends: number;
  /** 未實現損益（目前持倉市值 − 成本） */
  unrealized: number;
}

/** 錢包流水的種類 */
export type LedgerKind = "dividend" | "buyback" | "share_sale" | "share_buy" | "capital" | "founding" | "stock_buy" | "stock_sell" | "stock_dividend";

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  dividend: "收到股利",
  buyback: "撤資（商場回購）",
  share_sale: "賣出商場股份",
  share_buy: "買進商場股份",
  capital: "注資換股",
  founding: "開新商場",
  stock_buy: "買進股票",
  stock_sell: "賣出股票",
  stock_dividend: "股票配息",
};

/** 錢包的一筆流水（正＝進、負＝出） */
export interface LedgerEntry {
  id: number;
  kind: LedgerKind;
  amount: number;
  /** 這筆之後錢包還剩多少 */
  balanceAfter: number;
  note: string;
  at: number;
}

/** 個人財務頁用：我在所有商場的持股、收到與送出的出價、需要我處理的注資申請 */
export interface PersonalEquityView {
  stakes: StakeView[];
  offers: ShareOfferView[];
  requests: CapitalRequestView[];
}

export const EQUITY_TEXT = {
  founder: `每座商場起初發行 ${INITIAL_SHARES.toLocaleString()} 股，創辦人全數持有。股份和職位是兩回事：職位決定誰能下指令，股份是你在這座商場的比例。`,
  related: "持股達 20% 以上，就算被請出商場也仍視為經手人：你的兩座商場之間依然是關係企業。",
  control: `持股過半（超過 50%）的人是「${CONTROLLER_TITLE}」：請成員離開、改名、換邀請碼、轉讓創辦人頭銜、發股利、核准注資這些事由他說了算。創辦人頭銜只有一個、不會變，但在有實際控制人的時候，管事的是實際控制人。`,
  exit: "撤資與退出：離開商場前要先把股份處理掉——賣給其他股東（照估值，對方同意、付得起才成交），或「撤資」由商場回購（估值 9 折，一次最多動用商場現金的一半，可以分次、可以只撤一部分）。賣得的錢進個人錢包。被回購的股份變成庫藏股，之後新的注資會先買它。",
  dividend: `${CONTROLLER_TITLE}（沒有的話是創辦人）可以宣布發股利：一次最多商場現金的 30%，每 2 天（約 12 遊戲日）最多一次，按持股比例分給每位股東；收到時扣 20% 所得稅。庫藏股不領股利，零頭留在商場。`,
  capital: "中途加入的成員可以申請注資：決定投入多少錢（從個人錢包出），照估值每股的價格換股份，錢進商場。估值＝淨資產（現金＋庫存＋店面設備折舊價值－貸款）加上獲利溢價，且每個遊戲日最多浮動 10%，不是只看現金。先賣掉商場的庫藏股，不夠再發新股（原股東被稀釋，但每股估值不變）。要由實際控制人（沒有就是創辦人）同意。",
  market: "商場的股份還不能在市場上自由買賣（之後上市才開放）；現在可以無償轉給現任成員、賣給其他股東、請商場回購，或透過注資換股取得。個人錢包的錢可以到「股市」買虛構集團的股票。",
} as const;
