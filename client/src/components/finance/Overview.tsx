import { EQUITY_TEXT, MARKET_TEXT, type PersonalEquityView, type WealthView } from "@coidle/shared";
import { moneyShort } from "../../format";

type Tab = "overview" | "stakes" | "market" | "ledger";

/** 總覽：總資產、三塊占比、需要我處理的事、開新商場的成本 */
export function Overview(props: { wealth: WealthView | null; equity: PersonalEquityView | null; meId: number; onTab: (t: Tab) => void }) {
  const { wealth: w, equity: eq, meId } = props;
  if (!w) return <p class="st-hint">讀取中…</p>;
  const stakes = w.stakes.reduce((a, s) => a + s.value, 0);
  const parts = [
    { id: "cash", label: "個人錢包", value: w.cash, tone: "" },
    { id: "stakes", label: "商場持股（帳面價值）", value: stakes, tone: "amber" },
    { id: "stock", label: "股票市值", value: w.portfolio, tone: "red" },
  ];
  const total = Math.max(1, parts.reduce((a, p) => a + p.value, 0));
  const incoming = eq?.offers.filter((o) => o.toId === meId).length ?? 0;
  const toDecide = eq?.requests.filter((r) => r.userId !== meId).length ?? 0;
  return (
    <>
      <div class="st-kpis four">
        <div class="st-kpi">
          <small>總資產</small>
          <b>{moneyShort(w.totalValue)}</b>
        </div>
        <div class="st-kpi">
          <small>個人錢包</small>
          <b>{moneyShort(w.cash)}</b>
        </div>
        <div class="st-kpi">
          <small>商場持股</small>
          <b>{moneyShort(stakes)}</b>
        </div>
        <div class="st-kpi">
          <small>股票市值</small>
          <b>{moneyShort(w.portfolio)}</b>
        </div>
      </div>

      <div class="st-sec">
        <h4>資產組成</h4>
        {parts.map((p) => (
          <div key={p.id} class="st-bar">
            <span>{p.label}</span>
            <div class="st-meter" aria-hidden="true">
              <i class={p.tone} style={{ width: `${Math.round((p.value / total) * 100)}%` }} />
            </div>
            <b>{moneyShort(p.value)}</b>
          </div>
        ))}
        <p class="st-hint">商場持股只算商場帳上現金乘以持股比例，店面與設備還不計價；股票用現在的股價算。</p>
      </div>

      <div class="st-sec">
        <h4>需要你處理</h4>
        {incoming + toDecide === 0 ? (
          <p class="st-hint">目前沒有待處理的出價或注資申請。</p>
        ) : (
          <div class="st-list">
            {incoming > 0 && (
              <div class="st-li">
                <span class="grow">
                  <b>{incoming}</b> 份別人想賣你的股份
                </span>
                <button class="st-btn" onClick={() => props.onTab("stakes")}>
                  去處理
                </button>
              </div>
            )}
            {toDecide > 0 && (
              <div class="st-li">
                <span class="grow">
                  <b>{toDecide}</b> 份注資申請等你核准
                </span>
                <button class="st-btn" onClick={() => props.onTab("stakes")}>
                  去處理
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div class="st-sec">
        <h4>錢包可以做什麼</h4>
        <div class="st-list">
          <div class="st-li">
            <span class="grow">
              注資換股、開新商場
              <small>{w.foundCost === 0 ? "你還有一次免費的起始資金（開新商場或加入商場時投入）。" : `再開一座新商場要自己出資 ${moneyShort(w.foundCost)}（從個人錢包）；起始資金每位玩家只有一次。`}</small>
            </span>
          </div>
          <div class="st-li">
            <span class="grow">
              買賣股票
              <small>{MARKET_TEXT.what}</small>
            </span>
            <button class="st-btn" onClick={() => props.onTab("market")}>
              去股市
            </button>
          </div>
        </div>
        <p class="st-hint">{EQUITY_TEXT.market}</p>
      </div>
    </>
  );
}
