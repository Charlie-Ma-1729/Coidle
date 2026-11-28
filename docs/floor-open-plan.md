# 樓層空地化與店面可變大小（階段 C 設計）

## 實作狀態（2026-11-28：規則、伺服器、畫面都已做；旗標預設關，尚未部署）

**已做（旗標預設關，舊存檔與舊行為完全不變）**
- **模型簡化（和下面 §1 的草案不同）**：**格＝slot**。大店開在一個 slot 上，並**吸收**同區 1 個空的 slot（變成 `span: 0` 的墓碑，墓碑記 `into`＝吸收它的店）；樓板面積 `floorArea` ＝ 同區 slot 的 span 總和，resize／拆除只在店與墓碑之間搬格子，**面積不變，只有擴建 +1**，所以不需要 `floorExtra`、`expandZone` 不用改（`expansionsOf` 改成面積差，舊存檔結果相同）。
- `shared/src/game/floor.ts`：`slotSpan`、`liveSlots`、`floorArea`／`usedCells`／`freeCells`、`planResize`／`applyResize`（client／server 共用的可放置判定）、`availableSpans`、`FOOTPRINT_BY_CATEGORY`、`SPAN_FACTOR`（容量 1／2／3.6）、`spanDraw`／`spanBasket`／`spanCostFactor`／`spanWageFactor`（大店經濟，見 balance-report「大店」第二版）、拆除費 25%、冷卻 1 遊戲日、`mergeCapacity`（版面上限）。
- 指令：`buildShop` 可帶 `span`／`cells`（旗標關或業態不允許就拒絕）、新增 `demolishShop`；建造費與翻新費 ×格數、工期 ×√格數、人事與容量 ×`SPAN_FACTOR`、固定資產評價 ×格數；完工時店帶 `span`。
- 旗標：`flags["feature:open_plan"]`（管理室「商場旗標」可對單一商場開，先 sandbox）；環境變數 `OPEN_PLAN_ENABLED=1` 對全服開。
- **只開放 1／2 格**。4 格（2×2）要背靠背房間合併，而機器人模擬顯示 4 格邊際營收近乎零（見 balance-report「大店」），暫不開放；型別與係數保留，`planResize` 對 4 回「目前不開放」。
- **版面上限（`mergeCapacity(n)`）**：2 格店必須是平面圖上「同一排、同一群（隔著中庭的左／右）內左右相鄰」的兩個位置，所以一區能併幾間受版面限制（8 格以內的壓縮型最多 4 間；10 格島型 2 間；14 格 3 間…）。超過就拒絕（「這一區的版面最多併 N 間大店」）。擴建若會讓版面從壓縮型變島型、放不下現有大店，`expandInfo` 會擋下並提示先拆一間。
- **平面圖（client）**：`layoutFloor(slots, { into })` 先用 `assignGrid` 把「店＋墓碑」安排到相鄰的位置對（離中庭近的先用；沒有大店時與原排法逐位相同，有測試），再併成一間寬房間（`RoomRect.units`＝2、`w`＝16）。墓碑排不進位置對（理論上不會，防呆）就標 `dead`，不能點。**注意：有大店時，同一區其他店的位置可能因此重排**（重排後客人與人潮會重新生成）。
- **畫面**：寬房間貼圖由單格貼圖複製並蓋掉中間隔牆（`sprites.ts` 的 `widen`，空地、鷹架、店面都支援）；每格寬各有一組店員、客人在任一格寬的陳列區逛；選取框、燈光、氣泡、標籤、走道盆栽都跟著寬度；`BuildSheet` 旗標開時可選大小並提示併入相鄰空格；`ShopSheet`（直營）旗標開時有「拆除重建」（確認框列出拆除費與冷卻）。示範頁 `#stage-demo` 的 1F「電玩橫丁」是 2 格寬的大店。
- **舊 client 不必另做握手**：既有的 `updater.ts`（比對 `/version.json` 的 BUILD_ID，分頁在背景立刻重載、前景倒數）已涵蓋。上線順序：先部署新版 → 等 client 都更新 → 再開旗標（舊 client 看到墓碑會畫成空地）。
- 測試：`server/src/floor.test.ts`（舊存檔 span 缺＝1／遷移不寫新欄位、旗標關行為不變、吸收與面積守恆、指定格子與 `into`、版面上限、拒絕、拆除費與冷卻、決定性與分段推進等價）；`client/src/stage/floorplan.test.ts`（每個 n 都能併到 `mergeCapacity`、寬房間不重疊不蓋中庭有路線、沒有大店時排法不變、shared 與平面圖的位置對數一致）。

