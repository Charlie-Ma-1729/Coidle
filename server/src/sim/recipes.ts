import type { CategoryGroup, IngredientInfo, PersonaId, SlotKind } from "@coidle/shared";

// 研發工坊的「隱藏」資料：素材的特性、配方、線索。
// 這個檔案只在伺服器端——玩家看不到清單，只能透過試做、線索與事件慢慢摸索。
// 名稱全部虛構；口味與氛圍只留含蓄的線索。

export type Unlock =
  | { t: "start" }
  /** 商場等級達到 */
  | { t: "level"; level: number }
  /** 這家供應商已經認識（含隱藏的新供應商），而且關係值達到 rel */
  | { t: "supplier"; id: string; rel?: number }
  /** 這位常客的故事解鎖到第幾段 */
  | { t: "regular"; id: string; stage: number }
  /** 對這家對手刺探過情報 */
  | { t: "rival"; id: string }
  /** 已經發現的配方達到幾道 */
  | { t: "discoveries"; n: number };

export interface IngredientData extends IngredientInfo {
  /** 自動命名時用的簡短詞 */
  word: string;
  /** 1–3：越高級，做出來的原創品質越好 */
  grade: 1 | 2 | 3;
  /** 隱藏特性：標籤 id → 強度 1–3 */
  tags: Record<string, number>;
  unlock: Unlock;
}

type Tags = Record<string, number>;
const ing = (
  group: CategoryGroup,
  slot: SlotKind,
  id: string,
  name: string,
  icon: string,
  cost: number,
  grade: 1 | 2 | 3,
  tags: Tags,
  unlock: Unlock,
  desc: string,
  word = name,
): IngredientData => ({ id, group, slot, name, icon, cost, grade, tags, unlock, desc, word });

const S: Unlock = { t: "start" };
const L = (level: number): Unlock => ({ t: "level", level });
const SUP = (id: string, rel?: number): Unlock => ({ t: "supplier", id, rel });
const REG = (id: string, stage: number): Unlock => ({ t: "regular", id, stage });
const RIV = (id: string): Unlock => ({ t: "rival", id });
const DISC = (n: number): Unlock => ({ t: "discoveries", n });

