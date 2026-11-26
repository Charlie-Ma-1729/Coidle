import { CATEGORY_BY_ID, SUPPLY_LEAD_TICKS, SUPPLY_LOT, TICKS_PER_DAY } from "./data";
import type { MallState, Shop, SupplierDef, SupplierState, SupplyFamily } from "./types";

// 供應商：進貨不再只是一個全域價格倍率，而是和具體的「人」打交道。
// 店名、人名全部虛構。

export const SUPPLY_FAMILIES: Record<SupplyFamily, { name: string; icon: string }> = {
  meat: { name: "肉類", icon: "🥩" },
  seafood: { name: "海鮮", icon: "🐙" },
  grain: { name: "麵與米", icon: "🍜" },
  produce: { name: "蔬果雜貨", icon: "🥬" },
  sweets: { name: "甜點飲品原料", icon: "🧁" },
  goods: { name: "商品批貨", icon: "📦" },
  drinks: { name: "酒類飲品", icon: "🍶" },
  apparel: { name: "服飾布料", icon: "👗" },
  beauty: { name: "美妝藥品", icon: "💄" },
  tech: { name: "電子零件周邊", icon: "🔌" },
  culture: { name: "書籍文創教材", icon: "📚" },
  medical: { name: "醫療健康耗材", icon: "🩺" },
  venue: { name: "場館設備內容", icon: "🎬" },
  hospitality: { name: "旅宿事務備品", icon: "🛎️" },
};

export const FAMILY_ORDER: SupplyFamily[] = [
  "meat",
  "seafood",
  "grain",
  "produce",
  "sweets",
  "drinks",
  "goods",
  "apparel",
  "beauty",
  "tech",
  "culture",
  "medical",
  "venue",
  "hospitality",
];

/** 這幾類是食品：進貨適用軽減稅率；其餘一律標準稅率 */
export const FOOD_FAMILIES: SupplyFamily[] = ["meat", "seafood", "grain", "produce", "sweets"];

// 沒有庫存的業態（娛樂／服務／商務）不進貨，改以「耗材」計價：供應商價格與品質、供貨衝擊都會影響每筆服務的成本

/** 每種需要進貨的業態，原料來自哪一類供應商 */
export const FAMILY_OF: Record<string, SupplyFamily> = {
  kushikatsu: "meat",
  yakiniku: "meat",
  fastfood: "meat",
  curry: "meat",
  fine_dining: "meat",
  takoyaki: "seafood",
  sushi: "seafood",
  izakaya: "seafood",
  ramen: "grain",
  udon: "grain",
  italian: "grain",
  brunch: "grain",
  grocery: "produce",
  hotpot: "produce",
  kissaten: "sweets",
  bubble_tea: "sweets",
  sweets: "sweets",
  bar: "drinks",
  fashion: "apparel",
  drugstore: "beauty",
  select_shop: "goods",
  electronics: "tech",
  bookstore: "culture",
  stationery: "culture",
  popup: "goods",
  gyoza: "meat",
  karaage: "meat",
  tonkatsu: "meat",
  teppanyaki: "meat",
  food_truck: "meat",
  unagi: "seafood",
  kaiseki: "seafood",
  onigiri: "grain",
  soba: "grain",
  bakery: "grain",
  oden: "produce",
  juice_bar: "produce",
  convenience: "produce",
  florist: "produce",
  taiyaki: "sweets",
  craft_beer: "drinks",
  wine_bar: "drinks",
  beer_garden: "drinks",
  cosmetics: "beauty",
  shoes: "apparel",
  accessory: "apparel",
  toy_store: "culture",
  camera: "tech",
  anime_goods: "culture",
  gamestore: "tech",
  vinyl: "culture",
  flea_market: "goods",
  // ── 沒有庫存的業態：耗材供應
  cinema: "venue",
  bowling: "venue",
  karaoke: "venue",
  live_house: "venue",
  escape_room: "venue",
  kids_play: "venue",
  arcade_vr: "venue",
  claw: "venue",
  event_space: "venue",
  observatory: "venue",
  parking: "venue",
  art_gallery: "culture",
  craft_studio: "culture",
  photo_studio: "culture",
  cram_school: "culture",
  repair: "tech",
  clinic: "medical",
  dental: "medical",
  daycare: "medical",
  gym: "medical",
  yoga: "medical",
  salon: "beauty",
  nail: "beauty",
  spa: "beauty",
  hotel: "hospitality",
  capsule_hotel: "hospitality",
  luggage: "hospitality",
  conference: "hospitality",
  coworking: "hospitality",
  print_shop: "hospitality",
  travel_agency: "hospitality",
  laundry: "hospitality",
};