**sandbox 實測（2026-11-28，鏡像資料夾的獨立 DB＋獨立伺服器 port 2331，不碰正式資料；旗標以管理室 API `POST /api/admin/malls/:id/flags` 開）**
- 旗標關：`buildShop span:2` 回「大店尚未開放」✓。開旗標後可建；2 格店花 `buildCost×1.7＋許認可規費`（超市 1,375,000）、樓板面積不變（10→10）、墓碑記 `into` ✓。
- 離線補跑完工（伺服器時鐘撥快）：大店 `span=2`、補貨規則放大（min 200／target 700／預算 374k）、起始庫存放大 ✓。
- 版面上限：10 格最多併 2 間；擴建到 11 格後可再併第 3 間（`mergeCapacity(11)`＝3）✓，與單元測試一致。
- 拆除：費用 ¥340,000＝超市 80 萬×1.7×25% ✓，墓碑格還成空地、該格 `shopId` 清空 ✓；畫面上的確認框列出費用與冷卻 ✓。
- 畫面（真實伺服器資料）：施工中顯示寬鷹架 ✓；完工後是連通寬房間（兩組店員、客人）✓；店面面板顯示「2 格大店」「大店解鎖客層」、翻新費用 ×1.7 與「拆除重建」按鈕 ✓；空地的招商視窗對超市預設 2 格、列出大小選項與解鎖客層 ✓。拆除後版面重排（其他店位置會動）符合預期。
- **實測抓到的問題（已修）**：`RealShopPanel`（舞台上的店面面板，不是 `ShopSheet`）原本沒有拆除按鈕、翻新費用沒乘規模係數 → 已補。
- 沒覆蓋：同層連拆的冷卻（單元測試有，API 實測時第二間大店還在施工）、舊 client 看到墓碑（只靠 updater 重載）、手機版面。

**還沒做**
- 規劃模式的「預覽哪一格會被併進來」與手機版抽屜：現在是在 `BuildSheet` 選業態＋大小，自動併最近的空格（或 `cells` 指定）。
- 4 格（2×2）大店、跨區重排的過場動畫。
- 實機（正式環境、sandbox 商場）的灰度驗證：先用管理室對一座 sandbox 商場開旗標，確認建造、完工、拆除、擴建擋下、舊 client 更新這幾條流程。

> 狀態：**設計草案，尚未動工**。前置：階段 0（設施框架）、A（地下停車層）、B（跨兩層電影院）上線穩定後再做。
> 來源：大型設施重做計畫的「階段 C」。本文件只定方向與介面，數字（成本、容量係數）一律用機器人模擬調，不在這裡拍板。

## 前提（設計更正）

需要大型空間的設施（電影院、停車場等）**一律新增自己的樓層**，不佔、不壓縮原本商業樓層（如 `ent` 娛樂層）的店面格：電影院＝專屬影城 2 層、停車場＝地下停車層，由 `facilities` 產生。因此本文件的「空地樓層」**只管原有 8 個商業樓層**（b1／f1／ent／cul／life／dining／plaza／biz）；設施樓層不走 `Slot`／`span`／`floorArea`，也不進規劃模式的空地。`liveSlots`／`floorArea` 等 helper 不需處理設施樓層。

## 0. 目標與不做的事

目標：
1. 樓層從「固定幾個一樣大的店面格」變成「一塊有面積的樓板」，店面佔 1／2／4 格。
2. 大型業態（B 類）真的比小店大，容量與成本跟著大小走。
3. 玩家可在規劃模式自己決定放什麼、放哪、多大；可拆除重排（有成本與冷卻）。
4. **全程熱更新**：舊 client 連著新 server 約 5 分鐘不能壞（見 §5）。

不做：
- 不做自由像素擺放，只做格（cell）對齊。
- 不做跨層店面（跨層是階段 B 設施的事）。
- 不改「4 小時＝1 遊戲日」、不改 `PRICE_TOLERANCE` 等已定案平衡。
- 不改 `Slot.id === 陣列索引`、`Shop.slot`、`BuildTask.slot` 的意思。

