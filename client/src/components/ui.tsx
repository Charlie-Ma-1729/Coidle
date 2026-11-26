import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { busy, toasts } from "../store";

export function Card(props: { title?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`card ${props.class ?? ""}`}>
      {(props.title || props.right) && (
        <header class="card-head">
          <h3>{props.title}</h3>
          <div>{props.right}</div>
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Chip(props: { children: ComponentChildren; tone?: "pink" | "cyan" | "amber" | "green" | "red" | "dim"; title?: string }) {
  return (
    <span class={`chip chip-${props.tone ?? "dim"}`} title={props.title}>
      {props.children}
    </span>
  );
}

/** 0–100 的橫條。tone 預設依數值自動著色。 */
export function Meter(props: { label: string; value: number; hint?: string; tone?: "pink" | "cyan" | "amber" | "green" | "red" }) {
  const v = Math.max(0, Math.min(100, props.value));
  const tone = props.tone ?? (v < 30 ? "red" : v < 50 ? "amber" : "green");
  return (
    <div class="meter">
      <div class="meter-top">
        <span>{props.label}</span>
        <b>{props.hint ?? v.toFixed(0)}</b>
      </div>
      <div class="meter-track">
        <div class={`meter-fill tone-${tone}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function Btn(props: {
  children: ComponentChildren;
  onClick?: () => void;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  small?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={props.type ?? "button"}
      class={`btn btn-${props.kind ?? "ghost"} ${props.small ? "btn-sm" : ""}`}
      disabled={props.disabled || busy.value}
      onClick={props.onClick}
      title={props.title}
    >
      {props.children}
    </button>
  );
}

/** 手機從底部滑出、桌面置中的彈出層 */
export function Sheet(props: { title: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, []);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true">
        <header class="sheet-head">
          <h2>{props.title}</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label="關閉">
            ✕
          </button>
        </header>
        <div class="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Field(props: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span class="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <p class="empty">{props.children}</p>;
}
