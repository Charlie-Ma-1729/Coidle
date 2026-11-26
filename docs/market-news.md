# 股市新聞內容庫（market-news）

股市 v2 的「消息面」文案庫：由 `anthropic/claude-haiku-5.5` 一次性離線生成，**逐則人工（Claude）審核**後存成
`shared/src/game/market/news.data.json`，永久入庫、進 repo。遊戲執行期不呼叫任何模型；引擎（`shared/src/game/market/news.ts`
的 `NewsEngine`）只依「種子＋遊戲日＋標的」從庫裡決定性地挑文案，庫沒有符合條件的文案時退回內建短句。

## 檔案
| 檔案 | 用途 |
|---|---|
| `shared/src/game/market/news.data.json` | 內容庫本體（陣列、穩定 id、依 id 排序） |
| `shared/src/game/marketNewsSpec.ts` | 規格：39 個板塊、24 個公司原型、情境、覆蓋要求（生成腳本與測試共用，純資料） |
| `shared/src/game/market/newsPool.test.ts` | 入庫驗證：格式、佔位符、長度、傳聞配對、情境 id、覆蓋矩陣、內容守則 |
| `server/src/ai/marketnews.ts` | 生成與審核工具（一次性腳本；金鑰讀 `OPENROUTER_TEST_KEY`，不印出、不寫檔） |
| `server/src/ai/validate.ts` | `checkText` 新增 `allowPlaces` 選項（只有這支腳本與測試使用） |

## Schema
```ts
interface NewsPoolItem {
  id: string;            // 例：co-earnings-p2-3a9f1c2e（種類縮寫-原型-語氣+幅度-內容雜湊前 8 碼）
  kind: "company" | "sector" | "macro" | "analyst" | "rumor" | "wrap" | "preopen";
  archetype: string;     // 見下表
  sentiment: "pos" | "neg" | "neutral";
  mag: 1 | 2 | 3;        // 1 輕微例行、2 明顯、3 重大（引擎依幅度決定價格跳動；文案不寫價格反應）
  headline: string;      // 12–40 字（佔位符以 8 字名字展開後計），不加句號
  body: string;          // 60–120 字，兩到三句，句號結尾
  when?: {               // 觸發條件，可組合；沒有 when ＝ 全年通用
    sectors?: string[];  // 板塊（只用 39 個板塊名；「金融」即金融（地方銀行））
    months?: number[];   // 目前庫內未使用
    seasons?: ("spring"|"summer"|"autumn"|"winter"|"rainy"|"typhoon")[];
    calendar?: string[]; // calendar.ts 的 CalendarTag 或 OBSERVANCES 的 id
    weather?: string[];  // clear / cloudy / rain / storm，以及溫度別名 hot（≥32°）、cold（≤4°）
    earnings?: boolean;  // true ＝ 只在決算期出現
    mood?: "up" | "down" | "flat"; // 收盤市況評語專用（依指數當日漲跌）
  };
  pair?: string;         // 傳聞三連組的互相指向（見下）
  weight: number;        // 抽選權重（目前全為 1；符合 when 的特定條件者引擎再乘 3）
}
```

### 佔位符
公司名一律用佔位符，**模型不得自己寫任何公司名**（庫內也沒有任何真實或虛構的公司名）：

| 佔位符 | 意義 | 可用於 |
|---|---|---|
| `{name}` | 這則消息的主角公司 | company / analyst / rumor（標題必須有） |
| `{peer}` | 同業的另一家公司（引擎從同板塊挑） | company / analyst / rumor（每則 ≤2 個，傳聞 ≤4 個） |
| `{sector}` | 板塊名稱 | company / analyst / rumor / sector |

全市場（macro）、收盤評語（wrap）、開盤前瞻（preopen）不得有任何佔位符。

### 傳聞三連組（`pair`）
每組三則：`rumor_<主題>`（傳聞，`pair`→證實那則）、`confirm_<主題>`（證實，`pair`→傳聞）、`deny_<主題>`（否認，`pair`→傳聞）。
引擎挑證實／否認時以 `pair === 傳聞 id` 過濾，所以兩者都指回傳聞。語氣與幅度：利多傳聞→證實＝pos、否認＝neg；利空傳聞→證實＝neg、否認＝pos；三則 `mag` 相同。

