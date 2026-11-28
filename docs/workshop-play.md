# 研發小遊戲（工坊手藝＋科技研究專案）

把「選素材→等時間」變成有手感的決策。**不玩也能玩**（沒有 `play` ＝ 與舊版完全相同），玩得好有上限加成，不是最優解的必要條件。

## 共通：伺服器重放驗證
- client 即時玩，指令只送**原始輸入**（`PlayInput`：關卡種子＋各關輸入＋調味微調）。
- 伺服器用 `workshop.playSeed`（自己的鹽雜湊，不是引擎亂數流）重新產生關卡、重算分數；種子不符／輸入不合法＝當作沒玩，不報錯。偽造輸入只會被夾限。
- `playSeed` 每次開始研發後換新，client 從公開狀態拿到。
- 新欄位都是可選欄位（`RndJob.play`、`WorkshopState.playSeed`、`TechJob.plan/points/exp/expDone/seed`、`TechState.grades`），舊存檔缺省＝自動。

## 工坊（`shared/src/game/workshopPlay.ts`、`server/src/sim/workshop.ts`、`client/src/screens/workshop/PlayFlow.tsx`）
四個群組（food／retail／entertainment／service）各有一套工序名稱（`PLAY_GROUPS`），三關：
1. **備料／打樣／編排／流程（下刀）**：即時關卡，目標（亮線）與雜質（紅線）依序滑過，在亮線上下手、紅線別碰（`scoreCut`：命中得分、碰雜質每次 −0.15；雜質離目標至少 1.7 個判定寬度）。倒數 3 秒、即時判定（完美／不錯／勉強／空揮）、連擊提示，支援空白鍵與觸控。舊的排順序關卡函式（`scoreSequence`）保留但不再使用。
2. **烹調／試作／彩排／演練**：玩法由手法素材決定（`actKind`）——節奏（時機窗口）或維持（拖曳或 ←／→ 鍵保持在甜蜜帶，即時顯示是否在區間內）。
3. **調味／微調（調配）**：先依線索選最多 2 個特性 ±1，再逐項即時「調配」——光標來回掃（三角波，`dosePos`），在甜蜜帶（`DoseLevel.bands`，難度越高越窄）按下「加入」才生效；沒按準或逾時（4.5 秒）就不加。伺服器用第 3 個關卡種子重算，特性依代號排序、第 i 個名額對應第 i 個輸入（`doseHit`）。可能因此過量變 `flop`。
- 分數＝備料 40%＋操作 60%；`bonus`＝floor(分數×3.5) 夾 0–3，當作廚藝經驗加到 `resolveJob` 的等級；品質另加 round(分數×3)。
- 難度＝素材公開單價總和（`playDifficulty`，0–8），越貴窗口越窄。
- 簽名＝素材組合＋`tweakKey`：同組素材、不同微調算不同組合；「原創／失敗」過的組合只有**加了微調**才能再試。

## 科技（`shared/src/game/techPlay.ts`、`server/src/sim/tech.ts`、`client/src/screens/Tech.tsx`）
1. **立項**：速度／嚴謹／節約三條滑桿（總和 100，`normalizePlan`）→ 時間倍率、費用倍率、起始品質點（`planEffects`）。不給 `plan` ＝標準配置，時間費用照表定價。
2. **實驗事件**：進度到 50% 出現（異常資料／設備故障／意外發現／團隊狀況，`TECH_EXPERIMENTS`），玩家選處理方式（有成本、風險機率）；逾期（最多 144 tick）走最保守的預設，沒錢走免費選項。
3. **數據判讀**（選填）：三組帶雜訊折線判斷下降／持平／上升（`makeAnalysisLevel`／`scoreAnalysis`），最多 +1.2 品質點，答案隨 `techExperiment` 指令送出。
4. **結案分級**：`techGrade(points, luck)`——勉強完成／優良（≥1.8，退 10% 費用、直營店廚藝經驗 +1）／突破（≥3.2，退 30%、經驗 +2、在地口碑 +0.4）。效果本身（`fx`）不隨等級改變，避免數值失控。
- 取消研發仍退 `TECH_CANCEL_REFUND`。

## 前端
- 工坊：「🎮 開始…」進入三關流程（可略過單關、可「直接自動開始」）；`Workshop.tsx` 的「自動」鈕不經小遊戲。手機版同一套（觸控／滑鼠）。
- 科技：研究室卡片顯示速度／嚴謹／節約、品質點、實驗事件卡（內含折線判讀）；科技卡「立項」展開資源分配。

## 測試
`server/src/play.test.ts`（計分決定性／偽造輸入夾限／重放等價／舊存檔）、`client/src/ui.test.tsx`（PlayFlow、Tech 立項與實驗）。

## 等待期中途事件（2026-11-29）
研發進度過半（`MID_AT`）時，工坊會出一件狀況（設備不穩、素材品質參差、突然有靈感、同事試味道有意見；資料在 `shared/src/game/workshopMid.ts`，4 件、各 2 個選項）。
- **不暫停時間、不用小遊戲**：玩家看到事件卡可以處理（`resolveRndEvent { shopId, optionId }`），沒處理到研發結束時自動採預設選項（不花錢；有風險的預設照風險結算），所以「不玩也能玩」。
- 影響只有這次研發的有效廚藝經驗 ±1（`RndJob.mid.skill`，進 `resolveJob` 的 `chefLevel + play.bonus + mid.skill`），不改效果本身。花錢的選項要研發費的 10–30%，資金不足不能選。
- 決定性：哪件事件由 `hash(seed, job.uid)` 決定；風險用 `(seed, startTick, option)` 的雜湊，不抽引擎亂數流，重放結果相同。
- 新欄位 `RndJob.mid?` 是可選，舊存檔與沒觸發的研發沒有；畫面在「研發進行中」卡片裡顯示。測試在 `server/src/workshop.test.ts` 的 “research mid-wait event”。

## 未做
租賃協商小決策（非必要，留待之後）。
