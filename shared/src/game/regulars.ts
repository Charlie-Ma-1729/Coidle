import type { RegularDef } from "./types";

// 常客名冊。名字與人物全部虛構；語氣帶一點下町人情味。
// 沒有最愛（或第二選擇）業態的店，就遇不到他們——開的店種類越多，越有機會認識新朋友。

export const REGULAR_START_AFFINITY = 10;
export const GREET_COOLDOWN_TICKS = 72; // 6 遊戲小時
export const GIFT_COOLDOWN_TICKS = 288; // 1 遊戲日
export const GIFT_COST = 3_000;
export const RESERVE_FEE = 20_000;
export const RESERVE_MIN_AFFINITY = 40;
export const RESERVE_UPKEEP_PER_DAY = 2_000;
/** 親密度達到這個值就是「熟客粉絲」：每日替商場帶來一點口碑 */
export const FAN_AFFINITY = 60;
export const FAN_DAILY_IDX = 0.15;
export const MAX_FAN_IDX = 1;
/** 超過這麼多 tick 沒上門，親密度會慢慢下滑 */
export const REGULAR_DRIFT_AFTER_TICKS = 288 * 3;

export const REGULARS: RegularDef[] = [
  {
    id: "afu",
    name: "阿富叔",
    persona: "local",
    fav: "kushikatsu",
    alt: "takoyaki",
    budget: 1.2,
    hint: "街角那位退休的老先生，說他吃串炸吃了四十年。",
    bio: "在這一帶住了一輩子，每天傍晚準時出現，坐同一個位子。",
    traits: ["愛吃沾醬多一點", "討厭被催", "最在意價格公道"],
    stories: [
      { at: 30, title: "老位子", text: "阿富叔說他年輕時在附近的工廠上班，下工就來吃一串。「那時候一串才十圓啦。」", reward: { funds: 20_000, idx: 0.4 } },
      { at: 65, title: "四十年的味道", text: "他帶來一張泛黃的老照片，照片裡的老街還沒有這座商場。「你們把老味道留下來，我很高興。」", reward: { funds: 50_000, idx: 0.9 } },
    ],
  },
  {
    id: "sayuri",
    name: "小百合",
    persona: "local",
    fav: "kissaten",
    alt: "sweets",
    budget: 1.3,
    hint: "總是帶著一本舊書、一坐就是一下午的女士。",
    bio: "自由接案的插畫家，把喫茶店當成第二個工作室。",
    traits: ["要靠窗", "熱咖啡不加糖", "安靜的氣氛"],
    stories: [
      { at: 30, title: "筆記本上的店", text: "你發現她的速寫本裡，畫的全是這間店的角落。「這裡的光線剛剛好。」", reward: { funds: 15_000, idx: 0.5 } },
      { at: 65, title: "聯名插畫", text: "她主動提出替商場畫一組插畫，隔天就掛在牆上，客人都在拍照。", reward: { funds: 40_000, idx: 1.1 } },
    ],
  },
  {
    id: "tanaka",
    name: "田中先生",
    persona: "commuter",
    fav: "ramen",
    alt: "udon",
    budget: 1.25,
    hint: "領帶鬆鬆掛著、午休只有三十分鐘的上班族。",
    bio: "在附近的辦公大樓上班，午休固定十二點十分到。",
    traits: ["要快", "加蛋", "不愛排隊"],
    stories: [
      { at: 30, title: "三十分鐘的午休", text: "他笑說，這碗麵是一天裡最確定的幸福。「老闆，今天也一樣。」", reward: { funds: 20_000, idx: 0.4 } },
      { at: 65, title: "同事團", text: "他開始帶整個部門的人來，說「這家店值得被更多人知道」。", reward: { funds: 60_000, idx: 0.8 } },
    ],
  },
  {
    id: "misaki",
    name: "美咲",
    persona: "student",
    fav: "bubble_tea",
    alt: "sweets",
    budget: 1.15,
    hint: "放學後拿著手機、手搖飲杯子不離手的高中生。",
    bio: "社團結束之後，一定要來一杯再回家。",
    traits: ["半糖少冰", "會拍照上傳", "預算有限"],
    stories: [
      { at: 30, title: "限定口味", text: "她在社群上寫了一篇小小的推薦，同學們開始跟著來。", reward: { funds: 10_000, idx: 0.5 } },
      { at: 65, title: "畢業前的約定", text: "她說畢業前要把店裡每種口味都喝過一輪。「這是我的青春清單。」", reward: { funds: 30_000, idx: 0.9 } },
    ],
  },
  {
    id: "kenta",
    name: "小健一家",
    persona: "family",
    fav: "takoyaki",
    alt: "kushikatsu",
    budget: 1.2,
    hint: "週末固定出現、小朋友一路蹦蹦跳跳的一家人。",
    bio: "爸爸、媽媽和六歲的小健，每個週末的點心時間。",
    traits: ["小孩不能吃太燙", "愛看師傅翻章魚燒"],
    stories: [
      { at: 30, title: "第一次自己翻", text: "小健今天終於被允許隔著玻璃看師傅翻面，笑得眼睛都瞇起來了。", reward: { funds: 15_000, idx: 0.5 } },
      { at: 65, title: "全家福", text: "爸爸說，小健畫了一張「全家福」，上面有他們一家，還有你們的招牌。", reward: { funds: 40_000, idx: 1 } },
    ],
  },
  {
    id: "emma",
    name: "Emma",
    persona: "tourist",
    fav: "takoyaki",
    alt: "kushikatsu",
    budget: 1.5,
    hint: "拖著行李箱、拿著地圖東張西望的外國旅客。",
    bio: "背包客，每次來都說是「最後一次」，結果每年都回來。",
    traits: ["對在地小吃很好奇", "會用手機翻譯", "愛拍影片"],
    stories: [
      { at: 30, title: "第二次旅行", text: "她說她回國後一直想念這個味道，這次特地訂了離商場最近的旅館。", reward: { funds: 25_000, idx: 0.6 } },
      { at: 65, title: "影片爆紅", text: "她拍的店內短片在國外被大量分享，開始有旅客拿著手機來「朝聖」。", reward: { funds: 70_000, idx: 1.3 } },
    ],
  },
  {
    id: "chen",
    name: "陳先生",
    persona: "tourist",
    fav: "kushikatsu",
    alt: "ramen",
    budget: 1.6,
    hint: "每年都從海外來出差、總是點很多的客人。",
    bio: "貿易公司的主管，來這個城市出差時一定要吃一頓。",
    traits: ["出手大方", "喜歡聽老闆介紹", "常帶客戶"],
    stories: [
      { at: 30, title: "請客戶吃飯", text: "他把一位重要客戶帶來，說「這是我們這裡最有人情味的地方」。", reward: { funds: 40_000, idx: 0.6 } },
      { at: 65, title: "合作邀約", text: "他提議把你們的招牌推薦給他的商務旅行團。口碑從這裡傳了出去。", reward: { funds: 80_000, idx: 1.2 } },
    ],
  },
  {
    id: "michi",
    name: "ミチ阿姨",
    persona: "local",
    fav: "grocery",
    budget: 1.1,
    hint: "每天傍晚推著小推車來買菜的鄰居阿姨。",
    bio: "對價格非常敏銳，什麼時候特價比店員還清楚。",
    traits: ["超級會比價", "愛聊八卦", "喜歡新鮮"],
    stories: [
      { at: 30, title: "鄰居情報網", text: "她把你們的特價消息告訴了整條巷子的阿姨們。", reward: { funds: 15_000, idx: 0.6 } },
      { at: 65, title: "試吃團長", text: "她自告奮勇當「試吃團長」，每次新品都先幫忙挑剔、再大力推薦。", reward: { funds: 35_000, idx: 1 } },
    ],
  },
  {
    id: "daisuke",
    name: "大輔",
    persona: "commuter",
    fav: "curry",
    alt: "ramen",
    budget: 1.2,
    hint: "常常加班到很晚、只想吃一碗熱騰騰咖哩的人。",
    bio: "系統工程師，吃咖哩的時候是他一天最放鬆的時刻。",
    traits: ["辣度中辛", "加炸物", "加班後會多點一份"],
    stories: [
      { at: 30, title: "加班之夜", text: "他說有天加班到深夜，店裡的最後一碗咖哩救了他。「你們不知道那有多重要。」", reward: { funds: 20_000, idx: 0.5 } },
      { at: 65, title: "辣度研究", text: "他認真寫了一份「辣度改良建議書」，附上圖表。意外地很有用。", reward: { funds: 45_000, idx: 0.9 } },
    ],
  },
  {
    id: "obaa",
    name: "阿嬤",
    persona: "local",
    fav: "udon",
    alt: "kissaten",
    budget: 1.1,
    hint: "拄著拐杖、每週三固定來吃熱湯麵的老奶奶。",
    bio: "說這家的湯頭，讓她想起已經過世的老伴。",
    traits: ["湯要燙", "不喜歡太鹹", "喜歡有人陪她聊天"],
    stories: [
      { at: 30, title: "週三的約定", text: "她說每週三是她跟老伴的「約會日」，現在換成跟你們的約定。", reward: { funds: 10_000, idx: 0.7 } },
      { at: 65, title: "老伴的位子", text: "她請你們把靠牆的那個位子留著，說「他喜歡那裡」。全店的人都安靜了一下。", reward: { funds: 30_000, idx: 1.2 } },
    ],
  },
  {
    id: "lin",
    name: "Lin 與 Yuki",
    persona: "couple",
    fav: "sweets",
    alt: "kissaten",
    budget: 1.4,
    hint: "週末下午手牽手逛街、總會買甜點分著吃的一對。",
    bio: "交往三年，說第一次約會就是在這附近的甜點店。",
    traits: ["愛拍紀念照", "喜歡季節限定"],
    stories: [
      { at: 30, title: "三週年", text: "他們在店裡慶祝交往三週年，Yuki 偷偷拜託店員多放一顆草莓。", reward: { funds: 20_000, idx: 0.6 } },
      { at: 65, title: "求婚大作戰", text: "Lin 悄悄來找你們幫忙準備一個驚喜。結果……Yuki 哭著說「好」。", reward: { funds: 60_000, idx: 1.4 } },
    ],
  },
  {
    id: "haruto",
    name: "阿翔",
    persona: "student",
    fav: "fastfood",
    alt: "bubble_tea",
    budget: 1.1,
    hint: "球隊練習完、餓得像要把桌子吃掉的男孩。",
    bio: "足球隊的前鋒，球隊聚餐最愛來這一帶。",
    traits: ["食量驚人", "愛聊比賽", "預算有限"],
    stories: [
      { at: 30, title: "慶功宴", text: "球隊贏了比賽，整隊十幾個人把座位擠得滿滿的。「老闆，今天算我們慶功！」", reward: { funds: 25_000, idx: 0.5 } },
      { at: 65, title: "加油海報", text: "他們把球隊賽程海報貼在店門口，說「來看比賽的人都會順便來吃」。", reward: { funds: 50_000, idx: 0.9 } },
    ],
  },
  {
    id: "mika",
    name: "美香",
    persona: "couple",
    fav: "italian",
    alt: "brunch",
    budget: 1.6,
    hint: "週末午後總是優雅地一個人（或和朋友）享用餐點的女士。",
    bio: "美食部落客，會把餐廳的細節寫成長長的文章。",
    traits: ["注重擺盤", "愛拍照", "會留下評論"],
    stories: [
      { at: 30, title: "部落格文章", text: "她寫了一篇很長的食記，每個細節都被她看見。有人專程為了那篇文章來。", reward: { funds: 30_000, idx: 0.7 } },
      { at: 65, title: "年度推薦", text: "你們被她選進「今年最推薦的十家店」，書店還擺了她的專欄。", reward: { funds: 70_000, idx: 1.4 } },
    ],
  },
  {
    id: "sakura",
    name: "小櫻",
    persona: "student",
    fav: "cinema",
    alt: "arcade_vr",
    budget: 1.3,
    hint: "每週都會來看電影的影迷，包包裡總是裝著電影票根。",
    bio: "把每張電影票根都貼進筆記本，已經貼了三本。",
    traits: ["看首映", "愛討論劇情", "會給片單建議"],
    stories: [
      { at: 30, title: "票根收藏", text: "她把你們戲院的第一張票根貼在筆記本第一頁，旁邊寫著「這裡開始的」。", reward: { funds: 20_000, idx: 0.5 } },
      { at: 65, title: "影迷之夜", text: "她號召了一群影迷辦「通宵影展」，把整個影廳塞得水洩不通。", reward: { funds: 60_000, idx: 1.1 } },
    ],
  },
  {
    id: "coach",
    name: "教練",
    persona: "commuter",
    fav: "gym",
    alt: "spa",
    budget: 1.3,
    hint: "清晨準時出現、總是在喊「再一組！」的健身狂。",
    bio: "體育系畢業的教練，是這一帶最自律的人。",
    traits: ["清晨型", "愛補充蛋白質", "鼓勵新人"],
    stories: [
      { at: 30, title: "晨間班", text: "他開始揪鄰居一起做晨間運動，健身房的早晨第一次熱鬧起來。", reward: { funds: 25_000, idx: 0.6 } },
      { at: 65, title: "減重挑戰", text: "他在店裡辦了一場「三個月減重挑戰」，報名的人比預期的多三倍。", reward: { funds: 60_000, idx: 1.2 } },
    ],
  },

  {
    id: "ojisan_h",
    name: "橋本大叔",
    persona: "commuter",
    fav: "oden",
    alt: "onigiri",
    budget: 1.2,
    hint: "冬天總是縮著脖子、口袋裡塞著報紙的大叔。",
    bio: "在附近的批發市場做了一輩子，凌晨三點起床，這時間點只有熱湯才暖得了身子。",
    traits: ["要多一點蘿蔔", "只喝熱的", "討厭浪費"],
    stories: [
      { at: 30, title: "凌晨的蘿蔔", text: "他說市場的凌晨最冷，一碗關東煮是這輩子最便宜的幸福。", reward: { funds: 20_000, idx: 0.4 } },
      { at: 65, title: "介紹同行", text: "他把市場的夥伴一個個帶來，早班的店面突然熱鬧了起來。", reward: { funds: 55_000, idx: 0.9 } },
    ],
  },
  {
    id: "hana",
    name: "花婆婆",
    persona: "local",
    fav: "soba",
    alt: "taiyaki",
    budget: 1.15,
    hint: "拄著拐杖、總是在中午前就到的老太太。",
    bio: "年輕時在老街開過麵店，現在只當客人，卻比誰都挑剔。",
    traits: ["要看廚房", "愛聊以前", "吃得很慢"],
    stories: [
      { at: 30, title: "老店的湯", text: "她悄悄說起以前麵店的湯頭，每天凌晨四點就開始熬。「現在的年輕人不懂。」", reward: { funds: 20_000, idx: 0.4 } },
      { at: 65, title: "傳授技藝", text: "她願意教你們一點老麵店的訣竅，說：「不要讓老味道消失。」", reward: { funds: 50_000, idx: 1.0 } },
    ],
  },
  {
    id: "rina",
    name: "莉奈",
    persona: "student",
    fav: "claw",
    alt: "taiyaki",
    budget: 1.1,
    hint: "書包上掛滿吊飾、一手拿零食一手握搖桿的女高中生。",
    bio: "夾娃娃機的常勝軍，朋友們都說她手上有魔法。",
    traits: ["要限定款", "會分享戰利品", "遇到失敗會碎碎念"],
    stories: [
      { at: 30, title: "戰利品", text: "她把夾到的娃娃分給同學，說：「這是你們店贊助的啦！」", reward: { funds: 15_000, idx: 0.5 } },
      { at: 65, title: "夾機社團", text: "她在學校成立了「夾機研究會」，週末全員到你的店報到。", reward: { funds: 45_000, idx: 1.0 } },
    ],
  },
  {
    id: "takeshi",
    name: "武志",
    persona: "family",
    fav: "bowling",
    alt: "tonkatsu",
    budget: 1.25,
    hint: "週末固定帶著一家人來、打完球一定要吃頓好的的爸爸。",
    bio: "在公司擔任主管，唯一放鬆的方式就是跟家人打保齡球。",
    traits: ["愛報分數", "請客大方", "怕輸給兒子"],
    stories: [
      { at: 30, title: "家庭盃", text: "他興沖沖宣布要辦一場「家庭盃」，邀請了整個社區的家庭。", reward: { funds: 25_000, idx: 0.5 } },
      { at: 65, title: "公司聯誼", text: "他把公司的年度聯誼辦在這裡，一次帶來四十個人。", reward: { funds: 65_000, idx: 1.1 } },
    ],
  },
  {
    id: "ayako",
    name: "綾子",
    persona: "local",
    fav: "florist",
    alt: "bakery",
    budget: 1.3,
    hint: "每週五固定來買一束花、還會順手帶塊麵包的女士。",
    bio: "獨居的退休教師，說家裡有花，一個人也不孤單。",
    traits: ["愛挑顏色", "一定要手寫卡片", "會和花聊天"],
    stories: [
      { at: 30, title: "週五的花", text: "她說每週五買花，是為了給自己的週末一個儀式感。", reward: { funds: 20_000, idx: 0.5 } },
      { at: 65, title: "社區花圃", text: "她提議把商場旁邊的空地做成社區花圃，居民們都來幫忙。", reward: { funds: 50_000, idx: 1.2 } },
    ],
  },
  {
    id: "leo",
    name: "里歐",
    persona: "tourist",
    fav: "camera",
    alt: "vinyl",
    budget: 1.5,
    hint: "脖子上掛著老相機、操著一口生硬日語的外國旅人。",
    bio: "從海的另一端來的攝影師，每年都來拍老街，說這裡有他最愛的光影。",
    traits: ["愛拍老招牌", "會寄明信片", "什麼都想試試"],
    stories: [
      { at: 30, title: "老街的光影", text: "他給你看相機裡的照片，每一張都是黃昏的老街。「我想把這裡帶回去。」", reward: { funds: 30_000, idx: 0.6 } },
      { at: 65, title: "攝影展", text: "他在商場辦了一場小小的攝影展，主題是「這條街的二十四小時」。", reward: { funds: 70_000, idx: 1.3 } },
    ],
  },
  {
    id: "shun",
    name: "俊",
    persona: "student",
    fav: "anime_goods",
    alt: "gamestore",
    budget: 1.4,
    hint: "背著大背包、手裡抱著好幾袋周邊的宅宅大學生。",
    bio: "電器街長大的孩子，什麼冷門動漫都能聊上三個小時。",
    traits: ["要限定版", "會排隊", "講到喜歡的作品會停不下來"],
    stories: [
      { at: 30, title: "排隊的人", text: "他在新品開賣前一天就來排隊，還帶了折疊椅和泡麵。", reward: { funds: 20_000, idx: 0.5 } },
      { at: 65, title: "同人展", text: "他號召了一群同好，在商場辦了一場小小的同人展。", reward: { funds: 55_000, idx: 1.1 } },
    ],
  },
  {
    id: "ken",
    name: "賢",
    persona: "commuter",
    fav: "craft_beer",
    alt: "wine_bar",
    budget: 1.35,
    hint: "領帶塞在口袋、準時在七點整出現在吧台的上班族。",
    bio: "金融業的中階主管，白天看數字、晚上只想喝一杯有故事的酒。",
    traits: ["愛聊啤酒", "不吃辣", "會推薦同事"],
    stories: [
      { at: 30, title: "週五的第一杯", text: "他說每週五的第一杯是一個儀式，「這一杯下去，工作就結束了」。", reward: { funds: 25_000, idx: 0.5 } },
      { at: 65, title: "品酒會", text: "他邀請了十幾位同好辦了一場品酒會，每個人都喝得很盡興。", reward: { funds: 65_000, idx: 1.1 } },
    ],
  },
  {
    id: "noriko",
    name: "紀子",
    persona: "family",
    fav: "cram_school",
    alt: "toy_store",
    budget: 1.3,
    hint: "一手牽著一個、手裡還提著另一個孩子書包的媽媽。",
    bio: "三個孩子的媽媽，每天的行程比企業主管還滿。",
    traits: ["時間很緊", "愛比較", "最怕孩子不開心"],
    stories: [
      { at: 30, title: "孩子的笑臉", text: "她說只要看到孩子下課後開心地跑出來，一天的疲憊就消失了。", reward: { funds: 20_000, idx: 0.5 } },
      { at: 65, title: "家長會", text: "她在家長群組裡力推你們，隔週來了一整批新家庭。", reward: { funds: 55_000, idx: 1.0 } },
    ],
  },
  {
    id: "marco",
    name: "馬可",
    persona: "tourist",
    fav: "unagi",
    alt: "teppanyaki",
    budget: 1.6,
    hint: "拿著厚厚一本美食日誌、每道菜都要拍照的旅人。",
    bio: "來自南歐的廚師，專程飛來吃遍這座城市，並把心得寫成書。",
    traits: ["愛拍照", "會問食材來源", "給小費很大方"],
    stories: [
      { at: 30, title: "日誌上的名字", text: "他在日誌上寫下你的店名，旁邊畫了三顆星。", reward: { funds: 35_000, idx: 0.7 } },
      { at: 65, title: "美食書", text: "他的新書裡有一整章寫你的店，出版後國外的客人開始慕名而來。", reward: { funds: 80_000, idx: 1.5 } },
    ],
  },
  {
    id: "yuna",
    name: "由奈",
    persona: "couple",
    fav: "escape_room",
    alt: "live_house",
    budget: 1.25,
    hint: "總是和不同朋友一起出現、每次都帶著筆記本的女孩。",
    bio: "推理小說迷，說她的夢想是破解全世界所有的密室。",
    traits: ["愛寫筆記", "討厭劇透", "解完謎一定要喝杯茶"],
    stories: [
      { at: 30, title: "推理筆記", text: "她的筆記本裡密密麻麻寫滿了推理，說要寫成一本小說。", reward: { funds: 20_000, idx: 0.5 } },
      { at: 65, title: "推理之夜", text: "她號召了一群推理迷，一起挑戰了一場通宵解謎。", reward: { funds: 55_000, idx: 1.1 } },
    ],
  },
  {
    id: "sora",
    name: "空",
    persona: "commuter",
    fav: "yoga",
    alt: "juice_bar",
    budget: 1.3,
    hint: "清晨腋下夾著瑜伽墊、笑容總是很淡然的女士。",
    bio: "國際企業的資深顧問，說每天早上的四十分鐘，是她唯一屬於自己的時間。",
    traits: ["不愛說話", "只喝無糖", "愛推薦課程"],
    stories: [
      { at: 30, title: "屬於自己的時間", text: "她說在瑜伽墊上，所有的會議和電話都沒了。", reward: { funds: 25_000, idx: 0.5 } },
      { at: 65, title: "企業團課", text: "她把公司的瑜伽團課辦在你的店裡，整層樓的人都來了。", reward: { funds: 60_000, idx: 1.1 } },
    ],
  },
];

export const REGULAR_BY_ID = Object.fromEntries(REGULARS.map((r) => [r.id, r])) as Record<string, RegularDef>;

/**
 * 執行期加入新的常客（AI 內容池核准後）。
 * 伺服器啟動時載入；前端登入後向伺服器取得同一份，才能顯示他們的名字與故事。
 */
export function registerRegulars(defs: RegularDef[]): void {
  for (const d of defs) {
    const i = REGULARS.findIndex((r) => r.id === d.id);
    if (i >= 0) REGULARS[i] = d;
    else REGULARS.push(d);
    REGULAR_BY_ID[d.id] = d;
  }
}
