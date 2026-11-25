import { useEffect, useState } from "preact/hooks";
import { PERSONAS, WEATHER_NAMES } from "@coidle/shared";
import { adminApi, type Overview } from "./adminApi";
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

function FxEditor(props: { fx: Fx; onChange: (f: Fx) => void; onRemove?: () => void }) {
  const { fx } = props;
  const set = (p: Partial<Fx>) => props.onChange({ ...fx, ...p });
  const num = (k: keyof Fx, w = "80px", label?: string) => (
    <input type="number" step="any" aria-label={label ?? String(k)} value={fx[k]} onInput={(e) => set({ [k]: (e.target as HTMLInputElement).value } as Partial<Fx>)} style={{ width: w }} />
  );
  return (
    <div class="row small" style={{ flexWrap: "wrap", gap: "6px" }}>
      <select value={fx.type} onChange={(e) => set({ type: (e.target as HTMLSelectElement).value as FxType })} aria-label="效果類型">
        <option value="funds">資金（¥，可負）</option>
        <option value="index">口碑／熱度</option>
        <option value="traffic">客流倍率</option>
        <option value="cleanliness">整潔度</option>
      </select>
      {fx.type === "funds" && <>{num("amount", "110px", "金額")}（±60,000）</>}
      {fx.type === "index" && (
        <>
          <select value={fx.which} onChange={(e) => set({ which: (e.target as HTMLSelectElement).value as Fx["which"] })} aria-label="指標">
            <option value="localRep">在地口碑</option>
            <option value="touristHeat">觀光熱度</option>
          </select>
          {num("amount", "70px", "增減")}（±2）
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
          ×{num("mult", "60px", "倍率")}（0.8–1.5）{num("hours", "60px", "小時")} 遊戲小時
        </>
      )}
      {fx.type === "cleanliness" && <>{num("amount", "70px", "增減")}（±15）</>}
      {props.onRemove && (
        <button type="button" class="linklike small" onClick={props.onRemove}>
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
  const real = props.ov.malls;

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

  return (
    <div class="stack">
      <div class="card">
        <h3>寫一個隨機事件</h3>
        <p class="small dim">寫好就直接上線，之後會和內建事件一起隨機發生。數值有安全上限（資金 ±60,000、客流 ×0.8–1.5、口碑 ±2…），不需要像 AI 事件那樣有取捨——節慶可以只有好處。</p>
        <div class="stack">
          <input type="text" maxLength={18} placeholder="標題（3–18 字）" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <textarea rows={3} maxLength={130} placeholder="事件描述（20–130 字）" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          <div class="row small" style={{ flexWrap: "wrap" }}>
            <select value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)} aria-label="類別">
              {CATEGORIES.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <label>
              出現權重 <input type="number" step="0.1" min={0} max={3} value={weight} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} style={{ width: "60px" }} />
            </label>
            <label>
              冷卻（遊戲日） <input type="number" min={1} max={60} value={cooldownDays} onInput={(e) => setCooldownDays((e.target as HTMLInputElement).value)} style={{ width: "60px" }} />
            </label>
            <label>
              <input type="checkbox" checked={pause} onChange={(e) => setPause((e.target as HTMLInputElement).checked)} /> 沒人在場時暫停時鐘等人處理
            </label>
            <select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as "choice" | "notice")} aria-label="型態">
              <option value="choice">有選項（玩家要選）</option>
              <option value="notice">公告型（直接套用）</option>
            </select>
          </div>

          {mode === "choice" ? (
            opts.map((o, i) => (
              <div key={i} class="card" style={{ padding: "8px" }}>
                <input type="text" maxLength={30} placeholder={`選項 ${i + 1} 的文字（4–30 字）`} value={o.label} onInput={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, label: (e.target as HTMLInputElement).value } : x)))} />
                {o.fx.map((f, k) => (
                  <FxEditor
                    key={k}
                    fx={f}
                    onChange={(nf) => setOpts(opts.map((x, j) => (j === i ? { ...x, fx: x.fx.map((y, m) => (m === k ? nf : y)) } : x)))}
                    onRemove={o.fx.length > 1 ? () => setOpts(opts.map((x, j) => (j === i ? { ...x, fx: x.fx.filter((_, m) => m !== k) } : x))) : undefined}
                  />
                ))}
                <div class="row">
                  {o.fx.length < 2 && (
                    <button type="button" class="linklike small" onClick={() => setOpts(opts.map((x, j) => (j === i ? { ...x, fx: [...x.fx, newFx()] } : x)))}>
                      ＋ 再加一個效果
                    </button>
                  )}
                  {opts.length > 2 && (
                    <button type="button" class="linklike small" onClick={() => setOpts(opts.filter((_, j) => j !== i))}>
                      刪除這個選項
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div class="card" style={{ padding: "8px" }}>
              <p class="small dim">事件發生時直接套用（最多 3 個效果）：</p>
              {direct.map((f, k) => (
                <FxEditor key={k} fx={f} onChange={(nf) => setDirect(direct.map((y, m) => (m === k ? nf : y)))} onRemove={direct.length > 1 ? () => setDirect(direct.filter((_, m) => m !== k)) : undefined} />
              ))}
              {direct.length < 3 && (
                <button type="button" class="linklike small" onClick={() => setDirect([...direct, newFx()])}>
                  ＋ 再加一個效果
                </button>
              )}
            </div>
          )}
          {mode === "choice" && opts.length < 3 && (
            <button type="button" class="btn btn-ghost btn-sm" onClick={() => setOpts([...opts, { label: "", fx: [newFx()] }])}>
              ＋ 加第三個選項
            </button>
          )}
          <button class="btn btn-primary btn-sm" onClick={() => void create()} disabled={!title.trim() || !text.trim()}>
            上線
          </button>
        </div>
      </div>

      <div class="card">
        <h3>立刻觸發一個事件</h3>
        <div class="row" style={{ flexWrap: "wrap" }}>
          <select value={trigId} onChange={(e) => setTrigId((e.target as HTMLSelectElement).value)} aria-label="事件">
            <option value="">選擇事件…</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                [{SOURCE_NAME[c.source]}] {c.title}
              </option>
            ))}
          </select>
          <select value={trigTarget} onChange={(e) => setTrigTarget((e.target as HTMLSelectElement).value)} aria-label="對象">
            <option value="all">全部商場（不含測試商場）</option>
            {real.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.sandbox ? "（測試商場）" : ""}
              </option>
            ))}
          </select>
          <button class="btn btn-ghost btn-sm" disabled={!trigId} onClick={() => run(() => adminApi.post("/events/trigger", { eventId: trigId, malls: targets(trigTarget) }), "已觸發")}>
            觸發
          </button>
        </div>
      </div>

      <div class="card">
        <h3>調整天氣</h3>
        <p class="small dim">會取代商場原本的天氣一段時間（遊戲小時）；影響客流、各業態需求與畫面。</p>
        <div class="row" style={{ flexWrap: "wrap" }}>
          <select value={wKind} onChange={(e) => setWKind((e.target as HTMLSelectElement).value)} aria-label="天氣">
            {Object.entries(WEATHER_NAMES).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
          <label class="small">
            氣溫 <input type="number" min={-10} max={42} value={wTemp} onInput={(e) => setWTemp((e.target as HTMLInputElement).value)} style={{ width: "60px" }} /> °C
          </label>
          <label class="small">
            持續 <input type="number" min={1} max={72} value={wHours} onInput={(e) => setWHours((e.target as HTMLInputElement).value)} style={{ width: "60px" }} /> 遊戲小時
          </label>
          <select value={wTarget} onChange={(e) => setWTarget((e.target as HTMLSelectElement).value)} aria-label="天氣對象">
            <option value="all">全部商場（不含測試商場）</option>
            {real.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.sandbox ? "（測試商場）" : ""}
              </option>
            ))}
          </select>
          <button class="btn btn-primary btn-sm" onClick={() => run(() => adminApi.post("/weather", { kind: wKind, temp: Number(wTemp), hours: Number(wHours), malls: targets(wTarget) }), "天氣已更新")}>
            套用
          </button>
        </div>
      </div>

      <div class="card">
        <h3>事件清單（AI 與手寫的；內建事件 {catalog.filter((c) => c.source === "builtin").length} 個）</h3>
        <div class="log">
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <time>
                  #{r.id} {r.status}
                </time>
                <span>
                  <b>{r.def.title}</b> <span class="chip">{r.model === "overseer" ? "Overseer" : "AI"}</span> <span class="small dim">權重 {r.def.weight}・冷卻 {Math.round(r.def.cooldownTicks / 288)} 天・{r.def.choice ? `${r.def.choice.options.length} 個選項` : "公告型"}</span>
                  <br />
                  <span class="small">{r.def.text}</span>{" "}
                  {r.status === "active" && (
                    <button class="linklike small" onClick={() => void run(() => adminApi.post(`/events/${r.id}/retire`), "已下架")}>
                      下架
                    </button>
                  )}
                  {r.status === "retired" && (
                    <button class="linklike small" onClick={() => void run(() => adminApi.post(`/events/${r.id}/activate`), "已重新上線")}>
                      重新上線
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {rows.length === 0 && <p class="small dim">還沒有 AI 或手寫的事件。</p>}
      </div>
    </div>
  );
}
