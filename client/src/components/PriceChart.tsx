import type { MarketHistory } from "@coidle/shared";
import { moneyShort } from "../format";

const W = 600;
const H = 200;
const PAD = { l: 8, r: 8, t: 12, b: 20 };

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
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

/** 一檔股票的走勢圖：價格折線、區間高低點，以及「消息」的標記（滑過會顯示內容） */
export function PriceChart(props: { history: MarketHistory }) {
  const { points, events } = props.history;
  if (points.length < 2) return <p class="st-hint">資料還不夠，過一個小時再來看。</p>;
  const lo = Math.min(...points.map((p) => p.price));
  const hi = Math.max(...points.map((p) => p.price));
  const span = hi - lo || 1;
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${PAD.l},${H - PAD.b} ${line} ${x(points.length - 1).toFixed(1)},${H - PAD.b}`;
  const up = points[points.length - 1]!.price >= points[0]!.price;
  const color = up ? "var(--green)" : "var(--red)";
  const idxOf = (at: number) => points.findIndex((p) => p.at >= at);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="st-chart" role="img" aria-label={`${props.history.name} 的價格走勢，最高 ${hi.toLocaleString()}，最低 ${lo.toLocaleString()}`}>
      <polygon points={area} style={{ fill: color }} opacity="0.12" />
      <polyline points={line} fill="none" style={{ stroke: color }} stroke-width="2" stroke-linejoin="round" />
      <text x={PAD.l} y={PAD.t - 2} class="st-chart-t">
        高 {moneyShort(hi)}
      </text>
      <text x={PAD.l} y={H - PAD.b - 4} class="st-chart-t">
        低 {moneyShort(lo)}
      </text>
      <text x={PAD.l} y={H - 4} class="st-chart-t">
        {hhmm(points[0]!.at)}
      </text>
      <text x={W - PAD.r} y={H - 4} text-anchor="end" class="st-chart-t">
        {hhmm(points[points.length - 1]!.at)}
      </text>
      {events.map((e) => {
        const i = idxOf(e.at);
        if (i < 0) return null;
        return (
          <circle key={e.at} cx={x(i)} cy={y(points[i]!.price)} r="4.5" style={{ fill: e.pct >= 0 ? "var(--green)" : "var(--red)" }} stroke="#fff" stroke-width="1">
            <title>{`${hhmm(e.at)}　${e.text}（${e.pct >= 0 ? "+" : ""}${e.pct}%）`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
