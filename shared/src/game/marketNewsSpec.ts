// 股市新聞庫（news.data.json）的規格：板塊、原型、情境、覆蓋要求。
// 生成腳本（server/src/ai/marketnews.ts）與庫的驗證測試（newsPool.test.ts）共用；純資料，不被引擎或客戶端 import。
import type { NewsKind } from "./market/news";

/** 板塊（與 stocks.ts 的 sector 同名；「金融」即金融（地方銀行）） */
export const NEWS_SECTORS: { id: string; desc: string }[] = [
  { id: "私鐵", desc: "民營鐵道業者：通勤與觀光客流、沿線房地產與百貨、票價與人事成本" },
  { id: "旅行", desc: "旅行社與旅遊平台：出國與國內旅遊、團體旅客、訂房與機票代銷" },
  { id: "航空", desc: "航空公司：客運與貨運、油價與匯率、機隊與航線、淡旺季" },
  { id: "飯店", desc: "飯店與住宿業：住房率、房價、外國旅客、度假村與商務旅館" },
  { id: "電力瓦斯", desc: "電力與瓦斯公用事業：用電量、燃料成本、電價調整、發電設備" },
  { id: "食品", desc: "加工食品業：原料價格、新品、通路、冷凍與調理食品" },
  { id: "飲料", desc: "飲料業：茶、咖啡、碳酸、酒類，氣溫與消費習慣、包材成本" },
  { id: "超市便利店", desc: "超市與便利商店連鎖：同店營收、客單價、新店、物流與人力" },
  { id: "娛樂", desc: "娛樂業：電影、演唱會、主題樂園、線下活動、版權與票房" },
  { id: "不動產", desc: "不動產開發與仲介：住宅與商辦、成屋與預售、利率、房價" },
  { id: "建設", desc: "建設與營造：公共工程、民間工程、資材與人力成本、接單" },
  { id: "製藥", desc: "製藥業：新藥開發、臨床試驗、藥價調整、專利到期、學名藥" },
  { id: "資訊科技", desc: "資訊科技與系統開發：企業系統導入、雲端、資安、人才、委外接案" },
  { id: "金融", desc: "地方銀行與信用卡：放款、存款、利差、呆帳、手續費與數位金融" },
  { id: "綜合商社", desc: "綜合貿易商社：能源與礦產、食品、機械貿易，海外投資與資源價格" },
  { id: "半導體", desc: "半導體設備與材料：晶圓廠投資、景氣循環、先進製程、出口管制" },
  { id: "機械機器人", desc: "工業機械與機器人：工廠自動化、訂單、製造業資本支出、海外需求" },
  { id: "汽車", desc: "汽車製造：新車銷售、電動車、車用晶片、供應鏈、海外工廠與關稅" },
  { id: "鋼鐵", desc: "鋼鐵業：鐵礦與煤價、鋼價、高爐與電爐、建築與汽車需求、環保成本" },
  { id: "化學", desc: "化學業：石化原料、特殊化學品、價格與供需、安全與環保規範" },
  { id: "造船海運", desc: "造船與海運：運價指數、新造船訂單、船隊、港口與航線、燃料" },
  { id: "物流宅配", desc: "物流與宅配：包裹量、人力與司機、電商需求、倉配與運費調整" },
  { id: "倉儲", desc: "倉儲與物流地產：倉庫出租率、冷鏈、租金、電商與製造業客戶" },
  { id: "電信", desc: "電信業：用戶數、資費方案、5G 與基地台、光纖、企業專網" },
  { id: "電商支付", desc: "電商與行動支付：交易量、手續費、回饋活動、詐欺防制、商家導入" },
  { id: "遊戲", desc: "遊戲開發與營運：手遊與主機、新作與改版、營收與用戶、海外上架" },
  { id: "動漫出版", desc: "動漫與出版：連載作品、改編動畫、周邊授權、電子書、版權收入" },
  { id: "廣告媒體", desc: "廣告與媒體：廣告預算、電視與網路媒體、活動行銷、景氣敏感度" },
  { id: "人力派遣", desc: "人力派遣與人力仲介：求才倍率、時薪、企業缺工、法規與外籍人力" },
  { id: "教育", desc: "教育服務：補習班、線上學習、學生人數、招生季、教材與語言課程" },
  { id: "外食連鎖", desc: "餐飲連鎖：同店營收、新店與退場、原料與人力成本、外帶外送" },
  { id: "百貨零售", desc: "百貨與零售：來客數、客單價、觀光客消費、折扣檔期、館內改裝" },
  { id: "藥妝", desc: "藥妝連鎖：化妝品、藥品、日用品、觀光客與免稅、展店與毛利" },
  { id: "醫療器材", desc: "醫療器材：內視鏡、檢測儀器、耗材、醫院採購、法規認證、海外銷售" },
  { id: "保險", desc: "保險業：保費收入、資產運用、利率與投資收益、理賠、新商品" },
  { id: "證券", desc: "證券業：成交量、手續費、投資銀行業務、自營部位、個人投資人開戶" },
  { id: "再生能源", desc: "再生能源：太陽能、風電、儲能、收購電價與補助、案場開發" },
  { id: "水務", desc: "水務與水處理：自來水、污水處理、老舊管線更新、水價、公私協力" },
  { id: "REIT", desc: "不動產投資信託（商業設施、辦公室、物流）：租金、出租率、配息、資產收購與利率" },
];

