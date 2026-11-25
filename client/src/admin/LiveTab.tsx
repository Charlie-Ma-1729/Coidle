import { useEffect, useState } from "preact/hooks";
import { adminApi, type DailyRow, type Sample } from "./adminApi";
import { LineChart } from "./LineChart";
import { Card, Empty, Ico, Seg, Stat } from "./kit";
import { errMsg, toast } from "../store";

const RANGES = [
  { id: "3h", label: "3 小時", ms: 3 * 3_600_000 },
  { id: "24h", label: "24 小時", ms: 24 * 3_600_000 },
  { id: "7d", label: "7 天", ms: 7 * 86_400_000 },
  { id: "30d", label: "30 天", ms: 30 * 86_400_000 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const fmtUp = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} 天 ${Math.floor((s % 86400) / 3600)} 小時` : s >= 3600 ? `${Math.floor(s / 3600)} 小時 ${Math.floor((s % 3600) / 60)} 分` : `${Math.floor(s / 60)} 分`);

/** 即時數據與歷史圖表、每日報表，可匯出 CSV／JSON */
export function LiveTab() {
  const [range, setRange] = useState<RangeId>("24h");
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
  const col = (k: keyof Sample) => samples.map((s) => s[k]) as number[];
  const from = Date.now() - RANGES.find((r) => r.id === range)!.ms;

  return (
    <>
      {now && (
        <div class="ad-stats">
          <Stat tone="green" label="現在線上玩家" value={now.online_users} hint={`${now.online_malls} 座商場有人在場`} />
          <Stat tone="cyan" label="24 小時內活躍" value={now.active_24h} hint={`7 天 ${now.active_7d} 人`} />
          <Stat tone="pink" label="玩家／商場總數" value={`${now.users_total}／${now.malls_total}`} hint="不含 Overseer 與測試商場" />
          <Stat tone="amber" label="伺服器已運行" value={fmtUp(now.uptime_s)} hint={`記憶體 ${now.rss_mb} MB`} />
        </div>
      )}

      <div class="ad-row">
        <Seg value={range} options={RANGES.map((r) => [r.id, r.label] as [RangeId, string])} onChange={setRange} />
        <span class="ad-spacer" />
        <a class="ad-btn sm" href={adminApi.exportUrl("samples", "csv", from)} download>
          <Ico n="download" />
          樣本 CSV
        </a>
        <a class="ad-btn sm" href={adminApi.exportUrl("samples", "json", from)} download>
          <Ico n="download" />
          樣本 JSON
        </a>
        <a class="ad-btn sm" href={adminApi.exportUrl("daily", "csv")} download>
          <Ico n="download" />
          每日 CSV
        </a>
      </div>

      <div class="ad-grid c2">
        <Card>
          <LineChart title="玩家" xs={xs} series={[{ name: "線上", color: "#52e0a4", values: col("online_users") }, { name: "24 小時活躍", color: "#4fe3ff", values: col("active_24h") }]} unit=" 人" />
        </Card>
        <Card>
          <LineChart title="每分鐘流量" xs={xs} series={[{ name: "請求", color: "#4fe3ff", values: col("requests") }, { name: "指令", color: "#ffc857", values: col("commands") }, { name: "錯誤", color: "#ff6b6b", values: col("errors") }]} />
        </Card>
        <Card>
          <LineChart title="伺服器" xs={xs} series={[{ name: "tick 耗時", color: "#b48cff", values: col("tick_ms") }, { name: "事件迴圈延遲", color: "#ffc857", values: col("loop_lag_ms") }]} unit=" ms" />
        </Card>
        <Card>
          <LineChart title="記憶體" xs={xs} series={[{ name: "RSS", color: "#4fe3ff", values: col("rss_mb") }, { name: "Heap", color: "#52e0a4", values: col("heap_mb") }]} unit=" MB" />
        </Card>
      </div>

      <Card title="每日統計" desc="日界線是台灣時間 00:00；永久保存。">
        {daily.length === 0 ? (
          <Empty>還沒有資料，伺服器每分鐘取一筆樣本。</Empty>
        ) : (
          <div class="ad-scroll">
            <table class="ad-table num">
              <thead>
                <tr>
                  <th>日期</th>
                  <th class="r">活躍玩家</th>
                  <th class="r">新註冊</th>
                  <th class="r">尖峰線上</th>
                  <th class="r">請求</th>
                  <th class="r">指令</th>
                  <th class="r">錯誤</th>
                  <th class="r">NPC 出手</th>
                  <th class="r">最慢 tick</th>
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td class="r">{d.dau}</td>
                    <td class="r">{d.new_users}</td>
                    <td class="r">{d.peak_online}</td>
                    <td class="r">{d.requests.toLocaleString()}</td>
                    <td class="r">{d.commands.toLocaleString()}</td>
                    <td class={`r ${d.errors > 0 ? "neg" : ""}`}>{d.errors}</td>
                    <td class="r">{d.npc_actions}</td>
                    <td class="r">{d.max_tick_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
