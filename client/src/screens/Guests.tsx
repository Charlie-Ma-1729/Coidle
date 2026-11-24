import {
  COMPLAINT_CAUSES,
  COMPLAINT_OPTIONS,
  COMPLAINT_TONES,
  EVENT_BY_ID,
  REVIEW_REPLIES,
  STANCES,
  WALK_SITUATIONS,
  complaintCost,
  defaultComplaintOption,
  guestTodoCount,
  isPaused,
  periodOf,
  ticksToRealMinutes,
  timeInfo,
  type InboxItem,
  type PublicMallState,
  type WalkVoice,
} from "@coidle/shared";
import { EventChoiceCard } from "../components/EventCards";
import { Btn, Card, Chip, Empty } from "../components/ui";
import { money, realDuration } from "../format";
import { PERSONA_ICONS } from "../icons";
import { run, state } from "../store";

const MOOD: Record<WalkVoice["mood"], { icon: string; label: string; tone: "green" | "amber" | "red" | "cyan" }> = {
  happy: { icon: "😄", label: "開心", tone: "green" },
  annoyed: { icon: "😒", label: "不耐煩", tone: "amber" },
  angry: { icon: "😡", label: "生氣", tone: "red" },
  curious: { icon: "🤔", label: "需要幫忙", tone: "cyan" },
};

const PERSONA_NAME: Record<string, string> = {
  tourist: "觀光客",
  local: "在地客",
  commuter: "上班族",
  family: "家庭",
  student: "學生",
  couple: "情侶",
};

function remaining(s: PublicMallState, deadlineTick: number): string {
  const mins = Math.max(0, Math.round(ticksToRealMinutes(deadlineTick - s.tick, s.clock.speed)));
  return mins >= 60 ? `${Math.round(mins / 6) / 10} 小時` : `${mins} 分鐘`;
}

