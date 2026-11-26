// 內容驗證：AI 產出的文字進內容池之前，一律先過這一關。
// 原則：遊戲內不明寫真實地點與真實品牌（只留含蓄線索）；文字長度有上限；不含網址、聯絡方式、粗話。

/** 不能出現的真實地名（遊戲刻意只留含蓄線索） */
const REAL_PLACES = ["大阪", "大坂", "新今宮", "通天閣", "阿倍野", "天王寺", "日本橋", "新世界", "難波", "梅田", "道頓堀", "心齋橋", "關西機場", "關西空港", "Osaka", "Shin-Imamiya", "Tsutenkaku", "Namba", "Umeda", "Dotonbori", "Abeno", "Tennoji", "Nipponbashi", "西成", "釜崎", "愛隣"];
/**
 * 即使 `allowPlaces` 也不准出現的地名：遊戲的老街區原型與其周邊（避免把虛構的股市消息安在特定的街區上）。
 * 其餘真實地名（都道府縣、城市、區域）在股市內容可以當背景使用。
 */
const SENSITIVE_PLACES = ["新今宮", "通天閣", "西成", "釜崎", "愛隣", "Shin-Imamiya", "Tsutenkaku"];
/**
 * 股市內容額外擋的真實企業／金融機構／媒體／指數／商品名（`allowPlaces` 模式才套用）。
 * 中文詞用子字串比對（所以刻意不列「蘋果」「朝日」「大和」這類一般詞，而是列它們的完整品牌寫法）；
 * 英文詞用字邊界比對。公司名一律走 {name}／{peer} 佔位符，模型不該自己寫任何公司。
 */
