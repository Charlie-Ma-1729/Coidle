import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { isPaused } from "@coidle/shared";
import { ClockBanner } from "../components/ClockBanner";
import { money } from "../format";
import { AttentionCenter } from "../ui/AttentionCenter";
import { hubBadges, tabBadges } from "../ui/attention";
import { hubVisible } from "../ui/reveal";
import { HintBar } from "../ui/HintBar";
import { disableHints, hintsVersion, loadSeen, markSeen, pickHint } from "../ui/hints";
import { StatusPopover } from "../ui/StatusPanel";
import { Dock } from "../ui/Dock";
import { FloorSwitcher, TopBar, ZoomControls, type SpeedOption } from "../ui/Hud";
import { Icon } from "../ui/Icon";
import { GameHub, MenuWindow, PendingWindow, ReportPopup, type MenuPage } from "../ui/hubs/GameHubs";
import { HUBS } from "../ui/Dock";
import { RealShopPanel } from "../ui/RealShopPanel";
import { BuildSheet } from "../screens/BuildSheet";
import { ShopSheet } from "../screens/ShopSheet";
import { mallId, mallInfo, online, run, setClock, state, user } from "../store";
import { locateShop, toStageModel } from "./adapter";
import type { AttentionItem, HubId } from "./model";
import { useStage } from "./useStage";
import "./stage.css";

const SPEEDS: SpeedOption[] = [
  { id: 0, glyph: "pause", title: "暫停" },
  { id: 1, glyph: "play", title: "繼續" },
];

/** #stage：真實資料版。進入前的登入／選商場沿用原本的畫面。 */
export function StageGame() {
  const s = state.value;
  if (!s) return <p class="empty" style={{ paddingTop: "40vh" }}>載入中…</p>;
  return <StageGameInner />;
}

