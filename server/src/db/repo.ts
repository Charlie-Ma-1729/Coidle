import type { ActivityEntry, MemberInfo, RoleId } from "@coidle/shared";
import type { Db } from "./db";

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  pass_hash: string;
}

export interface MallRow {
  id: number;
  name: string;
  invite_code: string;
  seed: number;
  created_at: number;
}

export interface MembershipRow {
  mall_id: number;
  user_id: number;
  role: RoleId;
  is_owner: number;
}

/** 薄薄一層資料存取；所有 SQL 都集中在這裡。node:sqlite 是同步 API。 */
export class Repo {
  constructor(readonly db: Db) {}

  // ── users
  createUser(username: string, displayName: string, passHash: string, now: number): number {
    const r = this.db
      .prepare("INSERT INTO users (username, username_lc, display_name, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(username, username.toLowerCase(), displayName, passHash, now);
    return Number(r.lastInsertRowid);
  }
  userByName(username: string): UserRow | undefined {
    return this.db.prepare("SELECT id, username, display_name, pass_hash FROM users WHERE username_lc = ?").get(username.toLowerCase()) as UserRow | undefined;
  }
  userById(id: number): UserRow | undefined {
    return this.db.prepare("SELECT id, username, display_name, pass_hash FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }

  // ── sessions
  createSession(tokenHash: string, userId: number, expiresAt: number): void {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
  }
  sessionUser(tokenHash: string, now: number): UserRow | undefined {
    return this.db
      .prepare(
        "SELECT u.id, u.username, u.display_name, u.pass_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
      )
      .get(tokenHash, now) as UserRow | undefined;
  }
  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }
  purgeExpiredSessions(now: number): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }

  // ── malls
  createMall(name: string, inviteCode: string, seed: number, now: number): number {
    const r = this.db.prepare("INSERT INTO malls (name, invite_code, seed, created_at) VALUES (?, ?, ?, ?)").run(name, inviteCode, seed, now);
    return Number(r.lastInsertRowid);
  }
  mallById(id: number): MallRow | undefined {
    return this.db.prepare("SELECT id, name, invite_code, seed, created_at FROM malls WHERE id = ?").get(id) as MallRow | undefined;
  }
  mallByCode(code: string): MallRow | undefined {
    return this.db.prepare("SELECT id, name, invite_code, seed, created_at FROM malls WHERE invite_code = ?").get(code) as MallRow | undefined;
  }
  allMallIds(): number[] {
    return (this.db.prepare("SELECT id FROM malls").all() as { id: number }[]).map((r) => r.id);
  }
  setInviteCode(mallId: number, code: string): void {
    this.db.prepare("UPDATE malls SET invite_code = ? WHERE id = ?").run(code, mallId);
  }

  // ── memberships
  addMember(mallId: number, userId: number, role: RoleId, isOwner: boolean, now: number): void {
    this.db
      .prepare("INSERT INTO memberships (mall_id, user_id, role, is_owner, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(mallId, userId, role, isOwner ? 1 : 0, now);
  }
  member(mallId: number, userId: number): MembershipRow | undefined {
    return this.db
      .prepare("SELECT mall_id, user_id, role, is_owner FROM memberships WHERE mall_id = ? AND user_id = ?")
      .get(mallId, userId) as MembershipRow | undefined;
  }
  memberCount(mallId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE mall_id = ?").get(mallId) as { n: number }).n;
  }
  setRole(mallId: number, userId: number, role: RoleId): void {
    this.db.prepare("UPDATE memberships SET role = ? WHERE mall_id = ? AND user_id = ?").run(role, mallId, userId);
  }
  members(mallId: number): MemberInfo[] {
    const rows = this.db
      .prepare(
        "SELECT m.user_id, u.display_name, m.role, m.is_owner, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.mall_id = ? ORDER BY m.joined_at, m.user_id",
      )
      .all(mallId) as { user_id: number; display_name: string; role: RoleId; is_owner: number; joined_at: number }[];
    return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, role: r.role, isOwner: r.is_owner === 1, joinedAt: r.joined_at }));
  }
  mallsOfUser(userId: number): { id: number; name: string; role: RoleId; is_owner: number }[] {
    return this.db
      .prepare("SELECT ma.id, ma.name, m.role, m.is_owner FROM memberships m JOIN malls ma ON ma.id = m.mall_id WHERE m.user_id = ? ORDER BY m.joined_at")
      .all(userId) as { id: number; name: string; role: RoleId; is_owner: number }[];
  }

  // ── mall state
  saveState(mallId: number, tick: number, json: string, now: number): void {
    this.db
      .prepare(
        "INSERT INTO mall_state (mall_id, tick, state_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(mall_id) DO UPDATE SET tick = excluded.tick, state_json = excluded.state_json, updated_at = excluded.updated_at",
      )
      .run(mallId, tick, json, now);
  }
  loadState(mallId: number): string | undefined {
    const r = this.db.prepare("SELECT state_json FROM mall_state WHERE mall_id = ?").get(mallId) as { state_json: string } | undefined;
    return r?.state_json;
  }

  // ── push subscriptions
  addPushSub(userId: number, endpoint: string, p256dh: string, auth: string, now: number): void {
    this.db
      .prepare(
        "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth",
      )
      .run(userId, endpoint, p256dh, auth, now);
  }
  removePushSub(endpoint: string, userId?: number): void {
    if (userId === undefined) this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    else this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, userId);
  }
  pushSubsForMall(mallId: number): { endpoint: string; p256dh: string; auth: string }[] {
    return this.db
      .prepare(
        "SELECT p.endpoint, p.p256dh, p.auth FROM push_subscriptions p JOIN memberships m ON m.user_id = p.user_id WHERE m.mall_id = ?",
      )
      .all(mallId) as { endpoint: string; p256dh: string; auth: string }[];
  }

  // ── activity feed
  addActivity(mallId: number, ts: number, actor: string, text: string): ActivityEntry {
    const r = this.db.prepare("INSERT INTO activity (mall_id, ts, actor, text) VALUES (?, ?, ?, ?)").run(mallId, ts, actor, text);
    // 只保留最近 500 筆
    this.db.prepare("DELETE FROM activity WHERE mall_id = ? AND id <= ?").run(mallId, Number(r.lastInsertRowid) - 500);
    return { id: Number(r.lastInsertRowid), ts, actor, text };
  }
  activity(mallId: number, limit: number): ActivityEntry[] {
    return this.db
      .prepare("SELECT id, ts, actor, text FROM activity WHERE mall_id = ? ORDER BY id DESC LIMIT ?")
      .all(mallId, limit) as unknown as ActivityEntry[];
  }

  // ── meta
  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  // ── LLM 用量帳本
  addLedger(e: { ts: number; purpose: string; model: string; promptTokens: number; completionTokens: number; costUsd: number; ok: boolean; note?: string }): void {
    this.db
      .prepare("INSERT INTO llm_ledger (ts, purpose, model, prompt_tokens, completion_tokens, cost_usd, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.ts, e.purpose, e.model, e.promptTokens, e.completionTokens, e.costUsd, e.ok ? 1 : 0, e.note ?? null);
  }
  ledgerSpent(fromMs: number, toMs: number): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM llm_ledger WHERE ts >= ? AND ts < ?").get(fromMs, toMs) as { s: number };
    return r.s;
  }
  ledgerCalls(fromMs: number, toMs: number): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM llm_ledger WHERE ts >= ? AND ts < ?").get(fromMs, toMs) as { n: number };
    return r.n;
  }
  ledgerRecent(limit: number): { ts: number; purpose: string; model: string; cost_usd: number; ok: number; note: string | null }[] {
    return this.db.prepare("SELECT ts, purpose, model, cost_usd, ok, note FROM llm_ledger ORDER BY id DESC LIMIT ?").all(limit) as never;
  }

  // ── 內容池
  /** 回傳 false 代表內容已存在（以雜湊去重） */
  addContent(kind: string, status: string, hash: string, payload: unknown, model: string | null, now: number): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO content_pool (kind, status, hash, payload, model, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(kind, status, hash, JSON.stringify(payload), model, now);
    return Number(r.changes) > 0;
  }
  contentList(kind: string | null, status: string | null, limit = 200): { id: number; kind: string; status: string; payload: unknown; model: string | null; created_at: number }[] {
    const rows = this.db
      .prepare("SELECT id, kind, status, payload, model, created_at FROM content_pool WHERE (? IS NULL OR kind = ?) AND (? IS NULL OR status = ?) ORDER BY id DESC LIMIT ?")
      .all(kind, kind, status, status, limit) as { id: number; kind: string; status: string; payload: string; model: string | null; created_at: number }[];
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown }));
  }
  contentCount(kind: string, status: string): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM content_pool WHERE kind = ? AND status = ?").get(kind, status) as { n: number };
    return r.n;
  }
  setContentStatus(id: number, status: string): boolean {
    return Number(this.db.prepare("UPDATE content_pool SET status = ? WHERE id = ?").run(status, id).changes) > 0;
  }

  // ── 帳號與商場管理
  setDisplayName(userId: number, name: string): void {
    this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(name, userId);
  }
  setPassHash(userId: number, hash: string): void {
    this.db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(hash, userId);
  }
  /** 刪除這位使用者的登入 session；exceptHash 是目前這個（改密碼後保留，其他裝置全部登出） */
  deleteSessionsOfUser(userId: number, exceptHash?: string): void {
    if (exceptHash) this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, exceptHash);
    else this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
  deleteUser(userId: number): void {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
  removeMember(mallId: number, userId: number): void {
    this.db.prepare("DELETE FROM memberships WHERE mall_id = ? AND user_id = ?").run(mallId, userId);
  }
  setOwner(mallId: number, userId: number, owner: boolean): void {
    this.db.prepare("UPDATE memberships SET is_owner = ? WHERE mall_id = ? AND user_id = ?").run(owner ? 1 : 0, mallId, userId);
  }
  renameMall(mallId: number, name: string): void {
    this.db.prepare("UPDATE malls SET name = ? WHERE id = ?").run(name, mallId);
  }
  deleteMall(mallId: number): void {
    this.db.prepare("DELETE FROM malls WHERE id = ?").run(mallId);
  }
  allUsers(): { id: number; username: string; display_name: string; created_at: number }[] {
    return this.db.prepare("SELECT id, username, display_name, created_at FROM users ORDER BY id").all() as never;
  }
  allMalls(): { id: number; name: string; created_at: number; members: number }[] {
    return this.db
      .prepare("SELECT m.id, m.name, m.created_at, (SELECT COUNT(*) FROM memberships x WHERE x.mall_id = m.id) AS members FROM malls m ORDER BY m.id")
      .all() as never;
  }

  // ── 跨商場世界：公開名錄、賽季、信箱
  upsertDirectory(row: { mallId: number; name: string; level: number; stars: number; score: number; localRep: number; touristHeat: number; revenue30: number; shops: number; topCategory: string; createdAt: number; updatedAt: number }): void {
    this.db
      .prepare(
        `INSERT INTO mall_directory (mall_id, name, level, stars, score, local_rep, tourist_heat, revenue30, shops, top_category, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mall_id) DO UPDATE SET name = excluded.name, level = excluded.level, stars = excluded.stars, score = excluded.score,
           local_rep = excluded.local_rep, tourist_heat = excluded.tourist_heat, revenue30 = excluded.revenue30, shops = excluded.shops,
           top_category = excluded.top_category, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      )
      .run(row.mallId, row.name, row.level, row.stars, row.score, row.localRep, row.touristHeat, row.revenue30, row.shops, row.topCategory, row.createdAt, row.updatedAt);
  }
  directoryRows(): { mall_id: number; name: string; level: number; stars: number; score: number; local_rep: number; tourist_heat: number; revenue30: number; shops: number; top_category: string; created_at: number; updated_at: number }[] {
    return this.db.prepare("SELECT * FROM mall_directory ORDER BY mall_id").all() as never;
  }
  seasonResult(season: number): string | null {
    const r = this.db.prepare("SELECT result_json FROM seasons WHERE season = ?").get(season) as { result_json: string } | undefined;
    return r?.result_json ?? null;
  }
  saveSeason(season: number, settledAt: number, json: string): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO seasons (season, settled_at, result_json) VALUES (?, ?, ?)").run(season, settledAt, json).changes) > 0;
  }
  latestSeasons(limit: number): { season: number; settled_at: number; result_json: string }[] {
    return this.db.prepare("SELECT season, settled_at, result_json FROM seasons ORDER BY season DESC LIMIT ?").all(limit) as never;
  }
  addMail(toMall: number, kind: string, payload: unknown, createdAt: number, deliverAt: number): number {
    const r = this.db.prepare("INSERT INTO mall_mailbox (to_mall, kind, payload, created_at, deliver_at) VALUES (?, ?, ?, ?, ?)").run(toMall, kind, JSON.stringify(payload), createdAt, deliverAt);
    return Number(r.lastInsertRowid);
  }
  dueMail(toMall: number, now: number): { id: number; kind: string; payload: Record<string, unknown> }[] {
    const rows = this.db.prepare("SELECT id, kind, payload FROM mall_mailbox WHERE to_mall = ? AND status = 'pending' AND deliver_at <= ? ORDER BY id LIMIT 50").all(toMall, now) as { id: number; kind: string; payload: string }[];
    return rows.map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  }
  markMailDelivered(ids: number[]): void {
    const st = this.db.prepare("UPDATE mall_mailbox SET status = 'delivered' WHERE id = ?");
    for (const id of ids) st.run(id);
  }
  pendingMailCount(toMall: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM mall_mailbox WHERE to_mall = ? AND status = 'pending'").get(toMall) as { n: number }).n;
  }
}
