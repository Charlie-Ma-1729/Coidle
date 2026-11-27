import type { CategoryId } from "./types";
import generated from "./brands.generated.json";

// 品牌目錄：全服共用的虛構品牌（不使用真實企業名）。
// 同一個品牌在不同商場都是同一個名字（＝連鎖）；同一個商場可以有同業態的不同品牌。
// 店名等於品牌名即視為該品牌的分店；玩家自取的店名則是獨立小店。
// 招商候選會優先從這裡抽（知名度與品質用這裡的設定）；自營店掛品牌目前只影響店名與介紹，不改平衡。

export type BrandTier = "budget" | "standard" | "premium";

export interface BrandDef {
  id: string;
  name: string;
  category: CategoryId;
  tier: BrandTier;
  /** 0–100：知名度 */
  fame: number;
  /** 0.5–0.95：營運品質 */
  quality: number;
  blurb: string;
}

export const BRAND_TIER_NAME: Record<BrandTier, string> = { budget: "平價", standard: "一般", premium: "高級" };

const b = (id: string, name: string, category: CategoryId, tier: BrandTier, fame: number, quality: number, blurb: string): BrandDef => ({ id, name, category, tier, fame, quality, blurb });

/** B1 手寫的第一批（開局預設店在這裡） */
const HAND_BRANDS: BrandDef[] = [
  // 拉麵
  b("ramen_ittetsu", "麵屋 一徹", "ramen", "standard", 50, 0.72, "老街出身的醬油拉麵，湯頭每天現熬。"),
  b("ramen_hayate", "拉麵 疾風", "ramen", "budget", 38, 0.6, "學生也吃得起的大碗豚骨，出餐飛快。"),
  b("ramen_kikusui", "鶴ヶ岳 らーめん", "ramen", "premium", 66, 0.86, "只用當日熬的雞白湯，限量供應。"),
  // 章魚燒／大阪燒
  b("tako_fuku", "章魚福", "takoyaki", "standard", 48, 0.7, "外酥內軟的章魚燒，招牌是柚子胡椒口味。"),
  b("tako_marumaru", "丸々燒", "takoyaki", "budget", 36, 0.58, "八顆一盒的平價點心，放學時段大排長龍。"),
  b("tako_naniwa", "浪花鐵板屋", "takoyaki", "premium", 62, 0.84, "現點現煎的大阪燒，鐵板在客人面前翻面。"),
  // 串炸
  b("kushi_hachi", "串八", "kushikatsu", "standard", 52, 0.72, "一串一串現炸，醬汁只能沾一次。"),
  b("kushi_tengu", "天狗串揚", "kushikatsu", "budget", 40, 0.6, "每串一百圓的庶民吃法，下班族的最愛。"),
  b("kushi_seiran", "青嵐 串炸工房", "kushikatsu", "premium", 64, 0.86, "季節食材與無麩質粉衣的精緻串炸。"),
  // 喫茶咖啡
  b("kissa_tsukimi", "喫茶 月見", "kissaten", "standard", 50, 0.74, "昭和風的虹吸咖啡與厚片吐司。"),
  b("kissa_donguri", "どんぐり珈琲", "kissaten", "budget", 36, 0.6, "早餐套餐很划算的連鎖喫茶。"),
  b("kissa_ginza", "銀鈴 咖啡館", "kissaten", "premium", 68, 0.88, "自家烘焙單品豆與手沖，座位寬敞安靜。"),
  // 超市
  b("mart_maruya", "丸屋超市", "grocery", "standard", 46, 0.7, "在地人買菜的老字號。"),
  b("mart_hinata", "日向マート", "grocery", "budget", 40, 0.62, "天天特價的社區超市。"),
  b("mart_kogane", "黃金穗 精選市場", "grocery", "premium", 62, 0.85, "產地直送的蔬果與熟成魚肉。"),
  // 烏龍麵
  b("udon_sanuki", "讚岐 麵之助", "udon", "standard", 48, 0.72, "手打麵條，彈牙度是招牌。"),
  b("udon_kame", "龜印烏龍", "udon", "budget", 38, 0.6, "自助式配料的平價烏龍。"),
  b("udon_shirakumo", "白雲 手打庵", "udon", "premium", 62, 0.85, "每桌現煮、附天婦羅拼盤。"),
  // 手搖飲
  b("tea_koharu", "小春茶房", "bubble_tea", "standard", 54, 0.7, "鮮奶茶與手炒黑糖珍珠。"),
  b("tea_pokapoka", "ぽかぽか茶屋", "bubble_tea", "budget", 42, 0.58, "天天有特價的學生愛店。"),
  b("tea_reimei", "黎明 茶研", "bubble_tea", "premium", 60, 0.84, "單一茶園茶葉，冷泡現萃。"),
  // 和菓子／甜點
  b("sweets_kasuga", "春日堂", "sweets", "standard", 52, 0.74, "當季和菓子與抹茶聖代。"),
  b("sweets_mochi", "もちもち屋", "sweets", "budget", 38, 0.6, "平價大福與糰子，外帶專門。"),
  b("sweets_kyoraku", "京樂 菓匠", "sweets", "premium", 66, 0.88, "職人手工上生菓子，節慶限定禮盒。"),
  // 咖哩飯
  b("curry_tora", "虎咖哩", "curry", "standard", 50, 0.7, "香料偏重的日式咖哩，辣度可選。"),
  b("curry_kintaro", "金太郎カレー", "curry", "budget", 40, 0.6, "加飯免費的實惠咖哩。"),
  b("curry_shiratori", "白鳥 洋食堂", "curry", "premium", 62, 0.85, "燉牛肉三天的老洋食店咖哩。"),
  // 餃子・中華小吃
  b("gyoza_ryu", "龍華餃子", "gyoza", "standard", 50, 0.7, "皮薄汁多的煎餃，搭配自家辣油。"),
  b("gyoza_daifuku", "大福軒", "gyoza", "budget", 38, 0.58, "六個一份的便宜定食。"),
  b("gyoza_shunkei", "春景 點心樓", "gyoza", "premium", 62, 0.84, "點心師傅現包的蒸籠點心。"),
  // 飯糰・便當
  b("onigiri_tsubame", "つばめ握飯", "onigiri", "standard", 48, 0.7, "現捏的三角飯糰，海苔現烤。"),
  b("onigiri_asa", "朝市便當", "onigiri", "budget", 38, 0.6, "早班族的平價便當。"),
  b("onigiri_shiori", "栞 御膳弁當", "onigiri", "premium", 60, 0.84, "季節配菜的精緻便當。"),
  // 鯛魚燒・點心屋
  b("taiyaki_tai", "鯛之助", "taiyaki", "standard", 48, 0.7, "皮脆餡滿的鯛魚燒，紅豆與卡士達兩種經典。"),
  b("taiyaki_hoshi", "星の鯛焼き", "taiyaki", "budget", 38, 0.58, "冬天排隊的平價點心。"),
  b("taiyaki_koharu", "小春 御菓子處", "taiyaki", "premium", 58, 0.82, "限量手工餡料的名物。"),
  // 關東煮
  b("oden_komachi", "小町おでん", "oden", "standard", 48, 0.7, "高湯慢火熬煮，蘿蔔入味。"),
  b("oden_yokocho", "橫丁屋台", "oden", "budget", 38, 0.6, "夜裡也營業的平價關東煮。"),
  b("oden_kasumi", "霞 關東煮", "oden", "premium", 58, 0.82, "昆布與鰹節雙重高湯。"),
  // 蕎麥麵
  b("soba_yabu", "藪の庵", "soba", "standard", 48, 0.72, "石臼現磨的蕎麥麵。"),
  b("soba_mugi", "麥屋 立食", "soba", "budget", 38, 0.6, "站著吃的快速午餐。"),
  b("soba_sarashina", "更科 蕎麥處", "soba", "premium", 62, 0.86, "十割蕎麥與季節天婦羅。"),
  // 麵包烘焙坊
  b("bakery_kome", "米麥麵包坊", "bakery", "standard", 50, 0.72, "每日現烤的吐司與可頌。"),
  b("bakery_pan", "パン太郎", "bakery", "budget", 40, 0.6, "晚間特價的平價烘焙。"),
  b("bakery_aoi", "葵 烘焙工房", "bakery", "premium", 64, 0.86, "天然酵母的歐式麵包。"),
  // 唐揚雞
  b("karaage_kokko", "こっこ唐揚", "karaage", "standard", 50, 0.7, "鹽麴醃漬的多汁唐揚。"),
  b("karaage_gaburi", "ガブリ屋", "karaage", "budget", 40, 0.6, "桶裝分享包，學生團購常客。"),
  b("karaage_yamabuki", "山吹 鶏料理", "karaage", "premium", 60, 0.84, "只用地雞，附特製沾醬。"),
  // 鮮榨果汁
  b("juice_mikan", "蜜柑ジュース", "juice_bar", "standard", 48, 0.7, "現壓柑橘類果汁。"),
  b("juice_pururun", "ぷるるん果汁", "juice_bar", "budget", 38, 0.58, "果凍與果汁的平價組合。"),
  b("juice_midori", "翠 蔬果研究所", "juice_bar", "premium", 58, 0.84, "冷壓蔬果汁與機能飲品。"),
];

/**
 * 其餘品牌由 `server/src/ai/brandcatalog.ts` 離線生成（Haiku 5.5）、驗證後再人工逐筆審過：
 * 每個業態 6 個（平價／一般／高級各 2；B1 手寫 3 個＋生成 3 個）。知名度與品質由定位決定。
 */
export const BRANDS: BrandDef[] = [...HAND_BRANDS, ...(generated as BrandDef[])];

export const BRAND_BY_ID: Record<string, BrandDef> = Object.fromEntries(BRANDS.map((x) => [x.id, x]));
const BY_NAME: Record<string, BrandDef> = Object.fromEntries(BRANDS.map((x) => [x.name, x]));

export function brandByName(name: string): BrandDef | undefined {
  return BY_NAME[name];
}

export function brandsOfCategory(category: CategoryId): BrandDef[] {
  return BRANDS.filter((x) => x.category === category);
}
