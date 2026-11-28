import { useState } from "preact/hooks";
import {
  CLASS_OPEN_COST,
  CLASS_SEATS,
  GROUP_FEE,
  GROUP_MIN_LEVEL,
  GROUP_MIN_REVENUE,
  GROUP_NAME_MAX,
  STAFFING_EVENT_BY_ID,
  STAFF_HIRE_COST,
  STAFF_RELEASE_DAYS,
  STAFF_WAGE,
  VENTURE_DEFS,
  calendarDay,
  cleanGroupName,
  dayOfTick,
  dispatchSeason,
  maxClasses,
  maxWorkers,
  staffingPayroll,
  trainingSeason,
  trainingSkillBonus,
  type PublicMallState,
  type StaffingLine,
  type StaffingState,
} from "@coidle/shared";
import { Btn, Card, Chip, Field } from "../components/ui";
import { money } from "../format";
import { run, state } from "../store";

/** 集團：設立、命名、開辦事業；第一個事業是人力派遣・教育 */
export function Group() {
  const s = state.value;
  if (!s) return null;
  return s.group ? <Founded s={s} /> : <Found s={s} />;
}

function Found({ s }: { s: PublicMallState }) {
  const [name, setName] = useState("");
  const okLevel = s.level >= GROUP_MIN_LEVEL;
  const okRev = s.totalRevenue >= GROUP_MIN_REVENUE;
  const okFunds = s.funds >= GROUP_FEE;
  const clean = cleanGroupName(name);
  const can = okLevel && okRev && okFunds && !!clean;
  const row = (ok: boolean, text: string) => (
    <li class={ok ? "" : "dim"}>
      {ok ? "✅" : "⬜"} {text}
    </li>
  );
  return (
    <Card title="🏢 設立集團">
      <div class="stack">
        <p class="small dim">商場賺夠了，可以設立集團：商場成為母公司，之後可以開辦事業（子公司）、自己挑想玩的玩。設立後，掌權者可以任命各事業的經營者。</p>
        <ul class="small">
          {row(okLevel, `商場 Lv.${GROUP_MIN_LEVEL} 以上（目前 Lv.${s.level}）`)}
          {row(okRev, `累計營收 ${money(GROUP_MIN_REVENUE)}（目前 ${money(s.totalRevenue)}）`)}
          {row(okFunds, `資金足夠付設立費 ${money(GROUP_FEE)}（登記與專家費用）`)}
        </ul>
        <Field label="集團名稱" hint={`1–${GROUP_NAME_MAX} 個字；不要用真實的企業或品牌名`}>
          <input type="text" value={name} maxLength={GROUP_NAME_MAX} placeholder="例：朝日集團" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </Field>
        <Btn kind="primary" disabled={!can} onClick={() => run({ type: "foundGroup", name }, "集團設立了！")}>
          設立集團（{money(GROUP_FEE)}）
        </Btn>
        <p class="small dim">只有掌權者（持股過半的實際控制人，沒有的話是創辦人）可以設立。</p>
      </div>
    </Card>
  );
}

