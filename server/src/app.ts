import Fastify from "fastify";
import type { HealthResponse } from "@coidle/shared";

export function buildApp() {
  const app = Fastify({ logger: false });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    ok: true,
    name: "coidle",
    time: new Date().toISOString(),
  }));

  return app;
}
