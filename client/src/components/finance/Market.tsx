import {
  DEFAULT_SERVER_CLOCK,
  MARKET_FEE_RATE,
  MARKET_TEXT,
  SESSION_LABEL,
  WEEKDAY_NAMES,
  buyQuote,
  corporateCap,
  localGameMs,
  sellQuote,
  stockGroupOf,
  ymdOfDay,
  type CorporateAccount,
  type CorporateView,
  type MarketHistory,
  type MarketNewsItem,
  type MarketOrderView,
  type MarketRange,
  type MarketRow,
  type MarketView,
  type PortfolioView,
  type StockSummaryView,
} from "@coidle/shared";
import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../../api";
import { money, moneyShort, moneySigned, timeText } from "../../format";
import { PriceChart, Spark, canCandle } from "../PriceChart";
import { useAction } from "./useAction";
import { confirmThen } from "../ConfirmHost";

/** 區間都是「遊戲時間」：1 遊戲日＝4 真實小時，所以 1 個月（30 遊戲日）約 5 個真實日 */
const RANGES: { id: MarketRange; label: string; note: string }[] = [
  { id: "1d", label: "今日", note: "最近一個交易日（每 30 真實秒一點）" },
  { id: "5d", label: "5 日", note: "最近 5 個交易日（約 7 遊戲日、1 個多真實日）" },
  { id: "1m", label: "1 個月", note: "最近 30 遊戲日（約 5 真實日）" },
  { id: "3m", label: "3 個月", note: "最近 90 遊戲日（約 15 真實日）" },
  { id: "all", label: "全部", note: "往回推算的半年（130 個交易日）加上之後的全部" },
];
/** 遊戲時間（JST）的「月/日 時:分」；股市的日期一律跟著遊戲內日期走 */
const gameTime = (ms: number, clock = DEFAULT_SERVER_CLOCK) => {
  const d = new Date(localGameMs(ms, clock));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const pctText = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");
type Sort = "default" | "change" | "price" | "cap";
const SORTS: { id: Sort; label: string }[] = [
  { id: "default", label: "預設" },
  { id: "change", label: "漲跌幅" },
  { id: "price", label: "股價" },
  { id: "cap", label: "市值" },
];
const capText = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} 兆` : `${Math.round(n / 1e8).toLocaleString()} 億`);
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)} 小時 ${Math.floor((s % 3600) / 60)} 分` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, "0")} 秒`;
};

/** 市場狀態列：遊戲日期與時間、開休市、下次開市（或本時段結束）的真實倒數 */
function StatusBar(props: { view: MarketView; now: number }) {
  const { status: st } = props.view;
  const c = ymdOfDay(st.day);
  const date = `${c.m}/${c.d}（${WEEKDAY_NAMES[c.dow]}）${st.clock}`;
  return (
    <div class={`st-market-status ${st.open ? "open" : "closed"}`} role="status">
      <b>{st.open ? "● 開市中" : "○ 休市"}</b>
      <span>
        {SESSION_LABEL[st.session]}・遊戲時間 {date}
        {st.reason ? `・${st.reason}` : ""}
      </span>
      <span class="grow" />
      <span>{st.open && st.nextCloseAt ? `本時段結束還有 ${mmss(st.nextCloseAt - props.now)}` : `下次開盤還有 ${mmss(st.nextOpenAt - props.now)}（${timeText(st.nextOpenAt)}）`}</span>
    </div>
  );
}

function Indices(props: { view: MarketView }) {
  return (
    <div class="st-kpis">
      {props.view.indices.map((ix) => (
        <div key={ix.id} class="st-kpi">
          <small>{ix.name}</small>
          <b>{ix.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
          <small class={tone(ix.change)}>{pctText(ix.change)}</small>
          <Spark values={ix.spark} width={96} height={22} />
        </div>
      ))}
    </div>
  );
}

/** 股市：虛構集團的股票。先看市場狀態、指數、全部與我的持倉，點一檔進去看走勢與買賣 */
export function Market(props: { onChanged: () => Promise<unknown> | unknown }) {
  const [view, setView] = useState<MarketView | null>(null);
  const [pf, setPf] = useState<PortfolioView | null>(null);
  const [sum, setSum] = useState<StockSummaryView | null>(null);
  const [corp, setCorp] = useState<CorporateView | null>(null);
  const [news, setNews] = useState<MarketNewsItem[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<"list" | "news">("list");
  const [now, setNow] = useState(Date.now());
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const [sort, setSort] = useState<Sort>("default");

  const reload = async () => {
    try {
      const [v, p, c] = await Promise.all([api.market(), api.portfolio(), api.corporate().catch(() => null)]);
      setView(v);
      setPf(p);
      setCorp(c);
    } catch {
      // 讀不到就維持現狀
    }
  };
  useEffect(() => {
    void reload();
    void api.stockSummary().then(setSum).catch(() => undefined);
    // 開市中每 15 秒更新一次（價格每真實 30 秒走一步）；休市時 60 秒
    const t = setInterval(() => void reload(), 15_000);
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(clockTimer);
    };
  }, []);
  useEffect(() => {
    if (tab !== "news") return;
    let alive = true;
    const load = () => void api.marketNews(40).then((r) => alive && setNews(r.items)).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tab]);

  const sectors = useMemo(() => [...new Set((view?.rows ?? []).map((r) => r.sectorName))], [view?.rows.length]);
  const rows = useMemo(() => {
    let r = view?.rows ?? [];
    if (q.trim()) r = r.filter((x) => x.name.includes(q.trim()) || x.sectorName.includes(q.trim()));
    if (sector) r = r.filter((x) => x.sectorName === sector);
    if (sort === "change") r = [...r].sort((a, b) => b.change - a.change);
    else if (sort === "price") r = [...r].sort((a, b) => b.price - a.price);
    else if (sort === "cap") r = [...r].sort((a, b) => b.cap - a.cap);
    return r;
  }, [view, q, sector, sort]);

  if (!view || !pf) return <p class="st-hint">讀取股價…</p>;
  const row = picked ? view.rows.find((r) => r.key === picked) : undefined;
  if (row) return <Detail row={row} view={view} pf={pf} corp={corp} now={now} reload={reload} onBack={() => setPicked(null)} onChanged={props.onChanged} />;
  const openOrders = view.orders.filter((o) => o.status === "open");

  return (
    <>
      <StatusBar view={view} now={now} />
      <Indices view={view} />
      <div class="st-kpis four">
        <div class="st-kpi">
          <small>個人錢包</small>
          <b>{moneyShort(view.wallet)}</b>
        </div>
        <div class="st-kpi">
          <small>持股市值</small>
          <b>{moneyShort(pf.value)}</b>
        </div>
        <div class="st-kpi">
          <small>未實現損益</small>
          <b class={tone(pf.pnl)}>{moneySigned(pf.pnl)}</b>
        </div>
        <div class="st-kpi">
          <small>今天已買進</small>
          <b>
            {moneyShort(view.boughtToday)}／{moneyShort(view.dailyBuyLimit)}
          </b>
        </div>
      </div>
      {sum && sum.trades > 0 && (
        <p class="st-hint">
          已實現損益 <b class={tone(sum.realized)}>{moneySigned(sum.realized)}</b>・配息（稅後）{moneySigned(sum.dividends)}・手續費 {money(sum.fees)}・證券所得稅 {money(sum.tax)}
        </p>
      )}

      <div class="st-row" role="tablist" aria-label="股市">
        <button role="tab" class={`st-btn${tab === "list" ? " on" : ""}`} aria-selected={tab === "list"} onClick={() => setTab("list")}>
          股價表
        </button>
        <button role="tab" class={`st-btn${tab === "news" ? " on" : ""}`} aria-selected={tab === "news"} onClick={() => setTab("news")}>
          消息
        </button>
      </div>

      {tab === "news" ? (
        <NewsFeed items={news} names={view.rows} onPick={setPicked} />
      ) : (
        <>
          {openOrders.length > 0 && <Orders orders={view.orders} reload={reload} />}
          {pf.positions.length > 0 && (
            <div class="st-sec">
              <h4>我的持倉</h4>
              <div class="st-list">
                {pf.positions.map((p) => (
                  <button key={p.key} class="st-li st-stock" onClick={() => setPicked(p.key)}>
                    <span class="grow">
                      <b>{p.name}</b>
                      <small>
                        {p.shares.toLocaleString()} 股・均價 {p.avgCost.toLocaleString()} → 現價 {p.price.toLocaleString()}
                      </small>
                    </span>
                    <span class="st-amt">
                      <b>{moneyShort(p.value)}</b>
                      <small class={tone(p.pnl)}>
                        {moneySigned(p.pnl)}（{pctText(p.pnlPct)}）
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div class="st-sec">
            <h4>全部集團（{rows.length}／{view.rows.length}）</h4>
            <div class="st-row">
              <input class="st-in" type="search" placeholder="搜尋名稱或板塊" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="搜尋" />
              <select class="st-in" value={sector} onChange={(e) => setSector((e.target as HTMLSelectElement).value)} aria-label="板塊">
                <option value="">全部板塊</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select class="st-in" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)} aria-label="排序">
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    排序：{s.label}
                  </option>
                ))}
              </select>
            </div>
            <div class="st-list">
              {rows.map((r) => (
                <button key={r.key} class="st-li st-stock" onClick={() => setPicked(r.key)} aria-label={`${r.name}，現價 ${r.price}，較前日收盤 ${pctText(r.change)}`}>
                  <span class="grow">
                    <b>{r.name}</b> {r.held > 0 && <span class="st-tag">持有 {r.held.toLocaleString()}</span>} {!r.listed && <span class="st-tag">未上市</span>}
                    <small>
                      {r.sector}・市值 {capText(r.cap)}
                    </small>
                  </span>
                  <Spark values={r.spark} />
                  <span class="st-amt">
                    <b>{r.price.toLocaleString()}</b>
                    <small class={tone(r.change)}>{pctText(r.change)}</small>
                  </span>
                </button>
              ))}
            </div>
            <p class="st-hint">價格更新於 {timeText(view.at)}。漲跌幅是較前日收盤。</p>
          </div>
        </>
      )}

      <div class="st-sec">
        <h4>關於這個市場</h4>
        <p class="st-hint">{MARKET_TEXT.what}</p>
        <p class="st-hint">{MARKET_TEXT.hours}</p>
        <p class="st-hint">{MARKET_TEXT.price}</p>
        <p class="st-hint">{MARKET_TEXT.friction}</p>
      </div>
    </>
  );
}

function NewsFeed(props: { items: MarketNewsItem[] | null; names: MarketRow[]; onPick: (key: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!props.items) return <p class="st-hint">讀取消息…</p>;
  if (props.items.length === 0) return <p class="st-hint">最近還沒有消息。</p>;
  return (
    <div class="st-sec">
      <h4>市場消息</h4>
      <div class="st-list">
        {props.items.map((n) => (
          <div key={n.id} class="st-li st-news">
            <span class="grow">
              <button class="st-link" onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}>
                <b>
                  {n.pct >= 0 ? "📈" : "📉"} {n.headline}
                </b>
              </button>
              <small>
                {timeText(n.at)}・{n.subject}
                {n.phase === "rumor" ? "・傳聞" : n.phase === "confirm" ? "・證實" : n.phase === "deny" ? "・否認" : ""}
                {n.scope === "stock" && n.target ? (
                  <>
                    ・<button class="st-link" onClick={() => props.onPick(n.target!)}>看股價</button>
                  </>
                ) : null}
              </small>
              {open === n.id && n.body && <p class="st-hint">{n.body}</p>}
            </span>
            <span class={`st-amt ${n.pct >= 0 ? "up" : "down"}`}>
              <b>{pctText(n.pct)}</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Orders(props: { orders: MarketOrderView[]; reload: () => Promise<unknown> }) {
  const { busy, run } = useAction(async () => void (await props.reload()));
  if (props.orders.length === 0) return null;
  return (
    <div class="st-sec">
      <h4>我的預約單</h4>
      <div class="st-list">
        {props.orders.map((o) => (
          <div key={o.id} class="st-li">
            <span class="grow">
              {o.side === "buy" ? "買進" : "賣出"} <b>{o.name}</b> {o.shares.toLocaleString()} 股（開盤價）
              <small>
                {o.status === "open" ? "等待開盤" : o.status === "filled" ? `已成交 @ ${o.price?.toLocaleString()}` : o.status === "cancelled" ? "已取消" : `未成交：${o.note}`}・{timeText(o.createdAt)}
              </small>
            </span>
            {o.status === "open" && (
              <button class="st-btn" disabled={busy} onClick={() => run(async () => void (await api.cancelOrder(o.id)), "已取消預約單")}>
                取消
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail(props: { row: MarketRow; view: MarketView; pf: PortfolioView; corp: CorporateView | null; now: number; reload: () => Promise<unknown>; onBack: () => void; onChanged: () => Promise<unknown> | unknown }) {
  const { row, view, pf } = props;
  const [range, setRange] = useState<MarketRange>("1d");
  const [mode, setMode] = useState<"line" | "candle">("line");
  const [hist, setHist] = useState<MarketHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [histErr, setHistErr] = useState(false);
  const [retry, setRetry] = useState(0);
  const [qty, setQty] = useState("");
  const [acct, setAcct] = useState<number | null>(null);
  const { busy, run } = useAction(async () => {
    await props.reload();
    await props.onChanged();
  });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .marketHistory(row.key, range)
      .then((h) => {
        if (!alive) return;
        setHist(h);
        setHistErr(false);
      })
      .catch(() => alive && setHistErr(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [row.key, range, view.at, retry]);

  const open = view.status.open && row.listed;
  const pos = pf.positions.find((p) => p.key === row.key);
  const held = pos?.shares ?? 0;
  const shares = Math.floor(Number(qty));
  const valid = Number.isInteger(shares) && shares >= 1;
  const maxBuy = Math.max(
    0,
    Math.min(
      Math.floor(view.wallet / (row.price * (1 + MARKET_FEE_RATE))),
      Math.floor((view.dailyBuyLimit - view.boughtToday) / row.price),
      Math.floor(view.holdCap / row.price) - held,
    ),
  );
  const bq = valid ? buyQuote(row.price, shares) : null;
  const sq = valid && pos ? sellQuote(row.price, Math.min(shares, held), { shares: held, costTotal: pos.costTotal }) : null;
  const buyProblem = !valid ? "" : shares > maxBuy ? "超過目前能買的上限（錢包、今天的額度或持股上限）" : "";
  const sellProblem = !valid ? "" : shares > held ? `你只有 ${held.toLocaleString()} 股` : "";
  const pending = view.orders.filter((o) => o.status === "open" && o.key === row.key && o.side === "sell").reduce((a, o) => a + o.shares, 0);

  const place = (side: "buy" | "sell") => run(async () => void (await api.orderStock(row.key, side, shares)), `已預約${side === "buy" ? "買進" : "賣出"} ${shares.toLocaleString()} 股，開盤用開盤價成交`).then((ok) => ok && setQty(""));

  return (
    <>
      <StatusBar view={view} now={props.now} />
      <div class="st-row between">
        <button class="st-btn" onClick={props.onBack}>
          ← 回股價表
        </button>
        <span class="st-hint">價格更新於 {timeText(view.at)}</span>
      </div>

      <div class="st-sec">
        <h4>
          {row.name}（{row.sector}）
        </h4>
        <div class="st-price">
          <b>{money(row.price)}</b>
          <span class={tone(row.change)}>{pctText(row.change)}（較前日收盤 {row.prevClose.toLocaleString()}）</span>
        </div>
        <p class="st-hint">
          開 {row.open.toLocaleString()}・高 {row.high.toLocaleString()}・低 {row.low.toLocaleString()}・漲停 {row.limitUp.toLocaleString()}／跌停 {row.limitDown.toLocaleString()}・市值 {capText(row.cap)}
          {row.divYield > 0 ? `・年配息率約 ${(row.divYield * 100).toFixed(1)}%` : "・不配息"}
        </p>
        <p class="st-hint">{row.blurb}</p>
        {histErr && (
          <p class="st-hint">
            走勢讀取失敗。
            <button class="st-btn" onClick={() => setRetry(retry + 1)}>
              重試
            </button>
          </p>
        )}
        {hist && !histErr && <PriceChart history={hist} mode={mode} loading={loading} />}
        <div class="st-row" role="group" aria-label="時間範圍">
          {RANGES.map((r) => (
            <button key={r.id} class={`st-btn${range === r.id ? " on" : ""}`} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
          {hist && canCandle(hist) && (
            <button class={`st-btn${mode === "candle" ? " on" : ""}`} aria-pressed={mode === "candle"} onClick={() => setMode(mode === "candle" ? "line" : "candle")}>
              K 線
            </button>
          )}
        </div>
        <p class="st-hint">圖上的日期是遊戲時間。{RANGES.find((r) => r.id === range)?.note}</p>
        {row.news && (
          <div class="st-tip">
            <b>
              {row.news.pct >= 0 ? "📈" : "📉"} {row.news.text}（{pctText(row.news.pct)}）
            </b>
            <span class="st-hint">遊戲時間 {gameTime(row.news.at, hist?.clock)}</span>
          </div>
        )}
        {hist && hist.events.length > 0 && (
          <details class="st-news-list">
            <summary>這個區間的消息（{hist.events.length}）</summary>
            {[...hist.events].reverse().map((e) => (
              <div key={e.id} class="st-li">
                <span class="grow">
                  <b>{e.text}</b>
                  <small>遊戲時間 {gameTime(e.at, hist?.clock)}</small>
                  {e.body && <p class="st-hint">{e.body}</p>}
                </span>
                <span class={`st-amt ${tone(e.pct)}`}>{pctText(e.pct)}</span>
              </div>
            ))}
          </details>
        )}
        <p class="st-hint">
          {row.watch.length > 0 ? (
            <>
              會跟著這些世界訊號小幅起伏：<b>{row.watch.join("、")}</b>。幅度很小，主要仍是隨機波動。
            </>
          ) : (
            "沒有特定的世界訊號，價格只看市場情緒（隨機波動與消息）。"
          )}
        </p>
      </div>

      {pos && (
        <div class="st-sec">
          <h4>我的持倉</h4>
          <div class="st-kpis four">
            <div class="st-kpi">
              <small>股數</small>
              <b>{pos.shares.toLocaleString()}</b>
            </div>
            <div class="st-kpi">
              <small>均價（含手續費）</small>
              <b>{pos.avgCost.toLocaleString()}</b>
            </div>
            <div class="st-kpi">
              <small>市值</small>
              <b>{moneyShort(pos.value)}</b>
            </div>
            <div class="st-kpi">
              <small>未實現損益</small>
              <b class={tone(pos.pnl)}>{moneySigned(pos.pnl)}</b>
            </div>
          </div>
        </div>
      )}

      {props.corp && props.corp.accounts.length > 0 && (
        <div class="st-sec">
          <h4>交易帳戶</h4>
          <div class="st-row" role="group" aria-label="交易帳戶">
            <button class={`st-btn${acct === null ? " on" : ""}`} aria-pressed={acct === null} onClick={() => setAcct(null)}>
              個人錢包
            </button>
            {props.corp.accounts.map((a) => (
              <button key={a.mallId} class={`st-btn${acct === a.mallId ? " on" : ""}`} aria-pressed={acct === a.mallId} onClick={() => setAcct(a.mallId)}>
                {a.mallName}（公司資金）
              </button>
            ))}
          </div>
        </div>
      )}

      {acct !== null && props.corp?.accounts.find((a) => a.mallId === acct) ? (
        <CorporatePanel
          row={row}
          view={view}
          corp={props.corp}
          account={props.corp.accounts.find((a) => a.mallId === acct)!}
          open={open}
          onDone={async () => {
            await props.reload();
            await props.onChanged();
          }}
        />
      ) : (
      <div class="st-sec">
        <h4>{open ? "買賣" : "預約買賣"}</h4>
        {!open && (
          <p class="st-hint">
            {row.listed ? "市場休市中：" : "這檔還沒上市："}可以下預約單，下次開盤用<b>開盤價</b>成交（成交時才檢查錢包、今天的額度與持股上限）。
          </p>
        )}
        <div class="st-row">
          <input class="st-in" type="number" min={1} step={1} placeholder="股數" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} aria-label="股數" />
          {[10, 100].map((n) => (
            <button key={n} class="st-btn" onClick={() => setQty(String((valid ? shares : 0) + n))}>
              +{n}
            </button>
          ))}
          <button class="st-btn" disabled={maxBuy < 1} onClick={() => setQty(String(maxBuy))}>
            最多可買 {maxBuy.toLocaleString()}
          </button>
          {held > 0 && (
            <button class="st-btn" onClick={() => setQty(String(held - pending))}>
              全部賣出
            </button>
          )}
        </div>
        <p class="st-hint">
          現價 {row.price.toLocaleString()}。錢包 {moneyShort(view.wallet)}；今天還能買 {moneyShort(Math.max(0, view.dailyBuyLimit - view.boughtToday))}；單一集團持股市值最多 {moneyShort(view.holdCap)}。
        </p>
        {valid && (
          <div class="st-list">
            {bq && (
              <div class="st-li">
                <span class="grow">
                  {open ? "買進" : "預約買進"} {shares.toLocaleString()} 股：<b>{money(bq.total)}</b>
                  <small>
                    股款 {money(bq.cost)} ＋ 手續費 {money(bq.fee)}
                    {open && buyProblem ? `・${buyProblem}` : ""}
                  </small>
                </span>
              </div>
            )}
            {sq && held > 0 && (
              <div class="st-li">
                <span class="grow">
                  {open ? "賣出" : "預約賣出"} {Math.min(shares, held).toLocaleString()} 股：進錢包 <b>{money(sq.net)}</b>
                  <small>
                    {sq.gain >= 0 ? `獲利 ${money(sq.gain)}，稅 ${money(sq.tax)}` : `虧損 ${money(-sq.gain)}（不退稅）`}・手續費 {money(sq.fee)}
                    {sellProblem ? `・${sellProblem}` : ""}
                  </small>
                </span>
              </div>
            )}
          </div>
        )}
        <div class="st-row">
          {open ? (
            <>
              <button
                class="st-btn pri"
                disabled={busy || !valid || shares > maxBuy}
                onClick={() => run(async () => void (await api.buyStock(row.key, shares)), `已買進 ${shares.toLocaleString()} 股`).then((ok) => ok && setQty(""))}
              >
                買進
              </button>
              <button
                class="st-btn"
                disabled={busy || !valid || shares > held}
                onClick={() => confirmThen(`賣出 ${shares.toLocaleString()} 股「${row.name}」？`, () => run(async () => void (await api.sellStock(row.key, shares)), `已賣出 ${shares.toLocaleString()} 股`).then((ok) => ok && setQty("")))}
              >
                賣出
              </button>
            </>
          ) : (
            <>
              <button class="st-btn pri" disabled={busy || !valid} onClick={() => place("buy")}>
                預約買進
              </button>
              <button class="st-btn" disabled={busy || !valid || shares > held - pending} onClick={() => place("sell")}>
                預約賣出
              </button>
            </>
          )}
        </div>
        <p class="st-hint">{MARKET_TEXT.friction}</p>
      </div>
      )}
      <Orders orders={view.orders.filter((o) => o.key === row.key)} reload={props.reload} />
    </>
  );
}

/** 法人投資：用商場的公司資金買賣這檔股票（只有管事的人；開市中；有持股、現金比例與落後的限制） */
function CorporatePanel(props: { row: MarketRow; view: MarketView; corp: CorporateView; account: CorporateAccount; open: boolean; onDone: () => Promise<unknown> }) {
  const { row, account: a, corp } = props;
  const [qty, setQty] = useState("");
  const { busy, run } = useAction(props.onDone);
  const g = stockGroupOf(row.key)!;
  const held = a.holdings.find((h) => h.key === row.key);
  const cap = corporateCap({ outstanding: g.shares, held: held?.shares ?? 0, price: row.price, mallCash: a.funds, portfolioValue: a.value });
  const shares = Math.floor(Number(qty));
  const valid = Number.isInteger(shares) && shares >= 1;
  const bq = valid ? buyQuote(row.price, shares) : null;
  const sq = valid && held ? sellQuote(row.price, Math.min(shares, held.shares), { shares: held.shares, costTotal: held.cost }) : null;
  const can = props.open && a.canTrade;
  const why = !a.canTrade ? a.blocked : !props.open ? "市場休市中，法人投資不能預約，開盤後再來。" : null;
  return (
    <div class="st-sec">
      <h4>用「{a.mallName}」的公司資金投資</h4>
      <div class="st-kpis four">
        <div class="st-kpi">
          <small>公司資金</small>
          <b>{moneyShort(a.funds)}</b>
        </div>
        <div class="st-kpi">
          <small>投資市值（全部）</small>
          <b>{moneyShort(a.value)}</b>
        </div>
        <div class="st-kpi">
          <small>還能再投入</small>
          <b>{moneyShort(a.room)}</b>
        </div>
        <div class="st-kpi">
          <small>這檔持股</small>
          <b>
            {(held?.shares ?? 0).toLocaleString()} 股（{held?.pct ?? 0}%）
          </b>
        </div>
      </div>
      <p class="st-hint">
        限制：單一集團最多流通股的 {corp.singleCap * 100}%、全部投資市值最多公司現金的 {corp.totalCap * 100}%；持股超過 {corp.disclosurePct * 100}% 會公開「大量持有報告」（不影響股價）；落後伺服器超過 1 遊戲日不能下單。手續費 {corp.feeRate * 100}%，賣出獲利課 {(corp.taxRate * 100).toFixed(3)}%，配息入公司資金（同樣扣稅）。
      </p>
      {why && <p class="st-hint">{why}</p>}
      <div class="st-row">
        <input class="st-in" type="number" min={1} step={1} placeholder="股數" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} aria-label="公司投資股數" />
        <button class="st-btn" disabled={cap.maxShares < 1} onClick={() => setQty(String(cap.maxShares))}>
          最多可買 {cap.maxShares.toLocaleString()}
        </button>
        {held && (
          <button class="st-btn" onClick={() => setQty(String(held.shares))}>
            全部賣出
          </button>
        )}
      </div>
      {valid && (
        <div class="st-list">
          {bq && (
            <div class="st-li">
              <span class="grow">
                買進 {shares.toLocaleString()} 股：公司付 <b>{money(bq.total)}</b>
                <small>
                  股款 {money(bq.cost)} ＋ 手續費 {money(bq.fee)}
                  {shares > cap.maxShares ? "・超過目前能買的上限" : ""}
                </small>
              </span>
            </div>
          )}
          {sq && held && (
            <div class="st-li">
              <span class="grow">
                賣出 {Math.min(shares, held.shares).toLocaleString()} 股：進公司資金 <b>{money(sq.net)}</b>
                <small>{sq.gain >= 0 ? `獲利 ${money(sq.gain)}，稅 ${money(sq.tax)}` : `虧損 ${money(-sq.gain)}（不退稅）`}</small>
              </span>
            </div>
          )}
        </div>
      )}
      <div class="st-row">
        <button
          class="st-btn pri"
          disabled={busy || !can || !valid || shares > cap.maxShares}
          onClick={() => run(async () => void (await api.corporateTrade(a.mallId, row.key, "buy", shares)), `「${a.mallName}」已買進 ${shares.toLocaleString()} 股`).then((ok) => ok && setQty(""))}
        >
          公司買進
        </button>
        <button
          class="st-btn"
          disabled={busy || !can || !valid || !held || shares > (held?.shares ?? 0)}
          onClick={() => confirmThen(`用「${a.mallName}」的名義賣出 ${shares.toLocaleString()} 股「${row.name}」？`, () => run(async () => void (await api.corporateTrade(a.mallId, row.key, "sell", shares)), `「${a.mallName}」已賣出 ${shares.toLocaleString()} 股`).then((ok) => ok && setQty("")))}
        >
          公司賣出
        </button>
      </div>
    </div>
  );
}
