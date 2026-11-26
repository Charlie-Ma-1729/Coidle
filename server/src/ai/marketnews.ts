// 股市新聞內容庫生成器：一次性離線批次，用 OpenRouter 的 anthropic/claude-haiku-5.5 生成、驗證、去重，
// 之後由人（Claude）逐則審核，最後組成 shared/src/game/market/news.data.json。不在遊戲執行期呼叫。
//
// 用法（在 Windows 鏡像資料夾內執行，金鑰只由 --env-file 載入、絕不印出）：
//   npx tsx --env-file=<專案>\.env --tsconfig tsconfig.json server/src/ai/marketnews.ts <指令> [選項]
//
// 指令：
//   check                      查金鑰的額度（只印用量與上限數字）
//   gen    [--max-usd 2] [--rounds 3] [--conc 4] [--only <key 正規式>] [--max-calls N] [--dry]
//                              依「缺口」規劃批次並呼叫模型；可續跑（缺多少補多少）；累計花費達 --max-usd 就停
//   stats                      各類別數量、自動拒收原因、人工剔除原因、花費
//   dump   [--count 120]       列出下一批待審的內容（編號 1..N），並記下這一批是第幾批
//   apply  <批號> [--file f | --rej "3:原因,7:原因"]
//                              把這一批標為已審；列出的編號剔除（三連組的任何一則被剔除，整組都剔除）
//   build  [--out path] [--allow-unreviewed]
//                              把「已審且沒被剔除」的內容組成最終 JSON（穩定 id、依 id 排序）並檢查覆蓋矩陣
//
// 全域選項：--dir <工作資料夾>（預設 %TEMP%/coidle-marketnews；每批原始輸出、結果、狀態都放這裡，不放專案裡）
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chat, extractJson, LlmError } from "./openrouter";
import { checkText, textSimilarity } from "./validate";
import { ANALYST_ARCHETYPES, COMPANY_ARCHETYPES, ENT_ARCHETYPES, ENT_CONTEXTS, ENT_SECTORS, COVERAGE, MACRO_TOPICS, NEWS_CONTEXTS, NEWS_SECTORS, RUMOR_TOPICS, type NewsContext } from "../../../shared/src/game/marketNewsSpec";
import type { NewsKind, NewsPoolItem, NewsSentiment, NewsWhen } from "../../../shared/src/game/market/news";

const MODEL = "anthropic/claude-haiku-5.5";

// ───────── 參數 ─────────
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const flag = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
  return def;
};
const has = (name: string): boolean => argv.includes(`--${name}`);
const DIR = path.resolve(flag("dir") ?? path.join(os.tmpdir(), "coidle-marketnews"));
for (const sub of ["", "raw", "dumps"]) fs.mkdirSync(path.join(DIR, sub), { recursive: true });
const F = {
  pool: path.join(DIR, "pool.jsonl"),
  auto: path.join(DIR, "autoreject.jsonl"),
  state: path.join(DIR, "state.json"),
  reviewed: path.join(DIR, "reviewed.json"),
  rejects: path.join(DIR, "rejects.json"),
};

// ───────── 型別與檔案 ─────────
type Sent = Exclude<NewsSentiment, "neutral"> | "neutral";
interface Cand {
  uid: string;
  key: string;
  group: string;
  kind: NewsKind;
  archetype: string;
  sentiment: Sent;
  mag: 1 | 2 | 3;
  headline: string;
  body: string;
  when?: NewsWhen;
  ctx?: string;
  role?: "rumor" | "confirm" | "deny";
  triple?: string;
  round: number;
}
interface State {
  spentUsd: number;
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  seq: number;
}
const readJsonl = <T>(f: string): T[] => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : []);
const appendJsonl = (f: string, rows: unknown[]): void => {
  if (rows.length) fs.appendFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
};
const readJson = <T>(f: string, def: T): T => (fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : def);
const writeJson = (f: string, v: unknown): void => fs.writeFileSync(f, JSON.stringify(v, null, 1));
const loadState = (): State => readJson<State>(F.state, { spentUsd: 0, calls: 0, failedCalls: 0, promptTokens: 0, completionTokens: 0, seq: 0 });

// ───────── 規格 → 格子（key）與目標數 ─────────
const SENTS: ("pos" | "neg")[] = ["pos", "neg"];
const SENT_ZH: Record<Sent, string> = { pos: "利多", neg: "利空", neutral: "中性" };
const MAG_DESC: Record<number, string> = { 1: "輕微、例行或局部的消息", 2: "明顯、值得市場關注的消息", 3: "重大、足以改變市場看法的消息" };
const MAG_TARGET_CO = 6; // 公司：每個 原型×利多空×幅度 的目標則數
const MAG_TARGET_SEC: Record<number, number> = { 1: 3, 2: 2, 3: 1 };
const MAG_TARGET_MAC: Record<number, number> = { 1: 4, 2: 3, 3: 2 };
const MAG_TARGET_AN: Record<number, number> = { 1: 6, 2: 5, 3: 3 };
const WRAP_MOODS = [
  { mood: "up", sent: "pos" as Sent, zh: "大盤收高（小幅到中等幅度的上漲，氣氛偏樂觀）", target: 40 },
  { mood: "down", sent: "neg" as Sent, zh: "大盤收低（小幅到中等幅度的下跌，氣氛偏保守）", target: 40 },
  { mood: "flat", sent: "neutral" as Sent, zh: "大盤小幅震盪、漲跌互見、收在平盤附近", target: 40 },
] as const;
const PRE_TONES = [
  { sent: "pos" as Sent, zh: "氣氛偏樂觀", target: 25 },
  { sent: "neg" as Sent, zh: "氣氛偏謹慎", target: 25 },
  { sent: "neutral" as Sent, zh: "氣氛中性、觀望", target: 25 },
] as const;

interface Slot {
  key: string;
  group: string;
  kind: NewsKind;
  archetype: string;
  sentiment: Sent;
  mag: 1 | 2 | 3;
  when?: NewsWhen;
  ctx?: string;
  /** 給模型看的這一格說明（不含編號） */
  desc: string;
  /** 三連組的方向（rumor 才有） */
  dir?: "pos" | "neg";
  /** 切入角度清單的名稱（每一格輪流指定一個角度，逼模型寫出不同的內容） */
  angles?: string;
}
const ANGLE_SETS: Record<string, string[]> = {
  co: ["具體的營收或獲利數字", "背景與原因說明", "與同業 {peer} 的比較", "公司或社長的說明", "市場人士的看法", "客戶與通路的反應", "事業部門別的差異（不要列舉地區）", "對下一季或下一年度的影響", "投資、成本或人力面的細節", "時程與後續安排", "對股東或投資人的意義","原本的市場預期與落差"],
  ent: ["對粉絲社群的影響", "對周邊與授權收入的影響", "公司或製作人的說明", "與同業 {peer} 的比較", "市場人士的看法", "海外市場的反應", "對下一季營收的影響", "對旗下其他藝人或作品的連動", "票務與通路的反應", "後續的時程安排"],
  an: ["成長動能", "獲利率與成本", "評價水準", "新事業或新產品", "海外或區域市場", "與同業比較", "景氣與需求循環", "風險因素", "股東回饋與資本政策", "競爭格局"],
  mac: ["企業獲利", "家庭與消費", "進出口與製造業", "匯率與資金流向", "物價與薪資", "就業與人力", "服務業與觀光", "金融市場與債券", "房市與建設", "能源與原料", "中小企業", "市場預期與後續觀察重點"],
  wrap: ["族群輪動", "內需類股", "出口類股", "金融類股", "成長題材", "防禦類股", "權值股", "資金動向", "匯率與海外市場", "法人與個人投資人", "尾盤的變化", "盤中走勢的轉折", "市場情緒", "獲利了結與回補", "明天的觀察重點", "題材與消息面"],
  pre: ["海外市場與匯率", "央行與利率", "經濟數據的公布", "決算與公告的發表", "資金與籌碼", "族群輪動", "題材與消息面", "市場情緒與風險", "能源與原料價格", "投資人的心理", "各板塊的觀察重點", "不確定因素"],
};
interface Cell {
  key: string;
  group: string;
  target: number;
  slot: Omit<Slot, "key" | "group">;
  header: string;
}