export const INGREDIENTS: IngredientData[] = [
  // ───────── 餐飲：主料
  ing("food", "base", "f_pork", "豬里肌", "🥩", 3000, 1, { umami: 2, rich: 1 }, S, "肉鋪今早送來的，油花不多不少。"),
  ing("food", "base", "f_chicken", "雞腿肉", "🍗", 3000, 1, { umami: 2, light: 1 }, S, "皮薄肉嫩，最基本的好選擇。"),
  ing("food", "base", "f_cabbage", "高麗菜", "🥬", 1500, 1, { sweet: 1, light: 2, crisp: 1 }, S, "切得細細的，清甜多汁。"),
  ing("food", "base", "f_noodle", "手打麵", "🍜", 2500, 1, { warm: 2, light: 1 }, S, "彈牙有勁，吸飽了湯頭才好吃。"),
  ing("food", "base", "f_octopus", "章魚", "🐙", 4000, 1, { umami: 2, light: 1 }, S, "港口剛上岸的，嚼起來脆中帶彈。"),
  ing("food", "base", "f_shrimp", "鮮蝦", "🦐", 5000, 2, { umami: 3, sweet: 1 }, L(2), "透亮飽滿，帶著海的甜。"),
  ing("food", "base", "f_tofu", "嫩豆腐", "⬜", 1500, 1, { light: 2, umami: 1 }, L(2), "老店現做，什麼味道都肯吸。"),
  ing("food", "base", "f_rice", "新米", "🍚", 2000, 1, { warm: 1, light: 1, sweet: 1 }, L(2), "粒粒分明，光吃就有甜味。"),
  ing("food", "base", "f_beef", "和牛薄片", "🥩", 9000, 3, { rich: 3, umami: 2 }, SUP("meat_kuro", 35), "高級肉鋪的看家貨，入口即化。"),
  ing("food", "base", "f_redbean", "北海道紅豆", "🫘", 3500, 2, { sweet: 3, warm: 1 }, REG("lin", 1), "常客帶來的老味道，煮起來滿屋子香。", "紅豆"),
  ing("food", "base", "f_squid", "近海小卷", "🦑", 5000, 2, { umami: 2, crisp: 1 }, SUP("sea_farm"), "新開養殖社送來的樣品，口感很特別。"),
  // ── 調味
  ing("food", "season", "f_salt", "海鹽", "🧂", 500, 1, { salty: 3 }, S, "最單純的鹹，用多少是學問。"),
  ing("food", "season", "f_soy", "醬油", "🍶", 800, 1, { salty: 2, umami: 1, aroma: 1 }, S, "老釀造的香氣，每家都有自己的味道。"),
  ing("food", "season", "f_sugar", "砂糖", "🍬", 500, 1, { sweet: 3 }, S, "雪白細緻，多放一點就整個變了。"),
  ing("food", "season", "f_vinegar", "米醋", "🍾", 700, 1, { sour: 3 }, S, "透明乾淨的酸，嗆鼻但很提神。"),
  ing("food", "season", "f_chili", "一味唐辛子", "🌶️", 900, 1, { spicy: 3 }, S, "紅通通一小罐，手要抖得準。"),
  ing("food", "season", "f_citrus", "柑橘汁", "🍋", 1500, 2, { sour: 2, aroma: 2, light: 1 }, L(2), "現榨的，皮的苦香也一起進去了。"),
  ing("food", "season", "f_miso", "合わせ味噌", "🥣", 1800, 2, { salty: 1, umami: 2, rich: 1 }, L(2), "兩種味噌調出來的，湯頭靠它撐場。", "味噌"),
  ing("food", "season", "f_dashi", "柴魚高湯", "🍵", 2500, 2, { umami: 3, light: 1, warm: 1 }, REG("obaa", 1), "歐巴桑傳授的火候，湯清得見底。", "出汁"),
  ing("food", "season", "f_sesame", "芝麻醬", "🥜", 2200, 2, { rich: 2, aroma: 2 }, SUP("grain_roho", 40), "石臼研磨的香氣，老舖子才有的。"),
  ing("food", "season", "f_sauce", "濃厚醬汁", "🥫", 1800, 2, { sweet: 1, sour: 1, salty: 1, rich: 1 }, RIV("gourmet"), "對手招牌上的那種黑亮醬汁，你終於摸清了配方的方向。", "濃醬"),
  ing("food", "season", "f_mayo", "美乃滋", "🥚", 1200, 1, { rich: 2, sour: 1 }, L(3), "擠一圈就能蓋住所有缺點——但也可能蓋住優點。"),
  // ── 手法
  ing("food", "method", "f_fry", "酥炸", "🍤", 1000, 1, { crisp: 3, rich: 1 }, S, "油溫要抓準，起鍋的聲音最誠實。"),
  ing("food", "method", "f_grill", "炭火直烤", "🔥", 1200, 1, { aroma: 3, warm: 1 }, S, "備長炭燒得通紅，香氣是靠火候逼出來的。", "炭烤"),
  ing("food", "method", "f_boil", "慢火燉煮", "♨️", 800, 1, { warm: 3, light: 1 }, S, "一鍋湯守三小時，急不得。", "燉煮"),
  ing("food", "method", "f_steam", "蒸", "🫕", 800, 1, { light: 2, warm: 1 }, S, "保留食材的原味，騙不了人。"),
  ing("food", "method", "f_raw", "生鮮切片", "🔪", 1500, 2, { light: 3 }, L(2), "刀工說話，食材要夠新鮮才敢這樣做。", "生切"),
  ing("food", "method", "f_stirfry", "大火快炒", "🍳", 1000, 1, { aroma: 2, warm: 1, crisp: 1 }, L(2), "鍋氣十足，翻鍋的手一刻不能停。", "快炒"),
  ing("food", "method", "f_pickle", "醃漬", "🫙", 1200, 1, { salty: 1, sour: 2 }, L(3), "時間是最好的調味，要等。"),
  ing("food", "method", "f_smoke", "煙燻", "💨", 2000, 2, { aroma: 2, rich: 1 }, SUP("meat_import"), "進口商帶來的一台小燻爐，煙的味道很不一樣。"),
  // ── 特色
  ing("food", "special", "f_egg", "溏心蛋", "🥚", 1000, 1, { rich: 2, umami: 1 }, L(2), "蛋黃半凝，筷子一戳就流出來。"),
  ing("food", "special", "f_cheese", "起司", "🧀", 2500, 2, { rich: 3, salty: 1 }, SUP("sweet_dairy", 30), "牧場合作社的，融化時會拉出長長的絲。"),
  ing("food", "special", "f_yuzu", "柚子胡椒", "🌿", 1800, 2, { spicy: 1, sour: 1, aroma: 2 }, L(3), "只能用一點點，香得很有個性。"),
  ing("food", "special", "f_nori", "海苔", "🟩", 900, 1, { umami: 2, aroma: 1 }, L(2), "烤過的，一撕就有海的味道。"),
  ing("food", "special", "f_bonito", "鰹節", "🐟", 2000, 2, { umami: 2, aroma: 2 }, SUP("sea_naniwa", 40), "刨得像紙一樣薄，遇熱會輕輕舞動。"),
  ing("food", "special", "f_honey", "蜂蜜", "🍯", 2500, 2, { sweet: 2, aroma: 1 }, SUP("sweet_craft"), "手作原料行的小批量蜂蜜，花香很淡。"),
  ing("food", "special", "f_sansho", "山椒", "🫚", 2200, 2, { spicy: 2, aroma: 2 }, DISC(2), "有了一點心得之後，才有人願意告訴你這個。"),
  ing("food", "special", "f_oldoil", "祖傳老油", "🛢️", 3000, 3, { rich: 2, aroma: 2 }, REG("afu", 2), "阿富叔偷偷塞給你的小罐子，說「別告訴別人」。", "老油"),

  // ───────── 零售：選品
  ing("retail", "base", "r_cotton", "棉布", "🧶", 4000, 1, { practical: 2, classic: 1 }, S, "柔軟耐洗，什麼款式都能做。"),
  ing("retail", "base", "r_canvas", "帆布", "🎒", 4000, 1, { practical: 2, trendy: 1 }, S, "厚實挺括，越用越有味道。"),
  ing("retail", "base", "r_paper", "和紙", "📜", 3500, 1, { classic: 2, eco: 1, local: 1 }, S, "纖維明顯的手漉紙，摸起來很溫暖。"),
  ing("retail", "base", "r_ceramic", "陶土", "🏺", 6000, 2, { classic: 1, premium: 2 }, L(2), "窯口來的陶土，燒出來的顏色會有點意外。"),
  ing("retail", "base", "r_plush", "毛絨布", "🧸", 5000, 1, { cute: 3 }, L(2), "摸一下就想抱回家。"),
  ing("retail", "base", "r_leather", "植鞣皮革", "👜", 9000, 3, { premium: 2, classic: 1, practical: 1 }, SUP("goods_agent", 35), "代理商手上的好皮，隨年份越用越亮。"),
  ing("retail", "base", "r_recycled", "再生纖維", "♻️", 5000, 2, { eco: 3, practical: 1 }, SUP("goods_indie"), "獨立設計師們愛用的新素材。"),
  ing("retail", "base", "r_metal", "鋁合金", "🔩", 6000, 2, { tech: 1, premium: 1, practical: 2 }, L(3), "輕、耐用，冷冷的觸感。"),
  ing("retail", "season", "r_retro", "昭和復古風", "📻", 2000, 1, { classic: 2, local: 2 }, S, "褪色的招牌字體、老式的配色。", "復古"),
  ing("retail", "season", "r_kawaii", "卡哇伊風", "🎀", 2000, 1, { cute: 3, playful: 1 }, S, "糖果色、圓圓的線條。", "可愛"),
  ing("retail", "season", "r_hand", "手作質樸風", "🪡", 2500, 1, { eco: 1, local: 1, premium: 1 }, S, "不求完美，看得出是人做的。", "手作"),
  ing("retail", "season", "r_minimal", "極簡風", "⬜", 2500, 2, { premium: 2, practical: 1 }, L(2), "留白很多，貴氣就是靠少。", "極簡"),
  ing("retail", "season", "r_street", "街頭風", "🛹", 2500, 1, { trendy: 3 }, L(2), "塗鴉、拼貼、大 Logo。", "街頭"),
  ing("retail", "season", "r_neon", "霓虹風", "💡", 3000, 2, { trendy: 2, playful: 1, tech: 1 }, RIV("skyline"), "天際城展場上那種閃爍的味道。", "霓虹"),
  ing("retail", "method", "r_embroid", "刺繡", "🧵", 3000, 1, { premium: 2, classic: 1 }, S, "一針一線，師傅的手藝。"),
  ing("retail", "method", "r_print", "絹印", "🖨️", 2500, 1, { trendy: 2, playful: 1 }, S, "圖案鮮明，量產也不失個性。"),
  ing("retail", "method", "r_dye", "藍染", "🔵", 3500, 2, { local: 2, classic: 1, eco: 1 }, L(2), "每一件的顏色都有一點不同。"),
  ing("retail", "method", "r_laser", "雷射刻印", "✨", 5000, 2, { tech: 3, premium: 1 }, L(3), "細到頭髮絲都看得出。", "雷刻"),
  ing("retail", "method", "r_collab", "跨界聯名", "🤝", 6000, 2, { trendy: 2, limited: 2 }, L(3), "找對夥伴，兩邊的粉絲都會來。", "聯名"),
  ing("retail", "method", "r_weave", "手工編織", "🧺", 3500, 1, { local: 1, eco: 2, classic: 1 }, REG("michi", 1), "老主顧傳授的編法，扎實又好看。", "編織"),
  ing("retail", "special", "r_numbered", "編號限量", "🔢", 2000, 1, { limited: 3 }, L(2), "每件都有獨一無二的編號。", "限量"),
  ing("retail", "special", "r_sticker", "贈品貼紙", "🏷️", 800, 1, { playful: 2, cute: 1 }, S, "小小的，但小朋友一定要收集。", "貼紙"),
  ing("retail", "special", "r_motif", "在地圖案", "🏮", 1500, 1, { local: 3 }, S, "印著街角的老招牌圖案。", "在地"),
  ing("retail", "special", "r_led", "發光元件", "🔆", 3500, 2, { tech: 2, playful: 1, trendy: 1 }, DISC(3), "有一點成果之後，工廠才肯接這種小單。", "發光"),
  ing("retail", "special", "r_scent", "香氛", "🕯️", 2500, 2, { premium: 2 }, L(2), "淡淡的，要靠近才聞得到。"),
  ing("retail", "special", "r_sign", "插畫家簽名", "✒️", 2500, 2, { limited: 2, local: 1, premium: 1 }, REG("sayuri", 2), "小百合答應在每一件上簽名。", "簽名"),

  // ───────── 娛樂：內容
  ing("entertainment", "base", "e_detective", "偵探推理", "🕵️", 8000, 1, { story: 2, immersive: 1, social: 1 }, S, "每個人都是嫌疑犯。", "推理"),
  ing("entertainment", "base", "e_retro", "懷舊街機", "🕹️", 8000, 1, { nostalgia: 3, competitive: 1 }, S, "老機台的搖桿，按起來特別有感覺。", "街機"),
  ing("entertainment", "base", "e_animal", "動物森林", "🦊", 8000, 1, { family: 2, relax: 1, visual: 1 }, S, "圓滾滾的動物們住在這裡。", "森林"),
  ing("entertainment", "base", "e_space", "太空探險", "🚀", 10_000, 2, { immersive: 2, visual: 2, thrill: 1 }, L(2), "漂浮在星空裡，沒有上下左右。", "太空"),
  ing("entertainment", "base", "e_festival", "夏日祭典", "🏮", 9000, 1, { social: 2, music: 1, nostalgia: 1, visual: 1 }, L(2), "攤販、燈籠與盆舞，熟悉的熱鬧。", "祭典"),
  ing("entertainment", "base", "e_sports", "運動競賽", "🏅", 9000, 2, { competitive: 3, thrill: 1 }, L(3), "拚的是汗水與一口氣。", "競賽"),
  ing("entertainment", "season", "e_puzzle", "謎題挑戰", "🧩", 4000, 1, { competitive: 1, story: 1, social: 1 }, S, "卡關的時候最有趣。", "解謎"),
  ing("entertainment", "season", "e_contest", "排名賽", "🏆", 4000, 1, { competitive: 3 }, S, "每個人都想上榜。", "排名"),
  ing("entertainment", "season", "e_sing", "歌單串燒", "🎵", 3500, 1, { music: 3, social: 1 }, S, "一首接一首，沒人想換場。", "串燒"),
  ing("entertainment", "season", "e_perform", "現場表演", "🎭", 6000, 2, { visual: 1, music: 2, social: 1 }, L(2), "近在眼前的那種感動。", "表演"),
  ing("entertainment", "season", "e_craft", "親手製作", "🎨", 4000, 1, { family: 2, relax: 1, social: 1 }, L(2), "帶一個自己做的東西回家。", "手作"),
  ing("entertainment", "method", "e_team", "團隊對抗", "👥", 3000, 1, { social: 2, competitive: 2 }, S, "同隊的人，下一秒就成了好朋友。", "團戰"),
  ing("entertainment", "method", "e_quiet", "靜態展示", "🖼️", 2500, 1, { relax: 2, visual: 1, nostalgia: 1 }, S, "慢慢走、慢慢看。", "展示"),
  ing("entertainment", "method", "e_live", "真人演出", "🎬", 6000, 2, { immersive: 2, story: 1, visual: 1 }, L(2), "演員就在你身邊走動。", "真人"),
  ing("entertainment", "method", "e_ride", "體感機台", "🎢", 7000, 2, { thrill: 3 }, L(2), "座椅會震動、傾斜、翻轉。", "體感"),
  ing("entertainment", "method", "e_vr", "VR 體驗", "🥽", 8000, 2, { immersive: 3, thrill: 1, visual: 1 }, L(3), "戴上之後，整個世界就換了。"),
  ing("entertainment", "method", "e_proj", "光影投影", "📽️", 8000, 2, { visual: 3, immersive: 1 }, L(3), "整面牆都是畫布。", "光影"),
  ing("entertainment", "special", "e_costume", "變裝", "👘", 2500, 1, { visual: 2, social: 1, family: 1 }, S, "穿上去就變成另一個人。"),
  ing("entertainment", "special", "e_mascot", "吉祥物", "🐻", 3000, 1, { family: 2, visual: 1 }, S, "大頭玩偶一出場就被小孩包圍。"),
  ing("entertainment", "special", "e_snack", "限定點心", "🍡", 2000, 1, { family: 1, relax: 1, social: 1 }, S, "只有活動期間才吃得到。"),
  ing("entertainment", "special", "e_glow", "螢光特效", "🌈", 3500, 2, { visual: 2, thrill: 1 }, L(2), "熄燈之後，全場一起亮。"),
  ing("entertainment", "special", "e_prize", "抽獎", "🎁", 3000, 1, { competitive: 1, social: 1, thrill: 1 }, L(2), "只要有獎，大家都會多試一次。"),
  ing("entertainment", "special", "e_band", "駐場樂團", "🎸", 6000, 3, { music: 3, social: 1 }, REG("sakura", 2), "櫻花介紹的樂團，願意只收一半車馬費。", "樂團"),

  // ───────── 服務：療程
  ing("service", "base", "v_massage", "按摩", "💆", 5000, 1, { effective: 2, calm: 1 }, S, "扎實的手法，師傅摸一下就知道哪裡卡住。"),
  ing("service", "base", "v_hair", "髮型設計", "💇", 5000, 1, { personal: 2, quick: 1, luxury: 1 }, S, "剪之前會先聊聊你的生活。", "造型"),
  ing("service", "base", "v_fit", "體能課", "🏋️", 5000, 1, { effective: 2, social: 1, wellness: 1 }, S, "流汗之後什麼煩惱都忘了。"),
  ing("service", "base", "v_clean", "洗護", "🧺", 4000, 1, { quick: 2, effective: 1 }, S, "又快又乾淨，沒有多餘的步驟。"),
  ing("service", "base", "v_aroma", "芳香療法", "🌸", 7000, 2, { natural: 2, calm: 2, luxury: 1 }, L(2), "精油的味道，閉上眼就能睡著。", "芳療"),
  ing("service", "base", "v_spring", "溫泉浴", "♨️", 8000, 2, { warm: 2, wellness: 2, luxury: 1 }, L(2), "泡到全身都軟下來。", "溫泉"),
  ing("service", "base", "v_play", "育兒遊戲", "🧩", 6000, 2, { warm: 2, personal: 1, social: 1 }, L(3), "一起玩，孩子就不怕生了。"),
  ing("service", "season", "v_herb", "草本茶飲", "🍵", 2000, 1, { natural: 2, wellness: 1, calm: 1 }, S, "一壺溫熱的茶，先暖手再暖心。", "草本"),
  ing("service", "season", "v_music", "輕音樂", "🎶", 1500, 1, { calm: 2, warm: 1 }, S, "輕得幾乎聽不見的鋼琴。"),
  ing("service", "season", "v_chat", "閒聊", "💬", 1000, 1, { personal: 2, warm: 1, social: 1 }, S, "最簡單、也最難的服務。"),
  ing("service", "season", "v_light", "暖光燈", "🏮", 2500, 2, { warm: 1, calm: 1, luxury: 1 }, L(2), "燈光調到剛剛好的橘黃。"),
  ing("service", "season", "v_app", "預約 App", "📱", 3500, 2, { tech: 2, quick: 1 }, L(3), "客人省時間，你也省人力。"),
  ing("service", "season", "v_robot", "機器人助手", "🤖", 5000, 2, { tech: 3 }, RIV("skyline"), "天際城展場上看到的小機器人，你悄悄記下了廠商。", "機器人"),
  ing("service", "method", "v_hand", "純手技", "🙌", 2000, 1, { personal: 2, warm: 1, effective: 1 }, S, "不靠機器，靠經驗。"),
  ing("service", "method", "v_group", "團體班", "👯", 1500, 1, { social: 2, quick: 1 }, S, "一起做，比較有動力。"),
  ing("service", "method", "v_hot", "熱敷", "🌡️", 2000, 1, { warm: 2, wellness: 1 }, S, "熱毛巾蓋上去的那一刻。"),
  ing("service", "method", "v_machine", "儀器輔助", "🩻", 4000, 2, { tech: 2, effective: 2 }, L(2), "數據不會騙人。", "儀器"),
  ing("service", "method", "v_one", "一對一", "🤝", 3500, 2, { personal: 3 }, L(2), "整個小時都只屬於你。"),
  ing("service", "method", "v_ai", "AI 分析", "🧠", 5000, 2, { tech: 2, personal: 1, quick: 1 }, L(3), "先掃描、再給建議。"),
  ing("service", "special", "v_towel", "熱毛巾", "🧻", 800, 1, { warm: 1, luxury: 1, personal: 1 }, S, "小小的細節，客人都記得。"),
  ing("service", "special", "v_gift", "伴手禮", "🎁", 1500, 1, { warm: 1, social: 1 }, S, "離開時遞過去的一小包。"),
  ing("service", "special", "v_member", "會員點數", "💳", 1500, 1, { social: 1, personal: 1, quick: 1 }, L(2), "累積多了，下次有驚喜。"),
  ing("service", "special", "v_tea", "午後茶點", "🫖", 3000, 2, { luxury: 2, social: 1, calm: 1 }, SUP("sweet_dairy", 40), "牧場合作社的鮮奶茶，客人讚不絕口。"),
  ing("service", "special", "v_sauna", "蒸氣室", "🧖", 6000, 2, { wellness: 2, luxury: 1, effective: 1 }, L(3), "出來的時候整個人都輕了。"),
  ing("service", "special", "v_tip", "達人指名", "⭐", 5000, 3, { luxury: 2, personal: 2 }, REG("coach", 2), "教練介紹的老師傅，一年只接幾位客人。"),
];

