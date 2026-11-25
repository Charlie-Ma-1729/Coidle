import type { CapitalRequestView, ShareOfferView } from "@coidle/shared";
import { api } from "../../api";
import { moneyShort } from "../../format";
import type { RunAction } from "./useAction";

/** 我收到的出價（同意／拒絕）與我送出的出價（取消）。出價以編號操作，和目前在哪座商場無關 */
export function OfferRows(props: { offers: ShareOfferView[]; meId: number; mallName?: (mallId: number) => string; busy: boolean; run: RunAction }) {
  const { offers, meId, busy, run } = props;
  const where = (o: ShareOfferView) => (props.mallName ? `【${props.mallName(o.mallId)}】` : "");
  return (
    <>
      {offers
        .filter((o) => o.toId === meId)
        .map((o) => (
          <div class="st-li" key={o.id}>
            <span class="grow">
              {where(o)}
              {o.fromName} 想賣你 <b>{o.shares.toLocaleString()}</b> 股，價款 <b>{moneyShort(o.price)}</b>
              <small>照出價當下的帳面價值；你同意、而且錢包付得起才會成交</small>
            </span>
            <button class="st-btn" disabled={busy} onClick={() => run(() => api.respondOffer(o.id, true), "已買下")}>
              同意
            </button>
            <button class="st-btn" disabled={busy} onClick={() => run(() => api.respondOffer(o.id, false), "已拒絕")}>
              拒絕
            </button>
          </div>
        ))}
      {offers
        .filter((o) => o.fromId === meId)
        .map((o) => (
          <div class="st-li" key={o.id}>
            <span class="grow">
              {where(o)}我出價賣 {o.toName} <b>{o.shares.toLocaleString()}</b> 股，{moneyShort(o.price)}
              <small>等對方同意</small>
            </span>
            <button class="st-btn" disabled={busy} onClick={() => run(() => api.respondOffer(o.id, false), "已取消出價")}>
              取消
            </button>
          </div>
        ))}
    </>
  );
}

/** 注資申請：管事的人可以核准／拒絕，申請人自己可以撤回 */
export function RequestRows(props: { requests: CapitalRequestView[]; meId: number; isAuthority: (mallId: number) => boolean; mallName?: (mallId: number) => string; busy: boolean; run: RunAction }) {
  const { requests, meId, busy, run } = props;
  return (
    <>
      {requests.map((r) => {
        const decide = props.isAuthority(r.mallId) && r.userId !== meId;
        return (
          <div class="st-li" key={r.id}>
            <span class="grow">
              {props.mallName ? `【${props.mallName(r.mallId)}】` : ""}
              {r.userId === meId ? "我" : r.userName} 想投入 <b>{moneyShort(r.amount)}</b>，約換 {r.estShares.toLocaleString()} 股
            </span>
            {decide && (
              <button class="st-btn" disabled={busy} onClick={() => run(() => api.respondCapital(r.id, true), "已核准")}>
                核准
              </button>
            )}
            <button class="st-btn" disabled={busy} onClick={() => run(() => api.respondCapital(r.id, false), decide ? "已拒絕" : "已撤回")}>
              {decide ? "拒絕" : "撤回"}
            </button>
          </div>
        );
      })}
    </>
  );
}
