/**
 * 真實資料版的 5 個樞紐視窗。內容依 docs/stage-ui-feature-map.md 重新組合：
 * 每個樞紐 ≤ 4 個分頁、頂部有摘要、分頁帶待辦徽章，沒用到的分頁依 reveal.ts 先隱藏。
 */
import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { PublicMallState } from "@coidle/shared";
import { AccountCard } from "../../components/AccountCard";
import { DeviceCard } from "../../components/DeviceCard";
import { EventChoiceCard } from "../../components/EventCards";
import { InspectionCard } from "../../components/InspectionCard";
import { Achievements } from "../../screens/Achievements";
import { FinanceSummary } from "../../screens/FinanceSummary";
import { Goals } from "../../screens/Goals";
import { GuestPrefs, ReviewLog, TodoCard } from "../../screens/Guests";
import { Legal } from "../../screens/Legal";
import { PatrolTab } from "../../screens/Patrol";
import { Help } from "../../screens/Help";
import { Leasing } from "../../screens/Leasing";
import { Marketing } from "../../screens/Marketing";
import { FacilityCards, HoursCards, TimeSettings } from "../../screens/Ops";
import { Regulars } from "../../screens/Regulars";
import { Reports } from "../../screens/Reports";
import { Rivals } from "../../screens/Rivals";
import { Suppliers } from "../../screens/Suppliers";
import { Tax } from "../../screens/Tax";
import { MallControls, TeamMembers } from "../../screens/Team";
import { Tech } from "../../screens/Tech";
import { Workshop } from "../../screens/Workshop";
import { World } from "../../screens/World";
import type { GlyphKey } from "../../stage/glyphs";
import type { HubId } from "../../stage/model";
import { state } from "../../store";
import { HUBS } from "../Dock";
import { Icon } from "../Icon";
import { featureIndex, resolveTab, visibleTabs } from "../reveal";
import { Window } from "../Window";
import { reportWeatherText } from "../weatherUi";
import { hubSummary } from "./summary";

interface TabDef {
  id: string;
  label: string;
  render: (s: PublicMallState) => ComponentChildren;
}

const HUB_TABS: Record<HubId, { title: string; tabs: TabDef[] }> = {
  operate: {
    title: "營運",
    tabs: [
      { id: "hours", label: "營業時間", render: () => <HoursCards /> },
      { id: "supply", label: "補貨與供應", render: () => <Suppliers /> },
      { id: "promo", label: "行銷", render: () => <Marketing /> },
      { id: "facility", label: "設備與稽查", render: () => <FacilityCards /> },
    ],
  },
  guests: {
    title: "客人",
    tabs: [
      {
        id: "inbox",
        label: "客訴與評價",
        render: (s) => (
          <>
            <TodoCard s={s} />
            <Legal />
            <ReviewLog s={s} />
            <GuestPrefs s={s} />
          </>
        ),
      },
      { id: "regulars", label: "熟客", render: () => <Regulars /> },
      { id: "walk", label: "巡店", render: () => <PatrolTab /> },
    ],
  },
  develop: {
    title: "開發",
    tabs: [
      { id: "workshop", label: "研發工坊", render: () => <Workshop /> },
      { id: "tech", label: "科技", render: () => <Tech /> },
      { id: "leasing", label: "招商", render: () => <Leasing /> },
    ],
  },
  finance: {
    title: "財務",
    tabs: [
      { id: "cash", label: "資金與損益", render: () => <FinanceSummary /> },
      { id: "reports", label: "日報", render: () => <Reports /> },
      { id: "tax", label: "稅務與帳單", render: () => <Tax /> },
    ],
  },
  world: {
    title: "世界",
    tabs: [
      { id: "dir", label: "名錄與榜單", render: () => <World /> },
      { id: "rivals", label: "商戰", render: () => <Rivals /> },
      { id: "team", label: "團隊", render: () => <TeamMembers /> },
    ],
  },
};

export function GameHub(props: { hub: HubId; tab?: string; badges: Record<string, number>; onClose: () => void }) {
  const s = state.value;
  const [picked, setPicked] = useState<string | undefined>(props.tab);
  if (!s) return null;
  const def = HUB_TABS[props.hub];
  const meta = HUBS.find((h) => h.id === props.hub)!;
  const shown = visibleTabs(s, props.hub);
  const tabs = def.tabs.filter((t) => shown.includes(t.id));
  const cur = resolveTab(s, props.hub, picked);
  const active = tabs.find((t) => t.id === cur) ?? tabs[0];
  return (
    <Window
      title={def.title}
      icon={meta.glyph}
      summary={hubSummary(s, props.hub)}
      tabs={tabs.length > 1 ? tabs.map((t) => ({ id: t.id, label: t.label, badge: props.badges[t.id] })) : []}
      tab={active?.id ?? ""}
      onTab={setPicked}
      onClose={props.onClose}
    >
      {active ? active.render(s) : <p class="empty">這個功能還沒開放。</p>}
    </Window>
  );
}