function Stars({ n }: { n: number }) {
  return (
    <span class="stars" aria-label={`${n} 顆星`}>
      {"★".repeat(n)}
      <span class="dim">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function WalkCard({ s }: { s: PublicMallState }) {
  const t = timeInfo(s.tick);
  const open = t.hour >= s.hours.open && t.hour < s.hours.close;
  const cooldown = s.walk.nextTick - s.tick;
  const voices = s.walk.voices.filter((v) => v.expireTick >= s.tick);
  const period = periodOf(t.hour, t.weekend);
  const hint = !open
    ? "商場打烊中，店裡沒有客人可以聊。"
    : isPaused(s.clock)
      ? "時間暫停中。"
      : cooldown > 0
        ? `剛巡過場，約 ${realDuration(cooldown, s.clock.speed).replace("約 ", "")}後客人換一批再來。`
        : period === "peak"
          ? "現在是尖峰時段，客人最多、狀況也最多。"
          : "聽聽此刻店裡客人在說什麼。";
  return (
    <Card
      title="🚶 巡場"
      right={
        <Btn kind="primary" small disabled={!open || cooldown > 0} onClick={() => run({ type: "walkFloor" })}>
          巡一圈
        </Btn>
      }
    >
      <p class="small dim">{hint}</p>
      {voices.length === 0 ? (
        <Empty>{open ? "還沒巡場，或客人都已離開。" : "打烊了。"}</Empty>
      ) : (
        <div class="stack">
          {voices.map((v) => {
            const sit = WALK_SITUATIONS[v.situation];
            const shop = s.shops.find((x) => x.id === v.shopId);
            const mood = MOOD[v.mood];
            if (!sit) return null;
            return (
              <div class="voice" key={v.id}>
                <div class="row">
                  <span class="big-emoji">{PERSONA_ICONS[v.persona]}</span>
                  <Chip tone={mood.tone}>
                    {mood.icon} {mood.label}
                  </Chip>
                  <span class="small dim">
                    {PERSONA_NAME[v.persona]}・{shop?.name}
                  </span>
                </div>
                <p class="quote">「{v.text}」</p>
                <div class="row">
                  {sit.options.map((o) => (
                    <Btn key={o.id} small disabled={o.cost > s.funds} onClick={() => run({ type: "walkAct", voiceId: v.id, optionId: o.id })}>
                      {o.label}
                      {o.cost > 0 ? `（${money(o.cost)}）` : ""}
                    </Btn>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ComplaintCard({ s, item }: { s: PublicMallState; item: InboxItem }) {
  const shop = s.shops.find((x) => x.id === item.shopId);
  const cause = item.cause ? COMPLAINT_CAUSES[item.cause] : undefined;
  const tone = item.tone ? COMPLAINT_TONES[item.tone] : undefined;
  const price = shop?.price ?? 1000;
  const fallback = COMPLAINT_OPTIONS.find((o) => o.id === defaultComplaintOption(item.tone ?? "sincere", s.guestPrefs.complaintStance));
  return (
    <div class="alert red">
      <div class="row between">
        <h4>
          {cause?.icon} 客訴・{cause?.label}
        </h4>
        <span class="small dim">{remaining(s, item.deadlineTick)}內處理</span>
      </div>
      <div class="row">
        <span>{PERSONA_ICONS[item.persona]}</span>
        <span class="small dim">
          {PERSONA_NAME[item.persona]}・{shop?.name}
        </span>
        {tone && (
          <Chip tone={item.tone === "demanding" ? "red" : item.tone === "angry" ? "amber" : "green"}>
            語氣：{tone.label}
          </Chip>
        )}
      </div>
      <p class="quote">「{item.text}」</p>
      {tone && <p class="small dim">{tone.hint}</p>}
      <div class="row">
        {COMPLAINT_OPTIONS.map((o) => {
          const cost = complaintCost(o.id, price);
          return (
            <Btn key={o.id} small title={o.hint} disabled={cost > s.funds} onClick={() => run({ type: "resolveInbox", uid: item.uid, optionId: o.id }, `已處理：${o.label}`)}>
              {o.label}
              {cost > 0 ? `（${money(cost)}）` : ""}
            </Btn>
          );
        })}
      </div>
      <p class="small dim">逾時將依偏好自動：{fallback?.label}（人氣會再扣一點點）</p>
    </div>
  );
}

function ReviewCard({ s, item }: { s: PublicMallState; item: InboxItem }) {
  const shop = s.shops.find((x) => x.id === item.shopId);
  return (
    <div class="alert cyan">
      <div class="row between">
        <h4>
          <Stars n={item.stars ?? 3} /> 網路評價
        </h4>
        <span class="small dim">{remaining(s, item.deadlineTick)}內可回覆</span>
      </div>
      <p class="small dim">
        {PERSONA_ICONS[item.persona]} {PERSONA_NAME[item.persona]}
        {shop ? `・${shop.name}` : ""}
      </p>
      <p class="quote">「{item.text}」</p>
      <div class="row">
        {REVIEW_REPLIES.map((r) => (
          <Btn key={r.id} small title={r.hint} onClick={() => run({ type: "resolveInbox", uid: item.uid, optionId: r.id }, r.id === "ignore" ? "已略過" : "已回覆")}>
            {r.label}
          </Btn>
        ))}
      </div>
    </div>
  );
}

function TodoCard({ s }: { s: PublicMallState }) {
  const guestEvents = s.pending.filter((p) => EVENT_BY_ID[p.defId]?.category === "guest");
  const complaints = s.inbox.filter((i) => i.kind === "complaint");
  const reviews = s.inbox.filter((i) => i.kind === "review");
  const total = guestTodoCount(s);
  return (
    <Card title={`📬 待處理（${total}）`}>
      {total === 0 ? (
        <Empty>目前沒有客人在等你。巡一圈場，說不定有驚喜。</Empty>
      ) : (
        <div class="stack">
          {guestEvents.map((p) => (
            <EventChoiceCard key={p.uid} s={s} p={p} />
          ))}
          {complaints.map((c) => (
            <ComplaintCard key={c.uid} s={s} item={c} />
          ))}
          {reviews.map((r) => (
            <ReviewCard key={r.uid} s={s} item={r} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ReviewLog({ s }: { s: PublicMallState }) {
  return (
    <Card title="⭐ 近期評價">
      {s.reviewLog.length === 0 ? (
        <Empty>還沒有處理過的評價。</Empty>
      ) : (
        <div class="stack">
          {s.reviewLog.slice(0, 8).map((r, i) => (
            <div class="report-row" key={i}>
              <div class="row between">
                <Stars n={r.stars} />
                <span class="small dim">
                  {r.reply === null || r.reply === "ignore" ? "未回覆" : r.reply === "auto" ? "自動回覆" : `已回覆：${REVIEW_REPLIES.find((x) => x.id === r.reply)?.label}`}
                </span>
              </div>
              <p class="small">{r.text}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Prefs({ s }: { s: PublicMallState }) {
  return (
    <Card title="⚙️ 離線時的處理偏好">
      <div class="stack">
        <p class="small dim">你不在的時候，客訴會依這個偏好自動處理。</p>
        <div class="seg">
          {STANCES.map((st) => (
            <button key={st.id} class={s.guestPrefs.complaintStance === st.id ? "active" : ""} onClick={() => run({ type: "setGuestPrefs", complaintStance: st.id })}>
              <b>{st.label}</b>
              <small>{st.hint}</small>
            </button>
          ))}
        </div>
        <label class="row">
          <input type="checkbox" checked={s.guestPrefs.autoReplyReviews} onChange={(e) => run({ type: "setGuestPrefs", autoReplyReviews: (e.target as HTMLInputElement).checked })} />
          <span>評價沒人回時，自動送出禮貌的感謝回覆</span>
        </label>
      </div>
    </Card>
  );
}

export function Guests() {
  const s = state.value;
  if (!s) return null;
  return (
    <>
      <WalkCard s={s} />
      <TodoCard s={s} />
      <div class="grid two">
        <ReviewLog s={s} />
        <Prefs s={s} />
      </div>
    </>
  );
}
