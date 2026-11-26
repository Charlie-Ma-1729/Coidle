# Coidle

網頁多人合作經營商場遊戲（約 6 人一座商場、NPC 客人、離線照常模擬；PWA＋桌面）。線上 coidle.imatw.org（Ubuntu、nginx、systemd `coidle.service`、port 2330）。**回覆與文件一律繁體中文。**

## 已定案（不要重新討論）
- 時間：真實 4 小時＝1 遊戲日（`TIME_SCALE=6`），沒有商場能比它快；商場「速度」只是落後時的追趕速度（1/2/3/6×）；暫停＝讓商場落後。
- 平衡用機器人模擬調，不靠真人試玩；真人資料看管理室「平衡數據」。
- 主題：現代科技商場旁的昭和老街；商場內容不點名真實地點，品牌全虛構；日本法規貼近現實（稅、稽查、假日）。**例外：股市內容（新聞、標的介紹）可以提真實地名，但不能用真實品牌／企業名。**
- 不標「簡化版」；不做「代班」。
- AI 內容走 OpenRouter（`anthropic/claude-haiku-5.5`，30 天 ≤ US$1，key 只放伺服器 `.env`），產出要 Claude 審過才上線。
- NPC 商場不標示是 NPC（對外 key 不透露類型）。
- 全面漲價不能是最優解：標價 > 參考價 1.2 倍客人嫌貴走掉（`PRICE_TOLERANCE`）；已驗證各業態最佳都在 ×1.2，數值不調。

## 結構（TypeScript monorepo，Node ≥22.13、Fastify 5、`node:sqlite`、Preact＋signals＋Vite、PixiJS、Vitest）
- `shared/src/game/`：規則與資料（純函式）。`types.ts` 型別、`data.ts` 常數／業態／客群／`LEVELS`、`time.ts`、`commands.ts` 指令定義、`world.ts` NPC 商場。
- `server/src/sim/`：模擬引擎（純、決定性：同 `(seed, tick)` 同結果）。`step.ts` 每 tick（客人流程搜 `serveGroup`、`priceAcceptance`）、`commands.ts` 玩家指令、`events.ts`、`guests.ts`、`report.ts` 日報／損益、`state.ts`（`makeShop`、`createInitialState`）、`migrate.ts` 存檔遷移（狀態版本在這）。
- `server/src/services/mallService.ts`（載入、時鐘、持久化、廣播、管理動作）、`metrics.ts`、`audit.ts`、`balance.ts`、`push.ts`。
- `server/src/world/`：跨商場（alliances、trade、compete、npc/npcActor、market＝股市服務）。
- `shared/src/game/market.ts`（v1 引擎＋共用型別）＋`shared/src/game/market/`（股市 v2：`exchange` 開休市、`engine` 價格引擎、`stocks` 40 檔、`news`＋`news.data.json` 消息庫、`signals`）、`corporate.ts`／`ma.ts`（法人入股與併購規則）。`poolNews.ts` 才 import 消息庫 JSON，不從 `index.ts` 匯出（庫很大）。
- `server/src/api/routes.ts`（全部 HTTP）、`ws.ts`、`auth.ts`；`server/src/db/db.ts`（`MIGRATIONS`）、`repo.ts`（所有 SQL）。
- `server/src/bots/`：平衡模擬 `run.ts`、`pricesweep.ts`（全店倍率）、`catsweep.ts`（分業態倍率）、`ablate.ts`、`world.ts`。`admin/cli.ts`＝`npm run admin`。
- `client/src/`：`store.ts`、`api.ts`、`ws.ts`、`stage/`（PixiJS 主畫面）、`screens/`、`ui/`、`admin/`（Overseer，樣式 `admin.css` 以 `.ad-root` 為範圍）、`serverTime.ts`。
- 測試放在被測程式旁（`*.test.ts(x)`）。

## 指令
```
npm test | npm run typecheck | npm run build:client | npm run dev
npm run sim -- <天數> <種子數> <diligent|lazy|periodic|chaotic>
npx tsx --tsconfig tsconfig.json server/src/bots/pricesweep.ts 40 lazy
npx tsx --tsconfig tsconfig.json server/src/bots/catsweep.ts 24 1 kushikatsu,ramen
npm run admin -- create-overseer | rotate-overseer-key | sandbox-mall <帳號> [編號]
```

