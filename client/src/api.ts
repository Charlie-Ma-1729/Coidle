import type {
  ActivityEntry,
  EventDef,
  RegularDef,
  DirectoryEntry,
  SeasonResult,
  Command,
  MeResponse,
  MemberInfo,
  HoldingsView,
  WealthView,
  ShareOfferView,
  CapitalRequestView,
  LedgerEntry,
  CorporateView,
  FinanceView,
  MarketHistory,
  MarketNewsItem,
  MarketOrderView,
  MarketRange,
  MarketStatus,
  MarketView,
  StockSummaryView,
  WealthPoint,
  PersonalEquityView,
  PortfolioView,
  TradeResult,
  PublicMallState,
  RoleId,
  SpeedId,
} from "@coidle/shared";

export interface ClockPatch {
  speed?: SpeedId;
  paused?: boolean;
  pauseOnEvents?: boolean;
  idlePauseDays?: number | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 旁觀模式（Overseer 看別人的商場）：只能讀，任何會改動商場的請求在送出前就擋掉 */
let readOnly = false;
export function setReadOnly(v: boolean): void {
  readOnly = v;
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (readOnly && method !== "GET" && url.startsWith("/api/malls/")) throw new ApiError(0, "旁觀中，這裡只能看、不能操作");
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "連不到伺服器，請檢查網路");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "發生錯誤");
  return data as T;
}

export interface WorldView {
  now: number;
  season: { index: number; start: number; end: number };
  entries: DirectoryEntry[];
  history: SeasonResult[];
  shields: Record<string, number>;
}

export interface AllianceView {
  id: number;
  status: "pending" | "active";
  direction: "in" | "out" | "both";
  partnerKey: string;
  partnerName: string;
  partnerKind: "player" | "npc";
  until: number;
  jointReadyAt: number;
}

export interface MallInfo {
  id: number;
  name: string;
  inviteCode?: string;
  members: MemberInfo[];
  /** 自己在這座商場的股數；0＝不能經營（旁觀者、舊伺服器沒有這個欄位） */
  myShares?: number;
}

