import { useEffect, useState } from "preact/hooks";
import { adminApi, type AuditEntry } from "./adminApi";
import { Badge, Card, Empty, fmtDateFull, Ico } from "./kit";
import { errMsg, toast } from "../store";

const tone = (a: string): "green" | "amber" | "red" | "cyan" | "pink" | undefined =>
  a.endsWith(".fail") || a.endsWith(".denied") || a.endsWith(".blocked") || a.startsWith("admin.denied") ? "red" : a.startsWith("overseer.") ? "pink" : a.startsWith("npc.") ? "amber" : a.startsWith("mall.") ? "cyan" : a.startsWith("user.") ? "green" : undefined;

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
    <Card
      title="紀錄"
      desc="同時印在伺服器 terminal：journalctl -u coidle -f"
      actions={
        <button class="ad-btn sm" type="button" onClick={csv} disabled={rows.length === 0}>
          <Ico n="download" />
          匯出 CSV
        </button>
      }
    >
      <form
        class="ad-row"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input type="text" placeholder="動作開頭，例如 mall. 或 user." value={action} onInput={(e) => setAction((e.target as HTMLInputElement).value)} style={{ width: "230px" }} />
        <input type="text" placeholder="操作者" value={actor} onInput={(e) => setActor((e.target as HTMLInputElement).value)} style={{ width: "150px" }} />
        <button class="ad-btn sm" type="submit">
          篩選
        </button>
      </form>
      {rows.length === 0 ? (
        <Empty>沒有符合的紀錄。</Empty>
      ) : (
        <div class="ad-scroll">
          <table class="ad-table">
            <thead>
              <tr>
                <th>時間</th>
                <th>操作者</th>
                <th>動作</th>
                <th>對象</th>
                <th>內容</th>
                <th>來源</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td class="num dim" style={{ whiteSpace: "nowrap" }}>
                    {fmtDateFull(r.ts)}
                  </td>
                  <td>
                    <b>{r.actor}</b>
                  </td>
                  <td>
                    <Badge tone={tone(r.action)}>{r.action}</Badge>
                  </td>
                  <td>{r.target || <span class="dim">—</span>}</td>
                  <td class="mono dim" style={{ maxWidth: "340px", overflowWrap: "anywhere" }}>
                    {Object.keys(r.detail).length ? JSON.stringify(r.detail) : ""}
                  </td>
                  <td class="mono dim">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <div class="ad-row end">
          <button class="ad-btn" onClick={() => load(true)}>
            更早的紀錄
          </button>
        </div>
      )}
    </Card>
  );
}