## 1. 資料模型（`shared/src/game/types.ts`、`data.ts`）

### 1.1 `Slot`
現況：`Slot { id; zone; shopId }`，一個 slot＝一格＝一間 128×96px 的房間。

新增**可選欄位**：

```ts
export interface Slot {
  id: number;            // 仍等於 s.slots 的索引，永不改、永不重排、永不刪除
  zone: ZoneId;
  shopId: string | null;
  span?: 0 | 1 | 2 | 4;  // 佔幾格；缺＝1；0＝已拆除的墓碑（見 1.3）
  cell?: { x: number; y: number }; // 樓板格座標（左上角）；缺＝由排版器決定
}
```

規則：
- **缺 `span`／`cell` 一律視為 `span 1`、位置自動排**：舊存檔不需要遷移就能跑，舊行為（`compact`／`island` 版型）完全不變。
- 讀取一律走 helper：`slotSpan(slot) = slot.span ?? 1`，不要在各處直接寫 `?? 1`。
- 不升狀態版本（CLAUDE.md 慣例：可選欄位＋預設值）。`migrate.ts` 不需動，除非日後要「補 `cell`」，那時才升 v14 且只做補欄位。
- `span` 只允許 1／2／4（0 僅墓碑）。`cell` 只在 C2 玩家客製才寫入（見 §6 分期）。

### 1.2 樓板面積
現況：樓板大小＝該區域 `slots` 數（基礎 `ZONES[].slots`＋擴建次數）。

新概念：**樓板面積（格）`floorArea(s, zoneId)`**＝`ZONES[].slots`＋擴建增加的格數。
- 舊存檔：面積＝現有 slot 數（每個 slot 一格），與今天完全相等，無需遷移。
- 已佔用格 `usedCells = Σ slotSpan(slot)`（`zone` 相同、`span !== 0`）；空地 `freeCells = floorArea − usedCells`。
- 不變量（測試要鎖）：`usedCells ≤ floorArea`，且 `floorArea ≤ MAX_LOTS` 之類的硬上限（現為 14 格/層，見 §3.1）。
- 面積的來源要能算出來而不是另存一份，避免兩份狀態不同步：
  - 開放前（§5 旗標關）：`floorArea = slots.filter(zone).length`（舊公式，每個 slot 一格、span 恆為 1）。
  - 開放後：新增可選欄位 `MallState.floorExtra?: Record<ZoneId, number>`＝擴建「額外格數」，`floorArea = z.slots + (floorExtra[zone] ?? 0)`；舊擴建留下的空格（`shopId: null` 的 slot）照舊計入，由 `expansionsOf` 的舊算法補回（見 1.4）。

### 1.3 拆除與墓碑
`slot.id === index` 不能刪元素，所以：
- 拆掉一間店後，該 slot 留著；若玩家選「改成空地」，把它設成 `span: 0`（墓碑），`shopId: null`、`cell` 清除，格子還給 `freeCells`。
- 墓碑不顯示、不入排版、不入人潮路徑、不入 `patrol`／`weatherZoneFactor`／稅務資產估值。凡是 `s.slots.filter(zone)` 的地方都要改成「排除墓碑」的 helper（`liveSlots(s, zone)`）。**這是階段 C 最容易漏的地方**，用 Grep 掃所有 `s.slots` 使用點（`sim/`、`world/`、`tax`、`bots/`、client `adapter`）逐一確認。
- 重新放置時，優先重用同區域的墓碑（把 `span`／`shopId` 填回去），避免陣列無限長；沒有墓碑才 `push` 新 slot（`id = s.slots.length`）。
- 墓碑數量不設硬上限，但拆除有冷卻（§4.4），實務上不會爆。

### 1.4 擴建 `expandZone`
現況（`server/src/sim/commands.ts` `expandZone`）：付 `expandInfo().cost`，`s.slots.push({ id: length, zone, shopId: null })`；`expansionsOf = 區域 slot 數 − 基礎 slot 數`。