export const NEWS_KINDS: NewsKind[] = ["company", "sector", "macro", "analyst", "rumor", "wrap", "preopen"];

/** 公司個股消息原型（每個都有利多與利空兩面；earnings 的會綁決算期） */
export const COMPANY_ARCHETYPES: { id: string; label: string; pos: string; neg: string; earnings?: boolean }[] = [
  { id: "earnings", label: "決算（財報）", earnings: true, pos: "本期決算優於市場預期（營收、獲利、利潤率任一亮眼）", neg: "本期決算不如市場預期（營收、獲利或利潤率令人失望）" },
  { id: "guidance", label: "業績預測修正", earnings: true, pos: "公司上修本年度的業績預測", neg: "公司下修本年度的業績預測" },
  { id: "dividend", label: "配息", earnings: true, pos: "公司宣布增配股利或提高配息政策", neg: "公司宣布減配或暫停配息" },
  { id: "product", label: "新產品與服務", pos: "新產品或新服務上市反應熱烈、預購或下載超出預期", neg: "新產品延後上市、反應冷淡或遭到批評" },
  { id: "contract", label: "合約與訂單", pos: "取得大型合約或長期訂單", neg: "重要客戶解約、標案落選或訂單被縮減" },
  { id: "plant", label: "設備與工廠", pos: "新廠或新產線順利投產、產能擴大", neg: "工廠或設備發生事故、停工檢修（不涉及人員傷亡的描述）" },
  { id: "quality", label: "品質與召回", pos: "取得品質認證、安全獎項或第三方肯定", neg: "產品發現瑕疵、自主召回或停售檢查" },
  { id: "exec", label: "人事與經營層", pos: "新任經營者提出改革方針、受市場看好；或延攬重要人才", neg: "經營者突然離任、高層異動或經營層意見不合（不要寫任何人名，只用職稱）" },
  { id: "rating", label: "評等調整", pos: "評等機構調升公司的信用或投資評等", neg: "評等機構調降公司的信用或投資評等，或把展望改為負向" },
  { id: "holder", label: "大股東異動", pos: "大股東或法人大幅增持、提高持股比例", neg: "大股東或法人減持、賣出持股或解除持股同盟" },
  { id: "expansion", label: "展店與擴張", pos: "加速展店、新據點開幕或進軍海外市場", neg: "撤出市場、關閉據點或縮編事業" },
  { id: "cost", label: "成本與原料", pos: "原料與能源成本下降、採購改善或節流見效，利潤率改善", neg: "原料、能源或人力成本上升，侵蝕利潤" },
  { id: "capital", label: "資本政策", pos: "宣布買回庫藏股或自家股票註銷", neg: "宣布增資發行新股或可轉債，既有股東權益被稀釋" },
  { id: "partnership", label: "合作與結盟", pos: "與其他企業或機構宣布策略結盟、共同開發或通路合作", neg: "合作破局、結盟終止或合資案喊停" },
  { id: "legal", label: "訴訟與處分", pos: "官司勝訴、取得有利判決，或主管機關調查後不予處分", neg: "遭起訴、被主管機關處分或罰款、須支付和解金" },
  { id: "supply", label: "供應鏈", pos: "取得新的穩定供應來源或庫存調整完成、交期改善", neg: "供應商中斷、零件短缺或物流受阻，出貨延遲" },
  { id: "tech", label: "技術與系統", pos: "技術突破、取得關鍵專利或系統升級完成", neg: "系統故障、資安事件或服務中斷，須向客戶說明" },
  { id: "brand", label: "品牌與口碑", pos: "品牌聲量上升、取得消費者滿意度獎項或網路好評如潮", neg: "出現負面口碑、客訴增加或社群爭議" },
  { id: "labor", label: "勞資與人力", pos: "勞資協商順利、調薪留才或徵才順利", neg: "發生罷工、離職潮或人手不足，影響營運" },
  { id: "esg", label: "環保與永續", pos: "減碳成果受肯定、取得環保認證或發行綠色債券", neg: "環保或安全查核不合格、被要求改善" },
  { id: "debt", label: "債務與財務體質", pos: "提前償還借款、降低負債比，財務體質改善", neg: "負債偏高、借款到期壓力或利息負擔加重" },
  { id: "orders", label: "訂單與需求", pos: "接單暢旺、待交貨訂單累積、需求回溫", neg: "訂單減少、需求疲弱或庫存增加" },
  { id: "pricing", label: "價格策略", pos: "調漲價格被市場接受、毛利改善", neg: "同業降價競爭、被迫降價促銷、毛利壓縮" },
  { id: "mna", label: "併購與事業重組", pos: "宣布收購或合併有綜效的事業，或出售不賺錢的部門", neg: "併購效益不如預期、認列商譽減損，或重組計畫遇到阻力" },
];

