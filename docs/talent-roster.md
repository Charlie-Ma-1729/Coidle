# 藝人名冊（talent-roster）

遊戲裡「藝人」領域（演唱會、樂團、偶像團體、綜藝與活動邀約…）用的**虛構藝人庫**：800 位藝人（8 個領域各 100 位）＋ 60 個虛構團體（30 個偶像團體、30 個樂團）。**只描述「這個人是誰」，沒有任何數值屬性**（人氣、實力、價碼、成長由引擎另外決定）。

## 檔案
| 檔案 | 用途 |
|---|---|
| `shared/src/game/talent/roster.data.json` | 名冊資料：`{ "talents": [...], "groups": [...] }`（約 275 KB；不從任何 index 匯出，要用時直接 import） |
| `shared/src/game/talent/rosterSpec.ts` | 型別、8 個領域、每領域 12 個特質標籤表、互斥規則、年代分布、覆蓋門檻（生成腳本與測試共用，純資料） |
| `shared/src/game/talent/roster.test.ts` | 資料驗證（格式、數量、標籤、年代、姓名去重與同姓上限、內容守則） |
| `server/src/ai/talentroster.ts` | 一次性離線生成器（OpenRouter `anthropic/claude-haiku-5.5`），不在遊戲執行期呼叫 |
| `server/src/ai/realPeople.ts` | 真實藝人／運動員／團體黑名單（姓名撞到就拒收；腳本與測試共用） |

## 資料格式
```ts
interface Talent {
  id: string;        // `<area>-<三位數序號>`，如 singer-007；依序固定
  area: "singer" | "voice" | "idol" | "comedian" | "model" | "band" | "stage" | "host";
  name: string;      // 虛構姓名
  kana?: string;     // 日式姓名才有：平假名，姓與名之間一個半形空格
  birthplace: string;// 日本都道府縣，或海外城市
  ageBand: "10s" | "20s" | "30s" | "40s" | "50s";
  persona: string;   // 一句人設，≤ 40 字
  traits: string[];  // 2–3 個，值為該領域標籤表裡的 id
}
interface TalentGroup {
  id: string;        // `grp-<idol|band>-<兩位數序號>`
  area: "idol" | "band";
  name: string;      // 團名
  concept: string;   // 團體概念，≤ 40 字
}
```
`persona`／`concept` 不含數字、年齡、出身地（出身有專屬欄位）、能力或人氣數值、排名；也不重複姓名。`ageBand` 是固定的帶狀值，引擎想讓藝人隨遊戲日變老，要自己另存年資。

## 領域與特質標籤（每領域 12 個，每個標籤至少 8 人使用）
| 領域 | 標籤（id＝中文） |
|---|---|
| `singer` 歌手 | `ballad` 抒情、`powerhouse` 高音爆發、`husky` 煙嗓、`songwriter` 創作型、`enka` 演歌風味、`citypop` 城市流行、`folk` 民謠、`jazzy` 爵士氣質、`anisong` 動畫歌曲、`live` 現場派、`viral` 網路爆紅、`veteran` 資深 |
| `voice` 聲優 | `lead` 主角系、`villain` 反派系、`boyish` 少年聲、`mature` 成熟嗓、`comic` 搞笑角色、`narrator` 旁白、`gamevo` 遊戲配音、`dubbing` 外語配音、`multivoice` 多聲線、`singing` 兼歌手、`radio` 廣播節目、`stagevo` 舞台出身 |
| `idol` 偶像 | `center` 中心位、`dancer` 舞蹈擔當、`variety` 綜藝感、`visual` 顏值擔當、`vocal` 歌唱擔當、`leader` 領袖氣質、`moodmaker` 氣氛製造機、`fanservice` 粉絲服務、`underground` 地下出身、`solo` 個人活動、`actor` 兼演員、`latebloomer` 大器晚成 |
| `comedian` 搞笑藝人 | `boke` 裝傻、`tsukkomi` 吐槽、`manzai` 漫才、`rakugo` 落語、`sketch` 短劇、`solo` 單人表演、`dry` 冷面笑匠、`physical` 肢體喜劇、`sharp` 毒舌、`reaction` 反應派、`veteran` 資深、`newcomer` 新生代 |
| `model` 模特兒 | `runway` 伸展台、`magazine` 雜誌、`commercial` 廣告、`street` 街拍風、`mixed` 混血感、`cool` 酷系、`cute` 可愛系、`elegant` 成熟優雅、`athletic` 運動體態、`sns` 社群人氣、`actress` 跨足演藝、`buzz` 話題性 |
| `band` 樂團成員 | `vocal` 主唱、`guitar` 吉他手、`bass` 貝斯手、`drums` 鼓手、`keys` 鍵盤手、`composer` 作曲型、`technical` 技巧派、`liveband` 現場派、`visualkei` 視覺系、`indie` 獨立音樂、`session` 樂手、`screamer` 嘶吼 |
| `stage` 舞台劇演員 | `musical` 音樂劇、`drama` 話劇、`classic` 古典劇、`dance` 舞蹈、`comedy` 喜劇、`opera` 歌劇、`action` 武打、`improv` 即興、`leadrole` 主演、`supporting` 綠葉、`directing` 兼導演、`screenstage` 跨界影視 |
| `host` 主持人 | `mc` 司儀、`news` 新聞播報、`varietyhost` 綜藝主持、`radio` 廣播、`quiz` 益智節目、`talk` 訪談、`sports` 體育轉播、`morning` 晨間節目、`event` 活動主持、`calm` 沉穩、`witty` 機智、`warm` 親和 |

