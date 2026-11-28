import { EQUITY_TEXT, MARKET_TEXT, ymdOfDay, type PersonalEquityView, type WealthPoint, type WealthView } from "@coidle/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { moneyShort } from "../../format";

type Tab = "overview" | "stakes" | "market" | "ledger";

/** 總覽：總資產、三塊占比、需要我處理的事、開新商場的成本 */
/** 資產走勢：每個遊戲日一筆快照的總資產折線 */
function Trend(props: { points: WealthPoint[] }) {
  const pts = props.points;
  if (pts.length < 2) return <p class="st-hint">資產走勢要累積至少兩個遊戲日的紀錄（每個遊戲日 16:00 記一筆），明天再來看。</p>;
  const W = 600;
  const H = 120;
  const lo = Math.min(...pts.map((p) => p.total));
  const hi = Math.max(...pts.map((p) => p.total));
  const span = hi - lo || 1;
  const x = (i: number) => 8 + (i / (pts.length - 1)) * (W - 16);
  const y = (v: number) => 12 + (1 - (v - lo) / span) * (H - 28);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const label = (day: number) => {
    const c = ymdOfDay(day);
    return `${c.m}/${c.d}`;
  };
  const up = pts[pts.length - 1]!.total >= pts[0]!.total;
  const color = up ? "var(--green)" : "var(--red)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="st-chart" role="img" aria-label={`總資產走勢，最高 ${hi.toLocaleString()}，最低 ${lo.toLocaleString()}`}>
      <polygon points={`8,${H - 16} ${line} ${x(pts.length - 1)},${H - 16}`} style={{ fill: color }} opacity="0.12" />
      <polyline points={line} fill="none" style={{ stroke: color }} stroke-width="2" stroke-linejoin="round" />
      <text x="8" y="10" class="st-chart-t">
        高 {moneyShort(hi)}
      </text>
      <text x="8" y={H - 3} class="st-chart-t">
        {label(pts[0]!.day)}（遊戲日）
      </text>
      <text x={W - 8} y={H - 3} text-anchor="end" class="st-chart-t">
        {label(pts[pts.length - 1]!.day)}
      </text>
    </svg>
  );
}

export function Overview(props: { wealth: WealthView | null; equity: PersonalEquityView | null; meId: number; onTab: (t: Tab) => void }) {
  const { wealth: w, equity: eq, meId } = props;
  const [trend, setTrend] = useState<WealthPoint[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .wealthHistory()
      .then((r) => alive && setTrend(r.points))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [w?.totalValue]);
  if (!w) return <p class="st-hint">讀取中…</p>;
  const stakes = w.stakes.reduce((a, s) => a + s.value, 0);
  const parts = [
    { id: "cash", label: "個人錢包", value: w.cash, tone: "" },
    { id: "stakes", label: "商場持股（估值）", value: stakes, tone: "amber" },
    { id: "stock", label: "股票市值", value: w.portfolio, tone: "red" },
    ...(w.corporate > 0 ? [{ id: "corp", label: "法人投資（商場持有的股票）", value: w.corporate, tone: "amber" }] : []),
  ];
  const total = Math.max(1, parts.reduce((a, p) => a + p.value, 0));
  const incoming = eq?.offers.filter((o) => o.toId === meId).length ?? 0;
  const toDecide = eq?.requests.filter((r) => r.userId !== meId).length ?? 0;
  return (
    <>
      <div class="st-kpis four">
        <div class="st-kpi">
          <small>總資產</small>
          <b>{moneyShort(w.totalValue)}</b>
        </div>
        <div class="st-kpi">
          <small>個人錢包</small>
          <b>{moneyShort(w.cash)}</b>
        </div>
        <div class="st-kpi">
          <small>商場持股</small>
          <b>{moneyShort(stakes)}</b>
        </div>
        <div class="st-kpi">
          <small>股票市值</small>
          <b>{moneyShort(w.portfolio)}</b>
        </div>
      </div>

      <div class="st-sec">
        <h4>資產組成</h4>
        {parts.map((p) => (
          <div key={p.id} class="st-bar">
            <span>{p.label}</span>
            <div class="st-meter" aria-hidden="true">
              <i class={p.tone} style={{ width: `${Math.round((p.value / total) * 100)}%` }} />
            </div>
            <b>{moneyShort(p.value)}</b>
          </div>
        ))}
        <p class="st-hint">商場持股只算商場帳上現金乘以持股比例，店面與設備還不計價；股票用現在的股價算。</p>
      </div>

      <div class="st-sec">
        <h4>資產走勢</h4>
        {trend ? <Trend points={trend} /> : <p class="st-hint">讀取中…</p>}
      </div>

      <div class="st-sec">
        <h4>需要你處理</h4>
        {incoming + toDecide === 0 ? (
          <p class="st-hint">目前沒有待處理的出價或注資申請。</p>
        ) : (
          <div class="st-list">
            {incoming > 0 && (
              <div class="st-li">
                <span class="grow">
                  <b>{incoming}</b> 份別人想賣你的股份
                </span>
                <button class="st-btn" onClick={() => props.onTab("stakes")}>
                  去處理
                </button>
              </div>
            )}
            {toDecide > 0 && (
              <div class="st-li">
                <span class="grow">
                  <b>{toDecide}</b> 份注資申請等你核准
                </span>
                <button class="st-btn" onClick={() => props.onTab("stakes")}>
                  去處理
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div class="st-sec">
        <h4>錢包可以做什麼</h4>
        <div class="st-list">
          <div class="st-li">
            <span class="grow">
              注資換股、開新商場
              <small>{w.foundCost === 0 ? "你還有一次免費的起始資金（開新商場或加入商場時投入）。" : `再開一座新商場要自己出資 ${moneyShort(w.foundCost)}（從個人錢包）；起始資金每位玩家只有一次。`}</small>
            </span>
          </div>
          <div class="st-li">
            <span class="grow">
              買賣股票
              <small>{MARKET_TEXT.what}</small>
            </span>
            <button class="st-btn" onClick={() => props.onTab("market")}>
              去股市
            </button>
          </div>
        </div>
        <p class="st-hint">{EQUITY_TEXT.market}</p>
      </div>
    </>
  );
}
