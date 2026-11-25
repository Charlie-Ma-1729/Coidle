import { useEffect } from "preact/hooks";
import { Toasts } from "./components/ui";
import { UpdateBanner } from "./components/UpdateBanner";
import { Console } from "./admin/Console";
import { Auth } from "./screens/Auth";
import { Lobby } from "./screens/Lobby";
import { StageGame } from "./stage/StageGame";
import { StageDemo } from "./stage/StageScreen";
import { authReady, bootstrap, mallId, user } from "./store";

/**
 * 入口。
 * - `#stage-demo`：畫面版範例（假資料、不連伺服器），開發用
 * - Overseer（世界管理者）登入後先進管理室，可旁觀任何商場、進入自己的商場
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
  if (!authReady.value) body = <p class="empty" style={{ paddingTop: "40vh" }}>載入中…</p>;
  else if (!user.value) body = <Auth />;
  else if (mallId.value === null && user.value.role === "overseer") body = <Console />;
  else if (mallId.value === null) body = <Lobby />;
  else body = <StageGame />;

  return (
    <>
      {body}
      <Toasts />
      <UpdateBanner />
    </>
  );
}