## 內容種類與觸發條件
`archetype` 是原型 id；引擎依 `kind`、`sentiment`、`mag` 先挑出候選，再用 `when` 過濾，符合特定條件者權重 ×3（通用者 ×1）。

| kind | archetype | 數量 | `when`／觸發 | 佔位符 |
|---|---|---|---|---|
| `company` | 24 個原型（見下），每個都有利多與利空 | 856 | 無條件（全年通用）；決算類（`earnings`、`guidance`、`dividend`）帶 `earnings: true`，只在決算期出現 | `{name}` 必須在標題；可用 `{peer}`（≤2）、`{sector}` |
| `company` | 9 個娛樂題材原型（見「娛樂題材」），每個都有利多與利空 | 305 | `sectors` ⊂ 娛樂／動漫出版／遊戲；部分帶 `months`／`calendar`／`seasons` | `{name}` 必須在標題；可用 `{peer}`、`{sector}` |
| `analyst` | `target_raise` `initiate_buy` `bull_thesis`（利多）、`target_cut` `downgrade_view` `bear_thesis`（利空）、`hold_view`（中性） | 98 | 無條件 | 同上 |
| `rumor` | `rumor_<主題>`／`confirm_<主題>`／`deny_<主題>`，12 個主題 × 利多利空 × 3 種幅度 | 216（72 組三連組） | 無條件 | 同上（`{peer}` ≤4） |
| `sector` | `sector_trend`（通用，每個板塊 × 利多利空 × 3 幅度） | 467 | `sectors: [板塊]` | 只可用 `{sector}` |
| `sector` | `sector_season`／`sector_calendar`／`sector_weather`（情境專屬，每個板塊 × 15 情境 × 利多利空） | 1,173 | `sectors` ＋ 下表情境 | 只可用 `{sector}` |
| `macro` | `central_bank` `fx` `economy` `oil` `disaster` `trade` `consumption` `global`（全年通用，各 18 則） | 144 | 無條件 | 無 |
| `macro` | `macro_season`／`macro_calendar`／`macro_weather`（情境專屬） | 60 | 下表情境（無 `sectors`） | 無 |
| `wrap` | `wrap_up`／`wrap_down`／`wrap_flat`（收盤市況評語） | 120 | `mood`（大盤當日漲／跌／平） | 無；文字不寫點數、成交量、季節或天氣 |
| `preopen` | `preopen`（開盤前瞻，樂觀／謹慎／中性） | 75 | 無條件；不提昨日漲跌 | 無 |


### 24 個公司原型
`earnings` 決算、`guidance` 財測修正、`dividend` 配息（以上三個綁決算期）、`product` 新品與服務、`contract` 合約與訂單、`plant` 設備與工廠、`quality` 品質與召回、`exec` 人事、`rating` 評等、`holder` 大股東異動、`expansion` 展店與擴張、`cost` 成本與原料、`capital` 資本政策、`partnership` 合作結盟、`legal` 訴訟與處分、`supply` 供應鏈、`tech` 技術與系統、`brand` 品牌與口碑、`labor` 勞資與人力、`esg` 環保與永續、`debt` 債務、`orders` 訂單與需求、`pricing` 價格策略、`mna` 併購與重組。

### 情境（15 種）
`when` 的寫法與 `news.ts` 的 `whenScore` 對應：

| 情境 | `when` | 說明 |
|---|---|---|
| 春 | `seasons: ["spring"]` | 3–5 月 |
| 夏 | `seasons: ["summer"]` | 7–8 月 |
| 秋 | `seasons: ["autumn"]` | 9–11 月 |
| 冬 | `seasons: ["winter"]` | 12–2 月 |
| 梅雨 | `seasons: ["rainy"]` | 6–7 月 |
| 颱風季 | `seasons: ["typhoon"]` | 8–10 月 |
| 連休 | `calendar: ["long_weekend"]` | `CalendarTag` |
| 黃金週 | `calendar: ["golden_week"]` | `CalendarTag` |
| 盂蘭盆節 | `calendar: ["obon"]` | `CalendarTag` |
| 年末年始 | `calendar: ["year_end", "new_year"]` | `CalendarTag`，任一個即符合 |
| 發薪日 | `calendar: ["payday"]` | `CalendarTag` |
| 下雨天 | `weather: ["rain"]` | `weather.ts` 的 `WeatherKind` |
| 酷暑 | `weather: ["hot"]` | 溫度別名（≥32°），引擎轉成 hot／heat／heatwave |
| 嚴寒 | `weather: ["cold"]` | 溫度別名（≤4°） |
| 颱風來襲 | `weather: ["storm"]` | `WeatherKind` |