export const SUPPLIERS: SupplierDef[] = [
  // ── 肉類
  { id: "meat_maru", name: "丸三精肉", family: "meat", price: 1.0, quality: 0.75, reliability: 0.85, lead: 1, bio: "三代經營的老肉鋪，做事一板一眼，從不出大包。" },
  { id: "meat_yama", invoice: false, name: "山下食肉", family: "meat", price: 0.9, quality: 0.62, reliability: 0.7, lead: 1.1, bio: "價格最便宜，缺點是偶爾會「記錯」出貨日。" },
  { id: "meat_kuro", name: "黑門肉鋪", family: "meat", price: 1.15, quality: 0.92, reliability: 0.9, lead: 0.9, bio: "只做高級和牛生意，老闆脾氣很大，但肉真的好。" },
  { id: "meat_import", invoice: false, name: "海外直輸肉品", family: "meat", price: 0.85, quality: 0.8, reliability: 0.6, lead: 1.3, bio: "新開的進口商，價格漂亮，但貨運常常延誤。", hidden: true },
  // ── 海鮮
  { id: "sea_naniwa", name: "浪花水產", family: "seafood", price: 1.0, quality: 0.75, reliability: 0.85, lead: 1, bio: "市場裡最老牌的海鮮批發，大家都叫老闆「阿浪」。" },
  { id: "sea_minato", invoice: false, name: "港口鮮魚組合", family: "seafood", price: 0.92, quality: 0.65, reliability: 0.7, lead: 1, bio: "漁會組合，便宜實惠，但天氣一差就沒貨。" },
  { id: "sea_asaichi", name: "朝市直送屋", family: "seafood", price: 1.2, quality: 0.95, reliability: 0.88, lead: 0.85, bio: "凌晨直送、當日鮮度，價格也是當日最高。" },
  { id: "sea_farm", invoice: false, name: "近海養殖社", family: "seafood", price: 0.88, quality: 0.78, reliability: 0.65, lead: 1.2, bio: "新興的養殖業者，產量穩定但規模還小。", hidden: true },
  // ── 麵與米
  { id: "grain_yoneda", name: "米田製麵所", family: "grain", price: 1.0, quality: 0.78, reliability: 0.88, lead: 1, bio: "自家製麵，湯麵、烏龍麵都靠他們。" },
  { id: "grain_yamato", invoice: false, name: "大和穀物", family: "grain", price: 0.9, quality: 0.64, reliability: 0.75, lead: 1.1, bio: "大量批發，價格漂亮，品質中規中矩。" },
  { id: "grain_roho", name: "老舖麵粉店", family: "grain", price: 1.1, quality: 0.9, reliability: 0.85, lead: 1, bio: "堅持石臼研磨，餐廳主廚們私下的口袋名單。" },
  { id: "grain_organic", name: "有機契作農場", family: "grain", price: 1.05, quality: 0.86, reliability: 0.6, lead: 1.3, bio: "剛起步的契作農場，數量有限，要碰運氣。", hidden: true },
  // ── 蔬果雜貨
  { id: "prod_yaoshou", name: "八百正青果", family: "produce", price: 1.0, quality: 0.75, reliability: 0.85, lead: 1, bio: "市場口碑很好的青果商，什麼菜都拿得到。" },
  { id: "prod_farm", invoice: false, name: "契約農家組合", family: "produce", price: 0.9, quality: 0.7, reliability: 0.72, lead: 1.1, bio: "直接向農家收購，新鮮便宜，產量看天吃飯。" },
  { id: "prod_market", name: "市場問屋", family: "produce", price: 1.05, quality: 0.8, reliability: 0.9, lead: 0.9, bio: "最可靠的批發商，貴一點但從不跳票。" },
  { id: "prod_green", name: "城市垂直農場", family: "produce", price: 1.1, quality: 0.88, reliability: 0.65, lead: 1.1, bio: "大樓裡種菜的新創，標榜無農藥，價格偏高。", hidden: true },
  // ── 甜點飲品原料
  { id: "sweet_kanmi", name: "甘味原料商", family: "sweets", price: 1.0, quality: 0.78, reliability: 0.85, lead: 1, bio: "和菓子、甜點店的老朋友，原料細緻。" },
  { id: "sweet_mame", invoice: false, name: "喫茶豆屋", family: "sweets", price: 0.92, quality: 0.7, reliability: 0.78, lead: 1, bio: "咖啡豆與茶葉專賣，老闆很愛聊天。" },
  { id: "sweet_dairy", name: "乳製品協同", family: "sweets", price: 1.08, quality: 0.85, reliability: 0.8, lead: 0.95, bio: "牧場合作社，牛奶和鮮奶油品質穩定。" },
  { id: "sweet_craft", name: "手作工坊原料行", family: "sweets", price: 1.15, quality: 0.93, reliability: 0.6, lead: 1.2, bio: "新開的精品原料行，限量供應，價格不手軟。", hidden: true },
  // ── 商品批貨
  { id: "goods_tonya", name: "問屋街批發", family: "goods", price: 1.0, quality: 0.72, reliability: 0.85, lead: 1, bio: "老批發街的老店，百貨雜貨樣樣有。" },
  { id: "goods_trade", invoice: false, name: "直營貿易行", family: "goods", price: 0.9, quality: 0.65, reliability: 0.7, lead: 1.2, bio: "走低價路線的貿易商，品牌參差不齊。" },
  { id: "goods_agent", name: "品牌代理商", family: "goods", price: 1.15, quality: 0.9, reliability: 0.9, lead: 0.9, bio: "專營知名品牌代理，授權完整，價格偏高。" },
  { id: "goods_indie", invoice: false, name: "獨立設計師聯盟", family: "goods", price: 1.05, quality: 0.85, reliability: 0.6, lead: 1.3, bio: "一群獨立設計師的集合，商品很有個性。", hidden: true },
  // ── 肉類（新增）
  { id: "meat_ranch", name: "北原牧場直送", family: "meat", price: 1.08, quality: 0.85, reliability: 0.8, lead: 1, bio: "牧場自己宰殺自己配送，品質穩定，價格不便宜。" },
  { id: "meat_wholesale", name: "中央食肉市場問屋", family: "meat", price: 0.95, quality: 0.68, reliability: 0.9, lead: 0.95, bio: "市場裡最大的肉品批發，量大、準時，品質普通。" },
  // ── 海鮮（新增）
  { id: "sea_fishcoop", name: "漁協直營所", family: "seafood", price: 0.95, quality: 0.72, reliability: 0.8, lead: 1.05, bio: "漁協自己經營的賣場，看當天漁獲決定有什麼。" },
  { id: "sea_frozen", invoice: false, name: "冷凍海產商社", family: "seafood", price: 0.85, quality: 0.6, reliability: 0.88, lead: 1.15, bio: "主打冷凍進口，便宜耐放，鮮度就別要求太多。" },
  // ── 麵與米（新增）
  { id: "grain_coop", name: "農協米穀部", family: "grain", price: 0.98, quality: 0.76, reliability: 0.9, lead: 1, bio: "農協的米穀部門，每年收成後固定供貨。" },
  { id: "grain_flour", name: "製粉聯合", family: "grain", price: 0.88, quality: 0.66, reliability: 0.85, lead: 1.1, bio: "大型製粉廠聯盟，價格有競爭力。" },
  // ── 蔬果雜貨（新增）
  { id: "prod_north", name: "北國蔬果直送", family: "produce", price: 1.1, quality: 0.86, reliability: 0.78, lead: 1.1, bio: "從北方產地直接冷鏈運來，甜度是招牌。" },
  { id: "prod_oroshi", name: "青果市場大卸", family: "produce", price: 0.88, quality: 0.66, reliability: 0.88, lead: 1, bio: "清晨拍賣的大批發，便宜但要自己挑。" },
  // ── 甜點飲品原料（新增）
  { id: "sweet_choco", name: "巧克力工藝商", family: "sweets", price: 1.12, quality: 0.9, reliability: 0.75, lead: 1.1, bio: "專做可可與巧克力原料，甜點師傅的最愛。" },
  { id: "sweet_sugar", name: "砂糖製菓原料", family: "sweets", price: 0.9, quality: 0.68, reliability: 0.9, lead: 1, bio: "砂糖、麵粉、膨脹劑的大宗供應，樸實可靠。" },
  // ── 商品批貨（新增）
  { id: "goods_online", invoice: false, name: "網路批發聯盟", family: "goods", price: 0.88, quality: 0.62, reliability: 0.72, lead: 1.15, bio: "網路平台上的批發聯盟，比價很兇，售後比較隨便。" },
  { id: "goods_select", name: "選物買手社", family: "goods", price: 1.12, quality: 0.88, reliability: 0.78, lead: 1, bio: "買手從各地蒐集特色商品，款式少而精。" },
  // ── 酒類飲品
  { id: "drink_nada", name: "灘酒造組合", family: "drinks", price: 1.0, quality: 0.8, reliability: 0.88, lead: 1, bio: "老牌酒造組合，日本酒與燒酎品項齊全。" },
  { id: "drink_import", name: "洋酒輸入商", family: "drinks", price: 1.15, quality: 0.9, reliability: 0.85, lead: 1.1, bio: "威士忌、葡萄酒、烈酒的進口代理，關稅與匯率都算在價格裡。" },
  { id: "drink_jizake", invoice: false, name: "地酒小藏", family: "drinks", price: 1.05, quality: 0.85, reliability: 0.65, lead: 1.2, bio: "小酒藏的限量地酒，產量少、要看天吃飯。" },
  { id: "drink_oroshi", name: "酒類卸問屋", family: "drinks", price: 0.92, quality: 0.68, reliability: 0.9, lead: 1, bio: "酒類批發商，什麼酒都有，價格實在。" },
  { id: "drink_craft", name: "手工啤酒釀造所", family: "drinks", price: 1.1, quality: 0.88, reliability: 0.7, lead: 1.1, bio: "獨立釀造所，啤酒風味有個性，產量不穩。" },
  { id: "drink_vintage", name: "稀少年份收藏商", family: "drinks", price: 1.25, quality: 0.97, reliability: 0.55, lead: 1.3, bio: "專門蒐集稀有年份酒的收藏家，貨源看運氣。", hidden: true },
  // ── 服飾布料
  { id: "app_tonya", name: "纖維問屋街", family: "apparel", price: 1.0, quality: 0.72, reliability: 0.85, lead: 1, bio: "老批發街的布料與成衣批發，款式多、品質中等。" },
  { id: "app_brand", name: "品牌卸商會", family: "apparel", price: 1.15, quality: 0.9, reliability: 0.9, lead: 0.9, bio: "主流品牌的卸商，季節新品同步到貨。" },
  { id: "app_fast", invoice: false, name: "快時尚量產商", family: "apparel", price: 0.85, quality: 0.6, reliability: 0.8, lead: 1.1, bio: "走量的快時尚供應鏈，價格低、汰換快。" },
  { id: "app_mill", name: "國產織物工房", family: "apparel", price: 1.1, quality: 0.88, reliability: 0.7, lead: 1.2, bio: "產地織物工房，質感好，下單要排隊。" },
  { id: "app_import", name: "海外直輸衣料", family: "apparel", price: 0.9, quality: 0.75, reliability: 0.6, lead: 1.3, bio: "從海外直接進口，便宜但海運常延誤。" },
  { id: "app_atelier", name: "高級訂製工作室", family: "apparel", price: 1.3, quality: 0.95, reliability: 0.55, lead: 1.3, bio: "少數設計師才找得到的工作室，只對熟人供貨。", hidden: true },
  // ── 美妝藥品
  { id: "bea_pharma", name: "調劑藥品卸", family: "beauty", price: 1.0, quality: 0.8, reliability: 0.9, lead: 1, bio: "藥品與保健品的老牌卸商，許可證齊全。" },
  { id: "bea_cosme", name: "化妝品代理商", family: "beauty", price: 1.12, quality: 0.88, reliability: 0.88, lead: 0.95, bio: "國際美妝品牌的代理商，新品首發有保障。" },
  { id: "bea_salon", name: "沙龍專業品商", family: "beauty", price: 1.05, quality: 0.85, reliability: 0.85, lead: 1, bio: "專供美容院與美髮廳的專業用品。" },
  { id: "bea_daily", name: "日用雜貨卸", family: "beauty", price: 0.88, quality: 0.65, reliability: 0.85, lead: 1, bio: "洗沐用品、日用品的大批發，價格漂亮。" },
  { id: "bea_direct", invoice: false, name: "海外美妝直輸", family: "beauty", price: 0.92, quality: 0.78, reliability: 0.65, lead: 1.3, bio: "海外網紅品牌的直輸商，潮流跟得快，貨運不穩。" },
  { id: "bea_natural", name: "天然成分研究室", family: "beauty", price: 1.2, quality: 0.92, reliability: 0.6, lead: 1.2, bio: "大學實驗室出身的天然原料商，只做小批量。", hidden: true },
  // ── 電子零件周邊
  { id: "tec_denki", name: "電氣街零件問屋", family: "tech", price: 1.0, quality: 0.75, reliability: 0.85, lead: 1, bio: "零件、線材、週邊的老批發街，什麼都找得到。" },
  { id: "tec_agent", name: "原廠授權代理", family: "tech", price: 1.15, quality: 0.92, reliability: 0.9, lead: 0.9, bio: "主流廠牌的授權代理，保固與供貨最穩。" },
  { id: "tec_direct", invoice: false, name: "海外電子直輸", family: "tech", price: 0.82, quality: 0.62, reliability: 0.65, lead: 1.4, bio: "海外工廠直輸，便宜但品質參差、運送慢。" },
  { id: "tec_repair", name: "維修零件商社", family: "tech", price: 0.95, quality: 0.78, reliability: 0.8, lead: 1, bio: "專供維修店的零件商，舊型號也有貨。" },
  { id: "tec_game", name: "遊戲發行卸", family: "tech", price: 1.05, quality: 0.85, reliability: 0.88, lead: 1, bio: "遊戲軟體與周邊的發行卸商。" },
  { id: "tec_proto", name: "試作工房聯盟", family: "tech", price: 1.2, quality: 0.9, reliability: 0.55, lead: 1.2, bio: "一群工程師的試作工房，偶爾能拿到獨一無二的零件。", hidden: true },
  // ── 書籍文創教材
  { id: "cul_toriji", name: "書籍取次", family: "culture", price: 1.0, quality: 0.78, reliability: 0.9, lead: 1, bio: "出版物的流通中盤，新刊與長銷書都能調到。" },
  { id: "cul_bun", name: "文具問屋", family: "culture", price: 0.95, quality: 0.75, reliability: 0.88, lead: 1, bio: "文具、紙品的老問屋，價格平實。" },
  { id: "cul_record", name: "唱片發行商", family: "culture", price: 1.08, quality: 0.85, reliability: 0.8, lead: 1.05, bio: "唱片、周邊的發行商，限量盤要搶。" },
  { id: "cul_toy", name: "玩具模型卸", family: "culture", price: 1.05, quality: 0.82, reliability: 0.85, lead: 1, bio: "玩具與模型的卸商，新品預約制。" },
  { id: "cul_art", name: "畫材美術商", family: "culture", price: 1.1, quality: 0.88, reliability: 0.78, lead: 1.1, bio: "畫材、美術用品與展場設備的專門商。" },
  { id: "cul_indie", name: "獨立出版社聯盟", family: "culture", price: 1.1, quality: 0.9, reliability: 0.6, lead: 1.25, bio: "獨立出版社與創作者的聯盟，內容有個性、數量少。", hidden: true },
  // ── 醫療健康耗材
  { id: "med_supply", name: "醫療耗材商社", family: "medical", price: 1.0, quality: 0.85, reliability: 0.92, lead: 0.95, bio: "醫療機構指定耗材商，品質檢驗嚴格。" },
  { id: "med_dental", name: "齒科材料店", family: "medical", price: 1.08, quality: 0.88, reliability: 0.88, lead: 1, bio: "牙科專用器材與材料，規格多。" },
  { id: "med_sport", name: "運動器材卸", family: "medical", price: 0.98, quality: 0.78, reliability: 0.85, lead: 1, bio: "健身房與瑜伽教室的器材與用品。" },
  { id: "med_care", name: "托育教材用品商", family: "medical", price: 0.95, quality: 0.76, reliability: 0.88, lead: 1, bio: "幼兒用品、教材與安全用具。" },
  { id: "med_group", invoice: false, name: "共同購買組合", family: "medical", price: 0.85, quality: 0.65, reliability: 0.78, lead: 1.1, bio: "小診所與工作室合組的團購組合，便宜但不挑貨。" },
  { id: "med_import", name: "海外醫材代理", family: "medical", price: 1.15, quality: 0.93, reliability: 0.6, lead: 1.3, bio: "進口高階醫材的代理，報關耗時長。", hidden: true },
  // ── 場館設備內容
  { id: "ven_film", name: "電影配給公司", family: "venue", price: 1, quality: 0.85, reliability: 0.9, lead: 1, bio: "影片與節目的配給商，檔期與分帳都要談。" },
  { id: "ven_amuse", name: "遊樂設備租賃", family: "venue", price: 1.0, quality: 0.78, reliability: 0.85, lead: 1.05, bio: "機台與遊樂設施的租賃與維修。" },
  { id: "ven_sound", name: "音響燈光商", family: "venue", price: 1.08, quality: 0.86, reliability: 0.8, lead: 1, bio: "音響、燈光、舞台設備的專業商。" },
  { id: "ven_event", name: "活動器材租賃", family: "venue", price: 0.95, quality: 0.72, reliability: 0.8, lead: 1.05, bio: "帳篷、桌椅、舞台的活動租賃。" },
  { id: "ven_license", name: "內容授權代理", family: "venue", price: 1.1, quality: 0.88, reliability: 0.78, lead: 1, bio: "音樂、影像、遊戲內容的授權代理。" },
  { id: "ven_vr", name: "VR 內容工作室", family: "venue", price: 1.2, quality: 0.92, reliability: 0.6, lead: 1.2, bio: "新創的 VR 內容工作室，作品很新、檔期很少。", hidden: true },
  // ── 旅宿事務備品
  { id: "hos_linen", name: "寢具租賃洗滌", family: "hospitality", price: 1.0, quality: 0.78, reliability: 0.9, lead: 1, bio: "旅館寢具的租賃與洗滌一條龍。" },
  { id: "hos_amenity", name: "客房備品商", family: "hospitality", price: 0.95, quality: 0.72, reliability: 0.88, lead: 1, bio: "牙刷、毛巾、備品的大宗供應。" },
  { id: "hos_office", name: "事務用品通販", family: "hospitality", price: 0.92, quality: 0.7, reliability: 0.9, lead: 0.95, bio: "影印紙、文具與辦公室用品的通販。" },
  { id: "hos_clean", name: "業務用清潔劑商", family: "hospitality", price: 0.9, quality: 0.68, reliability: 0.85, lead: 1, bio: "洗劑、消毒用品的業務用大包裝。" },
  { id: "hos_furniture", name: "飯店家具商", family: "hospitality", price: 1.15, quality: 0.9, reliability: 0.82, lead: 1.1, bio: "客房與大廳家具的專門供應商。" },
  { id: "hos_luxury", name: "高級客房備品", family: "hospitality", price: 1.25, quality: 0.95, reliability: 0.6, lead: 1.2, bio: "高級旅館才拿得到的精品備品，只做熟客。", hidden: true },
];

