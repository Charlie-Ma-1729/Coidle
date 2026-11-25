import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import type { GlyphKey } from "../stage/glyphs";
import { Icon } from "./Icon";

export interface WinTab {
  id: string;
  label: string;
  badge?: number;
}

/** 樞紐視窗外殼：標題列 → 摘要 → 分頁（≤4）→ 內容。桌機置中、手機從底部滑出。 */
export function Window(props: {
  title: string;
  icon: GlyphKey;
  summary?: { label: string; value: string }[];
  tabs: WinTab[];
  tab: string;
  onTab: (id: string) => void;
  onClose: () => void;
  children: ComponentChildren;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div class="st-win-wrap" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="st-win st-panel" role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="st-win-bar">
          <Icon name={props.icon} size={3} />
          <h2>{props.title}</h2>
          <button class="st-btn sq st-x" style={{ marginLeft: "auto" }} onClick={props.onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        {props.summary && (
          <div class="st-win-sum">
            {props.summary.map((s) => (
              <span class="st-pill" key={s.label}>
                <small>{s.label}</small>
                <b>{s.value}</b>
              </span>
            ))}
          </div>
        )}
        {props.tabs.length > 0 && (
        <div class="st-tabs" role="tablist">
          {props.tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={props.tab === t.id} class={props.tab === t.id ? "on" : ""} onClick={() => props.onTab(t.id)}>
              {t.label}
              {t.badge ? ` (${t.badge})` : ""}
            </button>
          ))}
        </div>
        )}
        <div class="st-win-body">{props.children}</div>
      </div>
    </div>
  );
}
