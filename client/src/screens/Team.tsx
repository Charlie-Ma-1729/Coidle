import { ROLES, REAL_HOURS_PER_GAME_DAY, type RoleId } from "@coidle/shared";
import { api } from "../api";
import { Btn, Card, Chip, Empty } from "../components/ui";
import { activity, errMsg, leaveMall, logout, mallId, mallInfo, toast, user } from "../store";

const roleName = (id: string) => ROLES.find((r) => r.id === id)?.name ?? id;

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`;
}

export function Team() {
  const info = mallInfo.value;
  const id = mallId.value;
  if (!info || id === null) return null;
  const me = info.members.find((m) => m.userId === user.value?.id);

  const changeRole = async (role: RoleId) => {
    try {
      const r = await api.setRole(id, role);
      mallInfo.value = { ...info, members: r.members };
      toast("職位已更新", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已複製", "ok");
    } catch {
      toast("複製失敗，請手動選取", "error");
    }
  };
  const regen = async () => {
    try {
      const r = await api.regenInvite(id);
      mallInfo.value = { ...info, inviteCode: r.inviteCode };
      toast("已換新邀請碼，舊的失效", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <>
      <div class="grid two">
        <Card title={`👥 團隊（${info.members.length}）`}>
          <div>
            {info.members.map((m) => (
              <div class="member" key={m.userId}>
                <div>
                  <b>{m.displayName}</b> {m.isOwner && <Chip tone="amber">創辦人</Chip>} {m.userId === user.value?.id && <Chip tone="pink">我</Chip>}
                </div>
                <Chip tone="cyan">{roleName(m.role)}</Chip>
              </div>
            ))}
          </div>
          {me && (
            <div class="row" style={{ marginTop: "10px" }}>
              <span class="small dim">我的職位</span>
              <select style={{ width: "auto" }} value={me.role} onChange={(e) => changeRole((e.target as HTMLSelectElement).value as RoleId)}>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Card>

        {info.inviteCode && (
          <Card title="🎟 邀請夥伴">
            <div class="stack">
              <div class="code">{info.inviteCode}</div>
              <div class="row">
                <Btn small onClick={() => copy(info.inviteCode!)}>
                  複製邀請碼
                </Btn>
                <Btn small kind="danger" onClick={regen}>
                  換新邀請碼
                </Btn>
              </div>
              <p class="small dim">把邀請碼給朋友，他們註冊後用「加入商場」輸入即可。</p>
            </div>
          </Card>
        )}
      </div>

      <Card title="📣 團隊動態">
        {activity.value.length === 0 ? (
          <Empty>還沒有人動過什麼。</Empty>
        ) : (
          <div class="log">
            <ul>
              {activity.value.slice(0, 25).map((a) => (
                <li key={a.id}>
                  <time>{ago(a.ts)}</time>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="⏱ 遊戲時間">
        <p class="small dim">
          真實 {REAL_HOURS_PER_GAME_DAY} 小時 ＝ 遊戲 1 天（1 遊戲小時 ≈ 15 真實分鐘）。你不在線時商場照常營業，回來看營運日報就好。
        </p>
      </Card>

      <div class="row">
        <Btn small onClick={leaveMall}>
          切換商場
        </Btn>
        <Btn small kind="danger" onClick={() => logout()}>
          登出
        </Btn>
      </div>
    </>
  );
}