const ANGLES = ["需求與訂單", "原料與成本", "法規與政策", "技術與新服務", "人才與人力", "海外市場與匯率", "競爭與價格", "資本支出與投資", "消費者行為", "供應鏈與庫存", "經營效率與數位化", "景氣與利率", "客群變化", "通路與銷售據點"];
const sectorDesc = (id: string): string => `${id}（${NEWS_SECTORS.find((s) => s.id === id)!.desc}）`;
const ctxMag = (a: number, b: number, s: number): 1 | 2 | 3 => ([1, 2, 1, 2, 3, 1, 2][(a * 3 + b + s) % 7] ?? 1) as 1 | 2 | 3;

function buildCells(): Cell[] {
  const cells: Cell[] = [];
  // 公司
  for (const a of COMPANY_ARCHETYPES) {
    for (const s of SENTS) {
      for (const m of [1, 2, 3] as const) {
        cells.push({
          key: `co|${a.id}|${s}|${m}`,
          group: `co|${a.id}`,
          target: MAG_TARGET_CO,
          header: `【公司個股消息】主題：${a.label}。\n利多的意思：${a.pos}。\n利空的意思：${a.neg}。`,
          slot: { kind: "company", archetype: a.id, sentiment: s, mag: m, when: a.earnings ? { earnings: true } : undefined, angles: "co", desc: `${SENT_ZH[s]}／幅度 ${m}（${MAG_DESC[m]}）` },
        });
      }
    }
  }
  // 娛樂題材（company 類；只限娛樂、動漫出版、遊戲三個板塊）
  const ENT_HEADER = (a: { label: string; pos: string; neg: string }): string =>
    `【娛樂題材的公司個股消息】這家公司是旗下有藝人、團體、作品或娛樂事業的上市公司（娛樂、動漫出版或遊戲板塊）。主題：${a.label}。
利多的意思：${a.pos}。
利空的意思：${a.neg}。
絕對不可以出現任何真實的藝人、團體、作品、角色、品牌或具體場館名稱，也不要寫任何人名；用「旗下偶像團體」「旗下藝人」「主唱」「成員」「新單曲」「主演動畫」「大型音樂祭」「演唱會」這類泛稱。地名只可以到城市層級（東京、大阪、福岡等），不要寫場館名。不寫票價與具體票數。`;
  for (const a of ENT_ARCHETYPES) {
    for (const s of SENTS) {
      for (const m of [1, 2, 3] as const) {
        cells.push({
          key: `en|${a.id}|${s}|${m}`,
          group: `en|${a.id}`,
          target: 5,
          header: ENT_HEADER(a),
          slot: { kind: "company", archetype: a.id, sentiment: s, mag: m, when: { sectors: [...ENT_SECTORS] }, angles: "ent", desc: `${SENT_ZH[s]}／幅度 ${m}（${MAG_DESC[m]}）` },
        });
      }
    }
  }
  for (const c of ENT_CONTEXTS) {
    const a = ENT_ARCHETYPES.find((x) => x.id === c.arch)!;
    SENTS.forEach((s, sj) => {
      const m = ctxMag(c.arch.length, c.ctx.length, sj);
      cells.push({
        key: `enx|${c.arch}|${c.ctx}|${s}`,
        group: `enx|${c.arch}`,
        target: 4,
        header: ENT_HEADER(a) + "\n每一則都要緊扣被指定的情境。",
        slot: { kind: "company", archetype: c.arch, sentiment: s, mag: m, when: { sectors: [...ENT_SECTORS], ...c.when }, ctx: c.ctx, desc: `情境：${c.desc}；${SENT_ZH[s]}／幅度 ${m}（${MAG_DESC[m]}）` },
      });
    });
  }
  // 分析師
  for (const a of ANALYST_ARCHETYPES) {
    for (const m of (a.sentiment === "neutral" ? [1] : [1, 2, 3]) as (1 | 2 | 3)[]) {
      cells.push({
        key: `an|${a.id}|${m}`,
        group: `an|${a.id}`,
        target: a.sentiment === "neutral" ? 14 : MAG_TARGET_AN[m]!,
        header: `【分析師評論】類型：${a.label}。${a.hint}。分析師與研究機構一律用泛稱（券商分析師、研究機構），不要寫任何機構名或人名；主角公司用 {name}。`,
        slot: { kind: "analyst", archetype: a.id, sentiment: a.sentiment, mag: m, angles: "an", desc: `${SENT_ZH[a.sentiment]}／幅度 ${m}（${MAG_DESC[m]}）` },
      });
    }
  }
  // 板塊通用
  NEWS_SECTORS.forEach((sec, si) => {
    for (const s of SENTS) {
      for (const m of [1, 2, 3] as const) {
        cells.push({
          key: `sec|${sec.id}|${s}|${m}`,
          group: `sec|${sec.id}`,
          target: MAG_TARGET_SEC[m]!,
          header: `【板塊消息】板塊：${sectorDesc(sec.id)}。這是針對整個板塊（產業）的消息，不是單一公司；不要出現 {name} 或 {peer}，可以用 {sector} 或直接寫板塊名稱。不指定季節、節日或天氣（全年任何時候都成立）。`,
          slot: { kind: "sector", archetype: "sector_trend", sentiment: s, mag: m, when: { sectors: [sec.id] }, desc: `${SENT_ZH[s]}／幅度 ${m}（${MAG_DESC[m]}）／切入角度：${ANGLES[(si * 5 + m * 3 + (s === "pos" ? 0 : 7)) % ANGLES.length]}` },
        });
      }
    }
  });
  // 板塊情境
  NEWS_SECTORS.forEach((sec, si) => {
    NEWS_CONTEXTS.forEach((c, ci) => {
      SENTS.forEach((s, sj) => {
        const m = ctxMag(si, ci, sj);
        cells.push({
          key: `secx|${sec.id}|${c.id}|${s}`,
          group: `secx|${sec.id}|${c.group}`,
          target: 1,
          header: `【板塊消息・情境專屬】板塊：${sectorDesc(sec.id)}。這是針對整個板塊的消息，不是單一公司；不要出現 {name} 或 {peer}，可以用 {sector} 或直接寫板塊名稱。每一則都要緊扣它被指定的情境，並且要符合這個板塊的實際業務（想一想這個情境對這個產業真正的影響）。`,
          slot: { kind: "sector", archetype: `sector_${c.group}`, sentiment: s, mag: m, when: { sectors: [sec.id], ...c.when }, ctx: c.id, desc: `情境：${c.label}（${c.desc}）；${SENT_ZH[s]}／幅度 ${m}（${MAG_DESC[m]}）` },
        });
      });
    });
  });
  // 全市場
  for (const t of MACRO_TOPICS) {
    for (const s of SENTS) {
      for (const m of [1, 2, 3] as const) {
        cells.push({
          key: `mac|${t.id}|${s}|${m}`,
          group: `mac|${t.id}`,
          target: MAG_TARGET_MAC[m]!,
          header: `【全市場消息】主題：${t.label}。\n利多的意思：${t.pos}。\n利空的意思：${t.neg}。\n全市場消息影響整個股市，不針對單一公司或板塊：不要出現 {name}、{peer}、{sector}。央行一律寫「央行」（不寫國名＋銀行）、指數寫「大盤」、不寫指數點數。不指定季節、節日或天氣。`,
          slot: { kind: "macro", archetype: t.id, sentiment: s, mag: m, angles: "mac", desc: `${SENT_ZH[s]}／幅度 ${m}（${MAG_DESC[m]}）` },
        });
      }
    }
  }
  NEWS_CONTEXTS.forEach((c, ci) => {
    SENTS.forEach((s, sj) => {
      cells.push({
        key: `macx|${c.id}|${s}`,
        group: `macx|${c.group}`,
        target: 2,
        header: `【全市場消息・情境專屬】這是影響整個股市或整體經濟的消息（消費、物價、景氣、交通、能源、旅遊需求、企業活動等），不針對單一公司或板塊：不要出現 {name}、{peer}、{sector}。每一則都要緊扣被指定的情境。`,
        slot: { kind: "macro", archetype: `macro_${c.group}`, sentiment: s, mag: ctxMag(ci, 2, sj), when: { ...c.when }, ctx: c.id, desc: `情境：${c.label}（${c.desc}）；${SENT_ZH[s]}／幅度 ${ctxMag(ci, 2, sj)}（${MAG_DESC[ctxMag(ci, 2, sj)]}）` },
      });
    });
  });
  // 傳聞（每格一組三連：傳聞／證實／否認）
  for (const t of RUMOR_TOPICS) {
    for (const d of SENTS) {
      for (const m of [1, 2, 3] as const) {
        cells.push({
          key: `rum|${t.id}|${d}|${m}`,
          group: `rum|${t.id}`,
          target: 1,
          header: `【傳聞三連組】主題：${t.label}。\n利多傳聞的意思：${t.pos}。\n利空傳聞的意思：${t.neg}。\n每一組包含三則互相呼應的消息：\n- rumor：市場傳聞（用「傳」「據傳」「市場消息指出」「外界盛傳」等語氣，明說尚未獲公司證實，不要寫成事實）；\n- confirm：公司隨後正式發布，證實傳聞屬實（細節與傳聞一致，可補充更多內容）；\n- deny：公司隨後否認或澄清，說明傳聞不實或沒有此事。\n三則都必須有 {name}（標題裡一定要有）。`,
          slot: { kind: "rumor", archetype: `rumor_${t.id}`, sentiment: d, mag: m, dir: d, desc: `${d === "pos" ? "利多傳聞（傳聞若屬實對公司有利；證實＝利多、否認＝利空）" : "利空傳聞（傳聞若屬實對公司不利；證實＝利空、否認＝利多）"}／幅度 ${m}（${MAG_DESC[m]}）` },
        });
      }
    }
  }
  // 收盤市況評語
  for (const w of WRAP_MOODS) {
    cells.push({
      key: `wrap|${w.mood}`,
      group: `wrap|${w.mood}`,
      target: w.target,
      header: `【收盤市況評語】今天的盤勢：${w.zh}。寫給投資人看的收盤綜述：描述整體氣氛、資金與族群輪動（用「內需族群」「出口相關」「防禦類股」「成長題材」等泛稱），可以提醒明天關注的方向。不要寫任何公司名、也不要出現任何佔位符；不要寫指數點數與漲跌幅數字；不要提到季節、節日、天氣或特定月份（這些評語全年通用）；用詞要與盤勢相符，不用「暴漲暴跌」這類極端字眼。`,
      slot: { kind: "wrap", archetype: `wrap_${w.mood}`, sentiment: w.sent, mag: 1, when: { mood: w.mood }, angles: "wrap", desc: `盤勢：${w.zh}` },
    });
  }
  // 開盤前瞻
  for (const p of PRE_TONES) {
    cells.push({
      key: `pre|${p.sent}`,
      group: `pre|${p.sent}`,
      target: p.target,
      header: `【開盤前瞻】開盤前給投資人的盤前提示，${p.zh}。內容是今天要留意的方向與風險（海外市場與匯率動向、央行與經濟數據公布、決算與公告的發表、資金面、族群輪動），用泛稱。不要寫任何公司名、也不要出現任何佔位符；不要寫指數點數與漲跌幅數字；不要提到昨天是漲是跌；不要提到季節、節日、天氣或特定月份（全年通用）。`,
      slot: { kind: "preopen", archetype: "preopen", sentiment: p.sent, mag: 1, angles: "pre", desc: p.zh },
    });
  }
  return cells;
}

