import { CATEGORIES } from "@coidle/shared";
import type { ChatMessage } from "./openrouter";

// 提示詞：世界觀、語氣與禁止事項集中在這裡。
// 數值效果不交給模型決定——事件只能用白名單效果，並由伺服器夾限。

export const WORLD = `你在替一款中文（繁體）的商場經營遊戲寫文案。
世界觀：一座虛構的現代科技感複合式商場，緊鄰一個熱鬧的老街區，昭和老街的人情味與近未來科技共存；有很多國外觀光客，也有在地常客。
語氣：輕鬆、有人情味，帶一點點關西腔的幽默（例如「ぼちぼち」「ええ」「なんでやねん」可偶爾出現，但整體仍是繁體中文），不油膩、不說教。
硬性規則：
1. 絕對不要寫出任何真實的地名、車站名、地標、品牌、公司或人名。只能用虛構名稱，或「站前」「對面的老街」這類含蓄說法。
2. 對鄰近的老街區與居民要尊重、溫暖，不使用刻板印象或貶抑性描述。
3. 不談政治、宗教、暴力、色情，不用粗話，不放網址或聯絡方式。
4. 只輸出 JSON，不要任何額外說明或 Markdown。`;

export function newsPrompt(n: number): ChatMessage[] {
  return [
    { role: "system", content: WORLD },
    {
      role: "user",
      content: `請寫 ${n} 則「商場日報」裡的小快訊，每則一句話（20–50 字），不要提到具體金額。
心情分類 mood：good（生意好、有喜事）、bad（出狀況、冷清）、neutral（日常小插曲）、season（季節或天氣）。每種至少一則。
輸出格式：{"items":[{"mood":"good","text":"..."}]}`,
    },
  ];
}

export function reviewPrompt(n: number): ChatMessage[] {
  return [
    { role: "system", content: WORLD },
    {
      role: "user",
      content: `請寫 ${n} 則客人在網路上留下的店家評價，語氣像真人，各有不同的個性。必須包含 {shop} 這個佔位符（代表店名），不要自己編店名。
tier：high（4–5 星，稱讚）、mid（3 星，普通）、low（1–2 星，不滿但不要人身攻擊）。每種至少一則。每則 25–70 字。
輸出格式：{"items":[{"tier":"high","text":"...{shop}..."}]}`,
    },
  ];
}

export function eventPrompt(n: number, existingTitles: string[]): ChatMessage[] {
  return [
    { role: "system", content: WORLD },
    {
      role: "user",
      content: `請設計 ${n} 個商場「隨機事件」。每個事件有：
- title：標題（4–14 字）
- text：事件描述（30–90 字）
- category：crowd（客流）、facility（設施）、luck（好運）、market（市場）、festival（節慶）之一
- options：2 或 3 個玩家選項，每個有 label（6–24 字）和 effect
  effect 只能是以下其中一種（不要發明別的）：
  {"t":"funds","amount":整數，介於 -60000 和 60000}
  {"t":"index","which":"localRep" 或 "touristHeat","amount":小數，介於 -2 和 2}
  {"t":"traffic","persona":"tourist|local|commuter|family|student|couple|all","mult":介於 0.8 和 1.5,"ticks":介於 12 和 144}
  {"t":"cleanliness","amount":整數，介於 -15 和 15}
  選項要有取捨（花錢換口碑、省錢冒險之類），不要有明顯唯一最佳解。
不要和這些已有的重複：${existingTitles.slice(0, 20).join("、") || "（無）"}。
輸出格式：{"items":[{"title":"...","text":"...","category":"crowd","options":[{"label":"...","effect":{"t":"funds","amount":-20000}}]}]}`,
    },
  ];
}

const GROUP_NAMES = { food: "餐飲", retail: "零售", entertainment: "娛樂", service: "服務" } as const;