每個標籤在 `rosterSpec.ts` 裡還有一行說明（`desc`）。實際資料裡用到的標籤 id 以 `rosterSpec.ts` 為準（例如聲優的「舞台出身」是 `stagevo`、搞笑藝人的「單人表演」是 `solo`）。

**特質規則**：每人 2–3 個（約六成 2 個、四成 3 個），同一人不會同時帶有互斥特質（`TALENT_TRAIT_CONFLICTS`，例如裝傻×吐槽、漫才×落語、酷系×可愛系、新聞播報×綜藝主持）。**樂團成員恰有一個角色標籤**（`vocal`／`guitar`／`bass`／`drums`／`keys`），分配為主唱 22、吉他 28、貝斯 18、鼓 18、鍵盤 14；帶 `screamer` 的一定是主唱。

## 分布（程式先決定，不靠模型）
每個位置（slot）的**年代、出身地、特質、姓名風格、性別**由固定種子在程式裡先決定，模型只負責「姓名、讀音、一句人設」。所以分布穩定可重現：

- **年代**：各領域不同，偶像偏年輕（10s 35／20s 55／30s 9／40s 1）、主持人與搞笑藝人偏中年（見 `rosterSpec.ts` 的 `ages`）。測試鎖定每領域每個年代帶的人數。
- **姓名風格**（每領域 100 人）：日式 70、韓式 8、華語 6、西洋 9、藝名 7。全庫日式姓名占 70%（測試容許 62%–78%）。日式姓名以漢字為主（名可為平假名，如「須藤ふうか」），一定有 `kana`；其餘沒有。藝名用片假名、平假名或英文字母。
- **出身地**：日式與藝名多為日本都道府縣（東京、大阪、神奈川、愛知、福岡、北海道等較多，其餘各縣至少有人），約一成出生在海外；韓式／華語／西洋姓名對應海外城市。全庫 559 位出生在日本、241 位在海外。
- **姓名去重**：姓名（含團名，忽略大小寫與「·」）全庫不重複；日式姓名的讀音「姓＋名」不重複，同一個姓（假名）≤ 3 人、同一個名 ≤ 3 人；西洋姓名的第一個字詞 ≤ 2 次、韓式／華語同一個姓 ≤ 6 人。
- 人設開頭詞：同領域前 3 字相同者 ≤ 6 人。

## 團體
- 偶像團體 30、樂團 30，各有「風格種子」（清純系、復古昭和風、電子舞曲、後搖滾、龐克、斯卡、視覺系…）確保風格分散。團名可為漢字、片假名、平假名、英文字母，**不含數字**。團名與任何藝人姓名不重複。
- 名冊**沒有**「藝人屬於哪個團體」的欄位；團體與個人是兩個獨立的池，要不要編組由日後的引擎決定（`idol`／`band` 領域的個人可被安排進同 `area` 的團體）。

## 生成與審核紀錄（2026-11-26）
**生成**：`anthropic/claude-haiku-5.5`（OpenRouter 測試金鑰，金鑰不寫進任何檔案）。依位置分批（每批 ≤ 20 位，同一領域），每批附上「已用過的姓名」清單（非日式姓名全列）與已滿額的姓；日式姓名附「姓／名讀音的起始假名建議」讓姓名分散。位置沒通過驗證就在下一輪重新生成，直到補滿。

**自動驗證**（`talentroster.ts`、`validate.ts` 的 `allowPlaces`、`realPeople.ts`）：姓名格式（依風格）、讀音格式（平假名、姓名間一個半形空格）、姓名／讀音去重、同姓同名上限、真實藝人／運動員／團體黑名單、真實企業與品牌、人設 10–40 字、人設不含數字／年齡／出身地／能力值用語／作品名符號、人設不重複姓名、與同領域人設的雙字組相似度（≥ 0.45 拒收）、開頭詞集中度、簡體字、網址、粗話。