function StageGameInner() {
  const s = state.value!;
  const u = user.value;
  const info = mallInfo.value;
  const model = useMemo(() => ({ ...toStageModel(s, u?.id), mallName: info?.name ?? "" }), [s, u?.id, info?.name]);

  const host = useRef<HTMLDivElement>(null);
  const [floorIdx, setFloorIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [hub, setHub] = useState<{ id: HubId; tab?: string } | null>(null);
  const [menuPage, setMenuPage] = useState<MenuPage | null>(null);
  const [pending, setPending] = useState<{ kind: "event" | "inspection"; uid: string } | null>(null);
  const [attnOpen, setAttnOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [buildSlot, setBuildSlot] = useState<number | null>(null);
  const [sheetShop, setSheetShop] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  void hintsVersion.value; // 提示狀態有變時重新計算

  // 每日結算彈出一次快訊：只在「進來之後」出現的新日報才彈，不會一進來就把舊的塞給玩家
  const lastReport = useRef(s.reports[s.reports.length - 1]?.date ?? null);
  useEffect(() => {
    const date = s.reports[s.reports.length - 1]?.date ?? null;
    if (date && date !== lastReport.current) setReportOpen(true);
    lastReport.current = date;
  }, [s.reports.length, s.reports[s.reports.length - 1]?.date]);

  const floor = model.floors[Math.min(floorIdx, model.floors.length - 1)]!;
  const lot = selected !== null ? floor.lots.find((l) => l.slot === selected) : undefined;
  const locked = floor.lockedLevel != null;
  // 空地（可開店）直接開招商畫面，不佔側邊面板
  const panelOpen = !!lot && (locked || !!lot.shop) && !hub && !menuPage && !pending;

  const closeOverlays = () => {
    setHub(null);
    setMenuPage(null);
    setPending(null);
    setAttnOpen(false);
    setMenuOpen(false);
    setStatusOpen(false);
    setReportOpen(false);
  };

  const openHub = (id: HubId, tab?: string) => {
    closeOverlays();
    setSelected(null);
    // 樞紐還沒開放 → 帶去「全部功能」，那裡會說明怎麼解鎖
    if (!hubVisible(s, id)) setMenuPage("all");
    else setHub({ id, tab });
  };

  const { sceneRef } = useStage(host, {
    floor,
    selected,
    panelOpen,
    minuteOfDay: model.minuteOfDay,
    weather: model.weather,
    cleaningLevel: model.cleaningLevel,
    openHour: model.openHour,
    closeHour: model.closeHour,
    onTap: (slot) => {
      closeOverlays();
      setSelected(slot);
      const l = slot === null ? undefined : floor.lots.find((x) => x.slot === slot);
      if (l && !l.shop && floor.lockedLevel == null) setBuildSlot(slot);
    },
  });

  const badges = useMemo(() => hubBadges(model.attention), [model.attention]);
  const visibleHubs = HUBS.filter((h) => hubVisible(s, h.id)).map((h) => h.id);
  const urgentCount = model.attention.filter((a) => a.severity === "urgent" || a.severity === "decision").length;

  const gotoShop = (shopId: string) => {
    const at = locateShop(model, shopId);
    if (!at) return;
    closeOverlays();
    setFloorIdx(at.floor);
    setSelected(at.slot);
  };

  const act = (it: AttentionItem) => {
    setAttnOpen(false);
    const t = it.target;
    switch (t.kind) {
      case "shop":
        return gotoShop(t.shopId);
      case "hub":
        return openHub(t.hub, t.tab);
      case "inspection":
        return setPending({ kind: "inspection", uid: t.uid });
      case "event":
        return setPending({ kind: "event", uid: t.uid });
      case "menu":
        return setMenuPage(t.page);
    }
  };

  const paused = isPaused(s.clock);

  // 情境提示：視窗、面板、彈出層都沒開的時候才出現，一次一則
  const anyOverlay = !!hub || !!menuPage || !!pending || attnOpen || statusOpen || reportOpen || panelOpen || buildSlot !== null || !!sheetShop || menuOpen || paused; // 暫停橫幅出現時，提示先不出現（避免兩個一起擠在畫面上）
  const hint = anyOverlay
    ? null
    : pickHint({
        s,
        attention: model.attention,
        hasEmptyLot: floor.lockedLevel == null && floor.lots.some((l) => !l.shop),
        seen: loadSeen(u?.id, mallId.value),
      });

  return (
    <div class="st-root">
      <div class="st-scene" ref={host} />

      <TopBar
        mallName={model.mallName}
        level={model.level}
        stars={model.stars}
        funds={model.funds}
        todayProfit={model.todayProfit}
        dateLabel={model.dateLabel}
        minuteOfDay={model.minuteOfDay}
        speeds={SPEEDS}
        speed={paused ? 0 : 1}
        onSpeed={(id) => void setClock({ paused: id === 0 }, id === 0 ? "時間已暫停" : "時間繼續")}
        menuOpen={menuOpen}
        onMenu={() => {
          setMenuOpen((v) => !v);
          setAttnOpen(false);
        }}
        attnOpen={attnOpen}
        onBell={() => {
          setAttnOpen((v) => !v);
          setMenuOpen(false);
          setSelected(null);
        }}
        urgentCount={urgentCount}
        onFunds={() => {
          const next = !statusOpen;
          closeOverlays();
          setStatusOpen(next);
        }}
        fundsOpen={statusOpen}
        weather={model.weather}
      />

      <div class="st-banners">
        {!online.value && <div class="banner">連線中斷，正在重新連線…（畫面可能不是最新）</div>}
        <ClockBanner />
      </div>

      <FloorSwitcher
        floors={model.floors.map((f) => ({
          id: f.id,
          label: f.label,
          name: f.lockedLevel != null ? `${f.name}（Lv.${f.lockedLevel} 解鎖）` : f.name,
          alert: f.lots.some((l) => l.shop && (l.shop.state === "closed" || l.shop.flags.includes("broken") || l.shop.flags.includes("stockout"))),
        }))}
        index={Math.min(floorIdx, model.floors.length - 1)}
        onPick={(i) => {
          setFloorIdx(i);
          setSelected(null);
          setBuildSlot(null);
        }}
      />

      <ZoomControls onIn={() => sceneRef.current?.zoomBy(1.25)} onOut={() => sceneRef.current?.zoomBy(0.8)} onFit={() => sceneRef.current?.fit()} />

      {floor.expand && (
        <button
          class="st-btn st-expand"
          disabled={!floor.expand.canBuy}
          title={floor.expand.reason ?? "再蓋一個店面"}
          onClick={() => void run({ type: "expandZone", zone: floor.zoneId! }, "擴建完成，多了一個店面")}
        >
          ＋ 擴建店面（{money(floor.expand.cost)}）
          <small>
            {floor.expand.n}／{floor.expand.max}
            {floor.expand.reason ? `・${floor.expand.reason}` : ""}
          </small>
        </button>
      )}

      <p class="st-note">畫面上的人潮是示意動畫，實際營收與客數以帳本為準。拖曳平移、滾輪／雙指縮放、點店面操作。</p>

      {menuOpen && (
        <div class="st-menu st-panel" role="menu">
          {(
            [
              ["target", "目標", "goals"],
              ["star", "成就", "achievements"],
              ["help", "說明與新手任務", "help"],
            ] as const
          ).map(([g, l, p]) => (
            <button
              key={p}
              role="menuitem"
              onClick={() => {
                closeOverlays();
                setMenuPage(p);
              }}
            >
              <Icon name={g} size={2} />
              {l}
            </button>
          ))}
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              closeOverlays();
              setMenuPage("settings");
            }}
          >
            <Icon name="gear" size={2} />
            設定
          </button>
          <button
            role="menuitem"
            onClick={() => {
              closeOverlays();
              setMenuPage("all");
            }}
          >
            <Icon name="list" size={2} />
            全部功能
          </button>
        </div>
      )}

      {statusOpen && (
        <StatusPopover
          onClose={() => setStatusOpen(false)}
          onMore={() => openHub("finance", "cash")}
          weather={model.weather}
          tomorrow={model.tomorrow}
        />
      )}

      {attnOpen && <AttentionCenter items={model.attention} onClose={() => setAttnOpen(false)} onAct={act} />}

      {panelOpen && selected !== null && (
        <RealShopPanel
          key={selected}
          slot={selected}
          floor={floor}
          onClose={() => setSelected(null)}
          openHub={openHub}
          openSheet={setSheetShop}
        />
      )}

      {hub && <GameHub key={`${hub.id}:${hub.tab ?? ""}`} hub={hub.id} tab={hub.tab} badges={tabBadges(model.attention, hub.id)} onClose={() => setHub(null)} />}
      {menuPage && <MenuWindow page={menuPage} onClose={() => setMenuPage(null)} onOpenHub={(id, tab) => openHub(id, tab)} />}
      {reportOpen && (
        <ReportPopup
          onClose={() => setReportOpen(false)}
          onOpenReports={() => {
            setReportOpen(false);
            openHub("finance", "reports");
          }}
        />
      )}
      {pending && <PendingWindow kind={pending.kind} uid={pending.uid} onClose={() => setPending(null)} />}

      {hint && <HintBar hint={hint} onDismiss={() => markSeen(u?.id, mallId.value, hint.id)} onDisableAll={() => disableHints(u?.id, mallId.value)} />}

      <Dock
        active={hub?.id ?? null}
        badges={badges}
        visible={visibleHubs}
        onPick={(id) => {
          const same = hub?.id === id;
          closeOverlays();
          setSelected(null);
          if (!same) openHub(id);
        }}
      />

      {buildSlot !== null && (
        <BuildSheet
          slotId={buildSlot}
          onClose={() => {
            setBuildSlot(null);
            setSelected((cur) => (cur === buildSlot ? null : cur));
          }}
        />
      )}
      {sheetShop && <ShopSheet shopId={sheetShop} onClose={() => setSheetShop(null)} />}
    </div>
  );
}
