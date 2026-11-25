// 試跑 AI 內容生成並把結果印出來審稿（不碰正式資料庫）。
// 用法：npx tsx --env-file=.env --tsconfig tsconfig.json server/src/ai/preview.ts [brand,dish,regular] [輪數]
// 會把 DB_PATH 指定的資料庫複製到暫存位置再跑，所以內容池與核准狀態都不會動到正式資料；
// 但呼叫是真的：花費會在結束時記進正式資料庫的預算帳本（purpose 前綴 preview:），之後的預算計算才不會少算。
// 加 --no-record 可以不記（例如拿測試資料庫試跑）。
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATEGORY_BY_ID } from "@coidle/shared";
import { loadConfig } from "../config";
import { openDb } from "../db/db";
import { Repo } from "../db/repo";
import { chat } from "./openrouter";
import { ContentService, type ChatFn, type ContentKind } from "./service";
import { checkBrand, checkDish, checkRegular } from "./content";

const config = loadConfig();
const src = config.dbPath;
const dir = mkdtempSync(join(tmpdir(), "coidle-ai-preview-"));
const copy = join(dir, "preview.db");
try {
  copyFileSync(src, copy);
} catch {
  // 沒有現成的資料庫就用空的
}
const repo = new Repo(openDb(copy));
// 預覽時一律不自動上線（所有東西都停在 pending／active 的原始狀態供審稿）
// 包一層：把模型原始輸出留下來，被拒收的項目可以對照原因檢查
let lastRaw = "";
const spy: ChatFn = async (o) => {
  const r = await chat(o);
  lastRaw = r.text;
  return r;
};
const svc = new ContentService(repo, { ...config.ai, autoApproveEvents: false }, Date.now, spy);
const kinds = (process.argv[2] ?? "brand,dish,regular").split(",") as ContentKind[];
const rounds = Number(process.argv[3] ?? 1);
const usd = (n: number) => `$${n.toFixed(4)}`;

if (!svc.enabled) {
  console.error("沒有設定 OPENROUTER_API_KEY，無法試跑");
  process.exit(1);
}
const startedAt = Date.now();
const b0 = svc.budget();
console.log(`模型 ${config.ai.model}；預算已花 ${usd(b0.spentUsd)}／上限 ${usd(b0.capUsd)}；今日呼叫 ${b0.calls24h} 次\n`);

let spent = 0;
for (let round = 0; round < rounds; round++) {
  for (const kind of kinds) {
    const r = await svc.generate(kind);
    spent += r.costUsd;
    console.log(`== ${kind} 第 ${round + 1} 輪：收 ${r.accepted}／要 ${r.asked}，花費 ${usd(r.costUsd)}${r.error ? `，訊息：${r.error}` : ""}`);
    if (r.rejected.length) {
      console.log("   拒收原因：", [...new Set(r.rejected)].join("；"));
      try {
        const items = (JSON.parse(lastRaw.slice(lastRaw.indexOf("{"), lastRaw.lastIndexOf("}") + 1)) as { items?: unknown[] }).items ?? [];
        const check = kind === "brand" ? checkBrand : kind === "dish" ? checkDish : kind === "regular" ? checkRegular : null;
        for (const it of items) {
          const c = check?.(it);
          if (c && !c.ok) console.log(`     ✗ ${c.reason}：${JSON.stringify(it).slice(0, 160)}`);
        }
      } catch {
        // 原始輸出不是乾淨的 JSON 就不印
      }
    }
  }
}

console.log("\n──────── 審稿內容 ────────");
for (const kind of kinds) {
  for (const it of repo.contentList(kind, null, 200).reverse()) {
    const p = it.payload as Record<string, unknown> & { stories?: { title: string; text: string }[]; traits?: string[] };
    if (kind === "brand") console.log(`[品牌/${p.category ?? "舊格式"}=${CATEGORY_BY_ID[String(p.category)]?.name ?? ""}] ${p.name}｜${p.blurb}`);
    else if (kind === "dish") console.log(`[商品名/${p.category ?? "舊格式"}=${CATEGORY_BY_ID[String(p.category)]?.name ?? ""}] ${p.name}`);
    else if (kind === "regular") {
      console.log(`\n[常客/${it.status}] ${p.name}（${p.persona}・愛 ${p.fav}=${CATEGORY_BY_ID[String(p.fav)]?.name}${p.alt ? `、次選 ${p.alt}=${CATEGORY_BY_ID[String(p.alt)]?.name}` : ""}・預算 ${p.budget}）`);
      console.log(`  線索：${p.hint}\n  簡介：${p.bio}\n  特質：${p.traits?.join("、")}`);
      for (const s of p.stories ?? []) console.log(`  故事《${s.title}》${s.text}`);
    }
  }
}
const b1 = svc.budget();
console.log(`\n這次花費約 ${usd(spent)}；預算已花 ${usd(b1.spentUsd)}／上限 ${usd(b1.capUsd)}`);
console.log(`（暫存資料庫：${copy}）`);

// 把這次的花費記進正式帳本（只記帳本，不動內容池）
if (!process.argv.includes("--no-record") && existsSync(src)) {
  const rows = repo.ledgerRecent(500).filter((r) => r.ts >= startedAt);
  if (rows.length > 0) {
    const real = new Repo(openDb(src));
    for (const r of rows) real.addLedger({ ts: r.ts, purpose: `preview:${r.purpose}`, model: r.model, promptTokens: 0, completionTokens: 0, costUsd: r.cost_usd, ok: r.ok === 1, note: r.note ?? undefined });
    console.log(`已把 ${rows.length} 筆呼叫（${usd(rows.reduce((a, r) => a + r.cost_usd, 0))}）記進正式預算帳本。`);
  }
}
