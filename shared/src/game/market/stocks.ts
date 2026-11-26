// 40 家虛構集團（上市標的）。公司名全是虛構的；介紹文字可以提到真實地名，但不能用真實品牌。
// 既有 16 檔的 id、基準價與波動參數凍結（價格由「種子＋鍵雜湊」決定，改了會讓歷史變樣）。
import type { SignalId } from "./signals";

export type StockKind = "defensive" | "normal" | "growth";
/** 上市區分：prime＝大型、standard＝中型、growth＝新興（玩家商場 IPO 日後掛在 growth） */
export type StockTier = "prime" | "standard" | "growth";

export const KIND_LABEL: Record<StockKind, string> = { defensive: "防禦型", normal: "一般", growth: "成長型" };
export const TIER_LABEL: Record<StockTier, string> = { prime: "プライム", standard: "スタンダード", growth: "グロース" };
export const KIND_SIGMA: Record<StockKind, number> = { defensive: 0.003, normal: 0.0042, growth: 0.006 };
export const KIND_BETA: Record<StockKind, number> = { defensive: 0.6, normal: 1, growth: 1.4 };
/** 年配息率（占基準價）的預設值 */
const KIND_YIELD: Record<StockKind, number> = { defensive: 0.028, normal: 0.02, growth: 0 };

export interface StockGroup {
  /** 公開的鍵：g:<id> */
  key: string;
  name: string;
  sector: string;
  kind: StockKind;
  /** 一句話介紹 */
  blurb: string;
  /** 起始基準價（日圓） */
  base: number;
  /** 對大盤的敏感度（預設依性格） */
  beta: number;
  /** 個股每「遊戲小時」波動（v1 的每真實小時；預設依性格） */
  sigma: number;
  /** 世界訊號與權重 */
  signals: [SignalId, number][];
  /** 流通股數（供市值與日後的持股比例） */
  shares: number;
  tier: StockTier;
  /** 決算月（會計年度結束的月份；每季一次決算） */
  fiscalMonth: number;
  /** 年配息率（占基準價）；0＝不配息 */
  divYield: number;
}

interface Extra {
  beta?: number;
  sigma?: number;
  /** 流通股數（百萬股） */
  mshares?: number;
  tier?: StockTier;
  fiscal?: number;
  div?: number;
}

function group(id: string, name: string, sector: string, kind: StockKind, base: number, blurb: string, signals: [SignalId, number][], x: Extra = {}): StockGroup {
  return {
    key: `g:${id}`,
    name,
    sector,
    kind,
    base,
    blurb,
    signals,
    beta: x.beta ?? KIND_BETA[kind],
    sigma: x.sigma ?? KIND_SIGMA[kind],
    shares: Math.round((x.mshares ?? 300) * 1_000_000),
    tier: x.tier ?? "prime",
    fiscalMonth: x.fiscal ?? 3,
    divYield: x.div ?? KIND_YIELD[kind],
  };
}