`when.calendar` 的有效值＝`CalendarTag` 與 `OBSERVANCES` 的 id；`when.weather` 的有效值＝`clear｜cloudy｜rain｜storm`＋別名 `hot｜cold`。測試（`newsPool.test.ts`）逐則檢查。

### 娛樂題材（2026-11-26 補）
給娛樂／動漫出版／遊戲三個板塊的公司個股消息：`kind` 仍是 `company`，id 前綴 `co-ent_…`，**一定帶 `when.sectors`**（只在這三個板塊的公司出現；引擎的 `whenScore` 對板塊不符者排除）。只寫泛稱（「旗下偶像團體」「旗下藝人」「主唱」「新單曲」「主演動畫」「大型音樂祭」），**沒有任何藝人、團體、作品、角色、品牌名或人名**；地名只到城市層級。9 個原型：

| 原型 | 利多 | 利空 |
|---|---|---|
| `ent_concert` 演唱會與巡演 | 門票秒殺、加開場次、啟動海外巡演 | 延期、取消，或售票遠低於預期 |
| `ent_release` 新作與新曲發表 | 發表後好評、熱烈討論 | 延期發表，或評價兩極 |
| `ent_cast` 新番與配音陣容 | 新番／續篇的製作與配音陣容公布受期待 | 配音／演出人選更換引發爭議，或續篇擱置 |
| `ent_graduation` 成員畢業與退團 | 畢業後轉型順利、新成員反應好、畢業演唱會熱賣 | 核心成員畢業，人氣與周邊受影響 |
| `ent_contract` 合約與轉會 | 續約成功、簽下重量級人才或創作團隊 | 藝人合約到期未續、轉往他社、解約糾紛 |
| `ent_scandal` 緋聞與炎上 | 負面傳聞獲澄清、風波平息、危機處理獲好評 | 緋聞或言論炎上，贊助商重新檢討合作 |
| `ent_festival` 音樂祭與大型活動 | 受邀參加音樂祭、自辦活動吸引大量觀眾 | 未獲邀、縮小規模，或因天候場地中止 |
| `ent_hit` 暢銷與排行 | 作品衝上排行榜前段、銷量與串流創紀錄 | 快速跌出排行榜、熱度消退 |
| `ent_flop` 票房與銷量表現 | 起步不如預期但口碑發酵、逆勢翻紅 | 明顯不如預期，公司下修收益預估 |

情境版本（37 則）：`ent_festival` × 夏季、`ent_festival` × 年末年始、`ent_concert` × 聖誕、`ent_cast`／`ent_release` × 新番季（`when.months: [1, 4, 7, 10]`，**這是庫內第一次使用 `months`**）。規格在 `marketNewsSpec.ts` 的 `ENT_SECTORS`／`ENT_ARCHETYPES`／`ENT_CONTEXTS`。各原型 × 利多／利空 15–23 則，每個原型都有 mag 1／2／3。

娛樂題材另外禁止：股價或「相關股票獲得關注」之類的市場反應語（人工審核另外剔除 2 則）；真實藝人／作品／品牌（`validate.ts` 的真實名稱表已補娛樂界詞彙）。

## 覆蓋矩陣（測試鎖定，最終庫全部達標）
| 項目 | 要求 | 最終 |
|---|---|---|
| 公司：每個原型 × 利多／利空 | ≥ 8 | 最少 11（`holder`／利多），其餘 ≥ 17 |
| 娛樂：9 個原型 × 利多／利空 | ≥ 8 | 15–23（共 305 則；每原型 mag 1–3 皆有；情境版 37 則） |
| 板塊 × 15 情境 × 利多／利空 | ≥ 1 | 39 × 15 × 2 = 1,170 格全有（共 1,173 則） |
| 板塊通用 × 利多／利空 × 3 幅度 | ≥ 1 | 39 × 2 × 3 全有（467 則） |
| 全市場（macro） | ≥ 100 | 204（利多 102／利空 102；其中情境專屬 60） |
| 分析師 | ≥ 60 | 98（7 個原型各 14） |
| 收盤市況評語 | ≥ 60 | 120（上漲／下跌／持平各 40） |
| 傳聞三連組 | ≥ 40 組 | 72 組（12 主題 × 利多利空 × 3 幅度，各 1 組） |
| 開盤前瞻 | （自訂）≥ 30 | 75（樂觀／謹慎／中性各 25） |

