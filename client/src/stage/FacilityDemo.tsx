import { useEffect, useState } from "preact/hooks";
import { CINEMA_SHOWS_PER_DAY, FACILITY_BY_KIND, cinemaBaseViewers, venueDailyVisitors } from "@coidle/shared";
import { FacilityMapView } from "./FacilityMapView";
import { VENUE_KINDS, type FacilitySpec } from "./facilityspec";

/**
 * 開發用：`#facility-demo/<kind>`（parking、cinema、bowling、hotel、capsule_hotel、conference、event_space）。
 * 假資料、不連伺服器；可以拉時間、調單位數與商場等級，看設施地圖的人車動畫。
 */
export function FacilityDemo() {
  const kind = (location.hash.split("/")[1] || "parking") as string;
  const def = FACILITY_BY_KIND[kind];
  const [minute, setMinute] = useState(15 * 60);
  const [units, setUnits] = useState(def ? Math.min(def.units.length, def.perFloor, 4) : 1);
  const [level, setLevel] = useState(5);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(6);
  const [weekend, setWeekend] = useState(false);

  // 時間流動：遊戲時間＝真實時間 × speed（預設 6，和正式遊戲一樣）
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setMinute((m) => (m + (speed / 60) * 0.5) % 1440), 500);
    return () => clearInterval(t);
  }, [playing, speed]);

  if (!def) return <p style={{ padding: 20 }}>沒有這種設施：{kind}</p>;
  const n = Math.max(1, Math.min(units, def.units.length));
  let spec: FacilitySpec;
  if (kind === "parking") spec = { kind: "parking", spaces: def.units[Math.min(n, def.units.length) - 1]!.amount, built: true };
  else if (kind === "cinema") {
    const rooms = Array.from({ length: Math.min(4, n) }, (_, i) => ({ seats: def.units[i]!.amount, built: true }));
    spec = { kind: "cinema", rooms, showBase: cinemaBaseViewers(n, level) / (n * CINEMA_SHOWS_PER_DAY) };
  } else {
    const us = Array.from({ length: n }, (_, i) => ({ amount: def.units[i]!.amount, built: true }));
    spec = { kind: kind as (typeof VENUE_KINDS)[number], units: us, daily: venueDailyVisitors(kind, n, level) };
  }
  const label = (s: string) => <span style={{ marginRight: 6 }}>{s}</span>;
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "auto 1fr", background: "#0a0e1d", color: "#e9edff" }}>
      <div style={{ padding: 8, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <b>{def.name}</b>
        <span>
          {label("時間")}
          <input type="range" min={0} max={1439} value={Math.floor(minute)} onInput={(e) => setMinute(Number((e.target as HTMLInputElement).value))} />
          {String(Math.floor(minute / 60)).padStart(2, "0")}:{String(Math.floor(minute % 60)).padStart(2, "0")}
        </span>
        <span>
          {label(def.unit + "數")}
          <input type="range" min={1} max={def.units.length} value={n} onInput={(e) => setUnits(Number((e.target as HTMLInputElement).value))} /> {n}
        </span>
        <span>
          {label("商場等級")}
          <input type="range" min={1} max={8} value={level} onInput={(e) => setLevel(Number((e.target as HTMLInputElement).value))} /> {level}
        </span>
        <button onClick={() => setPlaying(!playing)}>{playing ? "暫停" : "播放"}</button>
        <span>
          {label("速度")}
          <select value={speed} onChange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
            {[1, 6, 18, 60].map((v) => (
              <option value={v}>{v}×</option>
            ))}
          </select>
        </span>
        <label>
          <input type="checkbox" checked={weekend} onChange={(e) => setWeekend((e.target as HTMLInputElement).checked)} /> 假日
        </label>
      </div>
      <FacilityMapView spec={spec} minute={minute} open={10} close={22} weekend={weekend} flow={playing ? 1 : 0} />
    </div>
  );
}
