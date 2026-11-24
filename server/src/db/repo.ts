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
}
