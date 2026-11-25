import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Repo } from "../db/repo";

// 營運與玩家數據：每分鐘取一筆樣本（線上人數、活躍玩家、請求／錯誤、指令數、tick 耗時、記憶體…），
// 同時累計每日統計（永久保存）。樣本保留 30 天。Overseer 與測試商場不算在玩家數據裡。

export interface MetricsSample {
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

export interface DailyStat {
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

export const SAMPLE_KEEP_MS = 30 * 86_400_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface MetricsHost {
  /** 目前有人在場（非旁觀連線）的商場數 */
  presentMalls(): number;
}

export class Metrics {
  private requests = 0;
  private errors = 0;
  private commands = 0;
  private npcActions = 0;
  private tickMs = 0;
  /** userId → 目前開著的連線數（只算非旁觀） */
  private sockets = new Map<number, number>();
  private readonly loop: ReturnType<typeof monitorEventLoopDelay>;
  private readonly startedAt: number;

  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
    private readonly host: MetricsHost,
    /** 每日統計的日界線：以 UTC 往後偏幾小時（台灣是 8） */
    private readonly dayOffsetHours = Number(process.env.METRICS_TZ_OFFSET_HOURS ?? 8),
  ) {
    this.loop = monitorEventLoopDelay({ resolution: 20 });
    this.loop.enable();
    this.startedAt = now();
  }

  // ── 計數器（由 hooks 呼叫）
  request(status: number): void {
    this.requests++;
    if (status >= 500) this.errors++;
  }
  command(): void {
    this.commands++;
  }
  npcAction(): void {
    this.npcActions++;
  }
  /** 最近一次 tickAll 花了幾毫秒（取每個取樣週期的最大值） */
  tick(ms: number): void {
    if (ms > this.tickMs) this.tickMs = ms;
  }
  socketOpen(userId: number): void {
    this.sockets.set(userId, (this.sockets.get(userId) ?? 0) + 1);
  }
  socketClose(userId: number): void {
    const n = (this.sockets.get(userId) ?? 0) - 1;
    if (n <= 0) this.sockets.delete(userId);
    else this.sockets.set(userId, n);
  }

  /** 日界線（含時區偏移）：回傳這個時間點所在那一天的 "YYYY-MM-DD" 與起點毫秒 */
  dayOf(ts: number): { key: string; start: number } {
    const shifted = ts + this.dayOffsetHours * HOUR;
    const start = Math.floor(shifted / DAY) * DAY - this.dayOffsetHours * HOUR;
    return { key: new Date(start + this.dayOffsetHours * HOUR).toISOString().slice(0, 10), start };
  }

  /** 現在的數字（不寫入）：給「即時」畫面用 */
  live(): Omit<MetricsSample, "ts" | "requests" | "errors" | "commands" | "npc_actions" | "tick_ms" | "loop_lag_ms"> & { requests: number; errors: number; commands: number; npc_actions: number; tick_ms: number; loop_lag_ms: number; ts: number } {
    const t = this.now();
    const mem = process.memoryUsage();
    let ws = 0;
    for (const n of this.sockets.values()) ws += n;
    return {
      ts: t,
      online_users: this.sockets.size,
      online_malls: this.host.presentMalls(),
      ws_conns: ws,
      active_24h: this.repo.activePlayersSince(t - DAY),
      active_7d: this.repo.activePlayersSince(t - 7 * DAY),
      users_total: this.repo.countPlayers(),
      malls_total: this.repo.countRealMalls(),
      requests: this.requests,
      errors: this.errors,
      commands: this.commands,
      npc_actions: this.npcActions,
      tick_ms: Math.round(this.tickMs * 10) / 10,
      loop_lag_ms: Math.round((this.loop.mean / 1e6) * 10) / 10 || 0,
      rss_mb: Math.round((mem.rss / 1048576) * 10) / 10,
      heap_mb: Math.round((mem.heapUsed / 1048576) * 10) / 10,
      uptime_s: Math.round((t - this.startedAt) / 1000),
    };
  }

  /** 每分鐘呼叫：寫入一筆樣本、更新今天的統計、清掉太舊的樣本，並把週期計數器歸零 */
  sample(): MetricsSample {
    const s = this.live();
    this.repo.addSample(s);
    const day = this.dayOf(s.ts);
    this.repo.upsertDaily(day.key, {
      dau: this.repo.activePlayersSince(day.start),
      newUsers: this.repo.newPlayersSince(day.start),
      online: s.online_users,
      ws: s.ws_conns,
      requests: s.requests,
      errors: s.errors,
      commands: s.commands,
      npcActions: s.npc_actions,
      tickMs: s.tick_ms,
    });
    this.repo.pruneSamples(s.ts - SAMPLE_KEEP_MS);
    this.requests = this.errors = this.commands = this.npcActions = 0;
    this.tickMs = 0;
    this.loop.reset();
    return s;
  }

  stop(): void {
    this.loop.disable();
  }
}

// ── 匯出
const SAMPLE_COLUMNS: (keyof MetricsSample)[] = ["ts", "online_users", "online_malls", "ws_conns", "active_24h", "active_7d", "users_total", "malls_total", "requests", "errors", "commands", "npc_actions", "tick_ms", "loop_lag_ms", "rss_mb", "heap_mb", "uptime_s"];
const DAILY_COLUMNS: (keyof DailyStat)[] = ["day", "dau", "new_users", "peak_online", "peak_ws", "requests", "errors", "commands", "npc_actions", "max_tick_ms", "samples"];

export function toCsv(rows: Record<string, unknown>[], columns: string[], iso = true): string {
  const cell = (k: string, v: unknown): string => {
    if (k === "ts" && iso && typeof v === "number") return new Date(v).toISOString();
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(c, r[c])).join(","))].join("\n") + "\n";
}
export const sampleCsv = (rows: MetricsSample[]): string => toCsv(rows as unknown as Record<string, unknown>[], SAMPLE_COLUMNS as string[]);
export const dailyCsv = (rows: DailyStat[]): string => toCsv(rows as unknown as Record<string, unknown>[], DAILY_COLUMNS as string[]);
