import { TAG_BY_ID } from "./workshop";
import type { CategoryGroup, PlayInput } from "./types";

// 研發小遊戲：每個工坊群組（餐飲／零售／娛樂／服務）都有一套三段式的「做」——
//   ① 備料／打樣／編排／流程（排順序）  ② 烹調／試作／彩排／演練（節奏或穩定度的操作）  ③ 調味／規格／調校／組合（微調特性，推理）。
// 關卡由「關卡種子」＋群組＋難度決定（純函式），所以：
//  - client 用同樣的函式畫出關卡，把玩家的輸入（點擊時間、位置序列、排列順序）送給伺服器；
//  - 伺服器用同一份關卡重新計分，只認算出來的分數，再把它轉成**有上限**的加成；
//  - 引擎仍然只認 tick：小遊戲只在 client 即時玩，結果在「開始研發」那一刻以指令提交，之後離線照常結算。
// 加成有上限、不玩也能開始（沒有加成），所以偽造輸入頂多拿到上限，不會破壞平衡。

export type PlayKind = "sequence" | "rhythm" | "hold";

export interface PlayStageDef {
  id: "prep" | "act" | "tweak";
  label: string;
  icon: string;
  desc: string;
}
export interface PlayGroupDef {
  prep: PlayStageDef & { steps: string[] };
  act: PlayStageDef & { kinds: PlayKind[]; actions: Record<PlayKind, string> };
  tweak: PlayStageDef;
}

export const PLAY_GROUPS: Record<CategoryGroup, PlayGroupDef> = {
  food: {
    prep: { id: "prep", label: "備料", icon: "🔪", desc: "耗時越長的工序要越早開始，才不會手忙腳亂。把工序照「先做耗時長的」排好。", steps: ["高湯熬煮", "食材醃漬", "米麵泡發", "醬料調製", "蔬菜清洗", "肉類切片", "油炸預熱", "擺盤備料"] },
    act: { id: "act", label: "烹調", icon: "🔥", desc: "烹調靠手感：跟著節奏下手，或把火力維持在甜蜜點。", kinds: ["rhythm", "hold", "rhythm"], actions: { rhythm: "跟著節奏翻鍋、下鍋", hold: "把火力維持在甜蜜點", sequence: "" } },
    tweak: { id: "tweak", label: "調味", icon: "🧂", desc: "依試味的線索微調：最多動兩個特性（各 ±1）。調錯方向會失衡。" },
  },
  retail: {
    prep: { id: "prep", label: "打樣", icon: "📐", desc: "打樣要先處理最花時間的步驟。照「先做耗時長的」排好。", steps: ["布料裁切", "染色定色", "縫製主體", "細節收邊", "品質檢驗", "吊牌包裝", "配件組裝", "洗滌整燙"] },
    act: { id: "act", label: "試作", icon: "🧵", desc: "試作要穩：跟著節奏下針，或讓機台維持在穩定區間。", kinds: ["hold", "rhythm", "hold"], actions: { rhythm: "跟著節奏縫製、組裝", hold: "讓機台維持在穩定區間", sequence: "" } },
    tweak: { id: "tweak", label: "規格微調", icon: "📏", desc: "依市場的反應微調風格：最多動兩個特性（各 ±1）。" },
  },
  entertainment: {
    prep: { id: "prep", label: "編排", icon: "🗒️", desc: "節目與關卡的編排，先排耗時最長的段落。", steps: ["開場暖身", "主線劇情", "高潮橋段", "互動環節", "音效配樂", "燈光舞台", "彩蛋設計", "收尾謝幕"] },
    act: { id: "act", label: "彩排", icon: "🎶", desc: "彩排最看節奏：跟著拍子，或把現場氣氛維持在最佳區間。", kinds: ["rhythm", "hold", "rhythm"], actions: { rhythm: "跟著拍子彩排", hold: "把氣氛維持在最佳區間", sequence: "" } },
    tweak: { id: "tweak", label: "調校", icon: "🎚️", desc: "依彩排的回饋微調內容：最多動兩個特性（各 ±1）。" },
  },
  service: {
    prep: { id: "prep", label: "流程", icon: "🗂️", desc: "服務流程要先安排最耗時的步驟。", steps: ["諮詢問診", "環境消毒", "器具準備", "主要療程", "輔助護理", "效果確認", "後續衛教", "預約回診"] },
    act: { id: "act", label: "演練", icon: "💆", desc: "演練靠穩定：讓力道維持在舒適區間，或跟著節奏操作。", kinds: ["hold", "rhythm", "hold"], actions: { rhythm: "跟著節奏操作", hold: "讓力道維持在舒適區間", sequence: "" } },
    tweak: { id: "tweak", label: "組合", icon: "🧪", desc: "依試用客的回饋微調組合：最多動兩個特性（各 ±1）。" },
  },
};