**數字**
| 項目 | 數量 |
|---|---|
| 呼叫模型 | 308 次（無失敗呼叫） |
| 花費（OpenRouter 回報） | 約 US$0.247（含 5 輪補生成） |
| 模型產出但被自動驗證擋下 | 2,589 筆（日式姓名格式不符／同姓太多為大宗，見下） |
| 通過自動驗證、進入人工審核 | 約 930 筆 |
| 人工審核剔除 | 67 筆 |
| 人手補寫 | 22 筆（預算用完後，由審核者依剩餘位置的條件親自補寫，過同一套自動驗證；占 2.6%） |
| 最終入庫 | **800 位藝人（每領域 100）＋ 60 個團體** |

自動驗證擋下的主因：日式姓名格式不符 1,050（模型愛把名寫成純假名或姓名間加空格；已改成正規化空格、並放行「漢字姓＋平假名名」）、同姓太多 612、同名太多 170、人設太長 158、姓名重複 157、讀音格式不符 101、其餘（團名假名過多、藝名／西洋姓名格式、數字或年齡用語、撞到真實人物…）合計約 340。

**人工逐筆審核**：每一筆姓名、讀音、出身、特質與人設都讀過（約 930 筆，分 12 批）。人工剔除原因：

| 剔除原因 | 筆數 |
|---|---|
| 讀音與漢字不符（例：「瀧澤」標成「ひざわ」、「三枝」標成「みえだ」、「齋藤」標成「とさい」） | 30 |
| 姓名或名字讀音不自然（4 字韓式名、「織衣→おい」等） | 12 |
| 撞到真實人物或知名作品（真實藝人同名或太像、知名作品角色姓氏或名字、歷史名人、真實團體名、知名品牌） | 14 |
| 與已入庫的姓名過度相似（西洋姓名同姓＋同名） | 3 |
| 人設與年代矛盾（「五十年來」寫給 50 歲帶、20 歲帶卻自稱老手） | 3 |
| 其他（字面意義不良的姓氏、用語不雅、人設自相矛盾、概念不是中文） | 5 |

審核時也確認：沒有真實藝人、團體、作品、品牌；人設沒有成人或爭議內容；沒有政治／宗教；地名只在都道府縣與城市層級（出身欄）。審核中發現的真實人物與姓氏（例如鄭秀晶、河正宇、少年隊、羽生結弦、貞子、灰原、安室…）已加進 `realPeople.ts`，並由測試持續把關。

**已知限制**
- 日式姓名的**讀音**是模型給的，雖然每筆都人工對照過，仍可能有少數冷僻字（如「紬」「澪」）的讀音取自常見組合而非唯一正確；遊戲內不用讀音做任何邏輯，只是顯示用。
- 人設偏「反差魅力」句式（「台上…，台下卻…」出現很多次），這是模型慣性；開頭詞比例有上限，但句型仍有共通語氣。
- 部分領域的標籤與年代組合有些微不貼合（例如 10 歲帶偶像帶「大器晚成」的人設寫成「多年累積」，視為出道很早的練習生，未剔除）。
- 團體概念種子有 24 個、團體有 30 個，所以有少數風格重複（例如兩個電子舞曲偶像團體），團名與文字不同。

## 怎麼擴充或重生
生成器需要 `OPENROUTER_TEST_KEY`（只讀環境變數，不印、不寫檔）。**不要在 Z: 資料夾裡直接跑**（見 CLAUDE.md 環境陷阱），用鏡像：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mirror.ps1 -NoTsc
cd $env:TEMP\coidle-mirror
npx tsx --env-file=<專案資料夾>\.env --tsconfig tsconfig.json server/src/ai/talentroster.ts gen --dir <暫存資料夾> --max-usd 0.1
npx tsx --tsconfig tsconfig.json server/src/ai/talentroster.ts dump --dir <暫存資料夾> --count 150   # 逐筆審
npx tsx --tsconfig tsconfig.json server/src/ai/talentroster.ts apply <批號> --dir <暫存資料夾> --file r.txt   # 每行「編號 原因」＝剔除
npx tsx --tsconfig tsconfig.json server/src/ai/talentroster.ts build --dir <暫存資料夾> --out <專案>\shared\src\game\talent\roster.data.json
```
其他指令：`stats`（各領域數量、自動拒收與人工剔除原因、花費）、`open`（列出還空著的位置與條件）、`manual --file x.json`（把人手寫的 `[{key,name,kana?,persona}]` 過同一套驗證後放進候選池）、`check`（查金鑰額度）。要補人或換新，只要刪掉候選池裡該位置的候選（或在 `rejects.json` 標剔除）再 `gen`，位置條件（年代／出身／特質）不變。
