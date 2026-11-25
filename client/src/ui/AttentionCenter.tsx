import type { AttentionItem, Severity } from "../stage/model";
import type { GlyphKey } from "../stage/glyphs";
import { Icon } from "./Icon";

const GROUPS: { sev: Severity; label: string; glyph: GlyphKey }[] = [
  { sev: "urgent", label: "緊急", glyph: "exclaim" },
  { sev: "decision", label: "需要你決定", glyph: "event" },
  { sev: "opportunity", label: "機會", glyph: "star" },
  { sev: "info", label: "資訊", glyph: "news" },
];

/** 單一待辦中心：所有「需要玩家處理的事」集中在這裡，依急迫度排序，每項只有一個主要動作。 */
export function AttentionCenter(props: { items: AttentionItem[]; onClose: () => void; onAct: (item: AttentionItem) => void }) {
  return (
    <div class="st-pop st-panel" role="dialog" aria-label="待辦中心">
      <div class="st-pop-head">
        <h3>待辦中心</h3>
        <button class="st-btn sq" onClick={props.onClose} aria-label="關閉">
          ✕
        </button>
      </div>
      <div class="st-pop-body">
        {GROUPS.map((g) => {
          const items = props.items.filter((i) => i.severity === g.sev);
          if (items.length === 0) return null;
          return (
            <>
              <div class="st-group-h" key={`h-${g.sev}`}>
                <Icon name={g.glyph} size={1} /> {g.label}（{items.length}）
              </div>
              {items.map((it) => (
                <div class={`st-item ${it.severity}`} key={it.id}>
                  <div class="bar" />
                  <div>
                    <b>
                      <Icon name={it.icon} size={2} /> {it.title}
                    </b>
                    {it.detail && <small>{it.detail}</small>}
                  </div>
                  <button class="st-btn" onClick={() => props.onAct(it)}>
                    {it.cta}
                  </button>
                </div>
              ))}
            </>
          );
        })}
      </div>
    </div>
  );
}
