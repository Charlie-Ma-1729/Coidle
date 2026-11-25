import { L, S, forFam, type IngredientData } from "./ingredientKit";

// 各業態家族專用的素材（補在既有素材之外）。哪些業態用哪個家族，見 ingredientPools.ts。
// 特性標籤要用所屬群組的 TAGS（shared/src/game/workshop.ts）。名稱與描述全部虛構。

// ───────────────────────── 餐飲 ─────────────────────────

/** 飲品：手搖飲、鮮榨果汁、喫茶咖啡 */
const drink = forFam("food", "drink");
const tea = forFam("food", "bubble_tea kissaten");
const boba = forFam("food", "bubble_tea");
const cafe = forFam("food", "kissaten");
const juice = forFam("food", "juice_bar bubble_tea");

/** 甜點：和菓子／甜點、鯛魚燒、麵包烘焙坊、喫茶 */
const sweet = forFam("food", "sweet");
const sweetBake = forFam("food", "sweet bake");
const bake = forFam("food", "bake");

/** 西式：早午餐、義式、速食、餐車、Fine dining */
const west = forFam("food", "western");
const quick = forFam("food", "fastfood food_truck");

/** 炸物、小吃、飯食、日式海味、燒烤、酒場、麵食 */
const fried = forFam("food", "fried");
const street = forFam("food", "street");
const rice = forFam("food", "rice");
const sea = forFam("food", "sea");
const grill = forFam("food", "grill");
const pub = forFam("food", "pub");
const noodle = forFam("food", "noodle");

