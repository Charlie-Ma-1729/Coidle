import type { MarketHistory } from "@coidle/shared";
import { useState } from "preact/hooks";
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
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);
const pctText = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const toneOf = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");

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

/** 簡單移動平均（前 n-1 個點沒有值） */
const movingAverage = (values: number[], n: number): (number | null)[] => {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
};

/**
 * 一檔股票的走勢圖：折線（盤中）或 K 線（日線，mode="candle"），區間高低點、前日收盤的虛線，
 * 「消息」的標記，以及手指／滑鼠移到哪就顯示那一點的價格（K 線另外畫 5 日、20 日均線）。
 */
export function PriceChart(props: { history: MarketHistory; mode?: "line" | "candle"; loading?: boolean }) {
  const { points, events, kind, prevClose } = props.history;
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p class="st-hint">資料還不夠，等開盤走幾步再來看。</p>;
  // 日 K：有 OHLC 的點畫成蠟燭；沒有 OHLC 的點當成一條橫線的小蠟燭
  const candle = props.mode === "candle" && kind === "daily" && points.filter((p) => p.open !== undefined).length >= 2 && points.length <= 260;
  const op = (p: (typeof points)[number]) => p.open ?? p.price;
  const hi_ = (p: (typeof points)[number]) => p.high ?? p.price;
  const lo_ = (p: (typeof points)[number]) => p.low ?? p.price;
  const lows = points.map((p) => (candle ? lo_(p) : p.price));
  const highs = points.map((p) => (candle ? hi_(p) : p.price));
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
  const ref = kind === "intraday" && prevClose ? prevClose : (points[0]!.open ?? points[0]!.price);
  const up = last >= ref;
  const color = up ? "var(--green)" : "var(--red)";
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${PAD.l},${H - PAD.b} ${line} ${x(points.length - 1).toFixed(1)},${H - PAD.b}`;
  const idxOf = (at: number) => points.findIndex((p) => p.at >= at);
  const multiDay = new Date(points[0]!.at).toDateString() !== new Date(points[points.length - 1]!.at).toDateString();
  const bw = Math.max(1.5, Math.min(9, ((W - PAD.l - PAD.r) / points.length) * 0.65));
  const closes = points.map((p) => p.price);
  const mas = candle
    ? ([
        { n: 5, c: "#ffc857", v: movingAverage(closes, 5) },
        { n: 20, c: "#6ab7ff", v: movingAverage(closes, 20) },
      ] as const).filter((m) => points.length > m.n)
    : [];
  const maLine = (v: (number | null)[]) =>
    v
      .map((n, i) => (n === null ? null : `${x(i).toFixed(1)},${y(n).toFixed(1)}`))
      .filter((s): s is string => s !== null)
      .join(" ");

  const at = (e: { clientX: number; currentTarget: SVGSVGElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1)))));
  };
  const h = hover !== null && hover < points.length ? hover : null;
  const hp = h !== null ? points[h]! : null;
  // 讀數：移到某點顯示那一點；沒有就顯示整個區間的概況
  let readout: { head: string; body: string; delta: number };
  if (hp && h !== null) {
    const base = candle ? (h > 0 ? points[h - 1]!.price : op(hp)) : kind === "intraday" && prevClose ? prevClose : points[0]!.price;
    readout = {
      head: stamp(hp.at, kind, multiDay || kind === "intraday"),
      body: candle ? `開 ${op(hp).toLocaleString()}　高 ${hi_(hp).toLocaleString()}　低 ${lo_(hp).toLocaleString()}　收 ${hp.price.toLocaleString()}` : `價 ${hp.price.toLocaleString()}`,
      delta: pct(hp.price, base),
    };
  } else {
    readout = {
      head: `${stamp(points[0]!.at, kind, multiDay)} → ${stamp(points[points.length - 1]!.at, kind, multiDay)}`,
      body: `高 ${hi.toLocaleString()}　低 ${lo.toLocaleString()}　現 ${last.toLocaleString()}`,
      delta: pct(last, ref),
    };
  }
  return (
    <>
      <div class="st-chart-readout" aria-live="off">
        <span>{readout.head}</span>
        <span class="grow">{readout.body}</span>
        <b class={toneOf(readout.delta)}>{pctText(readout.delta)}</b>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        class={`st-chart${props.loading ? " loading" : ""}`}
        aria-busy={props.loading ? "true" : undefined}
        role="img"
        aria-label={`${props.history.name} 的價格走勢，最高 ${hi.toLocaleString()}，最低 ${lo.toLocaleString()}`}
        onPointerMove={at}
        onPointerDown={at}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
        style={{ touchAction: "pan-y" }}
      >
        {candle ? (
          points.map((p, i) => {
            const rise = p.price >= op(p);
            const c = rise ? "var(--green)" : "var(--red)";
            const top = y(Math.max(op(p), p.price));
            const bot = y(Math.min(op(p), p.price));
            return (
              <g key={p.at}>
                <line x1={x(i)} x2={x(i)} y1={y(hi_(p))} y2={y(lo_(p))} style={{ stroke: c }} stroke-width="1" />
                <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} style={{ fill: c }} />
              </g>
            );
          })
        ) : (
          <>
            <polygon points={area} style={{ fill: color }} opacity="0.12" />
            <polyline points={line} fill="none" style={{ stroke: color }} stroke-width="2" stroke-linejoin="round" />
          </>
        )}
        {mas.map((m) => (
          <polyline key={m.n} points={maLine(m.v)} fill="none" stroke={m.c} stroke-width="1.2" stroke-linejoin="round" opacity="0.9" />
        ))}
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
        {mas.length > 0 && (
          <text x={W - PAD.r} y={PAD.t - 3} text-anchor="end" class="st-chart-t">
            {mas.map((m) => `MA${m.n}`).join("・")}
          </text>
        )}
        {events.map((e) => {
          const i = idxOf(e.at);
          if (i < 0) return null;
          const cy = candle ? y(hi_(points[i]!)) - 6 : y(points[i]!.price);
          return (
            <circle key={e.id} cx={x(i)} cy={cy} r="4.5" style={{ fill: e.pct >= 0 ? "var(--green)" : "var(--red)" }} stroke="#fff" stroke-width="1">
              <title>{`${stamp(e.at, kind, true)}　${e.text}（${e.pct >= 0 ? "+" : ""}${e.pct}%）`}</title>
            </circle>
          );
        })}
        {h !== null && hp && (
          <g pointer-events="none">
            <line x1={x(h)} x2={x(h)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" opacity="0.45" stroke-dasharray="3 3" />
            <circle cx={x(h)} cy={y(hp.price)} r="3.5" style={{ fill: "var(--text)" }} />
          </g>
        )}
      </svg>
    </>
  );
}
