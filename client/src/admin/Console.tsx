import { useEffect, useState } from "preact/hooks";
import { adminApi, type Overview } from "./adminApi";
import { AiTab } from "./AiTab";
import { AuditTab } from "./AuditTab";
import { LiveTab } from "./LiveTab";
import { MallsTab } from "./MallsTab";
import { NpcTab } from "./NpcTab";
import { UsersTab } from "./UsersTab";
import { errMsg, logout, myMalls, openMall, toast, user } from "../store";

type Tab = "live" | "malls" | "users" | "npc" | "ai" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "live", label: "📊 即時數據" },
  { id: "malls", label: "🏬 商場" },
  { id: "users", label: "👤 使用者" },
  { id: "npc", label: "🏢 NPC 商場" },
  { id: "ai", label: "🤖 AI 內容" },
  { id: "audit", label: "📜 稽核" },
];

/** Overseer（世界管理者）的管理室：數據、商場、使用者、AI 內容、稽核 */
export function Console() {
  const [tab, setTab] = useState<Tab>("live");
  const [ov, setOv] = useState<Overview | null>(null);

  const reload = async () => {
    try {
      setOv(await adminApi.overview());
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  const mine = myMalls.value;
  return (
    <div class="app">
      <header class="topbar">
        <span class="brand">COIDLE</span>
        <span class="mall-name">管理室・{user.value?.displayName}</span>
        <span class="spacer" />
        {mine.map((m) => (
          <button key={m.id} class="btn btn-ghost btn-sm" onClick={() => void openMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
            進入「{m.name}」
          </button>
        ))}
        <button class="btn btn-ghost btn-sm" onClick={() => void reload()}>
          重新整理
        </button>
        <button class="btn btn-ghost btn-sm" onClick={() => void logout()}>
          登出
        </button>
      </header>
      <div class="layout">
        <nav class="zones" style={{ gridColumn: "1 / -1" }}>
          {TABS.map((t) => (
            <button key={t.id} class={`zone-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <main class="content">
          {tab === "live" && <LiveTab />}
          {tab === "malls" && (ov ? <MallsTab ov={ov} mineIds={mine.map((m) => m.id)} reload={reload} /> : <p class="small dim">載入中…</p>)}
          {tab === "users" && (ov ? <UsersTab ov={ov} reload={reload} /> : <p class="small dim">載入中…</p>)}
          {tab === "npc" && (ov ? <NpcTab ov={ov} reload={reload} /> : <p class="small dim">載入中…</p>)}
          {tab === "ai" && <AiTab />}
          {tab === "audit" && <AuditTab />}
        </main>
      </div>
    </div>
  );
}
