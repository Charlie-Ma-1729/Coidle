import type { Repo } from "../db/repo";

// 稽核紀錄：每個管理操作寫進資料庫，同時印一行到伺服器的 console
// （systemd 下就是 `journalctl -u coidle -f`，也就是後台的 terminal）。

export interface Actor {
  id: number | null;
  name: string;
}

export type AuditSink = (line: string) => void;

const REDACT = /pass|key|token|secret|cookie/i;

/** 記錄之前把敏感欄位遮掉，長字串截短 */
export function sanitize(v: unknown, depth = 0): unknown {
  if (depth > 3) return "…";
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => sanitize(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = REDACT.test(k) ? "***" : sanitize(x, depth + 1);
    return out;
  }
  return v;
}

export class AuditService {
  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
    private readonly sink: AuditSink | null,
  ) {}

  record(actor: Actor, action: string, target = "", detail: unknown = {}, ip = ""): void {
    const ts = this.now();
    const clean = sanitize(detail);
    this.repo.addAudit({ ts, actorId: actor.id, actorName: actor.name, action, target, detail: clean, ip });
    if (this.sink) {
      const d = clean && typeof clean === "object" && Object.keys(clean as object).length > 0 ? ` ${JSON.stringify(clean)}` : "";
      this.sink(`[audit] ${new Date(ts).toISOString()} ${actor.name}${actor.id !== null ? `(#${actor.id})` : ""} ${action}${target ? ` ${target}` : ""}${d}${ip ? ` ip=${ip}` : ""}`);
    }
  }
}
