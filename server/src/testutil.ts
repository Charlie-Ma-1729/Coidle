import type { FastifyInstance } from "fastify";
import { createOverseer } from "./auth/overseer";
import type { Repo } from "./db/repo";

/** 測試用：建立 Overseer 並用金鑰登入，回傳可直接放進請求標頭的 cookie */
export async function overseerLogin(b: { app: FastifyInstance; repo: Repo }, now = Date.UTC(2026, 10, 24), username = "overseer"): Promise<{ cookie: string; key: string; userId: number; headers: { cookie: string } }> {
  const { userId, key } = await createOverseer(b.repo, now, username);
  const res = await b.app.inject({ method: "POST", url: "/api/auth/overseer", payload: { key } });
  const c = res.cookies.find((x) => x.name === "coidle_sid");
  if (!c) throw new Error(`Overseer 登入失敗：${res.statusCode} ${res.body}`);
  const cookie = `coidle_sid=${c.value}`;
  return { cookie, key, userId, headers: { cookie } };
}