改成「擴建樓板面積」：
- 一次擴建增加 **1 格**（與舊行為同樣的面積，成本與等級門檻沿用 `expandCost/expandMinLevel`，數字不動）。
- 開放後：`floorExtra[zone] += 1`，**不再 push slot**；空地在規劃模式才變成店。
- `expansionsOf(s, zone)` 要改成：`(z.slots 以外的面積) = floorArea − z.slots`，而不是數 slot（因為大店會讓 slot 數小於面積）。舊存檔因為 `floorArea = slot 數` 所以結果不變；測試要證明新舊算式在舊存檔上相等。
- `maxExpand` 上限不變（仍是 `ZONES[].maxExpand`）。是否允許「多格一次擴」（例如一次 +2）列入待決，預設不做。
- 擴建仍是土建工程，費用計入固定資產稅評價額（`tax.ts` 現有邏輯不變）；樓板面積比 slot 數更貼近評價，稅務估值改看 `floorArea`＋店面等級，需要補測試。

## 2. 業態 `footprint`（規則）

`CategoryDef` 新增可選欄位：

```ts
footprint?: { options: (1 | 2 | 4)[]; default: 1 | 2 | 4 };
```

- 缺＝`{ options: [1], default: 1 }`，所有現有業態行為不變。
- **容量**：`shopCapacity` 乘上 `spanFactor(span)`。建議 `span 1→1.0、2→1.8、4→3.2`（略低於線性，避免「全部做大店」變成最優解；數字待機器人調）。注意 `ShopSheet.tsx:140` 有一份重複的容量公式，要一起改成共用函式。
- **成本**：建造費、翻新費、固定資產評價、租金／租賃都隨 span 放大（建議建造費 ×span，不打折），工期 ×√span 以免大店等太久；數字待調。
- **營收不能線性放大**：大店的需求仍受 `demand`、`priceAcceptance` 約束，容量變大只放寬「排隊流失」，不會憑空多出客人；這樣「全部放最大」不會成為必勝解（同 `PRICE_TOLERANCE` 的精神）。
- 營業執照、供應、稅務仍以業態為單位，不隨 span 改。
- 大小要在「選業態之後、放置之前」決定；已開店的店要改大小＝走「拆除重排」（不做原地擴張，避免施工中的店還要改幾何）。

## 3. 排版（`client/src/stage/floorplan.ts`）

### 3.1 現況與限制
- `layoutFloor(slots: number[], opts)`：`MAX_LOTS = 14`；`rowCounts(n)` 依格數決定 `compact`（≤8，兩排一條走道）或 `island`（4 排兩條走道）；每排左右對稱分在中庭兩側，每格 `ROOM_W = 8` 格寬、`ROOM_H = 6` 高；`serviceBlocks` 是排不滿時外側補的廁所／機房。
- `RoomRect` 已有 `w/h`，但實際只放 `ROOM_W×ROOM_H`；`sig` 只含 layout、左右欄數、每排計數、兩端類型。

### 3.2 新介面
輸入由 `number[]` 改成：

```ts
interface LotInput { slot: number; span: 1 | 2 | 4; cell?: { x: number; y: number } }
layoutFloor(lots: LotInput[], opts: FloorPlanOptions): FloorPlan
```

- 舊呼叫（只傳 slot 編號）由 adapter 包成 `span: 1`，輸出必須與舊版**逐欄位相同**（`floorplan.test.ts` 的既有 case 是回歸基準，不能改期望值）。
- `rowCounts`／`serviceBlocks` 改成**面積排版**：以格（cell）為單位，先算每排可放的格寬，再把店依序塞進去：
  - `span 1`：1 格寬 × 1 排深（128×96）。
  - `span 2`：2 格寬 × 1 排深（256×96）；仍是單門，門開在中點。
  - `span 4`：`compact` 版型＝4 格寬 × 1 排深；`island` 版型內排＝2 格寬 × 2 排深（把 I1、I2 合併成 256×192，**兩側各有一道門**）。為避免佔掉整條走道的門面，4 格店不排在 `T`／`B`（靠外牆）以外的位置時，仍保證至少一條走道連得到。
