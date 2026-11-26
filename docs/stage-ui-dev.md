# 畫面版 UI：開發說明

## 入口

| 網址 | 內容 |
|---|---|
| `/`（預設） | 登入 → 選商場 → 畫面版（真實資料） |
| `/#stage-demo` | 畫面版範例，假資料、不連伺服器 |
| Overseer 登入後 | 管理室（`client/src/admin/`，見 `docs/overseer.md`） |

## 開測試用伺服器

`.claude/launch.json` 裡有幾個設定（在 Claude 桌面版用 `preview_start` 開）：

| 名稱 | 用途 |
|---|---|
| `stage-demo` | 前端 Vite（port 5173，`--host` 可從手機連；`VITE_POLL=1` 解決網路磁碟上檔案監看失效） |
| `stage-server` | 後端 port 2330，**獨立資料庫 `data/stage-test.db`**、關閉註冊密語、**關閉 AI 呼叫**（不會花 OpenRouter 額度） |
| `stage-server-ff` | 同上，但伺服器時鐘快轉 30 小時（有日報、常客、客訴可以看） |

測試庫沒有註冊密語，自己註冊一個帳號、建商場就能玩。資料庫在 `data/`，已被 `.gitignore` 排除。

開發模式下，瀏覽器 console 有 `window.__stage`（場景除錯入口）：
`debugInfo()` 看人數／縮放、`debugAdvance(秒)` 手動快轉人潮模擬（視窗被隱藏時動畫不會自己跑）、`setClock(分鐘, 開, 關)` 撥場景時鐘。

## 目錄

```
client/src/stage/        場景與資料
  model.ts               StageModel（場景唯一依賴的資料形狀）
  adapter.ts             PublicMallState → StageModel（真實資料）
  fixtures.ts            示範用假資料
  floorplan.ts           商場平面圖版型與路徑圖（純函式）
  crowd.ts               裝飾性人潮模擬（純函式，可確定性重現）
  furniture.ts           各店型的座位與店員站位（純資料）
  sprites.ts, background.ts, glyphs.ts, color.ts   程式生成的像素美術
  scene.ts               Pixi 場景（攝影機、房間、人物、氣泡）
  useStage.ts            場景生命週期與資料同步 hook
  StageGame.tsx          真實資料版主元件
  StageScreen.tsx        示範版
client/src/ui/           介面
  attention.ts           待辦中心（從狀態彙整需要處理的事）
  reveal.ts              漸進揭露規則（哪些功能何時出現）
  hints.ts               情境提示
  hubs/GameHubs.tsx      5 個樞紐視窗、選單頁面、設定、全部功能、日報彈窗
  RealShopPanel.tsx      店面面板
  Hud.tsx, Dock.tsx, Window.tsx, Icon.tsx, ...
client/src/screens/      既有功能畫面（被樞紐內嵌；Ops、Guests、Team 已拆成可組合的區塊）
```

## 重要設計

- **畫面是呈現層，不是新模擬**：場景裡的顧客、店員是由狀態推導的裝飾動畫，實際營收與客數以伺服器帳本為準。伺服器模擬規則與存檔完全沒動。
- **位置不存資料**：`Slot { id, zone }` 本來就固定，平面圖版型由「這層有幾個店面格」自動決定（≤ 8 格單走道＋十字中庭；9–14 格雙走道＋島型店面）。
- **場景只在必要時重畫**：資料更新時比對「會改變房間外觀」的欄位（`lotSignature`），價格、營收之類變動只更新店員、氣泡、文字。
- **版面規則**：視窗內容區欄寬有上限、橫向選項列自動換行，見 `stage/layout-css.test.ts`。
- **出入口**：只有 1F（`ground`）主走道兩端是對外的街道門；其他樓層是實牆＋館內導覽圖，客人只能從電扶梯（中庭）或電梯（右上電梯廳）出現，離場也走回去。例外：`FLOOR_LINKS`（`adapter.ts`）列出的樓層多一條外部通道，目前只有 B1（區域設定本來就是「連通車站的地下美食街」）有車站連通道。`floorplan.ts` 已支援 `parking`（停車場閘門），但遊戲裡停車場是 1F 的業態，沒有非地面層需要它，所以目前沒接資料。
- **日夜光線**（`lighting.ts`）：全畫面色調依遊戲時間漸變（清晨暖橘、黃昏橘紅、夜晚深藍，商場打烊更暗）；入夜後營業中的店面有室內暖光與門口外溢的光、走道天花燈、噴水池與電扶梯的光（add 混合，白天整層隱藏）。
- **人潮量依伺服器的來客曲線**（`crowd.ts`）：每店生成率 = 當天平均來客率 × 此刻的相對流量 ÷ 600（1 遊戲小時＝600 真實秒）× 平均人數 × `VISUAL_SCALE`。相對流量 `trafficShape` 來自 shared 的 `hourlyTraffic`（各客群時段曲線加總，營業時段平均為 1，平日與假日不同）。平均來客率用 `(todayGroups + 先驗) / 開店至今的曲線積分 (trafficElapsed)`，所以不會因為當天累計成交增加而愈晚愈擠，早上也不會空蕩蕩。只換算比例，不影響帳目。
- **每層樓各留一份人潮**（`scene.ts` 的 `crowds`）：切走再切回來人還在，只補跑離開的那段（最多 `WARMUP_SECONDS`＝25 秒）；第一次看這層或店面格增減（擴建）就重新生成並 `warmUp` 到穩態人數，不會從 0 人慢慢冒出來。`rebuild()` 結尾立刻 `syncAgents`，施工進度更新時不閃。
- **手機回前景不空白**：`scene.ts` 監聽 `webglcontextlost`、`pageshow`、`visibilitychange`；WebGL 畫面被系統回收就呼叫 `onLost`，`useStage` 整個銷毀並重建場景（`generation`）。場景載入失敗自動重試一次，仍失敗 `StageGame` 顯示「重新載入畫面」。用 `WEBGL_lose_context` 擴充的 `loseContext()` 可以在桌面瀏覽器重現。
- **效能**（`PerfGovernor`）：每秒量一次幀率，連續 3 秒低於 40 fps 就降一級（人潮上限 100 → 56 → 30，第 2 級幀率上限 30），穩定 20 秒才升回一級。分頁隱藏時停掉 ticker；離場的人的精靈放回池子重用；放手後有慣性滑動；手機長按選單已關掉。
- **正式環境 CSP**：伺服器是 `script-src 'self'`（不允許 eval），Pixi 預設會用 `new Function`，開發模式看不出來、正式環境整個畫面會壞掉。`scene.ts` 一開頭 `import "pixi.js/unsafe-eval"` 就是為了這個，`lighting.test.ts` 有守住。Pixi 只由延遲載入的 `scene` 區塊引入（登入頁不用下載；主程式 653 KB → 336 KB）。
- **PWA**：`sw.js` v2，舊版快取會在 activate 時清掉；`/assets/` 快取上限 60 個檔案，從最舊的開始刪（雜湊檔名每次部署都會換）；延遲載入的場景區塊第一次用到時存進快取，之後離線也能開。

## 測試

```powershell
npm run typecheck
npm test
```

平面圖、路徑、人潮、轉接層、待辦、揭露、提示、圖示都有純函式測試；面板與樞紐在 `client/src/ui.test.tsx`（happy-dom）。Pixi 場景本身要在瀏覽器裡看。