// ───────── 驗證 ─────────
const NAME_X = "天河精機工業集團";
const PEER_X = "北辰物產控股集團";
const expand = (t: string, sector = "資訊科技"): string => t.replaceAll("{name}", NAME_X).replaceAll("{peer}", PEER_X).replaceAll("{sector}", sector);
const NEEDS_NAME = new Set<NewsKind>(["company", "analyst", "rumor"]);
const ALLOW_PEER = NEEDS_NAME;
const ALLOW_SECTOR = new Set<NewsKind>(["company", "analyst", "rumor", "sector"]);

const CTX_WORDS = /春天|春季|夏天|夏季|盛夏|秋天|秋季|冬天|冬季|寒冬|梅雨|颱風|酷暑|酷熱|寒流|嚴寒|黃金週|盂蘭盆|年末|年底|年始|新年(?!度)|歲末|聖誕|連休|連假|暑假|寒假|櫻花|賞花|紅葉|楓葉|發薪|跨年|豪雨|暴雨|入秋|入冬|入夏|開春|大掃除/;
/** 每個情境必須出現的線索（讓文案真的專屬於該情境） */
const CTX_CUE: Record<string, RegExp> = {
  spring: /春|櫻|新學期|新年度|搬家|入學/,
  summer: /夏|暑|酷熱|祭典|煙火/,
  autumn: /秋|紅葉|楓|涼爽/,
  winter: /冬|寒|流感|暖氣|乾燥/,
  rainy: /梅雨|陰雨|潮濕|濕度|多雨/,
  typhoon: /颱風|豪雨|暴風|暴雨/,
  long_weekend: /連休|連假|三天|假期|三連休/,
  golden_week: /黃金週|大型連假|連假|長假/,
  obon: /盂蘭盆|返鄉|探親|盆節|盆假/,
  year_end: /年末|年底|新年(?!度)|年始|歲末|初詣|福袋|年菜|跨年|大掃除|過年/,
  payday: /發薪|薪水|領薪|月薪|薪資入帳|月底/,
  christmas: /聖誕|耶誕|平安夜/,
  new_season: /新番|新季|開播|播出|首播|檔期/,
  rain: /雨|濕/,
  hot: /酷暑|高溫|酷熱|炎熱|熱浪|暑|悶熱/,
  cold: /寒|冷|低溫|凍|雪|冰/,
  storm: /颱風|暴風|強風|停駛|豪雨|暴雨|風雨/,
};
/** 同一組別裡，其他情境的專屬詞（出現就代表串錯情境） */
const CTX_EXCL: Record<string, RegExp> = {
  spring: /春天|春季|櫻花|賞花|新學期/,
  summer: /夏天|夏季|盛夏|暑假|酷暑/,
  autumn: /秋天|秋季|紅葉|楓葉|入秋/,
  winter: /冬天|冬季|寒冬|入冬/,
  rainy: /梅雨/,
  typhoon: /颱風|豪雨/,
  long_weekend: /連休|三連休/,
  golden_week: /黃金週/,
  obon: /盂蘭盆|盆節/,
  year_end: /年末|年始|新年(?!度)|歲末|初詣|福袋|跨年/,
  payday: /發薪|領薪/,
  rain: /下雨|降雨|雨天/,
  hot: /酷暑|酷熱|熱浪/,
  cold: /寒流|嚴寒|低溫|降雪/,
  storm: /颱風|暴風雨|強風/,
};
const CTX_GROUP: Record<string, string> = Object.fromEntries(NEWS_CONTEXTS.map((c) => [c.id, c.group]));