export const SUPPLIER_BY_ID = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s])) as Record<string, SupplierDef>;

export const SUPPLIER_SWITCH_FEE = 15_000;
export const CONTRACT_CANCEL_FEE = 30_000;
export const CONTRACT_MIN_REL = 30;
export const CONTRACT_DAYS = [7, 14] as const;
export const REL_PER_ORDER = 0.15;
/** 缺貨時，沒有長約或高關係的買家只拿得到這個比例 */
export const SHORTAGE_FILL = 0.6;
/** 向備用供應商臨時補貨（現貨）要多付的比例 */
export const SPOT_PREMIUM = 1.1;
export const PRIORITY_REL = 80;
/** 全服供應衝擊時，各層級的買家能從「缺口」裡多拿到的比例：實際供貨比例＝基礎 + (1 - 基礎) × 這個值 */
export const SHOCK_PRIORITY_SHARE = { contract: 0.85, loyal: 0.6, friend: 0.3, none: 0 } as const;
export const SHOCK_FRIEND_REL = 50;
export type ShockTier = keyof typeof SHOCK_PRIORITY_SHARE;

export function newSupplierState(def: SupplierDef): SupplierState {
  return {
    id: def.id,
    discovered: !def.hidden,
    relationship: def.hidden ? 0 : 10,
    status: "ok",
    statusUntil: 0,
    priceMult: 1,
    priceUntil: 0,
    contract: null,
    orders: 0,
  };
}

