import { useEffect, useState } from "preact/hooks";
import { PERSONAS, SHOCK_KINDS, SHOCK_KIND_ORDER, SUPPLIERS, SUPPLY_FAMILIES, WEATHER_NAMES, type ShockKind } from "@coidle/shared";
import type { ComponentChildren } from "preact";
import { fullTimeText } from "../serverTime";
import { adminApi, type Overview } from "./adminApi";
import { Badge, Card, Empty, Field, Ico, Seg, Switch, type IconName } from "./kit";
import { errMsg, toast } from "../store";

interface EventRow {
  id: number;
  status: string;
  model: string | null;
  createdAt: number;
  def: { id: string; title: string; text: string; category: string; weight: number; cooldownTicks: number; choice?: { options: { label: string; effects: unknown[] }[] } };
}
interface Catalog {
  id: string;
  title: string;
  category: string;
  hasChoice: boolean;
  source: "builtin" | "ai" | "overseer";
}

type FxType = "funds" | "index" | "traffic" | "cleanliness";
interface Fx {
  type: FxType;
  amount: string;
  which: "localRep" | "touristHeat";
  persona: string;
  mult: string;
  hours: string;
}
const newFx = (): Fx => ({ type: "funds", amount: "0", which: "localRep", persona: "all", mult: "1.2", hours: "12" });
interface Opt {
  label: string;
  fx: Fx[];
}
const toEffect = (f: Fx): unknown => {
  switch (f.type) {
    case "funds":
      return { t: "funds", amount: Number(f.amount) };
    case "index":
      return { t: "index", which: f.which, amount: Number(f.amount) };
    case "traffic":
      return { t: "traffic", persona: f.persona, mult: Number(f.mult), ticks: Math.round(Number(f.hours) * 12) };
    default:
      return { t: "cleanliness", amount: Number(f.amount) };
  }
};

const CATEGORIES: [string, string][] = [
  ["crowd", "客流"],
  ["facility", "設施"],
  ["luck", "好運"],
  ["market", "市場"],
  ["festival", "節慶"],
];
const SOURCE_NAME = { builtin: "內建", ai: "AI", overseer: "Overseer" } as const;
const WEATHER_ICON: Record<string, IconName> = { clear: "clear", cloudy: "cloudy", rain: "rain", storm: "storm" };

interface ShockRow {
  id: string;
  supplierId: string;
  supplier: string;
  family: string;
  kind: ShockKind;
  label: string;
  icon: string;
  warnTick: number;
  startTick: number;
  endTick: number;
  fill: number;
  priceMult: number | null;
  phase: "scheduled" | "warning" | "live";
}
const PHASE_NAME = { scheduled: "排程中", warning: "預告中", live: "進行中" } as const;

