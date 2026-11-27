import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Btn } from "./ui";

/** 遊戲內自製對話框（取代瀏覽器內建 confirm／prompt／alert）。管理室另有 admin/kit.tsx 的版本。 */

type Opts = { danger?: boolean; ok?: string; cancel?: string };
type Dlg =
  | { kind: "confirm"; title: string; body: string; opts: Opts; done: (v: boolean) => void }
  | { kind: "prompt"; title: string; value: string; done: (v: string | null) => void }
  | { kind: "notice"; title: string; body: string; done: () => void };

const dlg = signal<Dlg | null>(null);

/** 第一行當標題，其餘當說明 */
const split = (msg: string) => {
  const i = msg.indexOf("\n");
  return i < 0 ? { title: msg, body: "" } : { title: msg.slice(0, i), body: msg.slice(i + 1).trim() };
};

export const ask = (message: string, opts: Opts = {}) =>
  new Promise<boolean>((done) => {
    dlg.value = { kind: "confirm", ...split(message), opts, done };
  });

/** 確認後才執行：`confirmThen("確定？", () => run(...))` */
export const confirmThen = (message: string, fn: () => unknown, opts: Opts = {}) => {
  void ask(message, opts).then((ok) => ok && fn());
};

export const askText = (title: string, value = "") =>
  new Promise<string | null>((done) => {
    dlg.value = { kind: "prompt", title, value, done };
  });

export const notice = (message: string) =>
  new Promise<void>((done) => {
    dlg.value = { kind: "notice", ...split(message), done };
  });

export function ConfirmHost() {
  const d = dlg.value;
  const [text, setText] = useState("");
  useEffect(() => {
    if (d?.kind === "prompt") setText(d.value);
  }, [d]);
  useEffect(() => {
    if (!d) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && cancel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [d]);
  if (!d) return null;
  function cancel() {
    const cur = dlg.value;
    if (!cur) return;
    if (cur.kind === "confirm") cur.done(false);
    else if (cur.kind === "prompt") cur.done(null);
    else cur.done();
    dlg.value = null;
  }
  const accept = () => {
    if (d.kind === "confirm") d.done(true);
    else if (d.kind === "prompt") d.done(text.trim() || null);
    else d.done();
    dlg.value = null;
  };
  return (
    <div class="dlg-backdrop" onClick={cancel}>
      <div class="dlg" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{d.title}</h3>
        {d.kind !== "prompt" && d.body && <p class="small dim">{d.body}</p>}
        {d.kind === "prompt" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              accept();
            }}
          >
            <input class="input" type="text" autoFocus value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          </form>
        )}
        <div class="row end">
          {d.kind !== "notice" && (
            <Btn kind="ghost" onClick={cancel}>
              {(d.kind === "confirm" && d.opts.cancel) || "取消"}
            </Btn>
          )}
          <Btn kind={d.kind === "confirm" && d.opts.danger ? "danger" : "primary"} onClick={accept}>
            {d.kind === "confirm" ? d.opts.ok ?? "確定" : "好"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
