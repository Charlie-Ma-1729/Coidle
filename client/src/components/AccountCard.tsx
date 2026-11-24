import { useState } from "preact/hooks";
import { api } from "../api";
import { Btn, Card, Field } from "./ui";
import { errMsg, refreshMe, toast, user } from "../store";

/** 帳號設定：暱稱、密碼、刪除帳號 */
export function AccountCard({ onDeleted }: { onDeleted?: () => void }) {
  const [name, setName] = useState(user.value?.displayName ?? "");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [del, setDel] = useState("");
  const [open, setOpen] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <Card title="👤 我的帳號" right={<span class="small dim">{user.value?.username}</span>}>
      <div class="stack">
        <div class="row">
          <input class="input" style={{ flex: 1, minWidth: 0 }} value={name} maxLength={20} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="暱稱" />
          <Btn
            small
            kind="primary"
            disabled={name.trim().length < 1 || name.trim() === user.value?.displayName}
            onClick={() =>
              guard(async () => {
                await api.updateProfile(name.trim());
                await refreshMe();
                toast("暱稱已更新", "ok");
              })
            }
          >
            改暱稱
          </Btn>
        </div>
        <Field label="更改密碼" hint="改完後，其他裝置會被登出">
          <div class="stack">
            <input class="input" type="password" autocomplete="current-password" placeholder="目前的密碼" value={cur} onInput={(e) => setCur((e.target as HTMLInputElement).value)} />
            <input class="input" type="password" autocomplete="new-password" placeholder="新密碼（至少 8 個字）" value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} />
            <div class="row">
              <Btn
                small
                disabled={cur.length === 0 || next.length < 8}
                onClick={() =>
                  guard(async () => {
                    await api.changePassword(cur, next);
                    setCur("");
                    setNext("");
                    toast("密碼已更新", "ok");
                  })
                }
              >
                更改密碼
              </Btn>
            </div>
          </div>
        </Field>
        <div>
          <button class="linklike small dim" onClick={() => setOpen(!open)}>
            {open ? "收起" : "刪除我的帳號…"}
          </button>
          {open && (
            <div class="stack" style={{ marginTop: "8px" }}>
              <p class="small dim">刪除後無法復原。如果你是還有其他成員的商場的創辦人，要先轉讓創辦人；只有你一個人的商場會一併解散。</p>
              <input class="input" type="password" placeholder="輸入密碼確認" value={del} onInput={(e) => setDel((e.target as HTMLInputElement).value)} />
              <div class="row">
                <Btn
                  small
                  kind="danger"
                  disabled={del.length === 0}
                  onClick={() =>
                    confirm("確定要永久刪除這個帳號嗎？") &&
                    guard(async () => {
                      await api.deleteAccount(del);
                      toast("帳號已刪除", "ok");
                      onDeleted?.();
                    })
                  }
                >
                  永久刪除帳號
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
