import { TECHS, TECH_BRANCHES, TECH_BY_ID, TECH_CANCEL_REFUND, techBlocker, techSlots, type PublicMallState, type TechBranch, type TechDef } from "@coidle/shared";
import { Btn, Card, Chip, Meter } from "../components/ui";
import { money, realDuration } from "../format";
import { run, state } from "../store";

function Jobs({ s }: { s: PublicMallState }) {
  const slots = techSlots(s.level);
  return (
    <Card title="🔬 研究室" right={<span class="small dim">{s.tech.jobs.length}／{slots} 項進行中（離線也會繼續）</span>}>
      {s.tech.jobs.length === 0 ? (
        <p class="small dim">研究室現在是空的。選一項科技開始研發——資金會先付掉，時間到了就會完成。{slots < 2 ? "商場 Lv.5 會多一間研究室。" : ""}</p>
      ) : (
        <div class="stack">
          {s.tech.jobs.map((j) => {
            const def = TECH_BY_ID[j.id];
            const pct = Math.min(100, ((s.tick - j.startTick) / (j.endTick - j.startTick)) * 100);
            return (
              <div key={j.id}>
                <Meter label={`${def?.icon ?? ""} ${def?.name ?? j.id}`} value={pct} hint={`還要 ${realDuration(j.endTick - s.tick, s.clock.speed)}`} tone="cyan" />
                <div class="row">
                  <Btn small kind="danger" onClick={() => run({ type: "cancelTech", id: j.id }, `已取消，退回 ${Math.round(TECH_CANCEL_REFUND * 100)}% 費用`)}>
                    取消（退回一半）
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function TechCard({ s, t }: { s: PublicMallState; t: TechDef }) {
  const done = s.tech.done.includes(t.id);
  const job = s.tech.jobs.find((j) => j.id === t.id);
  const why = done || job ? null : techBlocker(s, t);
  const afford = s.funds >= t.cost;
  return (
    <div class={`tech ${done ? "done" : ""}`}>
      <div class="row between">
        <b>
          {t.icon} {t.name}
        </b>
        {done ? <Chip tone="green">已完成</Chip> : job ? <Chip tone="cyan">研發中</Chip> : <Chip tone="dim">{money(t.cost)}</Chip>}
      </div>
      <p class="small dim">{t.desc}</p>
      <p class="small">效果：{t.effectText}</p>
      {!done && !job && (
        <div class="row between">
          <span class="small dim">
            {why ?? `研發時間${realDuration(t.ticks, s.clock.speed)}`}
            {t.requires.length > 0 && !why ? `（前置：${t.requires.map((r) => TECH_BY_ID[r]?.name).join("、")}）` : ""}
          </span>
          <Btn small kind="primary" disabled={!!why || !afford} title={!afford && !why ? "資金不足" : ""} onClick={() => run({ type: "startTech", id: t.id }, `開始研發「${t.name}」`)}>
            研發
          </Btn>
        </div>
      )}
    </div>
  );
}

export function Tech() {
  const s = state.value;
  if (!s) return null;
  return (
    <>
      <Jobs s={s} />
      {(Object.keys(TECH_BRANCHES) as TechBranch[]).map((b) => (
        <Card key={b} title={`${TECH_BRANCHES[b].icon} ${TECH_BRANCHES[b].name}`}>
          <div class="stack">
            {TECHS.filter((t) => t.branch === b).map((t) => (
              <TechCard key={t.id} s={s} t={t} />
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}
