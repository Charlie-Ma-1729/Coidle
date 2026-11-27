// 品牌目錄生成器：一次性離線批次，用 OpenRouter 的 anthropic/claude-haiku-5.5 替每個業態想虛構品牌，
// 驗證、去重後由人（Claude）逐筆審核，最後組成 shared/src/game/brands.generated.json。不在遊戲執行期呼叫。
//
// 用法（在 Windows 鏡像資料夾內執行，金鑰只由 --env-file 載入、絕不印出）：
//   npx tsx --env-file=<專案>\.env --tsconfig tsconfig.json server/src/ai/brandcatalog.ts <指令> [選項]
//
// 指令：
//   gen   --dir <暫存資料夾> [--per 6] [--max-usd 0.3] [--rounds 3] [--only <業態 id 正規式>]
//                          每個業態補到 per 個品牌（平價／一般／高級各一半；手寫的先算進去），可續跑
//   dump  --dir <暫存資料夾> [--count 9999]      依業態列出候選（編號 1..N）供逐筆審核
//   build --dir <暫存資料夾> --out <path> [--drop 3,17,40-45]   把沒被剔除的組成最終 JSON
//   stats --dir <暫存資料夾>                     每個業態數量、拒收原因、花費
//
// 品牌的知名度與品質由程式依定位（tier）決定（同名固定），模型只負責店名與一句簡介。
import fs from "node:fs";
import path from "node:path";
import { CATEGORIES, brandsOfCategory, type BrandTier } from "@coidle/shared";
import { chat, extractJson, LlmError } from "./openrouter";
import { checkBrand } from "./content";
import { textSimilarity } from "./validate";
import { WORLD } from "./prompts";

const MODEL = "anthropic/claude-haiku-5.5";
const TIERS: BrandTier[] = ["budget", "standard", "premium"];
const TIER_ZH: Record<BrandTier, string> = { budget: "平價親民", standard: "一般大眾", premium: "高級精緻" };
const RANGE: Record<BrandTier, { fame: [number, number]; q: [number, number] }> = {
  budget: { fame: [30, 44], q: [0.56, 0.64] },
  standard: { fame: [44, 58], q: [0.66, 0.76] },
  premium: { fame: [58, 72], q: [0.8, 0.9] },
};

interface Cand {
  category: string;
  name: string;
  blurb: string;
  tier: BrandTier;
}
interface Store {
  cands: Cand[];
  rejects: { category: string; name: string; reason: string }[];
  spend: number;
  calls: number;
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
function load(dir: string): Store {
  const f = path.join(dir, "brands.json");
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Store) : { cands: [], rejects: [], spend: 0, calls: 0 };
}
function save(dir: string, s: Store): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "brands.json"), JSON.stringify(s, null, 1));
}
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return h >>> 0;
}
const pick = (key: string, [lo, hi]: [number, number]) => lo + ((hash(key) % 1000) / 1000) * (hi - lo);

const cats = CATEGORIES.filter((c) => !c.facility);

/** 這個業態還缺哪幾種定位（手寫的、已收進來的都先算） */
function missingTiers(store: Store, cat: string, per: number): BrandTier[] {
  const have: Record<BrandTier, number> = { budget: 0, standard: 0, premium: 0 };
  for (const b of brandsOfCategory(cat)) have[b.tier]++;
  for (const c of store.cands.filter((x) => x.category === cat)) have[c.tier]++;
  const goal = Math.ceil(per / 3);
  const out: BrandTier[] = [];
  for (const t of TIERS) for (let i = have[t]; i < goal; i++) out.push(t);
  return out;
}