export const INGREDIENT_BY_ID: Record<string, IngredientData> = Object.fromEntries(INGREDIENTS.map((x) => [x.id, x]));

// ───────── 隱藏配方 ─────────

export type ClueCond =
  | { t: "regular"; id: string; affinity: number }
  | { t: "supplier"; id: string; rel: number }
  | { t: "rival"; id: string }
  | { t: "level"; level: number };

export interface RecipeClue {
  cond: ClueCond;
  text: string;
}

export interface RecipeData {
  id: string;
  group: CategoryGroup;
  /** 只有這些業態做得出來；省略＝同類型的店都可以 */
  categories?: string[];
  name: string;
  icon: string;
  desc: string;
  /** 所有特性總分都要達到 */
  need: Record<string, number>;
  /** 這些特性超過就不成立 */
  avoid?: Record<string, number>;
  /** 「手法」槽位必須是其中之一 */
  method?: string[];
  quality: number;
  appeal: Partial<Record<PersonaId, number>>;
  clues: RecipeClue[];
}

const R = (id: string, name: string, icon: string, group: CategoryGroup, categories: string[] | undefined, need: Record<string, number>, quality: number, appeal: Partial<Record<PersonaId, number>>, desc: string, clues: RecipeClue[], extra: { avoid?: Record<string, number>; method?: string[] } = {}): RecipeData => ({
  id, name, icon, group, categories, need, quality, appeal, desc, clues, ...extra,
});
const reg = (id: string, affinity: number, text: string): RecipeClue => ({ cond: { t: "regular", id, affinity }, text });
const sup = (id: string, rel: number, text: string): RecipeClue => ({ cond: { t: "supplier", id, rel }, text });
const riv = (id: string, text: string): RecipeClue => ({ cond: { t: "rival", id }, text });
const lvl = (level: number, text: string): RecipeClue => ({ cond: { t: "level", level }, text });

