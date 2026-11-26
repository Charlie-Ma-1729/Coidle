// 藝人名冊生成器：一次性離線批次，用 OpenRouter 的 anthropic/claude-haiku-5.5 生成、驗證、去重，
// 之後由人（Claude）逐筆審核，最後組成 shared/src/game/talent/roster.data.json。不在遊戲執行期呼叫。
//
// 用法（在 Windows 鏡像資料夾內執行，金鑰只由 --env-file 載入、絕不印出）：
//   npx tsx --env-file=<專案>\.env --tsconfig tsconfig.json server/src/ai/talentroster.ts <指令> [選項]
//
// 指令：
//   gen   [--max-usd 0.1] [--rounds 3] [--conc 4] [--only <key 正規式>] [--dry]
//                              依「空缺」（還沒有通過驗證且沒被剔除的位置）規劃批次並呼叫模型；可續跑
//   dump  [--count 120]        列出下一批待審的內容（編號 1..N）
//   apply <批號> [--file f]    把這一批標為已審；檔案每行「編號 原因」＝剔除，其餘通過
//   stats                      各領域數量、自動拒收原因、花費
//   build [--out path]         把已審且沒被剔除的內容組成最終 JSON 並檢查覆蓋
//
// 位置（slot）的出身地、年代、特質、姓名風格是程式先決定好的（種子固定），模型只負責姓名、讀音與一句人設，
// 所以分布（年代、地區、特質、日式／非日式比例）由程式控制，不靠模型自由發揮。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chat, extractJson, LlmError } from "./openrouter";
import { checkText, textSimilarity } from "./validate";
import { realNameHit } from "./realPeople";
import {
  AGE_BANDS,
  BAND_ROLE_TAGS,
  GROUP_AREAS,
  ROSTER_COVERAGE,
  TALENT_AREAS,
  TALENT_AREA_SPEC,
  TALENT_TRAIT_CONFLICTS,
  type AgeBand,
  type GroupArea,
  type RosterFile,
  type Talent,
  type TalentArea,
  type TalentGroup,
} from "../../../shared/src/game/talent/rosterSpec";

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
const DIR = path.resolve(flag("dir") ?? path.join(os.tmpdir(), "coidle-talentroster"));
for (const sub of ["", "raw", "dumps"]) fs.mkdirSync(path.join(DIR, sub), { recursive: true });
const F = {
  pool: path.join(DIR, "pool.jsonl"),
  auto: path.join(DIR, "autoreject.jsonl"),
  state: path.join(DIR, "state.json"),
  reviewed: path.join(DIR, "reviewed.json"),
  rejects: path.join(DIR, "rejects.json"),
};

class Fatal extends Error {}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function readJson<T>(f: string, def: T): T {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return def;
  }
}
const writeJson = (f: string, v: unknown): void => fs.writeFileSync(f, JSON.stringify(v, null, 1));
function readJsonl<T>(f: string): T[] {
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}
const appendJsonl = (f: string, rows: unknown[]): void => {
  if (rows.length) fs.appendFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

// ───────── 位置（slot）規劃：全部由固定種子決定 ─────────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], r: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
function pickWeighted<T>(items: [T, number][], r: () => number): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x < 0) return v;
  }
  return items[items.length - 1]![0];
}

type Style = "jp" | "kr" | "cn" | "west" | "stage";
const STYLE_QUOTA: [Style, number][] = [["jp", 70], ["kr", 8], ["cn", 6], ["west", 9], ["stage", 7]];

const PREFECTURES: [string, number][] = [
  ["東京都", 9], ["大阪府", 7], ["神奈川縣", 5], ["愛知縣", 4], ["福岡縣", 4], ["北海道", 4], ["兵庫縣", 3], ["埼玉縣", 3], ["千葉縣", 3], ["京都府", 3], ["沖繩縣", 3],
  ["宮城縣", 2], ["廣島縣", 2], ["靜岡縣", 2], ["新潟縣", 2], ["長野縣", 2], ["岡山縣", 2], ["熊本縣", 2], ["鹿兒島縣", 2], ["長崎縣", 2], ["岐阜縣", 2], ["三重縣", 2], ["滋賀縣", 2], ["奈良縣", 2],
  ["青森縣", 1], ["岩手縣", 1], ["秋田縣", 1], ["山形縣", 1], ["福島縣", 1], ["茨城縣", 1], ["栃木縣", 1], ["群馬縣", 1], ["富山縣", 1], ["石川縣", 1], ["福井縣", 1], ["山梨縣", 1], ["和歌山縣", 1], ["鳥取縣", 1], ["島根縣", 1],
  ["山口縣", 1], ["德島縣", 1], ["香川縣", 1], ["愛媛縣", 1], ["高知縣", 1], ["佐賀縣", 1], ["大分縣", 1], ["宮崎縣", 1],
];
const OVERSEAS_FOR_JP = ["夏威夷檀香山", "巴西聖保羅", "台北", "首爾", "紐約", "洛杉磯", "雪梨", "巴黎"];
const BIRTH_BY_STYLE: Record<Exclude<Style, "jp" | "stage">, string[]> = {
  kr: ["首爾", "釜山", "仁川", "大邱", "光州", "大田"],
  cn: ["台北", "高雄", "台中", "上海", "北京", "香港", "新加坡", "廣州", "成都"],
  west: ["紐約", "洛杉磯", "倫敦", "巴黎", "柏林", "雪梨", "多倫多", "聖保羅", "馬德里", "羅馬", "斯德哥爾摩", "墨爾本", "溫哥華", "墨西哥城"],
};

