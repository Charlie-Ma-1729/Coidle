// 內容驗證：AI 產出的文字進內容池之前，一律先過這一關。
// 原則：遊戲內不明寫真實地點與真實品牌（只留含蓄線索）；文字長度有上限；不含網址、聯絡方式、粗話。

/** 不能出現的真實地名（遊戲刻意只留含蓄線索） */
const REAL_PLACES = ["大阪", "大坂", "新今宮", "通天閣", "阿倍野", "天王寺", "日本橋", "新世界", "難波", "梅田", "道頓堀", "心齋橋", "關西機場", "關西空港", "Osaka", "Shin-Imamiya", "Tsutenkaku", "Namba", "Umeda", "Dotonbori", "Abeno", "Tennoji", "Nipponbashi", "西成", "釜崎", "愛隣"];
/** 真實品牌／公司（避免商標與誤導） */
const REAL_BRANDS = ["麥當勞", "肯德基", "星巴克", "7-11", "7-ELEVEN", "全家", "羅森", "Lawson", "優衣庫", "UNIQLO", "無印良品", "MUJI", "唐吉訶德", "驚安", "松本清", "大創", "DAISO", "Apple", "蘋果公司", "Google", "Amazon", "亞馬遜", "樂天", "Rakuten", "任天堂", "Nintendo", "Sony", "索尼", "阪神", "吉野家", "壽司郎", "一蘭", "餃子的王將", "Disney", "迪士尼", "環球影城", "Netflix", "LINE", "Uber", "Twitter", "Instagram", "Facebook", "YouTube", "TikTok"];
/** 不得出現的字眼：粗話、歧視性或貶抑街區居民的用語、政治與敏感議題 */
const BAD_WORDS = ["幹你", "靠北", "操你", "他媽的", "賤人", "婊", "智障", "白痴", "死全家", "貧民窟", "貧民", "流浪漢", "遊民", "乞丐", "無業", "治安差", "危險地帶", "骯髒", "垃圾區", "黑道", "毒品", "賣淫", "自殺", "殺人", "強姦", "恐怖攻擊", "習近平", "川普", "選舉", "政黨", "統獨"];

export interface TextRule {
  min?: number;
  max: number;
  /** 需要包含的子字串（例如評價必須有 {shop}） */
  must?: string[];
}

/** 回傳 null 代表通過；否則回傳拒收原因 */
export function checkText(text: unknown, rule: TextRule): string | null {
  if (typeof text !== "string") return "不是文字";
  const t = text.trim();
  if (t.length < (rule.min ?? 4)) return "太短";
  if (t.length > rule.max) return "太長";
  for (const m of rule.must ?? []) if (!t.includes(m)) return `缺少 ${m}`;
  if (/https?:\/\/|www\.|@\w+\.\w+|\b\d{2,4}-\d{3,4}-\d{3,4}\b/i.test(t)) return "含有網址或聯絡方式";
  const lower = t.toLowerCase();
  for (const w of REAL_PLACES) if (lower.includes(w.toLowerCase())) return `含真實地名「${w}」`;
  for (const w of REAL_BRANDS) if (lower.includes(w.toLowerCase())) return `含真實品牌「${w}」`;
  for (const w of BAD_WORDS) if (lower.includes(w.toLowerCase())) return `含不當字眼「${w}」`;
  if (/[Ѐ-ӿ؀-ۿ]/.test(t)) return "含非預期的文字";
  if (/[぀-ヿ]{8,}/.test(t)) return "日文假名過多"; // 允許少量日文風味，但整句日文不收
  return null;
}