export function initialSupply(): { suppliers: SupplierState[]; choice: Record<string, string>; autoFallback: boolean } {
  const choice: Record<string, string> = {};
  for (const fam of FAMILY_ORDER) {
    const first = SUPPLIERS.find((x) => x.family === fam && !x.hidden);
    if (first) choice[fam] = first.id;
  }
  return { suppliers: SUPPLIERS.map(newSupplierState), choice, autoFallback: true };
}

type SupplyView = Pick<MallState, "supply" | "tick">;

export function supplierState(s: Pick<MallState, "supply">, id: string): SupplierState | undefined {
  return s.supply.suppliers.find((x) => x.id === id);
}

export function familyOf(category: string): SupplyFamily | null {
  return FAMILY_OF[category] ?? null;
}

/** 關係好有折扣：50 以上 5%，80 以上 10% */
export function relDiscount(rel: number): number {
  return rel >= 80 ? 0.9 : rel >= 50 ? 0.95 : 1;
}

/** 這家供應商此刻的價格倍率（含暫時漲跌、長約鎖價、關係折扣） */
export function supplierPriceNow(s: SupplyView, st: SupplierState, def: SupplierDef): number {
  const hiked = st.priceUntil > s.tick ? st.priceMult : 1;
  const base = def.price * hiked;
  const price = st.contract && st.contract.untilTick > s.tick ? st.contract.lockedMult : base;
  return price * relDiscount(st.relationship);
}