/** 分析師評論（kind analyst）。neutral 版本是「維持中立」類。 */
export const ANALYST_ARCHETYPES: { id: string; label: string; sentiment: "pos" | "neg" | "neutral"; hint: string }[] = [
  { id: "target_raise", label: "調升目標價", sentiment: "pos", hint: "券商分析師調升目標價，說明受益於什麼" },
  { id: "initiate_buy", label: "首次覆蓋買進", sentiment: "pos", hint: "研究機構首次覆蓋並給予買進（優於大盤）評等" },
  { id: "bull_thesis", label: "長期看好", sentiment: "pos", hint: "分析師撰文看好中長期成長動能與競爭優勢" },
  { id: "target_cut", label: "調降目標價", sentiment: "neg", hint: "券商分析師調降目標價，說明風險在哪" },
  { id: "downgrade_view", label: "降評", sentiment: "neg", hint: "分析師把評等由買進降為中立或賣出" },
  { id: "bear_thesis", label: "短期保守", sentiment: "neg", hint: "分析師提醒短期評價過高、成長趨緩或成本壓力" },
  { id: "hold_view", label: "維持中立", sentiment: "neutral", hint: "分析師維持中立評等，認為利多利空大致已反映，等待下一個催化劑" },
];

/** 全市場（macro）主題 */
export const MACRO_TOPICS: { id: string; label: string; pos: string; neg: string }[] = [
  { id: "central_bank", label: "央行與利率", pos: "央行維持寬鬆、暗示利率路徑對市場友善", neg: "央行偏鷹派、升息預期升溫或縮減資產" },
  { id: "fx", label: "匯率", pos: "日圓匯率走勢穩定、對出口與進口業者都有利", neg: "日圓匯率劇烈波動、進口成本上升或出口獲利被侵蝕" },
  { id: "economy", label: "景氣與經濟數據", pos: "景氣指標、就業或製造業景氣調查優於預期", neg: "景氣指標、就業或製造業景氣調查不如預期" },
  { id: "oil", label: "油價與能源", pos: "原油與能源價格回落，企業成本壓力減輕", neg: "原油與能源價格走高，企業成本與民生物價受壓" },
  { id: "disaster", label: "天災與突發事件", pos: "災後復原進度超前、重建需求浮現、供應鏈恢復", neg: "地震、豪雨或其他天災造成交通與供應鏈短暫中斷（不描述傷亡）" },
  { id: "trade", label: "貿易與海外市場", pos: "貿易談判有進展、海外需求回升、出口數據亮眼", neg: "貿易摩擦、關稅疑慮或海外需求放緩" },
  { id: "consumption", label: "消費與物價", pos: "消費者信心回升、家庭支出與薪資成長", neg: "物價上漲壓抑消費、實質薪資下滑、消費者信心轉弱" },
  { id: "global", label: "海外股市與資金流向", pos: "海外主要市場收高、外資資金回流新興與亞洲市場", neg: "海外主要市場重挫、資金避險、全球風險情緒升溫" },
];