// ───────── 關卡 ─────────

export interface SequenceLevel {
  kind: "sequence";
  items: { id: number; label: string; /** 耗時（分鐘）：越長越要先做 */ minutes: number }[];
}
export interface RhythmLevel {
  kind: "rhythm";
  /** 每一拍的時間（毫秒，從開始計） */
  beats: number[];
  /** 判定寬度（毫秒）：偏差超過它就不得分 */
  window: number;
  duration: number;
}
export interface HoldLevel {
  kind: "hold";
  /** 每 step 毫秒取樣一次 */
  step: number;
  /** 各取樣點「甜蜜點」的中心位置（0–100） */
  centers: number[];
  /** 甜蜜點的寬度 */
  width: number;
}
export type PlayLevel = SequenceLevel | RhythmLevel | HoldLevel;

function mix(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 這個關卡種子在某個「關」（0＝排序、1＝操作）用的子種子 */
export function stageSeed(playSeed: number, stage: number): number {
  return mix(playSeed >>> 0, 0x5eed + stage);
}

/** 操作那一關的玩法：由手法素材決定（同一種手法永遠是同一種玩法） */
export function actKind(group: CategoryGroup, methodId: string | undefined): "rhythm" | "hold" {
  const kinds = PLAY_GROUPS[group].act.kinds;
  let h = 0;
  for (const ch of methodId ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const k = kinds[h % kinds.length]!;
  return k === "hold" ? "hold" : "rhythm";
}

/** 難度 0–8：素材等級越高、越難（判定窗口變窄、甜蜜點變窄） */
export function makeLevel(kind: PlayKind, seed: number, group: CategoryGroup, difficulty: number): PlayLevel {
  const r = stream(seed);
  const d = Math.max(0, Math.min(8, difficulty));
  if (kind === "sequence") {
    const steps = PLAY_GROUPS[group].prep.steps.slice();
    const items: SequenceLevel["items"] = [];
    const used = new Set<number>();
    const n = 5;
    while (items.length < n) {
      const i = Math.floor(r() * steps.length);
      if (used.has(i)) continue;
      used.add(i);
      // 耗時不重複，才有唯一答案
      let minutes = 3 + Math.floor(r() * 40);
      while (items.some((x) => x.minutes === minutes)) minutes++;
      items.push({ id: i, label: steps[i]!, minutes });
    }
    return { kind: "sequence", items };
  }
  if (kind === "rhythm") {
    const beats: number[] = [];
    let t = 900;
    for (let i = 0; i < 7; i++) {
      beats.push(Math.round(t));
      t += 520 + Math.floor(r() * 300);
    }
    return { kind: "rhythm", beats, window: Math.round(260 - d * 12), duration: Math.round(t + 600) };
  }
  const centers: number[] = [];
  let c = 35 + r() * 30;
  let v = (r() - 0.5) * 6;
  for (let i = 0; i < 60; i++) {
    v += (r() - 0.5) * 2.2;
    v = Math.max(-3.2, Math.min(3.2, v));
    c += v;
    if (c < 22 || c > 78) v = -v;
    c = Math.max(22, Math.min(78, c));
    centers.push(Math.round(c * 10) / 10);
  }
  return { kind: "hold", step: 100, centers, width: Math.round(28 - d * 1.2) };
}

/** 排序關的正解：耗時長的先做 */
export function sequenceAnswer(level: SequenceLevel): number[] {
  return level.items.slice().sort((a, b) => b.minutes - a.minutes).map((x) => x.id);
}

// ───────── 計分（0–1） ─────────

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function scoreSequence(level: SequenceLevel, inputs: number[]): number {
  const want = sequenceAnswer(level);
  const ids = new Set(want);
  const got = inputs.filter((x, i) => finite(x) && ids.has(x) && inputs.indexOf(x) === i);
  if (got.length < want.length) return 0;
  const pos = new Map(got.map((id, i) => [id, i]));
  let ok = 0;
  let total = 0;
  for (let i = 0; i < want.length; i++) {
    for (let j = i + 1; j < want.length; j++) {
      total++;
      if ((pos.get(want[i]!) ?? 99) < (pos.get(want[j]!) ?? 99)) ok++;
    }
  }
  return total === 0 ? 0 : ok / total;
}

export function scoreRhythm(level: RhythmLevel, inputs: number[]): number {
  const taps = inputs.filter((x) => finite(x) && x >= 0 && x <= level.duration + 2000).slice(0, 40).sort((a, b) => a - b);
  const used = new Set<number>();
  let sum = 0;
  for (const b of level.beats) {
    let best = -1;
    let bd = Infinity;
    taps.forEach((t, i) => {
      const d = Math.abs(t - b);
      if (!used.has(i) && d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0 && bd <= level.window) {
      used.add(best);
      sum += 1 - bd / level.window;
    }
  }
  const extra = Math.max(0, taps.length - used.size);
  return Math.max(0, sum / level.beats.length - 0.03 * Math.max(0, extra - 1));
}

export function scoreHold(level: HoldLevel, inputs: number[]): number {
  const n = level.centers.length;
  let inBand = 0;
  for (let i = 0; i < n; i++) {
    const p = inputs[i];
    if (finite(p) && Math.abs(Math.max(0, Math.min(100, p)) - level.centers[i]!) <= level.width / 2) inBand++;
  }
  return inBand / n;
}

export function scoreStage(level: PlayLevel, inputs: number[]): number {
  const clean = Array.isArray(inputs) ? inputs.slice(0, 80) : [];
  return level.kind === "sequence" ? scoreSequence(level, clean) : level.kind === "rhythm" ? scoreRhythm(level, clean) : scoreHold(level, clean);
}

// ───────── 一次研發的小遊戲結果 ─────────

export const PLAY_WEIGHTS = { prep: 0.4, act: 0.6 } as const;
/** 小遊戲帶來的加成上限：廚藝經驗（技能）最多 +3；調味最多動兩個特性 */
export const PLAY_MAX_BONUS = 3;
export const PLAY_MAX_TWEAK = 2;

export interface PlayResult {
  score: number;
  bonus: number;
  stages: { id: string; score: number }[];
  /** 通過驗證的調味微調 */
  tweak: Record<string, number>;
}

/** 難度 0–8：用到的素材越貴（越稀有）越難。只用公開的素材價格，client 與伺服器算得出一樣的結果 */
export function playDifficulty(costs: number[]): number {
  const sum = costs.reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(8, Math.round((sum - 2000) / 3500)));
}

/** 伺服器與 client 共用：重新算出分數。關卡種子不符、輸入不合法時回傳 null（當作沒玩）。 */
export function scorePlay(group: CategoryGroup, methodId: string | undefined, difficulty: number, playSeed: number, play: PlayInput | undefined): PlayResult | null {
  if (!play || play.seed !== playSeed) return null;
  const stages = Array.isArray(play.stages) ? play.stages : [];
  const find = (id: string) => stages.find((x) => x && x.id === id);
  const prepLevel = makeLevel("sequence", stageSeed(playSeed, 0), group, difficulty);
  const actLevel = makeLevel(actKind(group, methodId), stageSeed(playSeed, 1), group, difficulty);
  const prep = scoreStage(prepLevel, find("prep")?.inputs ?? []);
  const act = scoreStage(actLevel, find("act")?.inputs ?? []);
  const score = prep * PLAY_WEIGHTS.prep + act * PLAY_WEIGHTS.act;
  const bonus = Math.max(0, Math.min(PLAY_MAX_BONUS, Math.floor(score * 3.5)));
  const tags = TAG_BY_ID[group];
  const tweak: Record<string, number> = {};
  let used = 0;
  const rawTweak = play.tweak && typeof play.tweak === "object" ? play.tweak : {};
  for (const [tag, v] of Object.entries(rawTweak)) {
    if (!tags[tag] || (v !== 1 && v !== -1) || used >= PLAY_MAX_TWEAK) continue;
    tweak[tag] = v;
    used++;
  }
  return { score, bonus, stages: [{ id: "prep", score: prep }, { id: "act", score: act }], tweak };
}

/** 調味的簽名（讓「同一組素材、不同微調」算不同的組合） */
export function tweakKey(tweak: Record<string, number> | undefined): string {
  const e = Object.entries(tweak ?? {}).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b));
  return e.length === 0 ? "" : `|${e.map(([k, v]) => `${k}${v > 0 ? "+" : "-"}`).join("")}`;
}

/** 新的關卡種子（只給 client 看；用不同於引擎亂數的鹽，不會洩漏引擎的亂數流） */
export function nextPlaySeed(prev: number, salt: number): number {
  return mix(prev >>> 0, salt >>> 0);
}