export function brandPrompt(targets: { id: string; name: string; group: keyof typeof GROUP_NAMES }[], perCategory: number): ChatMessage[] {
  const list = targets.map((c) => `${c.id}（${c.name}・${GROUP_NAMES[c.group]}）`).join(NL);
  return [
    { role: "system", content: WORLD },
    {
      role: "user",
      content: `商場招商時會出現「租戶品牌」。請替下面每一種店各取 ${perCategory} 個虛構的品牌名稱與簡介：
  ${list}
規則：
- name：2–7 個字，像日本商店街風格的店名（可以有季節、職人、物件、地形的意象，但不是真實地名），好念好記；同一種店的名字彼此不要太像
- blurb：一句簡介，12–35 字，**必須確實是在描述那一種店**（賣的是什麼、有什麼個性），語氣親切
- 不可以用任何真實存在的品牌或連鎖店名字
輸出格式：{"items":[{"category":"上面列的 id","name":"...","blurb":"..."}]}`,
    },
  ];
}

const NL = "\n  ";

export function dishPrompt(targets: { id: string; name: string; group: keyof typeof GROUP_NAMES }[], perCategory: number): ChatMessage[] {
  const list = targets.map((c) => `${c.id}（${c.name}・${GROUP_NAMES[c.group]}）`).join(NL);
  return [
    { role: "system", content: WORLD },
    {
      role: "user",
      content: `玩家在店裡的研發工坊「試做出原創的新品」時，需要一個好聽、而且確實符合那種店的名字。請替下面每一種店各想 ${perCategory} 個：
  ${list}
規則：
- 名字要讓人一看就知道是那種店會賣／辦的東西（拉麵店的名字就是一碗麵，不要寫成甜點；密室逃脫的名字就是一個關卡主題），3–10 個字
- 同一種店的名字彼此要不一樣，用料、季節、手法、意象多變化；不要只換一個字
- 不可以用真實品牌、連鎖店或商品名
輸出格式：{"items":[{"category":"上面列的 id","name":"..."}]}`,
    },
  ];
}

export interface RegularBrief {
  name: string;
  persona: string;
  fav: string;
}

export function regularPrompt(n: number, existing: RegularBrief[], wanted: { id: string; name: string }[]): ChatMessage[] {
  const cats = CATEGORIES.map((c) => `${c.id}（${c.name}・${GROUP_NAMES[c.group]}）`).join("、");
  const have = existing.map((r) => `${r.name}（${r.persona}・愛 ${r.fav}）`).slice(-40).join("、");
  const gaps = wanted.map((c) => `${c.id}（${c.name}）`).join("、");
  return [
    { role: "system", content: WORLD },
    {
      role: "user",
      content: `請創造 ${n} 位「常客」——會固定來光顧的有名有姓的虛構人物，各有個性與兩段小故事。欄位：
- name：2–4 個字的名字。約七成用日式名字（例如「橋本大叔」「結衣」），其餘可以是外國旅人或移居此地的人；外國人名用中點分隔（例如「瑪雅·歐拉」）
- persona：tourist（國外觀光客）、local（在地常客）、commuter（通勤上班族）、family（家庭）、student（學生）、couple（情侶）之一，要和人物相符
- fav：他最愛的店種，必須是下列 id 之一；alt（選填）：第二選擇，也必須是下列 id 之一，且不同於 fav
  ${cats}
- budget：願意付參考價的幾倍，1.0–1.6
- hint：還沒認識他時看到的線索，15–40 字，描述外表或習慣
- bio：人物簡介，25–70 字
- traits：2–3 個小癖好（每個 6–16 字，簡短的一句話）
- stories：剛好兩段，每段有 title（4–10 字）與 text（30–80 字）；第一段是和店家建立感情的小事，第二段是他為店家帶來幫助的暖心情節
多樣性要求（很重要）：
- 這 ${n} 位的 persona 必須各不相同，年紀、職業、生活背景也要明顯不同（不要全是「推嬰兒車的媽媽」「背相機的攝影師」這類雷同的人設）
- fav 優先從這些「還沒有常客」的店種挑：${gaps || "（不限）"}，而且這 ${n} 位的 fav 要分屬不同類型的店
- 不要和已經有的常客重複或太像：${have || "（無）"}
人物與老街區居民互動時保持溫暖尊重；全部使用繁體中文，不要出現簡體字。
輸出格式：{"items":[{"name":"...","persona":"local","fav":"ramen","alt":"udon","budget":1.2,"hint":"...","bio":"...","traits":["..."],"stories":[{"title":"...","text":"..."},{"title":"...","text":"..."}]}]}`,
    },
  ];
}
