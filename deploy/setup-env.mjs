// 第一次部署用：從 .env.example 產生 .env，並自動填好正式環境需要的值。
// 用法（在 /opt/coidle，以 coidle 使用者）：
//   node deploy/setup-env.mjs <註冊密語> <聯絡信箱>
// 會做的事：NODE_ENV=production、SIGNUP_SECRET＝你給的密語、
// 產生一組推播（VAPID）金鑰、VAPID_SUBJECT＝mailto:信箱，檔案權限 600。
// 已經有 .env 時不會覆蓋（要重來請先自己刪掉）。OPENROUTER_API_KEY 不在這裡填，請自己 nano .env 加。
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const webpush = createRequire(import.meta.url)("web-push");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.ENV_PATH ?? join(root, ".env");
const [secret, email] = process.argv.slice(2);

if (!secret || !email || !email.includes("@")) {
  console.error("用法：node deploy/setup-env.mjs <註冊密語> <聯絡信箱>");
  process.exit(1);
}
if (secret.length < 6) {
  console.error("註冊密語至少 6 個字元。");
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`${target} 已經存在，不會覆蓋。要重來請先刪掉它。`);
  process.exit(1);
}

const vapid = webpush.generateVAPIDKeys();
const values = {
  NODE_ENV: "production",
  SIGNUP_SECRET: secret,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: `mailto:${email}`,
};

let text = readFileSync(join(root, ".env.example"), "utf8");
for (const [key, value] of Object.entries(values)) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (!re.test(text)) {
    console.error(`.env.example 裡找不到 ${key}，請檢查。`);
    process.exit(1);
  }
  text = text.replace(re, () => `${key}=${value}`);
}
writeFileSync(target, text, { mode: 0o600 });
chmodSync(target, 0o600);
console.log(`已建立 ${target}（權限 600）。`);
console.log(`註冊密語：${secret}（只告訴你的朋友）`);
console.log("推播金鑰已寫入 .env，不要外流。管理者請用 npm run admin -- create-overseer 建立 Overseer 與登入金鑰。");