- 版型選擇改看「面積」而非店數：`area = Σ span`（含空地格），`compact`／`island` 門檻仍是 8 格；`MAX_LOTS` 概念改為 `MAX_AREA`（先沿用 14，等玩法需要再議）。
- 空地格：未佔用的格以「空地」`EmptyLot` 畫出（現有 `emptyCache` 已有空房間貼圖，沿用並加尺寸）。`cell` 缺席時空地排在每排尾端（與今天「未開店的 slot」位置一致）。
- **有 `cell` 的店**（C2）：按 `cell` 固定位置排，其餘自動補位；位置衝突（兩店重疊／超出樓板）時，`layoutFloor` 不丟錯，把違規的店降級成自動排並回傳 `warnings`，避免壞資料讓整層畫不出來（server 端仍要在指令驗證時擋掉，雙重保險）。

### 3.3 路徑圖與多門
- 目前 `routeTo(plan, entrance, slot)` 以 `room.door`（單一點）為終點；`Graph` 以走道行走線＋三條連接段（left／atrium／right）建圖。
- 改為 `RoomRect.doors: Pt[]`（至少一個，`door` 保留為 `doors[0]` 以相容舊測試與舊程式碼）。`routeTo` 對多門取**最近**的一道（以入口到各門的路徑長度比較）。
- 長邊房間（span 2／4）的人潮停留點要沿著房間寬度分佈，不要全擠在門口：`crowd.ts` 的「店內停留位置」改取房間內 `w` 範圍的隨機相對座標。
- 兩道門的店兩側走道都連得到；走道圖要保證連通（`adapter.test.ts` 加「任何排法下每間店至少一道門可達」性質測試）。
- 圖的節點數會增加（每道門一個節點），`routes` 的 Map key 與快取量要確認不爆（目前每層最多 14 格）。

### 3.4 `sig` 與快取鍵
- `FloorPlan.sig` 加入每間店的 `span` 與 `cell`（例如 `…-${rooms.map(r=>`${r.slot}${r.w/ROOM_W}`).join(".")}`），否則「同店數、不同大小」會命中舊的背景貼圖（`background.ts:255` 以 `key|plan.sig` 快取）。
- `model.ts` 的 `planKey(floor)` 目前只拼 slot 編號與出入口條件，要加 `span`／`cell`；`lotSignature` 不需要（外觀簽名只看狀態／原型／顏色／進度），但空地 ↔ 店的轉換要觸發重排，所以走 `planKey`。
- `StageFloor.lots[]` 新增可選 `span?`、`cell?`（由 `adapter.ts` 從 `Slot` 帶入；缺＝1）。

## 4. 畫面與規劃模式

### 4.1 尺寸全面相對化
現況 `ROOM_PX_W = ROOM_W * TILE`（128）、`ROOM_PX_H = 6 * TILE`（96）在 `sprites.ts`（40 處引用）、`scene.ts`（12 處）、`furniture.ts` 等硬寫。
- 一律改成 `room.w * TILE`／`room.h * TILE`（由 `RoomRect` 取）；`ROOM_PX_W/H` 只留作「單格基準」常數，不再用於任何房間繪製。
- 房間貼圖快取鍵由 `${archetype}_${color}_${row}` 改為 `${archetype}_${color}_${row}_${w}x${h}`（`sprites.ts:356`）。空房間 `emptyCache`（`sprites.ts:392`）同理加尺寸。貼圖記憶體：4 種尺寸 × 原型數 × 顏色數，需估計上限（可限制「大店」只有 2 種配色）。
- 家具、店員、氣泡位置改為相對座標（`0..1` 乘 `w`／`h`）；大房間家具數隨面積增加而非放大圖。現有 `furniture.ts` 的擺設表需要每業態補「大房間」版（可先用重複平鋪 1 格擺設的方式湊，後補專用）。
- `scene.ts` 中以 `ROOM_PX_W` 計算的暗化遮罩、進度條、旗標位置（約 384–545 行）全部改用該房間的寬高。
- `background.ts:337` 以 `o.x + ROOM_W === room.x` 判斷相鄰（畫隔間牆／柱）要改成以 `o.x + o.w === room.x`。

