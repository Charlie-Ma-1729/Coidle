import { useEffect, useState } from "preact/hooks";
import { alreadyReloadedFor, applyUpdate, isEditing, updateAvailable } from "../updater";

/** 倒數幾秒後自動重新載入 */
const COUNTDOWN_S = 20;
/** 使用者正在打字時順延幾秒再試 */
const POSTPONE_S = 10;

/** 有新版時顯示在畫面頂部：倒數後自動重新載入，也可以立即更新或稍後再說 */
export function UpdateBanner() {
  const v = updateAvailable.value;
  const [left, setLeft] = useState(COUNTDOWN_S);
  const [later, setLater] = useState(false);
  const auto = v !== null && !later && !alreadyReloadedFor(v);

  useEffect(() => {
    if (!auto) return;
    setLeft(COUNTDOWN_S);
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [auto, v]);

  useEffect(() => {
    if (!auto || left > 0) return;
    if (isEditing()) setLeft(POSTPONE_S);
    else applyUpdate(v);
  }, [left, auto, v]);

  if (!v) return null;
  return (
    <div class="update-banner" role="status">
      <span>
        🔄 有新版本了。
        {auto ? `${Math.max(0, left)} 秒後自動重新載入。` : "重新載入後就會用上新版。"}
      </span>
      <button class="btn btn-sm btn-primary" onClick={() => applyUpdate(v)}>
        立即更新
      </button>
      {auto && (
        <button class="btn btn-sm" onClick={() => setLater(true)}>
          稍後
        </button>
      )}
    </div>
  );
}
