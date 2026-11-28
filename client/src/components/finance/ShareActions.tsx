import { BUYBACK_MAX_CASH_PCT, EQUITY_TEXT, buybackPrice, type HoldingsView } from "@coidle/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { moneyShort } from "../../format";
import { useAction } from "./useAction";
import { confirmThen, notice } from "../ConfirmHost";

const whole = (v: string) => Math.floor(Number(v));

/** 處理自己在某座商場的股份：無償轉給成員、出價賣給其他股東、撤資（請商場回購）；可以只處理一部分 */
export function ShareActions(props: { mallId: number; mallName: string; meId: number; onChanged: () => Promise<unknown> | unknown }) {
  const { mallId, meId } = props;
  const [view, setView] = useState<HoldingsView | null>(null);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const reload = async () => {
    try {
      setView(await api.holdings(mallId));
    } catch {
      setView(null);
    }
  };
  const { busy, run } = useAction(async () => {
    await reload();
    await props.onChanged();
  });
  useEffect(() => {
    void reload();
  }, [mallId]);

  const mine = view?.holders.find((h) => h.userId === meId)?.shares ?? 0;
  if (!view) return <p class="st-hint">讀取股權表…</p>;
  if (mine <= 0) return <p class="st-hint">你在這座商場已經沒有股份了。</p>;
  const others = view.people.filter((p) => p.userId !== meId);
  const shares = whole(amount);
  const target = Number(to);
  const targetPerson = others.find((p) => p.userId === target);
  const price = shares >= 1 ? buybackPrice(shares, view.mallCash, view.total) : 0;
  const needTarget = () => (targetPerson ? true : (void notice("先選一位對象"), false));
  // 股權變現門檻：自己還不合格時三個動作都不能按（對方不合格由伺服器回覆原因）
  const blocked = view.cashOutBlocker ?? null;

  return (
    <div class="st-sec">
      <p class="st-hint">{EQUITY_TEXT.exit}</p>
      {blocked && (
        <p class="st-hint" role="note" data-testid="cashout-blocker">
          🔒 目前不能撤資、出價或轉讓：{blocked}。對方也要符合同樣的條件。
        </p>
      )}
      <div class="st-row">
        <input class="st-in" type="number" min={1} max={mine} step={1} placeholder={`股數（最多 ${mine.toLocaleString()}）`} value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} aria-label="要處理的股數" />
        {[0.25, 0.5, 1].map((f) => (
          <button key={f} class="st-btn" disabled={busy} onClick={() => setAmount(String(Math.max(1, Math.floor(mine * f))))}>
            {f === 1 ? "全部" : `${f * 100}%`}
          </button>
        ))}
      </div>
      <div class="st-row">
        <button
          class="st-btn"
          disabled={busy || !!blocked || shares < 1 || shares > mine}
          title={blocked ?? undefined}
          onClick={() =>
            confirmThen(`撤資：請商場回購 ${shares.toLocaleString()} 股，商場付你 ${price.toLocaleString()}（帳面價值 9 折，進你的錢包）？一次最多動用商場現金的 ${Math.round(BUYBACK_MAX_CASH_PCT * 100)}%。`, () =>
              run(() => api.buybackShares(mallId, shares), "已撤資，錢進你的錢包"),
            )
          }
        >
          撤資{price > 0 ? `（約 ${moneyShort(price)}）` : ""}
        </button>
      </div>
      {others.length > 0 && (
        <div class="st-row">
          <select class="st-in" value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)} aria-label="對象">
            <option value="">選對象</option>
            {others.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.displayName}
                {p.isMember ? "" : "（已離開）"}
              </option>
            ))}
          </select>
          <button class="st-btn" disabled={busy || !!blocked || shares < 1 || shares > mine} title={blocked ?? undefined} onClick={() => needTarget() && run(() => api.offerShares(mallId, target, shares), "已送出出價（照帳面價值，等對方同意）")}>
            出價賣給他
          </button>
          <button
            class="st-btn"
            disabled={busy || !!blocked || shares < 1 || shares > mine || (!!targetPerson && !targetPerson.isMember)}
            title={blocked ?? undefined}
            onClick={() => needTarget() && confirmThen(`把 ${shares.toLocaleString()} 股無償轉給「${targetPerson!.displayName}」？`, () => run(() => api.transferShares(mallId, target, shares), "已轉出股份"))}
          >
            無償轉給
          </button>
        </div>
      )}
    </div>
  );
}