interface Slot {
  /** 例：t|singer|007 或 g|idol|03 */
  key: string;
  kind: "talent" | "group";
  area: string;
  idx: number;
  style?: Style;
  birthplace?: string;
  ageBand?: AgeBand;
  gender?: "女性" | "男性";
  traits?: string[];
  seed?: string; // 團體的概念種子
}

const pad = (n: number, w = 3): string => String(n).padStart(w, "0");

function planTalentSlots(area: TalentArea): Slot[] {
  const r = rng(0xc01d1e + TALENT_AREAS.indexOf(area) * 7919);
  const spec = TALENT_AREA_SPEC[area];
  const n = ROSTER_COVERAGE.perArea;
  // 年代：照權重配額
  const ages: AgeBand[] = [];
  for (const a of AGE_BANDS) for (let i = 0; i < spec.ages[a]; i++) ages.push(a);
  while (ages.length < n) ages.push("20s");
  const styles: Style[] = [];
  for (const [s, c] of STYLE_QUOTA) for (let i = 0; i < c; i++) styles.push(s);
  const agesSh = shuffle(ages.slice(0, n), r);
  const stylesSh = shuffle(styles.slice(0, n), r);
  const useCount = new Map<string, number>(spec.tags.map((t) => [t.id, 0]));
  const conflicts = TALENT_TRAIT_CONFLICTS[area] ?? [];
  const bad = (a: string, b: string): boolean => conflicts.some((g) => g.includes(a) && g.includes(b));
  // 樂團：角色配額
  const roleQuota: string[] = [];
  if (area === "band") {
    const q: [string, number][] = [["vocal", 22], ["guitar", 28], ["bass", 18], ["drums", 18], ["keys", 14]];
    for (const [t, c] of q) for (let i = 0; i < c; i++) roleQuota.push(t);
  }
  const roles = shuffle(roleQuota, r);
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const want = r() < 0.4 ? 3 : 2;
    const traits: string[] = [];
    if (area === "band") {
      traits.push(roles[i]!);
      useCount.set(roles[i]!, (useCount.get(roles[i]!) ?? 0) + 1);
    }
    let guard = 0;
    while (traits.length < want && guard++ < 50) {
      const cand = spec.tags
        .map((t) => t.id)
        .filter((id) => !traits.includes(id) && !traits.some((x) => bad(x, id)) && !(area === "band" && BAND_ROLE_TAGS.includes(id)));
      if (!cand.length) break;
      // 用得少的優先，帶一點隨機
      const scored = cand.map((id) => [id, (useCount.get(id) ?? 0) + r() * 4] as const).sort((a, b) => a[1] - b[1]);
      const pick = scored[0]![0];
      traits.push(pick);
      useCount.set(pick, (useCount.get(pick) ?? 0) + 1);
    }
    if (area === "band" && traits.includes("screamer") && !traits.includes("vocal")) {
      // 嘶吼一定是主唱角色：把樂器角色換成主唱
      traits[0] = "vocal";
    }
    const style = stylesSh[i]!;
    let birthplace: string;
    if (style === "jp" || style === "stage") birthplace = r() < 0.9 ? pickWeighted(PREFECTURES, r) : OVERSEAS_FOR_JP[Math.floor(r() * OVERSEAS_FOR_JP.length)]!;
    else birthplace = BIRTH_BY_STYLE[style][Math.floor(r() * BIRTH_BY_STYLE[style].length)]!;
    out.push({ key: `t|${area}|${pad(i + 1)}`, kind: "talent", area, idx: i + 1, style, birthplace, ageBand: agesSh[i]!, gender: r() < 0.5 ? "女性" : "男性", traits });
  }
  return out;
}

const IDOL_SEEDS = ["清純系", "搖滾風格", "復古昭和風", "電子舞曲", "舞蹈競技", "地方在地型", "校園主題", "和風", "公主童話風", "硬派帥氣", "療癒系", "運動競技風", "宇宙科幻主題", "動漫聯動", "學姊學妹", "異國風情", "喜劇綜藝路線", "古典樂改編", "街舞", "女僕咖啡廳風", "男女混合", "少年團", "兒童節目出身", "歌劇風"];
const BAND_SEEDS = ["城市流行", "後搖滾", "龐克", "爵士融合", "民謠搖滾", "重金屬", "視覺系", "電子搖滾", "昭和歌謠翻玩", "斯卡", "獨立搖滾", "放克", "音樂劇風搖滾", "器樂演奏", "英式搖滾", "校園輕音", "雷鬼", "動畫歌曲專門", "鄉村", "實驗電子", "硬式搖滾", "藍調", "新浪潮", "舞曲搖滾"];

