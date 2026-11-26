// 藝人名冊（roster.data.json）的規格：八個領域、每個領域的特質標籤表、型別、覆蓋要求。
// 生成腳本（server/src/ai/talentroster.ts）與測試（roster.test.ts）共用；純資料，不被遊戲執行期 import。
// 名冊只描述「這個人是誰」，沒有任何數值屬性（人氣、實力、價碼由引擎另外決定）。

export const TALENT_AREAS = ["singer", "voice", "idol", "comedian", "model", "band", "stage", "host"] as const;
export type TalentArea = (typeof TALENT_AREAS)[number];

export const AGE_BANDS = ["10s", "20s", "30s", "40s", "50s"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface TalentTag {
  id: string;
  label: string;
  /** 給生成模型看的說明（也是人工審核時對照用） */
  desc: string;
}

export interface TalentAreaSpec {
  id: TalentArea;
  label: string;
  desc: string;
  tags: TalentTag[];
  /** 這個領域 100 人的年代分布（權重，加總 100） */
  ages: Record<AgeBand, number>;
}

export const TALENT_AREA_SPECS: TalentAreaSpec[] = [
  {
    id: "singer",
    label: "歌手",
    desc: "個人歌手（獨唱），不屬於偶像團體或樂團",
    ages: { "10s": 8, "20s": 35, "30s": 30, "40s": 18, "50s": 9 },
    tags: [
      { id: "ballad", label: "抒情", desc: "擅長抒情慢歌，情感細膩" },
      { id: "powerhouse", label: "高音爆發", desc: "音域寬廣、爆發力強的唱功派" },
      { id: "husky", label: "煙嗓", desc: "帶沙啞質感的獨特嗓音" },
      { id: "songwriter", label: "創作型", desc: "自己寫詞曲的創作歌手" },
      { id: "enka", label: "演歌風味", desc: "帶演歌或昭和歌謠韻味的唱腔" },
      { id: "citypop", label: "城市流行", desc: "都會感的流行樂與律動" },
      { id: "folk", label: "民謠", desc: "吉他彈唱、貼近生活的民謠路線" },
      { id: "jazzy", label: "爵士氣質", desc: "帶爵士或靈魂樂風格的歌手" },
      { id: "anisong", label: "動畫歌曲", desc: "常演唱動畫、遊戲主題曲" },
      { id: "live", label: "現場派", desc: "舞台與現場演出魅力勝過錄音室" },
      { id: "viral", label: "網路爆紅", desc: "從影音平台或社群發跡" },
      { id: "veteran", label: "資深", desc: "出道多年、有固定支持者的老手" },
    ],
  },
  {
    id: "voice",
    label: "聲優",
    desc: "配音演員（動畫、遊戲、外語配音、廣播劇）",
    ages: { "10s": 3, "20s": 35, "30s": 35, "40s": 20, "50s": 7 },
    tags: [
      { id: "lead", label: "主角系", desc: "常演熱血或正統的主角" },
      { id: "villain", label: "反派系", desc: "擅長壓迫感強的反派與冷酷角色" },
      { id: "boyish", label: "少年聲", desc: "能演少年少女、聲線年輕" },
      { id: "mature", label: "成熟嗓", desc: "低沉穩重的大人角色" },
      { id: "comic", label: "搞笑角色", desc: "擅長喜劇、搞怪的角色" },
      { id: "narrator", label: "旁白", desc: "旁白、解說與紀錄片的聲音" },
      { id: "gamevo", label: "遊戲配音", desc: "遊戲角色與戰鬥語音的常客" },
      { id: "dubbing", label: "外語配音", desc: "外國影集與電影的配音" },
      { id: "multivoice", label: "多聲線", desc: "一人能演多個差異很大的角色" },
      { id: "singing", label: "兼歌手", desc: "聲優之外也發行歌曲、開演唱會" },
      { id: "radio", label: "廣播節目", desc: "有自己的網路或電台廣播節目" },
      { id: "stagevo", label: "舞台出身", desc: "從舞台劇轉戰配音" },
    ],
  },
  {
    id: "idol",
    label: "偶像",
    desc: "偶像藝人個人（可自成一家或隸屬團體），主打歌舞與粉絲互動",
    ages: { "10s": 35, "20s": 55, "30s": 9, "40s": 1, "50s": 0 },
    tags: [
      { id: "center", label: "中心位", desc: "站在舞台中央、領銜的存在感" },
      { id: "dancer", label: "舞蹈擔當", desc: "舞技出眾" },
      { id: "variety", label: "綜藝感", desc: "上節目反應快、有話題" },
      { id: "visual", label: "顏值擔當", desc: "以外型與氣質吸引目光" },
      { id: "vocal", label: "歌唱擔當", desc: "歌唱實力受肯定" },
      { id: "leader", label: "領袖氣質", desc: "帶領夥伴、可靠穩重" },
      { id: "moodmaker", label: "氣氛製造機", desc: "帶動現場與後台氣氛" },
      { id: "fanservice", label: "粉絲服務", desc: "握手會、直播互動很用心" },
      { id: "underground", label: "地下出身", desc: "從小型場地與地下偶像起步" },
      { id: "solo", label: "個人活動", desc: "團體之外也有個人作品與通告" },
      { id: "actor", label: "兼演員", desc: "也演出連續劇、電影或舞台劇" },
      { id: "latebloomer", label: "大器晚成", desc: "多年累積後才被看見" },
    ],
  },
  {
    id: "comedian",
    label: "搞笑藝人",
    desc: "搞笑藝人（漫才、短劇、落語、單人表演）",
    ages: { "10s": 0, "20s": 25, "30s": 35, "40s": 25, "50s": 15 },
    tags: [
      { id: "boke", label: "裝傻", desc: "漫才裡裝傻、製造笑點的一方" },
      { id: "tsukkomi", label: "吐槽", desc: "漫才裡吐槽、收拾場面的一方" },
      { id: "manzai", label: "漫才", desc: "以雙人漫才為主要舞台" },
      { id: "rakugo", label: "落語", desc: "坐著說故事的傳統話藝" },
      { id: "sketch", label: "短劇", desc: "擅長短劇、情境喜劇" },
      { id: "solo", label: "單人表演", desc: "單口、一人多角或道具表演" },
      { id: "dry", label: "冷面笑匠", desc: "面無表情講出笑點" },
      { id: "physical", label: "肢體喜劇", desc: "靠動作與表情取勝" },
      { id: "sharp", label: "毒舌", desc: "言詞銳利但點到為止" },
      { id: "reaction", label: "反應派", desc: "綜藝節目裡的反應與接話很快" },
      { id: "veteran", label: "資深", desc: "資歷深、有固定班底與口碑" },
      { id: "newcomer", label: "新生代", desc: "靠網路或比賽出頭的新人" },
    ],
  },
  {
    id: "model",
    label: "模特兒",
    desc: "模特兒（雜誌、伸展台、廣告、社群）",
    ages: { "10s": 12, "20s": 50, "30s": 25, "40s": 10, "50s": 3 },
    tags: [
      { id: "runway", label: "伸展台", desc: "走秀與時裝週的常客" },
      { id: "magazine", label: "雜誌", desc: "雜誌專屬模特兒、封面常客" },
      { id: "commercial", label: "廣告", desc: "廣告與代言的常見面孔" },
      { id: "street", label: "街拍風", desc: "街頭風格、穿搭有自己的味道" },
      { id: "mixed", label: "混血感", desc: "有混血或異國風的外型" },
      { id: "cool", label: "酷系", desc: "冷豔、俐落的氣質" },
      { id: "cute", label: "可愛系", desc: "甜美親切的形象" },
      { id: "elegant", label: "成熟優雅", desc: "沉穩、有品味的大人風範" },
      { id: "athletic", label: "運動體態", desc: "健身、運動品牌的代表臉孔" },
      { id: "sns", label: "社群人氣", desc: "社群平台追蹤者多、影響力大" },
      { id: "actress", label: "跨足演藝", desc: "也接演戲或主持通告" },
      { id: "buzz", label: "話題性", desc: "常成為媒體與網路話題" },
    ],
  },
  {
    id: "band",
    label: "樂團成員",
    desc: "樂團的個別成員（主唱、吉他手、貝斯手、鼓手、鍵盤手…），可被安排組成樂團",
    ages: { "10s": 12, "20s": 45, "30s": 28, "40s": 12, "50s": 3 },
    tags: [
      { id: "vocal", label: "主唱", desc: "樂團主唱，聲音是招牌" },
      { id: "guitar", label: "吉他手", desc: "電吉他或木吉他" },
      { id: "bass", label: "貝斯手", desc: "穩定的低音與律動" },
      { id: "drums", label: "鼓手", desc: "節奏的核心" },
      { id: "keys", label: "鍵盤手", desc: "鋼琴、合成器或風琴" },
      { id: "composer", label: "作曲型", desc: "樂團的詞曲主力" },
      { id: "technical", label: "技巧派", desc: "演奏技巧高超" },
      { id: "liveband", label: "現場派", desc: "現場演出火力全開" },
      { id: "visualkei", label: "視覺系", desc: "華麗妝髮與舞台造型" },
      { id: "indie", label: "獨立音樂", desc: "獨立廠牌、小型場地起家" },
      { id: "session", label: "樂手", desc: "也常接錄音室與支援演出" },
      { id: "screamer", label: "嘶吼", desc: "重型、龐克或硬核的嘶吼唱腔" },
    ],
  },
  {
    id: "stage",
    label: "舞台劇演員",
    desc: "舞台劇與音樂劇演員（含舞者）",
    ages: { "10s": 5, "20s": 30, "30s": 30, "40s": 22, "50s": 13 },
    tags: [
      { id: "musical", label: "音樂劇", desc: "歌唱與舞蹈兼備的音樂劇演員" },
      { id: "drama", label: "話劇", desc: "以台詞與表演功力為主的話劇" },
      { id: "classic", label: "古典劇", desc: "古典劇目與傳統戲劇" },
      { id: "dance", label: "舞蹈", desc: "舞者出身，肢體表現力強" },
      { id: "comedy", label: "喜劇", desc: "喜劇與輕鬆題材的舞台" },
      { id: "opera", label: "歌劇", desc: "受過聲樂訓練、嗓音渾厚" },
      { id: "action", label: "武打", desc: "擅長武打與動作場面" },
      { id: "improv", label: "即興", desc: "即興表演與現場應變" },
      { id: "leadrole", label: "主演", desc: "常擔任主演的台柱" },
      { id: "supporting", label: "綠葉", desc: "配角戲份出色，被劇迷點名" },
      { id: "directing", label: "兼導演", desc: "也導演或編劇" },
      { id: "screenstage", label: "跨界影視", desc: "舞台之外也演電視與電影" },
    ],
  },
  {
    id: "host",
    label: "主持人",
    desc: "主持人（綜藝、新聞、廣播、活動）",
    ages: { "10s": 0, "20s": 20, "30s": 35, "40s": 30, "50s": 15 },
    tags: [
      { id: "mc", label: "司儀", desc: "典禮與大型活動的司儀" },
      { id: "news", label: "新聞播報", desc: "新聞與資訊節目的播報" },
      { id: "varietyhost", label: "綜藝主持", desc: "綜藝節目的主持與串場" },
      { id: "radio", label: "廣播", desc: "電台與網路廣播的聲音" },
      { id: "quiz", label: "益智節目", desc: "益智與競賽節目的主持" },
      { id: "talk", label: "訪談", desc: "深度訪談與談話節目" },
      { id: "sports", label: "體育轉播", desc: "體育賽事轉播與評論" },
      { id: "morning", label: "晨間節目", desc: "晨間或午間的資訊節目" },
      { id: "event", label: "活動主持", desc: "展覽、發表會與商場活動" },
      { id: "calm", label: "沉穩", desc: "語速穩、讓人安心的風格" },
      { id: "witty", label: "機智", desc: "反應快、控場靈活" },
      { id: "warm", label: "親和", desc: "讓來賓與觀眾放鬆的親切風格" },
    ],
  },
];

export const TALENT_AREA_SPEC = Object.fromEntries(TALENT_AREA_SPECS.map((a) => [a.id, a])) as Record<TalentArea, TalentAreaSpec>;

export interface Talent {
  /** `<area>-<三位數序號>`，例如 `singer-007`；序號依生成順序，固定不變 */
  id: string;
  area: TalentArea;
  /** 虛構姓名（約七成日式姓名，其餘為韓式、華語、西洋或藝名） */
  name: string;
  /** 日式姓名才有：平假名讀音，姓與名之間一個半形空格 */
  kana?: string;
  /** 出身地（日本的都道府縣，或海外城市） */
  birthplace: string;
  ageBand: AgeBand;
  /** 一句話人設，≤ 40 字 */
  persona: string;
  /** 2–3 個特質，值必須是該領域標籤表裡的 id */
  traits: string[];
}

export const GROUP_AREAS = ["idol", "band"] as const;
export type GroupArea = (typeof GROUP_AREAS)[number];

export interface TalentGroup {
  /** `grp-<area>-<兩位數序號>` */
  id: string;
  area: GroupArea;
  name: string;
  /** 團體概念（≤ 40 字） */
  concept: string;
}

export interface RosterFile {
  talents: Talent[];
  groups: TalentGroup[];
}

/** 同一人不會同時帶有的特質組合（每組內最多選一個） */
export const TALENT_TRAIT_CONFLICTS: Partial<Record<TalentArea, string[][]>> = {
  singer: [["veteran", "viral"], ["husky", "powerhouse"]],
  voice: [["boyish", "mature"]],
  idol: [["latebloomer", "underground"]],
  comedian: [["boke", "tsukkomi"], ["manzai", "rakugo"], ["manzai", "solo"], ["dry", "physical"], ["veteran", "newcomer"]],
  model: [["cool", "cute"], ["cute", "elegant"], ["runway", "street"]],
  band: [["vocal", "guitar", "bass", "drums", "keys"]],
  stage: [["classic", "improv"], ["leadrole", "supporting"]],
  host: [["news", "varietyhost"], ["calm", "witty"]],
};

/** 樂團成員一定有且只有一個樂器／主唱角色標籤 */
export const BAND_ROLE_TAGS = ["vocal", "guitar", "bass", "drums", "keys"];

/** 覆蓋要求（測試鎖定） */
export const ROSTER_COVERAGE = {
  perArea: 100,
  groupsPerArea: 30,
  personaMax: 40,
  /** 日式姓名占比（含日式藝名）：全庫 0.62–0.78 */
  japaneseShare: [0.62, 0.78] as [number, number],
  /** 同一個姓（假名）最多幾人 */
  surnameCap: 3,
  /** 同一個名（假名）最多幾人（同一人的姓＋名讀音另外不可重複） */
  givenCap: 3,
};
