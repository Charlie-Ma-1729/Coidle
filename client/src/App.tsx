import { useEffect } from "preact/hooks";
import { Toasts } from "./components/ui";
import { Admin } from "./screens/Admin";
import { Auth } from "./screens/Auth";
import { Lobby } from "./screens/Lobby";
import { StageGame } from "./stage/StageGame";
import { StageDemo } from "./stage/StageScreen";
import { authReady, bootstrap, mallId, user } from "./store";

/**
 * 入口。
 * - `#stage-demo`：畫面版範例（假資料、不連伺服器），開發用
 * - `#admin`：管理後台
 * - 其餘：登入 → 選商場 → 畫面版（預設首頁）
 */
export function App() {
  if (typeof location !== "undefined" && location.hash === "#stage-demo") return <StageDemo />;
  return <MainApp />;
}

function MainApp() {
  useEffect(() => {
    bootstrap();
  }, []);

  let body;
  if (typeof location !== "undefined" && location.hash === "#admin") body = <Admin />;
  else if (!authReady.value) body = <p class="empty" style={{ paddingTop: "40vh" }}>載入中…</p>;
  else if (!user.value) body = <Auth />;
  else if (mallId.value === null) body = <Lobby />;
  else body = <StageGame />;

  return (
    <>
      {body}
      <Toasts />
    </>
  );
}