const FOOD: IngredientData[] = [
  // ── 飲品
  tea("base", "f_blacktea", "紅茶葉", "🍵", 2500, 1, { aroma: 2, warm: 1 }, S, "香氣沉穩的紅茶，一沖開整間店都是茶香。", "紅茶"),
  tea("base", "f_oolong", "烏龍茶葉", "🍃", 3000, 1, { aroma: 2, light: 2 }, S, "半發酵的茶，喝下去先清、後有回甘。", "烏龍"),
  drink("base", "f_freshfruit", "當季水果", "🍓", 2500, 1, { sweet: 2, sour: 1, light: 1 }, S, "今早剛送到的，挑最熟的那幾顆。", "鮮果"),
  drink("base", "f_milk", "牧場鮮乳", "🥛", 2000, 1, { rich: 2, sweet: 1, warm: 1 }, S, "喝起來有一點奶甜，圓潤得很。", "鮮乳"),
  drink("base", "f_wintermelon", "冬瓜", "🍈", 2000, 1, { sweet: 2, light: 2 }, L(2), "熬成清甜的磚，夏天的老味道。"),
  juice("base", "f_mango", "愛文芒果", "🥭", 3500, 2, { sweet: 3, aroma: 1 }, L(3), "熟透的才摘，聞到就知道有多甜。", "芒果"),
  cafe("base", "f_beans", "烘焙咖啡豆", "☕", 3000, 1, { aroma: 3, rich: 1 }, S, "中深焙，磨開的瞬間香氣撲面而來。", "咖啡"),
  drink("season", "f_brownsugar", "黑糖漿", "🍯", 900, 1, { sweet: 2, aroma: 1, warm: 1 }, S, "慢火熬出焦香，一滴就有深度。", "黑糖"),
  drink("season", "f_mint", "薄荷葉", "🌿", 800, 1, { light: 2, aroma: 1 }, S, "清涼透亮，夏天最討喜。", "薄荷"),
  drink("season", "f_condensed", "煉乳", "🥫", 1200, 1, { sweet: 2, rich: 2 }, L(2), "濃稠香甜，一點點就能改變整杯。"),
  drink("season", "f_plum", "梅子汁", "🍑", 1200, 1, { sour: 2, sweet: 1, light: 1 }, L(2), "酸甜開胃，老街上人人愛的味道。", "梅子"),
  drink("season", "f_soda", "氣泡水", "🫧", 700, 1, { light: 2, sour: 1 }, S, "細細的氣泡，什麼都配得上。", "氣泡"),
  drink("method", "f_pourover", "手沖慢滴", "☕", 1200, 1, { aroma: 2, light: 1, warm: 1 }, S, "熱水繞著圈慢慢注，急不得。", "手沖"),
  drink("method", "f_shake", "搖杯", "🥤", 800, 1, { light: 1, sweet: 1, aroma: 1 }, S, "冰塊和茶一起搖，搖得越均勻越順口。", "搖製"),
  drink("method", "f_coldbrew", "冷萃", "🧊", 1800, 2, { light: 2, aroma: 1 }, L(2), "冷水慢慢萃一整夜，沒有苦澀。"),
  drink("method", "f_blend", "冰沙", "🍧", 1500, 1, { light: 2, sweet: 1 }, L(2), "把整杯水果打成綿密的冰。"),
  cafe("method", "f_siphon", "虹吸壺", "🧪", 1800, 2, { aroma: 2, warm: 1 }, S, "玻璃壺裡咕嘟咕嘟，看著就是一場表演。", "虹吸"),
  boba("special", "f_pearl", "波霸珍珠", "⚫", 1000, 1, { sweet: 1, rich: 1, warm: 1 }, S, "Q 彈有嚼勁，吸管要夠粗。", "珍珠"),
  tea("special", "f_creamcap", "奶蓋", "🥛", 1800, 2, { rich: 2, sweet: 1 }, L(2), "鹹鹹甜甜的一層，蓋在茶上面。"),
  drink("special", "f_nata", "椰果", "⚪", 800, 1, { light: 1, crisp: 1 }, S, "透明脆口，加了就有咬勁。"),

  // ── 甜點與烘焙
  sweet("base", "f_batter", "預拌麵糊", "🥣", 1500, 1, { sweet: 1, warm: 1, rich: 1 }, S, "雞蛋與牛奶調得剛剛好，靜置一晚更綿密。", "麵糊"),
  sweet("base", "f_cream", "鮮奶油", "🍦", 2200, 1, { rich: 2, sweet: 1 }, S, "打發到七分，輕輕一抹就是質感。"),
  sweet("base", "f_mochi", "糯米糰", "🍡", 2000, 1, { warm: 1, sweet: 1, light: 1 }, S, "軟軟黏黏，拉起來能拉得很長。", "麻糬"),
  sweet("base", "f_chestnut", "栗子", "🌰", 3000, 2, { sweet: 2, aroma: 1, warm: 1 }, L(2), "秋天才有的甘甜，剝開還是熱的。"),
  forFam("food", "sweet bake drink")("season", "f_vanilla", "香草籽", "🌼", 1800, 2, { aroma: 2, sweet: 1 }, S, "刮開豆莢，黑色小點散進奶油裡。", "香草"),
  sweetBake("method", "f_bake", "烘烤", "🥧", 1000, 1, { aroma: 2, warm: 1, crisp: 1 }, S, "烤箱一開，整間店都是熱烘烘的甜香。"),
  sweet("method", "f_chill", "冷藏凝固", "🧊", 1200, 1, { rich: 1, light: 1, sweet: 1 }, S, "放進冰箱一晚，口感才會成形。", "凝固"),
  forFam("food", "sweet bake drink")("special", "f_caramel", "焦糖", "🍮", 1200, 1, { sweet: 2, aroma: 1 }, S, "糖煮到剛要焦的那一刻就要離火。"),
  sweetBake("special", "f_nuts", "堅果碎", "🥜", 1500, 1, { crisp: 1, aroma: 1, rich: 1 }, L(2), "烤過再敲碎，撒上去喀啦喀啦。", "堅果"),
  bake("base", "f_flour", "高筋麵粉", "🌾", 1800, 1, { warm: 1, light: 1 }, S, "筋度夠，揉出來的麵團才有彈性。", "麵粉"),
  bake("base", "f_wholemeal", "全麥麵團", "🍞", 2800, 1, { aroma: 1, warm: 1, light: 1 }, S, "帶著麥麩的香，越嚼越有味道。", "全麥"),
  bake("base", "f_sourdough", "天然酵母", "🥖", 3500, 2, { aroma: 2, sour: 1, warm: 1 }, L(3), "養了三年的老酵母，每天都要餵。", "酵母"),
  forFam("food", "bake western")("season", "f_olive", "橄欖油", "🫒", 1200, 1, { rich: 1, aroma: 1 }, S, "淡淡青草香，淋在麵包上就很美味。"),
  forFam("food", "bake sweet drink")("season", "f_jam", "果醬", "🍓", 1500, 1, { sweet: 2, sour: 1 }, S, "熬到濃稠才罐裝，酸甜剛好。"),
  bake("special", "f_seeds", "雜糧籽", "🌱", 900, 1, { crisp: 1, aroma: 1 }, S, "撒在表面，烤出來香脆又好看。"),

  // ── 西式
  west("base", "f_mince", "絞肉", "🥩", 2800, 1, { umami: 2, rich: 1 }, S, "粗細剛好，煎起來會出油。"),
  forFam("food", "italian")("base", "f_pasta", "義大利麵", "🍝", 2500, 1, { warm: 1, light: 1 }, S, "煮到彈牙，醬汁才抓得住。"),
  quick("base", "f_bun", "漢堡麵包", "🍔", 1800, 1, { warm: 1, sweet: 1 }, S, "上面撒了芝麻，烤到微微焦脆。", "麵包"),
  west("base", "f_salmon", "鮭魚", "🐟", 5000, 2, { rich: 2, umami: 1 }, L(2), "油脂豐厚，煎的時候滋滋作響。"),
  west("season", "f_tomato", "番茄醬底", "🍅", 1500, 1, { sour: 1, sweet: 1, umami: 1 }, S, "小火熬了兩小時，酸甜剛好。", "番茄"),
  west("season", "f_whitesauce", "白醬", "🥛", 1800, 1, { rich: 2, warm: 1 }, S, "奶香濃濃，淋什麼都好吃。"),
  west("season", "f_herb", "香草束", "🌿", 1200, 1, { aroma: 2, light: 1 }, S, "百里香與迷迭香捆成一小把。", "香草"),
  forFam("food", "italian fine_dining brunch")("season", "f_balsamic", "巴薩米克醋", "🍇", 2500, 2, { sour: 2, sweet: 1, aroma: 1 }, L(3), "陳放多年的黑醋，甜中帶酸。", "黑醋"),
  west("method", "f_sear", "煎封", "🍳", 1500, 1, { aroma: 2, rich: 1 }, S, "大火封住肉汁，表面煎得金黃。"),
  west("special", "f_bacon", "培根", "🥓", 1800, 1, { salty: 1, rich: 1, aroma: 1 }, S, "煎得微脆，油香撲鼻。"),
  forFam("food", "fastfood food_truck brunch")("special", "f_pickles", "酸黃瓜", "🥒", 700, 1, { sour: 1, crisp: 1 }, S, "脆脆酸酸，解膩一流。"),

  // ── 炸物
  forFam("food", "kushikatsu")("base", "f_lotus", "蓮藕", "🪷", 1800, 1, { crisp: 1, light: 1, sweet: 1 }, S, "切片後孔洞分明，一炸就脆。"),
  fried("base", "f_onion", "洋蔥", "🧅", 1000, 1, { sweet: 1, aroma: 1 }, S, "炸過會變得甘甜。"),
  forFam("food", "fried street")("season", "f_ponzu", "柑橘醋醬油", "🍋", 1400, 1, { sour: 2, umami: 1, light: 1 }, S, "清爽的酸，沾炸物最解膩。", "柑橘醋"),
  fried("method", "f_doublefry", "二次油炸", "🍤", 1800, 2, { crisp: 3, rich: 1 }, L(3), "先低溫、再高溫，外皮脆得像玻璃。", "雙炸"),
  fried("special", "f_panko", "粗麵包粉", "🍞", 900, 1, { crisp: 2 }, S, "粗顆粒一炸就膨起來。", "麵包粉"),
  forFam("food", "tonkatsu kushikatsu")("special", "f_shredcabbage", "高麗菜絲", "🥬", 600, 1, { light: 1, crisp: 1 }, S, "切得像髮絲，旁邊配著吃。", "菜絲"),

  // ── 小吃（章魚燒、鯛魚燒、關東煮、飯糰、餃子）
  forFam("food", "takoyaki taiyaki")("base", "f_flourmix", "麵糊", "🥣", 1500, 1, { warm: 1, light: 1 }, S, "水與高湯調得稀稀的，才會外酥內軟。"),
  forFam("food", "oden")("base", "f_daikon", "白蘿蔔", "🥕", 1200, 1, { light: 2, sweet: 1, warm: 1 }, S, "煮到透明，一咬湯汁就流出來。", "蘿蔔"),
  forFam("food", "oden")("base", "f_fishcake", "魚板", "🍥", 2000, 1, { umami: 2, light: 1 }, S, "彈牙有魚味，每家的口味都不同。"),
  forFam("food", "oden")("base", "f_konjac", "蒟蒻", "⬜", 1000, 1, { light: 2 }, S, "不起眼，卻最會吸湯。"),
  forFam("food", "onigiri")("base", "f_stickyrice", "白飯", "🍙", 1800, 1, { warm: 1, light: 1, sweet: 1 }, S, "剛煮好還冒著煙，捏起來才好吃。"),
  forFam("food", "takoyaki")("season", "f_takosauce", "章魚燒醬", "🥫", 1200, 1, { sweet: 1, salty: 1, umami: 1 }, S, "濃稠的黑醬，刷上去還會滴。", "燒醬"),
  forFam("food", "oden")("season", "f_kombu", "昆布湯底", "🍲", 2000, 1, { umami: 2, warm: 1, light: 1 }, S, "昆布泡了一整夜，湯清得像水。", "昆布"),
  forFam("food", "oden gyoza takoyaki")("season", "f_mustard", "黃芥末", "🟡", 700, 1, { spicy: 1, sour: 1, aroma: 1 }, S, "沾一點點，嗆得剛剛好。"),
  forFam("food", "takoyaki taiyaki gyoza")("method", "f_mold", "銅板模烤", "🥮", 1200, 1, { crisp: 2, warm: 1 }, S, "老銅模傳熱均勻，外皮烤得酥黃。", "模烤"),
  forFam("food", "oden")("method", "f_braise", "長時間滷煮", "🍲", 1000, 1, { warm: 2, umami: 1 }, S, "小火燜著，味道一層一層進去。", "滷煮"),
  forFam("food", "taiyaki sweets")("special", "f_custard", "卡士達", "🥚", 1500, 1, { sweet: 2, rich: 1 }, S, "蛋黃加牛奶煮成的濃稠內餡。"),
  forFam("food", "street noodle")("special", "f_scallion", "蔥花", "🌱", 600, 1, { aroma: 1, light: 1 }, S, "撒一把，整碗就有生氣。"),

  // ── 飯食（咖哩、飯糰、超市）
  forFam("food", "curry")("season", "f_spicemix", "綜合香料", "🌶️", 1500, 1, { spicy: 2, aroma: 2 }, S, "二十種香料混在一起，每家比例不同。", "香料"),
  forFam("food", "rice")("base", "f_carrot", "紅蘿蔔", "🥕", 1000, 1, { sweet: 1, warm: 1 }, S, "燉久了就會出甜味。"),
  forFam("food", "curry onigiri")("base", "f_whiterice", "白米飯", "🍚", 1800, 1, { warm: 1, light: 1, sweet: 1 }, S, "米粒分明，淋什麼都合。"),
  forFam("food", "grocery")("base", "f_greens", "當季蔬菜", "🥬", 1500, 1, { light: 2, crisp: 1 }, S, "早上到的，水分還很足。", "蔬菜"),
  forFam("food", "grocery")("base", "f_freshfish", "鮮魚", "🐟", 3000, 1, { umami: 2, light: 1 }, S, "冰鎮著，鮮度一看就知道。"),
  forFam("food", "grocery")("base", "f_deli", "現做小菜", "🥗", 2000, 1, { salty: 1, umami: 1, warm: 1 }, S, "媽媽味的家常配菜。", "小菜"),
  forFam("food", "grocery onigiri")("method", "f_heat", "即食加熱", "♨️", 800, 1, { warm: 2 }, S, "微波一下就能吃，趕時間的人最需要。", "加熱"),
  forFam("food", "grocery")("method", "f_cold", "冷藏保鮮", "🧊", 800, 1, { light: 2 }, S, "冰箱裡放得剛剛好，鮮度不流失。", "冷藏"),

  // ── 日式海味（壽司、鰻魚飯、懷石、鐵板燒）
  forFam("food", "sushi kaiseki")("base", "f_whitefish", "白身魚", "🐟", 4500, 1, { light: 2, umami: 1 }, S, "肉質細緻，清爽不腥。"),
  forFam("food", "sushi")("base", "f_tuna", "鮪魚", "🍣", 6500, 2, { umami: 2, rich: 1 }, L(2), "紅得發亮，入口即化。"),
  forFam("food", "sushi")("base", "f_vinegarrice", "醋飯", "🍙", 1800, 1, { light: 1, sour: 1, warm: 1 }, S, "微微的酸，捏起來粒粒分明。"),
  forFam("food", "unagi sushi teppanyaki")("season", "f_kabayaki", "蒲燒醬汁", "🥫", 1500, 1, { sweet: 2, salty: 1, aroma: 1 }, S, "老店傳了好幾代的醬汁，越用越濃。", "蒲燒"),
  forFam("food", "sea grill street rice noodle")("season", "f_mirin", "味醂", "🍶", 900, 1, { sweet: 2, umami: 1 }, S, "甘甜溫潤，煮物少不了它。"),

  // ── 燒烤
  forFam("food", "yakiniku")("base", "f_ribs", "牛五花", "🥩", 5000, 1, { rich: 2, umami: 1 }, S, "油花均勻，一上網就滋滋作響。"),
  forFam("food", "yakiniku")("base", "f_skirt", "橫膈膜", "🥩", 5500, 2, { umami: 2, rich: 1 }, L(2), "咬勁十足，肉香特別濃。"),
  forFam("food", "yakiniku izakaya")("season", "f_tare", "燒肉沾醬", "🥫", 1500, 1, { sweet: 1, salty: 1, umami: 1, aroma: 1 }, S, "每家都有自己的祕方，甜鹹拿捏很重要。", "沾醬"),

  // ── 酒場（居酒屋、酒吧、葡萄酒吧、精釀、啤酒花園、火鍋）
  forFam("food", "craft_beer beer_garden")("base", "f_malt", "麥芽", "🌾", 2500, 1, { sweet: 1, aroma: 1, rich: 1 }, S, "烘過的麥芽，帶著餅乾香。"),
  forFam("food", "wine_bar bar")("base", "f_grape", "葡萄", "🍇", 3000, 1, { sweet: 1, sour: 1, aroma: 1 }, S, "皮薄汁多，一顆顆都是果香。"),
  forFam("food", "bar izakaya wine_bar")("base", "f_spirit", "蒸餾原酒", "🥃", 3500, 1, { aroma: 2, warm: 1 }, S, "透明乾淨的烈酒，用來調味也能當主角。", "原酒"),
  forFam("food", "bar wine_bar beer_garden")("season", "f_tonic", "通寧水", "🫧", 800, 1, { light: 1, sour: 1 }, S, "微苦微甜，什麼酒都襯得起來。"),
  forFam("food", "bar wine_bar")("season", "f_bitters", "苦精", "🧴", 1500, 1, { aroma: 2, sour: 1 }, S, "幾滴就改變一整杯的性格。"),
  forFam("food", "bar wine_bar")("method", "f_stirdrink", "調酒攪拌", "🥂", 1000, 1, { light: 1, aroma: 1 }, S, "手穩，才調得出剛剛好的冰度。", "調製"),
  forFam("food", "craft_beer beer_garden")("method", "f_brewcraft", "低溫發酵", "🍺", 2000, 2, { aroma: 2, light: 1 }, S, "發酵得慢，香氣才細緻。", "釀造"),
  forFam("food", "bar izakaya wine_bar")("method", "f_infuse", "浸漬", "🫙", 1500, 1, { aroma: 2, sweet: 1 }, S, "把果香慢慢泡進酒裡。"),
  pub("special", "f_snacknuts", "綜合堅果", "🥜", 900, 1, { crisp: 1, salty: 1, aroma: 1 }, S, "配酒的小碟，吃了就停不下來。", "堅果"),

  // ── 麵食（拉麵、烏龍麵、蕎麥麵）
  forFam("food", "udon")("base", "f_udondough", "烏龍麵團", "🍜", 2200, 1, { warm: 1, light: 1 }, S, "腳踩過的麵團，彈性十足。", "烏龍"),
  forFam("food", "ramen")("season", "f_broth", "豚骨高湯", "🍲", 2000, 1, { umami: 2, rich: 2, warm: 1 }, S, "熬了十幾個鐘頭，白濁濃稠。", "豚骨"),
  noodle("season", "f_shoyutare", "醬油湯底", "🍶", 1200, 1, { salty: 2, umami: 1 }, S, "老釀造的醬油湯，清澈有深度。", "醬油湯"),
  forFam("food", "soba udon")("season", "f_tsuyu", "沾麵汁", "🍵", 1200, 1, { salty: 1, umami: 1, light: 1, aroma: 1 }, S, "柴魚與昆布熬的，沾一點就夠。"),
  forFam("food", "soba udon ramen")("method", "f_chilled", "冰鎮", "🧊", 800, 1, { light: 2 }, S, "冷水沖過再瀝乾，口感更緊實。"),

  // ── 各業態自己的招牌素材（讓相近的店也有不一樣的選擇）
  forFam("food", "bar")("base", "f_liqueur", "利口酒", "🍹", 3000, 1, { sweet: 2, aroma: 1 }, S, "果香濃郁，一點點就能撐起一杯。"),
  forFam("food", "wine_bar")("base", "f_vineyard", "葡萄原酒", "🍷", 4000, 1, { sour: 1, aroma: 2, rich: 1 }, S, "今年的新酒，還帶著一點年輕的酸。", "原酒"),
  forFam("food", "wine_bar")("method", "f_decant", "醒酒", "🍾", 1200, 1, { aroma: 2, light: 1 }, S, "倒進醒酒器，等香氣慢慢打開。"),
  forFam("food", "unagi yakiniku")("method", "f_charcoal", "備長炭", "🔥", 1800, 1, { aroma: 3, warm: 1 }, S, "燒得通紅的老炭，一翻面就是香氣。", "炭燒"),
  forFam("food", "teppanyaki")("base", "f_steakcut", "厚切牛排", "🥩", 6000, 1, { rich: 2, umami: 1 }, S, "三公分厚，油花像大理石。", "牛排"),
  forFam("food", "fastfood")("base", "f_fries", "薯條", "🍟", 1500, 1, { crisp: 1, salty: 1, rich: 1 }, S, "炸好立刻撒鹽，趁熱吃才對味。"),
  forFam("food", "food_truck")("base", "f_tortilla", "手捲餅皮", "🫓", 1500, 1, { warm: 1, light: 1 }, S, "現烙的，軟中帶韌。", "餅皮"),
];

