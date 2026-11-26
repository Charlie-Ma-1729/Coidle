import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { EVENTS, NPC_BY_ID, NPC_MALLS, ROLE_IDS, WEATHER_NAMES, publicKey, speedPreset, type MeResponse, type RoleId } from "@coidle/shared";
import type { ContentService, ContentKind } from "../ai/service";
import { hashPassword, hashToken, newInviteCode, newSessionToken, verifyPassword } from "../auth/password";
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import { MallService, ServiceError, type ClockPatch } from "../services/mallService";
import type { PushService } from "../services/push";
import type { Command } from "../sim";
import { RESERVED_USERNAMES, overseerByKey } from "../auth/overseer";
import { NPC_BASE_P, type ManualAction } from "../world/npcActor";
import { dailyCsv, sampleCsv, type DailyStat, type Metrics, type MetricsSample } from "../services/metrics";
import type { UserRow } from "../db/repo";
import { balanceCsv, balanceShopCsv } from "../services/balance";
import type { AuditService } from "../services/audit";
import { COOKIE_NAME, SESSION_TTL_MS, requireOverseer, requireUser, sessionToken, setSessionCookie, userFromRequest } from "./auth";

declare module "fastify" {
  interface FastifyRequest {
    /** 管理 API：通過驗證的 Overseer */
    actor?: UserRow;
    /** 管理 API：處理函式留給稽核紀錄的說明 */
    auditNote?: { action: string; target: string; detail: unknown };
  }
}

export interface Deps {
  config: Config;
  repo: Repo;
  service: MallService;
  push: PushService;
  now: () => number;
  content: ContentService;
  audit: AuditService;
  metrics: Metrics;
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

function aidOf(params: unknown): number {
  const id = Number((params as { aid?: string }).aid);
  if (!Number.isInteger(id) || id < 1) throw new ServiceError(400, "協議編號無效");
  return id;
}

function mallIdOf(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id < 1) throw new ServiceError(400, "商場編號無效");
  return id;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { config, repo, service, push, now, content, audit, metrics } = deps;
  const failures = new Map<string, { n: number; resetAt: number }>();

  /** 管理 API 處理函式用：替這次操作寫一句稽核說明（沒寫的話，會自動記下方法與路徑） */
  const note = (req: { auditNote?: { action: string; target: string; detail: unknown } }, action: string, target = "", detail: unknown = {}) => {
    req.auditNote = { action, target, detail };
  };

