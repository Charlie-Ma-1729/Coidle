import { useEffect, useState } from "preact/hooks";
import { ZONES } from "@coidle/shared";

// 管理後台：網址加上 #admin 即可進入。需要伺服器 .env 裡的 ADMIN_TOKEN（只存在這個分頁的 sessionStorage）。
// 這個畫面只給站長用，刻意做得簡單。

type Tab = "overview" | "ai" | "malls" | "users";
const tokenKey = "coidle.admin";

async function call<T>(method: "GET" | "POST", url: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "x-admin-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `錯誤 ${res.status}`);
  return data as T;
}

interface Overview {
  users: { id: number; username: string; display_name: string; created_at: number }[];
  malls: { id: number; name: string; created_at: number; members: number; level: number; funds: number; day: number; flags: Record<string, boolean> }[];
}
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

export function Admin() {
  const [token, setToken] = useState(sessionStorage.getItem(tokenKey) ?? "");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [msg, setMsg] = useState("");
  const [ov, setOv] = useState<Overview | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [events, setEvents] = useState<PoolItem[]>([]);
  const [texts, setTexts] = useState<PoolItem[]>([]);
  const [regulars, setRegulars] = useState<PoolItem[]>([]);

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "失敗");
    }
  };
  const loadAll = (tk = token) =>
    guard(async () => {
      setOv(await call<Overview>("GET", "/api/admin/overview", tk));
      setAi(await call<AiStatus>("GET", "/api/admin/ai/status", tk));
      const pending = await call<{ items: PoolItem[] }>("GET", "/api/admin/ai/items?kind=event", tk);
      setEvents(pending.items);
      const news = await call<{ items: PoolItem[] }>("GET", "/api/admin/ai/items?status=active", tk);
      setTexts(news.items.filter((x) => x.kind !== "event" && x.kind !== "regular"));
      const regs = await call<{ items: PoolItem[] }>("GET", "/api/admin/ai/items?kind=regular", tk);
      setRegulars(regs.items);
      setAuthed(true);
      sessionStorage.setItem(tokenKey, tk);
      setMsg("");
    });

  useEffect(() => {
    if (token) void loadAll(token);
  }, []);

  const act = (fn: () => Promise<unknown>, ok: string) =>
    guard(async () => {
      const r = await fn();
      setMsg(typeof r === "object" && r && "tempPassword" in r ? `${ok}：臨時密碼 ${(r as { tempPassword: string }).tempPassword}（只顯示這一次）` : ok);
      await loadAll();
    });

  if (!authed) {
    return (
      <main class="auth">
        <div class="auth-card">
          <h1>管理後台</h1>
          <p class="tagline">請輸入伺服器 .env 的 ADMIN_TOKEN</p>
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void loadAll(token);
            }}
          >
            <input type="password" value={token} onInput={(e) => setToken((e.target as HTMLInputElement).value)} placeholder="ADMIN_TOKEN" autocomplete="off" />
            <button class="btn btn-primary" type="submit">
              進入
            </button>
          </form>
          {msg && <p class="small" style={{ color: "var(--red, #ff6b6b)" }}>{msg}</p>}
        </div>
      </main>
    );
  }

  const flagOptions = ["feature:lease", ...ZONES.map((z) => `zone:${z.id}`)];
  return (
    <div class="app">
      <header class="topbar">
        <span class="brand">COIDLE</span>
        <span class="mall-name">管理後台</span>
        <span class="spacer" />
        <button class="btn btn-ghost btn-sm" onClick={() => loadAll()}>
          重新整理
        </button>
        <button
          class="btn btn-ghost btn-sm"
          onClick={() => {
            sessionStorage.removeItem(tokenKey);
            setAuthed(false);
            setToken("");
          }}
        >
          登出
        </button>
      </header>
      <div class="layout">
        <nav class="zones" style={{ gridColumn: "1 / -1" }}>
          {(["overview", "ai", "malls", "users"] as Tab[]).map((t) => (
            <button key={t} class={`zone-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {{ overview: "📊 概況", ai: "🤖 AI 內容", malls: "🏬 商場", users: "👤 使用者" }[t]}
            </button>
          ))}
        </nav>
        <main class="content">
          {msg && <div class="alert cyan"><span class="small">{msg}</span></div>}

          {tab === "overview" && ov && (
            <div class="card">
              <h3>概況</h3>
              <p>使用者 {ov.users.length} 人・商場 {ov.malls.length} 座</p>
              {ai && (
                <p class="small">
                  AI：{ai.enabled ? `已啟用（${ai.model}）` : "未啟用"}・本期已花 {usd(ai.budget.spentUsd)}／可用 {usd(ai.budget.capUsd)}・待審事件 {ai.pool.eventPending} 個
                </p>
              )}
            </div>
          )}

          {tab === "ai" && ai && (
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
                    <button key={k} class="btn btn-ghost btn-sm" disabled={!ai.enabled} onClick={() => act(() => call("POST", "/api/admin/ai/generate", token, { kind: k }), `已生成${k}`)}>
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
                          <button class="btn btn-primary btn-sm" onClick={() => act(() => call("POST", `/api/admin/ai/events/${e.id}/approve`, token), "已核准上線")}>
                            核准
                          </button>
                        )}
                        <button class="btn btn-ghost btn-sm" onClick={() => act(() => call("POST", `/api/admin/ai/events/${e.id}/reject`, token), e.status === "pending" ? "已拒絕" : "已下架")}>
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
                          <button class="btn btn-primary btn-sm" onClick={() => act(() => call("POST", `/api/admin/ai/events/${e.id}/approve`, token), "已核准上線")}>
                            核准
                          </button>
                          <button class="btn btn-ghost btn-sm" onClick={() => act(() => call("POST", `/api/admin/ai/events/${e.id}/reject`, token), "已拒絕")}>
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
                          <button class="linklike small" onClick={() => act(() => call("POST", `/api/admin/ai/items/${x.id}/remove`, token), "已移除")}>
                            移除
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}

          {tab === "malls" && ov && (
            <div class="stack">
              {ov.malls.length === 0 && <p class="small dim">還沒有商場。</p>}
              {ov.malls.map((m) => (
                <div class="card" key={m.id}>
                  <h3>
                    #{m.id} {m.name}
                  </h3>
                  <p class="small">
                    成員 {m.members}・Lv.{m.level}・資金 {m.funds.toLocaleString()}・第 {m.day} 天・建立於 {date(m.created_at)}
                  </p>
                  <div class="row small">
                    {flagOptions.map((f) => (
                      <label key={f} style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={m.flags[f] === true}
                          onChange={(e) => act(() => call("POST", `/api/admin/malls/${m.id}/flags`, token, { flag: f, value: (e.target as HTMLInputElement).checked }), `已更新 ${f}`)}
                        />
                        {f}
                      </label>
                    ))}
                  </div>
                  <p class="small dim">勾選＝強制開放（例如提前開放某個區域）；取消勾選＝強制關閉。</p>
                  <button class="btn btn-danger btn-sm" onClick={() => confirm(`確定解散「${m.name}」？所有資料會刪除，無法復原。`) && act(() => call("POST", `/api/admin/malls/${m.id}/delete`, token), "已解散")}>
                    解散商場
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === "users" && ov && (
            <div class="card">
              <h3>使用者（{ov.users.length}）</h3>
              <div class="log">
                <ul>
                  {ov.users.map((u) => (
                    <li key={u.id}>
                      <time>#{u.id}</time>
                      <span>
                        <b>{u.username}</b>（{u.display_name}）・註冊 {date(u.created_at)}{" "}
                        <button class="linklike small" onClick={() => confirm(`重設「${u.username}」的密碼？他所有裝置都會被登出。`) && act(() => call("POST", `/api/admin/users/${u.id}/reset-password`, token), `已重設 ${u.username}`)}>
                          重設密碼
                        </button>{" "}
                        <button class="linklike small" onClick={() => confirm(`刪除「${u.username}」？`) && act(() => call("POST", `/api/admin/users/${u.id}/delete`, token), `已刪除 ${u.username}`)}>
                          刪除
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