function planGroupSlots(area: GroupArea): Slot[] {
  const r = rng(0x960f + (area === "idol" ? 1 : 2) * 104729);
  const seeds = area === "idol" ? IDOL_SEEDS : BAND_SEEDS;
  const sh = shuffle(seeds, r);
  const out: Slot[] = [];
  for (let i = 0; i < ROSTER_COVERAGE.groupsPerArea; i++) {
    out.push({ key: `g|${area}|${pad(i + 1, 2)}`, kind: "group", area, idx: i + 1, seed: sh[i % sh.length]! });
  }
  return out;
}

const ALL_SLOTS: Slot[] = [...TALENT_AREAS.flatMap((a) => planTalentSlots(a)), ...GROUP_AREAS.flatMap((a) => planGroupSlots(a))];
const SLOT_BY_KEY = new Map(ALL_SLOTS.map((s) => [s.key, s]));

// ───────── 候選資料與狀態 ─────────
interface Cand {
  uid: number;
  key: string;
  name: string;
  kana?: string;
  persona: string; // 團體則是 concept
  round: number;
}
interface State {
  seq: number;
  uid: number;
  calls: number;
  failedCalls: number;
  spentUsd: number;
  promptTokens: number;
  completionTokens: number;
}
const loadState = (): State => readJson<State>(F.state, { seq: 0, uid: 0, calls: 0, failedCalls: 0, spentUsd: 0, promptTokens: 0, completionTokens: 0 });

function loadPool(): Cand[] {
  const rejected = new Set(Object.keys(readJson<Record<string, string>>(F.rejects, {})).map(Number));
  return readJsonl<Cand>(F.pool).filter((c) => !rejected.has(c.uid));
}