// ───────────────────────── 零售 ─────────────────────────
const retailTech = forFam("retail", "tech");

const RETAIL: IngredientData[] = [
  // ── 服飾、鞋履、飾品
  forFam("retail", "fashion")("base", "r_wool", "羊毛", "🐑", 6000, 1, { classic: 1, premium: 1, practical: 1 }, S, "保暖又有型，秋冬賣得特別好。"),
  forFam("retail", "fashion")("method", "r_tailor", "量身裁剪", "✂️", 4000, 1, { premium: 2, classic: 1 }, S, "量好尺寸才下剪，穿起來就是貼身。", "裁剪"),
  forFam("retail", "shoes")("base", "r_sole", "橡膠鞋底", "👟", 5000, 1, { practical: 2, tech: 1 }, S, "止滑耐磨，走一整天也不累。", "鞋底"),
  forFam("retail", "shoes")("method", "r_lastmaking", "楦型製鞋", "🥾", 4500, 1, { premium: 1, classic: 1, practical: 1 }, S, "照腳型做的楦，穿起來不磨腳。", "製鞋"),
  forFam("retail", "accessory")("base", "r_silverwire", "銀絲", "💍", 5500, 1, { premium: 2, classic: 1 }, S, "一圈一圈繞出來的細緻線條。"),
  forFam("retail", "accessory")("special", "r_gem", "寶石", "💎", 3500, 2, { premium: 2, limited: 1 }, L(2), "小小一顆，就能讓整件作品亮起來。"),
  forFam("retail", "accessory")("method", "r_polish", "打磨拋光", "✨", 2500, 1, { premium: 1, classic: 1 }, S, "磨到能映出人影才算完成。", "拋光"),
  forFam("retail", "camera apparel")("method", "r_saddle", "馬鞍縫", "🧵", 3500, 1, { premium: 2, classic: 1, practical: 1 }, S, "雙針手縫，線不會鬆。"),

  // ── 美妝、藥妝、日用
  forFam("retail", "beauty")("base", "r_plantextract", "植物萃取", "🌿", 4500, 1, { eco: 2, practical: 1 }, S, "從在地花草裡慢慢萃出來的。", "萃取"),
  forFam("retail", "cosmetics")("base", "r_mineral", "礦物原料", "🪨", 5000, 1, { premium: 1, practical: 1, eco: 1 }, S, "細緻磨成粉，貼膚又透氣。", "礦物"),
  forFam("retail", "drugstore")("base", "r_healthcare", "保健原料", "💊", 4500, 1, { practical: 2, eco: 1 }, S, "日常補給的小東西，賣得很穩。", "保健"),
  forFam("retail", "beauty")("method", "r_coldpress", "冷壓萃取", "🫙", 3000, 1, { eco: 2, premium: 1 }, S, "低溫慢壓，保留原本的香氣。", "冷壓"),
  forFam("retail", "cosmetics")("method", "r_handblend", "手工調配", "🧪", 3000, 1, { practical: 1, premium: 1 }, S, "依膚質現場調，每一瓶不太一樣。", "調配"),
  forFam("retail", "convenience")("base", "r_snackpack", "零食組合", "🍘", 3500, 1, { playful: 1, practical: 1 }, S, "小包裝搭配起來，每次都有驚喜。", "零食"),
  forFam("retail", "convenience drugstore")("base", "r_dailybasic", "日用品", "🧻", 3000, 1, { practical: 2 }, S, "每個家庭都用得到的基本款。", "日用"),
  forFam("retail", "convenience select_shop")("method", "r_bundle", "組合販售", "🎁", 2500, 1, { practical: 1, playful: 1 }, S, "把相關的東西綁在一起賣。", "組合"),

  // ── 玩具、動漫、遊戲
  forFam("retail", "toy_store")("base", "r_blocks", "積木木料", "🧱", 4500, 1, { cute: 1, practical: 1, playful: 1 }, S, "磨得圓滑的木塊，小朋友抓著就不放。", "積木"),
  forFam("retail", "toy_store")("special", "r_motor", "電動機關", "⚙️", 3000, 2, { playful: 2, tech: 1 }, L(2), "按一下就會動，眼睛都亮了。", "機關"),
  forFam("retail", "anime_goods")("base", "r_acrylic", "壓克力", "🔷", 4000, 1, { cute: 1, trendy: 1, practical: 1 }, S, "透明的立牌，擺桌上就是一個小角落。"),
  forFam("retail", "anime_goods gamestore")("special", "r_artbook", "設定畫稿", "🖼️", 3000, 2, { limited: 2, cute: 1 }, L(2), "只有首批才附的原稿畫冊。", "畫稿"),

  // ── 3C、相機
  retailTech("base", "r_circuit", "電路板", "🔌", 6500, 1, { tech: 2, practical: 1 }, S, "密密麻麻的銅線，是整台機器的神經。"),
  forFam("retail", "electronics")("base", "r_plastic", "工程塑膠", "⬛", 4500, 1, { practical: 2, tech: 1 }, S, "輕、耐摔，外殼靠它。", "塑膠"),
  forFam("retail", "electronics")("base", "r_display", "顯示面板", "📺", 9000, 2, { tech: 2, premium: 1 }, L(2), "亮度高、色彩準，一看就知道。", "面板"),
  forFam("retail", "camera")("base", "r_lens", "光學鏡片", "🔍", 8000, 1, { tech: 1, premium: 2 }, S, "鍍膜在光下泛著淡淡的藍。", "鏡片"),
  retailTech("season", "r_sleek", "流線機能風", "🌀", 3000, 1, { tech: 2, premium: 1 }, S, "線條俐落，沒有多餘的裝飾。", "機能"),
  retailTech("season", "r_gadget", "極客風", "🎛️", 3000, 1, { tech: 2, playful: 1, trendy: 1 }, S, "按鈕、旋鈕、發光的小細節。", "極客"),
  forFam("retail", "camera")("season", "r_classiccam", "復古相機風", "📷", 3000, 1, { classic: 2, premium: 1 }, S, "金屬機身、皮革紋，老派的浪漫。", "復古機"),
  retailTech("method", "r_assemble", "精密組裝", "🔧", 4000, 1, { tech: 2, practical: 1 }, S, "每顆螺絲都要鎖到剛剛好。", "組裝"),
  forFam("retail", "electronics")("method", "r_firmware", "韌體調校", "💾", 5000, 2, { tech: 3 }, L(2), "看不見的地方，才是真功夫。", "韌體"),
  forFam("retail", "camera")("method", "r_calibrate", "光學校正", "🎯", 5000, 2, { tech: 2, premium: 1 }, L(2), "對焦準不準，就看這一步。", "校正"),

  // ── 書與唱片
  forFam("retail", "bookstore stationery")("base", "r_newsprint", "道林紙", "📄", 3500, 1, { practical: 2, classic: 1 }, S, "不反光、好書寫，翻起來沙沙作響。"),
  forFam("retail", "bookstore")("method", "r_bindthread", "線裝", "📚", 3500, 1, { classic: 2, local: 1 }, S, "用線一針針縫起來，可以攤得很平。"),
  forFam("retail", "vinyl")("base", "r_vinylblank", "黑膠胚", "💿", 6000, 1, { classic: 2, premium: 1 }, S, "壓出來的紋路，會唱出老歌。"),
  forFam("retail", "vinyl")("method", "r_pressing", "壓片", "📀", 4500, 1, { classic: 1, limited: 2 }, S, "一次只壓幾百張，賣完就沒了。"),
  forFam("retail", "vinyl bookstore")("special", "r_sleeve", "唱片封套", "🎶", 2000, 1, { local: 1, classic: 1, limited: 1 }, S, "手繪的封套，每一張都值得掛起來。", "封套"),

  // ── 花店
  forFam("retail", "florist")("base", "r_freshflower", "切花", "💐", 4000, 1, { cute: 1, eco: 1, premium: 1 }, S, "今天一早批來的，還帶著露水。"),
  forFam("retail", "florist")("base", "r_driedflower", "乾燥花材", "🌾", 3500, 1, { eco: 2, classic: 1 }, S, "顏色慢慢褪成溫柔的樣子。", "乾燥花"),
  forFam("retail", "florist")("base", "r_greenery", "觀葉植物", "🪴", 4500, 1, { eco: 2, practical: 1 }, S, "好養、耐活，新手也能照顧。", "植栽"),
  forFam("retail", "florist")("method", "r_bouquet", "手綁花束", "💐", 2500, 1, { classic: 1, premium: 1, cute: 1 }, S, "螺旋綁法，手感是關鍵。"),
  forFam("retail", "florist")("method", "r_wreath", "花圈編紮", "🌸", 3000, 1, { classic: 2, eco: 1 }, S, "一圈圈繞成圓，掛在門上很討喜。", "花圈"),
  forFam("retail", "florist")("method", "r_pressed", "押花", "📖", 3500, 2, { eco: 2, classic: 1, premium: 1 }, L(2), "夾在書頁裡壓好幾週，才做得出來。"),

  // ── 市集、選物（再造）
  forFam("retail", "market daily beauty")("method", "r_upcycle", "升級再造", "♻️", 3000, 1, { eco: 2, practical: 1 }, S, "舊東西換個面貌，就是新的故事。", "再造"),
];