  // ── 所有 /api/admin/*：只有 Overseer 能用，每個非讀取的操作都留下稽核紀錄
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/api/admin/")) return;
    try {
      req.actor = requireOverseer(req, repo, now());
    } catch (e) {
      const who = userFromRequest(req, repo, now());
      audit.record({ id: who?.id ?? null, name: who?.username ?? "(未登入)" }, "admin.denied", `${req.method} ${req.url.split("?")[0]}`, {}, req.ip);
      throw e;
    }
  });
  app.addHook("onResponse", async (req, reply) => {
    const actor = req.actor;
    if (!actor) return;
    const n = req.auditNote;
    if (req.method === "GET" && !n) return;
    const ok = reply.statusCode < 400;
    const path = req.url.split("?")[0]!;
    const base = n ? (ok ? n.action : `${n.action}.failed`) : `http.${req.method.toLowerCase()}`;
    const detail = { ...(n ? (n.detail as object) : { body: req.body }), status: reply.statusCode };
    audit.record({ id: actor.id, name: actor.username }, base, n?.target ?? path, detail, req.ip);
  });

  const requireMember = (req: Parameters<typeof requireUser>[0], mallId: number) => {
    const user = requireUser(req, repo, now());
    const member = repo.member(mallId, user.id);
    if (!member) throw new ServiceError(403, "你不是這座商場的成員");
    return { user, member };
  };

  /** 只讀的存取：成員，或旁觀中的 Overseer（旁觀不算在場、不能操作；每 10 分鐘最多記一次稽核） */
  const spectated = new Map<string, number>();
  const requireReader = (req: Parameters<typeof requireUser>[0], mallId: number) => {
    const user = requireUser(req, repo, now());
    const member = repo.member(mallId, user.id);
    if (member) return { user, member, spectator: false };
    if (user.role !== "overseer") throw new ServiceError(403, "你不是這座商場的成員");
    if (!repo.mallById(mallId)) throw new ServiceError(404, "商場不存在");
    const k = `${user.id}|${mallId}`;
    if ((spectated.get(k) ?? 0) + 600_000 < now()) {
      spectated.set(k, now());
      audit.record({ id: user.id, name: user.username }, "spectate.open", `mall#${mallId}`, {}, req.ip);
    }
    return { user, member: undefined, spectator: true };
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
    if (RESERVED_USERNAMES.includes(username.toLowerCase())) throw new ServiceError(400, "這個帳號名稱不能使用");
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
    // Overseer 只能用金鑰登入；這裡一律當成帳號或密碼錯誤
    const ok = user && user.role !== "overseer" ? await verifyPassword(password, user.pass_hash) : (await hashPassword(password), false);
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

  // Overseer（世界管理者）：只用金鑰登入。失敗次數限制比一般登入更嚴，成功與失敗都留下稽核紀錄。
  app.post("/api/auth/overseer", async (req, reply) => {
    const key = typeof body(req).key === "string" ? (body(req).key as string).trim() : "";
    const fkey = `ovs|${req.ip}`;
    const f = failures.get(fkey);
    if (f && f.resetAt > now() && f.n >= 5) {
      audit.record({ id: null, name: "(未登入)" }, "overseer.login.blocked", "", {}, req.ip);
      throw new ServiceError(429, "嘗試次數過多，請稍後再試");
    }
    const user = key.length >= 20 && key.length <= 200 ? await overseerByKey(repo, key) : null;
    if (!user) {
      const cur = f && f.resetAt > now() ? f : { n: 0, resetAt: now() + 15 * 60_000 };
      cur.n++;
      failures.set(fkey, cur);
      audit.record({ id: null, name: "(未登入)" }, "overseer.login.fail", "", {}, req.ip);
      throw new ServiceError(401, "金鑰不正確");
    }
    failures.delete(fkey);
    startSession(reply, user.id);
    audit.record({ id: user.id, name: user.username }, "overseer.login", "", {}, req.ip);
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
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
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
    if (user.role === "overseer") throw new ServiceError(403, "Overseer 只能用金鑰登入；要換金鑰請用伺服器上的指令列");
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
    if (user.role === "overseer") throw new ServiceError(403, "Overseer 帳號不能自行刪除");
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
    if (user.role !== "overseer") service.chargeFounding(user.id); // 第一座免費，之後要自己出資
    const { mallId, inviteCode } = service.createMall(user.id, name);
    // Overseer 開的商場一律是獨立測試商場：不進名錄／排行／賽季，也不會變成世界裡一座沒人經營的真商場
    if (user.role === "overseer") {
      service.adminMakeSandbox(user.id, mallId);
      audit.record({ id: user.id, name: user.username }, "mall.sandbox", `mall#${mallId}`, { created: true, owner: user.username }, req.ip);
    }
    return { id: mallId, inviteCode, sandbox: user.role === "overseer" };
  });

  app.post("/api/malls/join", async (req) => {
    const user = requireUser(req, repo, now());
    const b = body(req);
    const code = str(b.code, "邀請碼", 4, 16);
    const role = typeof b.role === "string" && ROLE_IDS.includes(b.role) ? (b.role as RoleId) : undefined;
    const id = service.joinMall(code, user.id, role, config.maxMembers);
    // 第一次參與商場的玩家，把自己一次性的起始資金投進來換股份（失敗就留著，下次再試）
    let grant = { contributed: false, shares: 0 };
    if (user.role !== "overseer") {
      try {
        grant = service.contributeGrant(id, user.id);
      } catch {
        // 商場暫時落後伺服器時間等原因：不影響加入
      }
    }
    return { id, grantShares: grant.contributed ? grant.shares : undefined };
  });

  app.get("/api/malls/:id", async (req) => {
    const mallId = mallIdOf(req.params);
    const { member } = requireReader(req, mallId);
    const mall = repo.mallById(mallId)!;
    return {
      id: mall.id,
      name: mall.name,
      inviteCode: member && service.authorityOf(mallId) === member.user_id ? mall.invite_code : undefined,
      members: service.members(mallId),
    };
  });

  app.get("/api/malls/:id/state", async (req) => {
    const mallId = mallIdOf(req.params);
    const { spectator } = requireReader(req, mallId);
    return service.getState(mallId, !spectator); // 旁觀不更新「最近造訪」，所以不會讓商場被當成有人在
  });

  app.get("/api/malls/:id/activity", async (req) => {
    const mallId = mallIdOf(req.params);
    requireReader(req, mallId);
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
    metrics.command();
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

  // 股權：成員看得到股權表；持股的人（含已離開商場的）可以把股份無償轉給現任成員
  app.get("/api/malls/:id/holdings", async (req) => {
    const mallId = mallIdOf(req.params);
    // 股東（含被請出商場、不再是成員的人）也看得到股權表，才能處理自己的持股
    const me = userFromRequest(req, repo, now());
    if (!(me && repo.sharesOf(mallId, me.id) > 0)) requireReader(req, mallId);
    return service.holdings(mallId);
  });

  app.post("/api/malls/:id/shares/transfer", async (req) => {
    const mallId = mallIdOf(req.params);
    const user = requireUser(req, repo, now());
    const b = body(req);
    if (typeof b.userId !== "number" || !Number.isInteger(b.userId)) throw new ServiceError(400, "對象無效");
    if (typeof b.shares !== "number") throw new ServiceError(400, "股數無效");
    return service.transferShares(mallId, user.id, b.userId, b.shares);
  });

  // 賣給其他股東：出價（只有出價與被出價的人看得到）→ 對方同意／拒絕，任一方可取消
  app.get("/api/malls/:id/shares/offers", async (req) => {
    const mallId = mallIdOf(req.params);
    const user = requireUser(req, repo, now());
    return { offers: service.offers(mallId, user.id), requests: service.authorityOf(mallId) === user.id ? service.capitalRequests(mallId) : service.capitalRequests(mallId).filter((r) => r.userId === user.id) };
  });
  app.post("/api/malls/:id/shares/offer", async (req) => {
    const mallId = mallIdOf(req.params);
    const user = requireUser(req, repo, now());
    const b = body(req);
    if (typeof b.userId !== "number" || !Number.isInteger(b.userId)) throw new ServiceError(400, "對象無效");
    if (typeof b.shares !== "number") throw new ServiceError(400, "股數無效");
    return { offers: service.offerShares(mallId, user.id, b.userId, b.shares) };
  });
  app.post("/api/shares/offers/:oid/respond", async (req) => {
    const user = requireUser(req, repo, now());
    const oid = Number((req.params as { oid: string }).oid);
    if (!Number.isInteger(oid)) throw new ServiceError(400, "出價編號無效");
    return service.respondOffer(oid, user.id, body(req).accept === true);
  });

  // 商場回購、股利、注資換股
  app.post("/api/malls/:id/shares/buyback", async (req) => {
    const mallId = mallIdOf(req.params);
    const user = requireUser(req, repo, now());
    if (typeof body(req).shares !== "number") throw new ServiceError(400, "股數無效");
    return service.buybackShares(mallId, user.id, body(req).shares as number);
  });
  app.post("/api/malls/:id/dividend", async (req) => {
    const mallId = mallIdOf(req.params);
    const user = requireUser(req, repo, now());
    if (typeof body(req).amount !== "number") throw new ServiceError(400, "金額無效");
    return service.declareDividend(mallId, user.id, body(req).amount as number);
  });
  app.post("/api/malls/:id/capital", async (req) => {
    const mallId = mallIdOf(req.params);
    const user = requireUser(req, repo, now());
    if (typeof body(req).amount !== "number") throw new ServiceError(400, "金額無效");
    return service.requestCapital(mallId, user.id, body(req).amount as number);
  });
  app.post("/api/capital/:rid/respond", async (req) => {
    const user = requireUser(req, repo, now());
    const rid = Number((req.params as { rid: string }).rid);
    if (!Number.isInteger(rid)) throw new ServiceError(400, "申請編號無效");
    return service.respondCapital(rid, user.id, body(req).accept === true);
  });

  app.get("/api/me/wealth", async (req) => {
    const user = requireUser(req, repo, now());
    return service.wealth(user.id);
  });
  // 個人財務頁：跨商場的持股、出價、注資申請；錢包流水
  app.get("/api/me/equity", async (req) => {
    const user = requireUser(req, repo, now());
    return service.personalEquity(user.id);
  });
  app.get("/api/me/ledger", async (req) => {
    const user = requireUser(req, repo, now());
    const n = Number((req.query as { limit?: string }).limit);
    return { entries: repo.ledgerOfUser(user.id, Number.isInteger(n) ? Math.min(200, Math.max(1, n)) : 100) };
  });

  // 資產走勢（每個遊戲日一筆快照）與股票損益彙總
  app.get("/api/me/wealth/history", async (req) => {
    const user = requireUser(req, repo, now());
    return { points: repo.wealthSnapshots(user.id, 150) };
  });
  app.get("/api/me/stock-summary", async (req) => {
    const user = requireUser(req, repo, now());
    return { ...repo.stockSummary(user.id), unrealized: service.market.portfolio(user.id).pnl };
  });

  // 法人投資：商場用公司資金買賣上市股票（只有管事的人）
  app.get("/api/me/corporate", async (req) => service.corporateView(requireUser(req, repo, now()).id));
  for (const side of ["buy", "sell"] as const) {
    app.post(`/api/malls/:id/portfolio/:key/${side}`, async (req) => {
      const user = requireUser(req, repo, now());
      const mallId = mallIdOf(req.params);
      const key = decodeURIComponent((req.params as { key: string }).key);
      const r = service.corporateTrade(user.id, mallId, key, side, body(req).shares);
      audit.record({ id: user.id, name: user.username }, `portfolio.${side}`, key, { mall: mallId, shares: r.shares, price: r.price, fee: r.fee, tax: r.tax, cash: r.cash }, req.ip);
      return r;
    });
  }

  // 股票市場：虛構集團的股票，用個人錢包買賣
  app.get("/api/market", async (req) => service.market.list(requireUser(req, repo, now()).id));
  app.get("/api/market/status", async (req) => {
    requireUser(req, repo, now());
    return service.market.status();
  });
  app.get("/api/market/news", async (req) => {
    requireUser(req, repo, now());
    const n = Number((req.query as { limit?: string }).limit);
    return { items: service.market.newsFeed(Number.isInteger(n) ? Math.min(100, Math.max(1, n)) : 40) };
  });
  app.get("/api/market/:key/history", async (req) => {
    requireUser(req, repo, now());
    const range = (req.query as { range?: string }).range;
    const ok = range === "1d" || range === "5d" || range === "1m" || range === "3m" || range === "all";
    return service.market.history(decodeURIComponent((req.params as { key: string }).key), ok ? range : "1d");
  });
  app.get("/api/me/portfolio", async (req) => service.market.portfolio(requireUser(req, repo, now()).id));
  for (const side of ["buy", "sell"] as const) {
    app.post(`/api/market/:key/${side}`, async (req) => {
      const user = requireUser(req, repo, now());
      const key = decodeURIComponent((req.params as { key: string }).key);
      const shares = body(req).shares;
      const r = side === "buy" ? service.market.buy(user.id, key, shares) : service.market.sell(user.id, key, shares);
      audit.record({ id: user.id, name: user.username }, `stock.${side}`, key, { shares: r.shares, price: r.price, fee: r.fee, tax: r.tax, cash: r.cash }, req.ip);
      return r;
    });
  }

  // 預約單：休市時下的開盤市價單
  app.post("/api/market/:key/order", async (req) => {
    const user = requireUser(req, repo, now());
    const key = decodeURIComponent((req.params as { key: string }).key);
    const b = body(req);
    const r = service.market.placeOrder(user.id, key, b.side, b.shares);
    audit.record({ id: user.id, name: user.username }, "stock.order", key, { side: r.side, shares: r.shares, order: r.id }, req.ip);
    return r;
  });
  app.post("/api/market/orders/:id/cancel", async (req) => {
    const user = requireUser(req, repo, now());
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) throw new ServiceError(400, "預約單編號不對");
    const r = service.market.cancelOrder(user.id, id);
    audit.record({ id: user.id, name: user.username }, "stock.order.cancel", r.key, { order: id }, req.ip);
    return r;
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
    if (service.authorityOf(mallId) !== member.user_id) throw new ServiceError(403, "只有管事的人（實際控制人，沒有就是創辦人）可以更換邀請碼");
    const code = newInviteCode();
    repo.setInviteCode(mallId, code);
    return { inviteCode: code };
  });

  // ── 追趕速度／暫停（任何成員都可以）：落後伺服器基準時間時用追趕速度加速，追上後一律 1×
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

  // ── 管理：開放內容的旗標
  app.post("/api/admin/malls/:id/flags", async (req) => {
    const mallId = mallIdOf(req.params);
    const b = body(req);
    const flag = str(b.flag, "flag", 3, 60);
    if (!/^(zone|feature):[a-z0-9_]+$/.test(flag) || typeof b.value !== "boolean") throw new ServiceError(400, "旗標格式不正確");
    note(req, "mall.flag", `mall#${mallId}`, { flag, value: b.value });
    return service.setFlag(mallId, flag, b.value);
  });

  // ── 玩家端：AI 事件的定義（顯示待決事件卡片要用）
  app.get("/api/content/events", async (req) => {
    requireUser(req, repo, now());
    return { events: content.publicEvents() };
  });
  // ── 玩家端：核准上線的新常客（名字、簡介與故事）
  app.get("/api/content/regulars", async (req) => {
    requireUser(req, repo, now());
    return { regulars: content.publicRegulars() };
  });

  // ── 跨商場世界：全服公開的商場名錄（真人商場＋NPC 商場）、排行榜與賽季。只有公開欄位。
  app.get("/api/world", async (req) => {
    requireUser(req, repo, now());
    return service.world.view();
  });

  // ── 聯名協議（跨商場合作）：只有該商場的成員能操作
  const memberOf = (req: Parameters<typeof requireUser>[0], params: unknown, write = true) => {
    const mallId = mallIdOf(params);
    const { user } = write ? requireMember(req, mallId) : requireReader(req, mallId);
    if (write) service.assertInWorld(mallId);
    return { user, mallId };
  };
  app.get("/api/malls/:id/world/alliances", async (req) => {
    const { mallId } = memberOf(req, req.params, false);
    // related：和你有共同經營者的真人商場（名錄用它標示「關係企業」，不能聯名、貿易、搶客）
    return { alliances: service.alliances.list(mallId), related: service.relatedMalls(mallId).map((id) => `m:${id}`) };
  });
  app.post("/api/malls/:id/world/alliance", async (req) => {
    const { mallId, user } = memberOf(req, req.params);
    const b = body(req);
    const out = service.alliances.propose(mallId, service.world.resolve(str(b.target, "target", 3, 40)));
    service.logWorld(mallId, user.display_name, "送出了一份聯名邀請（或簽下聯名協議）");
    return { alliances: out };
  });
  app.post("/api/malls/:id/world/alliance/:aid/respond", async (req) => {
    const { mallId, user } = memberOf(req, req.params);
    const b = body(req);
    if (typeof b.accept !== "boolean") throw new ServiceError(400, "請選擇接受或婉拒");
    const out = service.alliances.respond(mallId, aidOf(req.params), b.accept);
    service.logWorld(mallId, user.display_name, b.accept ? "接受了一份聯名協議" : "婉拒了一份聯名邀請");
    return { alliances: out };
  });
  app.post("/api/malls/:id/world/alliance/:aid/end", async (req) => {
    const { mallId, user } = memberOf(req, req.params);
    const out = service.alliances.end(mallId, aidOf(req.params));
    service.logWorld(mallId, user.display_name, "結束了一份聯名協議（或取消邀請）");
    return { alliances: out };
  });
  app.post("/api/malls/:id/world/compete", async (req) => {
    const { mallId, user } = memberOf(req, req.params);
    const b = body(req);
    const r = service.compete.attack(mallId, service.world.resolve(str(b.target, "target", 3, 40)), str(b.persona, "persona", 3, 12));
    service.logWorld(mallId, user.display_name, `對「${r.target}」辦了一場搶客促銷（花費 ¥${r.cost.toLocaleString("en-US")}）`);
    return r;
  });
  app.post("/api/malls/:id/world/trade/funds", async (req) => {
    const { mallId, user } = memberOf(req, req.params);
    const b = body(req);
    const r = service.trade.sendFunds(mallId, service.world.resolve(str(b.target, "target", 3, 40)), Number(b.amount));
    service.logWorld(mallId, user.display_name, `送出支援資金 ¥${r.sent.toLocaleString("en-US")}`);
    return r;
  });
  app.post("/api/malls/:id/world/trade/goods", async (req) => {
    const { mallId, user } = memberOf(req, req.params);
    const b = body(req);
    const r = service.trade.sendGoods(mallId, service.world.resolve(str(b.target, "target", 3, 40)), str(b.shopId, "shopId", 1, 40), Number(b.qty));
    service.logWorld(mallId, user.display_name, `調了 ${r.sent} 份貨給友好商場${r.rescue ? "（缺貨救援）" : ""}`);
    return r;
  });
  app.post("/api/malls/:id/world/alliance/:aid/joint", async (req) => {
    const { mallId, user } = memberOf(req, req.params);
    const out = service.alliances.joint(mallId, aidOf(req.params));
    service.logWorld(mallId, user.display_name, `辦了一場聯名活動（花費 ¥${out.cost.toLocaleString("en-US")}）`);
    return { alliances: out.views, cost: out.cost };
  });

  // ── AI 內容管理
  app.get("/api/admin/ai/status", async (req) => {
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
        brand: repo.contentCount("brand", "active"),
        dish: repo.contentCount("dish", "active"),
        regularActive: repo.contentCount("regular", "active"),
        regularPending: repo.contentCount("regular", "pending"),
      },
      recent: repo.ledgerRecent(10),
    };
  });
  app.get("/api/admin/ai/items", async (req) => {
    const q = req.query as { kind?: string; status?: string };
    return { items: repo.contentList(q.kind ?? null, q.status ?? null, 100) };
  });
  app.post("/api/admin/ai/generate", async (req) => {
    const b = body(req);
    if (!["news", "review", "event", "brand", "dish", "regular"].includes(b.kind as string)) throw new ServiceError(400, "kind 無效");
    const count = typeof b.count === "number" ? Math.min(20, Math.max(1, Math.floor(b.count))) : undefined;
    note(req, "ai.generate", String(b.kind), { count });
    return content.generate(b.kind as ContentKind, count);
  });
  app.post("/api/admin/ai/events/:id/:action", async (req) => {
    const p = req.params as { id: string; action: string };
    const id = Number(p.id);
    const ok = p.action === "approve" ? content.approveEvent(id) : p.action === "reject" ? content.rejectEvent(id) : false;
    note(req, `ai.event.${p.action}`, `content#${id}`);
    if (!ok) throw new ServiceError(400, "找不到這個事件，或狀態不允許這個操作");
    return { ok: true };
  });
  app.post("/api/admin/ai/items/:id/remove", async (req) => {
    note(req, "ai.remove", `content#${(req.params as { id: string }).id}`);
    if (!content.removeText(Number((req.params as { id: string }).id))) throw new ServiceError(400, "找不到這則內容");
    return { ok: true };
  });

  // ── 管理後台：概況、商場與使用者
  app.get("/api/admin/overview", async (req) => {
    return {
      users: repo.allUsers(),
      serverTick: service.serverTick(),
      malls: repo.allMalls().map((m) => ({ ...m, online: service.connectionsOf(m.id), members_list: repo.members(m.id), ...(service.summary(m.id) ?? { level: 0, funds: 0, tick: 0, day: 0, flags: {}, lag: null, paused: false }) })),
    };
  });
  app.post("/api/admin/users/:id/reset-password", async (req) => {
    const id = Number((req.params as { id: string }).id);
    const target = repo.userById(id);
    if (!target) throw new ServiceError(404, "找不到這位使用者");
    if (target.role === "overseer") throw new ServiceError(400, "Overseer 沒有密碼，要換金鑰請用伺服器上的指令列");
    note(req, "user.reset-password", `user#${id}(${target.username})`);
    const temp = randomBytes(9).toString("base64url");
    repo.setPassHash(id, await hashPassword(temp));
    repo.deleteSessionsOfUser(id);
    return { tempPassword: temp };
  });
  app.post("/api/admin/users/:id/delete", async (req) => {
    const id = Number((req.params as { id: string }).id);
    const target = repo.userById(id);
    if (!target) throw new ServiceError(404, "找不到這位使用者");
    if (target.role === "overseer") throw new ServiceError(400, "不能刪除 Overseer 帳號");
    note(req, "user.delete", `user#${id}(${target.username})`);
    service.adminDeleteUser(id);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/delete", async (req) => {
    const id = Number((req.params as { id: string }).id);
    const mall = repo.mallById(id);
    if (!mall) throw new ServiceError(404, "找不到這座商場");
    note(req, "mall.dissolve", `mall#${id}(${mall.name})`);
    service.dissolveMall(id);
    return { ok: true };
  });

  // ── 商場與成員管理
  const idParam = (req: { params: unknown }, name = "id"): number => {
    const id = Number((req.params as Record<string, string>)[name]);
    if (!Number.isInteger(id) || id < 1) throw new ServiceError(400, "編號無效");
    return id;
  };
  const mallLabel = (id: number): string => `mall#${id}(${repo.mallById(id)?.name ?? "?"})`;
  const userLabel = (id: number): string => `user#${id}(${repo.userById(id)?.username ?? "?"})`;

  app.post("/api/admin/users/:id/rename", async (req) => {
    const id = idParam(req);
    if (!repo.userById(id)) throw new ServiceError(404, "找不到這位使用者");
    const name = str(body(req).displayName, "暱稱", 1, 20);
    note(req, "user.rename", userLabel(id), { displayName: name });
    repo.setDisplayName(id, name);
    for (const m of repo.mallsOfUser(id)) service.announceMembersOf(m.id);
    return { ok: true };
  });
  app.post("/api/admin/users/:id/logout", async (req) => {
    const id = idParam(req);
    if (!repo.userById(id)) throw new ServiceError(404, "找不到這位使用者");
    note(req, "user.logout-all", userLabel(id));
    repo.deleteSessionsOfUser(id);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/rename", async (req) => {
    const id = idParam(req);
    const name = str(body(req).name, "商場名稱", 1, 30);
    note(req, "mall.rename", mallLabel(id), { name });
    service.adminRenameMall(id, name);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/funds", async (req) => {
    const id = idParam(req);
    const funds = body(req).funds;
    if (typeof funds !== "number") throw new ServiceError(400, "金額不正確");
    note(req, "mall.funds", mallLabel(id), { funds });
    service.adminSetFunds(id, funds);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/level", async (req) => {
    const id = idParam(req);
    const level = body(req).level;
    if (typeof level !== "number") throw new ServiceError(400, "等級不正確");
    note(req, "mall.level", mallLabel(id), { level });
    service.adminSetLevel(id, level);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/clock", async (req) => {
    const id = idParam(req);
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
    note(req, "mall.clock", mallLabel(id), patch);
    const a = req.actor!;
    service.setClock(id, { id: a.id, displayName: "Overseer" }, patch);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/notice", async (req) => {
    const id = idParam(req);
    const text = str(body(req).text, "通知內容", 4, 120);
    note(req, "mall.notice", mallLabel(id), { text });
    service.adminNotice(id, text);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/members", async (req) => {
    const id = idParam(req);
    const b = body(req);
    const uid = typeof b.userId === "number" ? b.userId : NaN;
    if (!Number.isInteger(uid)) throw new ServiceError(400, "使用者編號無效");
    const role = typeof b.role === "string" && ROLE_IDS.includes(b.role) ? (b.role as RoleId) : "ops";
    note(req, "mall.member-add", `${mallLabel(id)} ← ${userLabel(uid)}`, { role });
    service.adminAddMember(id, uid, role);
    return { ok: true };
  });
  app.post("/api/admin/malls/:id/members/:uid/remove", async (req) => {
    const id = idParam(req);
    const uid = idParam(req, "uid");
    note(req, "mall.member-remove", `${mallLabel(id)} ✕ ${userLabel(uid)}`);
    service.adminRemoveMember(id, uid);
    return { ok: true };
  });
  // 只跑一次：把已經在營運、成員沒各自投入起始資金的商場補成每人一份，股份均分
  app.post("/api/admin/malls/:id/settle-grants", async (req) => {
    const id = idParam(req);
    note(req, "mall.settle-grants", mallLabel(id));
    return service.adminSettleGrants(id);
  });
  app.post("/api/admin/malls/:id/owner", async (req) => {
    const id = idParam(req);
    const rawUid = body(req).userId;
    const uid = typeof rawUid === "number" ? rawUid : NaN;
    if (!Number.isInteger(uid)) throw new ServiceError(400, "使用者編號無效");
    note(req, "mall.owner", `${mallLabel(id)} → ${userLabel(uid)}`);
    service.adminSetOwner(id, uid);
    return { ok: true };
  });

  // ── 隨機事件：Overseer 手寫、上下架、對商場觸發
  const targetsOf = (v: unknown): "all" | number[] => {
    if (v === "all") return "all";
    if (Array.isArray(v) && v.length > 0 && v.length <= 200 && v.every((x) => Number.isInteger(x) && x > 0)) return v as number[];
    throw new ServiceError(400, "請選擇要套用的商場（全部，或指定幾座）");
  };
  app.get("/api/admin/events", async () => ({
    events: repo.contentList("event", null, 500).map((r) => ({ id: r.id, status: r.status, model: r.model, createdAt: r.created_at, def: r.payload })),
    catalog: EVENTS.map((e) => ({ id: e.id, title: e.title, category: e.category, hasChoice: !!e.choice, source: e.id.startsWith("ov_") ? "overseer" : e.id.startsWith("ai_") ? "ai" : "builtin" })),
  }));
  app.post("/api/admin/events", async (req) => {
    const b = body(req);
    note(req, "event.create", String((b.event as { title?: unknown } | undefined)?.title ?? ""));
    try {
      return content.addManualEvent(b.event);
    } catch (e) {
      throw new ServiceError(400, e instanceof Error ? e.message : "事件格式不正確");
    }
  });
  app.post("/api/admin/events/:id/retire", async (req) => {
    const id = idParam(req);
    note(req, "event.retire", `content#${id}`);
    if (!content.rejectEvent(id)) throw new ServiceError(400, "找不到這個事件，或狀態不允許這個操作");
    return { ok: true };
  });
  app.post("/api/admin/events/:id/activate", async (req) => {
    const id = idParam(req);
    note(req, "event.activate", `content#${id}`);
    if (!content.activateEvent(id)) throw new ServiceError(400, "只有已下架的事件可以重新上線");
    return { ok: true };
  });
  app.post("/api/admin/events/trigger", async (req) => {
    const b = body(req);
    const eventId = str(b.eventId, "事件", 3, 60);
    if (!EVENTS.some((e) => e.id === eventId)) throw new ServiceError(404, "找不到這個事件");
    const malls = targetsOf(b.malls);
    note(req, "event.trigger", eventId, { malls });
    return { sent: service.adminBroadcast(malls, "admin_event", { eventId }) };
  });

  // ── 天氣：對全部（不含測試商場）或指定商場套用一段天氣
  app.post("/api/admin/weather", async (req) => {
    const b = body(req);
    const kind = typeof b.kind === "string" && b.kind in WEATHER_NAMES ? b.kind : null;
    if (!kind) throw new ServiceError(400, "天氣種類不正確");
    const temp = typeof b.temp === "number" && Number.isFinite(b.temp) ? Math.round(Math.min(42, Math.max(-10, b.temp))) : 22;
    const hours = typeof b.hours === "number" && Number.isFinite(b.hours) ? Math.min(72, Math.max(1, b.hours)) : 12;
    const malls = targetsOf(b.malls);
    note(req, "weather.set", malls === "all" ? "all" : `malls:${malls.join(",")}`, { kind, temp, hours });
    return { sent: service.adminBroadcast(malls, "admin_weather", { kind, temp, ticks: Math.round(hours * 12) }) };
  });

  // ── NPC 商場：調整、自動出手設定、手動出手
  const npcIdParam = (req: { params: unknown }): string => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!NPC_BY_ID[id]) throw new ServiceError(404, "找不到這座 NPC 商場");
    return id;
  };
  const npcActionView = (r: { id: number; ts: number; npc_id: string; action: string; target_key: string; detail: string; manual: number }) => ({
    id: r.id,
    ts: r.ts,
    npcId: r.npc_id,
    npcName: service.world.npc.entryAny(r.npc_id)?.name ?? r.npc_id,
    action: r.action,
    target: r.target_key.startsWith("#") ? r.target_key : (service.world.entries().find((e) => e.key === r.target_key)?.name ?? r.target_key),
    detail: r.detail,
    manual: r.manual === 1,
  });
  app.get("/api/admin/npc", async () => {
    const t = now();
    const rows = service.world.npc.overrideRows();
    return {
      settings: { auto: service.world.npc.auto(), activity: service.world.npc.activity(), baseProbPerHour: NPC_BASE_P },
      npcs: NPC_MALLS.map((def) => {
        const e = service.world.npc.entryAny(def.id, t)!;
        const ov = rows.find((r) => r.npcId === def.id);
        return {
          id: def.id,
          publicKey: publicKey(`n:${def.id}`),
          baseName: def.name,
          entry: { name: e.name, level: e.level, stars: e.stars, score: e.score, localRep: e.localRep, touristHeat: e.touristHeat, revenue30: e.revenue30, shops: e.shops, stockouts: e.stockouts },
          override: ov?.override ?? null,
          expiresAt: ov?.expiresAt ?? 0,
          pending: service.npcActor.pendingOf(def.id),
          actions24h: repo.npcActionCount(def.id, null, t - 86_400_000),
          recent: repo.npcActions(5, def.id).map(npcActionView),
        };
      }),
    };
  });
  app.get("/api/admin/npc/actions", async (req) => {
    const limit = Math.min(200, Math.max(1, Number((req.query as { limit?: string }).limit) || 50));
    return { actions: repo.npcActions(limit).map(npcActionView) };
  });
  app.post("/api/admin/npc/settings", async (req) => {
    const b = body(req);
    if (b.auto !== undefined) {
      if (typeof b.auto !== "boolean") throw new ServiceError(400, "auto 格式不正確");
      service.world.npc.setAuto(b.auto);
    }
    if (b.activity !== undefined) {
      if (typeof b.activity !== "number" || !Number.isFinite(b.activity)) throw new ServiceError(400, "activity 格式不正確");
      service.world.npc.setActivity(b.activity);
    }
    note(req, "npc.settings", "", { auto: b.auto, activity: b.activity });
    return { auto: service.world.npc.auto(), activity: service.world.npc.activity() };
  });
  app.post("/api/admin/npc/:id/override", async (req) => {
    const id = npcIdParam(req);
    const b = body(req);
    const hours = typeof b.hours === "number" && b.hours > 0 ? Math.min(24 * 365, b.hours) : 0;
    note(req, "npc.override", `npc:${id}`, { override: b.override, hours });
    const ov = service.world.npc.set(id, b.override, hours > 0 ? now() + hours * 3_600_000 : 0);
    return { override: ov };
  });
  app.post("/api/admin/npc/:id/clear", async (req) => {
    const id = npcIdParam(req);
    note(req, "npc.clear", `npc:${id}`);
    service.world.npc.clear(id);
    return { ok: true };
  });
  app.post("/api/admin/npc/:id/act", async (req) => {
    const id = npcIdParam(req);
    const b = body(req) as Record<string, unknown>;
    const act: ManualAction = {
      action: b.action as ManualAction["action"],
      target: typeof b.target === "string" ? b.target : undefined,
      persona: typeof b.persona === "string" ? b.persona : undefined,
      allianceId: typeof b.allianceId === "number" ? b.allianceId : undefined,
      accept: typeof b.accept === "boolean" ? b.accept : undefined,
      ignoreLimits: b.ignoreLimits === true,
    };
    note(req, "npc.act", `npc:${id}`, { ...act });
    return { message: service.npcActor.manual(id, act) };
  });

  // ── 營運與玩家數據
  app.get("/api/admin/metrics/live", async () => ({ now: metrics.live(), recent: repo.samples(now() - 3 * 3_600_000, now() + 1, 200) }));
  app.get("/api/admin/metrics", async (req) => {
    const q = req.query as { from?: string; to?: string; limit?: string };
    const to = Number(q.to) || now() + 1;
    const from = Number(q.from) || to - 24 * 3_600_000;
    const limit = Math.min(5000, Math.max(10, Number(q.limit) || 1500));
    const rows = repo.samples(from, to, 50_000);
    // 區間太長時等距抽樣，免得圖表與傳輸太大
    const step = Math.max(1, Math.ceil(rows.length / limit));
    return { from, to, samples: rows.filter((_, i) => i % step === 0) };
  });
  app.get("/api/admin/metrics/daily", async (req) => {
    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days) || 30));
    return { days: repo.dailyStats(days).reverse() };
  });
  app.get("/api/admin/metrics/export", async (req, reply) => {
    const q = req.query as { kind?: string; format?: string; from?: string; to?: string };
    const kind = q.kind === "daily" ? "daily" : "samples";
    const format = q.format === "json" ? "json" : "csv";
    const to = Number(q.to) || now() + 1;
    const from = Number(q.from) || to - 7 * 86_400_000;
    note(req, "metrics.export", kind, { format, from, to });
    const stamp = new Date(now()).toISOString().slice(0, 10);
    const rows = kind === "daily" ? (repo.dailyStats(3650).reverse() as unknown as DailyStat[]) : (repo.samples(from, to, 200_000) as unknown as MetricsSample[]);
    reply.header("content-disposition", `attachment; filename="coidle-${kind}-${stamp}.${format}"`);
    if (format === "json") return reply.type("application/json").send(JSON.stringify(rows));
    return reply.type("text/csv; charset=utf-8").send(kind === "daily" ? dailyCsv(rows as DailyStat[]) : sampleCsv(rows as MetricsSample[]));
  });

  // ── 平衡數據：每座商場每個遊戲日一列（永久保存），給管理室看圖與匯出
  const balanceRange = (q: { days?: string; from?: string; to?: string; mall?: string }) => {
    // day 是遊戲日序；沒指定 from 就取「最近 days 個遊戲日」（預設 60）
    const all = repo.balanceRows(0, 1e9, q.mall ? Number(q.mall) : undefined);
    const maxDay = all.reduce((a, r) => Math.max(a, r.day), 0);
    const fromDay = Number(q.from) || maxDay - (Math.min(3650, Math.max(1, Number(q.days) || 60)) - 1);
    const toDay = Number(q.to) || Infinity;
    return all.filter((r) => r.day >= fromDay && r.day <= toDay);
  };
  app.get("/api/admin/balance", async (req) => {
    const rows = balanceRange(req.query as never).slice(-8000);
    const names = new Map(repo.allMalls().map((m) => [m.id, m]));
    return {
      malls: [...new Set(rows.map((r) => r.mall_id))].map((id) => ({ id, name: names.get(id)?.name ?? `（已解散 #${id}）`, sandbox: names.get(id)?.sandbox ?? 0 })),
      rows: rows.map((r) => ({ ...r, detail: JSON.parse(r.detail_json) as unknown, detail_json: undefined })),
    };
  });
  app.get("/api/admin/balance/export", async (req, reply) => {
    const q = req.query as { kind?: string; format?: string; days?: string; from?: string; to?: string; mall?: string };
    const kind = q.kind === "shop" ? "shop" : "mall";
    const format = q.format === "json" ? "json" : "csv";
    const rows = balanceRange(q);
    note(req, "balance.export", kind, { format, rows: rows.length });
    const stamp = new Date(now()).toISOString().slice(0, 10);
    reply.header("content-disposition", `attachment; filename="coidle-balance-${kind}-${stamp}.${format}"`);
    if (format === "json") return reply.type("application/json").send(JSON.stringify(rows.map((r) => ({ ...r, detail: JSON.parse(r.detail_json) as unknown, detail_json: undefined }))));
    return reply.type("text/csv; charset=utf-8").send(kind === "shop" ? balanceShopCsv(rows) : balanceCsv(rows));
  });

  // ── 稽核紀錄：查詢（最新在前）；before 是上一頁最後一筆的 id
  app.get("/api/admin/audit", async (req) => {
    const q = req.query as { limit?: string; before?: string; action?: string; actor?: string; since?: string; until?: string };
    const num = (v?: string) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const rows = repo.audit({
      limit: Math.min(500, Math.max(1, num(q.limit) ?? 100)),
      before: num(q.before),
      action: q.action || undefined,
      actor: q.actor || undefined,
      since: num(q.since),
      until: num(q.until),
    });
    return { entries: rows.map((r) => ({ id: r.id, ts: r.ts, actor: r.actor_name, actorId: r.actor_id, action: r.action, target: r.target, detail: JSON.parse(r.detail) as unknown, ip: r.ip })) };
  });
}