### 4.2 規劃模式 UI
入口：樓層畫面右上「規劃」按鈕，進入後暫停人潮動畫的互動（不暫停模擬）。
流程：**點空地 → 選業態 → 選大小 → 預覽 → 放置**。
1. 點空地：高亮可放置的格；樓板外／被佔用的格不可點。
2. 選業態：沿用 `BuildSheet` 的清單（過濾 `facility` 業態），顯示該業態可選大小與解鎖狀態。
3. 選大小：只列出此處放得下的 span（用 §3 排版器試排）；顯示成本、工期、容量倍率。
4. 預覽：半透明房間疊在樓板上，顯示門的位置與走道連通性警告。
5. 放置：送 `buildShop { zone, slot?, span, cell? }`；成功後進入既有的施工流程。
- 手機版（瀏覽器窗格寬約 677px 會觸發）：改成底部抽屜，三步驟分頁，不做拖曳。
- 「拆除重排」：長按（桌面右鍵）已有店 → 「拆除」；若店營業中，需先走既有的歇業流程。

### 4.3 指令（`shared/src/game/commands.ts`、`server/src/sim/commands.ts`）
- `buildShop` 新增可選 `span`、`cell`；缺＝1／自動找空格（舊 client 行為）。
- 新增 `demolishShop { slot }`（拆除→空地）與（C2）`moveShop`（若不做就用拆＋建組合）。
- 驗證（server 為準）：span 在業態 `footprint.options` 內；此區域 `freeCells ≥ span`；`cell` 在樓板內、不與其他店重疊、對齊該排；放置後每間店至少一道門可達（server 也要有一份簡化版連通檢查，或把「可放置判定」寫成 `shared` 純函式讓兩邊共用，**建議後者**）。
- `describeCommand`（`mallService.ts`）要補中文描述，稽核與日誌才不會出現空白。

### 4.4 拆除重排的成本與冷卻（建議值，待調）
- 拆除費＝店「建造成本 × 25%」（含裝潢報廢，不退款）；已存貨依既有「關店清倉」規則處理，金額守恆走日帳。
- 該區域**重排冷卻**：每次拆除後，該層 1 個遊戲日內不可再拆（防止玩家用拆建洗位置套利或洗掉違規／負面狀態）。
- 拆除中的店、施工中的店不可拆（先完成或取消）。
- 拆除會讓熟客、巡店問題、行銷活動、供應契約中該店的綁定失效，要列清單逐一處理（見 §7 測試）。

## 5. 熱更新策略（風險最高）

背景：`update.sh` 重啟 server 時玩家在線，舊 client 會連著新 server 約 5 分鐘（`client/src/updater.ts` 以 `__BUILD_ID__` 比對 `/version.json`，不同才提示更新），期間舊 client 完全不認得 `span`／`cell`／`floorExtra`。

分三步上線，**每步獨立部署、不累積成一次大改**：

**步驟 1：資料與規則先上，行為不變（旗標關）**
- server＋client 同版部署：型別、helper（`slotSpan`、`liveSlots`、`floorArea`）、排版器新介面、貼圖鍵、`sig`／`planKey` 都改好，但 **server 永遠只產生 `span` 缺／1 的 slot**，`expandZone` 仍走舊的 push slot。
- 驗收：新 client 在舊資料上畫面與舊版像素級相同（`floorplan.test.ts` 回歸）。
- 此時舊 client 與新 client 看到同樣的資料，沒有任何風險。

**步驟 2：等舊 client 全數更新，再用旗標啟用**
- 新增伺服器端旗標（建議 `OPEN_PLAN_ENABLED`，環境變數或 `flags` 設定；每商場可另有 `flags.openPlan` 做灰度／sandbox 先試）。
- 開旗標前條件：步驟 1 已上線 ≥ 一天（遠大於 5 分鐘），並看管理室指標確認連線的 client 皆為新 `BUILD_ID`。若 client 會在握手時回報 `BUILD_ID`（目前沒看到，需確認；若沒有，可加一個可選欄位），server 可以**拒絕舊版 client 的「改版型」指令**並回友善中文訊息「請重新整理頁面以使用新功能」（不是 500）。
- 旗標開啟後才允許：`span > 1` 的 `buildShop`、`floorExtra` 擴建、`demolishShop`。

