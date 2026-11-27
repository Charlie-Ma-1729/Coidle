import { useEffect, useState } from "preact/hooks";
import { ALLIANCE_MAX_ACTIVE, RELATED_BLOCK_TEXT, BOARDS, COMPETE_SELF_MULT, COMPETE_TARGET_MULT, PERSONAS, canCompete, competeCost, CATEGORY_BY_ID, TRADE_FEE, TRADE_MAX_GOODS, TRADE_MIN_FUNDS, TRADE_MIN_GOODS, categoryHasStock, tradeLimits, boardValue, jointPromoCost, rankEntries, type BoardId, type DirectoryEntry, type SeasonResult } from "@coidle/shared";
import { api, type AllianceView, type WorldView } from "../api";
import { Btn, Card, Chip, Empty } from "../components/ui";
import { gameDeadlineAtMs, moneyShort } from "../format";
import { mallId, state, toast, worldFocus } from "../store";
import { serverTickNow } from "../serverTime";
import { confirmThen } from "../components/ConfirmHost";

const DAY = 86_400_000;
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

function valueText(e: DirectoryEntry, board: BoardId): string {
  const v = boardValue(e, board);
  return board === "revenue" ? moneyShort(v) : v.toFixed(1);
}

/** 對其他商場的支援：送錢、調貨（有手續費與每日上限，伺服器會擋） */
function TradePanel({ entry, onDone }: { entry: DirectoryEntry; onDone: () => void }) {
  const s = state.value!;
  const lim = tradeLimits(s.level);
  const [amount, setAmount] = useState(String(Math.min(100_000, lim.fundsPerTx)));
  const stocked = s.shops.filter((x) => x.mode === "direct" && !x.tenant && categoryHasStock(CATEGORY_BY_ID[x.category]!) && x.stock >= TRADE_MIN_GOODS * 2);
  const [shopId, setShopId] = useState(stocked[0]?.id ?? "");
  const [qty, setQty] = useState("50");
  const [busy, setBusy] = useState(false);
  const go = async (fn: (id: number) => Promise<unknown>, ok: string) => {
    const id = mallId.value;
    if (id === null || busy) return;
    setBusy(true);
    try {
      await fn(id);
      toast(ok, "ok");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "失敗了", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="stack" style={{ marginTop: "6px" }}>
      {entry.stockouts > 0 && <p class="small">⚠️ 對方有 <b>{entry.stockouts}</b> 間店缺貨中{entry.stockoutCats?.length ? <>（缺：<b>{entry.stockoutCats.join("、")}</b>）</> : ""}，調貨給他們能解燃眉之急。</p>}
      <p class="small dim">
        轉出的量對方只會收到 {Math.round((1 - TRADE_FEE) * 100)}%。單筆最多 {moneyShort(lim.fundsPerTx)}、每天最多 {moneyShort(lim.fundsPerDay)}；調貨最多轉出庫存的一半（{TRADE_MIN_GOODS}–{TRADE_MAX_GOODS} 份）。
      </p>
      <div class="row">
        <input type="number" min={TRADE_MIN_FUNDS} step={10_000} value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} style={{ width: "110px" }} />
        <Btn small disabled={busy} onClick={() => void go((id) => api.tradeFunds(id, entry.key, Number(amount)), "資金已送出")}>
          💴 送資金
        </Btn>
      </div>
      {stocked.length > 0 ? (
        <div class="row">
          <select value={shopId} onChange={(e) => setShopId((e.target as HTMLSelectElement).value)}>
            {stocked.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}（庫存 {Math.floor(x.stock)}）
              </option>
            ))}
          </select>
          <input type="number" min={TRADE_MIN_GOODS} max={TRADE_MAX_GOODS} value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} style={{ width: "70px" }} />
          <Btn small disabled={busy || !shopId} onClick={() => void go((id) => api.tradeGoods(id, entry.key, shopId, Number(qty)), "貨已送出")}>
            📦 調貨
          </Btn>
        </div>
      ) : (
        <p class="small dim">你的店庫存不夠多，暫時沒有可以調出去的貨。</p>
      )}
    </div>
  );
}

