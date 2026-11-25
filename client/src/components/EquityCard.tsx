import { CONTROLLER_TITLE, DIVIDEND_MIN, EQUITY_TEXT, sharesForCapital, type CapitalRequestView, type HoldingsView } from "@coidle/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Btn, Card, Chip, Empty } from "./ui";
import { moneyShort } from "../format";
import { errMsg, mallId, mallInfo, openPersonal, toast, user } from "../store";

const whole = (v: string) => Math.floor(Number(v));

/**
 * 這座商場的股權：股權表、注資換股、股利。
 * 「我自己的錢與股份」（賣出、撤資、出價、錢包、持股價值）不在這裡，集中在「個人財務」視窗。
 */
export function EquityCard() {
  const id = mallId.value;
  const info = mallInfo.value;
  const me = user.value;
  const [view, setView] = useState<HoldingsView | null>(null);
  const [requests, setRequests] = useState<CapitalRequestView[]>([]);
  const [capital, setCapital] = useState("");
  const [dividend, setDividend] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (id === null) return;
    try {
      const [v, o] = await Promise.all([api.holdings(id), api.shareOffers(id)]);
      setView(v);
      setRequests(o.requests);
    } catch {
      // 讀不到就維持現狀，不打擾
    }
  };
  useEffect(() => {
    void refresh();
  }, [id, info?.members.length]);

  if (id === null || !info || !me) return null;
  const mine = view?.holders.find((h) => h.userId === me.id)?.shares ?? 0;
  const myMember = info.members.find((m) => m.userId === me.id);
  const hasController = info.members.some((m) => m.isController);
  const isAuthority = hasController ? !!myMember?.isController : !!myMember?.isOwner;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, "ok");
      await refresh();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const capNum = whole(capital);
  const capEst = view && capNum >= 1 ? sharesForCapital(capNum, view.mallCash, view.total) : null;
  const divMax = view?.dividendMax ?? 0;
  const divReadyAt = view?.dividendReadyAt ?? 0;

  return (
    <Card title="📊 股權" right={view ? <Chip tone="dim">流通 {view.total.toLocaleString()} 股</Chip> : undefined}>
      <div class="stack">
        <p class="small dim">{EQUITY_TEXT.founder}</p>
        {!view || view.holders.length === 0 ? (
          <Empty>還沒有股東資料。</Empty>
        ) : (
          <>
            {view.holders.map((h) => {
              const m = info.members.find((x) => x.userId === h.userId);
              return (
                <div class="member" key={h.userId}>
                  <div>
                    <b>{h.displayName}</b> {h.userId === me.id && <Chip tone="pink">我</Chip>} {h.isController && <Chip tone="green">{CONTROLLER_TITLE}</Chip>}{" "}
                    {m?.isOwner && <Chip tone="amber">創辦人</Chip>} {!h.isMember && <Chip tone="dim">已離開</Chip>} {h.shares >= view.relatedAt && <Chip tone="amber">≥20%</Chip>}
                  </div>
                  <div class="small">
                    <b>{h.pct}%</b> <span class="dim">（{h.shares.toLocaleString()} 股）</span>
                  </div>
                </div>
              );
            })}
            {view.treasury > 0 && (
              <div class="member">
                <div>
                  <b>商場庫藏股</b> <Chip tone="dim">不領股利</Chip>
                </div>
                <div class="small">
                  <b>{view.treasury.toLocaleString()} 股</b> <span class="dim">（不計入比例）</span>
                </div>
              </div>
            )}
            <p class="small dim">
              每股約 {moneyShort(view.sharePrice)}（商場現金 {moneyShort(view.mallCash)} ÷ 總股數）。
            </p>
          </>
        )}
        <p class="small dim">{EQUITY_TEXT.control}</p>
        <p class="small dim">{EQUITY_TEXT.related}</p>

        {mine > 0 && (
          <div class="row between">
            <span class="small">
              你持有 <b>{mine.toLocaleString()}</b> 股。賣出、撤資、出價與你的錢包都在「個人財務」。
            </span>
            <Btn small onClick={() => openPersonal("stakes")}>
              個人財務
            </Btn>
          </div>
        )}

        {myMember && (
          <div class="stack">
            <b class="small">注資換股</b>
            <p class="small dim">{EQUITY_TEXT.capital}</p>
            <div class="row" style={{ gap: "6px", flexWrap: "wrap" }}>
              <input type="number" min={1} step={1} placeholder="投入金額" style={{ width: "140px" }} value={capital} onInput={(e) => setCapital((e.target as HTMLInputElement).value)} />
              <span class="small dim">{capEst ? (capEst.shares >= 1 ? `約換 ${capEst.shares.toLocaleString()} 股（花 ${moneyShort(capEst.cost)}）` : "這筆錢換不到 1 股") : ""}</span>
              <Btn
                small
                disabled={busy || !capEst || capEst.shares < 1}
                onClick={() =>
                  run(async () => {
                    const r = await api.requestCapital(id, capNum);
                    toast(r.applied ? `已成交，取得 ${r.shares.toLocaleString()} 股` : "已送出申請，等管事的人同意", "ok");
                    setCapital("");
                  }, "完成")
                }
              >
                {isAuthority ? "注資" : "申請注資"}
              </Btn>
            </div>
            {requests.map((r) => (
              <div class="member" key={r.id}>
                <div class="small">
                  {r.userName} 想投入 <b>{moneyShort(r.amount)}</b>，約換 {r.estShares.toLocaleString()} 股
                </div>
                <div class="row" style={{ gap: "6px" }}>
                  {isAuthority && (
                    <Btn small disabled={busy} onClick={() => run(() => api.respondCapital(r.id, true), "已核准")}>
                      核准
                    </Btn>
                  )}
                  <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api.respondCapital(r.id, false), isAuthority && r.userId !== me.id ? "已拒絕" : "已撤回")}>
                    {isAuthority && r.userId !== me.id ? "拒絕" : "撤回"}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}

        {isAuthority && view && (
          <div class="stack">
            <b class="small">股利</b>
            <p class="small dim">{EQUITY_TEXT.dividend}</p>
            {divMax >= DIVIDEND_MIN ? (
              <div class="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                <input type="number" min={DIVIDEND_MIN} max={divMax} step={1} placeholder={`最多 ${divMax.toLocaleString()}`} style={{ width: "150px" }} value={dividend} onInput={(e) => setDividend((e.target as HTMLInputElement).value)} />
                <Btn
                  small
                  disabled={busy || whole(dividend) < DIVIDEND_MIN}
                  onClick={() => confirm(`發放股利 ${whole(dividend).toLocaleString()}，按持股分給所有股東（收到時扣 20% 所得稅）？`) && run(async () => void (await api.declareDividend(id, whole(dividend))), "股利已發放")}
                >
                  發股利
                </Btn>
              </div>
            ) : (
              <p class="small dim">{divReadyAt > 0 ? `還在冷卻，約 ${new Date(divReadyAt).toLocaleString()} 之後才能再發。` : "商場現金不足，這次發不出股利。"}</p>
            )}
          </div>
        )}
        <p class="small dim">{EQUITY_TEXT.market}</p>
      </div>
    </Card>
  );
}
