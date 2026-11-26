import { DEFAULT_SERVER_CLOCK, INITIAL_SHARES, serverTickAt, type ActivityEntry, type LedgerEntry, type LedgerKind, type MemberInfo, type RoleId, type ServerClock } from "@coidle/shared";
import type { Db } from "./db";

export type UserRole = "player" | "overseer";

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  pass_hash: string;
  role: UserRole;
}

export interface AuditRow {
  id: number;
  ts: number;
  actor_id: number | null;
  actor_name: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
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
/** balance_daily 的一列（平衡分析用；day 是遊戲日序，自 1970-01-01 起算） */
export interface BalanceRow {
  mall_id: number;
  day: number;
  recorded_at: number;
  level: number;
  shops: number;
  members: number;
  funds: number | null;
  revenue: number;
  profit: number;
  purchases: number;
  fixed: number;
  groups: number;
  units: number;
  walkouts: number;
  lost_capacity: number;
  stockouts: number;
  price_walks: number;
  local_rep: number;
  tourist_heat: number;
  avg_sat: number | null;
  price_ratio: number | null;
  detail_json: string;
}

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
    return this.db.prepare("SELECT id, username, display_name, pass_hash, role FROM users WHERE username_lc = ?").get(username.toLowerCase()) as UserRow | undefined;
  }
  userById(id: number): UserRow | undefined {
    return this.db.prepare("SELECT id, username, display_name, pass_hash, role FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }
  /** 建立 Overseer（世界管理者）帳號：keyHash 是登入金鑰的雜湊 */
  createOverseer(username: string, displayName: string, keyHash: string, now: number): number {
    const r = this.db
      .prepare("INSERT INTO users (username, username_lc, display_name, pass_hash, created_at, role) VALUES (?, ?, ?, ?, ?, 'overseer')")
      .run(username, username.toLowerCase(), displayName, keyHash, now);
    return Number(r.lastInsertRowid);
  }
  overseers(): UserRow[] {
    return this.db.prepare("SELECT id, username, display_name, pass_hash, role FROM users WHERE role = 'overseer' ORDER BY id").all() as unknown as UserRow[];
  }
  /** 已登入使用者的「最後上線」：每位使用者最多每分鐘寫一次 */
  touchSeen(userId: number, now: number): void {
    this.db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?").run(now, userId, now - 60_000);
  }

  // ── sessions
  createSession(tokenHash: string, userId: number, expiresAt: number): void {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
  }
  sessionUser(tokenHash: string, now: number): UserRow | undefined {
    return this.db
      .prepare(
        "SELECT u.id, u.username, u.display_name, u.pass_hash, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
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
        `SELECT m.user_id, u.display_name, m.role, m.is_owner, m.joined_at, m.last_active_at, COALESCE(h.shares, 0) * 2 > (ma.total_shares - ma.treasury_shares) AS ctrl
         FROM memberships m JOIN users u ON u.id = m.user_id JOIN malls ma ON ma.id = m.mall_id
         LEFT JOIN holdings h ON h.mall_id = m.mall_id AND h.user_id = m.user_id
         WHERE m.mall_id = ? ORDER BY m.joined_at, m.user_id`,
      )
      .all(mallId) as { user_id: number; display_name: string; role: RoleId; is_owner: number; joined_at: number; last_active_at: number; ctrl: number }[];
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      role: r.role,
      isOwner: r.is_owner === 1,
      isController: r.ctrl === 1,
      joinedAt: r.joined_at,
      lastActiveAt: r.last_active_at,
    }));
  }
  /** 這位成員剛剛在這座商場（只往後記，不會倒退） */
  touchMember(mallId: number, userId: number, now: number): void {
    this.db.prepare("UPDATE memberships SET last_active_at = ? WHERE mall_id = ? AND user_id = ? AND last_active_at < ?").run(now, mallId, userId, now);
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
  /** 把成員移出商場；給了 now 就留下離開紀錄（關係企業的判斷會把剛離開的人也算進去） */
  removeMember(mallId: number, userId: number, now?: number): void {
    const had = this.member(mallId, userId);
    this.db.prepare("DELETE FROM memberships WHERE mall_id = ? AND user_id = ?").run(mallId, userId);
    if (had && now !== undefined) this.db.prepare("INSERT INTO membership_trail (mall_id, user_id, left_at) VALUES (?, ?, ?)").run(mallId, userId, now);
  }
  /**
   * 兩座商場是不是關係企業：有同一位玩家是現任成員，或在 since 之後離開過。
   * 不分角色（一般成員也算），因為任何成員都能對商場下指令。
   */
  areRelated(a: number, b: number, since: number): boolean {
    if (a === b) return true;
    const r = this.db
      .prepare(
        `WITH link AS (
           SELECT mall_id, user_id FROM memberships
           UNION SELECT mall_id, user_id FROM membership_trail WHERE left_at > ?
           UNION SELECT h.mall_id, h.user_id FROM holdings h JOIN malls ma ON ma.id = h.mall_id WHERE h.shares * 5 >= (ma.total_shares - ma.treasury_shares)
         )
         SELECT 1 AS hit FROM link x JOIN link y ON x.user_id = y.user_id WHERE x.mall_id = ? AND y.mall_id = ? LIMIT 1`,
      )
      .get(since, a, b);
    return r !== undefined;
  }
  /** 這座商場的所有關係企業（不含自己） */
  relatedMalls(mallId: number, since: number): number[] {
    const rows = this.db
      .prepare(
        `WITH link AS (
           SELECT mall_id, user_id FROM memberships
           UNION SELECT mall_id, user_id FROM membership_trail WHERE left_at > ?
           UNION SELECT h.mall_id, h.user_id FROM holdings h JOIN malls ma ON ma.id = h.mall_id WHERE h.shares * 5 >= (ma.total_shares - ma.treasury_shares)
         )
         SELECT DISTINCT y.mall_id AS id FROM link x JOIN link y ON x.user_id = y.user_id WHERE x.mall_id = ? AND y.mall_id <> ? ORDER BY y.mall_id`,
      )
      .all(since, mallId, mallId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  // ── 股權
  /** 這座商場所有股東（含已離開、不是成員的），持股多的在前 */
  holdingsOfMall(mallId: number): { userId: number; displayName: string; shares: number; isMember: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT h.user_id, u.display_name, h.shares,
                EXISTS (SELECT 1 FROM memberships m WHERE m.mall_id = h.mall_id AND m.user_id = h.user_id) AS is_member
         FROM holdings h JOIN users u ON u.id = h.user_id WHERE h.mall_id = ? ORDER BY h.shares DESC, h.user_id`,
      )
      .all(mallId) as { user_id: number; display_name: string; shares: number; is_member: number }[];
    return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, shares: r.shares, isMember: r.is_member === 1 }));
  }
  /** 一位玩家的所有持股 */
  holdingsOfUser(userId: number): { mallId: number; mallName: string; shares: number; isMember: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT h.mall_id, ma.name, h.shares,
                EXISTS (SELECT 1 FROM memberships m WHERE m.mall_id = h.mall_id AND m.user_id = h.user_id) AS is_member
         FROM holdings h JOIN malls ma ON ma.id = h.mall_id WHERE h.user_id = ? ORDER BY h.shares DESC, h.mall_id`,
      )
      .all(userId) as { mall_id: number; name: string; shares: number; is_member: number }[];
    return rows.map((r) => ({ mallId: r.mall_id, mallName: r.name, shares: r.shares, isMember: r.is_member === 1 }));
  }
  sharesOf(mallId: number, userId: number): number {
    const r = this.db.prepare("SELECT shares FROM holdings WHERE mall_id = ? AND user_id = ?").get(mallId, userId) as { shares: number } | undefined;
    return r?.shares ?? 0;
  }
  /** 直接設定持股（0 股就刪掉這一列）；總數由呼叫端（MallService）維持 */
  setShares(mallId: number, userId: number, shares: number): void {
    if (shares <= 0) {
      this.db.prepare("DELETE FROM holdings WHERE mall_id = ? AND user_id = ?").run(mallId, userId);
      return;
    }
    this.db
      .prepare("INSERT INTO holdings (mall_id, user_id, shares) VALUES (?, ?, ?) ON CONFLICT(mall_id, user_id) DO UPDATE SET shares = excluded.shares")
      .run(mallId, userId, shares);
  }
  /** 這座商場的股份全部歸到一個人（建立商場、測試商場換擁有者用）；庫藏股與出價一併清掉 */
  setAllShares(mallId: number, userId: number, total: number = INITIAL_SHARES): void {
    this.db.prepare("DELETE FROM holdings WHERE mall_id = ?").run(mallId);
    this.db.prepare("DELETE FROM share_offers WHERE mall_id = ?").run(mallId);
    this.db.prepare("DELETE FROM capital_requests WHERE mall_id = ?").run(mallId);
    this.db.prepare("UPDATE malls SET treasury_shares = 0, total_shares = ? WHERE id = ?").run(total, mallId);
    this.setShares(mallId, userId, total);
  }
  totalSharesOf(mallId: number): number {
    return (this.db.prepare("SELECT total_shares AS n FROM malls WHERE id = ?").get(mallId) as { n: number } | undefined)?.n ?? INITIAL_SHARES;
  }
  setTotalShares(mallId: number, total: number): void {
    this.db.prepare("UPDATE malls SET total_shares = ? WHERE id = ?").run(total, mallId);
  }

  /** 這個人離開（或被請出）時，他在這座商場的出價與注資申請一併作廢 */
  dropPendingOf(mallId: number, userId: number): void {
    this.db.prepare("DELETE FROM share_offers WHERE mall_id = ? AND (from_id = ? OR to_id = ?)").run(mallId, userId, userId);
    this.db.prepare("DELETE FROM capital_requests WHERE mall_id = ? AND user_id = ?").run(mallId, userId);
  }

  // ── 開商場：每位玩家只有第一座商場是免費的起始資金，之後要自己出資
  foundedCount(userId: number): number {
    return (this.db.prepare("SELECT founded_count AS n FROM users WHERE id = ?").get(userId) as { n: number } | undefined)?.n ?? 0;
  }
  bumpFounded(userId: number): void {
    this.db.prepare("UPDATE users SET founded_count = founded_count + 1 WHERE id = ?").run(userId);
  }

  // ── 注資申請（一人在一座商場同時只有一份）
  setCapitalRequest(mallId: number, userId: number, amount: number, expiresAt: number): number {
    this.db.prepare("DELETE FROM capital_requests WHERE mall_id = ? AND user_id = ?").run(mallId, userId);
    const r = this.db.prepare("INSERT INTO capital_requests (mall_id, user_id, amount, expires_at) VALUES (?, ?, ?, ?)").run(mallId, userId, amount, expiresAt);
    return Number(r.lastInsertRowid);
  }
  capitalRequestById(id: number): { id: number; mall_id: number; user_id: number; amount: number; expires_at: number } | undefined {
    return this.db.prepare("SELECT * FROM capital_requests WHERE id = ?").get(id) as never;
  }
  /** 這座商場待處理的注資申請（過期的順手清掉） */
  capitalRequests(mallId: number, now: number): { id: number; user_id: number; user_name: string; amount: number; expires_at: number }[] {
    this.db.prepare("DELETE FROM capital_requests WHERE expires_at <= ?").run(now);
    return this.db
      .prepare("SELECT c.id, c.user_id, u.display_name AS user_name, c.amount, c.expires_at FROM capital_requests c JOIN users u ON u.id = c.user_id WHERE c.mall_id = ? ORDER BY c.id")
      .all(mallId) as never;
  }
  deleteCapitalRequest(id: number): void {
    this.db.prepare("DELETE FROM capital_requests WHERE id = ?").run(id);
  }
  treasuryOf(mallId: number): number {
    return (this.db.prepare("SELECT treasury_shares AS n FROM malls WHERE id = ?").get(mallId) as { n: number } | undefined)?.n ?? 0;
  }
  setTreasury(mallId: number, shares: number): void {
    this.db.prepare("UPDATE malls SET treasury_shares = ? WHERE id = ?").run(shares, mallId);
  }
  lastDividendAt(mallId: number): number {
    return (this.db.prepare("SELECT last_dividend_at AS t FROM malls WHERE id = ?").get(mallId) as { t: number } | undefined)?.t ?? 0;
  }
  setLastDividendAt(mallId: number, at: number): void {
    this.db.prepare("UPDATE malls SET last_dividend_at = ? WHERE id = ?").run(at, mallId);
  }

  // ── 個人錢包
  walletOf(userId: number): number {
    return (this.db.prepare("SELECT cash FROM wallets WHERE user_id = ?").get(userId) as { cash: number } | undefined)?.cash ?? 0;
  }
  /**
   * 加減錢包現金；不能扣成負的（呼叫端要先檢查）。
   * 有給 ledger 就在同一個地方寫一筆錢包流水（個人財務頁的「明細」），所以所有動錢包的地方都該帶上它。
   */
  addCash(userId: number, delta: number, ledger?: { kind: LedgerKind; note?: string; at: number }): void {
    if (this.walletOf(userId) + delta < 0) throw new Error("wallet would go negative");
    this.db
      .prepare("INSERT INTO wallets (user_id, cash) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET cash = cash + excluded.cash")
      .run(userId, Math.max(0, delta));
    if (delta < 0) this.db.prepare("UPDATE wallets SET cash = cash + ? WHERE user_id = ?").run(delta, userId);
    if (ledger && delta !== 0) {
      this.db
        .prepare("INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, note, at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(userId, ledger.kind, delta, this.walletOf(userId), ledger.note ?? "", ledger.at);
    }
  }
  /** 最近的錢包流水（新的在前） */
  ledgerOfUser(userId: number, limit: number): LedgerEntry[] {
    const rows = this.db
      .prepare("SELECT id, kind, amount, balance_after, note, at FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?")
      .all(userId, limit) as { id: number; kind: LedgerKind; amount: number; balance_after: number; note: string; at: number }[];
    return rows.map((r) => ({ id: r.id, kind: r.kind, amount: r.amount, balanceAfter: r.balance_after, note: r.note, at: r.at }));
  }

  /**
   * 在一個資料庫交易裡做事：丟錯就整個還原。
   * `node:sqlite` 是同步的，所以只要整段 fn 沒有 await，就不會被別的請求插進來。
   */
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ── 股票市場
  positionsOfUser(userId: number): { company: string; shares: number; costTotal: number }[] {
    const rows = this.db.prepare("SELECT company, shares, cost_total FROM stock_positions WHERE user_id = ? ORDER BY company").all(userId) as { company: string; shares: number; cost_total: number }[];
    return rows.map((r) => ({ company: r.company, shares: r.shares, costTotal: r.cost_total }));
  }
  positionOf(userId: number, company: string): { shares: number; costTotal: number } {
    const r = this.db.prepare("SELECT shares, cost_total FROM stock_positions WHERE user_id = ? AND company = ?").get(userId, company) as { shares: number; cost_total: number } | undefined;
    return { shares: r?.shares ?? 0, costTotal: r?.cost_total ?? 0 };
  }
  /** 直接設定持倉（0 股就刪掉這一列） */
  setPosition(userId: number, company: string, shares: number, costTotal: number): void {
    if (shares <= 0) {
      this.db.prepare("DELETE FROM stock_positions WHERE user_id = ? AND company = ?").run(userId, company);
      return;
    }
    this.db
      .prepare("INSERT INTO stock_positions (user_id, company, shares, cost_total) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, company) DO UPDATE SET shares = excluded.shares, cost_total = excluded.cost_total")
      .run(userId, company, shares, costTotal);
  }
  addStockTrade(t: { userId: number; company: string; side: "buy" | "sell"; shares: number; price: number; fee: number; tax: number; day: number; at: number }): void {
    this.db
      .prepare("INSERT INTO stock_trades (user_id, company, side, shares, price, fee, tax, day, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(t.userId, t.company, t.side, t.shares, t.price, t.fee, t.tax, t.day, t.at);
  }
  /** 這個遊戲日已經買進多少（價格 × 股數，不含手續費） */
  boughtOnDay(userId: number, day: number): number {
    return (this.db.prepare("SELECT COALESCE(SUM(price * shares), 0) AS n FROM stock_trades WHERE user_id = ? AND day = ? AND side = 'buy'").get(userId, day) as { n: number }).n;
  }

  // ── 股份出價
  addOffer(o: { mallId: number; fromId: number; toId: number; shares: number; price: number; expiresAt: number }): number {
    const r = this.db
      .prepare("INSERT INTO share_offers (mall_id, from_id, to_id, shares, price, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(o.mallId, o.fromId, o.toId, o.shares, o.price, o.expiresAt);
    return Number(r.lastInsertRowid);
  }
  offerById(id: number): { id: number; mall_id: number; from_id: number; to_id: number; shares: number; price: number; expires_at: number } | undefined {
    return this.db.prepare("SELECT * FROM share_offers WHERE id = ?").get(id) as never;
  }
  /** 和這位玩家有關（他出價或被出價）的有效出價；過期的順手清掉 */
  offersOfUser(mallId: number, userId: number, now: number): { id: number; from_id: number; from_name: string; to_id: number; to_name: string; shares: number; price: number; expires_at: number }[] {
    this.db.prepare("DELETE FROM share_offers WHERE expires_at <= ?").run(now);
    return this.db
      .prepare(
        `SELECT o.id, o.from_id, f.display_name AS from_name, o.to_id, t.display_name AS to_name, o.shares, o.price, o.expires_at
         FROM share_offers o JOIN users f ON f.id = o.from_id JOIN users t ON t.id = o.to_id
         WHERE o.mall_id = ? AND (o.from_id = ? OR o.to_id = ?) ORDER BY o.id`,
      )
      .all(mallId, userId, userId) as never;
  }
  openOfferCount(mallId: number, fromId: number, now: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM share_offers WHERE mall_id = ? AND from_id = ? AND expires_at > ?").get(mallId, fromId, now) as { n: number }).n;
  }
  deleteOffer(id: number): void {
    this.db.prepare("DELETE FROM share_offers WHERE id = ?").run(id);
  }
  /** 留下一筆離開紀錄（成員離開，或持股掉到關係企業門檻以下時；關係企業的判斷會把剛離開的人也算進去） */
  addTrail(mallId: number, userId: number, now: number): void {
    this.db.prepare("INSERT INTO membership_trail (mall_id, user_id, left_at) VALUES (?, ?, ?)").run(mallId, userId, now);
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
  allUsers(): { id: number; username: string; display_name: string; created_at: number; role: UserRole; last_seen_at: number }[] {
    return this.db.prepare("SELECT id, username, display_name, created_at, role, last_seen_at FROM users ORDER BY id").all() as never;
  }
  allMalls(): { id: number; name: string; created_at: number; members: number; sandbox: number }[] {
    return this.db
      .prepare("SELECT m.id, m.name, m.created_at, m.sandbox, (SELECT COUNT(*) FROM memberships x WHERE x.mall_id = m.id) AS members FROM malls m ORDER BY m.id")
      .all() as never;
  }
  isSandbox(mallId: number): boolean {
    const r = this.db.prepare("SELECT sandbox FROM malls WHERE id = ?").get(mallId) as { sandbox: number } | undefined;
    return r?.sandbox === 1;
  }
  setSandbox(mallId: number, on: boolean): void {
    this.db.prepare("UPDATE malls SET sandbox = ? WHERE id = ?").run(on ? 1 : 0, mallId);
  }
  removeDirectory(mallId: number): void {
    this.db.prepare("DELETE FROM mall_directory WHERE mall_id = ?").run(mallId);
  }

  /** 玩家對 NPC 商場出手的紀錄（編號大於 afterId），NPC 回敬用 */
  attacksAgainstNpcs(afterId: number): { id: number; ts: number; attacker: number; target_key: string; persona: string }[] {
    return this.db.prepare("SELECT id, ts, attacker, target_key, persona FROM attacks WHERE id > ? AND target_key LIKE 'n:%' ORDER BY id LIMIT 50").all(afterId) as never;
  }

  // ── NPC 商場：覆寫與動態
  npcOverrideRows(): { npc_id: string; json: string; expires_at: number; updated_at: number }[] {
    return this.db.prepare("SELECT npc_id, json, expires_at, updated_at FROM npc_overrides").all() as never;
  }
  setNpcOverride(npcId: string, json: string, expiresAt: number, now: number): void {
    this.db
      .prepare("INSERT INTO npc_overrides (npc_id, json, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(npc_id) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at, updated_at = excluded.updated_at")
      .run(npcId, json, expiresAt, now);
  }
  clearNpcOverride(npcId: string): void {
    this.db.prepare("DELETE FROM npc_overrides WHERE npc_id = ?").run(npcId);
  }
  addNpcAction(e: { ts: number; npcId: string; action: string; targetKey: string; detail: string; manual: boolean }): void {
    this.db.prepare("INSERT INTO npc_actions (ts, npc_id, action, target_key, detail, manual) VALUES (?, ?, ?, ?, ?, ?)").run(e.ts, e.npcId, e.action, e.targetKey, e.detail, e.manual ? 1 : 0);
  }
  npcActions(limit: number, npcId?: string): { id: number; ts: number; npc_id: string; action: string; target_key: string; detail: string; manual: number }[] {
    return this.db
      .prepare("SELECT id, ts, npc_id, action, target_key, detail, manual FROM npc_actions WHERE (? IS NULL OR npc_id = ?) ORDER BY id DESC LIMIT ?")
      .all(npcId ?? null, npcId ?? null, limit) as never;
  }
  npcActionCount(npcId: string, action: string | null, since: number): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM npc_actions WHERE npc_id = ? AND (? IS NULL OR action = ?) AND ts > ?").get(npcId, action, action, since) as { n: number }).n);
  }

  // ── 營運指標
  activePlayersSince(since: number): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND last_seen_at >= ?").get(since) as { n: number }).n);
  }
  newPlayersSince(since: number): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND created_at >= ?").get(since) as { n: number }).n);
  }
  countPlayers(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'player'").get() as { n: number }).n);
  }
  countRealMalls(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM malls WHERE sandbox = 0").get() as { n: number }).n);
  }
  addSample(s: { ts: number; online_users: number; online_malls: number; ws_conns: number; active_24h: number; active_7d: number; users_total: number; malls_total: number; requests: number; errors: number; commands: number; npc_actions: number; tick_ms: number; loop_lag_ms: number; rss_mb: number; heap_mb: number; uptime_s: number }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO metrics_samples (ts, online_users, online_malls, ws_conns, active_24h, active_7d, users_total, malls_total, requests, errors, commands, npc_actions, tick_ms, loop_lag_ms, rss_mb, heap_mb, uptime_s)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.ts, s.online_users, s.online_malls, s.ws_conns, s.active_24h, s.active_7d, s.users_total, s.malls_total, s.requests, s.errors, s.commands, s.npc_actions, s.tick_ms, s.loop_lag_ms, s.rss_mb, s.heap_mb, s.uptime_s);
  }
  samples(from: number, to: number, limit: number): Record<string, number>[] {
    return this.db.prepare("SELECT * FROM metrics_samples WHERE ts >= ? AND ts < ? ORDER BY ts LIMIT ?").all(from, to, limit) as never;
  }
  // ── 平衡分析：每座商場每個遊戲日一列（永久保存）
  lastBalanceDay(mallId: number): number {
    const r = this.db.prepare("SELECT MAX(day) AS d FROM balance_daily WHERE mall_id = ?").get(mallId) as { d: number | null };
    return r.d ?? -1;
  }
  addBalanceDay(r: BalanceRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO balance_daily (mall_id, day, recorded_at, level, shops, members, funds, revenue, profit, purchases, fixed, groups, units, walkouts, lost_capacity, stockouts, price_walks, local_rep, tourist_heat, avg_sat, price_ratio, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.mall_id, r.day, r.recorded_at, r.level, r.shops, r.members, r.funds, r.revenue, r.profit, r.purchases, r.fixed, r.groups, r.units, r.walkouts, r.lost_capacity, r.stockouts, r.price_walks, r.local_rep, r.tourist_heat, r.avg_sat, r.price_ratio, r.detail_json);
  }
  balanceRows(fromDay: number, toDay: number, mallId?: number): BalanceRow[] {
    return this.db
      .prepare(`SELECT * FROM balance_daily WHERE day >= ? AND day <= ? ${mallId ? "AND mall_id = ?" : ""} ORDER BY day, mall_id`)
      .all(...(mallId ? [fromDay, toDay, mallId] : [fromDay, toDay])) as never;
  }
  pruneSamples(before: number): void {
    this.db.prepare("DELETE FROM metrics_samples WHERE ts < ?").run(before);
  }
  upsertDaily(day: string, d: { dau: number; newUsers: number; online: number; ws: number; requests: number; errors: number; commands: number; npcActions: number; tickMs: number }): void {
    this.db
      .prepare(
        `INSERT INTO daily_stats (day, dau, new_users, peak_online, peak_ws, requests, errors, commands, npc_actions, max_tick_ms, samples)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(day) DO UPDATE SET dau = MAX(dau, excluded.dau), new_users = excluded.new_users,
           peak_online = MAX(peak_online, excluded.peak_online), peak_ws = MAX(peak_ws, excluded.peak_ws),
           requests = requests + excluded.requests, errors = errors + excluded.errors, commands = commands + excluded.commands,
           npc_actions = npc_actions + excluded.npc_actions, max_tick_ms = MAX(max_tick_ms, excluded.max_tick_ms), samples = samples + 1`,
      )
      .run(day, d.dau, d.newUsers, d.online, d.ws, d.requests, d.errors, d.commands, d.npcActions, d.tickMs);
  }
  dailyStats(limit: number): Record<string, number | string>[] {
    return this.db.prepare("SELECT * FROM daily_stats ORDER BY day DESC LIMIT ?").all(limit) as never;
  }
  dailyStatsBetween(fromDay: string, toDay: string): Record<string, number | string>[] {
    return this.db.prepare("SELECT * FROM daily_stats WHERE day >= ? AND day <= ? ORDER BY day").all(fromDay, toDay) as never;
  }

  // ── 稽核紀錄
  addAudit(e: { ts: number; actorId: number | null; actorName: string; action: string; target: string; detail: unknown; ip: string }): number {
    const r = this.db
      .prepare("INSERT INTO audit_log (ts, actor_id, actor_name, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(e.ts, e.actorId, e.actorName, e.action, e.target, JSON.stringify(e.detail ?? {}), e.ip);
    return Number(r.lastInsertRowid);
  }
  audit(q: { limit: number; before?: number; action?: string; actor?: string; since?: number; until?: number }): AuditRow[] {
    return this.db
      .prepare(
        `SELECT id, ts, actor_id, actor_name, action, target, detail, ip FROM audit_log
         WHERE (? IS NULL OR id < ?) AND (? IS NULL OR action LIKE ?) AND (? IS NULL OR actor_name = ?) AND (? IS NULL OR ts >= ?) AND (? IS NULL OR ts < ?)
         ORDER BY id DESC LIMIT ?`,
      )
      .all(q.before ?? null, q.before ?? null, q.action ?? null, `${q.action ?? ""}%`, q.actor ?? null, q.actor ?? null, q.since ?? null, q.since ?? null, q.until ?? null, q.until ?? null, q.limit) as unknown as AuditRow[];
  }

  // ── 跨商場世界：公開名錄、賽季、信箱
  upsertDirectory(row: { mallId: number; name: string; level: number; stars: number; score: number; localRep: number; touristHeat: number; revenue30: number; shops: number; topCategory: string; stockouts: number; createdAt: number; updatedAt: number }): void {
    this.db
      .prepare(
        `INSERT INTO mall_directory (mall_id, name, level, stars, score, local_rep, tourist_heat, revenue30, shops, top_category, stockouts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mall_id) DO UPDATE SET name = excluded.name, level = excluded.level, stars = excluded.stars, score = excluded.score,
           local_rep = excluded.local_rep, tourist_heat = excluded.tourist_heat, revenue30 = excluded.revenue30, shops = excluded.shops,
           top_category = excluded.top_category, stockouts = excluded.stockouts, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      )
      .run(row.mallId, row.name, row.level, row.stars, row.score, row.localRep, row.touristHeat, row.revenue30, row.shops, row.topCategory, row.stockouts, row.createdAt, row.updatedAt);
  }
  directoryRows(): { mall_id: number; name: string; level: number; stars: number; score: number; local_rep: number; tourist_heat: number; revenue30: number; shops: number; top_category: string; stockouts: number; created_at: number; updated_at: number }[] {
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
  /**
   * 寄一封信。atTick（伺服器 tick）有值＝這封信對商場生效的時間點：商場自己的時鐘模擬到那個 tick 才套用，
   * 落後的商場不會把效果套在自己的過去；沒給＝商場下一次同步時立刻套用（賽季獎勵、通知等不帶時間長度的信）。
   */
  addMail(toMall: number, kind: string, payload: unknown, createdAt: number, deliverAt: number, atTick: number | null = null): number {
    const r = this.db.prepare("INSERT INTO mall_mailbox (to_mall, kind, payload, created_at, deliver_at, at_tick) VALUES (?, ?, ?, ?, ?, ?)").run(toMall, kind, JSON.stringify(payload), createdAt, deliverAt, atTick);
    return Number(r.lastInsertRowid);
  }
  /** 立刻生效的信（沒有 at_tick）：真實時間已到 */
  dueMail(toMall: number, now: number): { id: number; kind: string; payload: Record<string, unknown> }[] {
    const rows = this.db.prepare("SELECT id, kind, payload FROM mall_mailbox WHERE to_mall = ? AND status = 'pending' AND at_tick IS NULL AND deliver_at <= ? ORDER BY id LIMIT 50").all(toMall, now) as { id: number; kind: string; payload: string }[];
    return rows.map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  }
  /** 帶 at_tick 的信：真實時間已到、而且商場能走到的 tick（upToTick）已經到達它的生效時間；依生效時間排序 */
  dueTimedMail(toMall: number, now: number, upToTick: number): { id: number; kind: string; payload: Record<string, unknown>; atTick: number }[] {
    const rows = this.db
      .prepare("SELECT id, kind, payload, at_tick FROM mall_mailbox WHERE to_mall = ? AND status = 'pending' AND at_tick IS NOT NULL AND at_tick <= ? AND deliver_at <= ? ORDER BY at_tick, id LIMIT 50")
      .all(toMall, upToTick, now) as { id: number; kind: string; payload: string; at_tick: number }[];
    return rows.map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload) as Record<string, unknown>, atTick: r.at_tick }));
  }

  // ── 伺服器基準時間
  private serverClockCache: ServerClock | null = null;
  /** 資料庫裡有沒有存過伺服器時鐘（新資料庫第一次啟動時沒有） */
  hasServerClock(): boolean {
    return this.db.prepare("SELECT 1 AS x FROM server_clock WHERE id = 1").get() !== undefined;
  }
  /** 伺服器基準時鐘；還沒存過就用預設錨點 */
  serverClock(): ServerClock {
    if (this.serverClockCache) return this.serverClockCache;
    const r = this.db.prepare("SELECT anchor_real_ms, anchor_tick FROM server_clock WHERE id = 1").get() as { anchor_real_ms: number; anchor_tick: number } | undefined;
    this.serverClockCache = r ? { anchorRealMs: r.anchor_real_ms, anchorTick: r.anchor_tick } : DEFAULT_SERVER_CLOCK;
    return this.serverClockCache;
  }
  setServerClock(sc: ServerClock): void {
    this.db
      .prepare("INSERT INTO server_clock (id, anchor_real_ms, anchor_tick) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET anchor_real_ms = excluded.anchor_real_ms, anchor_tick = excluded.anchor_tick")
      .run(Math.round(sc.anchorRealMs), Math.round(sc.anchorTick));
    this.serverClockCache = { anchorRealMs: Math.round(sc.anchorRealMs), anchorTick: Math.round(sc.anchorTick) };
  }
  /** 真實時間 → 伺服器基準 tick */
  serverTick(nowMs: number): number {
    return serverTickAt(nowMs, this.serverClock());
  }
  /** 目前所有「非測試」商場裡最大的 tick（第一次啟用伺服器時鐘時，用它當起點，確保沒有商場領先）；沒有商場回傳 null */
  maxMallTick(): number | null {
    const r = this.db.prepare("SELECT MAX(s.tick) AS t FROM mall_state s JOIN malls m ON m.id = s.mall_id WHERE m.sandbox = 0").get() as { t: number | null } | undefined;
    return r?.t ?? null;
  }
  markMailDelivered(ids: number[]): void {
    const st = this.db.prepare("UPDATE mall_mailbox SET status = 'delivered' WHERE id = ?");
    for (const id of ids) st.run(id);
  }
  pendingMailCount(toMall: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM mall_mailbox WHERE to_mall = ? AND status = 'pending'").get(toMall) as { n: number }).n;
  }

  // ── 聯名協議
  addAlliance(a: string, b: string, status: string, createdAt: number, expiresAt: number, startedAt: number | null, endsAt: number | null): number {
    const r = this.db.prepare("INSERT INTO alliances (a_key, b_key, status, created_at, expires_at, started_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(a, b, status, createdAt, expiresAt, startedAt, endsAt);
    return Number(r.lastInsertRowid);
  }
  allianceById(id: number): unknown {
    return this.db.prepare("SELECT * FROM alliances WHERE id = ?").get(id);
  }
  alliancesOf(key: string, statuses: string[]): unknown[] {
    const marks = statuses.map(() => "?").join(",");
    return this.db.prepare(`SELECT * FROM alliances WHERE (a_key = ? OR b_key = ?) AND status IN (${marks}) ORDER BY id`).all(key, key, ...statuses);
  }
  alliancesByStatus(status: string): unknown[] {
    return this.db.prepare("SELECT * FROM alliances WHERE status = ? ORDER BY id").all(status);
  }
  setAllianceStatus(id: number, status: string): void {
    this.db.prepare("UPDATE alliances SET status = ? WHERE id = ?").run(status, id);
  }
  activateAlliance(id: number, startedAt: number, endsAt: number): void {
    this.db.prepare("UPDATE alliances SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?").run(startedAt, endsAt, id);
  }
  setAllianceJoint(id: number, at: number): void {
    this.db.prepare("UPDATE alliances SET last_joint_at = ? WHERE id = ?").run(at, id);
  }

  // ── 貿易紀錄
  addTrade(ts: number, from: number, to: number, kind: string, amount: number, detail = ""): void {
    this.db.prepare("INSERT INTO trades (ts, from_mall, to_mall, kind, amount, detail) VALUES (?, ?, ?, ?, ?, ?)").run(ts, from, to, kind, amount, detail);
  }
  /** 這一對商場（有方向）在某時間之後的轉出總量與筆數 */
  tradeSince(from: number, to: number, kind: string, since: number): { total: number; n: number } {
    const r = this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM trades WHERE from_mall = ? AND to_mall = ? AND kind = ? AND ts > ?").get(from, to, kind, since) as { total: number; n: number };
    return { total: Number(r.total), n: Number(r.n) };
  }
  /** 某座商場在某時間之後，從這些商場收到的資金／貨物總量（防「繞一圈」轉移用） */
  tradeReceivedFrom(to: number, fromIds: number[], kind: string, since: number): number {
    if (fromIds.length === 0) return 0;
    const marks = fromIds.map(() => "?").join(",");
    const r = this.db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM trades WHERE to_mall = ? AND kind = ? AND ts > ? AND from_mall IN (${marks})`)
      .get(to, kind, since, ...fromIds) as { total: number };
    return Number(r.total);
  }
  /** 一座商場為轉出方，某時間之後有幾筆（不分對象）：救援加成用 */
  tradeCountFrom(from: number, kind: string, since: number): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM trades WHERE from_mall = ? AND kind = ? AND ts > ?").get(from, kind, since) as { n: number }).n);
  }
  recentTrades(limit: number): { id: number; ts: number; from_mall: number; to_mall: number; kind: string; amount: number; detail: string }[] {
    return this.db.prepare("SELECT * FROM trades ORDER BY id DESC LIMIT ?").all(limit) as never;
  }

  // ── 商戰搶客紀錄
  addAttack(ts: number, attacker: number, targetKey: string, persona: string): void {
    this.db.prepare("INSERT INTO attacks (ts, attacker, target_key, persona) VALUES (?, ?, ?, ?)").run(ts, attacker, targetKey, persona);
  }
  attacksOn(targetKey: string, since: number): { n: number; last: number } {
    const r = this.db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(ts), 0) AS last FROM attacks WHERE target_key = ? AND ts > ?").get(targetKey, since) as { n: number; last: number };
    return { n: Number(r.n), last: Number(r.last) };
  }
  attacksBy(attacker: number, since: number): { n: number; last: number } {
    const r = this.db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(ts), 0) AS last FROM attacks WHERE attacker = ? AND ts > ?").get(attacker, since) as { n: number; last: number };
    return { n: Number(r.n), last: Number(r.last) };
  }
  /** 最近有被打到的對象（算保護期用） */
  recentAttackTargets(since: number): { target_key: string; last: number }[] {
    return this.db.prepare("SELECT target_key, MAX(ts) AS last FROM attacks WHERE ts > ? GROUP BY target_key").all(since) as never;
  }
}
