import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ROLE_IDS, speedPreset, type MeResponse, type RoleId } from "@coidle/shared";
import type { ContentService, ContentKind } from "../ai/service";
import { hashPassword, hashToken, newInviteCode, newSessionToken, verifyPassword } from "../auth/password";
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import { MallService, ServiceError, type ClockPatch } from "../services/mallService";
import type { PushService } from "../services/push";
import type { Command } from "../sim";
import { COOKIE_NAME, SESSION_TTL_MS, requireUser, sessionToken, setSessionCookie } from "./auth";

export interface Deps {
  config: Config;
  repo: Repo;
  service: MallService;
  push: PushService;
  now: () => number;
  content: ContentService;
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
  const { config, repo, service, push, now, content } = deps;
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

  app.post("/api/me/profile", async (req) => {
    const user = requireUser(req, repo, now());
    const name = str(body(req).displayName, "暱稱", 1, 20);
    repo.setDisplayName(user.id, name);
    for (const m of repo.mallsOfUser(user.id)) service.announceMembersOf(m.id);
    return { ok: true, displayName: name };
  });

  app.post("/api/me/password", async (req) => {
    const user = requireUser(req, repo, now());
    const b = body(req);
    const current = typeof b.current === "string" ? b.current : "";
    const next = typeof b.next === "string" ? b.next : "";
    const key = `pw|${user.id}`;
    const f = failures.get(key);
    if (f && f.resetAt > now() && f.n >= 8) throw new ServiceError(429, "嘗試次數過多，請稍後再試");
    if (!(await verifyPassword(current, user.pass_hash))) {
      failures.set(key, { n: (f && f.resetAt > now() ? f.n : 0) + 1, resetAt: now() + 15 * 60_000 });
      throw new ServiceError(403, "目前的密碼不正確");
    }
    if (next.length < 8 || next.length > 72) throw new ServiceError(400, "新密碼長度需在 8–72 字之間");
    if (next === current) throw new ServiceError(400, "新密碼不能和舊密碼一樣");
    repo.setPassHash(user.id, await hashPassword(next));
    // 其他裝置全部登出；目前這個保留
    const token = sessionToken(req);
    repo.deleteSessionsOfUser(user.id, token ? hashToken(token) : undefined);
    return { ok: true };
  });

