import { buildApp } from "./app";

const { app, service, repo, config } = buildApp();

// 排程：每 30 秒把所有商場推進到「現在」——玩家離線時商場照樣營業
service.tickAll();
const ticker = setInterval(() => service.tickAll(), 30_000);
const janitor = setInterval(() => repo.purgeExpiredSessions(Date.now()), 3600_000);

const shutdown = async () => {
  clearInterval(ticker);
  clearInterval(janitor);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen({ port: config.port, host: "0.0.0.0" }).then(() => {
  console.log(`Coidle server listening on :${config.port}`);
});