export const STOCK_GROUPS: StockGroup[] = [
  // ── 既有 16 檔（參數凍結）──
  group("hokurei_rail", "北嶺鉄道グループ", "私鐵", "defensive", 2400, "北方沿線的老牌私鐵，沿線有住宅、百貨與遊園地。", [["travel", 0.7], ["payday", 0.3]], { mshares: 420 }),
  group("minato_rail", "湊電鉄グループ", "私鐵", "normal", 1850, "港灣線的私鐵，觀光客多，客流起伏比同業大。", [["travel", 0.8], ["yearend", 0.3]], { sigma: 0.0048, mshares: 360 }),
  group("yamato_travel", "大和トラベル", "旅行", "normal", 1320, "連鎖旅行社，團體旅遊與長假行程是主力。", [["travel", 1], ["wet", 0.5]], { mshares: 90, tier: "standard" }),
  group("sorakoh_air", "蒼空エアライン", "航空", "normal", 3100, "國內線為主的航空公司，旺季與淡季差距大。", [["travel", 0.9], ["wet", 0.6]], { mshares: 280 }),
  group("momiji_hotels", "紅葉ホテルズ", "飯店", "normal", 2650, "溫泉旅館與商務飯店的連鎖集團。", [["travel", 0.9], ["wet", 0.3]], { mshares: 150, fiscal: 12 }),
  group("mizuho_energy", "瑞穂エナジー", "電力瓦斯", "defensive", 1780, "區域電力與瓦斯，冷氣與暖氣用得越兇、用量越大。", [["extreme", 1]], { mshares: 520 }),
  group("asagiri_foods", "朝霧フーズ", "食品", "defensive", 960, "冷凍食品與調味料，家庭聚會的日子賣得好。", [["holiday", 0.8], ["travel", 0.2]], { mshares: 310 }),
  group("seiryu_beverage", "清流ビバレッジ", "飲料", "normal", 740, "礦泉水、茶飲與運動飲料，天氣一熱就好賣。", [["heat", 1]], { mshares: 450, fiscal: 12 }),
  group("hinata_retail", "日向リテール", "超市便利店", "defensive", 1420, "社區超市與便利商店，發薪日與假日客人多。", [["payday", 0.7], ["holiday", 0.5]], { mshares: 380, fiscal: 2 }),
  group("hoshino_ent", "星野エンタメ", "娛樂", "growth", 1560, "電影院、遊樂場與演唱會製作。", [["holiday", 0.9], ["travel", 0.4]], { mshares: 140, tier: "standard", div: 0.008 }),
  group("aoba_estate", "あおば不動産", "不動產", "normal", 2980, "住宅開發與仲介，3、4 月搬家季是旺季。", [["moving", 1]], { mshares: 200 }),
  group("takanosu_const", "鷹ノ巣建設", "建設", "normal", 2210, "土木與建築，年度末集中結案，雨天工期延誤。", [["fiscal", 0.9], ["wet", 0.4]], { mshares: 240 }),
  group("shirasagi_pharma", "白鷺製薬", "製藥", "defensive", 4200, "感冒藥與保健品，換季時需求上升。", [["season", 0.8]], { mshares: 160 }),
  group("todai_soft", "灯台ソフト", "資訊科技", "growth", 880, "企業用軟體與雲端服務，股價只看市場情緒。", [], { sigma: 0.0068, mshares: 220, div: 0.004 }),
  group("tokiwa_fin", "常盤フィナンシャル", "金融", "defensive", 1190, "地方銀行與信用卡，景氣好壞影響大。", [["payday", 0.6], ["yearend", 0.3]], { beta: 1.2, sigma: 0.0034, mshares: 600 }),
  group("mitsuhashi_trading", "三津橋商事", "綜合商社", "normal", 1500, "什麼都做一點的商社，股價大致就是大盤。", [], { beta: 1, sigma: 0.0036, mshares: 700 }),
  // ── 新增 24 檔 ──
  group("tokai_semi", "東海セミコン", "半導體", "growth", 5200, "在東海地區設廠的半導體材料與製造設備商，景氣循環大。", [], { beta: 1.6, sigma: 0.0075, mshares: 120, div: 0.006 }),
  group("kuroshio_robotics", "黒潮ロボティクス", "機械機器人", "growth", 3400, "工廠自動化與物流機器人，客戶以製造業與倉儲為主。", [["fiscal", 0.3]], { beta: 1.4, sigma: 0.0062, mshares: 110, div: 0.008 }),
  group("shinano_motors", "信濃モーターズ", "汽車", "normal", 2150, "中型車廠，輕型車與商用車為主，假日與發薪日有展示場人潮。", [["holiday", 0.3], ["payday", 0.3]], { mshares: 480 }),
  group("nanbu_steel", "南部製鉄", "鋼鐵", "normal", 780, "高爐與電爐並用的鋼鐵廠，與建設、造船景氣連動。", [["fiscal", 0.6]], { sigma: 0.0046, mshares: 640, fiscal: 3 }),
  group("hokuto_chem", "北斗化学", "化學", "normal", 3300, "基礎化學品與電子材料，原料價格是最大變數。", [["season", 0.3]], { mshares: 170 }),
  group("kaiyo_shipping", "海洋シッピング", "造船海運", "normal", 1650, "貨櫃船與散裝船，橫濱、神戶港都有航線，風浪天候影響運價。", [["wet", 0.4], ["travel", 0.2]], { sigma: 0.0052, mshares: 260, div: 0.03 }),
  group("hayate_logi", "疾風ロジスティクス", "物流宅配", "normal", 1980, "宅配與倉配一貫的物流集團，發薪日與假日前後件量暴增。", [["payday", 0.5], ["holiday", 0.4]], { mshares: 330 }),
  group("ginsei_warehouse", "銀星倉庫", "倉儲", "defensive", 1320, "港區與內陸的冷凍冷藏倉庫，搬家季旺。", [["moving", 0.5]], { mshares: 130, tier: "standard" }),
  group("tsubame_tel", "つばめ通信", "電信", "defensive", 1890, "行動通訊與光纖，現金流穩定、配息高。", [], { sigma: 0.0028, mshares: 800, div: 0.034 }),
  group("kagaribi_pay", "篝火ペイメント", "電商支付", "growth", 2750, "行動支付與電商平台，發薪日與假日是消費高峰。", [["payday", 0.6], ["holiday", 0.4]], { beta: 1.5, sigma: 0.0066, mshares: 190, div: 0 }),
  group("hoshikuzu_games", "星屑ゲームス", "遊戲", "growth", 4100, "手機遊戲與主機遊戲，新作發表前後波動很大。", [["holiday", 0.8]], { beta: 1.5, sigma: 0.0072, mshares: 100, div: 0.005 }),
  group("akebono_comics", "曙コミックス", "動漫出版", "normal", 1240, "漫畫雜誌與動畫授權，連休與長假的周邊商品好賣。", [["holiday", 0.6]], { mshares: 85, tier: "standard", fiscal: 9 }),
  group("kagayaki_ad", "輝広告社", "廣告媒體", "normal", 2060, "電視、電車與網路廣告代理，年度末與年末年始預算多。", [["fiscal", 0.5], ["yearend", 0.4]], { sigma: 0.0046, mshares: 150, tier: "standard", fiscal: 12 }),
  group("kyowa_staff", "共和スタッフ", "人力派遣", "normal", 1470, "人力派遣與外包，4 月新年度與搬家季需求多。", [["moving", 0.5]], { sigma: 0.0045, mshares: 120, tier: "standard" }),
  group("manabiya_edu", "まなびや教育", "教育", "defensive", 1060, "補習班與線上教材，新學期前後招生。", [["moving", 0.3], ["fiscal", 0.5]], { mshares: 75, tier: "standard", fiscal: 3 }),
  group("shokutakutei", "食卓亭グループ", "外食連鎖", "normal", 1720, "家庭餐廳與定食連鎖，假日與發薪日客人多。", [["holiday", 0.7], ["payday", 0.4]], { mshares: 210, fiscal: 2 }),
  group("hakuen_dept", "白苑百貨店", "百貨零售", "normal", 1610, "市中心的老牌百貨，年末年始與假日是旺季，雨天客人少。", [["holiday", 0.9], ["yearend", 0.6], ["wet", 0.3]], { mshares: 230, fiscal: 2 }),
  group("midori_drug", "みどりドラッグ", "藥妝", "defensive", 2340, "藥妝連鎖，換季與花粉季賣藥，發薪日買日用品。", [["season", 0.5], ["payday", 0.3]], { mshares: 160, fiscal: 5 }),
  group("shinkai_medical", "深海メディカル", "醫療器材", "normal", 3750, "內視鏡與診斷設備，醫院預算週期是最大變數。", [], { sigma: 0.0038, mshares: 140 }),
  group("kasumi_life", "霞生命保険", "保險", "defensive", 2980, "壽險與醫療險，利率環境影響大。", [["fiscal", 0.3]], { beta: 0.9, mshares: 350 }),
  group("kodama_securities", "木霊証券", "證券", "growth", 920, "零售證券商，行情熱絡時手續費收入大增。", [], { beta: 1.8, sigma: 0.007, mshares: 300, div: 0.02 }),
  group("hikari_renewable", "ひかり再生エネルギー", "再生能源", "growth", 1510, "太陽能與風力發電，日照與天候影響發電量。", [["heat", 0.4]], { beta: 1.3, sigma: 0.0064, mshares: 180, tier: "standard", div: 0.006 }),
  group("suito_waterworks", "水都ウォーターワークス", "水務", "defensive", 1250, "自來水與污水處理的民營化事業，用水尖峰在酷暑。", [["extreme", 0.4]], { sigma: 0.0026, mshares: 200, tier: "standard" }),
  group("minato_reit", "みなと商業リート投資法人", "REIT", "defensive", 1700, "持有商場與商店街店面的不動產投資信託，租金收入穩定、配息率高。", [["holiday", 0.5], ["travel", 0.3]], { sigma: 0.0027, mshares: 60, tier: "standard", div: 0.045, fiscal: 6 }),
];

/** 既有 16 檔（價格歷史凍結；v1 引擎只用它們） */
export const LEGACY_STOCK_COUNT = 16;

const GROUP_BY_KEY = new Map(STOCK_GROUPS.map((g) => [g.key, g]));
export const stockGroupOf = (key: string): StockGroup | undefined => GROUP_BY_KEY.get(key);

/** 每次配息的每股金額（年配息率 ÷ 2，取整；最少 0） */
export const dividendPerShare = (g: StockGroup): number => Math.max(0, Math.round((g.base * g.divYield) / 2));
