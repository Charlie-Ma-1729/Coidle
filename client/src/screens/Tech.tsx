import { useState } from "preact/hooks";
import {
  TECHS,
  TECH_BRANCHES,
  TECH_BY_ID,
  TECH_CANCEL_REFUND,
  TECH_EXP_BY_ID,
  TECH_GRADE_INFO,
  TECH_PLAN_DEFAULT,
  ANALYSIS_MAX_POINTS,
  makeAnalysisLevel,
  normalizePlan,
  planEffects,
  scoreAnalysis,
  techBlocker,
  techSlots,
  type PublicMallState,
  type TechBranch,
  type TechDef,
  type TechJob,
  type TechPlan,
} from "@coidle/shared";
import { Btn, Card, Chip, Meter } from "../components/ui";
import { gameDeadline, gameDuration, money } from "../format";
import { run, state } from "../store";

// ───────── 數據判讀（小遊戲） ─────────

const TREND = ["📉 下降", "➖ 持平", "📈 上升"] as const;

function Chart({ series }: { series: number[] }) {
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = Math.max(1, hi - lo);
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${100 - ((v - lo) / span) * 90 - 5}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "72px", background: "rgba(255,255,255,0.03)", borderRadius: "10px" }} role="img" aria-label="測量數據的折線圖">
      <polyline points={pts} fill="none" stroke="var(--cyan, #5ee)" stroke-width="1.6" vector-effect="non-scaling-stroke" />
      {series.map((v, i) => (
        <circle key={i} cx={(i / (series.length - 1)) * 100} cy={100 - ((v - lo) / span) * 90 - 5} r="1.4" fill="var(--pink)" />
      ))}
    </svg>
  );
}

