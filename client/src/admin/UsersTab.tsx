import { useState } from "preact/hooks";
import { adminApi, type AdminUser, type Overview } from "./adminApi";
import { ago, Badge, Card, confirmBox, Empty, fmtDateFull, Ico, promptBox, secretBox } from "./kit";
import { errMsg, toast } from "../store";

/** 使用者：搜尋、改暱稱、登出所有裝置、重設密碼、刪除 */
export function UsersTab(props: { ov: Overview; reload: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const mallsOf = (uid: number) => props.ov.malls.filter((m) => m.members_list.some((x) => x.userId === uid));
  const users = props.ov.users.filter((u) => !q || `${u.username} ${u.display_name}`.toLowerCase().includes(q.toLowerCase()));

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const r = await fn();
      if (r && typeof r === "object" && "tempPassword" in r) await secretBox(ok, "這組臨時密碼只會顯示這一次，請私下告訴他；他登入後建議立刻改密碼。", (r as { tempPassword: string }).tempPassword);
      else toast(ok, "ok");
      await props.reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const row = (u: AdminUser) => {
    const ms = mallsOf(u.id);
    return (
      <tr key={u.id}>
        <td class="mono dim" data-l="編號">#{u.id}</td>
        <td>
          <div class="ad-cell-main">
            <b>
              {u.display_name} {u.role === "overseer" && <Badge tone="amber">Overseer</Badge>}
            </b>
            <small>{u.username}</small>
          </div>
        </td>
        <td data-l="商場">
          {ms.length === 0 ? (
            <span class="dim">—</span>
          ) : (
            <span class="ad-row" style={{ gap: "4px" }}>
              {ms.map((m) => (
                <Badge key={m.id} tone={m.sandbox ? "amber" : "cyan"}>
                  {m.name}
                </Badge>
              ))}
            </span>
          )}
        </td>
        <td data-l="最後上線">
          <div class="ad-cell-main">
            <span>{ago(u.last_seen_at)}</span>
            <small title={fmtDateFull(u.last_seen_at)}>註冊 {fmtDateFull(u.created_at)}</small>
          </div>
        </td>
        <td class="act">
          {u.role !== "overseer" && (
            <>
              <button
                class="ad-btn sm"
                onClick={async () => {
                  const name = await promptBox("新的暱稱", u.display_name);
                  if (name) void act(() => adminApi.post(`/users/${u.id}/rename`, { displayName: name }), "已改暱稱");
                }}
              >
                改暱稱
              </button>
              <button
                class="ad-btn sm"
                onClick={async () => {
                  if (await confirmBox(`登出「${u.username}」的所有裝置？`, "他需要重新登入。")) void act(() => adminApi.post(`/users/${u.id}/logout`), "已登出所有裝置");
                }}
              >
                登出所有裝置
              </button>
              <button
                class="ad-btn sm"
                onClick={async () => {
                  if (await confirmBox(`重設「${u.username}」的密碼？`, "他所有裝置都會被登出，並得到一組臨時密碼。")) void act(() => adminApi.post<{ tempPassword: string }>(`/users/${u.id}/reset-password`), `已重設 ${u.username}`);
                }}
              >
                重設密碼
              </button>
              <button
                class="ad-btn sm danger"
                onClick={async () => {
                  if (await confirmBox(`刪除「${u.username}」？`, "他創辦的商場會轉給其他成員，沒人了就解散。無法復原。", { danger: true, ok: "刪除" })) void act(() => adminApi.post(`/users/${u.id}/delete`), `已刪除 ${u.username}`);
                }}
              >
                刪除
              </button>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <Card
      title={`使用者（${props.ov.users.length}）`}
      actions={
        <span class="ad-search">
          <Ico n="search" />
          <input type="search" placeholder="搜尋帳號或暱稱" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </span>
      }
    >
      {users.length === 0 ? (
        <Empty>沒有符合的使用者。</Empty>
      ) : (
        <div class="ad-scroll">
          <table class="ad-table cards">
            <thead>
              <tr>
                <th>編號</th>
                <th>使用者</th>
                <th>所屬商場</th>
                <th>最後上線</th>
                <th />
              </tr>
            </thead>
            <tbody>{users.map(row)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