## ⚠ 環境陷阱
1. **這個資料夾（`Z:\文件\github\Coidle`）就是 Ubuntu 伺服器在跑的那份**（網路共用）：`node_modules` 是 Linux 版，`.env`、`data/coidle.db` 是正式的。**這裡不要 `npm ci`／tsc／vitest／tsx**。改走 Windows 鏡像：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mirror.ps1 [-Tests "a.test.ts b.test.tsx"] [-NoTsc]`（同步到 `%TEMP%\coidle-mirror`、必要時 `npm ci`、typecheck、跑指定測試）。要跑 tsx 腳本就 `cd` 進鏡像再執行上面的指令；vitest 別加 `--exclude`（會弄壞 `@coidle/shared` 別名）。
2. 改完程式要上線：伺服器 `npm run build:client`＋`sudo systemctl restart coidle`（DB migration 啟動時套用）。**不要 commit `.env`／`.env.bak`／`data/`**（`.claude/settings.json` 已擋讀）。
3. 看正式資料：複製 `data/coidle.db*` 到 scratchpad，用 `node:sqlite` 唯讀查；商場狀態在 `mall_state.state_json`，平衡數據在 `balance_daily`。
4. 編輯用 Edit／Write 工具。批次改用 `python`（Bash 的 `python3` 是 Windows 佔位程式）並保留原換行；Git Bash 的 `sed -i` 會留下 `.msys*` 暫存檔；含引號的長 heredoc 容易解析失敗。
5. git 要加 `-c safe.directory='*'`；CRLF 警告無害；`deploy/**`、`*.sh` 必須是 LF。
6. 瀏覽器窗格寬約 677px 會觸發手機版版面；縮放到 1280x800 只會變 800x500 縮圖。

## 寫程式的規則
- 引擎只認 tick，不碰真實時間；新狀態欄位用**可選欄位＋`?? 0`**，必要時才升版並寫 `sim/migrate.ts`。
- DB 結構只能在 `MIGRATIONS` 尾端加新項，不改舊的。
- 跨商場效果用信件 `at_tick`（伺服器 tick），商場自己的時鐘模擬到那刻才套用。
- 給玩家的狀態用 `MallService.pub()`（附 `serverTick`）；sandbox 商場不受時鐘夾限、不進名錄／賽季／聯名／貿易／搶客，也不記平衡數據。
- 管理 API 走 `requireOverseer` 並用 `note()` 寫稽核；管理室不用 `window.confirm/prompt`，用 `kit.tsx` 的 `confirmBox/promptBox/secretBox`。
- 改規則或數字後：跑機器人模擬確認，結論寫進 `docs/balance-report.md`（開頭有「速查」，新結論加在對應章節）。

## 文件（按需讀；大檔用 Grep，別整檔讀）
`docs/` 下：`stock-market`（股市 v2：開市時間、引擎、40 檔、預約單、配息、法人入股）、`market-news`（消息庫格式與審核）、`talent-roster`（藝人名冊內容池）、`group-ma`（集團／併購／入股設計）、`future-industries`（未來產業提案）、`balance-report`（平衡紀錄，先讀開頭速查）、`cross-mall`（時間軸＋聯名／貿易／搶客／NPC，14KB）、`stage-ui-feature-map`（畫面對照，17KB）、`stage-ui-dev`、`overseer`（管理室／稽核／指標／sandbox）、`roadmap-extensions`（未來玩法必須遵守的不變量）、`equity`、`calendar`、`weather`、`japan-law`、`tech-leasing`、`concept`、`content-expansion`（業態）、`goals-achievements`、`ai-content`、`accounts-admin-onboarding`；部署看 `deploy/README.md`。

## 省 token
- 先 Grep 再 offset/limit 讀片段：`mallService.ts`（67KB）、`routes.ts`（50KB）、`repo.ts`（48KB）、`data.ts`（44KB）、`types.ts`（33KB）、`client/src/ui.test.tsx`（73KB）。
- 不要大範圍遞迴搜尋（網路磁碟會逾時）；不要讀 `package-lock.json`、`data/`、`backups/`、`node_modules/`（已設定拒讀）。
- 只跑相關測試；全部（約 50 檔、800+ 項、約 50 秒）留到收尾跑一次。
- 一次性的實驗腳本與暫存資料放 scratchpad，別放專案裡。
