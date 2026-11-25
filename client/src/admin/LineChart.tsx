export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** 簡單的折線圖：同一個時間軸、每條線有名稱（圖例同時標出目前值），不靠顏色單獨傳達資訊 */
export function LineChart(props: { xs: number[]; series: Series[]; height?: number; unit?: string; title: string }) {
  const W = 560;
  const H = props.height ?? 120;
  const pad = { l: 38, r: 8, t: 8, b: 18 };
  const n = props.xs.length;
  const all = props.series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const fmt = (t: number) => new Date(t).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  const label = (v: number) => (v >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());
  return (
    <figure style={{ margin: 0 }}>
      <figcaption class="small" style={{ marginBottom: "4px" }}>
        <b>{props.title}</b>
        {props.series.map((s) => (
          <span key={s.name} style={{ marginLeft: "12px" }}>
            <span aria-hidden="true" style={{ display: "inline-block", width: "10px", height: "3px", background: s.color, verticalAlign: "middle", marginRight: "4px" }} />
            {s.name} {s.values.length ? label(s.values[s.values.length - 1]!) : "—"}
            {props.unit ?? ""}
          </span>
        ))}
      </figcaption>
      {n < 2 ? (
        <p class="small dim">資料還不夠（每分鐘取一筆樣本）。</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${props.title}：${props.series.map((s) => `${s.name}最新 ${s.values[s.values.length - 1] ?? 0}`).join("，")}`}>
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="currentColor" opacity="0.25" />
          <line x1={pad.l} x2={W - pad.r} y1={y(max)} y2={y(max)} stroke="currentColor" opacity="0.12" />
          <text x={pad.l - 4} y={y(max) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.7">
            {label(max)}
          </text>
          <text x={pad.l - 4} y={y(0) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.7">
            0
          </text>
          <text x={pad.l} y={H - 4} fontSize="10" fill="currentColor" opacity="0.7">
            {fmt(props.xs[0]!)}
          </text>
          <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.7">
            {fmt(props.xs[n - 1]!)}
          </text>
          {props.series.map((s) => (
            <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
          ))}
        </svg>
      )}
    </figure>
  );
}