const REAL_ENTITIES_ZH = [
  // 日本企業（漢字／中文譯名）
  "豐田", "豊田", "トヨタ", "本田技研", "本田汽車", "日產汽車", "日產自動車", "日産", "尼桑", "馬自達", "鈴木汽車", "速霸陸", "斯巴魯", "三菱", "三井", "住友", "伊藤忠", "丸紅", "軟銀", "軟體銀行", "東芝", "日立", "松下電器", "松下電工", "夏普", "富士通", "富士膠片", "富士軟片", "佳能", "尼康", "理光", "京瓷", "村田製作所", "日本電產", "發那科", "安川電機", "基恩斯", "東京威力科創", "東京電子", "瑞薩", "信越化學", "旭化成", "東麗", "新日鐵", "日本製鐵", "神戶製鋼", "川崎重工", "川崎汽船", "日本郵船", "商船三井", "石川島", "大和房屋", "大和證券", "大和運輸", "黑貓宅急便", "積水房屋", "積水化學", "大成建設", "鹿島建設", "清水建設", "大林組", "東急", "阪急", "近鐵", "南海電鐵", "京阪", "京急", "小田急", "西武", "東武", "京王", "相鐵", "山手線", "中央線", "京濱東北線", "東海道新幹線", "全日空", "日本航空", "日航", "樂桃", "捷星", "永旺", "伊藤洋華堂", "三越", "伊勢丹", "高島屋", "大丸", "松坂屋", "資生堂", "花王", "佳麗寶", "高絲", "味之素", "日清食品", "明治乳業", "明治控股", "森永", "龜甲萬", "麒麟啤酒", "麒麟控股", "朝日啤酒", "朝日新聞", "札幌啤酒", "三得利", "養樂多", "可口可樂", "百事可樂", "雀巢", "武田藥品", "第一三共", "大塚製藥", "安斯泰來", "中外製藥", "衛材", "塩野義", "鹽野義", "泰爾茂", "奧林巴斯", "野村證券", "野村控股", "樂天證券", "三菱UFJ", "瑞穗銀行", "瑞穗金融", "三井住友", "日本生命", "第一生命", "東京海上", "電通", "博報堂", "瑞可利", "迅銷", "良品計畫", "宜得利", "華歌爾", "山田電機", "友都八喜", "必酷", "大國藥妝", "日本電信電話", "電電公社", "多可摩", "雅虎", "世嘉", "萬代", "南夢宮", "卡普空", "光榮特庫摩", "史克威爾", "科樂美", "角川", "講談社", "集英社", "小學館", "吉卜力", "東映", "東寶", "手塚治虫", "寶可夢", "神奇寶貝", "超級瑪利歐", "瑪利歐", "勇者鬥惡龍", "最終幻想", "航海王", "鬼滅之刃", "哆啦A夢", "名偵探柯南", "鋼彈", "任天堂", "索尼", "日本郵政", "傑尼斯", "杰尼斯", "吉本興業", "寶塚", "紅白歌合戰", "紅白歌唱大賽", "日本武道館", "武道館", "東京巨蛋", "東京ドーム", "橫濱體育場", "富士搖滾", "夏日音速", "乃木坂", "櫻坂", "日向坂", "欅坂", "米津玄師", "宇多田", "濱崎步", "安室奈美惠", "木村拓哉", "福山雅治", "初音未來", "鏡音", "七龍珠", "火影忍者", "進擊的巨人", "咒術迴戰", "鏈鋸人", "我的英雄學院", "新世紀福音戰士", "灌籃高手", "夏目友人帳", "魔女宅急便", "龍貓", "神隱少女", "你的名字", "天氣之子", "哥吉拉", "假面騎士", "超人力霸王", "麵包超人", "蠟筆小新", "櫻桃小丸子", "海綿寶寶", "魔物獵人", "薩爾達", "動物森友會", "斯普拉遁", "王者榮耀", "原神", "艦隊收藏", "偶像大師", "Love Live", "LoveLive",  "日本郵便",
  // 外國企業與商品
  "蘋果公司", "蘋果手機", "蘋果電腦", "谷歌", "微軟", "亞馬遜", "臉書", "推特", "特斯拉", "輝達", "英特爾", "超微", "高通", "台積電", "三星電子", "三星集團", "海力士", "華為", "小米科技", "小米手機", "阿里巴巴", "騰訊", "字節跳動", "抖音", "微信", "波音", "空中巴士", "通用汽車", "福特汽車", "福斯汽車", "賓士", "寶馬", "沃爾瑪", "好市多", "耐吉", "阿迪達斯", "宜家", "迪士尼", "優步", "愛彼迎", "高盛", "摩根大通", "摩根士丹利", "花旗", "匯豐", "瑞銀", "貝萊德", "巴菲特", "馬斯克", "孫正義", "柳井正", "比爾蓋茲", "賈伯斯", "麥當勞", "肯德基", "星巴克", "優衣庫", "無印良品", "唐吉訶德", "松本清", "吉野家", "壽司郎", "餃子的王將",
  // 評等機構、媒體、指數、央行、國際組織（一律改用泛稱：評等機構、大盤、央行）
  "穆迪", "標準普爾", "標普", "惠譽", "彭博", "路透", "日經", "東證", "道瓊", "那斯達克", "納斯達克", "恆生指數", "上證", "滬深", "日銀", "日本銀行", "日本央行", "聯準會", "美聯儲", "歐洲央行", "歐佩克", "世界銀行", "國際貨幣基金",
];
const REAL_ENTITIES_ASCII = ["AKB", "EXILE", "YOASOBI", "Perfume", "BABYMETAL", "Fuji Rock", "Summer Sonic", "SMAP", "NHK", "PlayStation", "Toyota", "Honda", "Nissan", "Mazda", "Subaru", "Mitsubishi", "Mitsui", "Sumitomo", "Marubeni", "SoftBank", "Toshiba", "Hitachi", "Panasonic", "Sharp", "Fujitsu", "Canon", "Nikon", "Ricoh", "Kyocera", "Murata", "Fanuc", "Keyence", "Renesas", "Nippon Steel", "JFE", "Kawasaki", "IHI", "Daiwa", "Sekisui", "Kajima", "Obayashi", "Tokyu", "Hankyu", "Kintetsu", "Keihan", "Odakyu", "Seibu", "Tobu", "Keio", "JR", "ANA", "JAL", "Peach", "AEON", "Mitsukoshi", "Isetan", "Takashimaya", "Shiseido", "Kao", "Kose", "Ajinomoto", "Nissin", "Meiji", "Morinaga", "Kikkoman", "Kirin", "Asahi", "Sapporo", "Suntory", "Yakult", "Coca-Cola", "Pepsi", "Nestle", "Takeda", "Daiichi", "Otsuka", "Astellas", "Eisai", "Shionogi", "Terumo", "Olympus", "Nomura", "Rakuten", "UFJ", "Mizuho", "SMBC", "Dentsu", "Recruit", "Fast Retailing", "Nitori", "Wacoal", "Yamada", "NTT", "KDDI", "Docomo", "Yahoo", "Sega", "Bandai", "Namco", "Capcom", "Konami", "Square Enix", "Kadokawa", "Ghibli", "Pokemon", "Mario", "Zelda", "Nintendo", "Sony", "PlayStation", "Apple", "iPhone", "iPad", "Google", "Microsoft", "Windows", "Amazon", "Facebook", "Meta", "Twitter", "Tesla", "Nvidia", "Intel", "AMD", "Qualcomm", "TSMC", "Samsung", "Huawei", "Xiaomi", "Alibaba", "Tencent", "ByteDance", "TikTok", "WeChat", "OpenAI", "ChatGPT", "Boeing", "Airbus", "Ford", "Volkswagen", "BMW", "Mercedes", "Walmart", "Costco", "Nike", "Adidas", "Zara", "IKEA", "Disney", "Netflix", "Uber", "Airbnb", "YouTube", "Instagram", "Goldman", "JPMorgan", "Morgan Stanley", "Citi", "HSBC", "UBS", "BlackRock", "Moody", "S&P", "Fitch", "Bloomberg", "Reuters", "Nikkei", "TOPIX", "Dow Jones", "Nasdaq", "FRB", "ECB", "OPEC", "IMF", "McDonald", "KFC", "Starbucks", "Uniqlo", "MUJI", "Lawson", "FamilyMart", "7-Eleven", "Daiso", "Donki"];
const asciiRe = (w: string): RegExp => new RegExp(`(?:^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\\-&]/g, "\\$&").replace(/\s+/g, "\\s+")}(?:$|[^a-z0-9])`, "i");
const REAL_ENTITIES_ASCII_RE: [string, RegExp][] = REAL_ENTITIES_ASCII.map((w) => [w, asciiRe(w)]);
/** 真實品牌／公司（避免商標與誤導） */
const REAL_BRANDS = ["麥當勞", "肯德基", "星巴克", "7-11", "7-ELEVEN", "全家", "羅森", "Lawson", "優衣庫", "UNIQLO", "無印良品", "MUJI", "唐吉訶德", "驚安", "松本清", "大創", "DAISO", "Apple", "蘋果公司", "Google", "Amazon", "亞馬遜", "樂天", "Rakuten", "任天堂", "Nintendo", "Sony", "索尼", "阪神", "吉野家", "壽司郎", "一蘭", "餃子的王將", "Disney", "迪士尼", "環球影城", "Netflix", "LINE", "Uber", "Twitter", "Instagram", "Facebook", "YouTube", "TikTok"];
/** 不得出現的字眼：粗話、歧視性或貶抑街區居民的用語、政治與敏感議題 */
const BAD_WORDS = ["幹你", "靠北", "操你", "他媽的", "賤人", "婊", "智障", "白痴", "死全家", "貧民窟", "貧民", "流浪漢", "遊民", "乞丐", "無業", "治安差", "危險地帶", "骯髒", "垃圾區", "黑道", "毒品", "賣淫", "自殺", "殺人", "強姦", "恐怖攻擊", "習近平", "川普", "選舉", "政黨", "統獨"];

