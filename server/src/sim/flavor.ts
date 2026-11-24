// 「風味文字」來源：日報快訊與線上評價的文字，除了手寫的，還能從 AI 內容池挑。
// 模擬本身不碰資料庫與網路——伺服器啟動時把內容池放進來，模擬只在需要文字時「讀」。
// 挑哪一則由 (seed, tick) 決定，所以同一份內容池下結果可重現。

export type FlavorMood = "good" | "bad" | "neutral" | "season";
export type FlavorTier = "high" | "mid" | "low";

export type FlavorGroup = "food" | "retail" | "entertainment" | "service";
export interface BrandFlavor {
  name: string;
  blurb: string;
}

export interface FlavorSource {
  news(mood: FlavorMood): readonly string[];
  reviews(tier: FlavorTier): readonly string[];
  /** 招商用的虛構品牌名（可省略） */
  brands?(group: FlavorGroup): readonly BrandFlavor[];
  /** 研發出原創商品時用的名字（可省略） */
  dishes?(group: FlavorGroup): readonly string[];
}

const EMPTY: FlavorSource = { news: () => [], reviews: () => [] };
let source: FlavorSource = EMPTY;

export function setFlavorSource(s: FlavorSource | null): void {
  source = s ?? EMPTY;
}

export function flavor(): FlavorSource {
  return source;
}
