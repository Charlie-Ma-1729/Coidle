import { useEffect, useState } from "preact/hooks";
import { PERSONAS, type NpcOverride } from "@coidle/shared";
import { adminApi, type Overview } from "./adminApi";
import { Badge, Card, Drawer, Empty, Field, fmtDate, fmtMoney, Section, Switch } from "./kit";
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

const ACTION_NAMES: Record<string, string> = { poach: "搶客", propose: "邀請聯名", joint: "聯名活動", rescue: "送貨救援", end: "結束聯名", respond: "回覆邀請", retaliate: "回敬搶客" };

function NpcDrawer(props: { n: NpcRow; ov: Overview; reload: () => Promise<void>; onClose: () => void }) {
  const { n } = props;
  const o = n.override ?? {};
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
  const num = (label: string, key: keyof typeof f, hint?: string) => (
    <Field label={label} hint={hint}>
      <input type="number" step="any" value={f[key] as string} onInput={(e) => setF({ ...f, [key]: (e.target as HTMLInputElement).value })} />
    </Field>
  );

  return (
    <Drawer
      onClose={props.onClose}
      title={
        <>
          {n.entry.name} {n.override?.hidden && <Badge tone="red">已隱藏</Badge>} {n.override && !n.override.hidden && <Badge tone="amber">有調整</Badge>}
        </>
      }
      sub={`${n.publicKey}${n.expiresAt ? `・調整到 ${fmtDate(n.expiresAt)}` : ""}`}
    >
      {n.pending.length > 0 && (
        <Section title="聯名">
          <div class="ad-list">
            {n.pending.map((p) => (
              <div key={p.allianceId} class="ad-row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--ad-line)" }}>
                <span>
                  <Badge tone={p.kind === "active" ? "green" : "amber"}>{p.kind === "active" ? "生效中" : "邀請中"}</Badge> {p.name}
                </span>
                <span class="ad-row">
                  {p.kind === "invite" && (
                    <>
                      <button class="ad-link" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "respond", allianceId: p.allianceId, accept: true }), "已接受")}>
                        代為接受
                      </button>
                      <button class="ad-link" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "respond", allianceId: p.allianceId, accept: false }), "已婉拒")}>
                        代為婉拒
                      </button>
                    </>
                  )}
                  {p.kind === "active" && (
                    <>
                      <button class="ad-link" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "joint", allianceId: p.allianceId }), "已辦聯名活動")}>
                        辦聯名活動
                      </button>
                      <button class="ad-link danger" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, { action: "end", allianceId: p.allianceId }), "已結束")}>
                        結束
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="調整數字">
        <div class="ad-form">
          <Field label="改名" hint="留空＝原名">
            <input type="text" maxLength={30} value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} />
          </Field>
          {num("等級加減", "levelDelta")}
          {num("分數倍率", "scoreMult")}
          {num("營收倍率", "revenueMult")}
          {num("口碑加減", "repDelta")}
          {num("熱度加減", "heatDelta")}
          {num("出手頻率倍率", "activity", "0＝不出手")}
          {num("持續幾小時", "hours", "0＝不過期")}
        </div>
        <Switch checked={f.hidden} onChange={(v) => setF({ ...f, hidden: v })} label="暫時隱藏（名錄與排行都看不到）" />
        <div class="ad-row">
          <button class="ad-btn pri" onClick={() => void apply()}>
            套用調整
          </button>
          <button class="ad-btn" onClick={() => void run(() => adminApi.post(`/npc/${n.id}/clear`), "已恢復原樣")}>
            恢復原樣
          </button>
        </div>
      </Section>

      <Section title="手動出手">
        <p class="ad-sub">照一般規則；勾「忽略上限」可以略過冷卻、每日次數與對方的保護期（稽核紀錄會記下來）。</p>
        <div class="ad-form wide">
          <Field label="動作">
            <select value={act.action} onChange={(e) => setAct({ ...act, action: (e.target as HTMLSelectElement).value })} aria-label="動作">
              <option value="poach">搶客</option>
              <option value="propose">邀請聯名</option>
              <option value="rescue">送貨救援</option>
            </select>
          </Field>
          <Field label="對象">
            <select value={act.target} onChange={(e) => setAct({ ...act, target: (e.target as HTMLSelectElement).value })} aria-label="對象">
              <option value="">選擇商場…</option>
              {real.map((m) => (
                <option key={m.id} value={`m:${m.id}`}>
                  {m.name}（Lv.{m.level}）
                </option>
              ))}
            </select>
          </Field>
          {act.action === "poach" && (
            <Field label="客群">
              <select value={act.persona} onChange={(e) => setAct({ ...act, persona: (e.target as HTMLSelectElement).value })} aria-label="客群">
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Switch checked={act.ignoreLimits} onChange={(v) => setAct({ ...act, ignoreLimits: v })} label="忽略上限" />
        <div class="ad-row">
          <button class="ad-btn pri" disabled={!act.target} onClick={() => void run(() => adminApi.post(`/npc/${n.id}/act`, act), "已出手")}>
            出手
          </button>
        </div>
      </Section>

      {n.recent.length > 0 && (
        <Section title="最近動態">
          <div class="ad-list">
            {n.recent.map((r) => (
              <div class="ad-sub" key={r.id} style={{ padding: "4px 0" }}>
                {fmtDate(r.ts)}　{ACTION_NAMES[r.action] ?? r.action}
                {r.target ? ` → ${r.target}` : ""}
                {r.manual ? "（手動）" : ""}
              </div>
            ))}
          </div>
        </Section>
      )}
    </Drawer>
  );
}

