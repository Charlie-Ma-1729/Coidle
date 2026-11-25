# Coidle

網頁多人合作經營商場遊戲（約 6 人一座商場、NPC 客人、離線照常模擬；PWA＋桌面）。線上：coidle.imatw.org（Ubuntu、nginx、systemd `coidle.service`、port 2330）。回覆與文件用繁體中文。

## 已定案的決定（不要重新討論）
- 伺服器基準時間：真實 4 小時＝1 遊戲日（`TIME_SCALE=6`），**沒有商場能比它快**；商場的「速度」只是落後時的追趕速度（1×/2×/3×/6×）。暫停＝慢慢玩，會讓商場落後。
- 平衡用機器人模擬調，不靠真人試玩；真人資料看管理室「平衡數據」。
- 主題：現代科技商場旁的昭和老街；**不點名真實地點**，品牌全是虛構。日本法規要貼近現實（稅、稽查、假日）。
- 不要把東西標成「簡化版」；不做「代班」功能。
- AI 內容走 OpenRouter，30 天 ≤ US$1，key 只放伺服器 `.env`，模型 `anthropic/claude-haiku-5.5`；AI 產的內容要 Claude 審過才上線。
- NPC 商場對玩家**不標示是 NPC**（對外 key 不透露類型）。
- 全面漲價不能是最優解：標價 > 參考價 1.2 倍客人會嫌貴走掉（`PRICE_TOLERANCE`）。

## 結構（TypeScript monorepo，Node ≥22.13、Fastify 5、`node:sqlite`、Preact＋signals＋Vite、PixiJS、Vitest）
- `shared/src/game/`：**遊戲規則與資料（純函式）**。`types.ts`（所有型別）、`data.ts`（常數、業態、客群）、`time.ts`（時鐘）、`commands.ts`（指令定義）、`world.ts`（NPC 商場）。
- `server/src/sim/`：模擬引擎（純、決定性：同 `(seed, tick)` 同結果；追趕＝即時推進）。`step.ts` 每 tick、`commands.ts` 玩家指令、`events.ts`、`guests.ts`、`report.ts` 日報、`migrate.ts` 存檔遷移（狀態版本在這）。
- `server/src/services/mallService.ts`：商場服務（載入、同步時鐘、持久化、廣播、管理動作）。`metrics.ts`、`audit.ts`、`balance.ts`、`push.ts`。
- `server/src/world/`：跨商場（聯名 alliances、貿易 trade、搶客 compete、NPC npc/npcActor、股市 market）。
- `server/src/api/routes.ts`（全部 HTTP）、`ws.ts`、`auth.ts`；`server/src/db/db.ts`（`MIGRATIONS` 陣列，只能往後加）、`repo.ts`（所有 SQL）。
- `server/src/bots/`：平衡模擬（`run.ts`、`pricesweep.ts`、`ablate.ts`、`world.ts`）；`admin/cli.ts` 是 `npm run admin`。
- `client/src/`：`store.ts`（signals）、`api.ts`、`ws.ts`、`stage/`（PixiJS 主畫面、`StageGame.tsx`）、`screens/`（各功能頁）、`ui/`、`admin/`（Overseer 管理室，樣式 `admin.css` 以 `.ad-root` 為範圍）、`serverTime.ts`（伺服器時間 vs 商場時間）。
- 測試放在被測程式旁邊（`*.test.ts(x)`）；`client/src/ui.test.tsx` 很大（1200+ 行），要改就用 Grep 找位置，別整檔讀。

## 指令
```
npm test | npm run typecheck | npm run build:client | npm run dev
npm run sim -- <天數> <種子數> <diligent|lazy|periodic|chaotic>     # 機器人平衡模擬
npx tsx --tsconfig tsconfig.json server/src/bots/pricesweep.ts 40 lazy   # 全店標價倍率掃描
npm run admin -- create-overseer | rotate-overseer-key | sandbox-mall <帳號> [編號]
```

