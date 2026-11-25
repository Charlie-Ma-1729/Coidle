import { LEDGER_LABEL, type LedgerEntry, type LedgerKind } from "@coidle/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { moneySigned, money, timeText } from "../../format";

const GROUPS: { id: string; label: string; kinds: LedgerKind[] | null }[] = [
  { id: "all", label: "全部", kinds: null },
  { id: "stock", label: "股票", kinds: ["stock_buy", "stock_sell"] },
  { id: "mall", label: "商場股權", kinds: ["share_sale", "share_buy", "buyback", "capital", "founding"] },
  { id: "dividend", label: "股利", kinds: ["dividend"] },
];

/** 明細：錢包的每一筆進出（最近 100 筆），可依類別篩選 */
export function Ledger(props: { version: number }) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [group, setGroup] = useState("all");
  useEffect(() => {
    let alive = true;
    api
      .ledger(100)
      .then((r) => alive && setEntries(r.entries))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [props.version]);
  if (!entries) return <p class="st-hint">讀取中…</p>;
  const kinds = GROUPS.find((g) => g.id === group)?.kinds;
  const shown = kinds ? entries.filter((e) => kinds.includes(e.kind)) : entries;
  return (
    <>
      <div class="st-row" role="group" aria-label="篩選">
        {GROUPS.map((g) => (
          <button key={g.id} class={`st-btn${group === g.id ? " on" : ""}`} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p class="st-hint">{entries.length === 0 ? "錢包還沒有任何進出。賣股份、撤資、領股利、買賣股票之後，這裡會有紀錄（這個功能上線之前的進出沒有紀錄）。" : "這個類別沒有紀錄。"}</p>
      ) : (
        <div class="st-list">
          {shown.map((e) => (
            <div class="st-li" key={e.id}>
              <span class="grow">
                <b>{LEDGER_LABEL[e.kind] ?? e.kind}</b>
                <small>
                  {timeText(e.at)}
                  {e.note ? `・${e.note}` : ""}
                </small>
              </span>
              <span class="st-amt">
                <b class={e.amount >= 0 ? "up" : "down"}>{moneySigned(e.amount)}</b>
                <small>餘額 {money(e.balanceAfter)}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
