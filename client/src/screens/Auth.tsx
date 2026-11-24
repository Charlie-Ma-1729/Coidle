import { useState } from "preact/hooks";
import { api } from "../api";
import { Btn, Field } from "../components/ui";
import { bootstrap, errMsg, toast } from "../store";

export function Auth() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setPending(true);
    try {
      if (mode === "login") await api.login(username, password);
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
        <Field label="帳號">
          <input type="text" autocomplete="username" value={username} onInput={(e) => setUsername((e.target as HTMLInputElement).value)} required />
        </Field>
        {mode === "register" && (
          <Field label="暱稱（隊友看到的名字）">
            <input type="text" maxLength={20} value={displayName} onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)} />
          </Field>
        )}
        <Field label="密碼" hint={mode === "register" ? "至少 8 個字元" : undefined}>
          <input
            type="password"
            autocomplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            required
          />
        </Field>
        {mode === "register" && (
          <Field label="註冊密語" hint="如果管理者有設定才需要填">
            <input type="text" value={secret} onInput={(e) => setSecret((e.target as HTMLInputElement).value)} />
          </Field>
        )}
        <Btn kind="primary" type="submit" disabled={pending}>
          {mode === "login" ? "進入商場" : "建立帳號"}
        </Btn>
      </form>
    </main>
  );
}