/** 商戰搶客：只能找等級相近的商場，或以小打大 */
function CompetePanel({ entry, shieldedUntil, onDone, defaultPersona }: { entry: DirectoryEntry; shieldedUntil: number; onDone: () => void; defaultPersona?: string }) {
  const s = state.value!;
  const [persona, setPersona] = useState<string>(defaultPersona ?? "tourist");
  const [busy, setBusy] = useState(false);
  const allowed = canCompete(s.level, entry.level);
  const shielded = shieldedUntil > Date.now();
  const cost = competeCost(s.level);
  const go = async () => {
    const id = mallId.value;
    if (id === null || busy) return;
    setBusy(true);
    try {
      const r = await api.compete(id, entry.key, persona);
      toast(`對「${r.target}」辦了搶客促銷`, "ok");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "失敗了", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="stack" style={{ marginTop: "6px" }}>
      <p class="small dim">
        ⚔️ 商戰：針對某一類客人辦促銷。你們那類客人 ×{COMPETE_SELF_MULT}、對方 ×{COMPETE_TARGET_MULT}（約 1 遊戲日）；有冷卻與每日上限。只能找等級相近的商場，或以小打大。
      </p>
      {!allowed ? (
        <p class="small">你們（Lv.{s.level}）比對方（Lv.{entry.level}）大太多，不能出手。</p>
      ) : (
        <div class="row">
          <select value={persona} onChange={(e) => setPersona((e.target as HTMLSelectElement).value)}>
            {PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Btn small kind="danger" disabled={busy || shielded} onClick={() => void go()}>
            {shielded ? "對方保護期中" : `辦搶客促銷 ${moneyShort(cost)}`}
          </Btn>
        </div>
      )}
    </div>
  );
}

/** 全服公開的商場名錄：排行榜、賽季與歷屆成績 */
export function World() {
  const s = state.value;
  const [view, setView] = useState<WorldView | null>(null);
  const [err, setErr] = useState("");
  const [board, setBoard] = useState<BoardId>("score");
  const [open, setOpen] = useState<string | null>(null);
  const [alliances, setAlliances] = useState<AllianceView[]>([]);
  /** 和你有共同經營者的商場（關係企業）：不能聯名、貿易、搶客 */
  const [related, setRelated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [focusPersona, setFocusPersona] = useState<{ key: string; persona?: string } | null>(null);

  const load = () =>
    api.world().then(
      (v) => {
        setView(v);
        setErr("");
      },
      (e) => setErr(e instanceof Error ? e.message : "讀取失敗"),
    );
  const loadAlliances = () => {
    const id = mallId.value;
    if (id === null) return Promise.resolve();
    return api.alliances(id).then(
      (r) => {
        setAlliances(r.alliances);
        setRelated(r.related ?? []);
      },
      () => undefined,
    );
  };
  useEffect(() => {
    void load();
    void loadAlliances();
  }, []);
  // 從待辦中心的「反擊」進來：直接展開對方，並預選被搶走的客群
  useEffect(() => {
    const f = worldFocus.value;
    if (!f || !view) return;
    setOpen(f.key);
    setFocusPersona(f);
    worldFocus.value = null;
    setTimeout(() => document.getElementById(`world-${f.key}`)?.scrollIntoView({ block: "center" }), 50);
  }, [view]);

  /** 跨商場的行動：成功就更新協議列表，失敗把原因顯示出來 */
  const act = async (fn: (id: number) => Promise<{ alliances: AllianceView[] } & { cost?: number }>, okText: string) => {
    const id = mallId.value;
    if (id === null || busy) return;
    setBusy(true);
    try {
      const r = await fn(id);
      setAlliances(r.alliances);
      toast(okText, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "失敗了", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!s) return null;
  const mine = `m:${mallId.value}`;
  const ranked = view ? rankEntries(view.entries, board) : [];
  const myRank = ranked.findIndex((e) => e.key === mine) + 1;
  const daysLeft = view ? Math.max(0, Math.ceil((view.season.end - view.now) / DAY)) : 0;
  const last: SeasonResult | undefined = view?.history[0];

  return (
    <>
      <Card
        title="🌐 商場名錄"
        right={
          <Btn small onClick={() => void load()}>
            重新整理
          </Btn>
        }
      >
        {err && <p class="small" style={{ color: "var(--red, #ff6b6b)" }}>{err}</p>}
        {!view && !err && <Empty>讀取中…</Empty>}
        {view && (
          <div class="stack">
            <p class="small">
              第 <b>{view.season.index + 1}</b> 季・還有 <b>{daysLeft}</b> 天結算。每季結算時，前三名與符合資格的參賽商場會收到獎金與稱號。
            </p>
            {myRank > 0 && (
              <p class="small">
                你的商場目前在「{BOARDS.find((b) => b.id === board)?.name}」排名 <b>第 {myRank}</b>／{ranked.length}。
              </p>
            )}
            <p class="small dim">這裡只看得到公開資料：名稱、等級、星級、評分、口碑、近 30 天營收與店數。對方的資金與經營細節看不到。</p>
          </div>
        )}
      </Card>

      <Card title="🤝 聯名協議" right={<Chip tone="dim">{alliances.filter((a) => a.status === "active").length}／{ALLIANCE_MAX_ACTIVE}</Chip>}>
        {alliances.length === 0 ? (
          <Empty>還沒有聯名。到下面的名錄點一座商場，邀請他們聯名：雙方互相導客（客流 +3%），還能一起辦聯名活動。</Empty>
        ) : (
          <div class="stack">
            {alliances.map((a) => {
              const nowMs = view?.now ?? Date.now();
              const nowTick = serverTickNow(s, Date.now()) ?? s.tick;
              const cd = Math.max(0, a.jointReadyAt - nowMs);
              return (
                <div class="tenant" key={a.id}>
                  <div class="row between">
                    <b>
                      🏬 {a.partnerName}
                    </b>
                    <Chip tone={a.status === "active" ? "green" : "amber"}>{a.status === "active" ? "生效中" : a.direction === "in" ? "對方邀請你" : "已送出邀請"}</Chip>
                  </div>
                  <p class="small dim">
                    {a.status === "active" ? `${gameDeadlineAtMs(a.until, nowMs, nowTick)} 到期` : `${gameDeadlineAtMs(a.until, nowMs, nowTick)} 前有效，逾時視為婉拒`}
                  </p>
                  <div class="row">
                    {a.status === "pending" && a.direction === "in" && (
                      <>
                        <Btn small kind="primary" disabled={busy} onClick={() => void act((id) => api.respondAlliance(id, a.id, true), "簽下聯名協議")}>
                          接受
                        </Btn>
                        <Btn small disabled={busy} onClick={() => void act((id) => api.respondAlliance(id, a.id, false), "已婉拒")}>
                          婉拒
                        </Btn>
                      </>
                    )}
                    {a.status === "pending" && a.direction === "out" && (
                      <Btn small disabled={busy} onClick={() => void act((id) => api.endAlliance(id, a.id), "已取消邀請")}>
                        取消邀請
                      </Btn>
                    )}
                    {a.status === "active" && (
                      <>
                        <Btn small kind="primary" disabled={busy || cd > 0} onClick={() => void act((id) => api.jointPromo(id, a.id), "聯名活動開跑")}>
                          {cd > 0 ? `聯名活動（${gameDeadlineAtMs(a.jointReadyAt, nowMs, nowTick)} 後可再辦）` : `辦聯名活動 ${moneyShort(jointPromoCost(s.level))}`}
                        </Btn>
                        <Btn small disabled={busy} onClick={() => confirmThen(`結束和「${a.partnerName}」的聯名協議？`, () => void act((id) => api.endAlliance(id, a.id), "已結束聯名"))}>
                          結束協議
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {view && (
        <Card>
          <nav class="zones" aria-label="排行榜">
            {BOARDS.map((b) => (
              <button key={b.id} class={`zone-tab ${board === b.id ? "active" : ""}`} onClick={() => setBoard(b.id)}>
                {b.icon} {b.name}
              </button>
            ))}
          </nav>
          <div class="stack" style={{ marginTop: "8px" }}>
            {ranked.map((e, i) => {
              const isMine = e.key === mine;
              return (
                <div key={e.key} id={`world-${e.key}`} class="tenant" style={isMine ? { borderColor: "var(--pink, #ff5fa2)" } : undefined}>
                  <button class="linklike" style={{ textAlign: "left", width: "100%" }} onClick={() => setOpen(open === e.key ? null : e.key)}>
                    <div class="row between">
                      <b>
                        {i + 1}. 🏬 {e.name}
                      </b>
                      <span>
                        {isMine && <Chip tone="pink">你</Chip>} {related.includes(e.key) && <Chip tone="dim">🔗 關係企業</Chip>} {(view?.shields[e.key] ?? 0) > Date.now() && <Chip tone="dim">🛡 保護中</Chip>} {e.stockouts > 0 && <Chip tone="amber">⚠️ {e.stockouts} 間缺貨{e.stockoutCats?.length ? `：${e.stockoutCats.join("、")}` : ""}</Chip>}
                      </span>
                    </div>
                    <div class="row between small dim">
                      <span>
                        Lv.{e.level}・{stars(e.stars)}
                      </span>
                      <span>
                        {BOARDS.find((b) => b.id === board)?.name} {valueText(e, board)}
                      </span>
                    </div>
                  </button>
                  {open === e.key && (
                    <div class="small" style={{ marginTop: "6px" }}>
                      {!isMine && related.includes(e.key) && <p class="small">🔗 {RELATED_BLOCK_TEXT}。</p>}
                      {!isMine && !related.includes(e.key) && <TradePanel entry={e} onDone={() => void load()} />}
                      {!isMine && !related.includes(e.key) && <CompetePanel key={focusPersona?.key === e.key ? focusPersona.persona ?? "f" : "-"} entry={e} shieldedUntil={view?.shields[e.key] ?? 0} onDone={() => void load()} defaultPersona={focusPersona?.key === e.key ? focusPersona.persona : undefined} />}
                      {!isMine && !related.includes(e.key) && (
                        <Btn
                          small
                          disabled={busy || alliances.some((a) => a.partnerKey === e.key)}
                          onClick={() => void act((id) => api.proposeAlliance(id, e.key), "已送出邀請")}
                        >
                          {alliances.some((a) => a.partnerKey === e.key) ? "已有協議或邀請" : "🤝 邀請聯名"}
                        </Btn>
                      )}
                      <p class="dim">
                        綜合分數 {e.score.toFixed(1)}・在地口碑 {e.localRep.toFixed(0)}・觀光熱度 {e.touristHeat.toFixed(0)}・近 30 天營收 {moneyShort(e.revenue30)}・{e.shops} 間店
                        {e.topCategory ? `・主力業態：${e.topCategory}` : ""}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {last && (
        <Card title={`🏆 第 ${last.season + 1} 季結果`}>
          <ol class="small" style={{ margin: 0, paddingLeft: "18px" }}>
            {last.ranking.slice(0, 5).map((r) => (
              <li key={r.key}>
                {r.name}（Lv.{r.level}）— {r.score.toFixed(1)} 分
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card title="📜 我們的賽季紀錄">
        {s.world.seasons.length === 0 ? (
          <Empty>還沒有賽季成績。第一季結算後，名次與獎金會出現在這裡。</Empty>
        ) : (
          <div class="stack">
            {s.world.seasons.map((r) => (
              <p class="small" key={r.season}>
                第 {r.season + 1} 季：第 {r.rank}／{r.of} 名・<b>{r.title}</b>・獎金 {moneyShort(r.reward)}
              </p>
            ))}
          </div>
        )}
        {s.world.notices.length > 0 && (
          <div class="stack" style={{ marginTop: "8px" }}>
            {s.world.notices.slice(0, 5).map((n, i) => (
              <p class="small dim" key={i}>
                🌐 {n.text}
                {n.from && (
                  <>
                    {" "}
                    <Btn small onClick={() => { setFocusPersona({ key: n.from!, persona: n.persona }); setOpen(n.from!); setTimeout(() => document.getElementById(`world-${n.from}`)?.scrollIntoView({ block: "center" }), 50); }}>
                      反擊
                    </Btn>
                  </>
                )}
              </p>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