function Founded({ s }: { s: PublicMallState }) {
  const g = s.group!;
  const [name, setName] = useState(g.name);
  return (
    <div class="stack">
      <Card title={`🏢 ${g.name}`} right={<Chip tone="cyan">母公司：本商場</Chip>}>
        <div class="row">
          <input type="text" value={name} maxLength={GROUP_NAME_MAX} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <Btn small disabled={!cleanGroupName(name) || name.trim() === g.name} onClick={() => run({ type: "renameGroup", name }, "已改名")}>
            改集團名
          </Btn>
        </div>
        <p class="small dim">事業是集團的子公司，收支併進商場的日報與稅；各事業的資金都在公司現金裡，沒有新的資金進出路徑。</p>
      </Card>
      {VENTURE_DEFS.map((def) => {
        const v = s.ventures?.[def.kind];
        if (v) return <Staffing key={def.kind} s={s} v={v} />;
        const ok = s.level >= def.minLevel && s.funds >= def.cost;
        return (
          <Card key={def.kind} title={`${def.icon} ${def.name}`}>
            <div class="stack">
              <p class="small">{def.blurb}</p>
              <Btn kind="primary" disabled={!ok} onClick={() => run({ type: "foundVenture", kind: def.kind }, `開辦了「${def.name}」`)}>
                開辦（{money(def.cost)}）
              </Btn>
              {!ok && <p class="small dim">{s.level < def.minLevel ? `商場要達到 Lv.${def.minLevel}` : "資金不足"}。只有掌權者可以開辦。</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

const MONTH_HINT: Record<number, string> = { 4: "四月：新年度與新學期，兩條線都最旺", 12: "年末：派遣補人旺季", 8: "盛夏：派遣較淡，夏季講習不錯", 9: "九月：新學期", 1: "一月：受験期，課程不錯" };

function Staffing({ s, v }: { s: PublicMallState; v: StaffingState }) {
  const [workers, setWorkers] = useState(v.workers);
  const [classes, setClasses] = useState(v.classes);
  const mw = maxWorkers(s.level);
  const mc = maxClasses(s.level);
  const hireCost = workers > v.workers ? (workers - v.workers) * STAFF_HIRE_COST : (v.workers - workers) * STAFF_WAGE * STAFF_RELEASE_DAYS;
  const classCost = classes > v.classes ? (classes - v.classes) * CLASS_OPEN_COST : 0;
  const total = hireCost + classCost;
  const changed = workers !== v.workers || classes !== v.classes;
  const last = v.last;
  const month30 = v.hist.reduce((a, r) => a + r.revenue - r.cost, 0);
  const day = dayOfTick(s.tick); // 只用來顯示季節提示
  const seasonNow = `${dispatchSeason(day).toFixed(2)}×（派遣）／${trainingSeason(day).toFixed(2)}×（課程）`;
  const ev = v.event ? STAFFING_EVENT_BY_ID[v.event.id] : undefined;
  const focus = (f: StaffingLine | "none") => run({ type: "staffingOps", focus: f }, "專攻已更新");
  return (
    <>
      {ev && (
        <Card title={`${ev.icon} ${ev.title}`} right={<Chip tone="amber">要處理</Chip>}>
          <div class="stack">
            <p class="small dim">{ev.text}　沒處理的話，期限到了會自動採預設選項。</p>
            {ev.options.map((o) => (
              <Btn key={o.id} small kind={o.id === ev.defaultOption ? "ghost" : "primary"} onClick={() => run({ type: "resolveStaffingEvent", optionId: o.id }, "已處理")}>
                {o.label}　<span class="small dim">{o.hint}{o.id === ev.defaultOption ? "（預設）" : ""}</span>
              </Btn>
            ))}
          </div>
        </Card>
      )}
      <Card title="🧑‍🏫 人力派遣・教育" right={<Chip tone={month30 >= 0 ? "green" : "red"}>近 {v.hist.length} 天 {money(month30)}</Chip>}>
        <div class="stack">
          <div class="kv-grid">
            <div>
              <small class="dim">人員</small>
              <b>{v.workers} 人</b>
              <small class="dim">一天薪資 {money(staffingPayroll(v))}</small>
            </div>
            <div>
              <small class="dim">班級</small>
              <b>{v.classes} 班（{v.classes * CLASS_SEATS} 席）</b>
              <small class="dim">一班一天 {money(40_000)}</small>
            </div>
            <div>
              <small class="dim">累計損益（含開辦費）</small>
              <b>{money(v.profit)}</b>
            </div>
          </div>
          {last && (
            <p class="small">
              昨天：派遣需求 {last.demand} 人日、成交 {last.placed}；上課 {last.students} 人。營收 {money(last.revenue)}、成本 {money(last.cost)}，淨 {money(last.revenue - last.cost)}。
            </p>
          )}
          <p class="small dim">
            現在的季節係數：{seasonNow}。{MONTH_HINT[calendarDay(day).m] ?? "平常月份"}。閒置的人與教室照樣付錢，要跟著季節調整。
          </p>
        </div>
      </Card>
      <Card title="調整規模">
        <div class="stack">
          <div class="row">
            <Field label={`派遣人員（最多 ${mw}）`}>
              <input type="number" min={0} max={mw} step={1} value={workers} onInput={(e) => setWorkers(Math.max(0, Math.min(mw, Math.round(Number((e.target as HTMLInputElement).value) || 0))))} />
            </Field>
            <Field label={`班級（最多 ${mc}）`}>
              <input type="number" min={0} max={mc} step={1} value={classes} onInput={(e) => setClasses(Math.max(0, Math.min(mc, Math.round(Number((e.target as HTMLInputElement).value) || 0))))} />
            </Field>
          </div>
          <p class="small dim">
            招募一人 {money(STAFF_HIRE_COST)}、資遣一人要付 {STAFF_RELEASE_DAYS} 天薪水、開一班 {money(CLASS_OPEN_COST)}（關班免費，但再開要重付）。
            {changed ? `這次要花 ${money(total)}。` : ""}
          </p>
          <Btn kind="primary" disabled={!changed || s.funds < total} onClick={() => run({ type: "staffingOps", workers, classes }, "已調整")}>
            套用（{money(total)}）
          </Btn>
        </div>
      </Card>
      <Card title="報價與專攻">
        <div class="stack">
          <div class="row">
            <Field label="派遣報價倍率" hint="約 ×1.2 以內客人還接受，再高會流失">
              <input type="number" min={0.7} max={1.5} step={0.05} value={v.priceMult ?? 1} onChange={(e) => run({ type: "staffingOps", priceMult: Number((e.target as HTMLInputElement).value) }, "報價已更新")} />
            </Field>
            <Field label="學費倍率" hint="同樣約 ×1.2 為上限">
              <input type="number" min={0.7} max={1.5} step={0.05} value={v.tuitionMult ?? 1} onChange={(e) => run({ type: "staffingOps", tuitionMult: Number((e.target as HTMLInputElement).value) }, "學費已更新")} />
            </Field>
          </div>
          <div class="row">
            <Btn small kind={!v.focus ? "primary" : "ghost"} onClick={() => focus("none")}>
              不專攻
            </Btn>
            <Btn small kind={v.focus === "dispatch" ? "primary" : "ghost"} onClick={() => focus("dispatch")}>
              專攻派遣（經驗 {Math.floor(v.xp.dispatch)}）
            </Btn>
            <Btn small kind={v.focus === "training" ? "primary" : "ghost"} onClick={() => focus("training")}>
              專攻教育（經驗 {Math.floor(v.xp.training)}）
            </Btn>
          </div>
          <p class="small dim">
            專攻的那條線，經驗越多單價越高（最多 +12%，越後面越慢）；另一條只拿一半。兩條線都開卻不專攻，兩邊都分心、單價打 94 折，另付 2.5% 管理費。
          </p>
          <p class="small dim">
            研修班的好處：三班以上、教育經驗滿 60，商場店員的研發手藝 +1{trainingSkillBonus(s.ventures) ? "（已生效）" : "（還沒達成）"}。
          </p>
        </div>
      </Card>
    </>
  );
}
