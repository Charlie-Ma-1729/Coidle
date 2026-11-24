import type { EffectSpec, EventCategory, EventDef, EventOption } from "./types";

// 各區域專屬的隨機事件：區域解鎖後才可能發生。語氣輕鬆，線索低調，不點名真實地名與品牌。

const D = 288;
const opt = (id: string, label: string, ...effects: EffectSpec[]): EventOption => ({ id, label, effects });

interface Ev {
  id: string;
  zone: string;
  cat: EventCategory;
  title: string;
  text: string;
  weight?: number;
  cd?: number;
  months?: number[];
  hours?: [number, number];
  effects?: EffectSpec[];
  choice?: { def: string; options: EventOption[]; deadline?: number };
}

const make = (e: Ev): EventDef => ({
  id: e.id,
  category: e.cat,
  title: e.title,
  text: e.text,
  weight: e.weight ?? 1.3,
  cooldownTicks: (e.cd ?? 8) * D,
  needsZone: e.zone,
  ...(e.months || e.hours ? { when: { ...(e.months ? { months: e.months } : {}), ...(e.hours ? { hours: e.hours } : {}) } } : {}),
  effects: e.effects ?? [],
  ...(e.choice ? { choice: { deadlineTicks: e.choice.deadline ?? D, defaultOption: e.choice.def, options: e.choice.options } } : {}),
});

const traffic = (persona: "all" | "tourist" | "local" | "commuter" | "family" | "student" | "couple", mult: number, ticks: number): EffectSpec => ({ t: "traffic", persona, mult, ticks });
const funds = (amount: number): EffectSpec => ({ t: "funds", amount });
const idx = (which: "localRep" | "touristHeat", amount: number): EffectSpec => ({ t: "index", which, amount });
const demand = (category: string, mult: number, ticks: number): EffectSpec => ({ t: "demand", category, mult, ticks });

