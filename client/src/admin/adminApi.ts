import type { MemberInfo } from "@coidle/shared";
import { request } from "../api";

// 管理室（Overseer）用的 API：全部走登入 cookie，伺服器端會檢查 role 並留下稽核紀錄。

export interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  created_at: number;
  role: "player" | "overseer";
  last_seen_at: number;
}

export interface AdminMall {
  id: number;
  name: string;
  created_at: number;
  members: number;
  sandbox: number;
  online: number;
  members_list: MemberInfo[];
  level: number;
  funds: number;
  tick: number;
  day: number;
  flags: Record<string, boolean>;
}

export interface Overview {
  users: AdminUser[];
  malls: AdminMall[];
}

export interface Sample {
  ts: number;
  online_users: number;
  online_malls: number;
  ws_conns: number;
  active_24h: number;
  active_7d: number;
  users_total: number;
  malls_total: number;
  requests: number;
  errors: number;
  commands: number;
  npc_actions: number;
  tick_ms: number;
  loop_lag_ms: number;
  rss_mb: number;
  heap_mb: number;
  uptime_s: number;
}

export interface DailyRow {
  day: string;
  dau: number;
  new_users: number;
  peak_online: number;
  peak_ws: number;
  requests: number;
  errors: number;
  commands: number;
  npc_actions: number;
  max_tick_ms: number;
  samples: number;
}

export interface AuditEntry {
  id: number;
  ts: number;
  actor: string;
  actorId: number | null;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  ip: string;
}

export const adminApi = {
  overview: () => request<Overview>("GET", "/api/admin/overview"),
  live: () => request<{ now: Sample; recent: Sample[] }>("GET", "/api/admin/metrics/live"),
  metrics: (from: number, to: number) => request<{ from: number; to: number; samples: Sample[] }>("GET", `/api/admin/metrics?from=${from}&to=${to}&limit=600`),
  daily: (days = 30) => request<{ days: DailyRow[] }>("GET", `/api/admin/metrics/daily?days=${days}`),
  exportUrl: (kind: "samples" | "daily", format: "csv" | "json", from?: number, to?: number) => `/api/admin/metrics/export?kind=${kind}&format=${format}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`,
  audit: (q: { before?: number; action?: string; actor?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.before) p.set("before", String(q.before));
    if (q.action) p.set("action", q.action);
    if (q.actor) p.set("actor", q.actor);
    p.set("limit", String(q.limit ?? 100));
    return request<{ entries: AuditEntry[] }>("GET", `/api/admin/audit?${p}`);
  },
  post: <T = { ok: true }>(url: string, body: unknown = {}) => request<T>("POST", `/api/admin${url}`, body),
  get: <T>(url: string) => request<T>("GET", `/api/admin${url}`),
};
