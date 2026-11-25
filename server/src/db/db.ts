import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_lc TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE malls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    seed INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE memberships (
    mall_id INTEGER NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    is_owner INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (mall_id, user_id)
  );
  CREATE INDEX idx_memberships_user ON memberships(user_id);
  CREATE TABLE mall_state (
    mall_id INTEGER PRIMARY KEY REFERENCES malls(id) ON DELETE CASCADE,
    tick INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mall_id INTEGER NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    actor TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX idx_activity_mall ON activity(mall_id, id DESC);
  `,
  // v2：Web Push 訂閱（遇事暫停時跳通知用）
  `
  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_push_user ON push_subscriptions(user_id);
  `,
  // v3：AI 內容池、LLM 用量帳本、雜項設定（預算視窗起點等）
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE llm_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    ok INTEGER NOT NULL,
    note TEXT
  );
  CREATE INDEX idx_ledger_ts ON llm_ledger(ts);
  CREATE TABLE content_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    model TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_pool_kind ON content_pool(kind, status);
  `,
  // v4：跨商場世界——公開名錄、賽季、商場之間的信箱
  `
  CREATE TABLE mall_directory (
    mall_id INTEGER PRIMARY KEY REFERENCES malls(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    level INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    score REAL NOT NULL,
    local_rep REAL NOT NULL,
    tourist_heat REAL NOT NULL,
    revenue30 REAL NOT NULL,
    shops INTEGER NOT NULL,
    top_category TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE seasons (
    season INTEGER PRIMARY KEY,
    settled_at INTEGER NOT NULL,
    result_json TEXT NOT NULL
  );
  CREATE TABLE mall_mailbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_mall INTEGER NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deliver_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX idx_mailbox_to ON mall_mailbox(to_mall, status, deliver_at);
  `,
  // v5：聯名協議（跨商場合作）
  `
  CREATE TABLE alliances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    a_key TEXT NOT NULL,
    b_key TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    started_at INTEGER,
    ends_at INTEGER,
    last_joint_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_alliances_status ON alliances(status);
  `,
  // v6：貿易紀錄（稽核與上限用）、名錄的缺貨店數
  `
  CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    from_mall INTEGER NOT NULL,
    to_mall INTEGER NOT NULL,
    kind TEXT NOT NULL,
    amount REAL NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_trades_pair ON trades(from_mall, to_mall, ts);
  ALTER TABLE mall_directory ADD COLUMN stockouts INTEGER NOT NULL DEFAULT 0;
  `,
  // v7：商戰搶客紀錄（冷卻、保護期與每日上限用）
  `
  CREATE TABLE attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    attacker INTEGER NOT NULL,
    target_key TEXT NOT NULL,
    persona TEXT NOT NULL
  );
  CREATE INDEX idx_attacks_target ON attacks(target_key, ts);
  CREATE INDEX idx_attacks_attacker ON attacks(attacker, ts);
  `,
  // v8：Overseer（世界管理者）、測試商場隔離、稽核紀錄、營運指標、NPC 覆寫與動態
  `
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player';
  ALTER TABLE users ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE malls ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor_id INTEGER,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '{}',
    ip TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_audit_ts ON audit_log(ts DESC);
  CREATE INDEX idx_audit_action ON audit_log(action, ts DESC);
  CREATE TABLE metrics_samples (
    ts INTEGER PRIMARY KEY,
    online_users INTEGER NOT NULL,
    online_malls INTEGER NOT NULL,
    ws_conns INTEGER NOT NULL,
    active_24h INTEGER NOT NULL,
    active_7d INTEGER NOT NULL,
    users_total INTEGER NOT NULL,
    malls_total INTEGER NOT NULL,
    requests INTEGER NOT NULL,
    errors INTEGER NOT NULL,
    commands INTEGER NOT NULL,
    npc_actions INTEGER NOT NULL,
    tick_ms REAL NOT NULL,
    loop_lag_ms REAL NOT NULL,
    rss_mb REAL NOT NULL,
    heap_mb REAL NOT NULL,
    uptime_s INTEGER NOT NULL
  );
  CREATE TABLE daily_stats (
    day TEXT PRIMARY KEY,
    dau INTEGER NOT NULL DEFAULT 0,
    new_users INTEGER NOT NULL DEFAULT 0,
    peak_online INTEGER NOT NULL DEFAULT 0,
    peak_ws INTEGER NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    commands INTEGER NOT NULL DEFAULT 0,
    npc_actions INTEGER NOT NULL DEFAULT 0,
    max_tick_ms REAL NOT NULL DEFAULT 0,
    samples INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE npc_overrides (
    npc_id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    expires_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE npc_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    npc_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_key TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    manual INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_npc_actions ON npc_actions(npc_id, ts DESC);
  ALTER TABLE trades ADD COLUMN from_key TEXT;
  ALTER TABLE trades ADD COLUMN to_key TEXT;
  ALTER TABLE attacks ADD COLUMN attacker_key TEXT;
  `,
];

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch {
    // 某些檔案系統（例如網路磁碟）不支援 WAL，退回預設模式
  }
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let v = row.user_version;
  while (v < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      v++;
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
