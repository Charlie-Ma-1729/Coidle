import { useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  FAN_AFFINITY,
  FRIEND_MIN_AFFINITY,
  GIFT_COOLDOWN_TICKS,
  GIFT_COST,
  GREET_COOLDOWN_TICKS,
  regularIsHere,
  HELP_MIN_AFFINITY,
  KNOWN_GAIN_MULT,
  KNOWN_VISIT_MULT,
  LIFE_EVENT_BY_ID,
  LIFE_GIFT_COST,
  MEMBER_PRIVACY_MIN,
  MEMBER_RATES,
  MEMBER_TIERS,
  PERSONA_BY_ID,
  POINT_REPORT_LIMIT,
  REGULARS,
  REGULAR_BY_ID,
  REGULAR_KINDS,
  VOICE_ADOPT,
  VOICE_TOPICS,
  ZONES,
  ZONE_BY_ID,
  memberShare,
  memberTier,
  regularTier,
  type PublicMallState,
  type RegularDef,
  type RegularState,
  type RegularVoice,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { gameDeadline, gameDuration, money } from "../format";
import { categoryIcon, PERSONA_ICONS } from "../icons";
import { run, state } from "../store";

const MOOD = { happy: "😊", neutral: "🙂", upset: "😞" } as const;

function lastSeen(s: PublicMallState, r: RegularState): string {
  if (r.lastVisitTick < 0) return "還沒來過";
  const hours = (s.tick - r.lastVisitTick) / 12; // 遊戲小時
  if (hours < 1) return "剛剛";
  if (hours < 24) return `${Math.round(hours)} 遊戲小時前`;
  return `${Math.round(hours / 24)} 遊戲日前`;
}

function wait(s: PublicMallState, readyTick: number): string {
  return gameDuration(Math.max(1, readyTick - s.tick));
}

function RegularCard({ s, r, def }: { s: PublicMallState; r: RegularState; def: RegularDef }) {
  const [open, setOpen] = useState(false);
  const favCat = CATEGORY_BY_ID[def.fav];
  const kind = def.kind ? REGULAR_KINDS[def.kind] : null;
  const tier = regularTier(r.affinity);
  const greetWait = r.lastTalkTick + GREET_COOLDOWN_TICKS;
  const here = regularIsHere(r, s.tick);
  const giftWait = r.lastGiftTick + GIFT_COOLDOWN_TICKS;
  const act = (action: "greet" | "remember" | "gift", okText: string) => run({ type: "regularAction", regularId: r.id, action }, okText);
  const c = r.contrib;

  return (
    <div class="regular">
      <div class="row between">
        <div class="row">
          <span class="big-emoji">{PERSONA_ICONS[def.persona]}</span>
          <div>
            <b>{def.name}</b> <span title="心情">{MOOD[r.mood]}</span>
            <div class="small dim">
              {PERSONA_BY_ID[def.persona].name}・愛去 {categoryIcon(def.fav)} {favCat?.name}
              {favCat ? `（${ZONE_BY_ID[favCat.zone]?.name ?? ""}）` : ""}
            </div>
          </div>
        </div>
        <div class="row" style={{ gap: "4px", flexWrap: "wrap" }}>
          {kind && (
            <Chip tone="cyan" title={kind.desc}>
              {kind.icon} {kind.label}
            </Chip>
          )}
          <Chip tone={r.affinity >= FAN_AFFINITY ? "pink" : "dim"} title={tier.perk}>
            {tier.icon} {tier.label}
          </Chip>
        </div>
      </div>

      <Meter label="親密度" value={r.affinity} hint={r.affinity.toFixed(0)} tone="pink" />
      <div class="row small dim" style={{ flexWrap: "wrap", gap: "8px" }}>
        <span>來過 {r.visits} 次</span>
        <span>最近：{lastSeen(s, r)}</span>
        {r.tipsTotal > 0 && <span>小費 {money(r.tipsTotal)}</span>}
        <span>
          故事 {r.storyStage}/{def.stories.length}
        </span>
      </div>
      {c && (c.revenue > 0 || c.friends > 0 || c.feedback > 0 || c.help > 0) && (
        <div class="row small" style={{ flexWrap: "wrap", gap: "6px" }} title="這位熟客累計為你帶來的價值">
          <Chip tone="green">貢獻營收 {money(c.revenue + r.tipsTotal)}</Chip>
          {c.friends > 0 && <Chip tone="cyan">帶朋友 {c.friends} 人次</Chip>}
          {c.feedback > 0 && <Chip tone="cyan">採納意見 {c.feedback} 次</Chip>}
          {c.help > 0 && <Chip tone="pink">替你說話 {c.help} 次</Chip>}
        </div>
      )}
      <p class="small dim">
        {tier.perk}
        {r.affinity >= FRIEND_MIN_AFFINITY && r.affinity < HELP_MIN_AFFINITY ? `（親密度 ${HELP_MIN_AFFINITY} 以上才肯在危機時替你說話）` : ""}
      </p>

      {r.knowsPrefs ? (
        <div class="row" style={{ gap: "4px", flexWrap: "wrap" }}>
          {def.traits.map((t) => (
            <Chip key={t} tone="cyan">
              {t}
            </Chip>
          ))}
          <Chip tone="green" title={`被記住的人來得更勤（×${KNOWN_VISIT_MULT}）、關係成長更快（×${KNOWN_GAIN_MULT}）`}>
            ✓ 已記住喜好
          </Chip>
        </div>
      ) : null}

      <div class="row" style={{ flexWrap: "wrap" }}>
        <Btn small disabled={!here || s.tick < greetWait} title={!here ? "他現在不在店裡，上門的時候才聊得到" : s.tick < greetWait ? `${gameDeadline(greetWait, s.tick)} 起可再聊` : "免費，親密度＋1"} onClick={() => act("greet", `和${def.name}聊了幾句`)}>
          💬 招呼{!here ? "（不在店裡）" : s.tick < greetWait ? `（${wait(s, greetWait)}）` : ""}
        </Btn>
        {!r.knowsPrefs && (
          <Btn small title={`免費，親密度＋2；之後看得到他的喜好，而且被記住的人來得更勤（×${KNOWN_VISIT_MULT}）、關係成長更快（×${KNOWN_GAIN_MULT}）`} onClick={() => act("remember", "記住他的喜好了")}>
            📝 記住喜好
          </Btn>
        )}
        <Btn small disabled={s.tick < giftWait || s.funds < GIFT_COST} title="親密度＋3" onClick={() => act("gift", "送出小禮物")}>
          🎁 送小禮（{money(GIFT_COST)}）
        </Btn>
        <Btn small onClick={() => setOpen(!open)}>
          {open ? "收起" : "📖 故事"}
        </Btn>
      </div>

      {open && (
        <div class="stack">
          <p class="small dim">{def.bio}</p>
          {kind && (
            <p class="small dim">
              {kind.icon} {kind.label}：{kind.desc}
            </p>
          )}
          {def.stories.map((st, i) => (
            <div class={`story ${i < r.storyStage ? "" : "locked"}`} key={st.title}>
              {i < r.storyStage ? (
                <>
                  <b>《{st.title}》</b>
                  <p class="small">{st.text}</p>
                </>
              ) : (
                <p class="small dim">🔒 親密度達到 {st.at} 解鎖</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── 熟客的話 ─────────

function VoiceCard({ s, v }: { s: PublicMallState; v: RegularVoice }) {
  const topic = VOICE_TOPICS[v.topic];
  const life = v.topic === "life" ? LIFE_EVENT_BY_ID[v.detail ?? ""] : undefined;
  const adopt = v.topic === "life" ? null : VOICE_ADOPT[v.topic];
  const reply = (optionId: string, ok: string) => run({ type: "regularVoice", uid: v.uid, optionId }, ok);
  return (
    <div class={`alert ${v.topic === "life" ? "cyan" : "amber"}`}>
      <div class="row between">
        <h4>
          {topic.icon} {life ? `人生大事：${life.label}` : topic.label}
        </h4>
        <span class="small dim">{gameDeadline(v.deadlineTick, s.tick)} 前回應</span>
      </div>
      <p class="quote">{v.text}</p>
      <div class="row" style={{ flexWrap: "wrap" }}>
        {adopt ? (
          <>
            <Btn small disabled={adopt.cost > s.funds} title={adopt.desc} onClick={() => reply("adopt", `已採納：${adopt.label}`)}>
              採納：{adopt.label}
              {adopt.cost > 0 ? `（${money(adopt.cost)}）` : ""}
            </Btn>
            <Btn small title="免費，親密度小幅上升" onClick={() => reply("thanks", "謝謝他的意見")}>
              謝謝，我們會注意
            </Btn>
          </>
        ) : (
          <>
            <Btn small disabled={s.funds < LIFE_GIFT_COST} onClick={() => reply("gift", life?.giftLabel ?? "送上心意")}>
              {life?.giftLabel ?? "送上心意"}（{money(LIFE_GIFT_COST)}）
            </Btn>
            <Btn small title="免費，親密度小幅上升" onClick={() => reply("wish", "寫了張卡片致意")}>
              寫張卡片致意
            </Btn>
            <Btn small onClick={() => reply("skip", "沒有特別表示")}>
              沒有表示
            </Btn>
          </>
        )}
      </div>
      {adopt && <p class="small dim">{adopt.desc} 不回應的話，他會覺得被忽略。</p>}
    </div>
  );
}

export function Voices({ s }: { s: PublicMallState }) {
  const voices = s.voices ?? [];
  return (
    <Card title={`🗣️ 熟客想對你說（${voices.length}）`} right={<span class="small dim">親密度 25 以上的熟客才會直接開口</span>}>
      {voices.length === 0 ? (
        <Empty>目前沒有人在等你回應。熟起來的客人會直接告訴你哪裡可以更好，偶爾也會分享人生大事。</Empty>
      ) : (
        <div class="stack">
          {voices.map((v) => (
            <VoiceCard key={v.uid} s={s} v={v} />
          ))}
        </div>
      )}
    </Card>
  );
}

// ───────── 會員制 ─────────

export function Members({ s }: { s: PublicMallState }) {
  const m = s.members;
  const rate = m?.rate ?? 0;
  const count = m?.count ?? 0;
  const tier = memberTier(count);
  const next = MEMBER_TIERS.find((t) => t.min > count);
  const share = Math.round(memberShare(count) * 100);
  return (
    <Card title="🪪 會員制（點數卡）" right={<Chip tone="cyan">{tier.icon} {tier.name}</Chip>}>
      <div class="stack">
        <p class="small dim">
          消費累積點數、下次折抵。點數是商場欠客人的<b>負債</b>：發出去時不算成本，被兌換時才付錢；沒用完的點數慢慢失效。回饋率越高越吸引人入會，但成本也越高，邊際效益遞減。
        </p>
        <div class="seg">
          {MEMBER_RATES.map((r) => (
            <button key={r} class={rate === r ? "active" : ""} onClick={() => rate !== r && run({ type: "setMembership", rate: r }, r === 0 ? "停止發放點數" : `回饋率 ${r}%`)}>
              <b>{r === 0 ? "不發點數" : `${r}%`}</b>
              <small>{r === 0 ? "會員慢慢流失" : r >= 5 ? "最慷慨・成本最高" : r === 3 ? "常見的水準" : "小額回饋"}</small>
            </button>
          ))}
        </div>
        <div class="row small" style={{ flexWrap: "wrap", gap: "8px" }}>
          <span>
            會員 <b>{count.toLocaleString("en-US")}</b> 人（占消費者約 {share}%）
          </span>
          <span>
            未使用點數 <b>{money(m?.points ?? 0)}</b>
          </span>
          <span class="dim">
            昨日發出 {money(m?.lastDayIssued ?? 0)}・兌換 {money(m?.lastDayRedeemed ?? 0)}
          </span>
        </div>
        {next && (
          <Meter label={`距離「${next.name}」`} value={Math.min(100, (count / next.min) * 100)} hint={`${count.toLocaleString("en-US")} / ${next.min.toLocaleString("en-US")}`} tone="cyan" />
        )}
        <p class="small dim">
          {tier.icon} {tier.name}：{tier.perk}
        </p>
        {(m?.points ?? 0) >= POINT_REPORT_LIMIT && <p class="small neg">⚠ 未使用點數累計超過 {money(POINT_REPORT_LIMIT)}：依資金決済法，自家型點數要辦理申報與供託（遊戲中只做提示）。</p>}
        {count >= MEMBER_PRIVACY_MIN && <p class="small dim">🔓 會員資料是個資（個人情報保護法）：人數越多，外洩風險越高，外洩會引發法律糾紛。</p>}
      </div>
    </Card>
  );
}

// ───────── 熟客名冊 ─────────

export function Regulars() {
  const s = state.value;
  if (!s) return null;
  const [zone, setZone] = useState<string>("all");
  const metList = s.regulars.filter((r) => r.met);
  const unmet = s.regulars.filter((r) => !r.met);
  const zoneOf = (r: RegularState) => CATEGORY_BY_ID[REGULAR_BY_ID[r.id]?.fav ?? ""]?.zone ?? "";
  const shown = metList.filter((r) => zone === "all" || zoneOf(r) === zone).sort((a, b) => b.affinity - a.affinity);
  const zonesMet = ZONES.filter((z) => metList.some((r) => zoneOf(r) === z.id));
  const total = metList.reduce((a, r) => a + (r.contrib?.revenue ?? 0) + r.tipsTotal, 0);
  return (
    <>
      <Voices s={s} />
      <Members s={s} />
      <Card title={`🏮 熟客（${metList.length}/${REGULARS.length}）`} right={<span class="small dim">開的店越多元、越有機會認識各樓層的熟客</span>}>
        {metList.length === 0 ? (
          <Empty>還沒有熟客。客人喜歡上你的店之後，會漸漸變成熟面孔。</Empty>
        ) : (
          <div class="stack">
            <div class="row small" style={{ flexWrap: "wrap", gap: "6px" }}>
              <Chip tone="green">熟客累計貢獻 {money(total)}</Chip>
              <Btn small kind={zone === "all" ? "primary" : undefined} onClick={() => setZone("all")}>
                全部
              </Btn>
              {zonesMet.map((z) => (
                <Btn key={z.id} small kind={zone === z.id ? "primary" : undefined} onClick={() => setZone(z.id)}>
                  {z.name}
                </Btn>
              ))}
            </div>
            {shown.map((r) => {
              const def = REGULAR_BY_ID[r.id];
              return def ? <RegularCard key={r.id} s={s} r={r} def={def} /> : null;
            })}
          </div>
        )}
        {unmet.length > 0 && (
          <details class="unmet">
            <summary>還沒遇見的人（{unmet.length}）</summary>
            <ul>
              {unmet.map((r) => (
                <li key={r.id} class="small dim">
                  🔒 {REGULAR_BY_ID[r.id]?.hint}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </>
  );
}
