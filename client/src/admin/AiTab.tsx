import { useEffect, useState } from "preact/hooks";
import { adminApi } from "./adminApi";
import { Badge, Bar, Card, Empty, fmtDate, Stat } from "./kit";
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

const usd = (n: number) => `$${n.toFixed(4)}`;
const KINDS = { news: "快訊", review: "評價", event: "事件", brand: "品牌名", dish: "商品名", regular: "常客" } as const;

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

  if (!ai) return <p class="ad-empty">載入中…</p>;
  const b = ai.budget;
  const pct = b.capUsd > 0 ? (b.spentUsd / b.capUsd) * 100 : 0;
  const pendingEvents = events.filter((e) => e.status === "pending" || e.status === "active");
  const pendingRegulars = regulars.filter((e) => e.status === "pending" || e.status === "active");

  return (
    <>
      {!ai.enabled && <div class="ad-note warn">AI 內容目前沒有啟用（伺服器的 .env 沒有 OpenRouter 金鑰，或預算設成 0）。下面的「立即生成」會是灰的。</div>}
      <div class="ad-stats">
        <Stat tone="amber" label="已花費（30 天視窗）" value={usd(b.spentUsd)} hint={`上限 ${usd(b.capUsd)}・剩 ${usd(b.remainingUsd)}`} />
        <Stat tone="cyan" label="最近 24 小時" value={`${b.calls24h} 次`} hint={usd(b.spent24hUsd)} />
        <Stat tone="green" label="快訊／評價" value={`${ai.pool.news}／${ai.pool.review}`} hint="上線中的數量" />
        <Stat tone="pink" label="事件 上線／待審" value={`${ai.pool.eventActive}／${ai.pool.eventPending}`} hint={`新常客 ${ai.pool.regularActive}／${ai.pool.regularPending}`} />
      </div>

      <Card title="預算與生成" desc={`模型 ${ai.model}・視窗 ${b.windowStart.slice(0, 10)} → ${b.windowEnd.slice(0, 10)}・品牌名 ${ai.pool.brand}・商品名 ${ai.pool.dish}`}>
        <Bar value={pct} max={100} warnAt={70} badAt={90} />
        <div class="ad-row">
          {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => (
            <button key={k} class="ad-btn sm" disabled={!ai.enabled} onClick={() => void act(() => adminApi.post("/ai/generate", { kind: k }), `已生成${KINDS[k]}`)}>
              立即生成{KINDS[k]}
            </button>
          ))}
        </div>
        {ai.recent.length > 0 && (
          <div class="ad-list">
            {ai.recent.map((r, i) => (
              <div class="ad-item" key={i}>
                <time>{fmtDate(r.ts)}</time>
                <div class="ad-sub" style={{ color: "var(--text)" }}>
                  {r.purpose} <span class="num dim">{usd(r.cost_usd)}</span> {r.ok ? <Badge tone="green">成功</Badge> : <Badge tone="red">失敗</Badge>} <span class="dim">{r.note ?? ""}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div class="ad-grid c2">
        <Card title="事件審核" desc="核准後才會在遊戲裡隨機發生。">
          {pendingEvents.length === 0 && <Empty>沒有待審或上線中的事件。</Empty>}
          {pendingEvents.map((e) => (
            <div key={e.id} class="ad-opt">
              <div>
                <b>
                  #{e.id} 《{e.payload.title}》
                </b>{" "}
                <Badge tone={e.status === "pending" ? "amber" : "green"}>{e.status === "pending" ? "待審" : "上線中"}</Badge>
              </div>
              <p class="ad-sub" style={{ color: "var(--text)" }}>
                {e.payload.text}
              </p>
              {e.payload.choice?.options.map((o, i) => (
                <p class="ad-sub" key={i}>
                  ・{o.label} → <span class="mono">{JSON.stringify(o.effects)}</span>
                </p>
              ))}
              <div class="ad-row">
                {e.status === "pending" && (
                  <button class="ad-btn pri sm" onClick={() => void act(() => adminApi.post(`/ai/events/${e.id}/approve`), "已核准上線")}>
                    核准
                  </button>
                )}
                <button class="ad-btn sm" onClick={() => void act(() => adminApi.post(`/ai/events/${e.id}/reject`), e.status === "pending" ? "已拒絕" : "已下架")}>
                  {e.status === "pending" ? "拒絕" : "下架"}
                </button>
              </div>
            </div>
          ))}
        </Card>

        <Card title="新常客審核" desc="核准後會出現在遊戲的常客名單。">
          {pendingRegulars.length === 0 && <Empty>沒有待審或上線中的新常客。</Empty>}
          {pendingRegulars.map((e) => (
            <div key={e.id} class="ad-opt">
              <div>
                <b>
                  #{e.id} {e.payload.name}
                </b>{" "}
                <Badge tone={e.status === "pending" ? "amber" : "green"}>{e.status === "pending" ? "待審" : "上線中"}</Badge>
              </div>
              <p class="ad-sub">
                {e.payload.persona}・愛 {e.payload.fav}
                {e.payload.alt ? `（次選 ${e.payload.alt}）` : ""}
              </p>
              <p class="ad-sub" style={{ color: "var(--text)" }}>
                線索：{e.payload.hint}
              </p>
              <p class="ad-sub" style={{ color: "var(--text)" }}>
                {e.payload.bio}
              </p>
              <p class="ad-sub">特質：{e.payload.traits?.join("、")}</p>
              {e.payload.stories?.map((st, i) => (
                <p class="ad-sub" key={i}>
                  故事 {i + 1}《{st.title}》{st.text}
                </p>
              ))}
              {e.status === "pending" && (
                <div class="ad-row">
                  <button class="ad-btn pri sm" onClick={() => void act(() => adminApi.post(`/ai/events/${e.id}/approve`), "已核准上線")}>
                    核准
                  </button>
                  <button class="ad-btn sm" onClick={() => void act(() => adminApi.post(`/ai/events/${e.id}/reject`), "已拒絕")}>
                    拒絕
                  </button>
                </div>
              )}
            </div>
          ))}
        </Card>
      </div>

      <Card title="快訊、評價、品牌名與商品名" desc="上線中的內容（最多顯示 40 筆），發現不好的可以移除。">
        {texts.length === 0 ? (
          <Empty>沒有上線中的內容。</Empty>
        ) : (
          <div class="ad-list">
            {texts.slice(0, 40).map((x) => (
              <div class="ad-item" key={x.id}>
                <time>
                  #{x.id} <Badge>{x.kind === "news" ? x.payload.mood : x.kind === "review" ? x.payload.tier : `${x.kind}/${x.payload.group ?? ""}`}</Badge>
                </time>
                <div>
                  {x.payload.text ?? `${x.payload.name ?? ""}${x.payload.blurb ? `：${x.payload.blurb}` : ""}`}{" "}
                  <button class="ad-link danger" onClick={() => void act(() => adminApi.post(`/ai/items/${x.id}/remove`), "已移除")}>
                    移除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