// ───────────────────────── 娛樂 ─────────────────────────
const ENTERTAINMENT: IngredientData[] = [
  // ── 電影院、展望台、藝廊
  forFam("entertainment", "cinema")("base", "e_blockbuster", "強檔大片", "🎞️", 9000, 1, { immersive: 1, visual: 2, thrill: 1 }, S, "首週末就排滿場次。", "大片"),
  forFam("entertainment", "cinema")("season", "e_filmfest", "影展", "🎬", 4500, 1, { story: 2, visual: 1 }, S, "選了幾部小而美的片子。"),
  forFam("entertainment", "cinema")("season", "e_premiere", "首映會", "🎉", 5000, 2, { social: 1, visual: 1, music: 1 }, L(2), "紅毯、媒體、一票影迷。"),
  forFam("entertainment", "cinema observatory art_gallery")("season", "e_thematic", "主題策展", "🗓️", 4000, 1, { nostalgia: 1, story: 1, relax: 1 }, S, "每個月換一個主題。"),
  forFam("entertainment", "observatory")("base", "e_telescope", "望遠鏡", "🔭", 8000, 1, { visual: 2, relax: 1 }, S, "排隊的小朋友都想多看一眼。"),
  forFam("entertainment", "observatory")("season", "e_starquiz", "星座問答", "⭐", 3500, 1, { story: 1, social: 1, competitive: 1 }, S, "猜對了還有小禮物。"),
  forFam("entertainment", "observatory")("special", "e_nightview", "夜景", "🌃", 3000, 1, { visual: 2, relax: 1 }, S, "整座城市的燈火都在腳下。"),
  forFam("entertainment", "art_gallery")("base", "e_sculpt", "雕塑展", "🗿", 8500, 1, { visual: 2, immersive: 1 }, S, "繞著作品走一圈，每個角度都不一樣。"),
  forFam("entertainment", "art_gallery")("season", "e_curate", "策展敘事", "🖼️", 4500, 1, { visual: 2, story: 1 }, S, "把作品串成一個故事。", "策展"),
  forFam("entertainment", "art_gallery")("special", "e_audioguide", "語音導覽", "🎧", 2500, 1, { story: 1, relax: 1 }, S, "戴上耳機，像有人在耳邊低語。", "導覽"),

  // ── 電玩、密室、保齡、夾娃娃
  forFam("entertainment", "arcade_vr")("base", "e_pixel", "像素復刻", "👾", 8500, 1, { nostalgia: 2, competitive: 1, visual: 1 }, S, "老遊戲重新上機，連畫素都一樣。"),
  forFam("entertainment", "arcade_vr")("method", "e_cabinet", "街機機台", "🕹️", 6000, 1, { nostalgia: 2, competitive: 1 }, S, "按鈕都磨得發亮。"),
  forFam("entertainment", "escape_room")("base", "e_locked", "密室劇本", "🔑", 9000, 1, { story: 2, immersive: 1, thrill: 1 }, S, "把大家關在一個故事裡。"),
  forFam("entertainment", "escape_room")("method", "e_clues", "線索機關", "🧩", 5000, 1, { story: 2, social: 1 }, S, "每個機關背後都有一段故事。"),
  forFam("entertainment", "escape_room arcade_vr")("special", "e_timer", "倒數計時器", "⏱️", 2000, 1, { thrill: 2 }, S, "滴答聲一響，心跳就加速。", "計時"),
  forFam("entertainment", "bowling")("base", "e_pins", "保齡球瓶", "🎳", 8000, 1, { competitive: 2, social: 1 }, S, "球瓶倒下的聲音最過癮。"),
  forFam("entertainment", "bowling")("special", "e_strike", "全倒挑戰", "💥", 2500, 1, { competitive: 1, thrill: 1 }, S, "連續全倒就有獎。"),
  forFam("entertainment", "claw")("base", "e_clawmachine", "夾娃娃機", "🧸", 8000, 1, { thrill: 2, competitive: 1 }, S, "差一點點就夾起來了。", "夾機"),
  forFam("entertainment", "claw")("special", "e_prizedoll", "限定公仔", "🎎", 3000, 1, { competitive: 1, social: 1, family: 1 }, S, "只有這裡才夾得到。"),

  // ── KTV、展演
  forFam("entertainment", "karaoke")("base", "e_ktvbox", "包廂歡唱", "🎤", 8000, 1, { music: 2, social: 2 }, S, "門一關，就是自己人的舞台。"),
  forFam("entertainment", "karaoke")("base", "e_oldsongs", "懷舊金曲", "📻", 7500, 1, { nostalgia: 2, music: 1 }, S, "一前奏全場就會唱。"),
  forFam("entertainment", "live_house")("base", "e_indie", "獨立樂團", "🎸", 8500, 1, { music: 2, visual: 1, social: 1 }, S, "一支剛起步的樂團，現場感十足。"),
  forFam("entertainment", "live_house")("base", "e_dj", "DJ 之夜", "🎧", 9000, 2, { music: 2, thrill: 1, social: 1 }, L(2), "混音一下，整個場子都在跳。"),
  forFam("entertainment", "live_house")("base", "e_unplugged", "木吉他夜", "🎼", 7500, 1, { music: 2, relax: 1 }, S, "安安靜靜的，聽得見呼吸聲。"),

  // ── 親子遊樂、手作
  forFam("entertainment", "kids_play observatory")("base", "e_treasure", "尋寶遊戲", "🗺️", 8000, 1, { story: 2, family: 1, social: 1 }, S, "拿著地圖到處找線索。"),
  forFam("entertainment", "kids_play")("base", "e_ballpit", "海洋球池", "🔴", 8000, 1, { family: 2, thrill: 1 }, S, "跳進去就不想出來。", "球池"),
  forFam("entertainment", "craft_studio")("base", "e_wheel", "拉坯體驗", "🏺", 7500, 1, { relax: 1, visual: 1, family: 1 }, S, "轉盤一轉，泥巴就有了形狀。", "拉坯"),
  forFam("entertainment", "craft_studio")("base", "e_woodwork", "木工體驗", "🪚", 8000, 1, { family: 1, relax: 1, social: 1 }, S, "親手釘出一個小板凳。", "木工"),
];