const EVS: Ev[] = [
  // ───────── 1F 時尚與生活
  { id: "z_f1_collab", zone: "f1", cat: "market", title: "選物店聯名邀約", text: "一位年輕設計師帶著樣品來敲門，想和 1F 的選物店辦一場聯名快閃。話題性十足，不過要出一點佈置費。",
    choice: { def: "pass", options: [opt("join", "辦聯名快閃（花 4 萬）", funds(-40_000), traffic("student", 1.3, 144), traffic("couple", 1.3, 144), idx("touristHeat", 0.6)), opt("pass", "這次先不了", idx("localRep", 0.1))] } },
  { id: "z_f1_parking_full", zone: "f1", cat: "crowd", title: "停車場客滿", text: "連假的下午，停車場一位難求，入口排起長長的車龍，駕駛們開始按喇叭。",
    choice: { def: "guide", options: [opt("guide", "加派人手指揮動線（花 1.5 萬）", funds(-15_000), idx("localRep", 0.5)), opt("ignore", "讓大家自己想辦法", idx("localRep", -0.6), traffic("family", 0.85, 72))] } },
  { id: "z_f1_flu", zone: "f1", cat: "market", title: "流感季，藥妝店門庭若市", text: "天氣忽冷忽熱，身邊的人都在咳嗽。藥妝店的口罩與感冒藥賣得特別快。", months: [11, 12, 1, 2],
    effects: [demand("drugstore", 1.6, 144), traffic("local", 1.1, 144)] },
  { id: "z_f1_tax_free", zone: "f1", cat: "crowd", title: "免稅櫃台大排長龍", text: "國外旅客提著行李箱湧進 1F 的免稅櫃台，結帳隊伍繞過了電扶梯。",
    choice: { def: "open", options: [opt("open", "加開一個臨時櫃台（花 2 萬）", funds(-20_000), traffic("tourist", 1.35, 96), idx("touristHeat", 0.5)), opt("keep", "維持原樣，請旅客耐心等候", traffic("tourist", 0.9, 48))] } },
  { id: "z_f1_window", zone: "f1", cat: "luck", title: "櫥窗被網友分享", text: "一位路人拍下 1F 秋季櫥窗的照片，上傳後意外被轉發了好幾千次。", weight: 1,
    effects: [traffic("couple", 1.25, 96), traffic("student", 1.25, 96), idx("touristHeat", 0.8)] },
  { id: "z_f1_brunch_queue", zone: "f1", cat: "crowd", title: "早午餐店排隊爆紅", text: "週末的早午餐店外排了一條長長的隊伍，人們一邊等位一邊拍照。", weight: 1.1,
    effects: [demand("brunch", 1.7, 96), demand("italian", 1.2, 96)] },

  // ───────── 娛樂區
  { id: "z_ent_arcade_cup", zone: "ent", cat: "crowd", title: "街機高手挑戰賽", text: "電玩館貼出海報：「打破紀錄的人，今天的遊戲幣全免費！」一群高手聞風而來。", weight: 1.2,
    effects: [demand("arcade_vr", 1.8, 96), traffic("student", 1.25, 96)] },
  { id: "z_ent_birthday_party", zone: "ent", cat: "guest", title: "親子生日派對", text: "一位媽媽想在親子遊樂場辦孩子的生日派對，二十個小朋友，還要蛋糕和氣球。",
    choice: { def: "basic", options: [opt("full", "全套服務：佈置、蛋糕與主持（花 4 萬）", funds(-40_000), idx("localRep", 1.4), traffic("family", 1.3, 72)), opt("basic", "只提供場地（花 1 萬）", funds(-10_000), idx("localRep", 0.4)), opt("no", "婉拒，維持一般營業")] } },
  { id: "z_ent_karaoke_noise", zone: "ent", cat: "facility", title: "KTV 的歌聲傳到隔壁", text: "有客人抱怨 KTV 包廂的歌聲穿牆而來，隔壁電影院的觀眾被打擾。",
    choice: { def: "soundproof", options: [opt("soundproof", "請廠商補強隔音（花 3 萬）", funds(-30_000), idx("localRep", 0.3)), opt("lower", "請 KTV 調低音量（客人少了一點）", traffic("student", 0.9, 72)), opt("ignore", "不處理", idx("localRep", -0.8))] } },
  { id: "z_ent_vr_sick", zone: "ent", cat: "guest", title: "VR 玩到頭暈", text: "一位客人玩 VR 玩到暈眩，臉色蒼白地坐在地上，周圍的人有點緊張。", weight: 1,
    choice: { def: "care", options: [opt("care", "立刻扶到休息區，送水並道歉（花 5 千）", funds(-5_000), idx("localRep", 0.7)), opt("wait", "請他自己休息一下", idx("localRep", -0.5))] } },
  { id: "z_ent_claw", zone: "ent", cat: "luck", title: "夾娃娃機的奇蹟", text: "有人在夾娃娃機一口氣夾出十隻玩偶，影片在網路上瘋傳，大家都想來試試手氣。", weight: 1,
    effects: [demand("arcade_vr", 1.5, 120), traffic("student", 1.2, 120), traffic("couple", 1.2, 120)] },
  { id: "z_ent_movie_night", zone: "ent", cat: "festival", title: "經典老片重映週", text: "電影院排出老片重映，白髮的老先生與年輕情侶並肩排隊，場內笑聲與掌聲不斷。", months: [3, 4, 10, 11],
    effects: [demand("cinema", 1.5, 144), traffic("local", 1.15, 144), idx("localRep", 0.6)] },

  // ───────── 3C 與文創
  { id: "z_cul_launch", zone: "cul", cat: "crowd", title: "新機發售日", text: "新款手機今天開賣，天還沒亮 3C 旗艦店外就排滿了人，店員忙到沒時間吃早餐。",
    choice: { def: "queue", options: [opt("queue", "派人發號碼牌、準備熱飲（花 2 萬）", funds(-20_000), demand("electronics", 1.8, 96), idx("localRep", 0.5)), opt("none", "照常營業", demand("electronics", 1.4, 96), idx("localRep", -0.3))] } },
  { id: "z_cul_signing", zone: "cul", cat: "crowd", title: "作家簽書會", text: "一位小有名氣的作家要在書店辦簽書會，讀者提早兩小時就開始排隊。", weight: 1.2,
    effects: [demand("bookstore", 1.9, 96), demand("stationery", 1.3, 96), traffic("local", 1.1, 96)] },
  { id: "z_cul_popup_weekend", zone: "cul", cat: "festival", title: "週末快閃市集", text: "文創區的廣場擺滿手作攤位，陶器、皮件與插畫明信片，攤主們都笑咪咪。", weight: 1.2,
    effects: [demand("popup", 1.8, 144), traffic("couple", 1.2, 144), traffic("tourist", 1.2, 144)] },
  { id: "z_cul_cosplay", zone: "cul", cat: "crowd", title: "動漫迷同樂日", text: "周末來了一群打扮成動漫角色的年輕人，在 3C 與文創區拍照、逛街，氣氛歡樂。",
    choice: { def: "welcome", options: [opt("welcome", "設一個拍照區、歡迎他們（花 1.5 萬）", funds(-15_000), traffic("student", 1.35, 96), idx("touristHeat", 0.6)), opt("neutral", "不特別安排", traffic("student", 1.1, 96))] } },
  { id: "z_cul_pirated", zone: "cul", cat: "facility", title: "展示機被當成免費充電站", text: "3C 旗艦店的展示機被一群人拿來充電、看影片，店員哭笑不得。", weight: 0.9,
    choice: { def: "polite", options: [opt("polite", "貼心提供充電區（花 1 萬）", funds(-10_000), idx("localRep", 0.5)), opt("stop", "請他們離開", idx("localRep", -0.4))] } },

  // ───────── 生活服務
  { id: "z_life_gym_rush", zone: "life", cat: "crowd", title: "新年新計畫：健身房大爆滿", text: "新年新希望，大家都在這時決定要開始運動，健身房的跑步機要排隊。", months: [1, 2],
    effects: [demand("gym", 1.9, 144), traffic("commuter", 1.15, 144)] },
  { id: "z_life_spa_week", zone: "life", cat: "festival", title: "身心放鬆週", text: "SPA 與按摩店聯合推出放鬆週，上班族下班後排隊預約，說「再不放鬆要壞掉了」。", weight: 1.2,
    effects: [demand("spa", 1.7, 144), traffic("commuter", 1.1, 144)] },
  { id: "z_life_vaccine", zone: "life", cat: "market", title: "疫苗施打日", text: "診所今天舉辦疫苗施打，老人家與帶著孩子的爸媽陸續報到。", months: [10, 11],
    effects: [demand("clinic", 1.8, 144), traffic("family", 1.1, 144), traffic("local", 1.1, 144), idx("localRep", 0.5)] },
  { id: "z_life_bridal", zone: "life", cat: "luck", title: "婚禮前的預約潮", text: "美容美髮店接到好幾組新娘預約，造型師從早到晚沒停過手。", weight: 1,
    effects: [demand("salon", 1.8, 144), funds(30_000)] },
  { id: "z_life_daycare_day", zone: "life", cat: "guest", title: "托育中心親子開放日", text: "托育中心邀請家長來參觀，老師們準備了遊戲與小點心，有些孩子玩得捨不得回家。",
    choice: { def: "basic", options: [opt("big", "辦得盛大一點（花 3 萬）", funds(-30_000), demand("daycare", 1.6, 144), idx("localRep", 1.0)), opt("basic", "照常舉辦", demand("daycare", 1.2, 96), idx("localRep", 0.3))] } },
  { id: "z_life_laundry_breakdown", zone: "life", cat: "facility", title: "洗衣機排水管漏水", text: "共享洗衣店的排水管漏水，地板積了一灘水，客人小心翼翼地繞過。", weight: 1,
    choice: { def: "fix", options: [opt("fix", "立刻找人修（花 3 萬）", funds(-30_000)), opt("mop", "先拖乾，晚點再說", { t: "cleanliness", amount: -12 }, idx("localRep", -0.4))] } },

  // ───────── 高樓層餐飲與夜間街區
  { id: "z_dining_nightview", zone: "dining", cat: "crowd", title: "夜景餐廳一位難求", text: "晴朗的夜晚，高樓層的夜景特別迷人，情侶們紛紛預約窗邊的位子。", hours: [17, 23],
    effects: [demand("fine_dining", 1.7, 96), demand("bar", 1.4, 96), traffic("couple", 1.3, 96)] },
  { id: "z_dining_smoke", zone: "dining", cat: "facility", title: "燒肉店的煙飄進走廊", text: "燒肉店的排煙不夠力，香氣與白煙飄進了走道，有些客人皺起眉頭，有些客人卻餓了。", weight: 1,
    choice: { def: "fix", options: [opt("fix", "加裝排煙設備（花 5 萬）", funds(-50_000), { t: "equipment", amount: 5 }), opt("fan", "先放幾台大風扇", funds(-8_000), { t: "cleanliness", amount: -6 })] } },
  { id: "z_dining_year_party", zone: "dining", cat: "crowd", title: "公司忘年會旺季", text: "年底到了，居酒屋一桌接一桌的上班族，乾杯聲此起彼落。", months: [11, 12],
    effects: [demand("izakaya", 1.9, 144), traffic("commuter", 1.25, 144)] },
  { id: "z_dining_critic", zone: "dining", cat: "guest", title: "美食評論家悄悄來訪", text: "一位戴著帽子的客人安靜地吃完晚餐，掏出小本子寫了很久。據說他是個很有影響力的評論家。", weight: 0.9, cd: 12,
    choice: { def: "normal", options: [opt("special", "請主廚出來打招呼、加送甜點（花 2 萬）", funds(-20_000), idx("touristHeat", 1.2), idx("localRep", 0.6)), opt("normal", "一視同仁，照常服務", idx("touristHeat", 0.4))] } },
  { id: "z_dining_sommelier", zone: "dining", cat: "festival", title: "地酒與料理的夜晚", text: "酒吧與餐廳聯手辦了品酒會，各地的小酒廠送來新酒，客人邊喝邊聊。", weight: 1,
    effects: [demand("bar", 1.7, 120), demand("izakaya", 1.3, 120), traffic("couple", 1.15, 120)] },
  { id: "z_dining_hotpot_winter", zone: "dining", cat: "crowd", title: "寒流來了，火鍋最好", text: "氣溫驟降，大家都想吃一鍋熱呼呼的火鍋，店門口的候位表排到了晚上。", months: [12, 1, 2],
    effects: [demand("hotpot", 2, 144), demand("yakiniku", 1.3, 144)] },

  // ───────── 活動廣場與展望台
  { id: "z_plaza_concert", zone: "plaza", cat: "festival", title: "屋頂小型演唱會", text: "屋頂花園辦了一場小型演唱會，風很舒服，歌聲飄得很遠。要不要多開幾個攤位？",
    choice: { def: "stalls", options: [opt("stalls", "開放攤位、加派保全（花 3 萬）", funds(-30_000), traffic("all", 1.35, 96), idx("touristHeat", 1.0), idx("localRep", 0.8)), opt("plain", "只辦演唱會", traffic("all", 1.15, 96), idx("localRep", 0.4))] } },
  { id: "z_plaza_fireworks", zone: "plaza", cat: "festival", title: "夏日煙火大會", text: "遠處的河岸放起煙火，展望台成了最佳觀賞位，大家都舉起手機。", months: [7, 8],
    effects: [demand("observatory", 2, 96), traffic("couple", 1.4, 96), traffic("family", 1.3, 96), idx("touristHeat", 1.2)] },
  { id: "z_plaza_clear", zone: "plaza", cat: "luck", title: "難得的萬里晴空", text: "空氣透明，連遠方的山稜線都看得一清二楚，展望台人潮絡繹不絕。", weight: 1.1,
    effects: [demand("observatory", 1.7, 120), traffic("tourist", 1.2, 120)] },
  { id: "z_plaza_wedding", zone: "plaza", cat: "guest", title: "屋頂婚禮", text: "一對新人想在屋頂花園辦一場小型婚禮，賓客五十人，想知道能不能配合。",
    choice: { def: "host", options: [opt("host", "接下婚禮（花 5 萬準備，收入 20 萬）", funds(150_000), idx("localRep", 1.2), idx("touristHeat", 0.6)), opt("decline", "婉拒，維持開放")] } },
  { id: "z_plaza_wind", zone: "plaza", cat: "weather", title: "強風，屋頂暫停開放", text: "風突然轉強，屋頂花園的盆栽都在搖晃，保全建議暫時封閉。", weight: 1,
    choice: { def: "close", options: [opt("close", "暫時封閉（安全第一）", demand("observatory", 0.5, 72), idx("localRep", 0.2)), opt("open", "繼續開放，提醒客人小心", demand("observatory", 1.2, 72), idx("localRep", -1.0))] } },

  // ───────── 商務與旅宿
  { id: "z_biz_conference", zone: "biz", cat: "crowd", title: "大型研討會進駐", text: "會議中心來了一場三百人的產業研討會，休息時間走廊上全是端著咖啡聊天的人。", weight: 1.2,
    effects: [demand("conference", 1.8, 144), traffic("commuter", 1.25, 144), demand("coworking", 1.2, 144)] },
  { id: "z_biz_tour_group", zone: "biz", cat: "crowd", title: "旅行團集體住房", text: "三輛遊覽車載來一整個旅行團，旅館大廳瞬間擠滿行李箱。", weight: 1.2,
    choice: { def: "help", options: [opt("help", "加派行李員與櫃台人手（花 2 萬）", funds(-20_000), demand("hotel", 1.6, 144), idx("touristHeat", 0.8)), opt("normal", "照常作業", demand("hotel", 1.3, 144), idx("touristHeat", -0.3))] } },
  { id: "z_biz_startup_demo", zone: "biz", cat: "luck", title: "新創公司的發表會", text: "共享辦公室的新創團隊要辦產品發表會，邀了不少媒體，順便借用你們的空間。", weight: 1,
    effects: [demand("coworking", 1.5, 144), idx("touristHeat", 0.5), funds(20_000)] },
  { id: "z_biz_fire_drill", zone: "biz", cat: "facility", title: "旅宿消防演習", text: "消防單位要求旅館進行夜間疏散演習，住客們披著外套站在大廳，睡眼惺忪。", weight: 0.9,
    choice: { def: "coop", options: [opt("coop", "全力配合、送住客熱飲（花 1 萬）", funds(-10_000), { t: "equipment", amount: 3 }, idx("localRep", 0.4)), opt("minimal", "只做最低限度的演習", { t: "equipment", amount: 1 })] } },
];

export const ZONE_EVENTS: EventDef[] = EVS.map(make);