const PRICE_TALK = /漲停|跌停|股價(?:大|急|狂|應聲|立刻|隨即)?(?:漲|跌|飆|彈|殺|挫|升|降|創|走)|\d+(?:\.\d+)?\s*[%％]\s*(?:的)?(?:漲幅|跌幅|漲|跌)|(?:漲|跌|上揚|下挫|漲幅|跌幅)[^，。；、]{0,4}\d+(?:\.\d+)?\s*[%％]|指數[^，。；]{0,6}\d{2,}\s*點|\d{3,}\s*點/;
/** 市場反應用語：全市場、評語以外也不准（價格反應由遊戲自己決定）；macro 另外擋「股價／大盤／類股」的漲跌描述 */
const MARKET_REACTION = /(?:大盤|股價|股市|類股|權值股|金融股|消費股|相關股|個股|股票)[^，。；]{0,8}(?:承壓|走弱|走強|重挫|賣壓|買盤|拋售|震盪|下挫|上攻|收高|收低|墊高|走揚|走高)|資金回流股市|買盤|賣壓/;
/** 日文漢字（新字體），模型偶爾混進來 */
const JP_KANJI = /[仮経検営処広様転届録総関壊読関]/;
const EXTREME =/大漲|暴漲|飆漲|狂飆|暴跌|重挫|急殺|崩盤|大跌|慘跌|血洗|噴出/;
const ADVICE = /建議投資人|建議買進|建議賣出|建議加碼|穩賺|保證獲利|必漲|必跌|內線消息|跟著買|趕快買/;
const DATE_TALK = /\d{4}\s*年|\d{1,2}\s*月(?:份)?|\d{1,2}\s*日(?!圓)|[一二三四五六七八九十]{1,2}月/;
const LATIN_OK = new Set(["REIT", "ESG", "AI", "IT", "EV", "DX", "IPO", "5G", "M&A", "ETF", "CPI", "GDP", "PMI", "LNG", "SaaS", "IoT", "EPS", "ROE", "PER", "PBR", "CEO", "CFO", "COO", "R&D"]);
const VOLUME_TALK = /成交量|成交金額|成交值|量能|量價|爆量|量縮|量增|買超|賣超/;
const EMOJI =/\p{Extended_Pictographic}/u;
const RUMOR_CUE = /傳|據|消息|外界|疑|可能|或將|恐|擬|有意|風聲|盛傳|謠/;
const CONFIRM_CUE = /證實|確認|公告|宣布|宣佈|正式|發布|公布|揭露|承認|表示|說明/;
const DENY_CUE = /否認|澄清|不實|並無|沒有|未有|駁斥|無此|並未|不會|尚無|無意/;

interface Check {
  kind: NewsKind;
  ctx?: string;
  role?: "rumor" | "confirm" | "deny";
  hasWhen: boolean;
}
export function checkNews(headline: unknown, body: unknown, c: Check): string | null {
  if (typeof headline !== "string" || typeof body !== "string") return "欄位不是文字";
  const h = headline.trim();
  const b = body.trim();
  if (/[\n\r]/.test(h + b)) return "含換行";
  // 佔位符
  for (const [label, t] of [["標題", h], ["本文", b]] as const) {
    const toks = t.match(/\{[^{}]*\}|[{}｛｝]/g) ?? [];
    for (const tok of toks) {
      if (tok === "{name}") continue;
      if (tok === "{peer}") {
        if (!ALLOW_PEER.has(c.kind)) return `${c.kind} 類不可有 {peer}`;
        continue;
      }
      if (tok === "{sector}") {
        if (!ALLOW_SECTOR.has(c.kind)) return `${c.kind} 類不可有 {sector}`;
        continue;
      }
      return `${label}有非法佔位符 ${tok}`;
    }
    if (t.includes("{name}") && !NEEDS_NAME.has(c.kind)) return `${c.kind} 類不可有 {name}`;
  }
  const both = h + b;
  if (NEEDS_NAME.has(c.kind) && !h.includes("{name}")) return "標題缺少 {name}";
  if ((both.match(/\{name\}/g) ?? []).length > 3) return "{name} 出現太多次";
  if ((both.match(/\{peer\}/g) ?? []).length > (c.kind === "rumor" ? 4 : 2)) return "{peer} 出現太多次";
  const latin = both.replace(/\{(?:name|peer|sector)\}/g, "").match(/[A-Za-z][A-Za-z0-9&+.-]*/g)?.find((w) => !LATIN_OK.has(w));
  if (latin) return `夾雜英文「${latin}」`;
  if (/\{name\}\s*(?:與|和|及|、|跟)\s*\{name\}/.test(both)) return "{name} 連用";
  // 文字與長度（用展開後的長度；並套用 validate.ts 的地名／品牌／粗話／簡體字／日文檢查）
  const eh = expand(h);
  const eb = expand(b);
  let bad = checkText(eh, { min: 12, max: 40, allowPlaces: true });
  if (bad) return `標題：${bad}`;
  bad = checkText(eb, { min: 60, max: 120, allowPlaces: true });
  if (bad) return `本文：${bad}`;
  if (/[。！？!?]$/.test(h)) return "標題以句號結尾";
  if (!/[。」）]$/.test(b)) return "本文沒有以句號結尾";
  if (EMOJI.test(both)) return "含 emoji";
  if (/[!！]/.test(both)) return "含驚嘆號";
  if (textSimilarity(h, b) > 0.75) return "本文只是重複標題";
  // 內容規範
  if (PRICE_TALK.test(both)) return "寫了股價或漲跌幅";
  if (JP_KANJI.test(both)) return "含日文漢字";
  if (c.kind !== "wrap" && c.kind !== "preopen" && MARKET_REACTION.test(both)) return "寫了股價或資金面的反應";
  if (ADVICE.test(both)) return "含投資建議字眼";
  if (DATE_TALK.test(both)) return "含年份或具體日期";
  if ((c.kind === "wrap" || c.kind === "preopen") && EXTREME.test(both)) return "市況用詞過於極端";
  if (c.kind === "preopen" && /昨(?:日|天)|前一(?:日|天)|上一(?:個)?交易日/.test(both)) return "開盤前瞻不可提昨日漲跌";
  if (c.kind === "wrap" && /\d+\s*點/.test(both)) return "寫了指數點數";
  if ((c.kind === "wrap" || c.kind === "preopen") && VOLUME_TALK.test(both)) return "寫了成交量或買賣超";
  if (/國際能源|能源署|石油輸出|聯合國|世界衛生|世貿|世界貿易組織|歐盟|北約/.test(both)) return "含真實國際組織";
  // 情境
  if (c.ctx) {
    const cue = CTX_CUE[c.ctx];
    if (cue && !cue.test(both)) return `沒有扣緊情境「${c.ctx}」`;
    const grp = CTX_GROUP[c.ctx];
    for (const [other, re] of Object.entries(CTX_EXCL)) if (other !== c.ctx && CTX_GROUP[other] === grp && re.test(both)) return `串到別的情境「${other}」`;
  } else if (!c.hasWhen || c.kind === "wrap" || c.kind === "preopen") {
    const m = both.match(CTX_WORDS);
    if (m) return `通用內容出現情境詞「${m[0]}」`;
  }
  // 傳聞三連組語氣
  if (c.role === "rumor" && !RUMOR_CUE.test(h)) return "傳聞標題不像傳聞";
  if (c.role === "confirm" && !CONFIRM_CUE.test(both)) return "證實文案不像證實";
  if (c.role === "deny" && !DENY_CUE.test(both)) return "否認文案不像否認";
  return null;
}

