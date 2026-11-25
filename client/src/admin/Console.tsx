import { signal } from "@preact/signals";
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { adminApi, type Overview } from "./adminApi";
import { AiTab } from "./AiTab";
import { AuditTab } from "./AuditTab";
import { EventsTab } from "./EventsTab";
import { LiveTab } from "./LiveTab";
import { MallsTab } from "./MallsTab";
import { NpcTab } from "./NpcTab";
import { UsersTab } from "./UsersTab";
import { DialogHost, Ico, type IconName } from "./kit";
import { errMsg, logout, myMalls, openMall, toast, user } from "../store";
import "./admin.css";

type Tab = "live" | "malls" | "users" | "npc" | "events" | "ai" | "audit";
interface TabDef {
  id: Tab;
  label: string;
  icon: IconName;
  title: string;
  desc: string;
}
const GROUPS: { title: string; tabs: TabDef[] }[] = [
  {
    title: "營運",
    tabs: [
      { id: "live", label: "即時數據", icon: "live", title: "即時數據", desc: "線上人數、活躍玩家、伺服器狀態與每日統計，可匯出。" },
      { id: "audit", label: "稽核紀錄", icon: "audit", title: "稽核紀錄", desc: "每個管理操作都留在這裡，也會印在伺服器的 terminal。" },
    ],
  },
  {
    title: "世界",
    tabs: [
      { id: "malls", label: "商場", icon: "mall", title: "商場", desc: "旁觀、進入、調整與管理每一座商場。" },
      { id: "users", label: "使用者", icon: "users", title: "使用者", desc: "搜尋帳號、重設密碼、登出裝置、刪除帳號。" },
      { id: "npc", label: "NPC 商場", icon: "npc", title: "NPC 商場", desc: "玩家分不出誰是 NPC；在這裡調整、操控它們出手。" },
      { id: "events", label: "事件與天氣", icon: "event", title: "事件與天氣", desc: "寫隨機事件、立刻觸發、改天氣。" },
    ],
  },
  {
    title: "內容",
    tabs: [{ id: "ai", label: "AI 內容", icon: "ai", title: "AI 內容", desc: "生成預算、內容池與待審核的事件和常客。" }],
  },
];
const ALL = GROUPS.flatMap((g) => g.tabs);

// 記在模組裡：從商場「返回管理室」時，回到離開前的那一頁
const KEY = "coidle.adminTab";
const initial = (): Tab => {
  try {
    const v = localStorage.getItem(KEY) as Tab | null;
    if (v && ALL.some((t) => t.id === v)) return v;
  } catch {
    // ignore
  }
  return "live";
};
const currentTab = signal<Tab>(initial());
const setTab = (t: Tab) => {
  currentTab.value = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // ignore
  }
};

/** Overseer（世界管理者）的管理室 */
export function Console() {
  const tab = currentTab.value;
  const [ov, setOv] = useState<Overview | null>(null);
  const [spin, setSpin] = useState(false);

  const reload = async () => {
    setSpin(true);
    try {
      setOv(await adminApi.overview());
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSpin(false);
    }
  };
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void adminApi.overview().then(setOv, () => undefined), 30_000);
    return () => clearInterval(timer);
  }, []);

  const mine = myMalls.value;
  const def = ALL.find((t) => t.id === tab)!;
  const loading = <p class="ad-empty">載入中…</p>;
  const badge = (id: Tab) => (id === "malls" && ov ? ov.malls.length : id === "users" && ov ? ov.users.length : null);

  return (
    <div class="ad-root">
      <aside class="ad-side">
        <div class="ad-brand">
          <b>COIDLE</b>
          <span>管理室</span>
        </div>
        <nav class="ad-nav" aria-label="管理室選單">
          {GROUPS.map((g) => (
            <Fragment key={g.title}>
              <div class="ad-nav-title">{g.title}</div>
              {g.tabs.map((t) => {
                const n = badge(t.id);
                return (
                  <button key={t.id} class={`ad-nav-item ${tab === t.id ? "active" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
                    <Ico n={t.icon} />
                    {t.label}
                    {n !== null && <span class="ad-count">{n}</span>}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </nav>
        <div class="ad-side-foot">
          <div class="ad-me">
            <span class="ad-avatar">{(user.value?.displayName ?? "O").slice(0, 1).toUpperCase()}</span>
            <div>
              <b>{user.value?.displayName}</b>
              <span>Overseer</span>
            </div>
          </div>
          <button class="ad-btn ghost sm" onClick={() => void logout()}>
            <Ico n="logout" />
            登出
          </button>
        </div>
      </aside>

      <main class="ad-main">
        <header class="ad-head">
          <div class="ad-head-t">
            <h1>{def.title}</h1>
            <p>{def.desc}</p>
          </div>
          <span class="ad-spacer" />
          {mine.map((m) => (
            <button key={m.id} class="ad-btn" onClick={() => void openMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
              <Ico n="enter" />
              進入「{m.name}」
            </button>
          ))}
          <button class="ad-btn ghost" onClick={() => void reload()} disabled={spin}>
            <Ico n="refresh" />
            重新整理
          </button>
        </header>
        <div class="ad-body">
          {tab === "live" && <LiveTab />}
          {tab === "malls" && (ov ? <MallsTab ov={ov} mineIds={mine.map((m) => m.id)} reload={reload} /> : loading)}
          {tab === "users" && (ov ? <UsersTab ov={ov} reload={reload} /> : loading)}
          {tab === "npc" && (ov ? <NpcTab ov={ov} reload={reload} /> : loading)}
          {tab === "events" && (ov ? <EventsTab ov={ov} /> : loading)}
          {tab === "ai" && <AiTab />}
          {tab === "audit" && <AuditTab />}
        </div>
      </main>
      <DialogHost />
    </div>
  );
}
