import { buildApp } from "./app";

// 開發時讀取 .env（正式環境由 systemd 的 EnvironmentFile 提供）
try {
  process.loadEnvFile();
} catch {
  // 沒有 .env 也沒關係
}

// 開發用：DEV_CLOCK_OFFSET_HOURS 讓伺服器的時鐘往前撥（快轉測試離線／日報）。正式環境請勿設定。
const clockOffsetMs = Number(process.env.DEV_CLOCK_OFFSET_HOURS ?? 0) * 3_600_000;
const { app, service, repo, config, content, metrics } = buildApp({ now: () => Date.now() + clockOffsetMs });

// 排程：每 30 秒把所有商場推進到「現在」——玩家離線時商場照樣營業
const timedTick = () => {
  const t0 = performance.now();
  service.tickAll();
  metrics.tick(performance.now() - t0);
};
timedTick();
const ticker = setInterval(timedTick, 30_000);
// 營運數據：每分鐘取一筆樣本（線上人數、活躍玩家、請求、tick 耗時、記憶體…）
const sampler = setInterval(() => metrics.sample(), 60_000);
// AI 內容：每 30 分鐘看一次內容池，不足就（在預算內）補一批；沒有金鑰就什麼都不做
const aiTimer = setInterval(() => void content.topUp().then((r) => r && console.log("[ai]", r.kind, r.ok ? `收 ${r.accepted}` : `略過：${r.error ?? "無新內容"}`, `$${r.costUsd.toFixed(5)}`)), 30 * 60_000);
setTimeout(() => void content.topUp(), 20_000);
// 股市：每 10 秒處理到期的預約單與配息（買賣與列表前也會先處理，所以不依賴這個排程的準時）
const marketTimer = setInterval(() => {
  try {
    service.tickMarket();
  } catch (e) {
    console.error("[market]", e);
  }
}, 10_000);
const janitor = setInterval(() => repo.purgeExpiredSessions(Date.now()), 3600_000);

const shutdown = async () => {
  clearInterval(ticker);
  clearInterval(sampler);
  clearInterval(janitor);
  clearInterval(marketTimer);
  clearInterval(aiTimer);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen({ port: config.port, host: config.host }).then(() => {
  console.log(`Coidle server listening on ${config.host}:${config.port}`);
});
