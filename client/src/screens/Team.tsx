import { CONTROLLER_TITLE, ROLES, REAL_HOURS_PER_GAME_DAY, type RoleId } from "@coidle/shared";
import { api } from "../api";
import { Btn, Card, Chip, Empty } from "../components/ui";
import { AccountCard } from "../components/AccountCard";
import { EquityCard } from "../components/EquityCard";
import { activity, errMsg, leaveMall, logout, mallId, mallInfo, refreshMe, toast, user } from "../store";

const roleName = (id: string) => ROLES.find((r) => r.id === id)?.name ?? id;

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`;
}

/** part：團隊成員／邀請／動態（世界樞紐）、商場控制與帳號（設定視窗）、或全部（舊版整頁） */
export function Team({ part = "all" }: { part?: "all" | "team" | "controls" }) {
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
  // 管事的人：有實際控制人（持股過半）就是他，沒有就是創辦人
  const hasController = info.members.some((m) => m.isController);
  const isOwner = hasController ? !!me?.isController : !!me?.isOwner;
  const act = async (fn: () => Promise<{ members: NonNullable<typeof info>["members"] }>, okText: string) => {
    try {
      const r = await fn();
      mallInfo.value = { ...info, members: r.members };
      toast(okText, "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const leaveForever = async () => {
    if (!confirm(info.members.length <= 1 ? "你是最後一位成員，離開會解散這座商場，確定嗎？" : "確定要離開這座商場嗎？")) return;
    try {
      await api.leaveMallServer(id);
      await refreshMe();
      leaveMall();
      toast("已離開商場", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const rename = async () => {
    const name = prompt("新的商場名稱", info.name)?.trim();
    if (!name || name === info.name) return;
    try {
      const r = await api.renameMall(id, name);
      mallInfo.value = { ...info, name: r.name };
      await refreshMe();
      toast("商場名稱已更新", "ok");
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

  const showTeam = part !== "controls";
  const showControls = part !== "team";

  return (
    <>
      {showTeam && (
        <>
      <div class="grid two">
        <Card title={`👥 團隊（${info.members.length}）`}>
          <div>
            {info.members.map((m) => (
              <div class="member" key={m.userId}>
                <div>
                  <b>{m.displayName}</b> {m.isController && <Chip tone="green">{CONTROLLER_TITLE}</Chip>} {m.isOwner && <Chip tone="amber">創辦人</Chip>} {m.userId === user.value?.id && <Chip tone="pink">我</Chip>}
                </div>
                <div class="row" style={{ gap: "6px" }}>
                  <Chip tone="cyan">{roleName(m.role)}</Chip>
                  {isOwner && m.userId !== user.value?.id && (
                    <>
                      <Btn small onClick={() => confirm(`把創辦人轉讓給「${m.displayName}」？你會變成一般成員。`) && act(() => api.transferOwner(id, m.userId), "已轉讓創辦人")}>
                        轉讓
                      </Btn>
                      <Btn small kind="danger" onClick={() => confirm(`請「${m.displayName}」離開商場？`) && act(() => api.kickMember(id, m.userId), "已請他離開")}>
                        請離開
                      </Btn>
                    </>
                  )}
                </div>
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

      <EquityCard />

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
        </>
      )}

      {showControls && (
        <>
      <Card title="⏱ 遊戲時間">
        <p class="small dim">
          伺服器基準時間：真實 {REAL_HOURS_PER_GAME_DAY} 小時 ＝ 遊戲 1 天（1 遊戲小時 ≈ 10 真實分鐘），所有商場共用，誰都不能比它快。你不在線時商場照常營業，回來看營運日報就好；沒空顧的時候，到「設定 → 遊戲時間」暫停——暫停會讓商場落後伺服器時間，恢復後會自動加速追回。
        </p>
      </Card>

      <AccountCard onDeleted={() => logout()} />

      <div class="row">
        {isOwner && (
          <Btn small onClick={rename}>
            改商場名稱
          </Btn>
        )}
        <Btn small onClick={leaveForever}>
          離開這座商場
        </Btn>
        <Btn small onClick={leaveMall}>
          切換商場
        </Btn>
        <Btn small kind="danger" onClick={() => logout()}>
          登出
        </Btn>
      </div>
        </>
      )}
    </>
  );
}

export const TeamMembers = () => <Team part="team" />;
export const MallControls = () => <Team part="controls" />;