/** 簡體字（只列「繁體字寫法不同」的常見字；日文漢字與兩岸共用字不列，避免誤殺）。模型偶爾會混進一兩個 */
const SIMPLIFIED = "机构币篮这们时对说过还么发开见买卖热汤鱼饭鸡烧样种听吗为让门问间网电车长马鸟书东风头关气经现应总题无业乐华货费";
/** 這些詞本身是料理名稱，不是在指地點（遊戲裡的業態名稱本來就叫「章魚燒／大阪燒」） */
const FOOD_TERMS = ["大阪燒", "大坂燒"];

export interface TextRule {
  min?: number;
  max: number;
  /** 需要包含的子字串（例如評價必須有 {shop}） */
  must?: string[];
  /**
   * 放寬「禁用真實地名」（只給股市新聞庫用）：都道府縣、城市等真實地名可以出現，
   * 但老街區原型周邊的地名仍擋，並且額外擋真實企業／金融機構／媒體／指數／商品名。
   */
  allowPlaces?: boolean;
}

/** 回傳 null 代表通過；否則回傳拒收原因 */
export function checkText(text: unknown, rule: TextRule): string | null {
  if (typeof text !== "string") return "不是文字";
  const t = text.trim();
  if (t.length < (rule.min ?? 4)) return "太短";
  if (t.length > rule.max) return "太長";
  for (const m of rule.must ?? []) if (!t.includes(m)) return `缺少 ${m}`;
  if (/https?:\/\/|www\.|@\w+\.\w+|\b\d{2,4}-\d{3,4}-\d{3,4}\b/i.test(t)) return "含有網址或聯絡方式";
  for (const ch of t) if (SIMPLIFIED.includes(ch)) return `含簡體字「${ch}」`;
  let lower = t.toLowerCase();
  for (const w of FOOD_TERMS) lower = lower.replaceAll(w.toLowerCase(), "");
  for (const w of rule.allowPlaces ? SENSITIVE_PLACES : REAL_PLACES) if (lower.includes(w.toLowerCase())) return `含真實地名「${w}」`;
  if (rule.allowPlaces) {
    for (const w of REAL_ENTITIES_ZH) if (lower.includes(w.toLowerCase())) return `含真實企業或機構「${w}」`;
    for (const [w, re] of REAL_ENTITIES_ASCII_RE) if (re.test(t)) return `含真實企業或機構「${w}」`;
  }
  for (const w of REAL_BRANDS) if (lower.includes(w.toLowerCase())) return `含真實品牌「${w}」`;
  for (const w of BAD_WORDS) if (lower.includes(w.toLowerCase())) return `含不當字眼「${w}」`;
  if (/[Ѐ-ӿ؀-ۿ]/.test(t)) return "含非預期的文字";
  if (/[぀-ヿ]{8,}/.test(t)) return "日文假名過多"; // 允許少量日文風味，但整句日文不收
  return null;
}

/** 兩段文字的雙字組重疊程度（0–1，取較短那段為分母）：用來擋掉「換個說法的同一件事」。無關的句子通常 < 0.1，同題材的常在 0.27 以上 */
export function textSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const t = s.replace(/[\s，。、！？「」『』（）()：；,.!?"'{}]/g, "");
    const out = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const g of A) if (B.has(g)) n++;
  return n / Math.min(A.size, B.size);
}

/** 與既有內容太像的門檻 */
export const SIMILAR_LIMIT = 0.26;
