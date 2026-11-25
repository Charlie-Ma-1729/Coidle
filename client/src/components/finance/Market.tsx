import { MARKET_FEE_RATE, MARKET_TEXT, buyQuote, sellQuote, type MarketHistory, type MarketRow, type MarketView, type PortfolioView } from "@coidle/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { money, moneyShort, moneySigned, timeText } from "../../format";
import { PriceChart, Spark } from "../PriceChart";
import { useAction } from "./useAction";

const RANGES = [
  { hours: 24, label: "1 天" },
  { hours: 168, label: "7 天" },
  { hours: 720, label: "30 天" },
];
const pctText = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");

/** 股市：虛構集團的股票。先看全部與我的持倉，點一檔進去看走勢與買賣 */
export function Market(props: { onChanged: () => Promise<unknown> | unknown }) {
  const [view, setView] = useState<MarketView | null>(null);
  const [pf, setPf] = useState<PortfolioView | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [v, p] = await Promise.all([api.market(), api.portfolio()]);
      setView(v);
      setPf(p);
    } catch {
      // 讀不到就維持現狀
    }
  };
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!view || !pf) return <p class="st-hint">讀取股價…</p>;
  const row = picked ? view.rows.find((r) => r.key === picked) : undefined;
  if (row) return <Detail row={row} view={view} pf={pf} reload={reload} onBack={() => setPicked(null)} onChanged={props.onChanged} />;

  return (
    <>
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
        <h4>全部集團（{view.rows.length}）</h4>
        <div class="st-list">
          {view.rows.map((r) => (
            <button key={r.key} class="st-li st-stock" onClick={() => setPicked(r.key)} aria-label={`${r.name}，現價 ${r.price}，24 小時 ${pctText(r.change24h)}`}>
              <span class="grow">
                <b>{r.name}</b> {r.held > 0 && <span class="st-tag">持有 {r.held.toLocaleString()}</span>}
                <small>{r.sector}</small>
              </span>
              <Spark values={r.spark} />
              <span class="st-amt">
                <b>{r.price.toLocaleString()}</b>
                <small class={tone(r.change24h)}>{pctText(r.change24h)}</small>
              </span>
            </button>
          ))}
        </div>
        <p class="st-hint">價格更新於 {timeText(view.at)}，之後每真實 1 小時更新一次。</p>
      </div>

      <div class="st-sec">
        <h4>關於這個市場</h4>
        <p class="st-hint">{MARKET_TEXT.what}</p>
        <p class="st-hint">{MARKET_TEXT.price}</p>
        <p class="st-hint">{MARKET_TEXT.friction}</p>
      </div>
    </>
  );
}

function Detail(props: { row: MarketRow; view: MarketView; pf: PortfolioView; reload: () => Promise<unknown>; onBack: () => void; onChanged: () => Promise<unknown> | unknown }) {
  const { row, view, pf } = props;
  const [range, setRange] = useState(168);
  const [hist, setHist] = useState<MarketHistory | null>(null);
  const [qty, setQty] = useState("");
  const { busy, run } = useAction(async () => {
    await props.reload();
    await props.onChanged();
  });
  useEffect(() => {
    let alive = true;
    api
      .marketHistory(row.key, range)
      .then((h) => alive && setHist(h))
      .catch(() => alive && setHist(null));
    return () => {
      alive = false;
    };
  }, [row.key, range, view.at]);

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

  return (
    <>
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
          <span class={tone(row.change24h)}>{pctText(row.change24h)}（24 小時）</span>
        </div>
        <p class="st-hint">{row.blurb}</p>
        {hist && <PriceChart history={hist} />}
        <div class="st-row" role="group" aria-label="時間範圍">
          {RANGES.map((r) => (
            <button key={r.hours} class={`st-btn${range === r.hours ? " on" : ""}`} aria-pressed={range === r.hours} onClick={() => setRange(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
        {row.news && (
          <div class="st-tip">
            <b>
              {row.news.pct >= 0 ? "📈" : "📉"} {row.news.text}（{pctText(row.news.pct)}）
            </b>
            <span class="st-hint">{timeText(row.news.at)}</span>
          </div>
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

      <div class="st-sec">
        <h4>買賣</h4>
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
            <button class="st-btn" onClick={() => setQty(String(held))}>
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
                  買進 {shares.toLocaleString()} 股：<b>{money(bq.total)}</b>
                  <small>
                    股款 {money(bq.cost)} ＋ 手續費 {money(bq.fee)}
                    {buyProblem ? `・${buyProblem}` : ""}
                  </small>
                </span>
              </div>
            )}
            {sq && held > 0 && (
              <div class="st-li">
                <span class="grow">
                  賣出 {Math.min(shares, held).toLocaleString()} 股：進錢包 <b>{money(sq.net)}</b>
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
            onClick={() => confirm(`賣出 ${shares.toLocaleString()} 股「${row.name}」？`) && run(async () => void (await api.sellStock(row.key, shares)), `已賣出 ${shares.toLocaleString()} 股`).then((ok) => ok && setQty(""))}
          >
            賣出
          </button>
        </div>
        <p class="st-hint">{MARKET_TEXT.friction}</p>
      </div>
    </>
  );
}