## 生成與審核紀錄（2026-11-26）
**生成**：`anthropic/claude-haiku-5.5`（OpenRouter 測試金鑰，金鑰不寫進任何檔案）。依「格子」（原型×語氣×幅度、板塊×情境×語氣…）規劃缺口，每批 ≤12 則，每則指定語氣、幅度、切入角度（避免千篇一律），已寫過的標題當作「不要雷同」清單；缺口不足就補輪，直到格子滿或預算用完。每批的原始輸出與結果先寫到暫存資料夾，可續跑。

**自動驗證**（`marketnews.ts`、`validate.ts` 的 `allowPlaces`）：標題 12–40 字、本文 60–120 字（佔位符以 8 字名字展開後計）；佔位符種類與次數；真實企業／品牌／金融機構／指數／媒體／央行／商品名（數百個中文詞與英文詞表）、網址、粗話、簡體字、整句日文、英文單字、emoji；年份與具體日期；股價與漲跌幅用語、投資建議字眼、市況極端字眼、成交量用語；通用文案不得出現季節／節日／天氣詞，情境專屬文案必須扣緊它的情境、且不得串到同組別的其他情境；傳聞三連組必須有該有的語氣（傳聞／證實／否認）；雜湊去重與雙字組相似度去重；各種類同一開頭詞的比例上限。`allowPlaces` 放行一般地名（都道府縣、城市），但老街區原型周邊的地名（新今宮、通天閣、西成、釜崎、愛隣）仍擋。

**數字**
| 項目 | 數量 |
|---|---|
| 呼叫模型 | 1,066 次（含 2 批試跑；無失敗呼叫） |
| 花費（OpenRouter 回報） | 約 US$0.63（金鑰上限 US$1） |
| 模型產出但被自動驗證擋下 | 1,654 則 |
| 通過自動驗證、進入審核 | 3,634 則 |
| 人工審核剔除 | 425 則（含三連組連帶） |
| 最終入庫（第一輪） | 3,209 則 |
| 補生成「娛樂題材」後 | **3,514 則**（+305） |

自動驗證擋下的主因：板塊文案誤用 `{name}`／`{peer}`（869，板塊消息不能有公司名）、本文過長（239）、開頭詞集中（85）、沒扣緊情境（68）、與既有內容太像（64）、寫了成交量或買賣超（56）、標題過長（36）、本文只是重複標題（30）、標題缺 `{name}`（24）、串到別的情境（24）、其餘（年份日期、投資建議、英文夾雜、真實國際組織、股價反應、日文／簡體字…）合計約 300。

**人工逐則審核**：我把 3,634 則「通過自動驗證」的內容分 22 批全部讀過（第 1–17 批是第一輪生成的 3,198 則，每批 130–200 則；第 18–22 批是剔除後補生成的 436 則，同樣逐則讀過）。不合格者剔除後，缺口回到生成器補生成，直到每個格子達標。唯一沒有逐則顯示就剔除的，是兩個自動規則：（1）公司／分析師／傳聞類同一則出現 2 個以上地名（模型愛寫「關西與九州與北海道」的套話，45 則）；（2）簡體字掃描（「机构」「币」，2 則；已加進 `validate.ts` 的簡體字表）。
| 剔除原因 | 則數 |
|---|---|
| 語氣與利多／利空或幅度標記不符（含太弱、方向不明；情境專屬的利多版本常寫成壞消息） | 188 |
| 離題（混進別的原型或主題，例如把會員優惠、通路反應塞進股利或大股東消息） | 104 |
| 地名套話（同則 2 個以上地名） | 54 |
| 語病、標題與本文矛盾、數字或邏輯不通（例如日圓走弱卻說海外營收換算縮水、央行與鐵道規範無關） | 45 |
| 寫了股價／成交量／資金面的反應（全市場消息與板塊消息不准） | 18 |
| 換湯不換藥（與同組太像） | 7 |
| 其他（日文漢字、簡體字、用語誇張…） | 9 |

