import { useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  FAN_AFFINITY,
  GIFT_COOLDOWN_TICKS,
  GIFT_COST,
  GREET_COOLDOWN_TICKS,
  PERSONA_BY_ID,
  REGULARS,
  REGULAR_BY_ID,
  RESERVE_FEE,
  RESERVE_MIN_AFFINITY,
  RESERVE_UPKEEP_PER_DAY,
  ticksToRealMinutes,
  type PublicMallState,
  type RegularDef,
  type RegularState,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { money } from "../format";
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
  const m = Math.round(ticksToRealMinutes(readyTick - s.tick, s.clock.speed));
  return m >= 60 ? `約 ${Math.round(m / 6) / 10} 小時` : `約 ${Math.max(1, m)} 分鐘`;
}

function RegularCard({ s, r, def }: { s: PublicMallState; r: RegularState; def: RegularDef }) {
  const [open, setOpen] = useState(false);
  const favCat = CATEGORY_BY_ID[def.fav];
  const greetWait = r.lastTalkTick + GREET_COOLDOWN_TICKS;
  const giftWait = r.lastGiftTick + GIFT_COOLDOWN_TICKS;
  const act = (action: "greet" | "remember" | "gift" | "reserve" | "unreserve", okText: string) =>
    run({ type: "regularAction", regularId: r.id, action }, okText);

  return (
    <div class="regular">
      <div class="row between">
        <div class="row">
          <span class="big-emoji">{PERSONA_ICONS[def.persona]}</span>
          <div>
            <b>{def.name}</b> <span title="心情">{MOOD[r.mood]}</span>
            <div class="small dim">
              {PERSONA_BY_ID[def.persona].name}・愛去 {categoryIcon(def.fav)} {favCat?.name}
            </div>
          </div>
        </div>
        <div class="row" style={{ gap: "4px" }}>
          {r.affinity >= FAN_AFFINITY && <Chip tone="pink">❤ 熟客</Chip>}
          {r.reserved && <Chip tone="amber">專屬座位</Chip>}
        </div>
      </div>

      <Meter label="親密度" value={r.affinity} hint={r.affinity.toFixed(0)} tone="pink" />
      <div class="row small dim">
        <span>來過 {r.visits} 次</span>
        <span>最近：{lastSeen(s, r)}</span>
        {r.tipsTotal > 0 && <span>小費累計 {money(r.tipsTotal)}</span>}
        <span>
          故事 {r.storyStage}/{def.stories.length}
        </span>
      </div>

      {r.knowsPrefs && (
        <div class="row" style={{ gap: "4px" }}>
          {def.traits.map((t) => (
            <Chip key={t} tone="cyan">
              {t}
            </Chip>
          ))}
        </div>
      )}

      <div class="row">
        <Btn small disabled={s.tick < greetWait} title={s.tick < greetWait ? `約 ${wait(s, greetWait)}後可再聊` : "免費，親密度＋1"} onClick={() => act("greet", `和${def.name}聊了幾句`)}>
          💬 招呼{s.tick < greetWait ? `（${wait(s, greetWait)}）` : ""}
        </Btn>
        {!r.knowsPrefs && (
          <Btn small title="免費，一次性，親密度＋2；之後看得到他的喜好" onClick={() => act("remember", "記住他的喜好了")}>
            📝 記住喜好
          </Btn>
        )}
        <Btn small disabled={s.tick < giftWait || s.funds < GIFT_COST} title="親密度＋3" onClick={() => act("gift", "送出小禮物")}>
          🎁 送小禮（{money(GIFT_COST)}）
        </Btn>
        {r.reserved ? (
          <Btn small onClick={() => act("unreserve", "取消專屬座位")}>
            取消專屬座位
          </Btn>
        ) : (
          <Btn small disabled={r.affinity < RESERVE_MIN_AFFINITY || s.funds < RESERVE_FEE} title={`親密度需 ${RESERVE_MIN_AFFINITY}；每日維持費 ${money(RESERVE_UPKEEP_PER_DAY)}；來得更勤、小費更多`} onClick={() => act("reserve", "保留專屬座位")}>
            🪑 專屬座位（{money(RESERVE_FEE)}）
          </Btn>
        )}
        <Btn small onClick={() => setOpen(!open)}>
          {open ? "收起" : "📖 故事"}
        </Btn>
      </div>

      {open && (
        <div class="stack">
          <p class="small dim">{def.bio}</p>
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

export function Regulars() {
  const s = state.value;
  if (!s) return null;
  const metList = s.regulars.filter((r) => r.met);
  const unmet = s.regulars.filter((r) => !r.met);
  return (
    <Card title={`🏮 常客（${metList.length}/${REGULARS.length}）`} right={<span class="small dim">開的店越多元，越能遇見新朋友</span>}>
      {metList.length === 0 ? (
        <Empty>還沒有常客。客人喜歡上你的店之後，會漸漸變成熟面孔。</Empty>
      ) : (
        <div class="stack">
          {metList.map((r) => {
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
  );
}
