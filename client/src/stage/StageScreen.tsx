import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Weather } from "@coidle/shared";
import { hubBadges } from "../ui/attention";
import { AttentionCenter } from "../ui/AttentionCenter";
import { Dock } from "../ui/Dock";
import { Icon } from "../ui/Icon";
import { FloorSwitcher, TopBar, ZoomControls, type SpeedOption } from "../ui/Hud";
import { HubWindow } from "../ui/hubs/Hubs";
import { ShopPanel } from "../ui/ShopPanel";
import { buildDemoModel } from "./fixtures";
import type { AttentionItem, HubId, StageModel } from "./model";
import { useStage } from "./useStage";
import "./stage.css";

const SPEEDS: (SpeedOption & { step: number })[] = [
  { id: 0, glyph: "pause", title: "暫停", step: 0 },
  { id: 1, glyph: "play", title: "標準", step: 1 },
  { id: 2, glyph: "fast", title: "快轉（示範用）", step: 6 },
];

export function StageScreen(props: { model: StageModel }) {
  const { model } = props;
  const host = useRef<HTMLDivElement>(null);
  const [floorIdx, setFloorIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [hub, setHub] = useState<HubId | null>(null);
  const [attnOpen, setAttnOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [minute, setMinute] = useState(model.minuteOfDay);
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [weather, setWeather] = useState<Weather>(model.weather);

  const floor = model.floors[floorIdx]!;
  const shop = useMemo(() => floor.lots.find((l) => l.slot === selected)?.shop ?? null, [floor, selected]);
  const hasLot = selected !== null && floor.lots.some((l) => l.slot === selected);

  const { sceneRef } = useStage(host, {
    floor,
    selected,
    panelOpen: hasLot,
    minuteOfDay: minute,
    weather,
    cleaningLevel: model.cleaningLevel,
    openHour: model.openHour,
    closeHour: model.closeHour,
    onTap: (slot) => {
      setSelected(slot);
      setHub(null);
      setAttnOpen(false);
      setMenuOpen(false);
    },
  });

  const toastTimer = useRef(0);
  const say = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };

  // 遊戲時鐘（示範）
  useEffect(() => {
    const step = SPEEDS.find((s) => s.id === speed)!.step;
    if (step === 0) return;
    const t = window.setInterval(() => setMinute((m) => (m + step) % 1440), 1000);
    return () => window.clearInterval(t);
  }, [speed]);

  const badges = useMemo(() => hubBadges(model.attention), [model.attention]);
  const urgentCount = model.attention.filter((a) => a.severity === "urgent" || a.severity === "decision").length;

  const gotoShop = (shopId: string) => {
    for (let i = 0; i < model.floors.length; i++) {
      const lot = model.floors[i]!.lots.find((l) => l.shop?.id === shopId);
      if (lot) {
        setFloorIdx(i);
        setSelected(lot.slot);
        setHub(null);
        return;
      }
    }
  };

  const act = (it: AttentionItem) => {
    setAttnOpen(false);
    const t = it.target;
    switch (t.kind) {
      case "shop":
        return gotoShop(t.shopId);
      case "hub":
        return setHub(t.hub);
      case "inspection":
        return setHub("operate");
      case "menu":
        return say(`（示範）開啟「${t.page === "goals" ? "目標" : t.page === "help" ? "說明與新手任務" : "成就"}」`);
      case "event":
        return say(`（示範）事件「${it.title}」會用既有的事件選項卡處理`);
    }
  };

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
        dateBadge={model.dateBadge}
        minuteOfDay={minute}
        speeds={SPEEDS}
        speed={speed}
        onSpeed={setSpeed}
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
        weather={weather}
      />

      <FloorSwitcher
        floors={model.floors.map((f) => ({ id: f.id, label: f.label, name: f.name, alert: f.lots.some((l) => l.shop && (l.shop.flags.includes("broken") || l.shop.flags.includes("stockout"))) }))}
        index={floorIdx}
        onPick={(i) => {
          setFloorIdx(i);
          setSelected(null);
        }}
      />

      <ZoomControls onIn={() => sceneRef.current?.zoomBy(1.25)} onOut={() => sceneRef.current?.zoomBy(0.8)} onFit={() => sceneRef.current?.fit()} />

      <p class="st-note">畫面上的人潮是示意動畫，實際營收與客數以帳本為準。拖曳平移、滾輪／雙指縮放、點店面操作。</p>
      <div class="st-demo-weather st-panel" role="group" aria-label="示範：切換天氣">
        <small>天氣</small>
        {(
          [
            ["晴", { kind: "clear", temp: 24 }],
            ["陰", { kind: "cloudy", temp: 18 }],
            ["雨", { kind: "rain", temp: 19 }],
            ["颱風", { kind: "storm", temp: 24 }],
            ["酷暑", { kind: "clear", temp: 36 }],
            ["寒流", { kind: "cloudy", temp: 2 }],
          ] as [string, Weather][]
        ).map(([label, w]) => (
          <button key={label} class={`st-btn ${weather.kind === w.kind && weather.temp === w.temp ? "on" : ""}`} onClick={() => setWeather(w)}>
            {label}
          </button>
        ))}
      </div>
      <p class="st-demo-tag">Phase 0 示範・假資料</p>

      {menuOpen && (
        <div class="st-menu st-panel" role="menu">
          {(
            [
              ["target", "目標"],
              ["star", "成就"],
              ["quest", "新手任務　3／10"],
              ["help", "說明"],
            ] as const
          ).map(([g, l]) => (
            <button key={l} role="menuitem" onClick={() => { setMenuOpen(false); say(`（示範）開啟「${l}」`); }}>
              <Icon name={g} size={2} />
              {l}
            </button>
          ))}
          <hr />
          <button role="menuitem" onClick={() => { setMenuOpen(false); say("（示範）設定：時間自動暫停、推播裝置、帳號"); }}>
            <Icon name="gear" size={2} />設定
          </button>
          <button role="menuitem" onClick={() => { setMenuOpen(false); say("（示範）全部功能索引：把沒顯示的功能也列出來"); }}>
            <Icon name="list" size={2} />全部功能
          </button>
        </div>
      )}

      {attnOpen && <AttentionCenter items={model.attention} onClose={() => setAttnOpen(false)} onAct={act} />}

      {hasLot && !hub && (
        <ShopPanel
          shop={shop}
          floorName={`${floor.label} ${floor.name}`}
          onClose={() => setSelected(null)}
          act={say}
          openHub={(h) => setHub(h)}
        />
      )}

      {hub && <HubWindow hub={hub} model={{ ...model, minuteOfDay: minute }} onClose={() => setHub(null)} act={say} />}

      <Dock
        active={hub}
        badges={badges}
        onPick={(id) => {
          setHub(hub === id ? null : id);
          setAttnOpen(false);
          setMenuOpen(false);
        }}
      />

      {toast && <div class="st-toast st-panel">{toast}</div>}
    </div>
  );
}

/** #stage-demo 入口：用假資料，不需要伺服器 */
export function StageDemo() {
  const model = useMemo(() => buildDemoModel(), []);
  return <StageScreen model={model} />;
}