/** 傳聞的主題；每個主題各有利多與利空兩個方向，每組是「傳聞／證實／否認」三則 */
export const RUMOR_TOPICS: { id: string; label: string; pos: string; neg: string }[] = [
  { id: "mna", label: "併購", pos: "傳公司將被大企業收購或將收購有潛力的對象", neg: "傳公司擬以高價收購、財務負擔恐大增" },
  { id: "contract", label: "大單", pos: "傳公司即將取得大型合約或國家級標案", neg: "傳重要客戶準備轉單給其他業者" },
  { id: "guidance", label: "財測", pos: "傳公司本期獲利優於預期、將上修預測", neg: "傳公司本期獲利大幅衰退、將下修預測" },
  { id: "product", label: "新事業與新品", pos: "傳公司將發表重大新產品或新事業", neg: "傳新產品研發遇到瓶頸、發表恐延期" },
  { id: "regulator", label: "主管機關", pos: "傳先前的調查將不處分或獲得有利裁定", neg: "傳公司正被主管機關調查或將受處分" },
  { id: "holder", label: "大股東動向", pos: "傳大戶或法人持續低調吸納股票", neg: "傳大股東準備出脫持股" },
  { id: "exec", label: "經營層", pos: "傳公司將延攬備受矚目的新經營者", neg: "傳經營者將離任、經營層內部不合" },
  { id: "financing", label: "資金籌措", pos: "傳公司資金充裕、將擴大股利與買回庫藏股", neg: "傳公司將增資或發行可轉債籌資" },
  { id: "partnership", label: "策略結盟", pos: "傳公司將與大型企業策略結盟", neg: "傳既有的合作夥伴準備退出" },
  { id: "plant", label: "工廠與產能", pos: "傳公司將興建新廠、大幅擴產", neg: "傳工廠出狀況、可能停工或減產" },
  { id: "quality", label: "品質與產品", pos: "傳產品通過重要認證、可望打進新市場", neg: "傳產品出現品質疑慮、可能被要求召回" },
  { id: "restructure", label: "重組", pos: "傳公司將出售虧損部門、聚焦本業", neg: "傳公司將大規模裁撤據點或縮編事業" },
];

/** 條件情境（板塊與全市場消息都會依這些情境各有專屬文案） */
export interface NewsContext {
  id: string;
  group: "season" | "calendar" | "weather";
  label: string;
  desc: string;
  when: { seasons?: string[]; calendar?: string[]; weather?: string[] };
}
export const NEWS_CONTEXTS: NewsContext[] = [
  { id: "spring", group: "season", label: "春季", desc: "春天（3–5 月）：賞花、新學期與新年度、搬家季、氣候回暖", when: { seasons: ["spring"] } },
  { id: "summer", group: "season", label: "夏季", desc: "夏天（7–8 月）：酷熱、暑假、祭典與煙火、冷氣與冷飲旺季", when: { seasons: ["summer"] } },
  { id: "autumn", group: "season", label: "秋季", desc: "秋天（9–11 月）：氣候涼爽、紅葉、運動與祭典、換季新品", when: { seasons: ["autumn"] } },
  { id: "winter", group: "season", label: "冬季", desc: "冬天（12–2 月）：寒冷乾燥、暖氣與熱食、流感季、年底年初", when: { seasons: ["winter"] } },
  { id: "rainy", group: "season", label: "梅雨季", desc: "梅雨季（6–7 月）：連日陰雨、濕度高、出門意願下降", when: { seasons: ["rainy"] } },
  { id: "typhoon", group: "season", label: "颱風季", desc: "颱風季（8–10 月）：颱風與豪雨頻繁、航班與交通受影響、防災備貨", when: { seasons: ["typhoon"] } },
  { id: "long_weekend", group: "calendar", label: "連休", desc: "連休（三天以上的假期）：近郊旅遊與外出消費增加、都心通勤人潮減少", when: { calendar: ["long_weekend"] } },
  { id: "golden_week", group: "calendar", label: "黃金週", desc: "黃金週（四月底至五月初的大型連假）：全年最長的假期之一、國內外旅遊與娛樂旺季", when: { calendar: ["golden_week"] } },
  { id: "obon", group: "calendar", label: "盂蘭盆節", desc: "盂蘭盆節假期（八月中旬）：返鄉與掃墓、交通尖峰、探親與送禮", when: { calendar: ["obon"] } },
  { id: "year_end", group: "calendar", label: "年末年始", desc: "年末年始（年底到新年假期）：大掃除與年菜、回鄉、初詣、福袋與新年特賣", when: { calendar: ["year_end", "new_year"] } },
  { id: "payday", group: "calendar", label: "發薪日", desc: "發薪日（每月 25 日前後）：上班族口袋較鬆、聚餐與購物增加", when: { calendar: ["payday"] } },
  { id: "rain", group: "weather", label: "下雨天", desc: "下雨天：外出減少、室內活動與網購增加、交通與施工受影響", when: { weather: ["rain"] } },
  { id: "hot", group: "weather", label: "酷暑", desc: "酷暑（氣溫 32 度以上）：高溫、用電與冷氣需求上升、冷飲與防曬熱賣、外出減少", when: { weather: ["hot"] } },
  { id: "cold", group: "weather", label: "嚴寒", desc: "嚴寒（氣溫 4 度以下的寒流）：暖氣與熱食需求、路面結冰、設備與交通受影響", when: { weather: ["cold"] } },
  { id: "storm", group: "weather", label: "颱風來襲", desc: "颱風來襲、暴風雨：航班與列車停駛、店家提早關門、防災與災後復原", when: { weather: ["storm"] } },
];

