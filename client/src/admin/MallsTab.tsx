import { useState } from "preact/hooks";
import { LEVELS, SPEED_PRESETS, ZONES } from "@coidle/shared";
import { adminApi, type AdminMall, type Overview } from "./adminApi";
import { errMsg, openMall, spectateMall, toast } from "../store";

const date = (ms: number) => new Date(ms).toLocaleString("zh-TW", { hour12: false });
const FLAGS = ["feature:lease", ...ZONES.map((z) => `zone:${z.id}`)];

function MallCard(props: { m: AdminMall; ov: Overview; mine: boolean; reload: () => Promise<void> }) {
  const { m } = props;
  const [open, setOpen] = useState(false);
  const [funds, setFunds] = useState(String(m.funds));
  const [notice, setNotice] = useState("");
  const [addId, setAddId] = useState("");

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "ok");
      await props.reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const post = (path: string, body?: unknown) => adminApi.post(`/malls/${m.id}${path}`, body);
  const nonMembers = props.ov.users.filter((u) => u.role === "player" && !m.members_list.some((x) => x.userId === u.id));

  return (
    <div class="card">
      <h3>
        #{m.id} {m.name} {m.sandbox ? <span class="chip chip-amber">測試・獨立於世界</span> : null} {m.online > 0 && <span class="chip chip-green">{m.online} 人在場</span>}
      </h3>
      <p class="small">
        成員 {m.members}（{m.members_list.map((x) => `${x.displayName}${x.isOwner ? "★" : ""}`).join("、")}）・Lv.{m.level}・資金 {m.funds.toLocaleString()}・第 {m.day} 天・建立於 {date(m.created_at)}
      </p>
      <div class="row" style={{ flexWrap: "wrap" }}>
        <button class="btn btn-primary btn-sm" onClick={() => void spectateMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
          👁 旁觀
        </button>
        {props.mine && (
          <button class="btn btn-ghost btn-sm" onClick={() => void openMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
            進入（以創辦人身分操作）
          </button>
        )}
        <button class="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
          {open ? "收起管理" : "管理"}
        </button>
      </div>

      {open && (
        <div class="stack" style={{ marginTop: "10px" }}>
          <div class="row" style={{ flexWrap: "wrap" }}>
            <button class="btn btn-ghost btn-sm" onClick={() => {
              const name = prompt("新的商場名稱", m.name)?.trim();
              if (name) void act(() => post("/rename", { name }), "已改名");
            }}>
              改名
            </button>
            <button class="btn btn-ghost btn-sm" onClick={() => act(() => post("/clock", { paused: true }), "已暫停")}>
              暫停時間
            </button>
            <button class="btn btn-ghost btn-sm" onClick={() => act(() => post("/clock", { paused: false }), "已繼續")}>
              繼續時間
            </button>
            <select
              aria-label="時間流速"
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v) void act(() => post("/clock", { speed: v }), "已調整流速");
              }}
            >
              <option value="">流速…</option>
              {SPEED_PRESETS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              aria-label="等級"
              value={String(m.level)}
              onChange={(e) => void act(() => post("/level", { level: Number((e.target as HTMLSelectElement).value) }), "已調整等級")}
            >
              {LEVELS.map((l) => (
                <option key={l.level} value={l.level}>
                  Lv.{l.level}
                </option>
              ))}
            </select>
          </div>

          <div class="row">
            <input type="number" value={funds} onInput={(e) => setFunds((e.target as HTMLInputElement).value)} style={{ width: "160px" }} aria-label="資金" />
            <button class="btn btn-ghost btn-sm" onClick={() => act(() => post("/funds", { funds: Number(funds) }), "已設定資金")}>
              設定資金
            </button>
          </div>

          <div class="row">
            <input type="text" maxLength={120} placeholder="對這座商場發一則通知" value={notice} onInput={(e) => setNotice((e.target as HTMLInputElement).value)} style={{ flex: 1 }} />
            <button class="btn btn-ghost btn-sm" disabled={notice.trim().length < 4} onClick={() => act(async () => { await post("/notice", { text: notice.trim() }); setNotice(""); }, "已送出通知")}>
              送出
            </button>
          </div>

          <div>
            <p class="small dim">成員</p>
            {m.members_list.map((x) => (
              <div class="row small" key={x.userId}>
                <span>
                  {x.displayName}
                  {x.isOwner ? "（創辦人）" : ""}
                </span>
                {!x.isOwner && (
                  <button class="linklike small" onClick={() => confirm(`把「${x.displayName}」設為創辦人？`) && void act(() => post("/owner", { userId: x.userId }), "已轉讓創辦人")}>
                    設為創辦人
                  </button>
                )}
                <button class="linklike small" onClick={() => confirm(`把「${x.displayName}」移出商場？`) && void act(() => post(`/members/${x.userId}/remove`), "已移出")}>
                  移出
                </button>
              </div>
            ))}
            <div class="row" style={{ marginTop: "6px" }}>
              <select aria-label="加入成員" value={addId} onChange={(e) => setAddId((e.target as HTMLSelectElement).value)}>
                <option value="">加入成員…</option>
                {nonMembers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}（{u.username}）
                  </option>
                ))}
              </select>
              <button class="btn btn-ghost btn-sm" disabled={!addId} onClick={() => act(async () => { await post("/members", { userId: Number(addId) }); setAddId(""); }, "已加入")}>
                加入
              </button>
            </div>
          </div>

          <div>
            <p class="small dim">功能與區域（勾選＝強制開放；取消＝強制關閉）</p>
            <div class="row small" style={{ flexWrap: "wrap" }}>
              {FLAGS.map((f) => (
                <label key={f} style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
                  <input type="checkbox" checked={m.flags[f] === true} onChange={(e) => void act(() => adminApi.post(`/malls/${m.id}/flags`, { flag: f, value: (e.target as HTMLInputElement).checked }), `已更新 ${f}`)} />
                  {f}
                </label>
              ))}
            </div>
          </div>

          <button class="btn btn-danger btn-sm" onClick={() => confirm(`確定解散「${m.name}」？所有資料會刪除，無法復原。`) && void act(() => adminApi.post(`/malls/${m.id}/delete`), "已解散")}>
            解散商場
          </button>
        </div>
      )}
    </div>
  );
}

/** 商場：列表、旁觀、時鐘、資金與等級、通知、成員與創辦人、功能旗標、解散 */
export function MallsTab(props: { ov: Overview; mineIds: number[]; reload: () => Promise<void> }) {
  return (
    <div class="stack">
      {props.ov.malls.length === 0 && <p class="small dim">還沒有商場。</p>}
      {props.ov.malls.map((m) => (
        <MallCard key={m.id} m={m} ov={props.ov} mine={props.mineIds.includes(m.id)} reload={props.reload} />
      ))}
    </div>
  );
}
