import type { GlyphKey } from "../stage/glyphs";
import type { HubId } from "../stage/model";
import { Icon } from "./Icon";

export const HUBS: { id: HubId; glyph: GlyphKey; label: string }[] = [
  { id: "operate", glyph: "store", label: "營運" },
  { id: "guests", glyph: "person", label: "客人" },
  { id: "develop", glyph: "flask", label: "開發" },
  { id: "finance", glyph: "coin", label: "財務" },
  { id: "world", glyph: "globe", label: "世界" },
];

/** 底部 dock：5 個樞紐，徽章＝該樞紐待處理數 */
export function Dock(props: { active: HubId | null; badges: Partial<Record<HubId, number>>; onPick: (id: HubId) => void; /** 要顯示的樞紐（預設全部） */ visible?: HubId[] }) {
  return (
    <nav class="st-dock st-panel" aria-label="主選單">
      {HUBS.filter((h) => !props.visible || props.visible.includes(h.id)).map((h) => {
        const n = props.badges[h.id] ?? 0;
        return (
          <button key={h.id} class={props.active === h.id ? "on" : ""} aria-pressed={props.active === h.id} onClick={() => props.onPick(h.id)}>
            <span class="ico">
              <Icon name={h.glyph} size={3} />
            </span>
            <span>{h.label}</span>
            {n > 0 && <span class="st-badge">{n}</span>}
          </button>
        );
      })}
    </nav>
  );
}