## ⚠ 環境陷阱（最常浪費時間）
1. **這個資料夾（`Z:\文件\github\Coidle`）就是 Ubuntu 伺服器在跑的那份**（網路共用）。`node_modules` 是 Linux 版，`.env`、`data/coidle.db` 是正式的。**不要在這裡 `npm ci`／跑 tsc／vitest**。測試走 Windows 鏡像：把專案 robocopy 到 scratchpad（排除 node_modules .git data backups dist `.env*` `*.db*`），在鏡像裡 `npm ci` 一次後跑 `tsc`／`vitest`。scratchpad 有 `check.ps1`（同步＋tsc＋可選測試路徑，用帶引號的字串傳參：`check.ps1 "server/src/x.test.ts client/src/ui.test.tsx"`；腳本要存成 **UTF-8 BOM**，因為路徑有中文）。
2. 改完程式：伺服器要 `npm run build:client`＋`sudo systemctl restart coidle`（DB migration 在啟動時套用）。**不要 commit `.env`／`.env.bak`／`data/`**。
3. 要看正式資料：複製 `data/coidle.db*` 到 scratchpad 再用 `node:sqlite` 唯讀查；商場狀態在 `mall_state.state_json`。
4. 編輯檔案用 Edit／Write 工具。需要批次改時用 python 並**保留原本的換行（CRLF/LF）**；Bash 裡 `python3` 是 Windows 佔位程式，要用 `python`；Git Bash 的 `sed -i` 會在共用資料夾留下 `.msys*` 暫存檔。含引號的長 heredoc 容易讓 Bash 解析失敗，改用 Write 工具。
5. git 在共用資料夾要加 `-c safe.directory='*'`；CRLF 警告無害。`deploy/**`、`*.sh` 必須是 LF。
6. 瀏覽器窗格縮放到 1280x800 會變 800x500 的縮圖；窗格自然寬約 677px 會觸發手機版版面。

## 寫程式的規則
- 模擬引擎只認 tick，不碰真實時間；新增狀態欄位用**可選欄位＋`?? 0`**，避免要遷移舊存檔；必要時才升狀態版本並寫 `sim/migrate.ts`。
- DB 結構只能在 `MIGRATIONS` 後面加新的一項，別改舊的。
- 跨商場效果用信件的 `at_tick`（伺服器 tick），商場自己的時鐘模擬到那一刻才套用。
- 給玩家的狀態用 `MallService.pub()`（附 `serverTick`）；測試商場（sandbox）不受伺服器時鐘夾限、不進名錄／賽季／聯名／貿易／搶客，也不記平衡數據。
- 管理 API 一律走 `requireOverseer`，並用 `note()` 寫稽核；管理室不要用 `window.confirm/prompt`，用 `kit.tsx` 的 `confirmBox/promptBox/secretBox`。
- 改規則或數字後：跑機器人模擬確認，並把結論寫進 `docs/balance-report.md`。

## 文件索引（要用到才讀，別全讀）
`docs/cross-mall.md` 時間軸＋聯名／貿易／搶客／NPC・`overseer.md` 管理室／稽核／指標／測試商場・`balance-report.md` 平衡紀錄・`calendar.md` 日本日曆・`weather.md`・`tech-leasing.md`・`equity.md` 股份・`stock-market.md`・`concept.md` 商場定位・`goals-achievements.md`・`japan-law.md`・`content-expansion.md` 業態・`ai-content.md`・`accounts-admin-onboarding.md`・`stage-ui-dev.md`／`stage-ui-feature-map.md` 主畫面與功能對照・`roadmap-extensions.md` 未來玩法必須遵守的不變量・`deploy/README.md` 部署。

## 省 token 的做法
- 大檔案（`mallService.ts` 1400 行、`routes.ts` 1000、`types.ts` 1000、`data.ts` 870、`repo.ts` 800、`ui.test.tsx` 1260）先 Grep 再用 offset/limit 讀片段。
- 找東西先查上面的結構與文件索引，不要用大範圍遞迴搜尋（`grep -rn .` 在網路磁碟上會逾時）。
- 驗證只跑相關測試；要跑全部（約 50 檔、800+ 項、約 50 秒）時在收尾做一次。
