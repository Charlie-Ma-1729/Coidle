import { useState } from "preact/hooks";

export interface Series {
  name: string;
  color: string;
  values: number[];
}

const label = (v: number) => (v >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString());

/** 折線圖：游標移上去會顯示那一分鐘每條線的數值；圖例同時標出目前值，不靠顏色單獨傳達資訊 */
export function LineChart(props: { xs: number[]; series: Series[]; height?: number; unit?: string; title: string }) {
  const W = 600;
  const H = props.height ?? 150;
  const pad = { l: 42, r: 10, t: 10, b: 20 };
  const n = props.xs.length;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...props.series.flatMap((s) => s.values));
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const span = n > 1 ? props.xs[n - 1]! - props.xs[0]! : 0;
  const fmt = (t: number) =>
    span > 2 * 86_400_000
      ? new Date(t).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })
      : new Date(t).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtFull = (t: number) => new Date(t).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const unit = props.unit ?? "";
  const shown = hover ?? n - 1;

  const onMove = (e: MouseEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <figure class="ad-chart" style={{ margin: 0 }}>
      <figcaption class="ad-chart-h">
        <b>{props.title}</b>
        {props.series.map((s) => (
          <span key={s.name} class="ad-legend">
            <i aria-hidden="true" style={{ background: s.color }} />
            {s.name}
            <b>
              {n > 0 && s.values[shown] !== undefined ? label(s.values[shown]!) : "—"}
              {unit}
            </b>
          </span>
        ))}
      </figcaption>
      {n < 2 ? (
        <p class="ad-sub">資料還不夠（伺服器每分鐘取一筆樣本）。</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${props.title}：${props.series.map((s) => `${s.name}最新 ${s.values[n - 1] ?? 0}`).join("，")}`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" opacity={f === 0 ? 0.3 : 0.1} />
                <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.65">
                  {label(max * f)}
                </text>
              </g>
            ))}
            <text x={pad.l} y={H - 4} fontSize="10" fill="currentColor" opacity="0.65">
              {fmt(props.xs[0]!)}
            </text>
            <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.65">
              {fmt(props.xs[n - 1]!)}
            </text>
            {props.series.map((s, k) => {
              const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
              return (
                <g key={s.name}>
                  {k === 0 && <polygon points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} fill={s.color} opacity="0.1" />}
                  <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts} />
                </g>
              );
            })}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke="currentColor" opacity="0.35" strokeDasharray="3 3" />
                {props.series.map((s) => (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="3.5" fill={s.color} stroke="#0b1021" strokeWidth="1.5" />
                ))}
              </g>
            )}
          </svg>
          <div class="ad-chart-tip">{hover !== null ? fmtFull(props.xs[hover]!) : "把游標移到圖上可以看每一分鐘的數值"}</div>
        </>
      )}
    </figure>
  );
}
