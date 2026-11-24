import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { HealthResponse } from "@coidle/shared";
import "./style.css";

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main class="shell">
      <h1>Coidle</h1>
      <p>多人合作・離線也會賺錢的商場經營遊戲</p>
      <p class="status">伺服器：{health ? "已連線" : "未連線"}</p>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