/** 沒有長約、關係也一般的情況下的市價（簽長約時鎖定的就是這個） */
export function supplierMarketPrice(s: SupplyView, st: SupplierState, def: SupplierDef): number {
  return def.price * (st.priceUntil > s.tick ? st.priceMult : 1);
}

export function supplierUnavailable(st: SupplierState, tick: number): boolean {
  return st.status !== "ok" && st.status !== "shortage" && st.statusUntil > tick;
}

export function hasContract(st: SupplierState, tick: number): boolean {
  return !!st.contract && st.contract.untilTick > tick;
}

/** 這座商場在這家供應商面前的優先層級（長約＞老主顧＞有交情＞一般） */
export function shockTier(st: SupplierState, tick: number): ShockTier {
  if (hasContract(st, tick)) return "contract";
  if (st.relationship >= PRIORITY_REL) return "loyal";
  if (st.relationship >= SHOCK_FRIEND_REL) return "friend";
  return "none";
}

/** 衝擊期間，這座商場實際能拿到的供貨比例（0–1） */
export function shockFill(base: number, tier: ShockTier): number {
  return Math.min(1, Math.max(0, base + (1 - base) * SHOCK_PRIORITY_SHARE[tier]));
}

/** 這家供應商目前「已生效」的衝擊（預告期還沒生效） */
export function liveShock(st: SupplierState, tick: number): NonNullable<SupplierState["shock"]> | null {
  const sh = st.shock;
  return sh && sh.startTick <= tick && tick < sh.endTick ? sh : null;
}

