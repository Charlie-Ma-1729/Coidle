import {
  CAMPAIGNS,
  PERSONA_BY_ID,
  PERSONA_IDS,
  RIVALS,
  RIVAL_AUTO_AGGRESSIVE_COST,
  RIVAL_AUTO_DEFENSE_COST,
  RIVAL_BY_ID,
  RIVAL_COUNTER_COST,
  RIVAL_INTEL_COST,
  RIVAL_PACT_COST,
  playerAppeal,
  playerScore,
  rivalAppealNow,
  rivalMult,
  rivalScore,
  ticksToRealMinutes,
  type PersonaId,
  type PublicMallState,
  type RivalState,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { clockText, dateText, money } from "../format";
import { PERSONA_ICONS } from "../icons";
import { mallInfo, run, state } from "../store";

const STANCE = [
  { id: "defend" as const, label: "防守", hint: `對手出招時自動應對，衝擊減半（花 ${money(RIVAL_AUTO_DEFENSE_COST)}）` },
  { id: "neutral" as const, label: "對等", hint: "不自動出手，自己看著辦" },
  { id: "aggressive" as const, label: "進攻", hint: `自動反擊，衝擊減半還打響名號（花 ${money(RIVAL_AUTO_AGGRESSIVE_COST)}）` },
];

function left(s: PublicMallState, tick: number): string {
  const m = Math.max(1, Math.round(ticksToRealMinutes(tick - s.tick, s.clock.speed)));
  return m >= 60 ? `約 ${Math.round(m / 6) / 10} 小時` : `約 ${m} 分鐘`;
}

function Ranking({ s }: { s: PublicMallState }) {
  const mine = playerScore(s);
  const rows = [
    { id: "me", name: `${mallInfo.value?.name ?? "你的商場"}（你）`, score: mine, mine: true, campaign: null as null | string },
    ...s.rivals.list.map((r) => ({
      id: r.id,
      name: RIVAL_BY_ID[r.id]?.name ?? r.id,
      score: rivalScore(r, s.tick),
      mine: false,
      campaign: r.campaign && r.campaign.endTick > s.tick ? `${CAMPAIGNS[r.campaign.kind].icon} ${CAMPAIGNS[r.campaign.kind].name}` : null,
    })),
  ].sort((a, b) => b.score - a.score);
  return (
    <Card title="🏆 商場評鑑榜" right={<span class="small dim">綜合吸引力</span>}>
      <div class="stack">
        {rows.map((r, i) => (
          <div class={`rank ${r.mine ? "mine" : ""}`} key={r.id}>
            <span class="rank-n">{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div class="row between small">
                <b>{r.name}</b>
                <span>{r.score.toFixed(1)}</span>
              </div>
              <div class="meter-track">
                <div class={`meter-fill ${r.mine ? "tone-pink" : "tone-cyan"}`} style={{ width: `${Math.min(100, r.score)}%` }} />
              </div>
              {r.campaign && <span class="small dim">{r.campaign}進行中</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Market({ s }: { s: PublicMallState }) {
  return (
    <Card title="📊 各客群的競爭力" right={<span class="small dim">你 vs 對手平均 → 客流倍率</span>}>
      <div class="stack">
        {PERSONA_IDS.map((p: PersonaId) => {
          const me = playerAppeal(s, p);
          const mean = s.rivals.list.reduce((a, r) => a + rivalAppealNow(r, p, s.tick), 0) / Math.max(1, s.rivals.list.length);
          const m = rivalMult(s, p);
          return (
            <div class="row between small" key={p}>
              <span>
                {PERSONA_ICONS[p]} {PERSONA_BY_ID[p].name}
              </span>
              <span class="dim">
                {me.toFixed(0)} vs {mean.toFixed(0)}
              </span>
              <Chip tone={m >= 1.02 ? "green" : m <= 0.98 ? "red" : "dim"}>客流 ×{m.toFixed(2)}</Chip>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RivalCard({ s, r }: { s: PublicMallState; r: RivalState }) {
  const def = RIVAL_BY_ID[r.id];
  if (!def) return null;
  const c = r.campaign && r.campaign.endTick > s.tick ? r.campaign : null;
  const intel = r.intelUntil > s.tick;
  const pact = r.pactUntil > s.tick;
  const strong = PERSONA_IDS.slice()
    .sort((a, b) => (def.profile[b] ?? 1) - (def.profile[a] ?? 1))
    .slice(0, 2);
  return (
    <div class="rival">
      <div class="row between">
        <div>
          <b>{def.name}</b>
          <div class="small dim">{def.tagline}</div>
        </div>
        <div class="row" style={{ gap: "4px" }}>
          {pact && <Chip tone="green">🤝 合作中</Chip>}
          {c && (
            <Chip tone={c.kind === "scandal" ? "cyan" : "red"}>
              {CAMPAIGNS[c.kind].icon} {CAMPAIGNS[c.kind].name}
            </Chip>
          )}
        </div>
      </div>
      <p class="small dim">{def.bio}</p>
      <div class="row small">
        <span class="dim">強項客群：</span>
        {strong.map((p) => (
          <Chip key={p} tone="cyan">
            {PERSONA_ICONS[p]} {PERSONA_BY_ID[p].name}
          </Chip>
        ))}
      </div>
      {c && (
        <p class="small">
          {intel ? (
            <>
              情報：衝擊{c.factor < 1 ? "（已被反制削弱）" : ""}，還剩{left(s, c.endTick)}；
              {Object.entries(c.boost)
                .filter(([, v]) => v !== 0)
                .map(([p, v]) => `${PERSONA_ICONS[p]}${(v as number) > 0 ? "+" : ""}${Math.round((v as number) * c.factor)}`)
                .join(" ")}
            </>
          ) : (
            <span class="dim">對方正在辦活動——刺探情報可以知道衝擊有多大、還會持續多久。</span>
          )}
        </p>
      )}
      {intel && (
        <div class="stack">
          <p class="small dim">🕵️ 情報有效至 {dateText(r.intelUntil)} {clockText(r.intelUntil)}：</p>
          <div class="grid two">
            {PERSONA_IDS.map((p) => (
              <Meter key={p} label={`${PERSONA_ICONS[p]} ${PERSONA_BY_ID[p].name}`} value={rivalAppealNow(r, p, s.tick)} hint={rivalAppealNow(r, p, s.tick).toFixed(0)} tone="cyan" />
            ))}
          </div>
        </div>
      )}
      <div class="row">
        <Btn small disabled={intel} onClick={() => run({ type: "rivalIntel", rivalId: r.id }, "情報到手")} title="看得到對手的細節與活動衝擊">
          🕵️ 刺探（{money(RIVAL_INTEL_COST)}）
        </Btn>
        <Btn small disabled={pact} onClick={() => run({ type: "rivalPact", rivalId: r.id }, "合作協議簽成")} title="協議期間對方不會對你出招，你的客流還多一點點">
          🤝 合作（{money(RIVAL_PACT_COST)}）
        </Btn>
        <Btn small disabled={!c || c.kind === "scandal" || c.factor < 1} onClick={() => run({ type: "rivalCounter", rivalId: r.id }, "反制上線")} title="讓這場活動對你的衝擊減半">
          🛡 反制（{money(RIVAL_COUNTER_COST)}）
        </Btn>
      </div>
    </div>
  );
}

export function Rivals() {
  const s = state.value;
  if (!s) return null;
  return (
    <>
      <Ranking s={s} />
      <Market s={s} />
      <Card title="⚔️ 商戰姿態" right={<span class="small dim">離線時怎麼應對對手</span>}>
        <div class="seg">
          {STANCE.map((st) => (
            <button key={st.id} class={s.rivals.stance === st.id ? "active" : ""} onClick={() => run({ type: "setRivalStance", stance: st.id })}>
              <b>{st.label}</b>
              <small>{st.hint}</small>
            </button>
          ))}
        </div>
      </Card>
      <Card title="🏙 附近的對手">
        <div class="stack">
          {RIVALS.map((d) => {
            const r = s.rivals.list.find((x) => x.id === d.id);
            return r ? <RivalCard key={r.id} s={s} r={r} /> : null;
          })}
        </div>
      </Card>
      <Card title="📰 商戰快訊">
        {s.rivals.news.length === 0 ? (
          <Empty>目前風平浪靜。對手每隔幾個遊戲日就會有動作。</Empty>
        ) : (
          <div class="log">
            <ul>
              {s.rivals.news.slice(0, 8).map((n, i) => (
                <li key={i}>
                  <time>
                    {dateText(n.tick).split(" ")[0]} {clockText(n.tick)}
                  </time>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}
