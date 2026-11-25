import { useEffect, useState } from "preact/hooks";
import { adminApi } from "./adminApi";
import { errMsg, toast } from "../store";

interface AiStatus {
  enabled: boolean;
  model: string;
  budget: { windowStart: string; windowEnd: string; spentUsd: number; capUsd: number; remainingUsd: number; calls24h: number; spent24hUsd: number };
  pool: { news: number; review: number; eventActive: number; eventPending: number; brand: number; dish: number; regularActive: number; regularPending: number };
  recent: { ts: number; purpose: string; model: string; cost_usd: number; ok: number; note: string | null }[];
}
interface PoolItem {
  id: number;
  kind: string;
  status: string;
  payload: {
    title?: string;
    text?: string;
    mood?: string;
    tier?: string;
    name?: string;
    blurb?: string;
    group?: string;
    persona?: string;
    fav?: string;
    alt?: string;
    hint?: string;
    bio?: string;
    traits?: string[];
    stories?: { title: string; text: string }[];
    choice?: { options: { label: string; effects: unknown }[] };
  };
  created_at: number;
}


const date = (ms: number) => new Date(ms).toLocaleString("zh-TW", { hour12: false });
const usd = (n: number) => `$${n.toFixed(4)}`;

/** AI 內容：預算與內容池、立即生成、待審事件與新常客、已上線內容的移除 */
export function AiTab() {
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [events, setEvents] = useState<PoolItem[]>([]);
  const [texts, setTexts] = useState<PoolItem[]>([]);
  const [regulars, setRegulars] = useState<PoolItem[]>([]);

  const load = async () => {
    try {
      setAi(await adminApi.get<AiStatus>("/ai/status"));
      setEvents((await adminApi.get<{ items: PoolItem[] }>("/ai/items?kind=event")).items);
      setTexts((await adminApi.get<{ items: PoolItem[] }>("/ai/items?status=active")).items.filter((x) => x.kind !== "event" && x.kind !== "regular"));
      setRegulars((await adminApi.get<{ items: PoolItem[] }>("/ai/items?kind=regular")).items);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "ok");
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  if (!ai) return <p class="small dim">載入中…</p>;
  return (
            <>
              <div class="card">
                <h3>預算與內容池</h3>
                <p class="small">
                  模型：{ai.model}・視窗 {ai.budget.windowStart.slice(0, 10)} → {ai.budget.windowEnd.slice(0, 10)}
                </p>
                <p class="small">
                  已花 {usd(ai.budget.spentUsd)}／可用上限 {usd(ai.budget.capUsd)}・剩 {usd(ai.budget.remainingUsd)}・最近 24 小時 {ai.budget.calls24h} 次（{usd(ai.budget.spent24hUsd)}）
                </p>
                <p class="small">
                  快訊 {ai.pool.news}・評價 {ai.pool.review}・事件 上線 {ai.pool.eventActive}／待審 {ai.pool.eventPending}
                </p>
                <p class="small">
                  品牌名 {ai.pool.brand}・商品名 {ai.pool.dish}・新常客 上線 {ai.pool.regularActive}／待審 {ai.pool.regularPending}
                </p>
                <div class="row" style={{ flexWrap: "wrap" }}>
                  {(["news", "review", "event", "brand", "dish", "regular"] as const).map((k) => (
                    <button key={k} class="btn btn-ghost btn-sm" disabled={!ai.enabled} onClick={() => act(() => adminApi.post("/ai/generate", { kind: k }), `已生成${k}`)}>
                      立即生成{{ news: "快訊", review: "評價", event: "事件", brand: "品牌名", dish: "商品名", regular: "常客" }[k]}
                    </button>
                  ))}
                </div>
                <div class="log">
                  <ul>
                    {ai.recent.map((r, i) => (
                      <li key={i}>
                        <time>{date(r.ts)}</time>
                        <span>
                          {r.purpose} {usd(r.cost_usd)} {r.ok ? "✓" : "✗"} {r.note ?? ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div class="card">
                <h3>事件審核</h3>
                {events.filter((e) => e.status === "pending").length === 0 && <p class="small dim">沒有待審的事件。</p>}
                {events
                  .filter((e) => e.status === "pending" || e.status === "active")
                  .map((e) => (
                    <div key={e.id} style={{ marginBottom: "10px" }}>
                      <b>
                        #{e.id} 《{e.payload.title}》 <span class="chip">{e.status === "pending" ? "待審" : "上線中"}</span>
                      </b>
                      <p class="small">{e.payload.text}</p>
                      {e.payload.choice?.options.map((o, i) => (
                        <p class="small dim" key={i}>
                          - {o.label} → {JSON.stringify(o.effects)}
                        </p>
                      ))}
                      <div class="row">
                        {e.status === "pending" && (
                          <button class="btn btn-primary btn-sm" onClick={() => act(() => adminApi.post(`/ai/events/${e.id}/approve`), "已核准上線")}>
                            核准
                          </button>
                        )}
                        <button class="btn btn-ghost btn-sm" onClick={() => act(() => adminApi.post(`/ai/events/${e.id}/reject`), e.status === "pending" ? "已拒絕" : "已下架")}>
                          {e.status === "pending" ? "拒絕" : "下架"}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              <div class="card">
                <h3>新常客審核</h3>
                {regulars.filter((e) => e.status === "pending" || e.status === "active").length === 0 && <p class="small dim">沒有待審或上線中的新常客。</p>}
                {regulars
                  .filter((e) => e.status === "pending" || e.status === "active")
                  .map((e) => (
                    <div key={e.id} style={{ marginBottom: "10px" }}>
                      <b>
                        #{e.id} {e.payload.name} <span class="chip">{e.status === "pending" ? "待審" : "上線中"}</span>
                      </b>
                      <p class="small dim">
                        {e.payload.persona}・愛 {e.payload.fav}
                        {e.payload.alt ? `（次選 ${e.payload.alt}）` : ""}
                      </p>
                      <p class="small">線索：{e.payload.hint}</p>
                      <p class="small">{e.payload.bio}</p>
                      <p class="small dim">特質：{e.payload.traits?.join("、")}</p>
                      {e.payload.stories?.map((st, i) => (
                        <p class="small dim" key={i}>
                          故事 {i + 1}《{st.title}》{st.text}
                        </p>
                      ))}
                      {e.status === "pending" && (
                        <div class="row">
                          <button class="btn btn-primary btn-sm" onClick={() => act(() => adminApi.post(`/ai/events/${e.id}/approve`), "已核准上線")}>
                            核准
                          </button>
                          <button class="btn btn-ghost btn-sm" onClick={() => act(() => adminApi.post(`/ai/events/${e.id}/reject`), "已拒絕")}>
                            拒絕
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              <div class="card">
                <h3>快訊、評價、品牌名與商品名（上線中，可移除）</h3>
                <div class="log">
                  <ul>
                    {texts.slice(0, 40).map((x) => (
                      <li key={x.id}>
                        <time>
                          #{x.id} {x.kind === "news" ? x.payload.mood : x.kind === "review" ? x.payload.tier : `${x.kind}/${x.payload.group ?? ""}`}
                        </time>
                        <span>
                          {x.payload.text ?? `${x.payload.name ?? ""}${x.payload.blurb ? `：${x.payload.blurb}` : ""}`}{" "}
                          <button class="linklike small" onClick={() => act(() => adminApi.post(`/ai/items/${x.id}/remove`), "已移除")}>
                            移除
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
  );
}