// ───────── 驗證 ─────────
const PERSONA_BAN = /人氣值|能力值|數值|評分|等級|粉絲數|追蹤數|身價|\d|[０-９]|歲|年齡|年收|億|萬人|千人|S級|A級|排名第|第[一二三四五六七八九十]名/;
const PLACE_IN_PERSONA = /東京|大阪|京都|北海道|沖繩|神奈川|愛知|福岡|兵庫|埼玉|千葉|宮城|廣島|靜岡|新潟|長野|岡山|熊本|鹿兒島|長崎|岐阜|三重|滋賀|奈良|青森|岩手|秋田|山形|福島|茨城|栃木|群馬|富山|石川|福井|山梨|和歌山|鳥取|島根|山口|德島|香川|愛媛|高知|佐賀|大分|宮崎|橫濱|名古屋|札幌|仙台|神戶|首爾|釜山|台北|高雄|上海|北京|香港|新加坡|紐約|洛杉磯|倫敦|巴黎|柏林|雪梨|多倫多|聖保羅|馬德里|羅馬|夏威夷|墨爾本|溫哥華/;
const RE_KANJI_NAME = /^[一-鿿々〆ヶ]{2,6}$/;
const RE_JP_NAME = /^(?=.*[一-鿿])[一-鿿々〆ヶぁ-ゖ]{3,6}$/; // 日式姓名：漢字為主，名可以是平假名（例：須藤ふうか）
const RE_KANA = /^[ぁ-ゖー]{1,6} [ぁ-ゖー]{1,6}$/;
const RE_WEST = /^[一-鿿]{1,5}(?:·[一-鿿]{1,5}){1,2}$/;
const RE_STAGE = /^(?:[ァ-ヶー・]{2,10}|[ぁ-ゖー]{2,6}|[A-Za-z][A-Za-z.' -]{1,13}[A-Za-z])$/;
const cpLen = (s: string): number => [...s].length;
/** 模型常在姓與名之間加空格、或把「·」寫成別的符號：先整理成統一寫法再驗證 */
function normName(style: Style | undefined, name: string): string {
  const t = name.trim();
  if (style === "jp" || style === "kr" || style === "cn") return t.replace(/\s+/g, "");
  if (style === "west") return t.replace(/\s*[・･•‧．.]\s*/g, "·").replace(/\s+/g, "");
  return t;
}
/** 假名連續太長的規則（checkText）對團名不適用：片假名團名很自然 */
const kanaFold = (s: string): string => s.replace(/[ぁ-ヿ]+/g, "ア");

function checkTalent(slot: Slot, raw: Record<string, unknown>, pool: Cand[], extra: Cand[]): string | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const persona = typeof raw.persona === "string" ? raw.persona.trim() : "";
  const kana = typeof raw.kana === "string" ? raw.kana.trim() : "";
  if (!name) return "沒有姓名";
  const style = slot.style!;
  if (style === "jp") {
    if (!RE_JP_NAME.test(name) || cpLen(name) > 6) return `日式姓名格式不符「${name}」`;
    if (!RE_KANA.test(kana)) return `讀音格式不符「${kana}」`;
  } else {
    if (kana) return "非日式姓名不該有讀音";
    if (style === "kr" || style === "cn") {
      if (!RE_KANJI_NAME.test(name) || cpLen(name) < 2 || cpLen(name) > 4) return `姓名格式不符「${name}」`;
    } else if (style === "west") {
      if (!RE_WEST.test(name)) return `西洋姓名格式不符「${name}」`;
    } else if (!RE_STAGE.test(name)) return `藝名格式不符「${name}」`;
  }
  const hit = realNameHit(name);
  if (hit) return `撞到真實人物或團體「${hit}」`;
  const nameBad = checkText(kanaFold(name), { min: 1, max: 16, allowPlaces: true });
  if (nameBad) return `姓名：${nameBad}`;
  const all = [...pool, ...extra];
  const taken = all.filter((c) => c.key !== slot.key).find((c) => c.name.replace(/[\s·]/g, "").toLowerCase() === name.replace(/[\s·]/g, "").toLowerCase());
  if (taken) return `姓名重複「${name}」`;
  if (kana) {
    const [sur, giv] = kana.split(" ");
    const others = all.filter((c) => c.kana && c.key !== slot.key);
    if (others.filter((c) => c.kana!.split(" ")[0] === sur).length >= ROSTER_COVERAGE.surnameCap) return `同姓太多「${sur}」`;
    if (others.filter((c) => c.kana!.split(" ")[1] === giv).length >= ROSTER_COVERAGE.givenCap) return `同名太多「${giv}」`;
    if (others.some((c) => c.kana === kana)) return `讀音重複「${kana}」`;
  } else if (style === "kr" || style === "cn") {
    const first = name[0]!;
    const same = all.filter((c) => c.key !== slot.key && SLOT_BY_KEY.get(c.key)?.style === style && c.name[0] === first).length;
    if (same >= 6) return `同姓太多「${first}」`;
  } else if (style === "west") {
    const first = name.split("·")[0]!;
    if (all.filter((c) => c.key !== slot.key && c.name.split("·")[0] === first).length >= 2) return `名字重複「${first}」`;
  }
  const L = cpLen(persona);
  if (L < 10) return "人設太短";
  if (L > ROSTER_COVERAGE.personaMax) return "人設太長";
  const pb = checkText(persona, { min: 10, max: 80, allowPlaces: true });
  if (pb) return `人設：${pb}`;
  if (PERSONA_BAN.test(persona)) return "人設含數字、年齡或數值用語";
  if (PLACE_IN_PERSONA.test(persona)) return "人設寫了出身地（出身另有欄位）";
  const rh = realNameHit(persona);
  if (rh) return `人設提到真實人物或團體「${rh}」`;
  if (/(?:《|》|「[^」]{2,}」)/.test(persona)) return "人設含作品名或引號內名稱";
  if (persona.includes(name)) return "人設不該重複姓名";
  const area = slot.area;
  const sameArea = all.filter((c) => c.key !== slot.key && SLOT_BY_KEY.get(c.key)?.area === area && SLOT_BY_KEY.get(c.key)?.kind === "talent");
  for (const c of sameArea) if (textSimilarity(persona, c.persona) >= 0.45) return `人設與同領域太像「${c.persona.slice(0, 12)}…」`;
  const op = persona.slice(0, 3);
  if (sameArea.filter((c) => c.persona.slice(0, 3) === op).length >= 6) return `人設開頭集中「${op}」`;
  return null;
}

function checkGroup(slot: Slot, raw: Record<string, unknown>, pool: Cand[], extra: Cand[]): string | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const concept = typeof raw.concept === "string" ? raw.concept.trim() : "";
  if (!name) return "沒有團名";
  if (cpLen(name) < 2 || cpLen(name) > 18) return "團名長度不符";
  if (!/^[一-鿿々ぁ-ゖァ-ヶー·・A-Za-z' &.-]+$/.test(name)) return `團名含不允許的字元「${name}」`;
  if (/\d|[０-９]/.test(name)) return "團名不要用數字";
  const hit = realNameHit(name);
  if (hit) return `撞到真實團體「${hit}」`;
  const nb = checkText(kanaFold(name), { min: 1, max: 20, allowPlaces: true });
  if (nb) return `團名：${nb}`;
  const all = [...pool, ...extra].filter((c) => c.key !== slot.key);
  if (all.some((c) => c.name.replace(/\s/g, "").toLowerCase() === name.replace(/\s/g, "").toLowerCase())) return `團名重複「${name}」`;
  const L = cpLen(concept);
  if (L < 10) return "概念太短";
  if (L > ROSTER_COVERAGE.personaMax) return "概念太長";
  const cb = checkText(concept, { min: 10, max: 80, allowPlaces: true });
  if (cb) return `概念：${cb}`;
  if (PERSONA_BAN.test(concept)) return "概念含數字或數值用語";
  const rh = realNameHit(concept);
  if (rh) return `概念提到真實人物或團體「${rh}」`;
  if (/(?:《|》)/.test(concept)) return "概念含作品名";
  for (const c of all.filter((x) => SLOT_BY_KEY.get(x.key)?.kind === "group" && SLOT_BY_KEY.get(x.key)?.area === slot.area)) if (textSimilarity(concept, c.persona) >= 0.45) return `概念與同類太像「${c.persona.slice(0, 12)}…」`;
  return null;
}

// ───────── 提示詞 ─────────
const SYSTEM = `你是日本娛樂圈的人物設定編輯，替一款繁體中文的商場經營遊戲設計「虛構藝人」。這是遊戲內容，不是真實世界。
鐵則：
1. 所有藝人與團體都是完全虛構的：姓名不可以與任何真實藝人、運動員、政治人物、歷史名人相同或太像，也不要用知名作品、角色、品牌、公司、事務所的名字。
2. 不要寫任何真實的藝人、團體、作品、品牌、公司；不要提其他藝人當比較。
3. 人設是一句話（不超過 40 字）：寫這個人的風格、形象、特點或反差魅力；不要寫年齡、歲數、出身地、任何數字、人氣或能力的數值、排名。
4. 內容健康、正面，不涉及緋聞、疾病、政治、宗教、歧視。
5. 輸出繁體中文（台灣用字）；日式姓名的漢字用日本常用的字形（例如「齋藤」「濱」「澤」寫成繁體或日本舊字形皆可，但不要用簡體字）。
6. 只輸出 JSON，不要任何解釋。`;

const STYLE_HINT: Record<Style, string> = {
  jp: "日式姓名（漢字 3–5 字，姓與名搭配自然，要有變化，不要都用「美」「太」「子」「優」「結」這幾個字；讀音 kana 用平假名，姓與名之間一個半形空格）",
  kr: "韓式姓名（以漢字呈現，例如三個字，姓常見金李朴崔鄭等，但每個人要不同；不要 kana）",
  cn: "華語姓名（兩到四個漢字；不要 kana）",
  west: "西洋姓名（用中文音譯，名與姓用「·」分隔，例如「艾蜜莉·卡特」格式；不要 kana）",
  stage: "藝名（片假名、平假名或英文字母皆可，2–8 字，像出道用的藝名或單名；不要 kana 欄位）",
};

function buildTalentPrompt(area: TalentArea, slots: Slot[], avoid: string[]): { role: "system" | "user"; content: string }[] {
  const spec = TALENT_AREA_SPEC[area];
  const tagMap = new Map(spec.tags.map((t) => [t.id, t]));
  const lines = slots.map((s, i) => {
    const traitText = s.traits!.map((t) => `${tagMap.get(t)!.label}（${tagMap.get(t)!.desc}）`).join("、");
    const initials = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ";
    const pick = (): string => initials[Math.floor(Math.random() * initials.length)]!;
    const hint = s.style === "jp" ? `（姓的讀音建議以「${pick()}」開頭、名的讀音建議以「${pick()}」開頭；實在不合適可換，但不要用常見大姓如佐藤、鈴木、田中、高橋、渡邊、伊藤）` : "";
    return `${i + 1}. ${s.gender}｜${s.ageBand!.replace("s", "")}歲上下年代｜姓名風格：${STYLE_HINT[s.style!]}${hint}｜特質：${traitText}`;
  });
  const user = `領域：${spec.label}（${spec.desc}）。請為下列每一位設計姓名與一句人設。年代只是讓你把握形象（不要寫出來）；出身地不用你寫。
特質請自然融入人設；若兩個特質看起來有點衝突，就把它寫成這個人的反差魅力。每個人的設定要明顯不同，不要重複同樣的句式。
${avoid.length ? `已經用過的姓名（不可重複，也不要太像）：${avoid.join("、")}\n` : ""}
${lines.join("\n")}

輸出格式：{"items":[{"n":1,"name":"姓名","kana":"日式姓名才填的平假名讀音","persona":"一句人設"}, ...]}，n 對應上面的編號，共 ${slots.length} 筆。`;
  return [{ role: "system", content: SYSTEM }, { role: "user", content: user }];
}

function buildGroupPrompt(area: GroupArea, slots: Slot[], avoid: string[]): { role: "system" | "user"; content: string }[] {
  const label = area === "idol" ? "偶像團體" : "樂團";
  const lines = slots.map((s, i) => `${i + 1}. 風格種子：${s.seed}`);
  const user = `請設計 ${slots.length} 個虛構的${label}：每個團體有團名與一句團體概念（不超過 40 字，寫音樂或舞台風格、形象、定位，不要寫成員人數、結成年份或任何數字）。
團名 2–12 字，可用漢字、片假名、平假名或英文字母，要有辨識度，不要與任何真實${label}同名或相似，不要用知名作品或品牌名。每個團體風格要明顯不同。
${avoid.length ? `已經用過的團名（不可重複）：${avoid.join("、")}\n` : ""}
${lines.join("\n")}

輸出格式：{"items":[{"n":1,"name":"團名","concept":"團體概念"}, ...]}，n 對應上面的編號，共 ${slots.length} 筆。`;
  return [{ role: "system", content: SYSTEM }, { role: "user", content: user }];
}

// ───────── 生成 ─────────
interface Job {
  id: string;
  kind: "talent" | "group";
  area: string;
  slots: Slot[];
}
const CHUNK = 20;
function planJobs(pool: Cand[], only?: RegExp): Job[] {
  const filled = new Set(pool.map((c) => c.key));
  const open = ALL_SLOTS.filter((s) => !filled.has(s.key) && (!only || only.test(s.key)));
  const byGroup = new Map<string, Slot[]>();
  for (const s of open) byGroup.set(`${s.kind}|${s.area}`, [...(byGroup.get(`${s.kind}|${s.area}`) ?? []), s]);
  const jobs: Job[] = [];
  for (const [g, slots] of byGroup) {
    for (let i = 0; i < slots.length; i += CHUNK) {
      const part = slots.slice(i, i + CHUNK);
      jobs.push({ id: `${g}#${part[0]!.idx}`, kind: part[0]!.kind, area: part[0]!.area, slots: part });
    }
  }
  return jobs;
}

interface Rej {
  key: string;
  name: string;
  reason: string;
  persona?: string;
  round: number;
  job: string;
}

function intake(job: Job, items: unknown[], pool: Cand[], round: number, state: State): { added: Cand[]; rejected: Rej[] } {
  const added: Cand[] = [];
  const rejected: Rej[] = [];
  const used = new Set<number>();
  for (const it of items) {
    if (typeof it !== "object" || it === null) continue;
    const raw = it as Record<string, unknown>;
    const n = Number(raw.n);
    if (!Number.isInteger(n) || n < 1 || n > job.slots.length || used.has(n)) continue;
    used.add(n);
    const slot = job.slots[n - 1]!;
    if (slot.kind === "talent") raw.name = normName(slot.style, String(raw.name ?? ""));
    else raw.name = String(raw.name ?? "").trim();
    const reason = slot.kind === "talent" ? checkTalent(slot, raw, pool, added) : checkGroup(slot, raw, pool, added);
    const name = String(raw.name ?? "").trim();
    const persona = String((slot.kind === "talent" ? raw.persona : raw.concept) ?? "").trim();
    if (reason) {
      rejected.push({ key: slot.key, name, reason, persona, round, job: job.id });
      continue;
    }
    const cand: Cand = { uid: ++state.uid, key: slot.key, name, persona, round };
    if (slot.kind === "talent" && slot.style === "jp") cand.kana = String(raw.kana).trim();
    added.push(cand);
  }
  return { added, rejected };
}

async function runGen(): Promise<void> {
  const key = process.env.OPENROUTER_TEST_KEY;
  if (!key) throw new Fatal("沒有設定 OPENROUTER_TEST_KEY");
  const maxUsd = Number(flag("max-usd", "0.1"));
  const rounds = Number(flag("rounds", "3"));
  const conc = Math.max(1, Number(flag("conc", "4")));
  const only = flag("only") ? new RegExp(flag("only")!) : undefined;
  const state = loadState();

  for (let round = 1; round <= rounds; round++) {
    const pool0 = loadPool();
    const jobs = planJobs(pool0, only);
    const total = jobs.reduce((a, j) => a + j.slots.length, 0);
    console.log(`\n── 第 ${round}/${rounds} 輪：${jobs.length} 個批次、${total} 個空缺；已花 $${state.spentUsd.toFixed(4)}／上限 $${maxUsd}`);
    if (!jobs.length) {
      console.log("沒有空缺了。");
      return;
    }
    if (has("dry")) {
      for (const j of jobs) console.log(`  ${j.id} ×${j.slots.length}`);
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
        if (state.spentUsd + (inflight + 1) * avg() * 1.15 > maxUsd) {
          if (!stop) console.log(`達到預算上限（已花 $${state.spentUsd.toFixed(4)}，單次約 $${avg().toFixed(4)}），停止派發。`);
          stop = true;
          return;
        }
        inflight++;
        try {
          const cur = loadPool();
          const talentsNow = cur.filter((c) => SLOT_BY_KEY.get(c.key)?.kind === "talent");
          // 非日式姓名容易撞名撞姓：把已用過的全列給模型，並點名已經滿額的姓
          const nonJp = talentsNow.filter((c) => !c.kana).map((c) => c.name);
          const firstCount = new Map<string, number>();
          for (const n of nonJp) if (/^[一-鿿]/.test(n)) firstCount.set(n[0]!, (firstCount.get(n[0]!) ?? 0) + 1);
          const fullSurnames = [...firstCount.entries()].filter(([, v]) => v >= 3).map(([k]) => k);
          const avoid = [...talentsNow.filter((c) => !!c.kana).map((c) => c.name).slice(-60), ...nonJp];
          if (fullSurnames.length) avoid.push(`（以下姓氏已滿額，非日式姓名請勿再用：${fullSurnames.join("")}）`);
          const prompt = j.kind === "talent" ? buildTalentPrompt(j.area as TalentArea, j.slots, avoid) : buildGroupPrompt(j.area as GroupArea, j.slots, cur.filter((c) => SLOT_BY_KEY.get(c.key)?.kind === "group").map((c) => c.name));
          let items: unknown[] | null = null;
          for (let attempt = 1; attempt <= 4 && items === null; attempt++) {
            try {
              const r = await chat({ apiKey: key, model: MODEL, messages: prompt, maxTokens: 4500, temperature: 0.95, json: true, timeoutMs: 120_000 });
              state.calls++;
              state.spentUsd += r.costUsd ?? 0.003;
              state.promptTokens += r.promptTokens;
              state.completionTokens += r.completionTokens;
              state.seq++;
              writeJson(F.state, state);
              fs.writeFileSync(path.join(DIR, "raw", `${String(state.seq).padStart(5, "0")}_${j.id.replace(/[^\w#-]/g, "_")}.json`), JSON.stringify({ job: j.id, round, costUsd: r.costUsd, tokens: [r.promptTokens, r.completionTokens], finish: r.finishReason, text: r.text }, null, 1));
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
          const res = intake(j, items, fresh, round, state);
          writeJson(F.state, state);
          appendJsonl(F.pool, res.added);
          appendJsonl(F.auto, res.rejected.map((x) => ({ ...x })));
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
    console.log(`第 ${round} 輪完成：新增 ${totalAdded} 筆；累計 $${state.spentUsd.toFixed(4)}，${state.calls} 次呼叫`);
    if (stop) return;
  }
}

// ───────── 審核流程 ─────────
const slotOrder = (c: Cand): string => {
  const s = SLOT_BY_KEY.get(c.key)!;
  return `${s.kind === "talent" ? 0 : 1}|${s.kind === "talent" ? TALENT_AREAS.indexOf(s.area as TalentArea) : GROUP_AREAS.indexOf(s.area as GroupArea)}|${pad(s.idx)}`;
};
const traitLabel = (area: string, t: string): string => TALENT_AREA_SPEC[area as TalentArea]?.tags.find((x) => x.id === t)?.label ?? t;

function cmdDump(): void {
  const pool = loadPool();
  const reviewed = new Set(readJson<number[]>(F.reviewed, []));
  const todo = pool.filter((c) => !reviewed.has(c.uid)).sort((a, b) => slotOrder(a).localeCompare(slotOrder(b)));
  const count = Number(flag("count", "120"));
  const batch = todo.slice(0, count);
  const files = fs.readdirSync(path.join(DIR, "dumps")).filter((f) => /^b\d+\.json$/.test(f));
  const no = files.length + 1;
  writeJson(path.join(DIR, "dumps", `b${no}.json`), batch.map((c) => c.uid));
  console.log(`# 第 ${no} 批（${batch.length} 筆；全庫待審還有 ${todo.length - batch.length} 筆）`);
  let last = "";
  batch.forEach((c, i) => {
    const s = SLOT_BY_KEY.get(c.key)!;
    const head = `${s.kind}|${s.area}`;
    if (head !== last) {
      console.log(`## ${s.kind === "talent" ? TALENT_AREA_SPEC[s.area as TalentArea].label : s.area === "idol" ? "偶像團體" : "樂團"}`);
      last = head;
    }
    if (s.kind === "talent") console.log(`${i + 1}▸ ${c.name}${c.kana ? `（${c.kana}）` : ""}｜${s.birthplace}｜${s.ageBand}｜${s.traits!.map((t) => traitLabel(s.area, t)).join("、")}｜${c.persona}`);
    else console.log(`${i + 1}▸ ${c.name}｜${c.persona}`);
  });
}

function cmdApply(): void {
  const no = Number(argv[1]);
  const uids = readJson<number[]>(path.join(DIR, "dumps", `b${no}.json`), []);
  if (!uids.length) throw new Fatal(`找不到第 ${no} 批`);
  const file = flag("file");
  const rejects = readJson<Record<string, string>>(F.rejects, {});
  let n = 0;
  if (file) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (!m) continue;
      const uid = uids[Number(m[1]) - 1];
      if (uid === undefined) throw new Fatal(`編號 ${m[1]} 超出範圍`);
      rejects[String(uid)] = m[2]!.trim();
      n++;
    }
  }
  const reviewed = new Set(readJson<number[]>(F.reviewed, []));
  for (const u of uids) reviewed.add(u);
  writeJson(F.reviewed, [...reviewed]);
  writeJson(F.rejects, rejects);
  console.log(`第 ${no} 批：${uids.length} 筆已審；剔除 ${n} 筆（累計 ${Object.keys(rejects).length} 筆）`);
}

function cmdStats(): void {
  const state = loadState();
  const pool = loadPool();
  const auto = readJsonl<Rej>(F.auto);
  const rejects = readJson<Record<string, string>>(F.rejects, {});
  console.log(`花費 $${state.spentUsd.toFixed(4)}；呼叫 ${state.calls} 次（失敗 ${state.failedCalls}）`);
  for (const a of TALENT_AREAS) console.log(`  ${a}：${pool.filter((c) => SLOT_BY_KEY.get(c.key)?.area === a && SLOT_BY_KEY.get(c.key)?.kind === "talent").length}／${ROSTER_COVERAGE.perArea}`);
  for (const a of GROUP_AREAS) console.log(`  團體 ${a}：${pool.filter((c) => SLOT_BY_KEY.get(c.key)?.area === a && SLOT_BY_KEY.get(c.key)?.kind === "group").length}／${ROSTER_COVERAGE.groupsPerArea}`);
  const reasons = new Map<string, number>();
  for (const r of auto) {
    const k = r.reason.split("「")[0]!.slice(0, 16);
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  console.log(`自動拒收 ${auto.length}：`, [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("；"));
  const mr = new Map<string, number>();
  for (const v of Object.values(rejects)) mr.set(v.slice(0, 14), (mr.get(v.slice(0, 14)) ?? 0) + 1);
  console.log(`人工剔除 ${Object.keys(rejects).length}：`, [...mr.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("；"));
}

function cmdBuild(): void {
  const pool = loadPool();
  const reviewed = new Set(readJson<number[]>(F.reviewed, []));
  const unreviewed = pool.filter((c) => !reviewed.has(c.uid));
  if (unreviewed.length && !has("allow-unreviewed")) throw new Fatal(`還有 ${unreviewed.length} 筆沒審，不能 build`);
  const byKey = new Map(pool.map((c) => [c.key, c]));
  const talents: Talent[] = [];
  const groups: TalentGroup[] = [];
  const missing: string[] = [];
  for (const s of ALL_SLOTS) {
    const c = byKey.get(s.key);
    if (!c) {
      missing.push(s.key);
      continue;
    }
    if (s.kind === "talent") {
      const t: Talent = { id: `${s.area}-${pad(s.idx)}`, area: s.area as TalentArea, name: c.name, ...(c.kana ? { kana: c.kana } : {}), birthplace: s.birthplace!, ageBand: s.ageBand!, persona: c.persona, traits: s.traits! };
      talents.push(t);
    } else groups.push({ id: `grp-${s.area}-${pad(s.idx, 2)}`, area: s.area as GroupArea, name: c.name, concept: c.persona });
  }
  if (missing.length) console.log(`還有 ${missing.length} 個空缺：${missing.slice(0, 10).join("、")}…`);
  const out: RosterFile = { talents, groups };
  const dest = path.resolve(flag("out") ?? path.join(DIR, "roster.data.json"));
  fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
  console.log(`已寫入 ${dest}：藝人 ${talents.length} 人、團體 ${groups.length} 個`);
}

/** 列出還空著的位置與它們的條件（預算用完時，由人手動補寫） */
function cmdOpen(): void {
  const filled = new Set(loadPool().map((c) => c.key));
  for (const s of ALL_SLOTS.filter((x) => !filled.has(x.key))) {
    if (s.kind === "talent") console.log(`${s.key}｜${s.style}｜${s.gender}｜${s.ageBand}｜${s.birthplace}｜${s.traits!.map((t) => traitLabel(s.area, t)).join("、")}`);
    else console.log(`${s.key}｜風格種子：${s.seed}`);
  }
}

/** 把人手寫的內容（JSON 陣列 [{key,name,kana?,persona}]）過同一套自動驗證後放進候選池 */
function cmdManual(): void {
  const file = flag("file");
  if (!file) throw new Fatal("需要 --file");
  const state = loadState();
  const rows = readJson<{ key: string; name: string; kana?: string; persona: string }[]>(file, []);
  for (const r of rows) {
    const slot = SLOT_BY_KEY.get(r.key);
    if (!slot) throw new Fatal(`沒有這個位置 ${r.key}`);
    const pool = loadPool();
    if (pool.some((c) => c.key === r.key)) throw new Fatal(`${r.key} 已經有人了`);
    const raw: Record<string, unknown> = slot.kind === "talent" ? { name: r.name, kana: r.kana ?? "", persona: r.persona } : { name: r.name, concept: r.persona };
    const reason = slot.kind === "talent" ? checkTalent(slot, raw, pool, []) : checkGroup(slot, raw, pool, []);
    if (reason) {
      console.log(`✗ ${r.key} ${r.name}：${reason}`);
      continue;
    }
    const cand: Cand = { uid: ++state.uid, key: r.key, name: r.name, persona: r.persona, round: 99, ...(r.kana ? { kana: r.kana } : {}) };
    appendJsonl(F.pool, [cand]);
    console.log(`✓ ${r.key} ${r.name}`);
  }
  writeJson(F.state, state);
}

async function cmdCheck(): Promise<void> {
  const key = process.env.OPENROUTER_TEST_KEY;
  if (!key) throw new Fatal("沒有設定 OPENROUTER_TEST_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
  const j = (await res.json()) as { data?: { usage?: number; limit?: number | null } };
  console.log(`金鑰用量 $${j.data?.usage ?? "?"}／上限 ${j.data?.limit ?? "?"}`);
}

async function main(): Promise<void> {
  if (cmd === "gen") await runGen();
  else if (cmd === "dump") cmdDump();
  else if (cmd === "apply") cmdApply();
  else if (cmd === "stats") cmdStats();
  else if (cmd === "open") cmdOpen();
  else if (cmd === "manual") cmdManual();
  else if (cmd === "build") cmdBuild();
  else if (cmd === "check") await cmdCheck();
  else console.log("指令：gen | dump | apply <批號> | stats | build | check（見檔案開頭說明）");
}
main().catch((e) => {
  console.error(e instanceof Fatal ? e.message : e);
  process.exitCode = 1;
});