// ───────── 商場選單的頁面 ─────────

export type MenuPage = "goals" | "achievements" | "help" | "settings" | "all";

const MENU: Record<MenuPage, { title: string; glyph: GlyphKey }> = {
  goals: { title: "目標", glyph: "target" },
  achievements: { title: "成就", glyph: "star" },
  help: { title: "說明與新手任務", glyph: "help" },
  settings: { title: "設定", glyph: "gear" },
  all: { title: "全部功能", glyph: "list" },
};

/** 全部功能索引：顯示中的可直接開啟，還沒開放的說明何時開放 */
function AllFeatures(props: { onOpen: (hub: HubId, tab: string) => void }) {
  const s = state.value;
  if (!s) return null;
  const idx = featureIndex(s);
  return (
    <>
      <p class="st-hint">這裡列出所有功能。還沒開放的會告訴你怎麼解鎖；已經有資料的功能一律會顯示。</p>
      {HUBS.map((h) => {
        const rows = idx.filter((e) => e.hub === h.id);
        return (
          <div class="st-sec" key={h.id}>
            <h4>{rows[0]?.hubLabel ?? h.label}</h4>
            <div class="st-list">
              {rows.map((e) => (
                <div class="st-li" key={e.id}>
                  <span class="grow">
                    <b>{e.label}</b>
                    {!e.visible && <small>🔒 {e.hint}</small>}
                  </span>
                  {e.visible && (
                    <button class="st-btn" onClick={() => props.onOpen(e.hub, e.tab!)}>
                      開啟
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function MenuWindow(props: { page: MenuPage; onClose: () => void; onOpenHub: (hub: HubId, tab: string) => void }) {
  if (props.page === "settings") {
    return <SettingsWindow onClose={props.onClose} />;
  }
  const m = MENU[props.page];
  return (
    <Window title={m.title} icon={m.glyph} tabs={[]} tab="" onTab={() => {}} onClose={props.onClose}>
      {props.page === "goals" && <Goals />}
      {props.page === "achievements" && <Achievements />}
      {props.page === "help" && <Help />}
      {props.page === "all" && <AllFeatures onOpen={props.onOpenHub} />}
    </Window>
  );
}

function SettingsWindow(props: { onClose: () => void }) {
  const [tab, setTab] = useState("time");
  return (
    <Window
      title="設定"
      icon="gear"
      tabs={[
        { id: "time", label: "遊戲時間" },
        { id: "team", label: "團隊" },
        { id: "mall", label: "商場與帳號" },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={props.onClose}
    >
      {tab === "time" ? (
        <TimeSettings />
      ) : tab === "team" ? (
        <TeamMembers />
      ) : (
        <>
          <DeviceCard />
          <MallControls />
        </>
      )}
    </Window>
  );
}

/** 單一事件／稽查預告：用既有的選項卡處理 */
export function PendingWindow(props: { kind: "event" | "inspection"; uid: string; onClose: () => void }) {
  const s = state.value;
  if (!s) return null;
  const ev = props.kind === "event" ? s.pending.find((p) => p.uid === props.uid) : undefined;
  const ins = props.kind === "inspection" ? s.inspections.pending.find((n) => n.uid === props.uid) : undefined;
  const gone = !ev && !ins;
  return (
    <Window title={props.kind === "event" ? "待決事件" : "稽查預告"} icon="event" tabs={[]} tab="" onTab={() => {}} onClose={props.onClose}>
      {ev && <EventChoiceCard s={s} p={ev} />}
      {ins && <InspectionCard s={s} n={ins} />}
      {gone && <p class="empty">這件事已經處理完了。</p>}
    </Window>
  );
}

/** 每日結算時彈出一次的快訊（取代常駐在首頁的報紙卡） */
export function ReportPopup(props: { onClose: () => void; onOpenReports: () => void }) {
  const s = state.value;
  const r = s?.reports[s.reports.length - 1];
  if (!s || !r) return null;
  return (
    <div class="st-win-wrap" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="st-news st-panel" role="dialog" aria-label="每日快訊">
        <div class="st-win-bar">
          <Icon name="news" size={3} />
          <h2>商場快訊・{r.date}</h2>
          <button class="st-btn sq st-x" style={{ marginLeft: "auto" }} onClick={props.onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        <div class="st-news-body">
          <h3>{r.headline}</h3>
          {r.weather && <p class="st-hint">{reportWeatherText(r.weather)}</p>}
          <ul>
            {r.notes.slice(0, 5).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <div class="st-row between">
            <span class="st-hint">
              昨日損益 <b class={r.profit >= 0 ? "pos" : "neg"}>{r.profit >= 0 ? "+" : ""}{Math.round(r.profit).toLocaleString("en-US")}</b>・{r.groups} 組客人
            </span>
            <div class="st-row">
              <button class="st-btn" onClick={props.onOpenReports}>
                看完整日報
              </button>
              <button class="st-btn pri" onClick={props.onClose}>
                知道了
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
