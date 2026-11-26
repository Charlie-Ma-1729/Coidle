import {
  GOAL_BY_ID,
  TEAM_EVENT_BY_ID,
  WEEK_BONUS_MULT,
  goalLabel,
  goalProgress,
  type GoalPeriod,
  type PublicMallState,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { dateText, gameDeadline, money } from "../format";
import { run, state, user } from "../store";

function Period({ s, period, title, hint }: { s: PublicMallState; period: "day" | "week"; title: string; hint: string }) {
  const p: GoalPeriod = period === "day" ? s.meta.day : s.meta.week;
  return (
    <Card title={title} right={<span class="small dim">{hint}</span>}>
      {p.picks.length === 0 ? (
        <Empty>等一下就會有新的目標。</Empty>
      ) : (
        <div class="stack">
          {p.picks.map((pick) => {
            const def = GOAL_BY_ID[pick.id];
            if (!def) return null;
            const v = goalProgress(s, def, period);
            const done = pick.done || v >= pick.target;
            const shown = def.metric === "instant" ? (done ? 1 : 0) : Math.min(v, pick.target);
            return (
              <div key={pick.id}>
                <div class="row between small">
                  <span>
                    {def.icon} {goalLabel(def, pick.target)}
                  </span>
                  {pick.done ? <Chip tone="green">已領取 {money(pick.reward)}</Chip> : done ? <Chip tone="amber">達成！結算時發獎金</Chip> : <Chip tone="dim">獎金 {money(pick.reward)}</Chip>}
                </div>
                <Meter label="" value={def.metric === "instant" ? (done ? 100 : 0) : (shown / pick.target) * 100} hint={def.metric === "instant" ? (done ? "目前達成" : "目前還沒") : `${Math.round(shown).toLocaleString()}／${pick.target.toLocaleString()}`} tone={done ? "green" : "cyan"} />
              </div>
            );
          })}
          {period === "week" && p.picks.length > 0 && <p class="small dim">三項全部達成，週結算時再多拿 {Math.round((WEEK_BONUS_MULT - 1) * 100)}% 的獎金與一點口碑。沒達成沒有任何懲罰。</p>}
        </div>
      )}
    </Card>
  );
}

function TeamEvent({ s }: { s: PublicMallState }) {
  const ev = s.meta.team.event;
  const def = ev && TEAM_EVENT_BY_ID[ev.defId];
  const me = user.value ? String(user.value.id) : "";
  if (!ev || !def) {
    return (
      <Card title="🧑‍🤝‍🧑 團隊事件">
        <Empty>目前沒有需要大家合作的事。偶爾會有颱風、跨年、祭典之類的大事，需要不同的隊員各自認領一項任務。</Empty>
      </Card>
    );
  }
  const mine = ev.contributions.some((c) => c.actorId === me);
  return (
    <Card title={`${def.icon} 團隊事件：${def.title}`} right={<Chip tone="amber">{ev.contributions.length}／{ev.needed} 位</Chip>}>
      <div class="stack">
        <p class="small">{def.text}</p>
        <p class="small dim">{gameDeadline(ev.deadlineTick, s.tick)} 前・不同的隊員各認領一項，湊滿就完成；來不及也只是少一點獎勵，不會有損失。</p>
        {def.tasks.map((t) => {
          const taken = ev.contributions.find((c) => c.taskId === t.id);
          return (
            <div class="row between" key={t.id}>
              <span class="small">
                {taken ? "✅" : "⬜"} {t.label}
                <span class="dim">（{money(t.cost)}）</span>
                {taken && <span class="dim"> — {taken.name}</span>}
              </span>
              {!taken && (
                <Btn small kind="primary" disabled={mine} title={mine ? "你已經認領過一項了" : ""} onClick={() => run({ type: "contribute", taskId: t.id }, "已認領")}>
                  我來
                </Btn>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Board({ s }: { s: PublicMallState }) {
  const rows = Object.entries(s.meta.team.members)
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => b.actions + b.tasks * 5 - (a.actions + a.tasks * 5));
  return (
    <Card title="🙌 隊員貢獻" right={<span class="small dim">每個人都有貢獻</span>}>
      {rows.length === 0 ? (
        <Empty>還沒有紀錄。</Empty>
      ) : (
        <div class="stack">
          {rows.map((r) => (
            <div class="row between small" key={r.id}>
              <b>{r.name}</b>
              <span class="dim">
                做了 {r.actions} 件事・完成 {r.tasks} 項團隊任務・最近 {dateText(r.lastTick)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Goals() {
  const s = state.value;
  if (!s) return null;
  return (
    <>
      <TeamEvent s={s} />
      <Period s={s} period="day" title="🎯 今日目標" hint="一天一組，達成自動領獎金" />
      <Period s={s} period="week" title="🏁 本週團隊目標" hint="全隊一起累計" />
      <Board s={s} />
      <Card title="📜 最近達成">
        {s.meta.log.length === 0 ? (
          <Empty>還沒有紀錄。</Empty>
        ) : (
          <div class="log">
            <ul>
              {s.meta.log.slice(0, 8).map((l, i) => (
                <li key={i}>
                  <time>{dateText(l.tick)}</time>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}
