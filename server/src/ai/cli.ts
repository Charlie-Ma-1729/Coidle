// AI 內容管理指令列。用法（需要 .env 裡的 OPENROUTER_API_KEY）：
//   npm run ai -- status
//   npm run ai -- generate news|review|event [數量]
//   npm run ai -- list [news|review|event] [pending|active|retired|rejected]
//   npm run ai -- approve <事件 id>        上線一個待審的 AI 事件
//   npm run ai -- reject <id>              拒絕待審事件／下架已上線事件
//   npm run ai -- remove <id>              移除一則快訊或評價
import { loadConfig } from "../config";
import { openDb } from "../db/db";
import { Repo } from "../db/repo";
import { ContentService, type ContentKind } from "./service";

try {
  process.loadEnvFile();
} catch {
  // 沒有 .env
}
const config = loadConfig();
const repo = new Repo(openDb(config.dbPath));
const svc = new ContentService(repo, config.ai);
const [cmd, a, b] = process.argv.slice(2);
const usd = (n: number) => `$${n.toFixed(4)}`;

function status(): void {
  const bd = svc.budget();
  console.log(`AI 內容：${svc.enabled ? "已啟用" : "未啟用（沒有金鑰）"}　模型：${config.ai.model}`);
  console.log(`預算視窗：${new Date(bd.windowStart).toISOString()} → ${new Date(bd.windowEnd).toISOString()}`);
  console.log(`已花 ${usd(bd.spentUsd)}／可用上限 ${usd(bd.capUsd)}（月預算 ${usd(config.ai.budgetUsd)} 的 85%）　剩 ${usd(bd.remainingUsd)}`);
  console.log(`最近 24 小時：${bd.calls24h} 次呼叫、${usd(bd.spent24hUsd)}`);
  console.log(`內容池：快訊 ${repo.contentCount("news", "active")}　評價 ${repo.contentCount("review", "active")}　事件 上線 ${repo.contentCount("event", "active")}／待審 ${repo.contentCount("event", "pending")}`);
  for (const r of repo.ledgerRecent(5)) console.log(`  ${new Date(r.ts).toISOString()}  ${r.purpose.padEnd(6)} ${usd(r.cost_usd)}  ${r.ok ? "ok" : "失敗"}  ${r.note ?? ""}`);
}

switch (cmd) {
  case "status":
    status();
    break;
  case "generate": {
    if (!["news", "review", "event"].includes(a ?? "")) {
      console.error("用法：generate news|review|event [數量]");
      process.exit(1);
    }
    const r = await svc.generate(a as ContentKind, b ? Number(b) : undefined);
    console.log(r.ok ? `完成：收 ${r.accepted}／要 ${r.asked}，花費 ${usd(r.costUsd)}` : `沒有新增內容：${r.error ?? "全部被拒收"}`);
    if (r.rejected.length) console.log("拒收原因：", [...new Set(r.rejected)].join("；"));
    break;
  }
  case "list": {
    for (const it of repo.contentList(a ?? null, b ?? null, 60)) {
      const p = it.payload as { title?: string; text?: string; mood?: string; tier?: string; choice?: { options: { label: string; effects: unknown }[] } };
      console.log(`#${it.id} [${it.kind}/${it.status}] ${p.title ? `《${p.title}》 ` : ""}${p.mood ?? p.tier ?? ""} ${p.text ?? ""}`);
      if (p.choice) for (const o of p.choice.options) console.log(`      - ${o.label} → ${JSON.stringify(o.effects)}`);
    }
    break;
  }
  case "approve":
    console.log(svc.approveEvent(Number(a)) ? "已上線" : "找不到待審的事件");
    break;
  case "reject":
    console.log(svc.rejectEvent(Number(a)) ? "已處理" : "找不到這個事件");
    break;
  case "remove":
    console.log(svc.removeText(Number(a)) ? "已移除" : "找不到這則內容");
    break;
  default:
    console.log("指令：status | generate | list | approve | reject | remove（詳見檔案開頭說明）");
}
