import type { Hint } from "./hints";
import { Icon } from "./Icon";

/** 浮在 dock 上方的提示：一次一則，可以「知道了」或「不再提示」。 */
export function HintBar(props: { hint: Hint; onDismiss: () => void; onDisableAll: () => void; /** 這層有「擴建店面」按鈕時往上抬一格，不要蓋住它 */ lifted?: boolean }) {
  return (
    <div class={`st-hint-bar st-panel${props.lifted ? " lift" : ""}`} role="status" aria-live="polite">
      <Icon name="help" size={3} />
      <div class="st-hint-text">
        <b>{props.hint.title}</b>
        <span>{props.hint.text}</span>
      </div>
      <div class="st-hint-actions">
        <button class="st-btn pri" onClick={props.onDismiss}>
          知道了
        </button>
        <button class="st-hint-off" onClick={props.onDisableAll}>
          不再提示
        </button>
      </div>
    </div>
  );
}
