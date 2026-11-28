import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

// 管理室共用的小元件：圖示、卡片、統計、標籤、欄位、開關、抽屜、對話框（取代瀏覽器的 confirm／prompt）

const PATHS: Record<string, string> = {
  live: "M4 19V5 M4 19h16 M8 15l3-4 3 2 4-6",
  mall: "M4 9l1.5-5h13L20 9 M4 9v10h16V9 M4 9c0 1.7 1.3 3 2.7 3S9.3 10.7 9.3 9c0 1.7 1.3 3 2.7 3s2.7-1.3 2.7-3c0 1.7 1.3 3 2.7 3S20 10.7 20 9 M10 19v-5h4v5",
  users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5 M16 4.5a3.3 3.3 0 010 6.3 M18 14.8c2 .7 3.5 2.4 3.5 5.2",
  npc: "M5 21V5l9-2v18 M14 8h5v13 M8 8h2 M8 12h2 M8 16h2",
  event: "M13 3L5 14h6l-1 7 8-11h-6z",
  ai: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z",
  audit: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
  market: "M4 19V5 M4 19h16 M7 15v-4 M11 15V8 M15 15v-6 M19 15v-3",
  back: "M15 5l-7 7 7 7",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 100-6 3 3 0 000 6z",
  refresh: "M20 11a8 8 0 10-2.3 5.7 M20 5v6h-6",
  logout: "M10 4H5v16h5 M15 8l4 4-4 4 M19 12H9",
  x: "M6 6l12 12 M18 6L6 18",
  download: "M12 4v11 M7 11l5 5 5-5 M5 20h14",
  enter: "M14 4h5v16h-5 M10 8l4 4-4 4 M14 12H4",
  tune: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5v4 M8 15v4",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14z M20 20l-4-4",
  copy: "M9 9h10v11H9z M5 15V4h10",
  clear: "M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6L7 7 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4 M12 8a4 4 0 100 8 4 4 0 000-8z",
  cloudy: "M7 18a4 4 0 010-8 5.5 5.5 0 0110.6 1.5A3.3 3.3 0 0117 18z",
  rain: "M7 14a4 4 0 010-8 5.5 5.5 0 0110.6 1.5A3.3 3.3 0 0117 14z M8 17l-1 3 M12 17l-1 3 M16 17l-1 3",
  storm: "M7 13a4 4 0 010-8 5.5 5.5 0 0110.6 1.5A3.3 3.3 0 0117 13z M12 13l-2 4h3l-2 4",
};

export type IconName = keyof typeof PATHS;

