import { signal } from "@preact/signals";
import { request } from "./api";

// PWA：Service Worker 註冊、安裝提示、Web Push 訂閱。

export const canInstall = signal(false);
export const installed = signal(typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches);
export const pushPermission = signal<NotificationPermission | "unsupported">(pushSupported() ? Notification.permission : "unsupported");
export const pushOn = signal(false);

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferred: InstallPromptEvent | null = null;

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** 只在正式環境註冊（開發時的 Vite 熱更新不需要 Service Worker） */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    canInstall.value = true;
  });
  window.addEventListener("appinstalled", () => {
    installed.value = true;
    canInstall.value = false;
    deferred = null;
  });
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(refreshPushState, () => undefined);
  });
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  canInstall.value = false;
  return choice.outcome === "accepted";
}

function keyToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function refreshPushState(): Promise<void> {
  if (!pushSupported()) return;
  pushPermission.value = Notification.permission;
  const reg = await registration();
  pushOn.value = !!(reg && (await reg.pushManager.getSubscription()));
}

/** 開啟推播：要權限、向 Push 服務訂閱、把訂閱交給伺服器。回傳錯誤訊息（成功為 null）。 */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return "這個瀏覽器不支援推播通知";
  const reg = await registration();
  if (!reg) return "App 還沒準備好（Service Worker 尚未啟用），請重新整理後再試";
  const { publicKey } = await request<{ publicKey: string | null }>("GET", "/api/push/key");
  if (!publicKey) return "伺服器尚未設定推播金鑰";
  const perm = await Notification.requestPermission();
  pushPermission.value = perm;
  if (perm !== "granted") return "你沒有允許通知，可以在瀏覽器的網站設定裡重新開啟";
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) as BufferSource }));
  await request("POST", "/api/push/subscribe", sub.toJSON());
  pushOn.value = true;
  return null;
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await request("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  pushOn.value = false;
}
