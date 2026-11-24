export interface Config {
  port: number;
  dbPath: string;
  production: boolean;
  /** 設定後，註冊時必須提供此密語（避免陌生人註冊） */
  signupSecret: string | null;
  /** 設定後才開放「管理旗標」API（開放內容的開關） */
  adminToken: string | null;
  maxMembers: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? "data/coidle.db",
    production: env.NODE_ENV === "production",
    signupSecret: env.SIGNUP_SECRET || null,
    adminToken: env.ADMIN_TOKEN || null,
    maxMembers: Number(env.MAX_MEMBERS ?? 12),
  };
}
