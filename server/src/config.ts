export interface Config {
  port: number;
  /** 監聽位址：正式環境預設只聽本機（由 nginx 對外），開發預設 0.0.0.0 */
  host: string;
  dbPath: string;
  production: boolean;
  /** 設定後，註冊時必須提供此密語（避免陌生人註冊） */
  signupSecret: string | null;
  /** 設定後才開放「管理旗標」API（開放內容的開關） */
  adminToken: string | null;
  maxMembers: number;
  /** Web Push（VAPID）。沒設就不送推播，只用應用內橫幅 */
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string;
  /** 打包後的前端位置；有的話由伺服器直接提供 */
  staticDir: string;
  /** AI 內容生成（OpenRouter）。沒有金鑰就完全不啟用 */
  ai: { apiKey: string | null; model: string; budgetUsd: number; autoApproveEvents: boolean; dailyCallCap: number; budgetStart: number | null; spentElsewhereUsd: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 2330),
    host: env.HOST || (env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0"),
    dbPath: env.DB_PATH ?? "data/coidle.db",
    production: env.NODE_ENV === "production",
    signupSecret: env.SIGNUP_SECRET || null,
    adminToken: env.ADMIN_TOKEN || null,
    maxMembers: Number(env.MAX_MEMBERS ?? 12),
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || null,
    vapidSubject: env.VAPID_SUBJECT || "mailto:admin@localhost",
    staticDir: env.STATIC_DIR || "client/dist",
    ai: {
      apiKey: env.OPENROUTER_API_KEY || null,
      model: env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5",
      budgetUsd: Number(env.AI_BUDGET_USD ?? 1),
      autoApproveEvents: env.AI_AUTO_APPROVE_EVENTS === "true",
      dailyCallCap: Number(env.AI_DAILY_CALL_CAP ?? 12),
      budgetStart: env.AI_BUDGET_START ? Date.parse(env.AI_BUDGET_START) || null : null,
      spentElsewhereUsd: Number(env.AI_SPENT_ELSEWHERE_USD ?? 0) || 0,
    },
  };
}