/** 這個店目前進貨的供應商（主力） */
export function chosenSupplier(s: Pick<MallState, "supply">, family: SupplyFamily): { def: SupplierDef; st: SupplierState } | null {
  const id = s.supply.choice[family];
  const def = id ? SUPPLIER_BY_ID[id] : undefined;
  const st = id ? supplierState(s, id) : undefined;
  return def && st ? { def, st } : null;
}

/** 這一業態的每份進貨成本，要再乘上多少（主力供應商的價格） */
export function supplierCostMult(s: SupplyView, category: string): number {
  const fam = familyOf(category);
  if (!fam) return 1;
  const c = chosenSupplier(s, fam);
  return c ? supplierPriceNow(s, c.st, c.def) : 1;
}

/**
 * 沒有庫存的業態（服務／娛樂／商務）每筆服務的耗材成本倍率：
 * 主力供應商的價格；供貨吃緊時要臨時高價採購，主力停擺時更貴。
 */
export function consumableCostMult(s: SupplyView, category: string): number {
  const fam = familyOf(category);
  if (!fam) return 1;
  const c = chosenSupplier(s, fam);
  if (!c) return 1;
  const mult = supplierPriceNow(s, c.st, c.def);
  if (supplierUnavailable(c.st, s.tick)) return mult * 1.35;
  const sh = liveShock(c.st, s.tick);
  if (sh && sh.kind !== "price_spike") return mult * (1 + (1 - shockFill(sh.fill, shockTier(c.st, s.tick))) * 0.5);
  return mult;
}