/** weather.ts 的天氣種類（clear/cloudy/rain/storm）＋引擎認得的兩個溫度條件別名 */
export const NEWS_WEATHER_IDS = ["clear", "cloudy", "rain", "storm", "hot", "cold"];

/** 覆蓋要求（庫整體；測試與 docs 共用） */
export const COVERAGE = {
  companyPerArchetypeSentiment: 8,
  sectorPerContextSentiment: 1,
  macroMin: 100,
  analystMin: 60,
  wrapMin: 60,
  rumorTriplesMin: 40,
} as const;

// ───────── 娛樂題材（company 類的另一組原型；只對這三個板塊出現） ─────────
export const ENT_SECTORS = ["娛樂", "動漫出版", "遊戲"] as const;
export const ENT_ARCHETYPES: { id: string; label: string; pos: string; neg: string }[] = [
  { id: "ent_concert", label: "演唱會與巡演", pos: "旗下藝人的演唱會或巡演門票秒殺、加開場次或啟動海外巡演", neg: "演唱會或巡演因故延期、取消，或售票進度遠低於預期（不寫傷亡）" },
  { id: "ent_release", label: "新作與新曲發表", pos: "新作品或新單曲發表後獲得好評與熱烈討論", neg: "新作品延期發表，或發表後評價兩極、遭到批評" },
  { id: "ent_cast", label: "新番與配音陣容", pos: "新番動畫或熱門作品續篇的製作與配音陣容公布，受到市場期待", neg: "配音或演出人選更換引發爭議，或續篇計畫被取消、擱置" },
  { id: "ent_graduation", label: "成員畢業與退團", pos: "成員畢業後轉型順利、新成員加入反應良好，或畢業演唱會創下熱賣", neg: "核心成員宣布畢業或退團，粉絲失落、人氣與周邊銷售受到影響" },
  { id: "ent_contract", label: "合約與轉會", pos: "與人氣藝人或製作人續約成功、簽下新的重量級人才或創作團隊", neg: "重要藝人合約到期未續、轉往他社，或發生解約糾紛" },
  { id: "ent_scandal", label: "緋聞與炎上", pos: "旗下藝人的負面傳聞獲得澄清、炎上風波平息，或危機處理獲得好評", neg: "旗下藝人傳出緋聞或言論炎上，贊助商與廣告商重新檢討合作" },
  { id: "ent_festival", label: "音樂祭與大型活動", pos: "旗下藝人受邀參加大型音樂祭或祭典活動，或自辦活動吸引大量觀眾", neg: "音樂祭或活動未能受邀、被迫縮小規模，或因天候、場地問題中止" },
  { id: "ent_hit", label: "暢銷與排行", pos: "作品或單曲衝上排行榜前段、銷量與串流播放創下紀錄", neg: "原本暢銷的作品快速跌出排行榜，或熱度消退、銷量與播放量大幅下滑" },
  { id: "ent_flop", label: "票房與銷量表現", pos: "票房或銷量起步不如預期，但口碑發酵、後勢逆勢翻紅", neg: "票房或銷量明顯不如預期，公司下修相關收益預估" },
];
/** 娛樂題材的情境專屬文案（`when` 的季節、日曆與月份條件） */
export const ENT_CONTEXTS: { arch: string; ctx: string; desc: string; when: { seasons?: string[]; calendar?: string[]; months?: number[] } }[] = [
  { arch: "ent_festival", ctx: "summer", desc: "夏季祭典與夏日音樂祭季（盛夏的戶外活動、煙火大會）", when: { seasons: ["summer"] } },
  { arch: "ent_festival", ctx: "year_end", desc: "年末年始的跨年演唱會與新年活動", when: { calendar: ["year_end", "new_year"] } },
  { arch: "ent_concert", ctx: "christmas", desc: "聖誕節檔期的演唱會與聖誕主題活動", when: { calendar: ["christmas"] } },
  { arch: "ent_cast", ctx: "new_season", desc: "新番期（春番、夏番、秋番、冬番開播前後）", when: { months: [1, 4, 7, 10] } },
  { arch: "ent_release", ctx: "new_season", desc: "新番期（春番、夏番、秋番、冬番開播前後）的新作發表", when: { months: [1, 4, 7, 10] } },
];
