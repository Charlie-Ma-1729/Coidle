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