/** 用得到這類貨品的直營店數 */
export function familyShopCount(s: Pick<MallState, "shops">, family: SupplyFamily): number {
  return s.shops.filter((x) => x.mode === "direct" && familyOf(x.category) === family && CATEGORY_BY_ID[x.category]).length;
}

/** 供應商對店家口味的影響：品質好的供應商讓店家更有口碑（±6% 左右） */
export function supplierQualityFactor(s: Pick<MallState, "supply">, category: string): number {
  const fam = familyOf(category);
  if (!fam) return 1;
  const c = chosenSupplier(s, fam);
  return c ? 1 + (c.def.quality - 0.75) * 0.3 : 1;
}

// ───────── 倉儲、損耗、補貨規劃 ─────────

/** 倉庫容量：店越大放越多。進貨（含在途）不能超過容量 */
export const STORAGE_BASE = 800;
export const STORAGE_PER_LEVEL = 300;
export function storageCap(shop: Pick<Shop, "level">): number {
  return STORAGE_BASE + STORAGE_PER_LEVEL * (Math.max(1, shop.level) - 1);
}

/** 每天會壞掉的比例（只算「超過一天銷量」的那部分庫存：正常周轉不受影響，囤貨才會損耗） */
export const SPOILAGE_PER_DAY: Partial<Record<SupplyFamily, number>> = {
  seafood: 0.03,
  produce: 0.03,
  meat: 0.018,
  sweets: 0.012,
  grain: 0.004,
};

