import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { HealthResponse } from "@coidle/shared";
import { registerRoutes } from "./api/routes";
import { registerWs } from "./api/ws";
import { loadConfig, type Config } from "./config";
import { openDb } from "./db/db";
import { Repo } from "./db/repo";
import { ContentService } from "./ai/service";
import { setFlavorSource } from "./sim/flavor";
import { registerSecurityHeaders, registerStatic } from "./static";
import { MallService, ServiceError } from "./services/mallService";
import { PushService, type PushSender } from "./services/push";

export interface BuildOptions {
  config?: Partial<Config>;
  /** 測試用：可注入假時鐘 */
  now?: () => number;
  /** 測試用：可注入假的推播送出函式 */
  pushSender?: PushSender;
}

export function buildApp(opts: BuildOptions = {}) {
  const config: Config = { ...loadConfig(), ...opts.config };
  const now = opts.now ?? Date.now;
  const db = openDb(config.dbPath);
  const repo = new Repo(db);
  const push = new PushService(repo, config, now, opts.pushSender ?? null);
  const service = new MallService(repo, now, push);
  const content = new ContentService(repo, config.ai, now);
  setFlavorSource(content.flavorSource());
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

  const deps = { config, repo, service, push, now, content };
  registerRoutes(app, deps);
  registerWs(app, deps);
  registerSecurityHeaders(app);
  registerStatic(app, config.staticDir);

  app.addHook("onClose", async () => {
    db.close();
  });

  return { app, service, repo, config, push, content };
}
