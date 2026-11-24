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
];

export const REGULAR_BY_ID = Object.fromEntries(REGULARS.map((r) => [r.id, r])) as Record<string, RegularDef>;