/** 急件：價格貴三成，交期縮短到四成 */
export const RUSH_PREMIUM = 1.3;
export const RUSH_LEAD_MULT = 0.4;
/** 主力缺貨、向備用供應商補缺口時的加價（比「主力完全停擺」的現貨價貴一點，讓長約與好關係仍然值錢） */
export const GAP_PREMIUM = 1.15;
/** 智慧補貨的預設備貨天數與安全天數 */
export const SMART_COVER_DAYS = 2.5;
export const SMART_SAFETY_DAYS = 0.75;
/** 供應商預告出事後，這麼多 tick 內開始囤貨（1.5 遊戲日） */
export const STOCKUP_WINDOW_TICKS = 432;

export interface RestockPlan {
  /** 庫存（含在途）低於這個量就補 */
  min: number;
  /** 補到這個量 */
  target: number;
  /** 為什麼是這個數字（給玩家看的說明） */
  notes: string[];
}

const lot = (n: number) => Math.max(SUPPLY_LOT, Math.ceil(n / SUPPLY_LOT) * SUPPLY_LOT);

/**
 * 這間店現在實際用的補貨規則。固定規則＝玩家設定的下限與目標；
 * 智慧補貨＝日均銷量 ×（供應商交期 + 安全天數），再依供應狀況與預告調整。
 */
export function restockPlan(s: Pick<MallState, "supply" | "tick">, shop: Shop): RestockPlan {
  const rule = shop.restock;
  if (!rule.smart) return { min: rule.min, target: rule.target, notes: [] };
  const notes: string[] = [];
  const cap = storageCap(shop);
  const avg = Math.max(shop.avgDaily ?? 0, 20);
  const fam = familyOf(shop.category);
  const main = fam ? chosenSupplier(s, fam) : null;
  const leadTicks = SUPPLY_LEAD_TICKS * (main?.def.lead ?? 1) * (main && (main.st.status === "shortage" || liveShock(main.st, s.tick)) ? 1.6 : 1);
  const leadDays = leadTicks / TICKS_PER_DAY;
  const cover = Math.min(6, Math.max(1, rule.coverDays ?? SMART_COVER_DAYS));
  let min = avg * (leadDays + SMART_SAFETY_DAYS);
  let target = avg * cover;
  notes.push(`日均賣約 ${Math.round(avg)} 份，備 ${cover} 天份`);
  const sh = main?.st.shock && main.st.shock.endTick > s.tick ? main.st.shock : null;
  if (sh && rule.preShock !== false) {
    const upcoming = sh.startTick > s.tick && sh.startTick - s.tick <= STOCKUP_WINDOW_TICKS;
    const live = sh.startTick <= s.tick;
    if (sh.kind === "price_spike" && upcoming) {
      target *= 1.5;
      min *= 1.5;
      notes.push("行情要漲，先趁便宜多囤");
    } else if (sh.kind !== "price_spike" && (upcoming || live)) {
      const days = Math.min(3, Math.max(0.5, (sh.endTick - Math.max(sh.startTick, s.tick)) / TICKS_PER_DAY));
      const mult = 1 + Math.min(1.2, days * (1 - sh.fill) * 0.4);
      target *= mult;
      min *= mult;
      notes.push(upcoming ? "供應商預告出事，提前囤貨" : "供應吃緊，加大備貨");
    }
  }
  min = Math.min(cap - SUPPLY_LOT, lot(min));
  target = Math.min(cap, Math.max(min + SUPPLY_LOT, lot(target)));
  if (target >= cap) notes.push("已達倉庫容量上限");
  return { min, target, notes };
}

/** 庫存（含在途）夠賣幾天；沒有銷量紀錄時回傳 null */
export function coverDays(shop: Pick<Shop, "stock" | "incoming" | "avgDaily">): number | null {
  const avg = shop.avgDaily ?? 0;
  if (avg < 5) return null;
  return (shop.stock + shop.incoming.reduce((a, b) => a + b.qty, 0)) / avg;
}
