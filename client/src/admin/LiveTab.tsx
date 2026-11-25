import { useEffect, useState } from "preact/hooks";
import { adminApi, type DailyRow, type Sample } from "./adminApi";
import { LineChart } from "./LineChart";
import { errMsg, toast } from "../store";

const RANGES = [
  { id: "3h", label: "3 小時", ms: 3 * 3_600_000 },
  { id: "24h", label: "24 小時", ms: 24 * 3_600_000 },
  { id: "7d", label: "7 天", ms: 7 * 86_400_000 },
  { id: "30d", label: "30 天", ms: 30 * 86_400_000 },
] as const;

const fmtUp = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} 天 ${Math.floor((s % 86400) / 3600)} 小時` : s >= 3600 ? `${Math.floor(s / 3600)} 小時 ${Math.floor((s % 3600) / 60)} 分` : `${Math.floor(s / 60)} 分`);

function Stat(props: { label: string; value: string | number; hint?: string }) {
  return (
    <div class="card" style={{ padding: "10px 12px", minWidth: "130px" }}>
      <div class="small dim">{props.label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{props.value}</div>
      {props.hint && <div class="small dim">{props.hint}</div>}
    </div>
  );
}

/** 即時數據與歷史圖表、每日報表，可匯出 CSV／JSON */
export function LiveTab() {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("24h");
  const [now, setNow] = useState<Sample | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);

  const load = async () => {
    try {
      const ms = RANGES.find((r) => r.id === range)!.ms;
      const t = Date.now();
      const [live, hist, d] = await Promise.all([adminApi.live(), adminApi.metrics(t - ms, t + 1), adminApi.daily(30)]);
      setNow(live.now);
      setSamples(hist.samples);
      setDaily(d.days);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [range]);

  const xs = samples.map((s) => s.ts);
  const col = (k: keyof Sample) => samples.map((s) => s[k]);
  const ms = RANGES.find((r) => r.id === range)!.ms;
  const from = Date.now() - ms;

  return (
    <div class="stack">
      {now && (
        <div class="row" style={{ flexWrap: "wrap", gap: "10px" }}>
          <Stat label="現在線上玩家" value={now.online_users} hint={`${now.online_malls} 座商場有人在場`} />
          <Stat label="24 小時內活躍" value={now.active_24h} hint={`7 天 ${now.active_7d} 人`} />
          <Stat label="玩家／商場總數" value={`${now.users_total}／${now.malls_total}`} hint="不含 Overseer 與測試商場" />
          <Stat label="伺服器已運行" value={fmtUp(now.uptime_s)} hint={`記憶體 ${now.rss_mb} MB`} />
        </div>
      )}

      <div class="row" style={{ flexWrap: "wrap" }}>
        {RANGES.map((r) => (
          <button key={r.id} class={`btn btn-sm ${range === r.id ? "btn-primary" : "btn-ghost"}`} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
        <span class="spacer" />
        <a class="btn btn-ghost btn-sm" href={adminApi.exportUrl("samples", "csv", from)} download>
          匯出樣本 CSV
        </a>
        <a class="btn btn-ghost btn-sm" href={adminApi.exportUrl("samples", "json", from)} download>
          JSON
        </a>
        <a class="btn btn-ghost btn-sm" href={adminApi.exportUrl("daily", "csv")} download>
          匯出每日 CSV
        </a>
      </div>

      <div class="card">
        <LineChart title="玩家" xs={xs} series={[{ name: "線上", color: "#2fb67c", values: col("online_users") as number[] }, { name: "24 小時活躍", color: "#4c8dff", values: col("active_24h") as number[] }]} unit=" 人" />
      </div>
      <div class="card">
        <LineChart title="每分鐘流量" xs={xs} series={[{ name: "請求", color: "#4c8dff", values: col("requests") as number[] }, { name: "指令", color: "#e0a030", values: col("commands") as number[] }, { name: "錯誤", color: "#e0525e", values: col("errors") as number[] }]} />
      </div>
      <div class="card">
        <LineChart title="伺服器" xs={xs} series={[{ name: "tick 耗時", color: "#a06be0", values: col("tick_ms") as number[] }, { name: "事件迴圈延遲", color: "#e0a030", values: col("loop_lag_ms") as number[] }]} unit=" ms" />
      </div>
      <div class="card">
        <LineChart title="記憶體" xs={xs} series={[{ name: "RSS", color: "#4c8dff", values: col("rss_mb") as number[] }, { name: "Heap", color: "#2fb67c", values: col("heap_mb") as number[] }]} unit=" MB" />
      </div>

      <div class="card">
        <h3>每日統計（日界線：台灣時間 00:00）</h3>
        {daily.length === 0 ? (
          <p class="small dim">還沒有資料，伺服器每分鐘取一筆樣本。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table class="small" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  {["日期", "活躍玩家", "新註冊", "尖峰線上", "請求", "指令", "錯誤", "NPC 出手", "最慢 tick"].map((h) => (
                    <th key={h} style={{ padding: "4px 8px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map((d) => (
                  <tr key={d.day}>
                    <td style={{ padding: "3px 8px" }}>{d.day}</td>
                    <td style={{ padding: "3px 8px" }}>{d.dau}</td>
                    <td style={{ padding: "3px 8px" }}>{d.new_users}</td>
                    <td style={{ padding: "3px 8px" }}>{d.peak_online}</td>
                    <td style={{ padding: "3px 8px" }}>{d.requests}</td>
                    <td style={{ padding: "3px 8px" }}>{d.commands}</td>
                    <td style={{ padding: "3px 8px" }}>{d.errors}</td>
                    <td style={{ padding: "3px 8px" }}>{d.npc_actions}</td>
                    <td style={{ padding: "3px 8px" }}>{d.max_tick_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
