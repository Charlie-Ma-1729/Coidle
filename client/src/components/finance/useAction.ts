import { useState } from "preact/hooks";
import { errMsg, toast } from "../../store";

export type RunAction = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

/** 按鈕動作的共用外殼：忙碌中不能再按、成功顯示提示、失敗顯示伺服器的中文錯誤，做完呼叫 after 重新整理 */
export function useAction(after?: () => Promise<unknown> | unknown): { busy: boolean; run: RunAction } {
  const [busy, setBusy] = useState(false);
  const run: RunAction = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, "ok");
      await after?.();
      return true;
    } catch (e) {
      toast(errMsg(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
