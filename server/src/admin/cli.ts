// 管理指令列（在伺服器上直接操作資料庫，不需要 ADMIN_TOKEN）。用法：
//   npm run admin -- users                       列出所有使用者
//   npm run admin -- malls                       列出所有商場
//   npm run admin -- reset-password <帳號>        產生一組臨時密碼（只顯示這一次），並登出所有裝置
//   npm run admin -- test-mall <帳號> [名稱]       替這個帳號開一座「全開」測試商場（最高等級、全區域、全科技、新手任務完成、資金 1 億）
//   npm run admin -- delete-user <帳號>           刪除使用者（他創辦的商場會轉給其他成員，沒人了就解散）
import { randomBytes } from "node:crypto";
import { hashPassword } from "../auth/password";
import { loadConfig } from "../config";
import { openDb } from "../db/db";
import { Repo } from "../db/repo";
import { MallService } from "../services/mallService";

try {
  process.loadEnvFile();
} catch {
  // 沒有 .env
}
const config = loadConfig();
const repo = new Repo(openDb(config.dbPath));
const service = new MallService(repo);
const [cmd, arg, arg2] = process.argv.slice(2);
const date = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

switch (cmd) {
  case "users":
    for (const u of repo.allUsers()) console.log(`#${u.id}  ${u.username}（${u.display_name}）  註冊於 ${date(u.created_at)}  商場：${repo.mallsOfUser(u.id).map((m) => m.name).join("、") || "—"}`);
    break;
  case "malls":
    for (const m of repo.allMalls()) {
      const s = service.summary(m.id);
      console.log(`#${m.id}  ${m.name}  成員 ${m.members}  ${s ? `Lv.${s.level}  資金 ${s.funds.toLocaleString()}  第 ${s.day} 天` : "（無法讀取）"}`);
    }
    break;
  case "reset-password": {
    const u = arg ? repo.userByName(arg) : undefined;
    if (!u) {
      console.error("找不到這個帳號");
      process.exit(1);
    }
    const temp = randomBytes(9).toString("base64url");
    repo.setPassHash(u.id, await hashPassword(temp));
    repo.deleteSessionsOfUser(u.id);
    console.log(`「${u.username}」的臨時密碼：${temp}\n（只會顯示這一次，請請他登入後立刻到「☰ 選單 → 設定 → 商場與帳號」改掉）`);
    break;
  }
  case "delete-user": {
    const u = arg ? repo.userByName(arg) : undefined;
    if (!u) {
      console.error("找不到這個帳號");
      process.exit(1);
    }
    service.adminDeleteUser(u.id);
    console.log(`已刪除「${u.username}」`);
    break;
  }
  case "test-mall": {
    const u = arg ? repo.userByName(arg) : undefined;
    if (!u) {
      console.error("找不到這個帳號（要先在網頁上註冊）");
      process.exit(1);
    }
    const made = service.adminCreateTestMall(u.id, arg2 ?? "測試全開商場");
    console.log(`已替「${u.username}」開好「${arg2 ?? "測試全開商場"}」（#${made.mallId}，邀請碼 ${made.inviteCode}）。重新整理網頁就會在大廳看到。`);
    break;
  }
  default:
    console.log("指令：users | malls | reset-password <帳號> | test-mall <帳號> [名稱] | delete-user <帳號>");
}
