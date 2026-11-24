import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { HealthResponse } from "@coidle/shared";
import { registerRoutes } from "./api/routes";
import { registerWs } from "./api/ws";
import { loadConfig, type Config } from "./config";
import { openDb } from "./db/db";
import { Repo } from "./db/repo";
import { MallService, ServiceError } from "./services/mallService";

export interface BuildOptions {
  config?: Partial<Config>;
  /** 測試用：可注入假時鐘 */
  now?: () => number;
}

export function buildApp(opts: BuildOptions = {}) {
  const config: Config = { ...loadConfig(), ...opts.config };
  const now = opts.now ?? Date.now;
  const db = openDb(config.dbPath);
  const repo = new Repo(db);
  const service = new MallService(repo, now);
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, trustProxy: config.production });

  app.register(cookie);
  app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ServiceError) return reply.status(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: "請求格式不正確" });
    console.error(err);
    return reply.status(500).send({ error: "伺服器發生錯誤" });
  });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    ok: true,
    name: "coidle",
    time: new Date().toISOString(),
  }));

  const deps = { config, repo, service, now };
  registerRoutes(app, deps);
  registerWs(app, deps);

  app.addHook("onClose", async () => {
    db.close();
  });

  return { app, service, repo, config };
}
