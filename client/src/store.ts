import { signal } from "@preact/signals";
import { registerEvents, registerRegulars, type ActivityEntry, type Command, type MallSummary, type MeResponse, type PublicMallState, type WealthView } from "@coidle/shared";
import { api, ApiError, setReadOnly, type ClockPatch, type MallInfo } from "./api";
import type { PendingInvite } from "./ui/attention";
import { connectMall, disconnectMall } from "./ws";

export const user = signal<MeResponse["user"] | null>(null);
export const myMalls = signal<MallSummary[]>([]);
/** 啟動時是否已確認過登入狀態 */
export const authReady = signal(false);
export const mallId = signal<number | null>(null);
/** Overseer 正在旁觀這座商場（只能看，不能操作，也不算在場） */
export const spectating = signal(false);
export const mallInfo = signal<MallInfo | null>(null);
export const state = signal<PublicMallState | null>(null);
export const activity = signal<ActivityEntry[]>([]);
export const online = signal(false);
export const busy = signal(false);
/** 世界 → 名錄開啟時要直接展開的商場（待辦中心的「反擊」用），用過就清掉 */
export const worldFocus = signal<{ key: string; persona?: string } | null>(null);
/** 待回覆的聯名邀請（待辦中心用） */
export const invites = signal<PendingInvite[]>([]);

/** 重新讀取待回覆的聯名邀請；失敗就維持原樣（只是少一個提醒） */
export async function refreshInvites(): Promise<void> {
  const id = mallId.value;
  if (id === null) return;
  try {
    const r = await api.alliances(id);
    if (mallId.value !== id) return;
    invites.value = r.alliances.filter((a) => a.status === "pending" && a.direction === "in").map((a) => ({ id: a.id, partnerName: a.partnerName, until: a.until }));
  } catch {
    // ignore
  }
}

/** 個人財務：錢包、商場持股、股票市值（各處共用，不再各自去拿） */
export const wealth = signal<WealthView | null>(null);
/** 「個人財務」視窗：要開哪一頁（null＝沒開）。Lobby 與遊戲內共用同一個視窗 */
export const personalPage = signal<{ tab: "overview" | "stakes" | "market" | "ledger" } | null>(null);
export const openPersonal = (tab: "overview" | "stakes" | "market" | "ledger" = "overview"): void => {
  personalPage.value = { tab };
};

/** 重新讀取個人財務；失敗就維持原樣 */
export async function refreshWealth(): Promise<WealthView | null> {
  try {
    wealth.value = await api.wealth();
  } catch {
    // ignore
  }
  return wealth.value;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
}
export const toasts = signal<Toast[]>([]);
let toastSeq = 1;
export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const id = toastSeq++;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === "error" ? 5000 : 2800);
}

export function errMsg(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "發生錯誤";
}

export async function bootstrap(): Promise<void> {
  // 手機從背景回來（或冷啟動）時網路常常還沒恢復：網路錯誤（不是伺服器回的 HTTP 錯誤）先重試幾次，才當作未登入
  for (let attempt = 0; ; attempt++) {
    try {
      const me = await api.me();
      user.value = me.user;
      myMalls.value = me.malls;
      const saved = Number(localStorage.getItem("coidle.mall"));
      if (me.user.role === "overseer") break; // Overseer 登入後先進管理室，不自動進商場
      if (saved && me.malls.some((m) => m.id === saved)) await openMall(saved);
      else if (me.malls.length === 1 && me.malls[0]) await openMall(me.malls[0].id);
      break;
    } catch (e) {
      if (!(e instanceof ApiError) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      user.value = null;
      break;
    }
  }
  authReady.value = true;
}

export async function refreshMe(): Promise<void> {
  const me = await api.me();
  user.value = me.user;
  myMalls.value = me.malls;
}

export async function openMall(id: number, opts: { spectate?: boolean } = {}): Promise<void> {
  const spectate = !!opts.spectate;
  spectating.value = spectate;
  setReadOnly(spectate);
  mallId.value = id;
  if (!spectate) localStorage.setItem("coidle.mall", String(id));
  // 先取得新增的事件定義（AI 事件），畫面才認得待決事件
  await api.contentEvents().then((r) => registerEvents(r.events), () => undefined);
  await api.contentRegulars().then((r) => registerRegulars(r.regulars), () => undefined);
  const [info, st, act] = await Promise.all([api.mall(id), api.state(id), api.activity(id)]);
  mallInfo.value = info;
  state.value = st;
  activity.value = act;
  invites.value = [];
  connectMall(id, spectate);
  void refreshInvites();
}

export function leaveMall(): void {
  disconnectMall();
  spectating.value = false;
  setReadOnly(false);
  mallId.value = null;
  mallInfo.value = null;
  state.value = null;
  activity.value = [];
  invites.value = [];
  localStorage.removeItem("coidle.mall");
}

/** Overseer：旁觀任何一座商場（唯讀） */
export function spectateMall(id: number): Promise<void> {
  return openMall(id, { spectate: true });
}

export async function logout(): Promise<void> {
  try {
    await api.logout();
  } finally {
    leaveMall();
    user.value = null;
    myMalls.value = [];
    wealth.value = null;
    personalPage.value = null;
  }
}

/** 調整時間流速／暫停（任何成員都可以） */
export async function setClock(patch: ClockPatch, okText?: string): Promise<boolean> {
  const id = mallId.value;
  if (id === null) return false;
  busy.value = true;
  try {
    state.value = await api.clock(id, patch);
    if (okText) toast(okText, "ok");
    return true;
  } catch (e) {
    toast(errMsg(e), "error");
    return false;
  } finally {
    busy.value = false;
  }
}

/** 送出指令；成功時以伺服器回傳的新狀態為準 */
export async function run(cmd: Command, okText?: string): Promise<boolean> {
  const id = mallId.value;
  if (id === null) return false;
  busy.value = true;
  try {
    state.value = await api.command(id, cmd);
    if (okText) toast(okText, "ok");
    return true;
  } catch (e) {
    toast(errMsg(e), "error");
    return false;
  } finally {
    busy.value = false;
  }
}