export const RECIPES: RecipeData[] = [
  // ───────── 餐飲
  R("rc_kushi_zesty", "柑香酥衣串", "🍢", "food", ["kushikatsu"], { crisp: 3, sour: 2, aroma: 2 }, 84, { tourist: 0.8, local: 0.6, couple: 0.5 }, "麵衣薄得透光、咬下去喀滋作響，收尾一抹柑橘清香。連老饕都說「這個可以」。",
    [reg("afu", 35, "阿富叔嘟囔：「串炸啊，最好咬下去喀滋響，再來一點檸檬那種清香的……」"), lvl(2, "市場的老闆娘說：「炸物配一點酸，才不會膩。」")], { avoid: { sweet: 3 }, method: ["f_fry"] }),
  R("rc_kushi_dark", "濃醬深色串", "🍢", "food", ["kushikatsu"], { crisp: 3, rich: 3, salty: 2 }, 80, { commuter: 0.8, student: 0.7, local: 0.5 }, "醬汁黑得發亮、酥衣又厚實，一串就是一口飯的份量。",
    [reg("chen", 35, "陳先生比劃著：「我家鄉那邊的炸物，醬汁是黑的、濃的，一串吃完整隻手都是味道。」")], { avoid: { sour: 3 }, method: ["f_fry"] }),
  R("rc_tako_dashi", "出汁章魚燒", "🥢", "food", ["takoyaki"], { umami: 4, light: 2, warm: 2 }, 82, { local: 0.8, tourist: 0.7, family: 0.5 }, "外皮柔軟、內裡幾乎化掉，一咬就湧出清甜的高湯。要用小碗裝著吃。",
    [reg("kenta", 35, "健太咂著嘴說：「章魚燒最好是軟軟的，一口咬下去，湯汁整個溢出來……」"), sup("sea_naniwa", 40, "浪花水產的老闆壓低聲音：「鰹節的香氣跟章魚是絕配，你試試看用燉的。」")], { method: ["f_boil", "f_steam"] }),
  R("rc_tako_cheese", "起司熔岩燒", "🧀", "food", ["takoyaki"], { rich: 3, crisp: 2, umami: 2 }, 78, { student: 0.8, family: 0.7, tourist: 0.6 }, "外酥內濃，起司拉出長長的絲，邊吃邊拍照的人排滿了隊。",
    [reg("emma", 35, "Emma 比著手機裡的照片：「Cheese! 要拉得很長很長的那種，好上相！」")], { method: ["f_fry", "f_grill"] }),
  R("rc_ramen_tonkotsu", "濃厚白湯拉麵", "🍜", "food", ["ramen"], { rich: 4, umami: 3, warm: 3 }, 86, { commuter: 0.8, student: 0.7, local: 0.6 }, "湯濃得掛得住筷子，一碗下肚就是滿足。午休的上班族都在排。",
    [reg("tanaka", 35, "田中先生邊擦汗邊說：「午休就是要吃那種湯濃到會黏嘴的，才算活過來。」")], { method: ["f_boil"] }),
  R("rc_ramen_shio", "清爽鹽味拉麵", "🍜", "food", ["ramen"], { light: 3, salty: 3, umami: 2 }, 80, { couple: 0.6, local: 0.6, tourist: 0.5 }, "湯清見底卻很有層次，喝完還想再來一口，女客人特別愛。",
    [lvl(3, "老饕在店裡說：「拉麵不是只有濃湯，清清的才見功夫。」")], { avoid: { rich: 2 }, method: ["f_boil", "f_steam"] }),
  R("rc_ramen_spicy", "辛味噌拉麵", "🌶️", "food", ["ramen", "udon"], { spicy: 3, umami: 3, rich: 2, warm: 2 }, 79, { student: 0.8, commuter: 0.7, tourist: 0.5 }, "辣得剛好、鮮得夠厚，冬天一碗喝下去整個人都冒汗。",
    [lvl(2, "學生們在店外小聲討論：「想要一碗會冒汗的、辣辣的……」")], { method: ["f_boil", "f_stirfry"] }),
  R("rc_udon_kake", "溫柔出汁烏龍", "🍲", "food", ["udon"], { warm: 4, umami: 3, light: 2 }, 82, { local: 0.8, family: 0.6, commuter: 0.5 }, "湯頭清淡卻有深度，像回到阿嬤家的那種溫度。",
    [reg("obaa", 30, "歐巴桑念著：「湯要像阿嬤煮的，喝下去整個人都暖起來，不用太多花樣。」")], { avoid: { spicy: 2 } }),
  R("rc_curry_smoke", "煙燻香料咖哩", "🍛", "food", ["curry"], { aroma: 4, spicy: 3, rich: 2 }, 83, { commuter: 0.7, student: 0.7, tourist: 0.6 }, "一口吃下去先是香氣、再來辣意慢慢爬上來，後勁十足。",
    [reg("daisuke", 35, "大輔說：「那個香氣啊，像營火邊的味道，吃了一口，後勁才上來。」")], { method: ["f_smoke", "f_grill"] }),
  R("rc_kissa_pudding", "老派硬布丁", "🍮", "food", ["kissaten", "sweets"], { sweet: 3, rich: 2, aroma: 1 }, 80, { local: 0.7, couple: 0.6, tourist: 0.5 }, "蛋香濃、質地紮實，上面一層焦苦的焦糖。是會讓人說「就是這個味道」的那種。",
    [reg("sayuri", 35, "小百合托著腮說：「最想念的還是那種老式的硬布丁，蛋香很濃、口感紮紮實實的……」")], { avoid: { sour: 2 } }),
  R("rc_kissa_citrus", "柑橘冰滴咖啡", "🍹", "food", ["kissaten", "bubble_tea"], { sour: 2, aroma: 3, light: 2 }, 78, { couple: 0.7, tourist: 0.6, student: 0.5 }, "咖啡的香氣裡藏著一絲柑橘，夏天喝格外清爽。",
    [lvl(3, "客人在留言簿寫：「夏天想喝清爽一點、有香氣的，不要太甜。」")], { avoid: { sweet: 3 } }),
  R("rc_sweets_bean", "紅豆暖甜湯", "🥣", "food", ["sweets", "kissaten"], { sweet: 4, warm: 2, aroma: 1 }, 81, { local: 0.7, family: 0.6, couple: 0.5 }, "熬到軟爛的紅豆，一匙就能暖到心裡。",
    [reg("lin", 35, "小林笑著說：「我們家鄉冬天都喝這個，熱熱甜甜的，心情會變好。」")]),
  R("rc_bubble_honey", "蜂蜜花茶", "🍯", "food", ["bubble_tea"], { sweet: 3, aroma: 2, light: 2 }, 79, { student: 0.8, couple: 0.7, tourist: 0.5 }, "花香與蜂蜜的甜，喝起來清清淡淡，拍照也很好看。",
    [reg("misaki", 35, "美咲滑著手機說：「想要那種喝起來有花香、甜但不膩的，最好拍照也漂亮！」")]),
  R("rc_grocery_deli", "暖心惣菜", "🍱", "food", ["grocery"], { salty: 2, umami: 2, warm: 2 }, 76, { local: 0.8, family: 0.7, commuter: 0.5 }, "媽媽味的家常菜，下班回家順手就能帶一盒。",
    [reg("michi", 35, "美智阿姨說：「下班很累的時候，想帶一份熱熱的、鹹鹹的家常菜回家。」")]),
  R("rc_izakaya_pickle", "醃漬下酒菜", "🥒", "food", ["izakaya", "bar", "hotpot"], { sour: 3, salty: 2, crisp: 1 }, 77, { commuter: 0.8, local: 0.6, tourist: 0.5 }, "酸、鹹、脆三種口感交織，一小碟就能多喝兩杯。",
    [lvl(3, "常客在吧台前說：「下酒的東西，要爽脆、要酸酸的才夠味。」")]),
  R("rc_yaki_char", "炭火熟成燒肉", "🥩", "food", ["yakiniku"], { aroma: 4, umami: 3, rich: 2 }, 88, { couple: 0.8, family: 0.7, tourist: 0.7 }, "烤到邊緣微焦、肉汁飽滿，一翻面香氣就衝上來。",
    [sup("meat_kuro", 35, "黑門肉鋪的師傅說：「好肉不要亂加調味，用炭火慢慢逼出香氣就夠了。」")], { method: ["f_grill"] }),
  R("rc_sushi_aged", "熟成握壽司", "🍣", "food", ["sushi"], { umami: 4, light: 2, sour: 1 }, 87, { tourist: 0.9, couple: 0.7, local: 0.4 }, "放過幾天的魚肉鮮味更濃，配上微酸的醋飯，入口即化。",
    [sup("sea_asaichi", 35, "朝市直送屋的大叔說：「魚啊，有時候放一放才會變甜，要看你的手藝。」")], { method: ["f_raw"] }),
  R("rc_food_five", "五味調和", "🥘", "food", undefined, { salty: 2, sweet: 2, sour: 2, spicy: 2 }, 84, { tourist: 0.7, local: 0.6, couple: 0.6, student: 0.6 }, "甜、酸、鹹、辣在舌尖輪流登場，每一口都不一樣。據說是老前輩們的傳說配方。",
    [lvl(4, "一位退休的老廚師說：「真正厲害的菜，是讓每種味道都剛好站得住。」")]),
  R("rc_food_comfort", "暖心家常", "🍲", "food", undefined, { warm: 4, umami: 2, light: 2 }, 74, { local: 0.8, family: 0.7, commuter: 0.5 }, "沒什麼花俏，就是暖暖的、很安心。最容易被誤打誤撞做出來。",
    [lvl(1, "店員悄悄說：「有時候，最簡單的搭配反而最好吃。」")], { avoid: { spicy: 2, rich: 3 }, method: ["f_boil", "f_steam"] }),

  // ───────── 零售
  R("rc_r_showa", "昭和風復古 T 恤", "👕", "retail", ["fashion"], { classic: 3, local: 2, practical: 1 }, 80, { local: 0.7, tourist: 0.8, couple: 0.5 }, "褪色的印刷、老街招牌的字體，觀光客一次買好幾件。",
    [lvl(2, "老街的阿婆說：「以前的衣服啊，都是這個味道啦。」")]),
  R("rc_r_indigo", "藍染手作包", "👜", "retail", ["fashion", "select_shop"], { local: 3, eco: 2, classic: 1 }, 82, { tourist: 0.8, couple: 0.6, local: 0.4 }, "每一只的紋路都不同，用久了顏色更好看。",
    [lvl(2, "旅客在櫃台問：「有沒有那種，一看就知道是這裡才有的手工包？」")]),
  R("rc_r_limited", "聯名限量款", "🎫", "retail", ["fashion", "popup", "select_shop"], { limited: 4, trendy: 3 }, 84, { student: 0.9, couple: 0.7, tourist: 0.6 }, "發售當天一早就排隊，社群上被瘋狂轉發。",
    [riv("skyline", "天際城的快閃店前排了一整條人龍：「限量」兩個字就是有魔力。")]),
  R("rc_r_cute", "萌系文具組", "✏️", "retail", ["stationery", "select_shop"], { cute: 3, playful: 2, practical: 1 }, 76, { student: 0.8, family: 0.7, couple: 0.5 }, "每一件都小小的、圓圓的，小朋友與大人都忍不住想收藏。",
    [lvl(3, "小朋友趴在櫥窗前：「這個可以用嗎？還是只能看？」")]),
  R("rc_r_eco", "再生環保袋", "♻️", "retail", ["select_shop", "drugstore", "popup"], { eco: 4, practical: 2 }, 78, { couple: 0.6, family: 0.6, tourist: 0.5 }, "把回收材料做成實用的袋子，購物時有了新理由。",
    [sup("goods_indie", 30, "獨立設計師們說：「我們想做那種，環保卻又不會像在說教的日常用品。」")]),
  R("rc_r_neon", "霓虹科技小物", "🔆", "retail", ["electronics", "popup"], { tech: 3, trendy: 2, playful: 1 }, 82, { student: 0.8, tourist: 0.7, commuter: 0.5 }, "桌上放一個就像擺了件藝術品，一打開整個空間都亮了。",
    [riv("skyline", "天際城的展示廳裡，有種閃著霓虹光的小東西，年輕人都在拍。")]),
  R("rc_r_local_zine", "在地小誌", "📖", "retail", ["bookstore"], { local: 3, classic: 1, premium: 1 }, 77, { tourist: 0.7, local: 0.6, couple: 0.5 }, "把街角的故事印成一本小冊子，連老居民都說「這是我們的」。",
    [lvl(3, "老街的居民說：「這裡有那麼多故事，應該要有人好好記下來。」")]),

  // ───────── 娛樂
  R("rc_e_mystery", "全館推理遊戲", "🕵️", "entertainment", ["arcade_vr", "kids_play", "observatory"], { story: 3, social: 2, competitive: 1 }, 80, { student: 0.8, couple: 0.7, tourist: 0.6 }, "拿著線索卡在各個角落奔走，大家吵吵鬧鬧，卻都樂在其中。",
    [lvl(2, "常客說：「要是能有那種，大家一起找線索、抓兇手的遊戲就好了。」")]),
  R("rc_e_family_fest", "親子祭典日", "🎏", "entertainment", ["kids_play"], { family: 3, social: 2, music: 1 }, 78, { family: 0.95, local: 0.4 }, "攤位、遊戲與小型舞台，全家都玩得很開心。",
    [lvl(2, "年輕的爸媽說：「想找個，小孩玩得開心、我們也不無聊的地方。」")]),
  R("rc_e_vr_space", "太空 VR 探險", "🛸", "entertainment", ["arcade_vr"], { immersive: 4, visual: 2, thrill: 2 }, 86, { student: 0.9, tourist: 0.8, couple: 0.7 }, "戴上頭盔後，整個人漂浮在星空中。出來的時候，大家都還在喘氣。",
    [lvl(3, "玩家們在討論區留言：「有沒有那種，戴上去就像真的飛到宇宙的？」")]),
  R("rc_e_retro_cup", "懷舊街機大賽", "🕹️", "entertainment", ["arcade_vr"], { nostalgia: 3, competitive: 3 }, 79, { local: 0.8, commuter: 0.7, student: 0.6 }, "老機台的叮叮聲響成一片，叔叔們認真得像回到二十歲。",
    [reg("daisuke", 40, "大輔聊起往事：「以前我可是店裡的紀錄保持人，現在還有人打得過我嗎？」")]),
  R("rc_e_showa_night", "昭和歌謠夜", "🎤", "entertainment", ["karaoke"], { music: 3, nostalgia: 2, social: 2 }, 80, { local: 0.9, commuter: 0.7, couple: 0.5 }, "老歌一首接一首，全場合唱，連隔壁包廂都忍不住探頭進來。",
    [reg("tanaka", 45, "田中先生哼著小調說：「下班後，最想唱幾首老歌，那種大家都會唱的。」")]),
  R("rc_e_sky_light", "夜景光影秀", "🌃", "entertainment", ["observatory", "cinema"], { visual: 4, relax: 1, immersive: 1 }, 83, { couple: 0.9, tourist: 0.9, family: 0.6 }, "整片夜景與光影交織，情侶們靜靜依偎著看完。",
    [lvl(4, "來看夜景的情侶說：「要是能有點燈光、有點音樂，就更完美了。」")]),

  // ───────── 服務
  R("rc_v_spa_herbal", "草本溫養療程", "🌿", "service", ["spa"], { natural: 3, wellness: 3, calm: 2 }, 84, { tourist: 0.8, couple: 0.7, local: 0.5 }, "草本的香氣讓人整個放鬆，做完神清氣爽。",
    [lvl(3, "旅客在留言簿寫：「想要一個，能讓人完全放鬆、又很自然的療程。」")]),
  R("rc_v_salon_pick", "指名造型", "💇", "service", ["salon"], { personal: 3, luxury: 2, quick: 1 }, 82, { couple: 0.8, commuter: 0.6, tourist: 0.5 }, "指定一位師傅，從聊天到成品都讓人安心。",
    [lvl(3, "熟客說：「我就是想固定給同一個人剪，他懂我。」")]),
  R("rc_v_gym_group", "熱血團課", "🏃", "service", ["gym"], { social: 3, effective: 2, wellness: 1 }, 78, { commuter: 0.8, student: 0.6, local: 0.5 }, "大家一起喊口號，原本懶得運動的人也變得熱血。",
    [reg("coach", 40, "教練笑著說：「一個人運動很容易放棄，一群人一起，就不會了。」")]),
  R("rc_v_clinic_calm", "安心診察", "🩺", "service", ["clinic"], { calm: 2, personal: 3, warm: 2 }, 80, { local: 0.9, family: 0.8 }, "醫生會先問「最近睡得好嗎」，大家都放下心防。",
    [lvl(3, "老人家說：「看病最怕冷冰冰的，有人願意聽我說話就很好了。」")]),
  R("rc_v_daycare_play", "遊戲式托育", "🧸", "service", ["daycare"], { warm: 2, social: 2, personal: 2 }, 79, { family: 0.95 }, "小朋友們玩著玩著就學會了合作，爸媽都放心。",
    [lvl(3, "媽媽們在群組裡：「想找個，小孩玩得開心又學到東西的地方。」")]),
  R("rc_v_laundry_quick", "快速洗護", "🧺", "service", ["laundry"], { quick: 3, effective: 2, tech: 1 }, 74, { commuter: 0.8, tourist: 0.7, student: 0.6 }, "趕時間的旅客，三十分鐘就能取走一包乾淨的衣服。",
    [lvl(2, "旅客問：「有沒有可以很快洗好、烘好的地方？我下午就要搭機了。」")]),
];

export const RECIPE_BY_ID: Record<string, RecipeData> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** 常客線索 → 這道招牌是哪位常客想吃的（上架到他的最愛店面時會特別高興） */
export const RECIPE_REGULAR: Record<string, string> = {};
for (const r of RECIPES) {
  const c = r.clues.find((x) => x.cond.t === "regular");
  if (c && c.cond.t === "regular") RECIPE_REGULAR[r.id] = c.cond.id;
}
