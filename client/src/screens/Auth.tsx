import { useState } from "preact/hooks";
import { api } from "../api";
import { Btn, Field } from "../components/ui";
import { bootstrap, errMsg, toast } from "../store";

export function Auth() {
  const [mode, setMode] = useState<"login" | "register" | "key">("login");
  const [key, setKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setPending(true);
    try {
      if (mode === "key") await api.overseerLogin(key.trim());
      else if (mode === "login") await api.login(username, password);
      else await api.register(username, password, displayName.trim() || username, secret.trim() || undefined);
      await bootstrap();
    } catch (err) {
      toast(errMsg(err), "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <main class="auth">
      <form class="card auth-card" onSubmit={submit}>
        <h1>COIDLE</h1>
        <p class="tagline">和夥伴一起經營一座永不打烊的商場</p>
        <div class="tabs">
          <button type="button" class={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            登入
          </button>
          <button type="button" class={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            註冊
          </button>
        </div>
        {mode === "key" ? (
          <Field label="管理者金鑰" hint="只有世界管理者（Overseer）使用">
            <input type="password" autocomplete="off" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} required />
          </Field>
        ) : (
          <Field label="帳號">
            <input type="text" autocomplete="username" value={username} onInput={(e) => setUsername((e.target as HTMLInputElement).value)} required />
          </Field>
        )}
        {mode === "register" && (
          <Field label="暱稱（隊友看到的名字）">
            <input type="text" maxLength={20} value={displayName} onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)} />
          </Field>
        )}
        {mode !== "key" && (
          <Field label="密碼" hint={mode === "register" ? "至少 8 個字元" : undefined}>
            <input
              type="password"
              autocomplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              required
            />
          </Field>
        )}
        {mode === "register" && (
          <Field label="註冊密語" hint="如果管理者有設定才需要填">
            <input type="text" value={secret} onInput={(e) => setSecret((e.target as HTMLInputElement).value)} />
          </Field>
        )}
        <Btn kind="primary" type="submit" disabled={pending}>
          {mode === "register" ? "建立帳號" : mode === "key" ? "以金鑰登入" : "進入商場"}
        </Btn>
        <p class="small" style={{ textAlign: "center", marginTop: "8px" }}>
          <button type="button" class="linklike small" onClick={() => setMode(mode === "key" ? "login" : "key")}>
            {mode === "key" ? "回到一般登入" : "管理者金鑰登入"}
          </button>
        </p>
      </form>
    </main>
  );
}
