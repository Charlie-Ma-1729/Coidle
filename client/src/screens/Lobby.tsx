import { useState } from "preact/hooks";
import { ROLES, type RoleId } from "@coidle/shared";
import { api } from "../api";
import { Btn, Card, Empty, Field } from "../components/ui";
import { errMsg, logout, myMalls, openMall, refreshMe, toast, user } from "../store";

export function Lobby() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState<RoleId>("ops");
  const [pending, setPending] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setPending(false);
    }
  };

  const create = (e: Event) => {
    e.preventDefault();
    return guard(async () => {
      const { id } = await api.createMall(name.trim());
      await refreshMe();
      await openMall(id);
    });
  };
  const join = (e: Event) => {
    e.preventDefault();
    return guard(async () => {
      const { id } = await api.joinMall(code.trim(), role);
      await refreshMe();
      await openMall(id);
    });
  };

  return (
    <main class="auth">
      <div class="auth-card" style={{ width: "min(100%, 520px)" }}>
        <h1>COIDLE</h1>
        <p class="tagline">哈囉，{user.value?.displayName}</p>

        <Card title="我的商場">
          {myMalls.value.length === 0 ? (
            <Empty>還沒有加入任何商場。建立一座，或用邀請碼加入朋友的商場。</Empty>
          ) : (
            <div class="stack">
              {myMalls.value.map((m) => (
                <div class="row between" key={m.id}>
                  <div>
                    <b>{m.name}</b> {m.isOwner && <span class="chip chip-amber">創辦人</span>}
                  </div>
                  <Btn kind="primary" small onClick={() => guard(() => openMall(m.id))}>
                    進入
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="建立新商場">
          <form class="stack" onSubmit={create}>
            <Field label="商場名稱">
              <input type="text" maxLength={30} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required />
            </Field>
            <Btn kind="primary" type="submit" disabled={pending}>
              開幕！
            </Btn>
          </form>
        </Card>

        <Card title="用邀請碼加入">
          <form class="stack" onSubmit={join}>
            <Field label="邀請碼">
              <input type="text" maxLength={16} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} required />
            </Field>
            <Field label="我想負責">
              <select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as RoleId)}>
                {ROLES.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Btn type="submit" disabled={pending}>
              加入
            </Btn>
          </form>
        </Card>

        <Btn small onClick={() => logout()}>
          登出
        </Btn>
      </div>
    </main>
  );
}
