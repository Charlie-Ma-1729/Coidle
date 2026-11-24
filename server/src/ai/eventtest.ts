// 比較模型「設計隨機事件」的能力（結構化輸出＋白名單效果）。用測試金鑰，每個模型一次。
// 用法：npx tsx --env-file=.env --tsconfig tsconfig.json server/src/ai/eventtest.ts model1,model2
import { checkEvent } from "./content";
import { chat, extractJson, LlmError } from "./openrouter";
import { eventPrompt } from "./prompts";

const key = process.env.OPENROUTER_TEST_KEY;
if (!key) {
  console.error("沒有設定 OPENROUTER_TEST_KEY");
  process.exit(1);
}
let total = 0;
for (const model of (process.argv[2] ?? "").split(",").filter(Boolean)) {
  try {
    const r = await chat({ apiKey: key, model, messages: eventPrompt(4, []), maxTokens: 1800, json: true });
    total += r.costUsd ?? 0;
    const j = extractJson(r.text) as { items?: unknown[] };
    const items = Array.isArray(j?.items) ? j.items : [];
    const checked = items.map((x) => checkEvent(x));
    const ok = checked.filter((c) => c.ok).length;
    console.log(`\n### ${model}  ${r.ms}ms  tok in/out=${r.promptTokens}/${r.completionTokens}  cost=$${(r.costUsd ?? NaN).toFixed(5)}  accepted ${ok}/${items.length}`);
    for (const c of checked) {
      if (!c.ok) console.log("   ✗", c.reason);
      else console.log(`   ✓ 《${c.value.title}》 ${c.value.text}\n      ${c.value.choice!.options.map((o) => `[${o.label} → ${JSON.stringify(o.effects)}]`).join("  ")}  默認:${c.value.choice!.defaultOption}`);
    }
  } catch (e) {
    console.log(`\n### ${model} FAILED: ${e instanceof LlmError ? e.message : String(e)}`);
  }
}
console.log(`\n總花費約 $${total.toFixed(4)}`);
