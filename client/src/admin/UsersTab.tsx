import { useState } from "preact/hooks";
import { adminApi, type AdminUser, type Overview } from "./adminApi";
import { errMsg, toast } from "../store";

const date = (ms: number) => (ms ? new Date(ms).toLocaleString("zh-TW", { hour12: false }) : "—");

/** 使用者：列表、改暱稱、登出所有裝置、重設密碼、刪除 */
export function UsersTab(props: { ov: Overview; reload: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const mallsOf = (uid: number) => props.ov.malls.filter((m) => m.members_list.some((x) => x.userId === uid));
  const users = props.ov.users.filter((u) => !q || `${u.username} ${u.display_name}`.toLowerCase().includes(q.toLowerCase()));

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const r = await fn();
      if (r && typeof r === "object" && "tempPassword" in r) setShown(`${ok}：臨時密碼 ${(r as { tempPassword: string }).tempPassword}（只顯示這一次，請私下告訴他）`);
      else toast(ok, "ok");
      await props.reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const row = (u: AdminUser) => (
    <li key={u.id}>
      <time>#{u.id}</time>
      <span>
        <b>{u.username}</b>（{u.display_name}）{u.role === "overseer" && <span class="chip chip-amber">Overseer</span>}
        <span class="small dim"> ・註冊 {date(u.created_at)} ・最後上線 {date(u.last_seen_at)}</span>
        <br />
        <span class="small dim">商場：{mallsOf(u.id).map((m) => m.name).join("、") || "—"}</span>
        {u.role !== "overseer" && (
          <>
            {" "}
            <button
              class="linklike small"
              onClick={() => {
                const name = prompt("新的暱稱", u.display_name)?.trim();
                if (name) void act(() => adminApi.post(`/users/${u.id}/rename`, { displayName: name }), "已改暱稱");
              }}
            >
              改暱稱
            </button>{" "}
            <button class="linklike small" onClick={() => confirm(`登出「${u.username}」的所有裝置？`) && void act(() => adminApi.post(`/users/${u.id}/logout`), "已登出所有裝置")}>
              登出所有裝置
            </button>{" "}
            <button class="linklike small" onClick={() => confirm(`重設「${u.username}」的密碼？他所有裝置都會被登出。`) && void act(() => adminApi.post<{ tempPassword: string }>(`/users/${u.id}/reset-password`), `已重設 ${u.username}`)}>
              重設密碼
            </button>{" "}
            <button class="linklike small" onClick={() => confirm(`刪除「${u.username}」？他創辦的商場會轉給其他成員，沒人了就解散。`) && void act(() => adminApi.post(`/users/${u.id}/delete`), `已刪除 ${u.username}`)}>
              刪除
            </button>
          </>
        )}
      </span>
    </li>
  );

  return (
    <div class="card">
      <h3>使用者（{props.ov.users.length}）</h3>
      {shown && (
        <div class="alert cyan">
          <span class="small">{shown}</span>
        </div>
      )}
      <input type="search" placeholder="搜尋帳號或暱稱" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ marginBottom: "8px" }} />
      <div class="log">
        <ul>{users.map(row)}</ul>
      </div>
    </div>
  );
}
