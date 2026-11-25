import { useEffect, useState } from "preact/hooks";
import { PERSONAS, type NpcOverride } from "@coidle/shared";
import { adminApi, type Overview } from "./adminApi";
import { errMsg, toast } from "../store";

interface NpcRow {
  id: string;
  publicKey: string;
  baseName: string;
  entry: { name: string; level: number; stars: number; score: number; localRep: number; touristHeat: number; revenue30: number; shops: number; stockouts: number };
  override: NpcOverride | null;
  expiresAt: number;
  pending: { allianceId: number; kind: "invite" | "active"; with: string; name: string }[];
  actions24h: number;
  recent: ActionRow[];
}
interface ActionRow {
  id: number;
  ts: number;
  npcId: string;
  npcName: string;
  action: string;
  target: string;
  detail: string;
  manual: boolean;
}
interface NpcList {
  settings: { auto: boolean; activity: number; baseProbPerHour: number };
  npcs: NpcRow[];
}

const when = (ms: number) => new Date(ms).toLocaleString("zh-TW", { hour12: false });
const ACTION_NAMES: Record<string, string> = { poach: "搶客", propose: "邀請聯名", joint: "聯名活動", rescue: "送貨救援", end: "結束聯名", respond: "回覆邀請", retaliate: "回敬搶客" };

