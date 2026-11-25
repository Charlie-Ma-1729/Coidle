import { useState } from "preact/hooks";
import { LEVELS, SPEED_PRESETS, ZONES } from "@coidle/shared";
import { adminApi, type AdminMall, type Overview } from "./adminApi";
import { Badge, Card, confirmBox, Drawer, Empty, Field, fmtDateFull, fmtMoney, Ico, promptBox, Section, Seg, Switch } from "./kit";
import { errMsg, openMall, spectateMall, toast } from "../store";
import { fullTimeText, lagDetail } from "../serverTime";

const FLAGS: { id: string; name: string }[] = [{ id: "feature:lease", name: "租賃功能" }, ...ZONES.map((z) => ({ id: `zone:${z.id}`, name: z.name }))];
type Filter = "all" | "online" | "sandbox";

function MallDrawer(props: { m: AdminMall; ov: Overview; mine: boolean; reload: () => Promise<void>; onClose: () => void }) {
  const { m } = props;
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
    <Drawer
      onClose={props.onClose}
      title={
        <>
          {m.name} {m.sandbox ? <Badge tone="amber">測試・獨立於世界</Badge> : null}
        </>
      }
      sub={`#${m.id}・建立於 ${fmtDateFull(m.created_at)}`}
    >
      <p class="ad-sub">
        商場時間 {fullTimeText(m.tick)}
        {m.lag === null ? "・測試商場，不受伺服器時間限制" : `・伺服器時間 ${fullTimeText(props.ov.serverTick)}・${m.lag > 0 ? `落後 ${lagDetail(m.lag)}${m.paused ? "（暫停中）" : ""}` : "已追上"}`}
      </p>
      <div class="ad-row">
        <button class="ad-btn pri" onClick={() => void spectateMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
          <Ico n="eye" />
          旁觀（唯讀）
        </button>
        {props.mine && (
          <button class="ad-btn" onClick={() => void openMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
            <Ico n="enter" />
            進入（以創辦人身分操作）
          </button>
        )}
      </div>

      <Section title="基本">
        <div class="ad-form">
          <Field label="等級">
            <select aria-label="等級" value={String(m.level)} onChange={(e) => void act(() => post("/level", { level: Number((e.target as HTMLSelectElement).value) }), "已調整等級")}>
              {LEVELS.map((l) => (
                <option key={l.level} value={l.level}>
                  Lv.{l.level}
                </option>
              ))}
            </select>
          </Field>
          <Field label="追趕速度">
            <select
              aria-label="追趕速度"
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v) void act(() => post("/clock", { speed: v }), "已調整追趕速度");
              }}
            >
              <option value="">選擇…</option>
              {SPEED_PRESETS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.mult}×）
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div class="ad-row">
          <button class="ad-btn sm" onClick={() => void act(() => post("/clock", { paused: true }), "已暫停")}>
            暫停時間
          </button>
          <button class="ad-btn sm" onClick={() => void act(() => post("/clock", { paused: false }), "已繼續")}>
            繼續時間
          </button>
          <button
            class="ad-btn sm"
            onClick={async () => {
              const name = await promptBox("新的商場名稱", m.name);
              if (name) void act(() => post("/rename", { name }), "已改名");
            }}
          >
            改名
          </button>
        </div>
        <div class="ad-row" style={{ alignItems: "flex-end" }}>
          <Field label="資金（¥）" hint={`目前 ${fmtMoney(m.funds)}`}>
            <input type="number" value={funds} onInput={(e) => setFunds((e.target as HTMLInputElement).value)} aria-label="資金" />
          </Field>
          <button class="ad-btn" onClick={() => void act(() => post("/funds", { funds: Number(funds) }), "已設定資金")}>
            設定資金
          </button>
        </div>
      </Section>

      <Section title="對這座商場發通知">
        <div class="ad-row" style={{ flexWrap: "nowrap" }}>
          <input type="text" style={{ flex: 1, width: "100%" }} maxLength={120} placeholder="通知內容（4–120 字）" value={notice} onInput={(e) => setNotice((e.target as HTMLInputElement).value)} />
          <button
            class="ad-btn"
            disabled={notice.trim().length < 4}
            onClick={() =>
              void act(async () => {
                await post("/notice", { text: notice.trim() });
                setNotice("");
              }, "已送出通知")
            }
          >
            送出
          </button>
        </div>
      </Section>

      <Section title={`成員（${m.members_list.length}）`}>
        <div class="ad-list">
          {m.members_list.map((x) => (
            <div class="ad-row" key={x.userId} style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--ad-line)" }}>
              <span>
                <b>{x.displayName}</b> {x.isOwner && <Badge tone="amber">創辦人</Badge>}
              </span>
              <span class="ad-row">
                {!x.isOwner && (
                  <button
                    class="ad-link"
                    onClick={async () => {
                      if (await confirmBox(`把「${x.displayName}」設為創辦人？`, "原本的創辦人會變成一般成員。")) void act(() => post("/owner", { userId: x.userId }), "已轉讓創辦人");
                    }}
                  >
                    設為創辦人
                  </button>
                )}
                <button
                  class="ad-link danger"
                  onClick={async () => {
                    if (await confirmBox(`把「${x.displayName}」移出商場？`, "", { danger: true, ok: "移出" })) void act(() => post(`/members/${x.userId}/remove`), "已移出");
                  }}
                >
                  移出
                </button>
              </span>
            </div>
          ))}
        </div>
        <div class="ad-row" style={{ flexWrap: "nowrap" }}>
          <select aria-label="加入成員" value={addId} onChange={(e) => setAddId((e.target as HTMLSelectElement).value)} style={{ flex: 1 }}>
            <option value="">加入成員…</option>
            {nonMembers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}（{u.username}）
              </option>
            ))}
          </select>
          <button
            class="ad-btn"
            disabled={!addId}
            onClick={() =>
              void act(async () => {
                await post("/members", { userId: Number(addId) });
                setAddId("");
              }, "已加入")
            }
          >
            加入
          </button>
        </div>
      </Section>

      <Section title="功能與區域">
        <p class="ad-sub">開啟＝強制開放、關閉＝強制關閉；沒設定過的依商場等級自動決定。</p>
        <div class="ad-flags">
          {FLAGS.map((f) => {
            const v = m.flags[f.id];
            return (
              <div class="ad-flag" key={f.id}>
                <span>
                  {f.name}
                  <small>{v === undefined ? "依等級" : v ? "強制開" : "強制關"}</small>
                </span>
                <Switch checked={v === true} onChange={(c) => void act(() => adminApi.post(`/malls/${m.id}/flags`, { flag: f.id, value: c }), `已更新 ${f.name}`)} />
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="危險區" danger>
        <div class="ad-row">
          <button
            class="ad-btn danger"
            onClick={async () => {
              if (await confirmBox(`解散「${m.name}」？`, "所有資料會刪除，無法復原。", { danger: true, ok: "解散" })) {
                void act(() => adminApi.post(`/malls/${m.id}/delete`), "已解散");
                props.onClose();
              }
            }}
          >
            解散商場
          </button>
        </div>
      </Section>
    </Drawer>
  );
}

/** 商場：列表、旁觀、進入；點「管理」開側欄調整時鐘、資金、等級、通知、成員、功能旗標、解散 */
export function MallsTab(props: { ov: Overview; mineIds: number[]; reload: () => Promise<void> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const malls = props.ov.malls.filter((m) => (filter === "online" ? m.online > 0 : filter === "sandbox" ? !!m.sandbox : true));
  const sel = props.ov.malls.find((m) => m.id === openId) ?? null;

  return (
    <>
      <div class="ad-row">
        <Seg
          value={filter}
          options={[
            ["all", `全部 ${props.ov.malls.length}`],
            ["online", `有人在場 ${props.ov.malls.filter((m) => m.online > 0).length}`],
            ["sandbox", `測試商場 ${props.ov.malls.filter((m) => m.sandbox).length}`],
          ]}
          onChange={setFilter}
        />
      </div>
      <Card>
        {malls.length === 0 ? (
          <Empty>沒有符合的商場。</Empty>
        ) : (
          <div class="ad-scroll">
            <table class="ad-table num cards">
              <thead>
                <tr>
                  <th>商場</th>
                  <th>成員</th>
                  <th class="r">等級</th>
                  <th class="r">資金</th>
                  <th class="r">遊戲日</th>
                  <th class="r">落後伺服器</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {malls.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div class="ad-cell-main">
                        <b>
                          {m.name}{" "}
                          {m.sandbox ? <Badge tone="amber">測試・獨立於世界</Badge> : null} {m.online > 0 && <Badge tone="green">{m.online} 人在場</Badge>}
                        </b>
                        <small>#{m.id}</small>
                      </div>
                    </td>
                    <td data-l="成員">
                      <div class="ad-cell-main">
                        <span>{m.members_list.map((x) => `${x.displayName}${x.isOwner ? "★" : ""}`).join("、") || "—"}</span>
                        <small>{m.members} 人</small>
                      </div>
                    </td>
                    <td class="r" data-l="等級">Lv.{m.level}</td>
                    <td class="r" data-l="資金">{fmtMoney(m.funds)}</td>
                    <td class="r" data-l="遊戲日">第 {m.day} 天</td>
                    <td class="r" data-l="落後伺服器">
                      {m.lag === null ? (
                        <span class="dim">獨立</span>
                      ) : m.lag > 0 ? (
                        <Badge tone={m.lag > 5 * 288 ? "red" : "amber"}>
                          {lagDetail(m.lag)}
                          {m.paused ? "・暫停" : ""}
                        </Badge>
                      ) : (
                        <span class="dim">已追上</span>
                      )}
                    </td>
                    <td class="act">
                      <button class="ad-btn pri sm" onClick={() => void spectateMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
                        <Ico n="eye" />
                        旁觀
                      </button>
                      {props.mineIds.includes(m.id) && (
                        <button class="ad-btn sm" onClick={() => void openMall(m.id).catch((e) => toast(errMsg(e), "error"))}>
                          <Ico n="enter" />
                          進入
                        </button>
                      )}
                      <button class="ad-btn sm" onClick={() => setOpenId(m.id)}>
                        <Ico n="tune" />
                        管理
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {sel && <MallDrawer key={sel.id} m={sel} ov={props.ov} mine={props.mineIds.includes(sel.id)} reload={props.reload} onClose={() => setOpenId(null)} />}
    </>
  );
}