/** 實驗事件：選擇怎麼處理，也可以先做數據判讀拿額外的品質點數 */
function ExperimentCard({ s, job }: { s: PublicMallState; job: TechJob }) {
  const exp = job.exp;
  const def = exp ? TECH_EXP_BY_ID[exp.kind] : undefined;
  const [answers, setAnswers] = useState<(number | undefined)[]>([undefined, undefined, undefined]);
  if (!exp || !def || job.seed === undefined) return null;
  const level = makeAnalysisLevel(job.seed);
  const done = answers.every((a) => a !== undefined);
  const preview = done ? scoreAnalysis(level, answers as number[]) : null;
  const t = TECH_BY_ID[job.id];
  return (
    <div class="alert amber">
      <div class="row between">
        <h4>
          {def.icon} {t?.name}：{def.label}
        </h4>
        <span class="small dim">{gameDeadline(exp.deadlineTick, s.tick)} 前處理</span>
      </div>
      <p class="small">{def.text}</p>
      <details open>
        <summary class="small">📊 數據判讀（選填，最多 ＋{ANALYSIS_MAX_POINTS} 品質點）</summary>
        <div class="stack">
          <p class="small dim">看三組測量數據，判斷趨勢是下降、持平還是上升。判讀得越準，成果品質越好。</p>
          {level.questions.map((q, i) => (
            <div key={i} class="stack">
              <Chart series={q.series} />
              <div class="row" style={{ gap: "6px" }}>
                {TREND.map((label, v) => (
                  <Btn key={v} small kind={answers[i] === v ? "primary" : undefined} onClick={() => setAnswers(answers.map((a, j) => (j === i ? v : a)))}>
                    {label}
                  </Btn>
                ))}
              </div>
            </div>
          ))}
          {preview !== null && <Chip tone="cyan">預估判讀 {Math.round(preview * 100)} 分（答案會連同選擇一起送出）</Chip>}
        </div>
      </details>
      <div class="stack">
        {def.options.map((o) => {
          const cost = Math.round(job.cost * o.costPct);
          return (
            <div class="row between" key={o.id} style={{ alignItems: "flex-start", gap: "8px" }}>
              <span class="small dim" style={{ flex: 1 }}>
                {o.desc}
                {o.id === def.defaultOption ? "（逾期時的預設）" : ""}
              </span>
              <Btn small disabled={cost > s.funds} onClick={() => run({ type: "techExperiment", id: job.id, optionId: o.id, ...(done ? { analysis: answers as number[] } : {}) }, o.label)}>
                {o.label}
                {cost > 0 ? `（${money(cost)}）` : ""}
              </Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Jobs({ s }: { s: PublicMallState }) {
  const slots = techSlots(s.level);
  return (
    <Card title="🔬 研究室" right={<span class="small dim">{s.tech.jobs.length}／{slots} 項進行中（離線也會繼續）</span>}>
      {s.tech.jobs.length === 0 ? (
        <p class="small dim">研究室現在是空的。選一項科技、分配資源立項——時間到了就會結案，成果有「勉強完成／優良／突破」三種等級。{slots < 2 ? "商場 Lv.5 會多一間研究室。" : ""}</p>
      ) : (
        <div class="stack">
          {s.tech.jobs.map((j) => {
            const def = TECH_BY_ID[j.id];
            const pct = Math.min(100, ((s.tick - j.startTick) / (j.endTick - j.startTick)) * 100);
            return (
              <div key={j.id} class="stack">
                <Meter label={`${def?.icon ?? ""} ${def?.name ?? j.id}`} value={pct} hint={`到${gameDeadline(j.endTick, s.tick)}`} tone="cyan" />
                <div class="row small dim" style={{ flexWrap: "wrap", gap: "6px" }}>
                  {j.plan && (
                    <Chip tone="dim">
                      速度 {j.plan.speed}／嚴謹 {j.plan.rigor}／節約 {j.plan.thrift}
                    </Chip>
                  )}
                  {j.points !== undefined && <Chip tone="cyan">成果品質 {j.points.toFixed(1)} 點</Chip>}
                  {!j.expDone && !j.exp && <span>進行到一半會遇到實驗事件</span>}
                </div>
                <ExperimentCard s={s} job={j} />
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

// ───────── 立項 ─────────

const KEYS: { k: keyof TechPlan; label: string; hint: string }[] = [
  { k: "speed", label: "⚡ 速度", hint: "縮短研發時間，但更貴" },
  { k: "rigor", label: "🧪 嚴謹", hint: "提高成果品質（更可能優良或突破）" },
  { k: "thrift", label: "💰 節約", hint: "省錢，成果較保守" },
];

function PlanEditor({ s, t, onClose }: { s: PublicMallState; t: TechDef; onClose: () => void }) {
  const [plan, setPlan] = useState<TechPlan>({ ...TECH_PLAN_DEFAULT });
  const norm = normalizePlan(plan);
  const eff = planEffects(norm);
  const cost = Math.round((t.cost * eff.costMult) / 1000) * 1000;
  const ticks = Math.round(t.ticks * eff.ticksMult);
  const set = (k: keyof TechPlan, v: number) => {
    // 動一項，其餘兩項按比例調整，總量維持 100
    const others = KEYS.map((x) => x.k).filter((x) => x !== k);
    const rest = 100 - v;
    const sum = plan[others[0]!] + plan[others[1]!];
    const a = sum > 0 ? Math.round((plan[others[0]!] / sum) * rest) : Math.round(rest / 2);
    setPlan({ ...plan, [k]: v, [others[0]!]: a, [others[1]!]: rest - a } as TechPlan);
  };
  return (
    <div class="stack" style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--line)" }}>
      <p class="small dim">立項：用 100 點資源分配三個方向（要取捨）。</p>
      {KEYS.map(({ k, label, hint }) => (
        <label key={k} class="stack">
          <span class="row between small">
            <span>
              {label}
              <span class="dim">　{hint}</span>
            </span>
            <b>{norm[k]}</b>
          </span>
          <input type="range" min={0} max={100} value={norm[k]} aria-label={label} onInput={(e) => set(k, Number((e.target as HTMLInputElement).value))} />
        </label>
      ))}
      <p class="small">
        費用 <b>{money(cost)}</b>　時間 <b>{gameDuration(ticks)}</b>　起始品質 {eff.points0.toFixed(1)} 點
      </p>
      <div class="row">
        <Btn kind="primary" disabled={s.funds < cost} onClick={() => run({ type: "startTech", id: t.id, plan: norm }, `開始研發「${t.name}」`).then(onClose)}>
          立項研發
        </Btn>
        <Btn small onClick={() => run({ type: "startTech", id: t.id }, `開始研發「${t.name}」`).then(onClose)} title="標準配置：時間與費用照表定價">
          標準（不調整）
        </Btn>
        <Btn small onClick={onClose}>
          取消
        </Btn>
      </div>
    </div>
  );
}

function TechCard({ s, t }: { s: PublicMallState; t: TechDef }) {
  const done = s.tech.done.includes(t.id);
  const job = s.tech.jobs.find((j) => j.id === t.id);
  const why = done || job ? null : techBlocker(s, t);
  const afford = s.funds >= t.cost * 0.7;
  const grade = s.tech.grades?.[t.id];
  const [planning, setPlanning] = useState(false);
  return (
    <div class={`tech ${done ? "done" : ""}`}>
      <div class="row between">
        <b>
          {t.icon} {t.name}
        </b>
        {done ? (
          <Chip tone={grade === 2 ? "pink" : grade === 1 ? "cyan" : "green"}>
            {grade !== undefined ? `${TECH_GRADE_INFO[grade]!.icon} ${TECH_GRADE_INFO[grade]!.label}` : "已完成"}
          </Chip>
        ) : job ? (
          <Chip tone="cyan">研發中</Chip>
        ) : (
          <Chip tone="dim">{money(t.cost)}</Chip>
        )}
      </div>
      <p class="small dim">{t.desc}</p>
      <p class="small">效果：{t.effectText}</p>
      {!done && !job && (
        <div class="row between">
          <span class="small dim">
            {why ?? `標準研發時間${gameDuration(t.ticks)}`}
            {t.requires.length > 0 && !why ? `（前置：${t.requires.map((r) => TECH_BY_ID[r]?.name).join("、")}）` : ""}
          </span>
          <Btn small kind="primary" disabled={!!why || !afford} title={!afford && !why ? "資金不足" : ""} onClick={() => setPlanning(!planning)}>
            {planning ? "收起" : "立項"}
          </Btn>
        </div>
      )}
      {planning && !done && !job && !why && <PlanEditor s={s} t={t} onClose={() => setPlanning(false)} />}
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