**步驟 3：舊 client 的殘餘相容**
- 舊 client 若在旗標開啟後仍連線：看到的 slots 少於實際面積（一間 span-2 店被當成 1 格、空地不見），**不會壞但畫面不完整**；它送 `buildShop`（無 `span`）時 server 仍能處理（自動找空格、span 1）；它送 `expandZone` 時 server 友善處理（等同 +1 格面積，不 push slot）。
- 任何伺服器回應給舊 client 的狀態，`slots` 照舊只含 `id/zone/shopId`；新欄位走 `MallService.pub()`，且要進公開資料白名單（`world.test.ts` 白名單測試補 `span`、`cell`、`floorExtra`，墓碑 slot 的處理需明確：對外不暴露拆除歷史，只暴露存活 slot）。
- 不能在步驟 2 之前讓任何商場出現 `span > 1`，因為一旦存檔裡有了，**回滾 server 版本就會讓舊程式把大店當 1 格**；回滾時資料不損毀（欄位只是被忽略），但要寫進回滾手冊：旗標一關，server 要能「安全處理已有 span 的存檔」（照常模擬，只是不再接受新大店）。
- 決定性：模擬引擎只看 slot 的 `span`／面積這些存檔欄位，不看真實時間；同 `(seed, tick)` 同結果不能被排版（client 純視覺）影響，**排版結果不得回饋進模擬**（人潮是 client 的演出，模擬用容量與需求公式）。

## 6. B 類大店與建議 footprint

`footprint.options` 是這個業態允許的大小，`default` 是 BuildSheet 預選值。階段 C 才實際啟用（步驟 2 之後）；啟用前這些業態仍是 span 1。

| 業態 | 所在區 | options | default | 理由 |
|---|---|---|---|---|
| `grocery` 超市 | b1／f1 | 2、4 | 2 | 貨架需要寬度；4 格＝大型量販，容量大但需求受客群限制 |
| `gym` 健身房 | life | 2、4 | 2 | 器材區＋更衣；4 格可加課程教室 |
| `kids_play` 兒童樂園 | life／ent | 2、4 | 2 | 遊戲區面積與安全動線；4 格＝大型室內遊樂場 |
| `arcade_vr` 電玩／VR | ent | 2、4 | 2 | 機台數隨面積；VR 區需要大空間 |
| `claw` 夾娃娃機 | ent | 1、2 | 1 | 小型業態，2 格＝夾娃娃機專區 |
| `karaoke` KTV | ent | 2、4 | 2 | 包廂數隨面積；`ROYALTY_RATE` 2.5% 維持以營收計 |
| `observatory` 展望台 | plaza | 2、4 | 2 | plaza 基礎只有 4 格，4 格＝整層，需先擴建；預設 2 以免獨佔 |
| `electronics` 電器旗艦 | cul | 2、4 | 2 | 展示面積；4 格＝旗艦店 |
| `camera` 相機店 | cul | 1、2 | 1 | 中小型，2 格含攝影棚展示 |
| `art_gallery` 藝廊 | cul | 2、4 | 2 | 展間數隨面積 |

注意：
- A 類（停車場、電影院、旅館、保齡球、會議中心／活動場地）走**設施框架**（階段 0），且電影院、停車場有自己的樓層，不佔商業樓層的格，不在這張表。
- 每區面積有限（例：plaza 基礎 4、biz 基礎 6、ent 基礎 7；電影院搬到專屬樓層後 ent 不再被它佔用），大店會直接壓縮該層可開店數；所以平衡要同時看「單店收入」與「單層總收入」。
- 預設 `default: 2`（而非 1）會讓 B 類新店一出現就變大；**步驟 2 啟用前，舊店一律是 span 1**，不自動放大，避免一夜間改變既有商場平衡。是否讓舊存檔的 B 類店「免費升級」成 span 2：**不做**，玩家要靠拆除重排。
- 品牌、名稱一律虛構；若 footprint 文案提到地名，只限股市內容例外（見 `CLAUDE.md`）。

## 7. 平衡與測試影響

### 7.1 現有測試
- `client/src/stage/floorplan.test.ts`（14 處引用 `layoutFloor`／`rowCounts`／`ROOM_W`）：
  - 既有 case 用 `span 1` 重跑，**期望值不改**＝回歸基準。
  - 新增：span 2／4 的排版、`sig` 含 span、多門可達性、`cell` 衝突降級＋`warnings`、面積不足時拒絕。
