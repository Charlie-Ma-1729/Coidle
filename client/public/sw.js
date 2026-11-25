// Coidle Service Worker：App Shell 快取＋Web Push。
// 原則：API 與 WebSocket 永遠走網路（遊戲狀態不能是舊的）；只快取畫面本身，讓離線時仍能開啟 App 並顯示「連線中斷」。
// v2：畫面版（Pixi）上線，主程式與延遲載入的場景區塊變大；舊版快取在 activate 時清掉。
const VERSION = "v2";
const SHELL = `coidle-shell-${VERSION}`;
const ASSETS = `coidle-assets-${VERSION}`;
// 雜湊檔名每次部署都會換，舊檔不會再被用到；超過這個數量就從最舊的開始刪（一次部署約 10 個檔案）
const MAX_ASSETS = 60;

function trimAssets(cache) {
  return cache.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k))));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("coidle-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") return; // 永遠走網路

  // 頁面導覽：網路優先，失敗就用快取的 App Shell
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // 帶雜湊檔名的靜態資源：快取優先
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              // 延遲載入的區塊（場景／Pixi）第一次用到時才會抓；存起來，之後離線也能開
              if (res.ok) cache.put(req, res.clone()).then(() => trimAssets(cache));
              return res;
            }),
        ),
      ),
    );
  }
});

// ── 推播：遇事暫停、重要事件
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Coidle", body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : "Coidle";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: `coidle-mall-${data.mallId ?? "x"}`,
      renotify: true,
      data: { url: "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list[0];
      if (open) return open.focus();
      return self.clients.openWindow("/");
    }),
  );
});
