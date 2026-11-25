import { signal } from "@preact/signals";

// 前端自動更新：伺服器部署新版後，已經開著的分頁／已安裝的 App 會自己發現並重新載入。
// 作法：打包時產生版本代號（__BUILD_ID__），同時寫進 /version.json；這裡定期比對，不同就是有新版。
//
// 重新載入的時機：
// - 分頁在背景（看不到）→ 立刻重新載入，使用者回來就是新版；
// - 分頁在前景 → 顯示橫幅倒數，時間到才載入（正在打字就順延），可按「立即更新」或「稍後」；
// - 同一個新版只自動載入一次（sessionStorage 記著），重新載入後還是對不上（例如被中間的快取擋住）就只提醒，不會無限重載。

export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

/** 伺服器上較新的版本代號；null＝目前是最新 */
export const updateAvailable = signal<string | null>(null);

const CHECK_EVERY_MS = 5 * 60_000;
const RELOADED_KEY = "coidle-reloaded-for";
const PRELOAD_KEY = "coidle-preload-reload-at";

/** 讀伺服器上目前的版本代號；讀不到（離線、伺服器重啟中）回傳 null */
export async function fetchRemoteBuild(): Promise<string | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { build?: unknown };
    return typeof j.build === "string" && j.build ? j.build : null;
  } catch {
    return null;
  }
}

/** 這個新版是不是已經為它自動重新載入過一次了 */
export function alreadyReloadedFor(build: string): boolean {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === build;
  } catch {
    return false;
  }
}

/** 重新載入成新版（記下來，避免對同一版無限重載） */
export function applyUpdate(build: string | null = updateAvailable.value): void {
  try {
    if (build) sessionStorage.setItem(RELOADED_KEY, build);
  } catch {
    /* 沒有 sessionStorage 就算了 */
  }
  location.reload();
}

/** 使用者正在輸入文字（這時候不要硬重新載入，會丟掉打到一半的內容） */
export function isEditing(): boolean {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !["button", "checkbox", "radio", "range", "submit"].includes((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable;
}

/** 去問伺服器有沒有新版；有的話設定 updateAvailable，分頁在背景就直接重新載入。開發模式不檢查。 */
export async function checkForUpdate(): Promise<boolean> {
  if (BUILD_ID === "dev") return false;
  const remote = await fetchRemoteBuild();
  if (!remote || remote === BUILD_ID) return false;
  updateAvailable.value = remote;
  if (typeof document !== "undefined" && document.hidden && !alreadyReloadedFor(remote)) applyUpdate(remote);
  return true;
}

let started = false;

/** 啟動自動檢查：定時、回到分頁、恢復網路時各查一次；分頁被藏起來時若已知有新版就載入 */
export function startUpdater(): void {
  if (started || typeof window === "undefined" || BUILD_ID === "dev") return;
  started = true;
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  window.addEventListener("online", () => void checkForUpdate());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      const v = updateAvailable.value;
      if (v && !alreadyReloadedFor(v)) applyUpdate(v);
    } else {
      void checkForUpdate();
    }
  });
  // 新版部署後，舊版的延遲載入區塊（場景、Pixi…）檔案已經不存在，載入會失敗：直接重新載入拿新版。一分鐘內最多一次。
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    try {
      const last = Number(sessionStorage.getItem(PRELOAD_KEY) ?? 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(PRELOAD_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    location.reload();
  });
  void checkForUpdate();
}
