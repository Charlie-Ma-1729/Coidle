import { useEffect, useState } from "preact/hooks";
import { ALLIANCE_MAX_ACTIVE, BOARDS, NPC_BY_ID, boardValue, jointPromoCost, npcAcceptsAlliance, rankEntries, type BoardId, type DirectoryEntry, type SeasonResult } from "@coidle/shared";
import { api, type AllianceView, type WorldView } from "../api";
import { Btn, Card, Chip, Empty } from "../components/ui";
import { moneyShort } from "../format";
import { mallId, state, toast } from "../store";

const DAY = 86_400_000;
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

function valueText(e: DirectoryEntry, board: BoardId): string {
  const v = boardValue(e, board);
  return board === "revenue" ? moneyShort(v) : v.toFixed(1);
}

/** 全服公開的商場名錄：真人商場與 NPC 商場同台，排行榜、賽季與歷屆成績 */
export function World() {
  const s = state.value;
  const [view, setView] = useState<WorldView | null>(null);
  const [err, setErr] = useState("");
  const [board, setBoard] = useState<BoardId>("score");
  const [open, setOpen] = useState<string | null>(null);
  const [alliances, setAlliances] = useState<AllianceView[]>([]);
  const [busy, setBusy] = useState(false);

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
      (r) => setAlliances(r.alliances),
      () => undefined,
    );
  };
  useEffect(() => {
    void load();
    void loadAlliances();
  }, []);

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
  const myScore = view?.entries.find((e) => e.key === mine)?.score ?? 0;

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
              第 <b>{view.season.index + 1}</b> 季・還有 <b>{daysLeft}</b> 天結算。每季結算時，前三名與符合資格的參賽商場會收到獎金與稱號（NPC 商場也會上榜，但不領獎）。
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
              const left = Math.max(0, a.until - (view?.now ?? Date.now()));
              const cd = Math.max(0, a.jointReadyAt - (view?.now ?? Date.now()));
              return (
                <div class="tenant" key={a.id}>
                  <div class="row between">
                    <b>
                      {a.partnerKind === "npc" ? "🏢" : "🏬"} {a.partnerName}
                    </b>
                    <Chip tone={a.status === "active" ? "green" : "amber"}>{a.status === "active" ? "生效中" : a.direction === "in" ? "對方邀請你" : "已送出邀請"}</Chip>
                  </div>
                  <p class="small dim">
                    {a.status === "active" ? `約 ${Math.ceil(left / DAY)} 個真實日後到期（以遊戲時間算約 28 遊戲日）` : `${Math.max(1, Math.ceil(left / 3_600_000))} 小時內有效，逾時視為婉拒`}
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
                          {cd > 0 ? `聯名活動（${Math.ceil(cd / 3_600_000)} 小時後可再辦）` : `辦聯名活動 ${moneyShort(jointPromoCost(s.level))}`}
                        </Btn>
                        <Btn small disabled={busy} onClick={() => confirm(`結束和「${a.partnerName}」的聯名協議？`) && void act((id) => api.endAlliance(id, a.id), "已結束聯名")}>
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
              const npc = e.kind === "npc" ? NPC_BY_ID[e.key.slice(2)] : undefined;
              const isMine = e.key === mine;
              return (
                <div key={e.key} class="tenant" style={isMine ? { borderColor: "var(--pink, #ff5fa2)" } : undefined}>
                  <button class="linklike" style={{ textAlign: "left", width: "100%" }} onClick={() => setOpen(open === e.key ? null : e.key)}>
                    <div class="row between">
                      <b>
                        {i + 1}. {e.kind === "npc" ? "🏢" : "🏬"} {e.name}
                      </b>
                      <span>
                        {isMine && <Chip tone="pink">你</Chip>} <Chip tone={e.kind === "npc" ? "dim" : "cyan"}>{e.kind === "npc" ? "NPC" : "真人"}</Chip>
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
                      {npc && (
                        <>
                          <p>「{npc.tagline}」</p>
                          <p class="dim">{npc.bio}</p>
                        </>
                      )}
                      {!isMine && (
                        <Btn
                          small
                          disabled={busy || alliances.some((a) => a.partnerKey === e.key)}
                          onClick={() => void act((id) => api.proposeAlliance(id, e.key), e.kind === "npc" ? "簽下聯名協議" : "已送出邀請")}
                        >
                          {alliances.some((a) => a.partnerKey === e.key) ? "已有協議或邀請" : e.kind === "npc" && !npcAcceptsAlliance(e.score, myScore) ? "邀請聯名（對方可能覺得你還不夠格）" : "🤝 邀請聯名"}
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
                {r.name}（{r.kind === "npc" ? "NPC" : "真人"}・Lv.{r.level}）— {r.score.toFixed(1)} 分
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
              </p>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