const norm = (t: string): string => t.replace(/[\s，。、！？「」『』（）()：；,.!?"'{}\-—…]/g, "");
const uidOf = (h: string, b: string): string => createHash("sha1").update(norm(h) + "|" + norm(b)).digest("hex").slice(0, 12);
const openerOf = (h: string): string => h.replaceAll("{name}", "某").replaceAll("{peer}", "他").replaceAll("{sector}", "業").slice(0, 3);

// ───────── 狀態：目前的池與剔除 ─────────
interface Pool {
  all: Cand[];
  live: Cand[];
  rejects: Record<string, string>;
}
function loadPool(): Pool {
  const all = readJsonl<Cand>(F.pool);
  const rejects = readJson<Record<string, string>>(F.rejects, {});
  const live = all.filter((c) => !rejects[c.uid]);
  return { all, live, rejects };
}

// ───────── 提示詞 ─────────
const SYSTEM = `你是財經新聞編輯，替一款繁體中文的商場經營遊戲裡的「虛構股票市場」撰寫快訊與評論。這是遊戲內容，不是真實市場。
硬性規則：
1. 所有上市公司都是虛構的。公司一律用佔位符：{name}＝這則消息的主角公司、{peer}＝同業的另一家公司、{sector}＝板塊名稱。絕對不要自己發明或寫出任何公司名、品牌名、商品名，更不要寫真實存在的企業、金融機構、媒體、評等機構、交易所、指數、央行名稱、政黨、人名（包含日本的大型企業與外國企業）。需要提到評等機構、券商、央行、指數時只用泛稱：「評等機構」「券商分析師」「央行」「大盤」。
2. 可以提到真實的國家、都道府縣與城市（例如東京、關西、九州、北海道、名古屋、福岡）當背景；但不要寫具體的車站、鐵道線、機場、港口、設施或街區名稱，也不要把消息綁在某個真實的具體地點或設施上。
3. 不寫任何人名（可以用職稱：社長、會長、分析師）。不寫網址、聯絡方式、粗話；不涉及政治立場、宗教、戰爭、傷亡、犯罪細節。
4. 不寫年份、具體日期與「N 月」；不寫股價、漲跌幅、成交量、買賣超、指數點數（價格與量的反應由遊戲自己決定）。可以寫營收、獲利、訂單、用戶數等基本面的說法，數字要合理而不過度精確（用「約兩成」「近一成」「數百億日圓」這類寫法），金額用「日圓」。
5. 文體：像日本財經新聞的快訊稿，翻成自然的臺灣繁體中文：客觀、簡潔，不誇張、不用驚嘆號、不用 emoji、不下投資建議，不用簡體字，不夾雜日文句子，也不要夾雜英文單字（全部用中文詞彙）；標題裡不要用空格或標點斷成好幾段，寫成一個通順的句子。不要提到真實的國際組織（聯合國、歐盟、國際能源機構等）。
6. 標題 12–40 字（不加句號）；本文 60–120 字、兩到三句，以句號結尾，不要重複標題的句子，要補充原因、背景或影響。
7. 「利多」＝對公司或市場偏正面，「利空」＝偏負面，語氣與標記必須一致。幅度 1＝輕微、例行或局部；2＝明顯、值得關注；3＝重大、足以改變市場看法。文字的力道要符合幅度，但不要寫股價的反應。
8. 緊扣指定的主題與方向：利多就寫成對公司（或板塊）明確有利的事，利空就寫成明確不利的事，不要寫成中性、「影響有限」或各說各話；情境本身對該產業不利時，利多版本要寫成「相對受惠」或「抵銷」的角度，不要寫成壞消息。不要把別的原型的內容（決算、股利、評等、會員優惠、通路與消費者反應等）混進來。全市場消息與板塊消息不要寫股價、大盤、類股的漲跌或買賣盤反應。
9. 同一批裡每一則的題材、細節、開頭與用字都要彼此不同，避免換湯不換藥；標題不要都用「{name}」開頭，請交錯使用事件、原因、數字、板塊、時間點等不同的起手式。
10. 只輸出 JSON，不要任何說明或 Markdown。`;

function buildPrompt(jobId: string, round: number, header: string, slots: Slot[], opts: { triple: boolean; avoid: string[] }): { role: "system" | "user"; content: string }[] {
  const rot = parseInt(createHash("sha1").update(`${jobId}:${round}`).digest("hex").slice(0, 6), 16);
  const list = slots
    .map((s, i) => {
      const set = s.angles ? ANGLE_SETS[s.angles] : undefined;
      return `${i + 1}. ${s.desc}${set ? `／切入角度：${set[(rot + i * 5) % set.length]}` : ""}`;
    })
    .join("\n");
  const avoid = opts.avoid.length ? `\n不要和這些已經寫過的標題雷同（題材、說法都要避開）：${opts.avoid.map((t) => `「${t}」`).join("")}` : "";
  const fmt = opts.triple
    ? `輸出格式（每個編號一組，slot 就是編號）：{"items":[{"slot":1,"rumor":{"headline":"...","body":"..."},"confirm":{"headline":"...","body":"..."},"deny":{"headline":"...","body":"..."}}]}`
    : `輸出格式（每個編號一則，slot 就是編號）：{"items":[{"slot":1,"headline":"...","body":"..."}]}`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `${header}\n\n請依下面 ${slots.length} 個編號各寫${opts.triple ? "一組" : "一則"}（每一則的內容都要不同）：\n${list}${avoid}\n\n${fmt}` },
  ];
}