function NpcCard(props: { n: NpcRow; ov: Overview; reload: () => Promise<void> }) {
  const { n } = props;
  const o = n.override ?? {};
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: o.name ?? "",
    levelDelta: String(o.levelDelta ?? 0),
    scoreMult: String(o.scoreMult ?? 1),
    revenueMult: String(o.revenueMult ?? 1),
    repDelta: String(o.repDelta ?? 0),
    heatDelta: String(o.heatDelta ?? 0),
    activity: String(o.activity ?? 1),
    hidden: o.hidden === true,
    hours: "0",
  });
  const [act, setAct] = useState({ action: "poach", target: "", persona: "tourist", ignoreLimits: false });
  const real = props.ov.malls.filter((m) => !m.sandbox);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const r = (await fn()) as { message?: string } | undefined;
      toast(r?.message ?? ok, "ok");
      await props.reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const apply = () =>
    run(
      () =>
        adminApi.post(`/npc/${n.id}/override`, {
          override: { name: f.name, levelDelta: Number(f.levelDelta), scoreMult: Number(f.scoreMult), revenueMult: Number(f.revenueMult), repDelta: Number(f.repDelta), heatDelta: Number(f.heatDelta), activity: Number(f.activity), hidden: f.hidden },
          hours: Number(f.hours),
        }),
      "已套用",
    );
  const field = (label: string, key: keyof typeof f, w = "90px") => (
    <label class="small" style={{ display: "inline-flex", flexDirection: "column", gap: "2px" }}>
      {label}
      <input type="number" step="any" value={f[key] as string} onInput={(e) => setF({ ...f, [key]: (e.target as HTMLInputElement).value })} style={{ width: w }} />
    </label>
  );

  return (
    <div class="card">
      <h3>
        {n.entry.name} <span class="small dim">（{n.publicKey}）</span> {n.override?.hidden && <span class="chip chip-red">已隱藏</span>} {n.override && !n.override.hidden && <span class="chip chip-amber">有調整{n.expiresAt ? `・到 ${when(n.expiresAt)}` : ""}</span>}
      </h3>
      <p class="small">
        Lv.{n.entry.level}・綜合 {n.entry.score.toFixed(1)}・口碑 {n.entry.localRep.toFixed(0)}・熱度 {n.entry.touristHeat.toFixed(0)}・30 天營收 {Math.round(n.entry.revenue30 / 10000)} 萬・{n.entry.shops} 間店・缺貨 {n.entry.stockouts}・24 小時內出手 {n.actions24h} 次
      </p>
      {n.pending.length > 0 && (
        <div class="small">
          聯名：
          {n.pending.map((p) => (
            <span key={p.allianceId} style={{ marginRight: "10px" }}>
              {p.kind === "active" ? "生效中" : "邀請中"}・{p.name}
              {p.kind === "invite" && (
                <>
                  {" "}
                  <button class="linklike small" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "respond", allianceId: p.allianceId, accept: true }), "已接受")}>
                    代為接受
                  </button>{" "}
                  <button class="linklike small" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "respond", allianceId: p.allianceId, accept: false }), "已婉拒")}>
                    代為婉拒
                  </button>
                </>
              )}
              {p.kind === "active" && (
                <>
                  {" "}
                  <button class="linklike small" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "joint", allianceId: p.allianceId }), "已辦聯名活動")}>
                    辦聯名活動
                  </button>{" "}
                  <button class="linklike small" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "end", allianceId: p.allianceId }), "已結束")}>
                    結束
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
      )}
      {n.recent.length > 0 && (
        <p class="small dim">
          最近：{n.recent.map((r) => `${when(r.ts)} ${ACTION_NAMES[r.action] ?? r.action}${r.target ? `→${r.target}` : ""}${r.manual ? "（手動）" : ""}`).join("；")}
        </p>
      )}
      <button class="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
        {open ? "收起" : "調整與手動出手"}
      </button>

      {open && (
        <div class="stack" style={{ marginTop: "10px" }}>
          <div class="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <label class="small" style={{ display: "inline-flex", flexDirection: "column", gap: "2px" }}>
              改名（留空＝原名）
              <input type="text" maxLength={30} value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} style={{ width: "170px" }} />
            </label>
            {field("等級加減", "levelDelta")}
            {field("分數倍率", "scoreMult")}
            {field("營收倍率", "revenueMult")}
            {field("口碑加減", "repDelta")}
            {field("熱度加減", "heatDelta")}
            {field("出手頻率倍率", "activity", "110px")}
            {field("持續幾小時（0＝不過期）", "hours", "150px")}
            <label class="small" style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
              <input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: (e.target as HTMLInputElement).checked })} />
              暫時隱藏
            </label>
          </div>
          <div class="row">
            <button class="btn btn-primary btn-sm" onClick={() => void apply()}>
              套用調整
            </button>
            <button class="btn btn-ghost btn-sm" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/clear`), "已恢復原樣")}>
              恢復原樣
            </button>
          </div>

          <p class="small dim">手動出手：照一般規則；勾「忽略上限」可以略過冷卻、每日次數與對方的保護期（稽核紀錄會記下來）。</p>
          <div class="row" style={{ flexWrap: "wrap" }}>
            <select value={act.action} onChange={(e) => setAct({ ...act, action: (e.target as HTMLSelectElement).value })} aria-label="動作">
              <option value="poach">搶客</option>
              <option value="propose">邀請聯名</option>
              <option value="rescue">送貨救援</option>
            </select>
            <select value={act.target} onChange={(e) => setAct({ ...act, target: (e.target as HTMLSelectElement).value })} aria-label="對象">
              <option value="">選擇商場…</option>
              {real.map((m) => (
                <option key={m.id} value={`m:${m.id}`}>
                  {m.name}（Lv.{m.level}）
                </option>
              ))}
            </select>
            {act.action === "poach" && (
              <select value={act.persona} onChange={(e) => setAct({ ...act, persona: (e.target as HTMLSelectElement).value })} aria-label="客群">
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <label class="small" style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
              <input type="checkbox" checked={act.ignoreLimits} onChange={(e) => setAct({ ...act, ignoreLimits: (e.target as HTMLInputElement).checked })} />
              忽略上限
            </label>
            <button class="btn btn-ghost btn-sm" disabled={!act.target} onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, act), "已出手")}>
              出手
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** NPC 商場：全域開關與頻率、逐座調整、手動出手、動態紀錄（玩家在遊戲裡完全看不出誰是 NPC） */
export function NpcTab(props: { ov: Overview; reload: () => Promise<void> }) {
  const [list, setList] = useState<NpcList | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);

  const load = async () => {
    try {
      setList(await adminApi.get<NpcList>("/npc"));
      setActions((await adminApi.get<{ actions: ActionRow[] }>("/npc/actions?limit=40")).actions);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const settings = async (patch: { auto?: boolean; activity?: number }) => {
    try {
      await adminApi.post("/npc/settings", patch);
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  if (!list) return <p class="small dim">載入中…</p>;
  return (
    <div class="stack">
      <div class="card">
        <h3>NPC 自動出手</h3>
        <p class="small dim">
          名錄裡的 NPC 商場和真人商場長得一模一樣（沒有任何標示）。它們會自己低機率出手（搶客、邀請聯名、辦聯名活動、送貨救援），也會回覆玩家的聯名邀請、偶爾回敬搶客，守的規則和玩家一樣。預設每座 NPC 約每 {Math.round(1 / list.settings.baseProbPerHour)} 小時出手一次。
        </p>
        <div class="row" style={{ flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
            <input type="checkbox" checked={list.settings.auto} onChange={(e) => void settings({ auto: (e.target as HTMLInputElement).checked })} />
            開啟自動出手
          </label>
          <label class="small" style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
            全域頻率倍率
            <input type="number" min={0} max={5} step={0.5} value={list.settings.activity} onChange={(e) => void settings({ activity: Number((e.target as HTMLInputElement).value) })} style={{ width: "80px" }} />
            （0＝不出手，1＝預設，最高 5）
          </label>
        </div>
      </div>

      {list.npcs.map((n) => (
        <NpcCard key={`${n.id}:${JSON.stringify(n.override)}`} n={n} ov={props.ov} reload={async () => { await load(); await props.reload(); }} />
      ))}

      <div class="card">
        <h3>NPC 動態</h3>
        {actions.length === 0 && <p class="small dim">還沒有 NPC 動態。</p>}
        <div class="log">
          <ul>
            {actions.map((a) => (
              <li key={a.id}>
                <time>{when(a.ts)}</time>
                <span>
                  <b>{a.npcName}</b> {ACTION_NAMES[a.action] ?? a.action} {a.target && <span class="dim">→ {a.target}</span>} <span class="small dim">{a.detail}{a.manual ? "（手動）" : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