function prompt(batch: { id: string; name: string; group: string; need: BrandTier[]; avoid: string[] }[]) {
  const GN: Record<string, string> = { food: "餐飲", retail: "零售", entertainment: "娛樂", service: "服務" };
  const list = batch
    .map((c) => `- ${c.id}（${c.name}・${GN[c.group]}）：${c.need.map((t, i) => `#${i + 1}${TIER_ZH[t]}`).join("、")}；避開：${c.avoid.slice(0, 14).join("、") || "（無）"}`)
    .join("\n");
  return [
    { role: "system" as const, content: WORLD },
    {
      role: "user" as const,
      content: `遊戲裡有「連鎖品牌」：同一個品牌會在不同商場開分店，也會出現在招商名單。請替下面每一種店取指定數量的虛構品牌（每個 # 一個），定位決定品牌的價位與氣質：
${list}
規則：
- name：2–8 個字，像日本商店街或在地連鎖的店名（可用季節、職人、物件、地形、動物、吉祥意象，也可以用假名，但不是真實地名），好念好記；同一種店的名字彼此不要太像、不要重複「屋」「堂」同一個字結尾太多次
- blurb：一句簡介，12–35 字，**必須確實是在描述那一種店**（賣的是什麼、有什麼個性），語氣親切，要和定位相符（平價＝實惠快速、高級＝講究職人）
- 不可以用任何真實存在的品牌、連鎖店或企業名字（包含近似的諧音）
- 「避開」後面列的是已經有的名字，不要重複或太像
輸出格式：{"items":[{"category":"上面列的 id","tier":"budget|standard|premium","name":"...","blurb":"..."}]}`,
    },
  ];
}

async function gen(): Promise<void> {
  const key = process.env.OPENROUTER_TEST_KEY;
  if (!key) throw new Error("沒有設定 OPENROUTER_TEST_KEY");
  const dir = arg("dir")!;
  const per = Number(arg("per", "6"));
  const maxUsd = Number(arg("max-usd", "0.3"));
  const rounds = Number(arg("rounds", "3"));
  const only = arg("only") ? new RegExp(arg("only")!) : null;
  const store = load(dir);
  const allNames = () => new Set([...store.cands.map((c) => c.name), ...cats.flatMap((c) => brandsOfCategory(c.id).map((b) => b.name))]);

  for (let r = 1; r <= rounds; r++) {
    const todo = cats.filter((c) => (!only || only.test(c.id)) && missingTiers(store, c.id, per).length > 0);
    if (todo.length === 0) break;
    console.log(`第 ${r} 輪：${todo.length} 個業態有缺`);
    for (let i = 0; i < todo.length; i += 5) {
      if (store.spend >= maxUsd) {
        console.log(`花費已達 $${store.spend.toFixed(4)}，停止`);
        save(dir, store);
        return;
      }
      const slice = todo.slice(i, i + 5);
      const batch = slice.map((c) => ({
        id: c.id,
        name: c.name,
        group: c.group,
        need: missingTiers(store, c.id, per),
        avoid: [...brandsOfCategory(c.id).map((b) => b.name), ...store.cands.filter((x) => x.category === c.id).map((x) => x.name)],
      }));
      try {
        const res = await chat({ apiKey: key, model: MODEL, messages: prompt(batch), maxTokens: 4000, temperature: 0.95, json: true, timeoutMs: 120_000 });
        store.spend += res.costUsd ?? 0.003;
        store.calls++;
        const raw = extractJson(res.text) as { items?: unknown[] } | null;
        const items = Array.isArray(raw?.items) ? raw!.items! : [];
        for (const it of items) {
          const o = it as Record<string, unknown>;
          const chk = checkBrand(o);
          const category = String(o.category ?? "");
          const tier = TIERS.find((t) => t === o.tier);
          const nm = String(o.name ?? "");
          const reject = (reason: string) => store.rejects.push({ category, name: nm, reason });
          if (!chk.ok) { reject(chk.reason); continue; }
          if (!tier) { reject("定位無效"); continue; }
          const need = missingTiers(store, chk.value.category, per);
          if (!need.includes(tier)) { reject("這個定位已經滿了"); continue; }
          if (!batch.some((b) => b.id === chk.value.category)) { reject("不在這批的業態"); continue; }
          const name = chk.value.name;
          if (allNames().has(name)) { reject("與既有品牌同名"); continue; }
          const same = store.cands.filter((x) => x.category === chk.value.category).map((x) => x.name).concat(brandsOfCategory(chk.value.category).map((b) => b.name));
          if (same.some((x) => textSimilarity(x, name) >= 0.6)) { reject("與同業態品牌太像"); continue; }
          if ([...name].length > 12) { reject("店名太長"); continue; }
          store.cands.push({ category: chk.value.category, name, blurb: chk.value.blurb, tier });
        }
        console.log(`  [${slice.map((c) => c.id).join(",")}] 收 ${items.length} 筆，累計花費 $${store.spend.toFixed(4)}`);
      } catch (e) {
        console.log(`  批次失敗：${e instanceof LlmError ? e.message : String(e).slice(0, 80)}`);
      }
      save(dir, store);
    }
  }
  save(dir, store);
  const left = cats.filter((c) => (!only || only.test(c.id)) && missingTiers(store, c.id, per).length > 0);
  console.log(left.length ? `仍有缺：${left.map((c) => `${c.id}(${missingTiers(store, c.id, per).length})`).join(" ")}` : "全部業態都補滿了");
}

function dump(): void {
  const store = load(arg("dir")!);
  let n = 0;
  for (const c of cats) {
    const mine = store.cands.filter((x) => x.category === c.id);
    if (!mine.length) continue;
    console.log(`\n【${c.id}】${c.name}（${c.zone}）`);
    for (const m of mine) console.log(`${++n}. [${m.tier}] ${m.name}｜${m.blurb}`);
  }
}

function build(): void {
  const store = load(arg("dir")!);
  const drop = new Set<number>();
  for (const part of (arg("drop", "") ?? "").split(",").filter(Boolean)) {
    const [a, b] = part.split("-").map(Number);
    for (let i = a!; i <= (b ?? a!); i++) drop.add(i);
  }
  let n = 0;
  const out: unknown[] = [];
  const counter: Record<string, number> = {};
  for (const c of cats) {
    for (const m of store.cands.filter((x) => x.category === c.id)) {
      n++;
      if (drop.has(n)) continue;
      counter[c.id] = (counter[c.id] ?? 0) + 1;
      const rg = RANGE[m.tier];
      out.push({
        id: `${c.id}_g${counter[c.id]}`,
        name: m.name,
        category: c.id,
        tier: m.tier,
        fame: Math.round(pick(m.name + "f", rg.fame)),
        quality: Math.round(pick(m.name + "q", rg.q) * 100) / 100,
        blurb: m.blurb,
      });
    }
  }
  fs.writeFileSync(arg("out")!, JSON.stringify(out, null, 1) + "\n");
  console.log(`寫出 ${out.length} 個品牌（剔除 ${drop.size} 筆）`);
}

function stats(): void {
  const store = load(arg("dir")!);
  console.log(`候選 ${store.cands.length}、拒收 ${store.rejects.length}、呼叫 ${store.calls} 次、花費 $${store.spend.toFixed(4)}`);
  const why: Record<string, number> = {};
  for (const r of store.rejects) why[r.reason] = (why[r.reason] ?? 0) + 1;
  console.log("拒收原因：", why);
}

const cmd = process.argv[2];
void (async () => {
  if (cmd === "gen") await gen();
  else if (cmd === "dump") dump();
  else if (cmd === "build") build();
  else if (cmd === "stats") stats();
  else console.log("指令：gen | dump | build | stats（見檔案開頭說明）");
})().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