// ───────── 規劃：缺口 → 批次 ─────────
interface Job {
  id: string;
  group: string;
  header: string;
  triple: boolean;
  slots: Slot[];
}
function planJobs(cells: Cell[], pool: Pool, only?: RegExp): Job[] {
  const have = new Map<string, number>();
  for (const c of pool.live) {
    if (c.role && c.role !== "rumor") continue;
    have.set(c.key, (have.get(c.key) ?? 0) + 1);
  }
  const byGroup = new Map<string, { header: string; triple: boolean; slots: Slot[] }>();
  for (const cell of cells) {
    if (only && !only.test(cell.key)) continue;
    const missing = cell.target * (only ? Number(flag("target-mult", "1")) : 1) - (have.get(cell.key) ?? 0);
    for (let i = 0; i < missing; i++) {
      const g = byGroup.get(cell.group) ?? { header: cell.header, triple: cell.slot.kind === "rumor", slots: [] };
      g.slots.push({ key: cell.key, group: cell.group, ...cell.slot });
      byGroup.set(cell.group, g);
    }
  }
  const jobs: Job[] = [];
  for (const [group, g] of byGroup) {
    const size = g.triple ? 4 : 12;
    const chunks = Math.ceil(g.slots.length / size);
    const per = Math.ceil(g.slots.length / chunks);
    for (let i = 0; i < chunks; i++) jobs.push({ id: `${group}#${i}`, group, header: g.header, triple: g.triple, slots: g.slots.slice(i * per, (i + 1) * per) });
  }
  return jobs;
}

// ───────── 接收與去重 ─────────
const recentHeads = (pool: Pool, group: string, n = 10): string[] => pool.live.filter((c) => c.group === group && c.role !== "confirm" && c.role !== "deny").slice(-n).map((c) => c.headline);

function similarTo(pool: Pool, c: { group: string; headline: string; body: string }, extra: Cand[]): string | null {
  const u = uidOf(c.headline, c.body);
  if (pool.all.some((x) => x.uid === u) || extra.some((x) => x.uid === u)) return "與其他格子完全重複";
  const sameGroup = [...pool.live, ...extra].filter((x) => x.group === c.group);
  const nh = norm(c.headline);
  const nb = norm(c.body);
  for (const x of sameGroup) {
    if (norm(x.headline) === nh) return "標題重複";
    if (norm(x.body) === nb) return "本文重複";
    if (textSimilarity(c.headline, x.headline) >= 0.6) return "標題太像既有內容";
    if (textSimilarity(c.body, x.body) >= 0.5) return "本文太像既有內容";
  }
  return null;
}

function openerBlocked(pool: Pool, c: { kind: NewsKind; sentiment: Sent; group: string; headline: string }, extra: Cand[]): string | null {
  const op = openerOf(c.headline);
  const kindGroup = [...pool.live, ...extra].filter((x) => x.kind === c.kind && x.sentiment === c.sentiment);
  const sameKind = kindGroup.filter((x) => openerOf(x.headline) === op).length;
  if (sameKind + 1 > Math.max(6, Math.ceil((kindGroup.length + 1) * 0.1))) return `開頭詞「${op}」在 ${c.kind}/${c.sentiment} 太集中`;
  const grp = [...pool.live, ...extra].filter((x) => x.group === c.group);
  const sameGrp = grp.filter((x) => openerOf(x.headline) === op).length;
  if (sameGrp + 1 > Math.max(3, Math.ceil((grp.length + 1) * 0.3))) return `開頭詞「${op}」在同一組太集中`;
  return null;
}

interface Intake {
  added: Cand[];
  rejected: { key: string; reason: string; headline: string; body: string }[];
}
function intake(job: Job, items: unknown[], pool: Pool, round: number): Intake {
  const out: Intake = { added: [], rejected: [] };
  const seen = new Set<number>();
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx] as Record<string, unknown> | null;
    if (!it || typeof it !== "object") continue;
    let n = Number(it.slot);
    if (!Number.isInteger(n) || n < 1 || n > job.slots.length) n = idx + 1;
    if (n > job.slots.length || seen.has(n)) continue;
    seen.add(n);
    const slot = job.slots[n - 1]!;
    const parts: { role?: "rumor" | "confirm" | "deny"; h: unknown; b: unknown }[] = job.triple
      ? (["rumor", "confirm", "deny"] as const).map((role) => ({ role, h: (it[role] as { headline?: unknown } | undefined)?.headline, b: (it[role] as { body?: unknown } | undefined)?.body }))
      : [{ h: it.headline, b: it.body }];
    const cands: Cand[] = [];
    let fail: string | null = null;
    const triple = job.triple ? createHash("sha1").update(job.id + n + round + Date.now()).digest("hex").slice(0, 8) : undefined;
    for (const p of parts) {
      const reason = checkNews(p.h, p.b, { kind: slot.kind, ctx: slot.ctx, role: p.role, hasWhen: !!slot.when && Object.keys(slot.when).some((k) => k !== "earnings" && k !== "sectors" && k !== "mood") });
      if (reason) {
        fail = p.role ? `${p.role}：${reason}` : reason;
        out.rejected.push({ key: slot.key, reason: fail, headline: String(p.h ?? "").slice(0, 80), body: String(p.b ?? "").slice(0, 160) });
        break;
      }
      const h = String(p.h).trim().replace(/[ 　]+/g, "，");
      const b = String(p.b).trim();
      const sentiment: Sent = slot.kind === "rumor" ? (p.role === "deny" ? (slot.dir === "pos" ? "neg" : "pos") : slot.dir!) : slot.sentiment;
      const c: Cand = {
        uid: uidOf(h, b),
        key: slot.key,
        group: slot.group,
        kind: slot.kind,
        archetype: slot.kind === "rumor" ? `${p.role}_${slot.archetype.slice(6)}` : slot.archetype,
        sentiment,
        mag: slot.mag,
        headline: h,
        body: b,
        when: slot.when,
        ctx: slot.ctx,
        role: p.role,
        triple,
        round,
      };
      const dup = similarTo(pool, c, [...out.added, ...cands]);
      if (dup) {
        fail = dup;
        out.rejected.push({ key: slot.key, reason: dup, headline: h.slice(0, 80), body: b.slice(0, 160) });
        break;
      }
      if (!p.role || p.role === "rumor") {
        const ob = openerBlocked(pool, c, [...out.added, ...cands]);
        if (ob) {
          fail = ob;
          out.rejected.push({ key: slot.key, reason: ob, headline: h.slice(0, 80), body: b.slice(0, 160) });
          break;
        }
      }
      cands.push(c);
    }
    if (!fail) out.added.push(...cands);
  }
  return out;
}

// ───────── 呼叫模型 ─────────
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
class Fatal extends Error {}

