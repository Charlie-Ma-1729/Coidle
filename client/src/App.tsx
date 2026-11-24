import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { isPaused, presetOfSpeed } from "@coidle/shared";
import { ClockBanner } from "./components/ClockBanner";
import { Toasts } from "./components/ui";
import { clockText, dateText } from "./format";
import { Auth } from "./screens/Auth";
import { Floor } from "./screens/Floor";
import { Lobby } from "./screens/Lobby";
import { Ops } from "./screens/Ops";
import { Overview } from "./screens/Overview";
import { Reports } from "./screens/Reports";
import { Team } from "./screens/Team";
import { authReady, bootstrap, mallId, mallInfo, online, state, user } from "./store";

type Tab = "overview" | "floor" | "reports" | "ops" | "team";
const tab = signal<Tab>("overview");

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "overview", icon: "🏠", label: "總覽" },
  { id: "floor", icon: "🏬", label: "樓層" },
  { id: "reports", icon: "📰", label: "日報" },
  { id: "ops", icon: "⚙️", label: "營運" },
  { id: "team", icon: "👥", label: "團隊" },
];

function MallShell() {
  const s = state.value;
  const pending = s?.pending.length ?? 0;
  return (
    <div class="app">
      <header class="topbar">
        <span class="brand">COIDLE</span>
        <span class="mall-name">{mallInfo.value?.name}</span>
        <span class="spacer" />
        {s && (
          <button class={`speed-chip ${isPaused(s.clock) ? "paused" : ""}`} onClick={() => (tab.value = "ops")} title="時間流速（點一下調整）">
            {isPaused(s.clock) ? "⏸ 已暫停" : s.clock.speed === 1 ? "⏩ 標準" : `🐢 ${presetOfSpeed(s.clock.speed).name}`}
          </button>
        )}
        {s && (
          <span class="clock" title="遊戲內時間">
            {dateText(s.tick)} {clockText(s.tick)}
          </span>
        )}
        <span class={`dot ${online.value ? "on" : ""}`} title={online.value ? "即時連線中" : "連線中斷，重新連線中…"} />
      </header>
      {!online.value && <div class="banner">連線中斷，正在重新連線…（畫面可能不是最新）</div>}
      <ClockBanner />
      <div class="layout">
        <nav class="nav" aria-label="主選單">
          {TABS.map((t) => (
            <button key={t.id} class={tab.value === t.id ? "active" : ""} onClick={() => (tab.value = t.id)}>
              <span class="ico">{t.icon}</span>
              <span>{t.label}</span>
              {t.id === "overview" && pending > 0 && <span class="badge">{pending}</span>}
            </button>
          ))}
        </nav>
        <main class="content">
          {!s ? (
            <p class="empty">載入中…</p>
          ) : tab.value === "overview" ? (
            <Overview />
          ) : tab.value === "floor" ? (
            <Floor />
          ) : tab.value === "reports" ? (
            <Reports />
          ) : tab.value === "ops" ? (
            <Ops />
          ) : (
            <Team />
          )}
        </main>
      </div>
    </div>
  );
}

export function App() {
  useEffect(() => {
    bootstrap();
  }, []);

  let body;
  if (!authReady.value) body = <p class="empty" style={{ paddingTop: "40vh" }}>載入中…</p>;
  else if (!user.value) body = <Auth />;
  else if (mallId.value === null) body = <Lobby />;
  else body = <MallShell />;

  return (
    <>
      {body}
      <Toasts />
    </>
  );
}