審核時也確認：沒有真實企業／品牌／人名；地名只在都道府縣與城市層級（有「東京、大阪、關西、九州、北海道、名古屋、福岡」等），沒有具體車站、線路、機場、港口、設施（「新幹線」是通稱，保留一則）；佔位符以外沒有任何公司名；`rumor`／`confirm`／`deny` 同組語意連貫。

**已知限制**
- 文案偏「官樣」：同一原型內的句式相近（例如「券商分析師認為…」「評等機構指出…」出現很多次），這是模型的慣性；開頭詞比例有上限，但本文用語仍有共通語氣。需要更多變化時，可調高生成時的 `temperature` 或換提示詞後補生成（`marketnews.ts` 可續跑）。
- 板塊情境專屬文案的利多／利空是依「該情境對該產業的真實影響」寫的，有些情境對某些板塊本來就偏單向（例如颱風對航空），所以那一格的「利多」版本多半是「相對受惠」或「損失有限」的角度；幅度偏小（mag 1–2）者居多。
- `weight` 目前全為 1；引擎已對符合 `when` 特定條件者 ×3，所以這裡不另外加權。

**娛樂題材補生成**：同一生成器加了 `en|`（原型×語氣×幅度，目標各 5）與 `enx|`（情境版，目標各 4）格子，共 91 次呼叫、約 US$0.05；300 則首批全部逐則讀過（第 23 批），剔除 13 則（語氣太弱的 pos／neg 1 級居多，另有離題、語病、「相關股票也獲得目光」之類的價格反應、數字前後不一致），補生成兩輪再審 20 則（第 24、25 批）剔除 2 則（語氣太弱、語病），總共剔除 15 則；入庫 305 則。

## 怎麼擴充或重生
生成器是一次性離線工具，需要 `OPENROUTER_TEST_KEY`（只讀環境變數，不印、不寫檔）。**不要在 Z: 資料夾裡直接跑**（見 CLAUDE.md 環境陷阱）；用鏡像：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mirror.ps1 -NoTsc
cd $env:TEMP\coidle-mirror
npx tsx --env-file=<專案資料夾>\.env --tsconfig tsconfig.json server/src/ai/marketnews.ts check --dir <暫存資料夾>   # 金鑰餘額
npx tsx --env-file=... server/src/ai/marketnews.ts gen --dir <暫存資料夾> --max-usd 0.5 --rounds 4            # 補缺口（可續跑）
npx tsx --env-file=... server/src/ai/marketnews.ts dump --dir <暫存資料夾> --count 150                         # 列出待審的一批
npx tsx --env-file=... server/src/ai/marketnews.ts apply <批號> --file <剔除清單>                               # 「編號 原因」每行一則
npx tsx --env-file=... server/src/ai/marketnews.ts build --dir <暫存資料夾> --out <專案>\shared\src\game\market\news.data.json
```
規則：新增或改動內容庫之後，一定要在鏡像跑 `newsPool.test.ts`（覆蓋矩陣、佔位符、長度、傳聞配對、情境 id、真實名稱掃描）。每批請務必逐則讀過再 `apply`；`build` 在還有未審內容時會拒絕。

## 權重調整（娛樂專屬文案）
娛樂題材的 305 則公司類文案（archetype 以 `ent_` 開頭，限定娛樂、動漫出版、遊戲三個板塊）原本與通用文案同權重（1），加上板塊限定的 3 倍加權，會讓這三個板塊約 **52

## 權重調整（娛樂專屬文案）
娛樂題材的 305 則公司類文案（archetype 以 `ent_` 開頭，限定娛樂、動漫出版、遊戲三個板塊）原本與通用文案同權重（1），加上板塊限定的 3 倍加權，會讓這三個板塊約 **52%** 的公司消息都抽到娛樂專屬文案，其他板塊只有通用文案、顯得單薄。已把它們的 `weight` 降到 **0.3**，占比降到約 **24%**（只算沒有日曆／天氣條件的文案）；通用文案不變。之後其他產業有自己的專屬公司文案時，用同樣的方式控制占比（目標：專屬文案占該板塊公司消息 20–30%）。