async function runGen(): Promise<void> {
  const key = process.env.OPENROUTER_TEST_KEY;
  if (!key) throw new Fatal("沒有設定 OPENROUTER_TEST_KEY");
  const maxUsd = Number(flag("max-usd", "1"));
  const rounds = Number(flag("rounds", "3"));
  const conc = Math.max(1, Number(flag("conc", "4")));
  const maxCalls = Number(flag("max-calls", "100000"));
  const only = flag("only") ? new RegExp(flag("only")!) : undefined;
  const cells = buildCells();
  const state = loadState();
  let callsThisRun = 0;

  for (let round = 1; round <= rounds; round++) {
    const pool = loadPool();
    const jobs = planJobs(cells, pool, only);
    const slotsTotal = jobs.reduce((a, j) => a + j.slots.length, 0);
    console.log(`\n── 第 ${round}/${rounds} 輪：${jobs.length} 個批次、${slotsTotal} 個缺口；已花 $${state.spentUsd.toFixed(4)}／上限 $${maxUsd}`);
    if (!jobs.length) {
      console.log("沒有缺口了。");
      return;
    }
    if (has("dry")) {
      for (const j of jobs.slice(0, 8)) console.log(`  ${j.id} ×${j.slots.length}`);
      return;
    }
    let next = 0;
    let inflight = 0;
    let stop = false;
    let totalAdded = 0;
    const avg = (): number => (state.calls > 0 ? state.spentUsd / state.calls : 0.01);
    const worker = async (): Promise<void> => {
      while (!stop) {
        const j = next < jobs.length ? jobs[next++]! : null;
        if (!j) return;
        if (callsThisRun >= maxCalls) return;
        if (state.spentUsd + (inflight + 1) * avg() * 1.15 > maxUsd) {
          if (!stop) console.log(`達到預算上限（已花 $${state.spentUsd.toFixed(4)}，單次約 $${avg().toFixed(4)}），停止派發。`);
          stop = true;
          return;
        }
        inflight++;
        callsThisRun++;
        try {
          const cur = loadPool(); // 其他 worker 剛加入的也要算進去重
          const prompt = buildPrompt(j.id, round, j.header, j.slots, { triple: j.triple, avoid: recentHeads(cur, j.group) });
          let items: unknown[] | null = null;
          for (let attempt = 1; attempt <= 4 && items === null; attempt++) {
            try {
              const r = await chat({ apiKey: key, model: MODEL, messages: prompt, maxTokens: j.triple ? 6000 : 4500, temperature: 0.95, json: true, timeoutMs: 120_000 });
              state.calls++;
              state.spentUsd += r.costUsd ?? 0.003;
              state.promptTokens += r.promptTokens;
              state.completionTokens += r.completionTokens;
              state.seq++;
              writeJson(F.state, state);
              fs.writeFileSync(path.join(DIR, "raw", `${String(state.seq).padStart(5, "0")}_${j.id.replace(/[^\w|#-]/g, "_").replaceAll("|", "-")}.json`), JSON.stringify({ job: { id: j.id, slots: j.slots.map((s) => s.key) }, round, costUsd: r.costUsd, tokens: [r.promptTokens, r.completionTokens], finish: r.finishReason, text: r.text }, null, 1));
              try {
                const parsed = extractJson(r.text) as { items?: unknown[] };
                items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? (parsed as unknown[]) : null;
                if (items === null) throw new LlmError("沒有 items 陣列");
              } catch (e) {
                state.failedCalls++;
                console.log(`  ${j.id} 第 ${attempt} 次：解析失敗（${e instanceof Error ? e.message : "?"}）`);
              }
            } catch (e) {
              state.failedCalls++;
              const status = e instanceof LlmError ? e.status : null;
              if (status === 401 || status === 402 || status === 403) throw new Fatal(`${e instanceof LlmError ? e.message : "認證或額度錯誤"}`);
              const wait = Math.min(60_000, 2000 * 2 ** (attempt - 1)) + Math.random() * 1000;
              console.log(`  ${j.id} 第 ${attempt} 次失敗：${e instanceof LlmError ? e.message : String(e)}；${Math.round(wait / 1000)} 秒後重試`);
              await sleep(wait);
            }
          }
          if (items === null) continue;
          const fresh = loadPool();
          const res = intake(j, items, fresh, round);
          appendJsonl(F.pool, res.added);
          appendJsonl(F.auto, res.rejected.map((x) => ({ ...x, round, job: j.id })));
          totalAdded += res.added.length;
          console.log(`  ${j.id} ×${j.slots.length}：收 ${res.added.length}／拒 ${res.rejected.length}${res.rejected.length ? "（" + [...new Set(res.rejected.map((x) => x.reason.split("「")[0]!.slice(0, 14)))].slice(0, 3).join("；") + "）" : ""}  累計 $${state.spentUsd.toFixed(4)}`);
        } catch (e) {
          if (e instanceof Fatal) {
            console.log(`致命錯誤，全部停止：${e.message}`);
            stop = true;
            process.exitCode = 1;
          } else throw e;
        } finally {
          inflight--;
        }
      }
    };
    await Promise.all(Array.from({ length: conc }, worker));
    writeJson(F.state, state);
    console.log(`第 ${round} 輪完成：新增 ${totalAdded} 則；累計 $${state.spentUsd.toFixed(4)}，${state.calls} 次呼叫`);
    if (stop || callsThisRun >= maxCalls) return;
  }
}

// ───────── 審核流程 ─────────
const ORDER: NewsKind[] = ["company", "analyst", "rumor", "sector", "macro", "wrap", "preopen"];
const sortKey = (c: Cand): string => `${ORDER.indexOf(c.kind)}|${c.key}|${c.triple ?? ""}|${c.role === "rumor" ? 0 : c.role === "confirm" ? 1 : c.role === "deny" ? 2 : 0}|${c.uid}`;

function cmdDump(): void {
  const pool = loadPool();
  const reviewed = new Set(readJson<string[]>(F.reviewed, []));
  const count = Number(flag("count", "120"));
  const todo = pool.live.filter((c) => !reviewed.has(c.uid)).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  const only = flag("kind");
  const picked = (only ? todo.filter((c) => c.kind === only) : todo).slice(0, count);
  if (!picked.length) {
    console.log("沒有待審內容。");
    return;
  }
  const k = fs.readdirSync(path.join(DIR, "dumps")).length + 1;
  writeJson(path.join(DIR, "dumps", `dump_${k}.json`), picked.map((c) => c.uid));
  console.log(`# 第 ${k} 批（${picked.length} 則；全庫待審還有 ${todo.length - picked.length} 則）`);
  let last = "";
  picked.forEach((c, i) => {
    if (c.key !== last) console.log(`## ${c.key}`);
    last = c.key;
    console.log(`${i + 1}${c.role ? "[" + { rumor: "傳", confirm: "證", deny: "否" }[c.role] + "]" : ""}▸ ${c.headline} ｜ ${c.body}`);
  });
}