function NpcCard(props: { n: NpcRow; onOpen: () => void }) {
  const { n } = props;
  return (
    <Card
      title={
        <>
          {n.entry.name} {n.override?.hidden && <Badge tone="red">已隱藏</Badge>} {n.override && !n.override.hidden && <Badge tone="amber">有調整</Badge>}
        </>
      }
      desc={`${n.publicKey}${n.expiresAt ? `・調整到 ${fmtDate(n.expiresAt)}` : ""}`}
      actions={
        <button class="ad-btn sm" onClick={props.onOpen}>
          調整與手動出手
        </button>
      }
    >
      <div class="ad-kv">
        <div>
          <span>等級</span>
          <b>Lv.{n.entry.level}</b>
        </div>
        <div>
          <span>綜合分數</span>
          <b>{n.entry.score.toFixed(1)}</b>
        </div>
        <div>
          <span>口碑</span>
          <b>{n.entry.localRep.toFixed(0)}</b>
        </div>
        <div>
          <span>熱度</span>
          <b>{n.entry.touristHeat.toFixed(0)}</b>
        </div>
        <div>
          <span>30 天營收</span>
          <b>{fmtMoney(n.entry.revenue30)}</b>
        </div>
        <div>
          <span>店數／缺貨</span>
          <b>
            {n.entry.shops}／{n.entry.stockouts}
          </b>
        </div>
      </div>
      <div class="ad-sub">
        24 小時內出手 {n.actions24h} 次
        {n.pending.length > 0 && `・聯名 ${n.pending.map((p) => `${p.kind === "active" ? "生效中" : "邀請中"} ${p.name}`).join("、")}`}
      </div>
    </Card>
  );
}

/** NPC 商場：全域開關與頻率、逐座調整、手動出手、動態紀錄（玩家在遊戲裡完全看不出誰是 NPC） */
export function NpcTab(props: { ov: Overview; reload: () => Promise<void> }) {
  const [list, setList] = useState<NpcList | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

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
  const reloadAll = async () => {
    await load();
    await props.reload();
  };

  if (!list) return <p class="ad-empty">載入中…</p>;
  const sel = list.npcs.find((x) => x.id === openId) ?? null;
  return (
    <>
      <Card title="NPC 自動出手" desc={`名錄裡的 NPC 商場和真人商場長得一模一樣（沒有任何標示）。它們會自己低機率出手（搶客、邀請聯名、辦聯名活動、送貨救援），也會回覆玩家的聯名邀請、偶爾回敬搶客，守的規則和玩家一樣。預設每座 NPC 約每 ${Math.round(1 / list.settings.baseProbPerHour)} 小時出手一次。`}>
        <div class="ad-row" style={{ gap: "22px" }}>
          <Switch checked={list.settings.auto} onChange={(v) => void settings({ auto: v })} label="開啟自動出手" />
          <Field label="全域頻率倍率" hint="0＝不出手，1＝預設，最高 5">
            <input type="number" min={0} max={5} step={0.5} value={list.settings.activity} onChange={(e) => void settings({ activity: Number((e.target as HTMLInputElement).value) })} style={{ width: "110px" }} />
          </Field>
        </div>
      </Card>

      <div class="ad-grid fit">
        {list.npcs.map((n) => (
          <NpcCard key={`${n.id}:${JSON.stringify(n.override)}`} n={n} onOpen={() => setOpenId(n.id)} />
        ))}
      </div>

      <Card title="NPC 動態" desc="自動與手動的出手紀錄，新的在前。">
        {actions.length === 0 ? (
          <Empty>還沒有 NPC 動態。</Empty>
        ) : (
          <div class="ad-list">
            {actions.map((a) => (
              <div class="ad-item" key={a.id}>
                <time>{fmtDate(a.ts)}</time>
                <div>
                  <b>{a.npcName}</b> <Badge tone={a.manual ? "pink" : undefined}>{ACTION_NAMES[a.action] ?? a.action}</Badge> {a.target && <span class="dim">→ {a.target}</span>}
                  <div class="ad-sub">
                    {a.detail}
                    {a.manual ? "（手動）" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {sel && <NpcDrawer key={`${sel.id}:${JSON.stringify(sel.override)}`} n={sel} ov={props.ov} reload={reloadAll} onClose={() => setOpenId(null)} />}
    </>
  );
}
