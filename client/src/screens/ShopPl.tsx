import type { MallBreakdown, ShopLedger } from "@coidle/shared";
import { useState } from "preact/hooks";
import { Card, Chip, Empty } from "../components/ui";
import { money, moneyShort } from "../format";

type Tab = "loss" | "profit" | "all";

const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
const VERDICT_TEXT = { profit: "賺", loss: "賠", even: "持平" } as const;
const VERDICT_TONE = { profit: "green", loss: "red", even: "dim" } as const;

/** 一間店的一行：點開才看營收／成本／薪資與原因，店再多也不會一直往下滑 */
function ShopRow({ x }: { x: ShopLedger }) {
  const first = x.verdict === "loss" ? x.reasons[0]?.text : null;
  return (
    <details class={`shop-pl-row ${x.verdict}`}>
      <summary>
        <Chip tone={VERDICT_TONE[x.verdict]}>{VERDICT_TEXT[x.verdict]}</Chip>
        <span class="shop-pl-name">
          <b>{x.name}</b>
          <span class="small dim">
            {x.category}
            {x.mode === "lease" ? "・出租" : ""}
          </span>
        </span>
        <b class={x.net >= 0 ? "pos" : "neg"}>{moneyShort(x.net)}</b>
        {first && <span class="shop-pl-hint small dim">{first}</span>}
      </summary>
      <div class="shop-pl-body">
        <div class="small dim">{x.mode === "lease" ? `抽成 ${money(x.revenue)}` : `營收 ${money(x.revenue)} − 成本 ${money(x.cost)} − 薪資 ${money(x.wage)}（今天累計）＝ ${signed(x.net)}`}</div>
        <ul class="shop-pl-why">
          {x.reasons.map((r, i) => (
            <li key={i} class={r.tone}>
              {r.text}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** 各店今日損益：先看賺賠總數，再分「賠錢／賺錢／全部」三個分頁，列表在框內捲動 */
export function ShopPlCard({ mb }: { mb: MallBreakdown }) {
  const losers = mb.shops.filter((x) => x.verdict === "loss");
  const winners = mb.shops.filter((x) => x.verdict !== "loss");
  const lossSum = losers.reduce((a, x) => a + x.net, 0);
  const winSum = winners.reduce((a, x) => a + x.net, 0);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (losers.length > 0 ? "loss" : "profit");
  const list = tab === "loss" ? losers : tab === "profit" ? winners : mb.shops;
  // 賠最多的排前面；賺的賺最多的排前面
  const shown = tab === "loss" ? [...list].sort((a, b) => a.net - b.net) : list;
  const tabs: { id: Tab; label: string }[] = [
    { id: "loss", label: `賠錢 ${losers.length}` },
    { id: "profit", label: `賺錢 ${winners.length}` },
    { id: "all", label: `全部 ${mb.shops.length}` },
  ];

  return (
    <Card title="哪些店賺錢、哪些店賠錢">
      {mb.shops.length === 0 ? (
        <Empty>還沒有店面。</Empty>
      ) : (
        <div class="shop-pl">
          <div class="shop-pl-sum">
            <div>
              <span class="small dim">賺錢的 {winners.length} 間</span>
              <b class="pos">{signed(winSum)}</b>
            </div>
            <div>
              <span class="small dim">賠錢的 {losers.length} 間</span>
              <b class={losers.length > 0 ? "neg" : ""}>{signed(lossSum)}</b>
            </div>
          </div>

          <div class="shop-pl-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? "active" : ""} onClick={() => setPicked(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div class="shop-pl-list">
            {shown.length === 0 ? <Empty>{tab === "loss" ? "目前沒有賠錢的店 🎉" : "目前沒有賺錢的店。"}</Empty> : shown.map((x) => <ShopRow key={x.id} x={x} />)}
          </div>

          <div class="ledger">
            <div class="total">
              <span>各店損益合計</span>
              <b class={mb.shopsNet >= 0 ? "pos" : "neg"}>{signed(mb.shopsNet)}</b>
            </div>
            <div>
              <span>− 共用成本（水電、清潔維護、專屬座位；不分攤到各店）</span>
              <b>{money(mb.publicCosts)}</b>
            </div>
            <div>
              <span>− 其他支出（研發、活動、客訴、科技、維修罰款…）</span>
              <b>{money(mb.otherCosts)}</b>
            </div>
            <div class="total">
              <span>＝ 今日營運損益</span>
              <b class={mb.operating >= 0 ? "pos" : "neg"}>{signed(mb.operating)}</b>
            </div>
          </div>
        </div>
      )}
      <p class="small dim" style={{ marginTop: "8px" }}>
        店面損益＝營收 − 賣出成本 − 薪資。薪資是整天均攤的，所以早上還沒開門或客人還沒來的時候，每間店都會先是負的，到了尖峰時段才會慢慢賺回來。看「今天打烊後」的數字最準。點一間店可以展開看原因。
      </p>
    </Card>
  );
}