export const api = {
  me: () => request<MeResponse>("GET", "/api/me"),
  register: (username: string, password: string, displayName: string, signupSecret?: string) =>
    request<{ ok: true }>("POST", "/api/auth/register", { username, password, displayName, signupSecret }),
  login: (username: string, password: string) => request<{ ok: true }>("POST", "/api/auth/login", { username, password }),
  overseerLogin: (key: string) => request<{ ok: true }>("POST", "/api/auth/overseer", { key }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  createMall: (name: string) => request<{ id: number; inviteCode: string }>("POST", "/api/malls", { name }),
  joinMall: (code: string, role?: RoleId) => request<{ id: number }>("POST", "/api/malls/join", { code, role }),
  world: () => request<WorldView>("GET", "/api/world"),
  alliances: (id: number) => request<{ alliances: AllianceView[]; related?: string[] }>("GET", `/api/malls/${id}/world/alliances`),
  proposeAlliance: (id: number, target: string) => request<{ alliances: AllianceView[] }>("POST", `/api/malls/${id}/world/alliance`, { target }),
  respondAlliance: (id: number, aid: number, accept: boolean) => request<{ alliances: AllianceView[] }>("POST", `/api/malls/${id}/world/alliance/${aid}/respond`, { accept }),
  endAlliance: (id: number, aid: number) => request<{ alliances: AllianceView[] }>("POST", `/api/malls/${id}/world/alliance/${aid}/end`, {}),
  tradeFunds: (id: number, target: string, amount: number) => request<{ sent: number; received: number }>("POST", `/api/malls/${id}/world/trade/funds`, { target, amount }),
  tradeGoods: (id: number, target: string, shopId: string, qty: number) => request<{ sent: number; received: number; rescue: boolean }>("POST", `/api/malls/${id}/world/trade/goods`, { target, shopId, qty }),
  compete: (id: number, target: string, persona: string) => request<{ cost: number; target: string; persona: string; hurt: boolean }>("POST", `/api/malls/${id}/world/compete`, { target, persona }),
  jointPromo: (id: number, aid: number) => request<{ alliances: AllianceView[]; cost: number }>("POST", `/api/malls/${id}/world/alliance/${aid}/joint`, {}),
  contentEvents: () => request<{ events: EventDef[] }>("GET", "/api/content/events"),
  contentRegulars: () => request<{ regulars: RegularDef[] }>("GET", "/api/content/regulars"),
  mall: (id: number) => request<MallInfo>("GET", `/api/malls/${id}`),
  state: (id: number) => request<PublicMallState>("GET", `/api/malls/${id}/state`),
  activity: (id: number) => request<ActivityEntry[]>("GET", `/api/malls/${id}/activity?limit=40`),
  command: (id: number, command: Command) => request<PublicMallState>("POST", `/api/malls/${id}/commands`, { command }),
  /** 融資與保險頁：各金融機構的授信氣候與每個產品的預審 */
  finance: (id: number) => request<FinanceView>("GET", `/api/malls/${id}/finance`),
  clock: (id: number, patch: ClockPatch) => request<PublicMallState>("POST", `/api/malls/${id}/clock`, patch),
  setRole: (id: number, role: RoleId) => request<{ members: MemberInfo[] }>("POST", `/api/malls/${id}/role`, { role }),
  updateProfile: (displayName: string) => request<{ ok: true; displayName: string }>("POST", "/api/me/profile", { displayName }),
  changePassword: (current: string, next: string) => request<{ ok: true }>("POST", "/api/me/password", { current, next }),
  deleteAccount: (password: string) => request<{ ok: true }>("POST", "/api/me/delete", { password }),
  leaveMallServer: (id: number) => request<{ dissolved: boolean }>("POST", `/api/malls/${id}/leave`, {}),
  kickMember: (id: number, userId: number) => request<{ members: MemberInfo[] }>("POST", `/api/malls/${id}/members/${userId}/kick`, {}),
  transferOwner: (id: number, userId: number) => request<{ members: MemberInfo[] }>("POST", `/api/malls/${id}/transfer`, { userId }),
  holdings: (id: number) => request<HoldingsView>("GET", `/api/malls/${id}/holdings`),
  transferShares: (id: number, userId: number, shares: number) => request<HoldingsView>("POST", `/api/malls/${id}/shares/transfer`, { userId, shares }),
  wealth: () => request<WealthView>("GET", "/api/me/wealth"),
  myEquity: () => request<PersonalEquityView>("GET", "/api/me/equity"),
  ledger: (limit = 100) => request<{ entries: LedgerEntry[] }>("GET", `/api/me/ledger?limit=${limit}`),
  market: () => request<MarketView>("GET", "/api/market"),
  marketHistory: (key: string, range: MarketRange = "1d") => request<MarketHistory>("GET", `/api/market/${encodeURIComponent(key)}/history?range=${range}`),
  marketStatus: () => request<MarketStatus>("GET", "/api/market/status"),
  marketNews: (limit = 40) => request<{ items: MarketNewsItem[] }>("GET", `/api/market/news?limit=${limit}`),
  orderStock: (key: string, side: "buy" | "sell", shares: number) => request<MarketOrderView>("POST", `/api/market/${encodeURIComponent(key)}/order`, { side, shares }),
  cancelOrder: (id: number) => request<MarketOrderView>("POST", `/api/market/orders/${id}/cancel`),
  wealthHistory: () => request<{ points: WealthPoint[] }>("GET", "/api/me/wealth/history"),
  corporate: () => request<CorporateView>("GET", "/api/me/corporate"),
  corporateTrade: (mallId: number, key: string, side: "buy" | "sell", shares: number) => request<TradeResult>("POST", `/api/malls/${mallId}/portfolio/${encodeURIComponent(key)}/${side}`, { shares }),
  stockSummary: () => request<StockSummaryView>("GET", "/api/me/stock-summary"),
  portfolio: () => request<PortfolioView>("GET", "/api/me/portfolio"),
  buyStock: (key: string, shares: number) => request<TradeResult>("POST", `/api/market/${encodeURIComponent(key)}/buy`, { shares }),
  sellStock: (key: string, shares: number) => request<TradeResult>("POST", `/api/market/${encodeURIComponent(key)}/sell`, { shares }),
  shareOffers: (id: number) => request<{ offers: ShareOfferView[]; requests: CapitalRequestView[] }>("GET", `/api/malls/${id}/shares/offers`),
  offerShares: (id: number, userId: number, shares: number) => request<{ offers: ShareOfferView[] }>("POST", `/api/malls/${id}/shares/offer`, { userId, shares }),
  respondOffer: (offerId: number, accept: boolean) => request<{ mallId: number }>("POST", `/api/shares/offers/${offerId}/respond`, { accept }),
  buybackShares: (id: number, shares: number) => request<HoldingsView>("POST", `/api/malls/${id}/shares/buyback`, { shares }),
  declareDividend: (id: number, amount: number) => request<{ view: HoldingsView; paid: number; tax: number }>("POST", `/api/malls/${id}/dividend`, { amount }),
  requestCapital: (id: number, amount: number) => request<{ applied: boolean; shares: number }>("POST", `/api/malls/${id}/capital`, { amount }),
  respondCapital: (requestId: number, accept: boolean) => request<{ mallId: number }>("POST", `/api/capital/${requestId}/respond`, { accept }),
  renameMall: (id: number, name: string) => request<{ name: string }>("POST", `/api/malls/${id}/rename`, { name }),
  regenInvite: (id: number) => request<{ inviteCode: string }>("POST", `/api/malls/${id}/invite/regenerate`, {}),
};
