import type { PersonalEquityView, WealthView } from "@coidle/shared";
import { useState } from "preact/hooks";
import { moneyShort } from "../../format";
import { OfferRows, RequestRows } from "./rows";
import { ShareActions } from "./ShareActions";
import { useAction } from "./useAction";

/** 商場股權：我在各座商場的持股，以及跨商場的出價與注資申請；每筆持股可以展開處理（撤資、出價、轉讓） */
export function Stakes(props: { wealth: WealthView | null; equity: PersonalEquityView | null; meId: number; reload: () => Promise<unknown> }) {
  const { wealth: w, equity: eq, meId } = props;
  const [open, setOpen] = useState<number | null>(null);
  const { busy, run } = useAction(props.reload);
  if (!w || !eq) return <p class="st-hint">讀取中…</p>;
  const mallName = (id: number) => w.stakes.find((s) => s.mallId === id)?.mallName ?? `商場 #${id}`;
  const hasOffers = eq.offers.length > 0;
  return (
    <>
      <div class="st-sec">
        <h4>我的持股（{w.stakes.length}）</h4>
        {w.stakes.length === 0 ? (
          <p class="st-hint">你還沒有任何商場的股份。開一座商場（創辦人 100%）或加入朋友的商場（投入起始資金換股份）就會有。</p>
        ) : (
          <div class="st-list">
            {w.stakes.map((s) => (
              <div key={s.mallId} class="st-stake">
                <div class="st-li">
                  <span class="grow">
                    <b>{s.mallName}</b> {!s.isMember && <span class="st-tag">已離開</span>}
                    <small>
                      {s.pct}%（{s.shares.toLocaleString()} 股）≈ {moneyShort(s.value)}・商場現金 {moneyShort(s.mallCash)}
                    </small>
                  </span>
                  <button class="st-btn" aria-expanded={open === s.mallId} onClick={() => setOpen(open === s.mallId ? null : s.mallId)}>
                    {open === s.mallId ? "收起" : "處理"}
                  </button>
                </div>
                {open === s.mallId && <ShareActions mallId={s.mallId} mallName={s.mallName} meId={meId} onChanged={props.reload} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div class="st-sec">
        <h4>股份出價</h4>
        {hasOffers ? (
          <div class="st-list">
            <OfferRows offers={eq.offers} meId={meId} mallName={mallName} busy={busy} run={run} />
          </div>
        ) : (
          <p class="st-hint">沒有進行中的出價。在上面展開一筆持股，就能出價賣給其他股東。</p>
        )}
      </div>

      <div class="st-sec">
        <h4>注資申請</h4>
        {eq.requests.length > 0 ? (
          <div class="st-list">
            <RequestRows requests={eq.requests} meId={meId} isAuthority={() => true} mallName={mallName} busy={busy} run={run} />
          </div>
        ) : (
          <p class="st-hint">沒有進行中的注資申請。要注資請到該商場的「團隊」頁（需要商場成員身分）。</p>
        )}
      </div>
    </>
  );
}