/** 全服供應衝擊：看排程（伺服器 tick 的純函式，所有商場一致）、手動對某家供應商加一段衝擊 */
function SupplyShockCard(props: { targetOptions: ComponentChildren; targets: (v: string) => "all" | number[]; onDone: () => void }) {
  const [tick, setTick] = useState(0);
  const [rows, setRows] = useState<ShockRow[]>([]);
  const [supplierId, setSupplierId] = useState(SUPPLIERS[0]!.id);
  const [kind, setKind] = useState<ShockKind>("strike");
  const [days, setDays] = useState("3");
  const [fill, setFill] = useState(String(SHOCK_KINDS.strike.fill[0]));
  const [target, setTarget] = useState("all");
  const load = async () => {
    try {
      const r = await adminApi.get<{ tick: number; shocks: ShockRow[] }>("/supply-shocks");
      setTick(r.tick ?? 0);
      setRows(r.shocks ?? []);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const trigger = async () => {
    try {
      await adminApi.post("/supply-shocks/trigger", { supplierId, kind, days: Number(days), fill: Number(fill), malls: props.targets(target) });
      toast("已對所選商場加上供應衝擊", "ok");
      await load();
      props.onDone();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Card title="全服供應衝擊" desc="排程由伺服器時間決定，所有商場同步發生（預告→生效→結束）。下面可以手動對某家供應商加一段衝擊。">
      {rows.length === 0 ? (
        <Empty>近期沒有排定的供應衝擊。</Empty>
      ) : (
        <div class="ad-list">
          {rows.map((r) => (
            <div key={r.id} class="ad-row">
              <span>
                {r.icon} <b>{r.supplier}</b>（{r.family}）{r.label}
                {r.priceMult ? ` ×${r.priceMult}` : ` 供貨 ${Math.round(r.fill * 100)}%`}
              </span>
              <span class="ad-spacer" />
              <Badge>{PHASE_NAME[r.phase]}</Badge>
              <span class="ad-sub">
                {fullTimeText(r.startTick)} ～ {fullTimeText(r.endTick)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p class="ad-sub">伺服器目前 tick：{tick}</p>
      <div class="ad-form">
        <Field label="供應商">
          <select value={supplierId} onChange={(e) => setSupplierId((e.target as HTMLSelectElement).value)} aria-label="供應商">
            {SUPPLIERS.map((d) => (
              <option key={d.id} value={d.id}>
                {SUPPLY_FAMILIES[d.family].name}・{d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="種類">
          <select
            value={kind}
            onChange={(e) => {
              const k = (e.target as HTMLSelectElement).value as ShockKind;
              setKind(k);
              setFill(String(SHOCK_KINDS[k].fill[0]));
            }}
            aria-label="衝擊種類"
          >
            {SHOCK_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {SHOCK_KINDS[k].icon} {SHOCK_KINDS[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="持續（遊戲日）">
          <input type="number" min={1} max={10} value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="基礎供貨比例（0–1）">
          <input type="number" min={0} max={1} step={0.05} value={fill} onInput={(e) => setFill((e.target as HTMLInputElement).value)} />
        </Field>
      </div>
      <Field label="對象">
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)} aria-label="衝擊對象">
          {props.targetOptions}
        </select>
      </Field>
      <div class="ad-row end">
        <button class="ad-btn" onClick={() => void trigger()}>
          加上衝擊
        </button>
      </div>
    </Card>
  );
}

function FxEditor(props: { fx: Fx; onChange: (f: Fx) => void; onRemove?: () => void }) {
  const { fx } = props;
  const set = (p: Partial<Fx>) => props.onChange({ ...fx, ...p });
  const num = (k: keyof Fx, w: string, label: string) => <input type="number" step="any" aria-label={label} value={fx[k]} onInput={(e) => set({ [k]: (e.target as HTMLInputElement).value } as Partial<Fx>)} style={{ width: w }} />;
  return (
    <div class="ad-fx">
      <select value={fx.type} onChange={(e) => set({ type: (e.target as HTMLSelectElement).value as FxType })} aria-label="效果類型">
        <option value="funds">資金（¥，可負）</option>
        <option value="index">口碑／熱度</option>
        <option value="traffic">客流倍率</option>
        <option value="cleanliness">整潔度</option>
      </select>
      {fx.type === "funds" && (
        <>
          {num("amount", "110px", "金額")}
          <span class="ad-sub">±60,000</span>
        </>
      )}
      {fx.type === "index" && (
        <>
          <select value={fx.which} onChange={(e) => set({ which: (e.target as HTMLSelectElement).value as Fx["which"] })} aria-label="指標">
            <option value="localRep">在地口碑</option>
            <option value="touristHeat">觀光熱度</option>
          </select>
          {num("amount", "72px", "增減")}
          <span class="ad-sub">±2</span>
        </>
      )}
      {fx.type === "traffic" && (
        <>
          <select value={fx.persona} onChange={(e) => set({ persona: (e.target as HTMLSelectElement).value })} aria-label="客群">
            <option value="all">所有客人</option>
            {PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          ×{num("mult", "64px", "倍率")}
          <span class="ad-sub">0.8–1.5</span>
          {num("hours", "64px", "小時")}
          <span class="ad-sub">遊戲小時</span>
        </>
      )}
      {fx.type === "cleanliness" && (
        <>
          {num("amount", "72px", "增減")}
          <span class="ad-sub">±15</span>
        </>
      )}
      {props.onRemove && (
        <button type="button" class="ad-link danger" onClick={props.onRemove}>
          移除效果
        </button>
      )}
    </div>
  );
}

/** 隨機事件（手寫、上下架、對商場觸發）與天氣 */
export function EventsTab(props: { ov: Overview }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const malls = props.ov.malls;

  // 編輯器
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("festival");
  const [weight, setWeight] = useState("1");
  const [cooldownDays, setCooldownDays] = useState("8");
  const [pause, setPause] = useState(false);
  const [mode, setMode] = useState<"choice" | "notice">("choice");
  const [opts, setOpts] = useState<Opt[]>([
    { label: "", fx: [newFx()] },
    { label: "", fx: [newFx()] },
  ]);
  const [direct, setDirect] = useState<Fx[]>([newFx()]);

  // 觸發
  const [trigId, setTrigId] = useState("");
  const [trigTarget, setTrigTarget] = useState("all");
  // 天氣
  const [wKind, setWKind] = useState("rain");
  const [wTemp, setWTemp] = useState("22");
  const [wHours, setWHours] = useState("12");
  const [wTarget, setWTarget] = useState("all");

  const load = async () => {
    try {
      const r = await adminApi.get<{ events: EventRow[]; catalog: Catalog[] }>("/events");
      setRows(r.events);
      setCatalog(r.catalog);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "ok");
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const targets = (v: string): "all" | number[] => (v === "all" ? "all" : [Number(v)]);

  const create = () =>
    run(
      () =>
        adminApi.post("/events", {
          event: {
            title,
            text,
            category,
            weight: Number(weight),
            cooldownDays: Number(cooldownDays),
            attention: pause ? "pause" : "auto",
            ...(mode === "choice" ? { options: opts.map((o) => ({ label: o.label, effects: o.fx.map(toEffect) })) } : { effects: direct.map(toEffect) }),
          },
        }),
      "事件已上線",
    );

  const targetOptions = (
    <>
      <option value="all">全部商場（不含測試商場）</option>
      {malls.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
          {m.sandbox ? "（測試商場）" : ""}
        </option>
      ))}
    </>
  );

  return (
    <>
      <div class="ad-split">
        <Card title="寫一個隨機事件" desc="寫好就直接上線，之後會和內建事件一起隨機發生。數值有安全上限（資金 ±60,000、客流 ×0.8–1.5、口碑 ±2…），不需要像 AI 事件那樣有取捨——節慶可以只有好處。">
          <Field label="標題">
            <input type="text" maxLength={18} placeholder="標題（3–18 字）" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="描述">
            <textarea rows={3} maxLength={130} placeholder="事件描述（20–130 字）" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          </Field>
          <div class="ad-form">
            <Field label="類別">
              <select value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)} aria-label="類別">
                {CATEGORIES.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="出現權重" hint="0–3，越大越常出現">
              <input type="number" step="0.1" min={0} max={3} value={weight} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="冷卻（遊戲日）" hint="同一個事件多久才會再出現">
              <input type="number" min={1} max={60} value={cooldownDays} onInput={(e) => setCooldownDays((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
          <Switch checked={pause} onChange={setPause} label="沒人在場時暫停時鐘，等人處理" />
          <Seg value={mode} options={[["choice", "有選項（玩家要選）"], ["notice", "公告型（直接套用）"]]} onChange={setMode} />

          {mode === "choice" ? (
            opts.map((o, i) => (
              <div key={i} class="ad-opt">
                <input type="text" style={{ width: "100%" }} maxLength={30} placeholder={`選項 ${i + 1} 的文字（4–30 字）`} value={o.label} onInput={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, label: (e.target as HTMLInputElement).value } : x)))} />
                {o.fx.map((f, k) => (
                  <FxEditor
                    key={k}
                    fx={f}
                    onChange={(nf) => setOpts(opts.map((x, j) => (j === i ? { ...x, fx: x.fx.map((y, m) => (m === k ? nf : y)) } : x)))}
                    onRemove={o.fx.length > 1 ? () => setOpts(opts.map((x, j) => (j === i ? { ...x, fx: x.fx.filter((_, m) => m !== k) } : x))) : undefined}
                  />
                ))}
                <div class="ad-row">
                  {o.fx.length < 2 && (
                    <button type="button" class="ad-link" onClick={() => setOpts(opts.map((x, j) => (j === i ? { ...x, fx: [...x.fx, newFx()] } : x)))}>
                      ＋ 再加一個效果
                    </button>
                  )}
                  {opts.length > 2 && (
                    <button type="button" class="ad-link danger" onClick={() => setOpts(opts.filter((_, j) => j !== i))}>
                      刪除這個選項
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div class="ad-opt">
              <p class="ad-sub">事件發生時直接套用（最多 3 個效果）：</p>
              {direct.map((f, k) => (
                <FxEditor key={k} fx={f} onChange={(nf) => setDirect(direct.map((y, m) => (m === k ? nf : y)))} onRemove={direct.length > 1 ? () => setDirect(direct.filter((_, m) => m !== k)) : undefined} />
              ))}
              {direct.length < 3 && (
                <div class="ad-row">
                  <button type="button" class="ad-link" onClick={() => setDirect([...direct, newFx()])}>
                    ＋ 再加一個效果
                  </button>
                </div>
              )}
            </div>
          )}
          <div class="ad-row">
            {mode === "choice" && opts.length < 3 && (
              <button type="button" class="ad-btn sm" onClick={() => setOpts([...opts, { label: "", fx: [newFx()] }])}>
                ＋ 加第三個選項
              </button>
            )}
            <span class="ad-spacer" />
            <button class="ad-btn pri" onClick={() => void create()} disabled={!title.trim() || !text.trim()}>
              上線
            </button>
          </div>
        </Card>

        <div class="ad-grid">
          <Card title="調整天氣" desc="會取代商場原本的天氣一段時間（遊戲小時）；影響客流、各業態需求與畫面。">
            <div class="ad-weather" role="group" aria-label="天氣">
              {Object.entries(WEATHER_NAMES).map(([k, n]) => (
                <button key={k} type="button" class={wKind === k ? "on" : ""} onClick={() => setWKind(k)} aria-pressed={wKind === k}>
                  <Ico n={WEATHER_ICON[k] ?? "clear"} />
                  {n}
                </button>
              ))}
            </div>
            <div class="ad-form">
              <Field label="氣溫 °C">
                <input type="number" min={-10} max={42} value={wTemp} onInput={(e) => setWTemp((e.target as HTMLInputElement).value)} />
              </Field>
              <Field label="持續（遊戲小時）">
                <input type="number" min={1} max={72} value={wHours} onInput={(e) => setWHours((e.target as HTMLInputElement).value)} />
              </Field>
            </div>
            <Field label="對象">
              <select value={wTarget} onChange={(e) => setWTarget((e.target as HTMLSelectElement).value)} aria-label="天氣對象">
                {targetOptions}
              </select>
            </Field>
            <div class="ad-row end">
              <button class="ad-btn pri" onClick={() => void run(() => adminApi.post("/weather", { kind: wKind, temp: Number(wTemp), hours: Number(wHours), malls: targets(wTarget) }), "天氣已更新")}>
                套用
              </button>
            </div>
          </Card>

          <SupplyShockCard targetOptions={targetOptions} targets={targets} onDone={() => void load()} />

          <Card title="立刻觸發一個事件" desc="任何事件（內建、AI、手寫）都能對指定商場立刻發生。">
            <Field label="事件">
              <select value={trigId} onChange={(e) => setTrigId((e.target as HTMLSelectElement).value)} aria-label="事件">
                <option value="">選擇事件…</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{SOURCE_NAME[c.source]}] {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="對象">
              <select value={trigTarget} onChange={(e) => setTrigTarget((e.target as HTMLSelectElement).value)} aria-label="對象">
                {targetOptions}
              </select>
            </Field>
            <div class="ad-row end">
              <button class="ad-btn" disabled={!trigId} onClick={() => void run(() => adminApi.post("/events/trigger", { eventId: trigId, malls: targets(trigTarget) }), "已觸發")}>
                觸發
              </button>
            </div>
          </Card>
        </div>
      </div>

      <Card title="事件清單" desc={`AI 與手寫的事件；內建事件 ${catalog.filter((c) => c.source === "builtin").length} 個不列在這裡。`}>
        {rows.length === 0 ? (
          <Empty>還沒有 AI 或手寫的事件。</Empty>
        ) : (
          <div class="ad-list">
            {rows.map((r) => (
              <div class="ad-item" key={r.id}>
                <time>
                  #{r.id}　<Badge tone={r.status === "active" ? "green" : r.status === "pending" ? "amber" : undefined}>{r.status}</Badge>
                </time>
                <div>
                  <b>{r.def.title}</b> <Badge tone={r.model === "overseer" ? "pink" : "cyan"}>{r.model === "overseer" ? "Overseer" : "AI"}</Badge>{" "}
                  <span class="ad-sub">
                    權重 {r.def.weight}・冷卻 {Math.round(r.def.cooldownTicks / 288)} 天・{r.def.choice ? `${r.def.choice.options.length} 個選項` : "公告型"}
                  </span>
                  <div class="ad-sub" style={{ color: "var(--text)", marginTop: "2px" }}>
                    {r.def.text}
                  </div>
                  <div class="ad-row" style={{ marginTop: "4px" }}>
                    {r.status === "active" && (
                      <button class="ad-link danger" onClick={() => void run(() => adminApi.post(`/events/${r.id}/retire`), "已下架")}>
                        下架
                      </button>
                    )}
                    {r.status === "retired" && (
                      <button class="ad-link" onClick={() => void run(() => adminApi.post(`/events/${r.id}/activate`), "已重新上線")}>
                        重新上線
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
