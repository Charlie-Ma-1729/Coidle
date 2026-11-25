import { useEffect, useState } from "preact/hooks";
import { adminApi, type AuditEntry } from "./adminApi";
import { errMsg, toast } from "../store";

const when = (ms: number) => new Date(ms).toLocaleString("zh-TW", { hour12: false });

/** 稽核紀錄：誰、何時、做了什麼；可依動作與操作者篩選，往更早翻，匯出成 CSV */
export function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [more, setMore] = useState(false);

  const load = async (append = false) => {
    try {
      const r = await adminApi.audit({ action: action || undefined, actor: actor || undefined, before: append ? rows[rows.length - 1]?.id : undefined, limit: 100 });
      setRows(append ? [...rows, ...r.entries] : r.entries);
      setMore(r.entries.length === 100);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const csv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const text = ["id,time,actor,action,target,ip,detail", ...rows.map((r) => [r.id, new Date(r.ts).toISOString(), r.actor, r.action, r.target, r.ip, JSON.stringify(r.detail)].map((x) => esc(String(x))).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = `coidle-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div class="card">
      <h3>稽核紀錄</h3>
      <p class="small dim">每個管理操作都會記錄在這裡，也同時印在伺服器的 terminal（journalctl -u coidle -f）。</p>
      <form
        class="row"
        style={{ flexWrap: "wrap", marginBottom: "8px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input type="text" placeholder="動作開頭，例如 mall. 或 user." value={action} onInput={(e) => setAction((e.target as HTMLInputElement).value)} />
        <input type="text" placeholder="操作者" value={actor} onInput={(e) => setActor((e.target as HTMLInputElement).value)} />
        <button class="btn btn-ghost btn-sm" type="submit">
          篩選
        </button>
        <button class="btn btn-ghost btn-sm" type="button" onClick={csv} disabled={rows.length === 0}>
          匯出 CSV
        </button>
      </form>
      <div class="log">
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <time>{when(r.ts)}</time>
              <span>
                <b>{r.actor}</b> {r.action} {r.target && <span class="dim">{r.target}</span>}{" "}
                <span class="small dim">
                  {Object.keys(r.detail).length ? JSON.stringify(r.detail) : ""}
                  {r.ip ? ` ・${r.ip}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {rows.length === 0 && <p class="small dim">沒有符合的紀錄。</p>}
      {more && (
        <button class="btn btn-ghost btn-sm" onClick={() => load(true)}>
          更早的紀錄
        </button>
      )}
    </div>
  );
}
