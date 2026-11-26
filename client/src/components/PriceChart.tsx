import type { MarketHistory } from "@coidle/shared";
import { moneyShort } from "../format";

const W = 600;
const H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 22 };

const p2 = (n: number) => String(n).padStart(2, "0");
/** 圖上的時間標籤：盤中用「時:分」（跨日加日期）、日 K 用「月/日」 */
const stamp = (ms: number, kind: "intraday" | "daily", withDate: boolean) => {
  const d = new Date(ms);
  if (kind === "daily") return `${d.getMonth() + 1}/${d.getDate()}`;
  const t = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return withDate ? `${d.getMonth() + 1}/${d.getDate()} ${t}` : t;
};

/** 迷你走勢：只有一條線，漲（紅綠依首尾）用在股價表 */
export function Spark(props: { values: number[]; width?: number; height?: number }) {
  const { values, width = 84, height = 26 } = props;
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - lo) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={up ? "走勢向上" : "走勢向下"} class="st-spark">
      <polyline points={pts} fill="none" style={{ stroke: up ? "var(--green)" : "var(--red)" }} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}

/**
 * 一檔股票的走勢圖：折線（盤中）或 K 線（日線，mode="candle"），區間高低點、前日收盤的虛線，
 * 以及「消息」的標記（滑過會顯示內容）。
 */
export function PriceChart(props: { history: MarketHistory; mode?: "line" | "candle" }) {
  const { points, events, kind, prevClose } = props.history;
  if (points.length < 2) return <p class="st-hint">資料還不夠，等開盤走幾步再來看。</p>;
  const candle = props.mode === "candle" && kind === "daily" && points.every((p) => p.open !== undefined) && points.length <= 160;
  const lows = points.map((p) => (candle ? p.low! : p.price));
  const highs = points.map((p) => (candle ? p.high! : p.price));
  let lo = Math.min(...lows);
  let hi = Math.max(...highs);
  if (kind === "intraday" && prevClose) {
    lo = Math.min(lo, prevClose);
    hi = Math.max(hi, prevClose);
  }
  const span = hi - lo || 1;
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const last = points[points.length - 1]!.price;
  const ref = kind === "intraday" && prevClose ? prevClose : points[0]!.price;
  const up = last >= ref;
  const color = up ? "var(--green)" : "var(--red)";
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${PAD.l},${H - PAD.b} ${line} ${x(points.length - 1).toFixed(1)},${H - PAD.b}`;
  const idxOf = (at: number) => points.findIndex((p) => p.at >= at);
  const multiDay = new Date(points[0]!.at).toDateString() !== new Date(points[points.length - 1]!.at).toDateString();
  const bw = Math.max(1.5, Math.min(9, ((W - PAD.l - PAD.r) / points.length) * 0.65));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="st-chart" role="img" aria-label={`${props.history.name} 的價格走勢，最高 ${hi.toLocaleString()}，最低 ${lo.toLocaleString()}`}>
      {candle ? (
        points.map((p, i) => {
          const rise = p.price >= p.open!;
          const c = rise ? "var(--green)" : "var(--red)";
          const top = y(Math.max(p.open!, p.price));
          const bot = y(Math.min(p.open!, p.price));
          return (
            <g key={p.at}>
              <line x1={x(i)} x2={x(i)} y1={y(p.high!)} y2={y(p.low!)} style={{ stroke: c }} stroke-width="1" />
              <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} style={{ fill: c }} />
              <title>{`${stamp(p.at, kind, false)}　開 ${p.open} 高 ${p.high} 低 ${p.low} 收 ${p.price}`}</title>
            </g>
          );
        })
      ) : (
        <>
          <polygon points={area} style={{ fill: color }} opacity="0.12" />
          <polyline points={line} fill="none" style={{ stroke: color }} stroke-width="2" stroke-linejoin="round" />
        </>
      )}
      {kind === "intraday" && prevClose ? (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(prevClose)} y2={y(prevClose)} stroke="currentColor" opacity="0.35" stroke-dasharray="4 4" />
          <text x={W - PAD.r} y={y(prevClose) - 3} text-anchor="end" class="st-chart-t">
            前日收盤 {prevClose.toLocaleString()}
          </text>
        </>
      ) : null}
      <text x={PAD.l} y={PAD.t - 3} class="st-chart-t">
        高 {moneyShort(hi)}
      </text>
      <text x={PAD.l} y={H - PAD.b - 4} class="st-chart-t">
        低 {moneyShort(lo)}
      </text>
      <text x={PAD.l} y={H - 5} class="st-chart-t">
        {stamp(points[0]!.at, kind, multiDay)}
      </text>
      <text x={W - PAD.r} y={H - 5} text-anchor="end" class="st-chart-t">
        {stamp(points[points.length - 1]!.at, kind, multiDay)}
      </text>
      {events.map((e) => {
        const i = idxOf(e.at);
        if (i < 0) return null;
        const cy = candle ? y(points[i]!.high!) - 6 : y(points[i]!.price);
        return (
          <circle key={e.id} cx={x(i)} cy={cy} r="4.5" style={{ fill: e.pct >= 0 ? "var(--green)" : "var(--red)" }} stroke="#fff" stroke-width="1">
            <title>{`${stamp(e.at, kind, true)}　${e.text}（${e.pct >= 0 ? "+" : ""}${e.pct}%）`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