  app.post("/api/me/delete", async (req, reply) => {
    const user = requireUser(req, repo, now());
    const password = typeof body(req).password === "string" ? (body(req).password as string) : "";
    if (!(await verifyPassword(password, user.pass_hash))) throw new ServiceError(403, "密碼不正確");
    service.deleteAccount(user.id);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
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

  app.post("/api/malls/:id/leave", async (req) => {
    const mallId = mallIdOf(req.params);
    const { user } = requireMember(req, mallId);
    return service.leaveMall(mallId, user.id);
  });

  app.post("/api/malls/:id/members/:uid/kick", async (req) => {
    const mallId = mallIdOf(req.params);
    const { user } = requireMember(req, mallId);
    service.kickMember(mallId, user.id, Number((req.params as { uid: string }).uid));
    return { members: service.members(mallId) };
  });

  app.post("/api/malls/:id/transfer", async (req) => {
    const mallId = mallIdOf(req.params);
    const { user } = requireMember(req, mallId);
    const target = body(req).userId;
    if (typeof target !== "number" || !Number.isInteger(target)) throw new ServiceError(400, "對象無效");
    service.transferOwner(mallId, user.id, target);
    return { members: service.members(mallId) };
  });

  app.post("/api/malls/:id/rename", async (req) => {
    const mallId = mallIdOf(req.params);
    const { user } = requireMember(req, mallId);
    const name = str(body(req).name, "商場名稱", 1, 30);
    service.renameMall(mallId, user.id, name);
    return { name };
  });

  app.post("/api/malls/:id/invite/regenerate", async (req) => {
    const mallId = mallIdOf(req.params);
    const { member } = requireMember(req, mallId);
    if (!member.is_owner) throw new ServiceError(403, "只有創辦人可以更換邀請碼");
    const code = newInviteCode();
    repo.setInviteCode(mallId, code);
    return { inviteCode: code };
  });

  // ── 時間流速／暫停（任何成員都可以；最快就是預設，調速只會往慢走）
  app.post("/api/malls/:id/clock", async (req) => {
    const mallId = mallIdOf(req.params);
    const { user } = requireMember(req, mallId);
    const b = body(req);
    const patch: ClockPatch = {};
    if (b.speed !== undefined) {
      if (typeof b.speed !== "string" || !speedPreset(b.speed)) throw new ServiceError(400, "流速檔位無效");
      patch.speed = b.speed as ClockPatch["speed"];
    }
    for (const key of ["paused", "pauseOnEvents"] as const) {
      if (b[key] !== undefined) {
        if (typeof b[key] !== "boolean") throw new ServiceError(400, `${key} 格式不正確`);
        patch[key] = b[key] as boolean;
      }
    }
    if (b.idlePauseDays !== undefined) {
      if (b.idlePauseDays !== null && typeof b.idlePauseDays !== "number") throw new ServiceError(400, "天數格式不正確");
      patch.idlePauseDays = b.idlePauseDays as number | null;
    }
    return service.setClock(mallId, { id: user.id, displayName: user.display_name }, patch);
  });

  // ── 推播訂閱（瀏覽器端要等 M4 的 Service Worker 才能真的收到）
  app.get("/api/push/key", async (req) => {
    requireUser(req, repo, now());
    return { publicKey: push.publicKey };
  });

  app.post("/api/push/subscribe", async (req) => {
    const user = requireUser(req, repo, now());
    const b = body(req);
    const keys = (b.keys ?? {}) as Record<string, unknown>;
    const endpoint = str(b.endpoint, "endpoint", 10, 600);
    if (!/^https:\/\//.test(endpoint)) throw new ServiceError(400, "endpoint 必須是 https");
    repo.addPushSub(user.id, endpoint, str(keys.p256dh, "p256dh", 10, 200), str(keys.auth, "auth", 10, 100), now());
    return { ok: true };
  });

  app.post("/api/push/unsubscribe", async (req) => {
    const user = requireUser(req, repo, now());
    repo.removePushSub(str(body(req).endpoint, "endpoint", 10, 600), user.id);
    return { ok: true };
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

  // ── 玩家端：AI 事件的定義（顯示待決事件卡片要用）
  app.get("/api/content/events", async (req) => {
    requireUser(req, repo, now());
    return { events: content.publicEvents() };
  });

  // ── AI 內容管理（需要 ADMIN_TOKEN）
  const admin = (req: { headers: Record<string, unknown> }) => {
    if (!config.adminToken || req.headers["x-admin-token"] !== config.adminToken) throw new ServiceError(403, "沒有權限");
  };
  app.get("/api/admin/ai/status", async (req) => {
    admin(req);
    const b = content.budget();
    return {
      enabled: content.enabled,
      model: config.ai.model,
      budget: { ...b, windowStart: new Date(b.windowStart).toISOString(), windowEnd: new Date(b.windowEnd).toISOString() },
      pool: {
        news: repo.contentCount("news", "active"),
        review: repo.contentCount("review", "active"),
        eventActive: repo.contentCount("event", "active"),
        eventPending: repo.contentCount("event", "pending"),
      },
      recent: repo.ledgerRecent(10),
    };
  });
  app.get("/api/admin/ai/items", async (req) => {
    admin(req);
    const q = req.query as { kind?: string; status?: string };
    return { items: repo.contentList(q.kind ?? null, q.status ?? null, 100) };
  });
  app.post("/api/admin/ai/generate", async (req) => {
    admin(req);
    const b = body(req);
    if (!["news", "review", "event"].includes(b.kind as string)) throw new ServiceError(400, "kind 無效");
    const count = typeof b.count === "number" ? Math.min(20, Math.max(1, Math.floor(b.count))) : undefined;
    return content.generate(b.kind as ContentKind, count);
  });
  app.post("/api/admin/ai/events/:id/:action", async (req) => {
    admin(req);
    const p = req.params as { id: string; action: string };
    const id = Number(p.id);
    const ok = p.action === "approve" ? content.approveEvent(id) : p.action === "reject" ? content.rejectEvent(id) : false;
    if (!ok) throw new ServiceError(400, "找不到這個事件，或狀態不允許這個操作");
    return { ok: true };
  });
  app.post("/api/admin/ai/items/:id/remove", async (req) => {
    admin(req);
    if (!content.removeText(Number((req.params as { id: string }).id))) throw new ServiceError(400, "找不到這則內容");
    return { ok: true };
  });

  // ── 管理後台（需要 ADMIN_TOKEN）：概況、商場與使用者
  app.get("/api/admin/overview", async (req) => {
    admin(req);
    return {
      users: repo.allUsers(),
      malls: repo.allMalls().map((m) => ({ ...m, ...(service.summary(m.id) ?? { level: 0, funds: 0, tick: 0, day: 0, flags: {} }) })),
    };
  });
  app.post("/api/admin/users/:id/reset-password", async (req) => {
    admin(req);
    const id = Number((req.params as { id: string }).id);
    if (!repo.userById(id)) throw new ServiceError(404, "找不到這位使用者");
    const temp = randomBytes(9).toString("base64url");
    repo.setPassHash(id, await hashPassword(temp));
    repo.deleteSessionsOfUser(id);
    return { tempPassword: temp };
  });
  app.post("/api/admin/users/:id/delete", async (req) => {
    admin(req);
    const id = Number((req.params as { id: string }).id);
    if (!repo.userById(id)) throw new ServiceError(404, "找不到這位使用者");
    service.adminDeleteUser(id);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/delete", async (req) => {
    admin(req);
    const id = Number((req.params as { id: string }).id);
    if (!repo.mallById(id)) throw new ServiceError(404, "找不到這座商場");
    service.dissolveMall(id);
    return { ok: true };
  });
}