// ───────────────────────── 服務 ─────────────────────────
const SERVICE: IngredientData[] = [
  // ── 停車、洗衣、修繕、行李、影印
  forFam("service", "parking")("base", "v_valet", "代客泊車", "🚗", 5000, 1, { quick: 2, personal: 1 }, S, "鑰匙一交，什麼都不用煩惱。", "泊車"),
  forFam("service", "parking")("base", "v_ticket", "無人收費", "🎫", 4500, 1, { quick: 2, tech: 1 }, S, "感應車牌，出場不用停車。"),
  forFam("service", "parking luggage")("base", "v_secure", "保全巡邏", "🛡️", 4000, 1, { calm: 1, effective: 1 }, S, "夜裡也有人巡視，放心。", "保全"),
  forFam("service", "laundry")("base", "v_wash", "水洗", "🫧", 4000, 1, { effective: 2, quick: 1 }, S, "洗得乾淨又不傷衣服。"),
  forFam("service", "laundry")("base", "v_dry", "烘乾", "🌀", 3500, 1, { quick: 2, warm: 1 }, S, "出來還熱熱的，摸起來好舒服。"),
  forFam("service", "laundry")("base", "v_press", "熨燙", "👔", 4000, 1, { personal: 1, effective: 1 }, S, "襯衫折痕俐落如新。"),
  forFam("service", "repair")("base", "v_fixhand", "手工修補", "🪡", 4500, 1, { personal: 2, effective: 1 }, S, "細細縫補，看不出來壞過。", "修補"),
  forFam("service", "repair")("base", "v_parts", "零件更換", "🔩", 5000, 1, { effective: 2, quick: 1 }, S, "手邊就有常用的零件。"),
  forFam("service", "repair")("base", "v_diagnose", "故障檢測", "🔎", 5000, 1, { tech: 2, effective: 1 }, S, "先找出問題，再動手。", "檢測"),
  forFam("service", "luggage")("base", "v_storage", "寄放櫃", "🧳", 3500, 1, { calm: 1, quick: 1, effective: 1 }, S, "上了鎖的小櫃子，安心放。"),
  forFam("service", "luggage")("base", "v_delivery", "行李宅配", "🚚", 4500, 1, { quick: 2, effective: 1 }, S, "今天寄，明天就到飯店。", "宅配"),
  forFam("service", "print_shop")("base", "v_copy", "影印", "🖨️", 3000, 1, { quick: 2, effective: 1 }, S, "又快又清楚。"),
  forFam("service", "print_shop")("base", "v_postal", "郵務代寄", "📮", 3500, 1, { quick: 1, effective: 1, personal: 1 }, S, "幫客人包好、貼好、寄出去。", "郵寄"),
  forFam("service", "print_shop")("base", "v_binding", "裝訂", "📎", 3500, 1, { effective: 1, personal: 1, quick: 1 }, S, "整整齊齊，一本就是一份心意。"),
  forFam("service", "print_shop")("base", "v_design", "排版設計", "🖋️", 5000, 2, { personal: 2, tech: 1 }, L(2), "客人只要說想要什麼感覺。", "排版"),

  // ── 診所、牙科、托育、補習班
  forFam("service", "clinic dental")("base", "v_checkup", "問診", "🩺", 5500, 1, { personal: 2, calm: 1 }, S, "先聊一聊，再檢查。"),
  forFam("service", "dental")("base", "v_dentalclean", "洗牙", "🦷", 5000, 1, { effective: 2, quick: 1 }, S, "洗完整口都清爽。"),
  forFam("service", "dental")("base", "v_ortho", "牙齒矯正", "😁", 7000, 2, { effective: 2, personal: 1 }, L(2), "慢慢調，笑起來更自信。", "矯正"),
  forFam("service", "daycare")("base", "v_storytime", "說故事時間", "📖", 4500, 1, { warm: 2, social: 1 }, S, "圍成一圈，小朋友都豎起耳朵。"),
  forFam("service", "daycare")("base", "v_nap", "午睡", "🛏️", 4000, 1, { calm: 2, warm: 1 }, S, "輕輕拍著，一個個睡著。"),
  forFam("service", "cram_school")("base", "v_lecture", "小班教學", "🧑‍🏫", 5500, 1, { personal: 1, effective: 2 }, S, "每個學生的問題都被看見。", "教學"),
  forFam("service", "cram_school")("base", "v_drill", "題庫練習", "📝", 4500, 1, { effective: 2, quick: 1 }, S, "反覆練習，考試才不怕。", "練習"),

  // ── 美髮、美甲、寫真、SPA
  forFam("service", "salon")("base", "v_cut", "剪裁", "✂️", 4500, 1, { personal: 2, quick: 1 }, S, "剪出最適合你臉型的長度。"),
  forFam("service", "salon")("base", "v_color", "染護", "🎨", 6000, 1, { luxury: 1, personal: 1, effective: 1 }, S, "顏色要挑對，才好看。"),
  forFam("service", "nail")("base", "v_gel", "凝膠指彩", "💅", 4500, 1, { luxury: 1, personal: 1, quick: 1 }, S, "亮晶晶的，可以撐三週。", "凝膠"),
  forFam("service", "nail")("base", "v_nailcare", "護甲保養", "🪥", 4000, 1, { natural: 1, personal: 2 }, S, "手指也需要被好好照顧。", "護甲"),
  forFam("service", "photo_studio")("base", "v_portrait", "人像拍攝", "📷", 6000, 1, { personal: 2, luxury: 1 }, S, "拍下你最自然的那一刻。", "人像"),
  forFam("service", "photo_studio")("base", "v_familyshoot", "全家合照", "👨‍👩‍👧", 6000, 1, { warm: 2, personal: 1 }, S, "三代同堂，一張照片。", "合照"),
  forFam("service", "spa")("base", "v_hotstone", "熱石", "🪨", 6500, 1, { wellness: 2, calm: 1 }, S, "暖暖的石頭壓在背上，整個人都鬆了。"),

  // ── 健身房、瑜伽
  forFam("service", "gym")("base", "v_strength", "重量訓練", "🏋️", 5000, 1, { effective: 2, wellness: 1 }, S, "每一組都在累積。", "重訓"),
  forFam("service", "gym")("base", "v_cardio", "有氧課程", "🏃", 4500, 1, { effective: 1, social: 1, quick: 1 }, S, "音樂一開，大家都動起來。", "有氧"),
  forFam("service", "yoga")("base", "v_flow", "流動瑜伽", "🧘", 5000, 1, { calm: 2, wellness: 1 }, S, "跟著呼吸，一個動作接一個。"),
  forFam("service", "yoga")("base", "v_breath", "呼吸冥想", "🌬️", 4000, 1, { calm: 2, natural: 1 }, S, "閉上眼，聽自己的呼吸。", "冥想"),

  // ── 旅宿、旅行社
  forFam("service", "hotel")("base", "v_suite", "套房", "🛏️", 8000, 1, { luxury: 2, calm: 1 }, S, "落地窗、大浴缸、軟綿綿的床。"),
  forFam("service", "hotel")("base", "v_roomservice", "客房服務", "🛎️", 6000, 1, { personal: 2, luxury: 1 }, S, "想要什麼，打個電話就來了。"),
  forFam("service", "capsule_hotel")("base", "v_pod", "睡眠艙", "🛏️", 5500, 1, { calm: 2, quick: 1 }, S, "小小一格，安靜又隱密。"),
  forFam("service", "capsule_hotel")("base", "v_quiethall", "靜音走廊", "🤫", 4000, 1, { calm: 2 }, S, "走路都要輕輕的。", "靜音"),
  forFam("service", "travel_agency")("base", "v_itinerary", "行程規劃", "🗺️", 5000, 1, { personal: 2, effective: 1 }, S, "每一天去哪、吃什麼，都安排好了。", "行程"),
  forFam("service", "travel_agency")("base", "v_localguide", "在地導覽", "🚶", 5000, 1, { personal: 1, social: 1, natural: 1 }, S, "跟著老街居民走，才知道真正的好地方。", "導覽"),

  // ── 共享辦公、會議、活動場地
  forFam("service", "coworking")("base", "v_desk", "共享座位", "💺", 4500, 1, { quick: 1, social: 1, calm: 1 }, S, "想坐哪就坐哪，插座永遠夠用。"),
  forFam("service", "coworking conference")("base", "v_meetingroom", "小會議室", "🚪", 5500, 1, { effective: 2, calm: 1 }, S, "關上門就是自己的空間。"),
  forFam("service", "coworking event_space")("base", "v_networking", "交流聚會", "🥂", 5000, 1, { social: 2, personal: 1 }, S, "一杯飲料，認識幾位新朋友。", "交流"),
  forFam("service", "conference")("base", "v_projector", "簡報設備", "📽️", 6000, 1, { tech: 2, effective: 1 }, S, "螢幕清晰，麥克風不會雜音。", "簡報"),
  forFam("service", "conference event_space")("base", "v_catering", "茶點供應", "☕", 4500, 1, { warm: 1, luxury: 1, personal: 1 }, S, "會議間休息，咖啡與點心剛好送到。"),
  forFam("service", "event_space")("base", "v_stage", "舞台租借", "🎤", 6500, 1, { luxury: 1, social: 2 }, S, "燈光、音響、座位一次到位。", "舞台"),
  forFam("service", "event_space")("base", "v_decor", "場地布置", "🎊", 6500, 2, { luxury: 2, personal: 1 }, L(2), "花圈、氣球、燈串，變一個樣子。", "布置"),
];

// 供應商、常客解鎖的素材留在 recipes.ts；這裡的新素材都是起始或等級解鎖。

export const EXTRA_INGREDIENTS: IngredientData[] = [...FOOD, ...RETAIL, ...ENTERTAINMENT, ...SERVICE];
