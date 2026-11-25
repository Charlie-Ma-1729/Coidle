import { moneyShort } from "../format";
import type { GlyphKey } from "../stage/glyphs";
import { Icon } from "./Icon";
import { weatherGlyph, weatherLabel } from "./weatherUi";
import type { Weather } from "@coidle/shared";

export interface SpeedOption {
  id: number;
  glyph: GlyphKey;
  title: string;
}

export function hhmm(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = Math.floor((minuteOfDay % 60) / 5) * 5;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 頂部 HUD：選單、商場名與等級、資金、今日損益、日期時間、時間流速、待辦中心 */
export function TopBar(props: {
  mallName: string;
  level: number;
  stars: number;
  funds: number;
  todayProfit: number;
  dateLabel: string;
  minuteOfDay: number;
  speeds: SpeedOption[];
  speed: number;
  onSpeed: (id: number) => void;
  /** 目前流速檔位的名稱（標準／悠閒…）；有給就在暫停鈕旁多一顆「換檔」按鈕，點一下換下一檔 */
  speedName?: string;
  onCycleSpeed?: () => void;
  menuOpen: boolean;
  onMenu: () => void;
  attnOpen: boolean;
  onBell: () => void;
  urgentCount: number;
  /** 點資金展開狀態面板（選填） */
  onFunds?: () => void;
  fundsOpen?: boolean;
  /** 此刻的天氣；點了展開狀態面板（含預報） */
  weather?: Weather;
  /** Overseer 才有：返回管理室（任何畫面都看得到，不會被面板蓋住） */
  onBack?: () => void;
}) {
  const pos = props.todayProfit >= 0;
  return (
    <header class="st-top">
      {props.onBack && (
        <button class="st-btn pri" aria-label="返回管理室" onClick={props.onBack}>
          ←<span class="hide-m"> 管理室</span>
        </button>
      )}
      <button class={`st-btn sq ${props.menuOpen ? "on" : ""}`} aria-label="商場選單" onClick={props.onMenu}>
        ☰
      </button>
      <div class="st-title st-panel" style={{ padding: "4px 12px" }}>
        <b>{props.mallName}</b>
        <span>
          Lv.{props.level}・{"★".repeat(props.stars)}
          {"☆".repeat(Math.max(0, 5 - props.stars))}
        </span>
      </div>
      <span class="st-spacer" />
      {props.onFunds ? (
        <button class={`st-stat st-panel st-stat-btn ${props.fundsOpen ? "on" : ""}`} onClick={props.onFunds} aria-label="商場狀態" aria-expanded={!!props.fundsOpen}>
          <small>資金</small>
          <b>{moneyShort(props.funds)}</b>
        </button>
      ) : (
        <div class="st-stat st-panel">
          <small>資金</small>
          <b>{moneyShort(props.funds)}</b>
        </div>
      )}
      <div class="st-stat st-panel hide-m">
        <small>今日損益</small>
        <b class={pos ? "pos" : "neg"}>
          {pos ? "+" : ""}
          {moneyShort(props.todayProfit)}
        </b>
      </div>
      {props.weather && (
        <button class="st-stat st-panel st-stat-btn st-weather" onClick={props.onFunds} title={weatherLabel(props.weather)} aria-label={`天氣：${weatherLabel(props.weather)}`}>
          <Icon name={weatherGlyph(props.weather)} size={2} />
          <b>{props.weather.temp}°</b>
        </button>
      )}
      <div class="st-stat st-clock st-panel">
        <small>{props.dateLabel}</small>
        <b>{hhmm(props.minuteOfDay)}</b>
      </div>
      <div class="st-seg" role="group" aria-label="時間流速">
        {props.speeds.map((s) => (
          <button key={s.id} class={`st-btn ${props.speed === s.id ? "on" : ""}`} title={s.title} aria-label={s.title} aria-pressed={props.speed === s.id} onClick={() => props.onSpeed(s.id)}>
            <Icon name={s.glyph} size={2} />
          </button>
        ))}
        {props.onCycleSpeed && (
          <button class="st-btn st-speed" title="換時間流速（極速→快速→輕快→標準→悠閒→現實）" aria-label={`時間流速：${props.speedName ?? ""}，點一下換下一檔`} onClick={props.onCycleSpeed}>
            {props.speedName}
          </button>
        )}
      </div>
      <button class={`st-btn sq st-bell ${props.attnOpen ? "on" : ""}`} aria-label={`待辦中心（${props.urgentCount}）`} onClick={props.onBell}>
        <Icon name="bell" size={2} />
        {props.urgentCount > 0 && <span class="st-badge">{props.urgentCount}</span>}
      </button>
    </header>
  );
}

/** 左側樓層切換：有緊急事項的樓層亮紅點 */
export function FloorSwitcher(props: { floors: { id: string; label: string; name: string; alert: boolean }[]; index: number; onPick: (i: number) => void }) {
  return (
    <nav class="st-floors" aria-label="樓層">
      {props.floors.map((f, i) => (
        <button key={f.id} class={`st-btn ${i === props.index ? "on" : ""}`} title={f.name} aria-label={`${f.label} ${f.name}`} onClick={() => props.onPick(i)}>
          {f.label}
          {f.alert && <span class="st-dot" />}
        </button>
      ))}
    </nav>
  );
}

export function ZoomControls(props: { onIn: () => void; onOut: () => void; onFit: () => void }) {
  return (
    <div class="st-zoom">
      <button class="st-btn" aria-label="放大" onClick={props.onIn}>
        ＋
      </button>
      <button class="st-btn" aria-label="縮小" onClick={props.onOut}>
        －
      </button>
      <button class="st-btn" aria-label="回到全景" onClick={props.onFit}>
        ⌂
      </button>
    </div>
  );
}
