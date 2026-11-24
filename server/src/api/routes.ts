import type { FastifyInstance } from "fastify";
import { ROLE_IDS, type MeResponse, type RoleId } from "@coidle/shared";
import { hashPassword, hashToken, newInviteCode, newSessionToken, verifyPassword } from "../auth/password";
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import { MallService, ServiceError } from "../services/mallService";
import type { Command } from "../sim";
import { COOKIE_NAME, SESSION_TTL_MS, requireUser, sessionToken, setSessionCookie } from "./auth";

export interface Deps {
  config: Config;
  repo: Repo;
  service: MallService;
  now: () => number;
}

const USERNAME_RE = /^[A-Za-z0-9_぀-ヿ一-鿿]{2,20}$/;

function str(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== "string") throw new ServiceError(400, `${field} 格式不正確`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new ServiceError(400, `${field} 長度需在 ${min}–${max} 字之間`);
  return t;
}

function body(req: { body: unknown }): Record<string, unknown> {
  if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) throw new ServiceError(400, "請求內容格式不正確");
  return req.body as Record<string, unknown>;
}

function mallIdOf(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id < 1) throw new ServiceError(400, "商場編號無效");
  return id;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { config, repo, service, now } = deps;
  const failures = new Map<string, { n: number; resetAt: number }>();

  const requireMember = (req: Parameters<typeof requireUser>[0], mallId: number) => {
    const user = requireUser(req, repo, now());
    const member = repo.member(mallId, user.id);
    if (!member) throw new ServiceError(403, "你不是這座商場的成員");
    return { user, member };
  };

  const startSession = (reply: Parameters<typeof setSessionCookie>[0], userId: number) => {
    const token = newSessionToken();
    repo.createSession(hashToken(token), userId, now() + SESSION_TTL_MS);
    setSessionCookie(reply, token, config.production);
  };

  // ── 認證
  app.post("/api/auth/register", async (req, reply) => {
    const b = body(req);
    if (config.signupSecret && b.signupSecret !== config.signupSecret) throw new ServiceError(403, "註冊密語不正確");
    const username = str(b.username, "帳號", 2, 20);
    if (!USERNAME_RE.test(username)) throw new ServiceError(400, "帳號只能用英數字、底線、中日文");
    const password = typeof b.password === "string" ? b.password : "";
    if (password.length < 8 || password.length > 72) throw new ServiceError(400, "密碼長度需在 8–72 字之間");
    const displayName = b.displayName === undefined ? username : str(b.displayName, "暱稱", 1, 20);
    if (repo.userByName(username)) throw new ServiceError(409, "這個帳號已被使用");
    const id = repo.createUser(username, displayName, await hashPassword(password), now());
    startSession(reply, id);
    return { ok: true };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const b = body(req);
    const username = str(b.username, "帳號", 1, 40);
    const password = typeof b.password === "string" ? b.password : "";
    const key = `${req.ip}|${username.toLowerCase()}`;
    const f = failures.get(key);
    if (f && f.resetAt > now() && f.n >= 8) throw new ServiceError(429, "嘗試次數過多，請稍後再試");
    const user = repo.userByName(username);
    // 帳號不存在時也跑一次雜湊，避免用回應時間猜帳號
    const ok = user ? await verifyPassword(password, user.pass_hash) : (await hashPassword(password), false);
    if (!ok || !user) {
      const cur = f && f.resetAt > now() ? f : { n: 0, resetAt: now() + 10 * 60_000 };
      cur.n++;
      failures.set(key, cur);
      throw new ServiceError(401, "帳號或密碼不正確");
    }
    failures.delete(key);
    startSession(reply, user.id);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = sessionToken(req);
    if (token) repo.deleteSession(hashToken(token));
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req): Promise<MeResponse> => {
    const user = requireUser(req, repo, now());
    return {
      user: { id: user.id, username: user.username, displayName: user.display_name },
      malls: repo.mallsOfUser(user.id).map((m) => ({ id: m.id, name: m.name, role: m.role, isOwner: m.is_owner === 1 })),
    };
  });

  // ── 商場
  app.post("/api/malls", async (req) => {
    const user = requireUser(req, repo, now());
    const name = str(body(req).name, "商場名稱", 1, 30);
    const { mallId, inviteCode } = service.createMall(user.id, name);
    return { id: mallId, inviteCode };
  });

  app.post("/api/malls/join", async (req) => {
    const user = requireUser(req, repo, now());
    const b = body(req);
    const code = str(b.code, "邀請碼", 4, 16);
    const role = typeof b.role === "string" && ROLE_IDS.includes(b.role) ? (b.role as RoleId) : undefined;
    return { id: service.joinMall(code, user.id, role, config.maxMembers) };
  });

  app.get("/api/malls/:id", async (req) => {
    const mallId = mallIdOf(req.params);
    const { member } = requireMember(req, mallId);
    const mall = repo.mallById(mallId)!;
    return {
      id: mall.id,
      name: mall.name,
      inviteCode: member.is_owner ? mall.invite_code : undefined,
      members: service.members(mallId),
    };
  });

  app.get("/api/malls/:id/state", async (req) => {
    const mallId = mallIdOf(req.params);
    requireMember(req, mallId);
    return service.getState(mallId, true);
  });

  app.get("/api/malls/:id/activity", async (req) => {
    const mallId = mallIdOf(req.params);
    requireMember(req, mallId);
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 30) || 30));
    return repo.activity(mallId, limit);
  });

  app.post("/api/malls/:id/commands", async (req) => {
    const mallId = mallIdOf(req.params);
    const { user } = requireMember(req, mallId);
    const cmd = body(req).command;
    if (typeof cmd !== "object" || cmd === null || typeof (cmd as { type?: unknown }).type !== "string") {
      throw new ServiceError(400, "指令格式不正確");
    }
    const result = service.runCommand(mallId, { id: user.id, displayName: user.display_name }, cmd as Command);
    if (!result.ok) throw new ServiceError(422, result.error);
    return result.publicState;
  });

  app.post("/api/malls/:id/role", async (req) => {
    const mallId = mallIdOf(req.params);
    const { user } = requireMember(req, mallId);
    const role = body(req).role;
    if (typeof role !== "string" || !ROLE_IDS.includes(role)) throw new ServiceError(400, "職位無效");
    repo.setRole(mallId, user.id, role as RoleId);
    return { members: service.members(mallId) };
  });

  app.post("/api/malls/:id/invite/regenerate", async (req) => {
    const mallId = mallIdOf(req.params);
    const { member } = requireMember(req, mallId);
    if (!member.is_owner) throw new ServiceError(403, "只有創辦人可以更換邀請碼");
    const code = newInviteCode();
    repo.setInviteCode(mallId, code);
    return { inviteCode: code };
  });

  // ── 開發／營運：開放內容的旗標（需要 ADMIN_TOKEN）
  app.post("/api/admin/malls/:id/flags", async (req) => {
    if (!config.adminToken || req.headers["x-admin-token"] !== config.adminToken) throw new ServiceError(403, "沒有權限");
    const mallId = mallIdOf(req.params);
    const b = body(req);
    const flag = str(b.flag, "flag", 3, 60);
    if (!/^(zone|feature):[a-z0-9_]+$/.test(flag) || typeof b.value !== "boolean") throw new ServiceError(400, "旗標格式不正確");
    return service.setFlag(mallId, flag, b.value);
  });
}