export function Ico(props: { n: IconName; class?: string }) {
  return (
    <svg class={`ad-ico ${props.class ?? ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[props.n]!.split(" M").map((d, i) => (
        <path key={i} d={i === 0 ? d : `M${d}`} />
      ))}
    </svg>
  );
}

export function Badge(props: { tone?: "green" | "amber" | "red" | "cyan" | "pink"; children: ComponentChildren }) {
  return <span class={`ad-badge ${props.tone ?? ""}`}>{props.children}</span>;
}

export function Card(props: { title?: ComponentChildren; desc?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren; class?: string }) {
  return (
    <section class={`ad-card ${props.class ?? ""}`}>
      {(props.title || props.actions) && (
        <div class="ad-card-h">
          <div>
            {props.title && <h3>{props.title}</h3>}
            {props.desc && <p>{props.desc}</p>}
          </div>
          {props.actions && <div class="ad-row">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Stat(props: { label: string; value: string | number; hint?: string; tone?: "cyan" | "green" | "amber" | "pink" | "red" }) {
  const color = { cyan: "var(--cyan)", green: "var(--green)", amber: "var(--amber)", pink: "var(--pink)", red: "var(--red)" }[props.tone ?? "cyan"];
  return (
    <div class="ad-stat" style={{ "--tone": color } as never}>
      <label>{props.label}</label>
      <b>{props.value}</b>
      {props.hint && <small>{props.hint}</small>}
    </div>
  );
}

export function Field(props: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="ad-field">
      <span>{props.label}</span>
      {props.children}
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label class="ad-switch">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <i />
      {props.label && <span>{props.label}</span>}
    </label>
  );
}

export function Seg<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="ad-seg" role="group">
      {props.options.map(([v, label]) => (
        <button key={v} type="button" class={props.value === v ? "on" : ""} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <div class="ad-empty">{props.children}</div>;
}

export function Bar(props: { value: number; max: number; warnAt?: number; badAt?: number }) {
  const pct = props.max > 0 ? Math.min(100, Math.max(0, (props.value / props.max) * 100)) : 0;
  const cls = props.badAt !== undefined && pct >= props.badAt ? "bad" : props.warnAt !== undefined && pct >= props.warnAt ? "warn" : "";
  return (
    <div class={`ad-bar ${cls}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 右側滑出的面板：點背景或按 Esc 關閉 */
export function Drawer(props: { title: ComponentChildren; sub?: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <>
      <div class="ad-back" onClick={props.onClose} />
      <div class="ad-drawer" role="dialog" aria-modal="true">
        <div class="ad-drawer-h">
          <div>
            <h2>{props.title}</h2>
            {props.sub && <p>{props.sub}</p>}
          </div>
          <button class="ad-btn ghost sm" onClick={props.onClose} aria-label="關閉">
            <Ico n="x" />
          </button>
        </div>
        <div class="ad-drawer-b">{props.children}</div>
      </div>
    </>
  );
}

export function Section(props: { title: string; danger?: boolean; children: ComponentChildren }) {
  return (
    <div class={`ad-sec ${props.danger ? "danger" : ""}`}>
      <h4>{props.title}</h4>
      {props.children}
    </div>
  );
}

// ───────── 對話框（取代 confirm／prompt／alert，樣式一致、不會被瀏覽器擋）

type Dlg =
  | { kind: "confirm"; title: string; body: string; ok: string; danger: boolean; done: (v: boolean) => void }
  | { kind: "prompt"; title: string; body: string; value: string; done: (v: string | null) => void }
  | { kind: "secret"; title: string; body: string; secret: string; done: () => void };
const dlg = signal<Dlg | null>(null);

export const confirmBox = (title: string, body = "", opts: { danger?: boolean; ok?: string } = {}) =>
  new Promise<boolean>((done) => {
    dlg.value = { kind: "confirm", title, body, ok: opts.ok ?? "確定", danger: !!opts.danger, done };
  });
export const promptBox = (title: string, value = "", body = "") =>
  new Promise<string | null>((done) => {
    dlg.value = { kind: "prompt", title, body, value, done };
  });
/** 顯示只會出現一次的機密（臨時密碼、金鑰），附複製按鈕 */
export const secretBox = (title: string, body: string, secret: string) =>
  new Promise<void>((done) => {
    dlg.value = { kind: "secret", title, body, secret, done };
  });

export function DialogHost() {
  const d = dlg.value;
  const [text, setText] = useState("");
  useEffect(() => {
    if (d?.kind === "prompt") setText(d.value);
  }, [d]);
  if (!d) return null;
  const close = () => (dlg.value = null);
  const cancel = () => {
    if (d.kind === "confirm") d.done(false);
    else if (d.kind === "prompt") d.done(null);
    else d.done();
    close();
  };
  return (
    <>
      <div class="ad-back" style={{ zIndex: 89 }} onClick={cancel} />
      <div class="ad-dlg" role="dialog" aria-modal="true">
        <h3>{d.title}</h3>
        {d.body && <p>{d.body}</p>}
        {d.kind === "prompt" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              d.done(text.trim() || null);
              close();
            }}
          >
            <input type="text" autoFocus value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          </form>
        )}
        {d.kind === "secret" && <div class="ad-secret">{d.secret}</div>}
        <div class="ad-row end">
          {d.kind === "secret" ? (
            <>
              <button class="ad-btn" onClick={() => void navigator.clipboard?.writeText(d.secret)}>
                <Ico n="copy" />
                複製
              </button>
              <button class="ad-btn pri" onClick={cancel}>
                我已記下
              </button>
            </>
          ) : (
            <>
              <button class="ad-btn ghost" onClick={cancel}>
                取消
              </button>
              <button
                class={`ad-btn ${d.kind === "confirm" && d.danger ? "danger" : "pri"}`}
                autoFocus={d.kind === "confirm"}
                onClick={() => {
                  if (d.kind === "confirm") d.done(true);
                  else d.done(text.trim() || null);
                  close();
                }}
              >
                {d.kind === "confirm" ? d.ok : "確定"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ───────── 小工具

export const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDateFull = (ms: number) => (ms ? new Date(ms).toLocaleString("zh-TW", { hour12: false }) : "—");
export const fmtMoney = (n: number) => (Math.abs(n) >= 100_000_000 ? `${(n / 100_000_000).toFixed(2)} 億` : Math.abs(n) >= 10_000 ? `${(n / 10_000).toFixed(n % 10_000 === 0 ? 0 : 1)} 萬` : n.toLocaleString());
export const ago = (ms: number) => {
  if (!ms) return "從未";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "剛剛";
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  return `${Math.floor(s / 86400)} 天前`;
};
