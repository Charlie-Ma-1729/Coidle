#!/usr/bin/env node
// 每日備份：用 SQLite 的 VACUUM INTO 做「執行中也安全」的一致性備份，並只保留最近 N 份。
// 用法：node deploy/backup.mjs   （環境變數：DB_PATH、BACKUP_DIR、BACKUP_KEEP）
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const dbPath = resolve(process.env.DB_PATH ?? "data/coidle.db");
const dir = resolve(process.env.BACKUP_DIR ?? "backups");
const keep = Number(process.env.BACKUP_KEEP ?? 14);

if (!existsSync(dbPath)) {
  console.error(`找不到資料庫：${dbPath}`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const target = join(dir, `coidle-${stamp}.db`);
if (existsSync(target)) {
  console.log(`這一分鐘已經備份過了：${target}`);
  process.exit(0);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
// 驗證備份可以開啟、結構完整
const check = new DatabaseSync(target, { readOnly: true });
const ok = check.prepare("PRAGMA integrity_check").get();
check.close();
if (!ok || Object.values(ok)[0] !== "ok") {
  console.error("備份驗證失敗：", ok);
  unlinkSync(target);
  process.exit(2);
}
console.log(`備份完成：${target}（${(statSync(target).size / 1024).toFixed(0)} KB）`);

const files = readdirSync(dir).filter((f) => /^coidle-.*\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) {
  unlinkSync(join(dir, f));
  console.log(`刪除舊備份：${f}`);
}
