import cookie from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hashToken } from "../auth/password";
import type { UserRow } from "../db/repo";
import type { Repo } from "../db/repo";
import { ServiceError } from "../services/mallService";

export const COOKIE_NAME = "coidle_sid";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/** 不依賴 cookie 外掛的 hook 順序（WebSocket 升級請求不一定會經過它）直接解析標頭 */
export function sessionToken(req: FastifyRequest): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return cookie.parse(header)[COOKIE_NAME];
}

export function userFromRequest(req: FastifyRequest, repo: Repo, now: number): UserRow | null {
  const token = sessionToken(req);
  if (!token) return null;
  return repo.sessionUser(hashToken(token), now) ?? null;
}

export function requireUser(req: FastifyRequest, repo: Repo, now: number): UserRow {
  const u = userFromRequest(req, repo, now);
  if (!u) throw new ServiceError(401, "請先登入");
  return u;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}
