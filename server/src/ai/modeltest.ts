// 用「測試金鑰」比較候選模型（省著用：每個模型只跑一次小任務）。
// 用法：npx tsx --env-file=.env --tsconfig tsconfig.json server/src/ai/modeltest.ts model1,model2,...
import { chat, extractJson, LlmError } from "./openrouter";
import { newsPrompt, reviewPrompt } from "./prompts";
import { checkText } from "./validate";

const key = process.env.OPENROUTER_TEST_KEY;
if (!key) {
  console.error("沒有設定 OPENROUTER_TEST_KEY");
  process.exit(1);
}
const models = (process.argv[2] ?? "").split(",").filter(Boolean);
let total = 0;

for (const model of models) {
  for (const [name, messages, rule] of [
    ["news", newsPrompt(8), { min: 12, max: 70 }],
    ["review", reviewPrompt(6), { min: 15, max: 110, must: ["{shop}"] as string[] }],
  ] as [string, ReturnType<typeof newsPrompt>, { min: number; max: number; must?: string[] }][]) {
    try {
      const r = await chat({ apiKey: key, model, messages: [...messages], maxTokens: 900, json: true });
      total += r.costUsd ?? 0;
      let items: { text?: unknown }[] = [];
      let parseErr = "";
      try {
        const j = extractJson(r.text) as { items?: { text?: unknown }[] };
        items = Array.isArray(j?.items) ? j.items : [];
      } catch (e) {
        parseErr = e instanceof Error ? e.message : "parse";
      }
      const bad = items.map((x) => checkText(x.text, rule)).filter(Boolean);
      console.log(`\n### ${model} [${name}] ${r.ms}ms  tok in/out/reason=${r.promptTokens}/${r.completionTokens}/${r.reasoningTokens}  cost=$${(r.costUsd ?? NaN).toFixed(5)}  items=${items.length}  rejected=${bad.length}${parseErr ? "  PARSE:" + parseErr : ""}  finish=${r.finishReason}`);
      if (bad.length) console.log("   rejected reasons:", [...new Set(bad)].join("; "));
      for (const it of items.slice(0, 4)) console.log("   -", JSON.stringify(it).slice(0, 150));
    } catch (e) {
      console.log(`\n### ${model} [${name}] FAILED: ${e instanceof LlmError ? e.message : String(e)}`);
    }
  }
}
console.log(`\n本次測試總花費約 $${total.toFixed(4)}`);