- `client/src/stage/adapter.test.ts`（`MAX_LOTS` 上限、入口類型）：改測 `usedCells ≤ floorArea ≤ MAX_AREA`；包含墓碑 slot 的 `adapter` 輸出不含該格；`StageFloor.lots` 的 `span`／`cell` 傳遞。
- `client/src/stage/crowd.test.ts`（12 處 `layoutFloor`、`roomOfSlot`）：多門店的人潮可進出、停留點落在房間範圍內、span 2／4 房間的 `roomOfSlot` 回傳正確寬高；舊 span 1 case 不變。
- `client/src/ui.test.tsx`：規劃模式（點空地→業態→大小→放置）與手機版抽屜。
- `shared` 的 `expansion` 測試：新舊 `expansionsOf` 在舊存檔上相等；`floorExtra` 累加；上限。
- `server/src/sim` 指令測試：`buildShop` 帶 span 的成本／工期／容量、`demolishShop` 的金錢守恆（走日帳、不憑空生錢）、冷卻、舊 `buildShop`（無 span）仍可用、舊 `expandZone` 友善處理；同 `(seed, tick)` 決定性（分段推進＝一次推進）；`world.test.ts` 公開資料白名單。
- **遷移冪等**：載入舊存檔不應寫入任何新欄位；`migrateState` 跑兩次結果相同。

### 7.2 機器人與平衡
- `server/src/bots/` 的策略（`diligent`／`lazy`／`periodic`／`chaotic`）目前只會 `buildShop`／`expandZone`：
  - 步驟 1：行為不變，用 `npm run sim` 比對改版前後各策略的商場收入，應**完全相同**（決定性）。
  - 步驟 2：給 `bots.ts` 加「是否選大店」的策略參數（例如 `bigShop: 0|0.5|1`），用 `catsweep.ts` 類腳本掃 B 類業態的 span×定價倍率，確認：
    1. 大店**不是**無腦最優（單位面積收益 ≤ 小店，或至少在飽和後收斂）；
    2. 全面漲價仍不是最優解（`PRICE_TOLERANCE` 1.2 倍已驗證，維持）；
    3. 各業態最佳定價倍率仍在 ×1.2 附近。
  - 擴建改成「面積」後，確認擴建 ROI 與舊版相近（成本與格數同量級），避免被大店放大後變成必買。
- 結論寫進 `docs/balance-report.md` 對應章節（先更新開頭「速查」）。
- 熱更新演練：在 Windows 鏡像（`scripts/mirror.ps1`）以正式資料庫副本（複製到 scratchpad、唯讀）載入，確認所有商場在步驟 1 後 `floorArea`／`usedCells` 與舊 slot 數一致、資金與營收不變。

## 8. 分期建議

| 期 | 內容 | 風險 | 前置 |
|---|---|---|---|
| C0 | 設計確認；`liveSlots`／`slotSpan`／`floorArea` helper＋全部 `s.slots` 使用點掃描（只重構、不改行為） | 低 | A、B 上線穩定 |
| C1 | 步驟 1（旗標關）：排版器新介面、尺寸相對化、貼圖鍵／`sig`／`planKey` | 中（畫面回歸） | C0 |
| C2 | 步驟 2：啟用 span（自動排版，無 `cell`）、B 類 footprint、`expandZone` 改面積 | 高（平衡、熱更新） | C1 上線 ≥ 1 天 |
| C3 | 規劃模式 UI、`cell` 玩家擺放、`demolishShop`、冷卻 | 中 | C2 平衡確認 |

## 9. 待決定

1. 4 格店在 `island` 版型是否一律佔「內側兩排合併」（本文預設）？還是也允許外側 4 格橫排？
2. 擴建是否允許一次 +2 格？（預設：不允許）
3. 拆除費與冷卻的數字（預設 25%／1 遊戲日）。
4. 舊存檔的 B 類店是否提供一次性免費升級成 span 2？（預設：不提供）
5. `MAX_AREA` 是否仍為 14，還是為了大店放寬（會影響 `island` 版型寬度與地圖捲動）？
6. 步驟 2 的旗標是全服統一，還是先對 sandbox／志願商場灰度？（預設：先 sandbox，再全服）
7. 握手時是否讓 client 回報 `BUILD_ID`，以便 server 精準拒絕舊 client 的新指令？（需要小改 `ws.ts`／`api.ts`）