function cmdApply(): void {
  const k = argv[1];
  if (!k) throw new Fatal("用法：apply <批號> [--file f | --rej \"3:原因,7:原因\"]");
  const dumpFile = path.join(DIR, "dumps", `dump_${k}.json`);
  if (!fs.existsSync(dumpFile)) throw new Fatal(`找不到第 ${k} 批`);
  const uids = readJson<string[]>(dumpFile, []);
  const lines: string[] = [];
  const file = flag("file");
  if (file) lines.push(...fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")));
  const rej = flag("rej");
  if (rej) lines.push(...rej.split(","));
  const pool = loadPool();
  const byUid = new Map(pool.all.map((c) => [c.uid, c]));
  const rejects = readJson<Record<string, string>>(F.rejects, {});
  let n = 0;
  for (const line of lines) {
    const m = line.trim().match(/^(\d+)\s*[:：\s]\s*(.+)$/);
    if (!m) throw new Fatal(`看不懂這行：${line}`);
    const uid = uids[Number(m[1]) - 1];
    if (!uid) throw new Fatal(`編號超出範圍：${m[1]}`);
    const c = byUid.get(uid)!;
    rejects[uid] = m[2]!.trim();
    n++;
    if (c.triple) for (const x of pool.all) if (x.triple === c.triple && !rejects[x.uid]) rejects[x.uid] = `三連組連帶（${m[2]!.trim()}）`;
  }
  writeJson(F.rejects, rejects);
  const reviewed = new Set(readJson<string[]>(F.reviewed, []));
  for (const u of uids) reviewed.add(u);
  writeJson(F.reviewed, [...reviewed]);
  console.log(`第 ${k} 批：${uids.length} 則已審；剔除 ${n} 則（含三連組連帶共 ${Object.keys(rejects).length} 則累計）`);
}

// ───────── 統計與組裝 ─────────
function cmdStats(): void {
  const pool = loadPool();
  const state = loadState();
  const reviewed = new Set(readJson<string[]>(F.reviewed, []));
  const auto = readJsonl<{ reason: string }>(F.auto);
  console.log(`花費 $${state.spentUsd.toFixed(4)}；呼叫 ${state.calls} 次（失敗／解析失敗 ${state.failedCalls}）；token in/out ${state.promptTokens}/${state.completionTokens}`);
  console.log(`池：${pool.all.length} 則（有效 ${pool.live.length}、人工剔除 ${Object.keys(pool.rejects).length}、已審 ${reviewed.size}）；自動拒收 ${auto.length} 則`);
  const by = (f: (c: Cand) => string): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const c of pool.live) m[f(c)] = (m[f(c)] ?? 0) + 1;
    return m;
  };
  console.log("kind：", JSON.stringify(by((c) => c.kind)));
  const reasons: Record<string, number> = {};
  for (const r of auto) {
    const k = r.reason.replace(/「[^」]*」/g, "「…」").replace(/^(rumor|confirm|deny)：/, "").slice(0, 30);
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  console.log("自動拒收原因：", JSON.stringify(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 25)));
  const man: Record<string, number> = {};
  for (const r of Object.values(pool.rejects)) man[r.slice(0, 20)] = (man[r.slice(0, 20)] ?? 0) + 1;
  console.log("人工剔除原因：", JSON.stringify(Object.entries(man).sort((a, b) => b[1] - a[1])));
  const co: Record<string, number> = {};
  for (const c of pool.live.filter((x) => x.kind === "company")) co[`${c.archetype}/${c.sentiment}`] = (co[`${c.archetype}/${c.sentiment}`] ?? 0) + 1;
  console.log("公司最少的格子：", JSON.stringify(Object.entries(co).sort((a, b) => a[1] - b[1]).slice(0, 6)));
}

const sentCode = (s: Sent): string => (s === "pos" ? "p" : s === "neg" ? "n" : "z");
const KIND_ABBR: Record<NewsKind, string> = { company: "co", sector: "sc", macro: "mc", analyst: "an", rumor: "rm", wrap: "wp", preopen: "po" };

function cmdBuild(): void {
  const pool = loadPool();
  const reviewed = new Set(readJson<string[]>(F.reviewed, []));
  const unreviewed = pool.live.filter((c) => !reviewed.has(c.uid));
  if (unreviewed.length && !has("allow-unreviewed")) throw new Fatal(`還有 ${unreviewed.length} 則沒審核；請先 dump／apply，或加 --allow-unreviewed（只供試跑）`);
  // 三連組必須完整
  const tripleCount = new Map<string, number>();
  for (const c of pool.live) if (c.triple) tripleCount.set(c.triple, (tripleCount.get(c.triple) ?? 0) + 1);
  const live = pool.live.filter((c) => !c.triple || tripleCount.get(c.triple) === 3);
  const idOf = (c: Cand): string => `${KIND_ABBR[c.kind]}-${c.archetype}-${sentCode(c.sentiment)}${c.mag}-${c.uid.slice(0, 8)}`;
  const idByUid = new Map(live.map((c) => [c.uid, idOf(c)]));
  const idsUnique = new Set(idByUid.values());
  if (idsUnique.size !== live.length) throw new Fatal("id 有衝突");
  const byTriple = new Map<string, Cand[]>();
  for (const c of live) if (c.triple) byTriple.set(c.triple, [...(byTriple.get(c.triple) ?? []), c]);
  const items: NewsPoolItem[] = live.map((c) => {
    const it: NewsPoolItem = { id: idOf(c), kind: c.kind, archetype: c.archetype, sentiment: c.sentiment, mag: c.mag, headline: c.headline, body: c.body, weight: 1 };
    if (c.when && Object.keys(c.when).length) it.when = c.when;
    if (c.triple) {
      const g = byTriple.get(c.triple)!;
      const rumor = g.find((x) => x.role === "rumor")!;
      const confirm = g.find((x) => x.role === "confirm")!;
      it.pair = c.role === "rumor" ? idOf(confirm) : idOf(rumor);
    }
    return it;
  });
  items.sort((a, b) => (a.id < b.id ? -1 : 1));
  const out = path.resolve(flag("out") ?? path.join(DIR, "news.data.json"));
  fs.writeFileSync(out, "[\n" + items.map((i) => JSON.stringify(i)).join(",\n") + "\n]\n");
  console.log(`已寫入 ${out}：${items.length} 則（${(fs.statSync(out).size / 1024).toFixed(0)} KB）`);
  const kinds: Record<string, number> = {};
  for (const i of items) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  console.log(JSON.stringify(kinds), `三連組 ${byTriple.size} 組；覆蓋門檻參考：`, JSON.stringify(COVERAGE));
}

// ───────── 其他 ─────────
async function cmdCheck(): Promise<void> {
  const key = process.env.OPENROUTER_TEST_KEY;
  if (!key) throw new Fatal("沒有設定 OPENROUTER_TEST_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` } });
  const j = (await res.json()) as { data?: { usage?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean }; error?: { message?: string } };
  if (!res.ok) throw new Fatal(`HTTP ${res.status}：${String(j.error?.message ?? "").slice(0, 120)}`);
  const d = j.data ?? {};
  console.log(`用量 $${d.usage ?? "?"}；上限 ${d.limit ?? "無"}；剩餘 ${d.limit_remaining ?? "無上限資訊"}；免費層 ${d.is_free_tier ?? "?"}`);
}

async function main(): Promise<void> {
  switch (cmd) {
    case "check":
      return cmdCheck();
    case "gen":
      return runGen();
    case "dump":
      return cmdDump();
    case "apply":
      return cmdApply();
    case "stats":
      return cmdStats();
    case "build":
      return cmdBuild();
    case "cells": {
      const cells = buildCells();
      const sum = cells.reduce((a, c) => a + c.target * (c.slot.kind === "rumor" ? 3 : 1), 0);
      console.log(`${cells.length} 個格子，目標約 ${sum} 則`);
      return;
    }
    default:
      console.log("指令：check | gen | stats | dump | apply | build | cells（細節見檔頭說明）");
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
