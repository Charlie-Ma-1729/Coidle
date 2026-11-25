// 管理指令列（在伺服器上直接操作資料庫）。所有會改動資料的指令都會寫進稽核紀錄。用法：
//   npm run admin -- users                       列出所有使用者
//   npm run admin -- malls                       列出所有商場
//   npm run admin -- create-overseer [帳號]       建立 Overseer（世界管理者）帳號並產生登入金鑰（金鑰只顯示這一次）
//   npm run admin -- rotate-overseer-key [帳號]   換一把新的金鑰（舊的立刻失效、所有登入登出）
//   npm run admin -- reset-password <帳號>        產生一組臨時密碼（只顯示這一次），並登出所有裝置
//   npm run admin -- test-mall <帳號> [名稱]       替這個帳號開一座「全開」測試商場（最高等級、全區域、全科技、新手任務完成、資金 1 億）
//   npm run admin -- sandbox-mall <overseer帳號> [商場編號]
//                                                把測試商場獨立出世界、轉給 Overseer 並移除其他成員；沒給編號就新開一座
//   npm run admin -- delete-user <帳號>           刪除使用者（他創辦的商場會轉給其他成員，沒人了就解散）
import { randomBytes } from "node:crypto";
import { createOverseer, OVERSEER_USERNAME, rotateOverseerKey } from "../auth/overseer";
import { hashPassword } from "../auth/password";
import { loadConfig } from "../config";
import { openDb } from "../db/db";
import { Repo } from "../db/repo";
import { AuditService } from "../services/audit";
import { MallService } from "../services/mallService";

try {
  process.loadEnvFile();
} catch {
  // 沒有 .env
}
const config = loadConfig();
const repo = new Repo(openDb(config.dbPath));
const service = new MallService(repo);
const audit = new AuditService(repo, Date.now, (line) => console.log(line));
const cli = { id: null, name: "cli" };
const [cmd, arg, arg2] = process.argv.slice(2);
const date = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

switch (cmd) {
  case "users":
    for (const u of repo.allUsers()) console.log(`#${u.id}  ${u.username}（${u.display_name}）${u.role === "overseer" ? " [Overseer]" : ""}  註冊於 ${date(u.created_at)}  商場：${repo.mallsOfUser(u.id).map((m) => m.name).join("、") || "—"}`);
    break;
  case "malls":
    for (const m of repo.allMalls()) {
      const s = service.summary(m.id);
      console.log(`#${m.id}  ${m.name}${m.sandbox ? " [測試・獨立於世界]" : ""}  成員 ${m.members}  ${s ? `Lv.${s.level}  資金 ${s.funds.toLocaleString()}  第 ${s.day} 天` : "（無法讀取）"}`);
    }
    break;
  case "create-overseer": {
    const name = arg ?? OVERSEER_USERNAME;
    const made = await createOverseer(repo, Date.now(), name).catch((e: Error) => {
      console.error(e.message);
      process.exit(1);
    });
    audit.record(cli, "overseer.create", `user#${made.userId}(${name})`);
    console.log(`已建立 Overseer「${name}」（#${made.userId}）。\n登入金鑰（只會顯示這一次，請存到密碼管理器）：\n\n${made.key}\n\n到網站的登入頁選「管理者金鑰登入」，貼上這把金鑰。`);
    break;
  }
  case "rotate-overseer-key": {
    const name = arg ?? OVERSEER_USERNAME;
    const r = await rotateOverseerKey(repo, name).catch((e: Error) => {
      console.error(e.message);
      process.exit(1);
    });
    audit.record(cli, "overseer.rotate-key", `user#${r.userId}(${name})`);
    console.log(`「${name}」的新金鑰（只會顯示這一次；舊金鑰與所有登入已失效）：\n\n${r.key}\n`);
    break;
  }
  case "reset-password": {
    const u = arg ? repo.userByName(arg) : undefined;
    if (!u) {
      console.error("找不到這個帳號");
      process.exit(1);
    }
    if (u.role === "overseer") {
      console.error("Overseer 沒有密碼，要換金鑰請用 rotate-overseer-key");
      process.exit(1);
    }
    const temp = randomBytes(9).toString("base64url");
    repo.setPassHash(u.id, await hashPassword(temp));
    repo.deleteSessionsOfUser(u.id);
    audit.record(cli, "user.reset-password", `user#${u.id}(${u.username})`);
    console.log(`「${u.username}」的臨時密碼：${temp}\n（只會顯示這一次，請請他登入後立刻到「☰ 選單 → 設定 → 商場與帳號」改掉）`);
    break;
  }
  case "test-mall": {
    const u = arg ? repo.userByName(arg) : undefined;
    if (!u) {
      console.error("找不到這個帳號（要先在網頁上註冊）");
      process.exit(1);
    }
    const made = service.adminCreateTestMall(u.id, arg2 ?? "測試全開商場");
    audit.record(cli, "mall.create-test", `mall#${made.mallId}`, { owner: u.username });
    console.log(`已替「${u.username}」開好「${arg2 ?? "測試全開商場"}」（#${made.mallId}，邀請碼 ${made.inviteCode}）。重新整理網頁就會在大廳看到。`);
    break;
  }
  case "sandbox-mall": {
    const owner = arg ? repo.userByName(arg) : undefined;
    if (!owner || owner.role !== "overseer") {
      console.error("第一個參數要是 Overseer 帳號（先用 create-overseer 建立）");
      process.exit(1);
    }
    const mallId = arg2 ? Number(arg2) : undefined;
    if (mallId !== undefined && !repo.mallById(mallId)) {
      console.error("找不到這座商場");
      process.exit(1);
    }
    const r = service.adminMakeSandbox(owner.id, mallId);
    audit.record(cli, "mall.sandbox", `mall#${r.mallId}`, { owner: owner.username, created: r.created, removedMembers: r.removed });
    console.log(`「${r.name}」（#${r.mallId}）${r.created ? "已新開" : "已轉換"}為獨立測試商場，創辦人是「${owner.username}」${r.removed.length ? `，已移除成員：${r.removed.join("、")}` : ""}。\n它不會出現在名錄與排行，也不能聯名、貿易或搶客，NPC 不會動它。`);
    break;
  }
  case "delete-user": {
    const u = arg ? repo.userByName(arg) : undefined;
    if (!u) {
      console.error("找不到這個帳號");
      process.exit(1);
    }
    if (u.role === "overseer") {
      console.error("不能刪除 Overseer 帳號");
      process.exit(1);
    }
    service.adminDeleteUser(u.id);
    audit.record(cli, "user.delete", `user#${u.id}(${u.username})`);
    console.log(`已刪除「${u.username}」`);
    break;
  }
  default:
    console.log("指令：users | malls | create-overseer [帳號] | rotate-overseer-key [帳號] | reset-password <帳號> | test-mall <帳號> [名稱] | sandbox-mall <overseer帳號> [商場編號] | delete-user <帳號>");
}
