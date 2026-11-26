import {
  INSURANCE,
  LEGAL_KINDS,
  LEGAL_STAGES,
  SMALL_CLAIM_LIMIT,
  defaultLegalOption,
  legalOptions,
  type ClosedCase,
  type LawsuitCase,
  type LegalStage,
  type PublicMallState,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { gameDeadline, money } from "../format";
import { run, state } from "../store";

const STAGES: LegalStage[] = ["demand", "mediation", "trial"];
const OUTCOME: Record<ClosedCase["outcome"], { label: string; tone: "green" | "amber" | "red" | "cyan" }> = {
  settled: { label: "示談", tone: "cyan" },
  mediated: { label: "調停成立", tone: "cyan" },
  dismissed: { label: "勝訴（駁回）", tone: "green" },
  partial: { label: "部分敗訴", tone: "amber" },
  lost: { label: "敗訴", tone: "red" },
};

function StageBar({ c }: { c: LawsuitCase }) {
  const at = STAGES.indexOf(c.stage);
  const small = c.claim <= SMALL_CLAIM_LIMIT;
  return (
    <div class="row small" style={{ gap: "6px", flexWrap: "wrap" }} aria-label="案件進度">
      {STAGES.map((st, i) => (
        <Chip key={st} tone={i === at ? "red" : i < at ? "dim" : "dim"}>
          {i < at ? "✓ " : i === at ? "▶ " : ""}
          {st === "trial" && small ? "少額訴訟" : LEGAL_STAGES[st].label}
        </Chip>
      ))}
    </div>
  );
}

function CaseCard({ s, c }: { s: PublicMallState; c: LawsuitCase }) {
  const def = LEGAL_KINDS[c.kind];
  const opts = legalOptions(c);
  const fallback = opts.find((o) => o.id === defaultLegalOption(c.stage, s.guestPrefs.complaintStance));
  return (
    <div class="alert red">
      <div class="row between">
        <h4>
          {def.icon} {c.shopName}・{def.label}
        </h4>
        <span class="small dim">{gameDeadline(c.deadlineTick, s.tick)} 前回應</span>
      </div>
      <div class="row small" style={{ gap: "6px", flexWrap: "wrap" }}>
        <span class="dim">原告：{c.plaintiff}</span>
        <Chip tone="red">請求 {money(c.claim)}</Chip>
        {c.lawyer && <Chip tone="cyan">已委任律師</Chip>}
        {c.insured > 0 ? <Chip tone="green">投保：{INSURANCE[c.insured]?.name}</Chip> : <Chip tone="amber">未投保</Chip>}
      </div>
      <p class="small dim">{def.summary}</p>
      <div class="row small" style={{ gap: "4px", flexWrap: "wrap" }}>
        <span class="dim">適用：</span>
        {def.laws.map((l) => (
          <Chip key={l} tone="dim">
            {l}
          </Chip>
        ))}
      </div>
      <StageBar c={c} />
      <p class="small">
        <b>{LEGAL_STAGES[c.stage].label}</b>
        <span class="dim">（{LEGAL_STAGES[c.stage].law}）</span>
      </p>
      <Meter label="🧾 我方證據力（清潔、設備、合規紀錄；律師會再加成）" value={Math.min(100, c.evidence + (c.lawyer ? 15 : 0))} hint={`${Math.min(100, c.evidence + (c.lawyer ? 15 : 0))}`} tone={c.evidence >= 65 ? "green" : c.evidence >= 45 ? "cyan" : "red"} />
      <div class="stack">
        {opts.map((o) => (
          <div class="row between" key={o.id} style={{ alignItems: "flex-start", gap: "8px" }}>
            <span class="small dim" style={{ flex: 1 }}>
              {o.desc}
            </span>
            <Btn small disabled={o.cost > s.funds} onClick={() => run({ type: "legalAction", uid: c.uid, optionId: o.id }, o.label)}>
              {o.label}
              {o.cost > 0 ? `（${money(o.cost)}）` : ""}
            </Btn>
          </div>
        ))}
      </div>
      <p class="small dim">逾時將依「客訴處理偏好」自動：{fallback?.label}</p>
      <details>
        <summary class="small">經過（{c.history.length}）</summary>
        <ul class="small dim">
          {c.history.map((h, i) => (
            <li key={i}>{h.text}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function InsuranceCard({ s }: { s: PublicMallState }) {
  const level = s.legal?.insurance ?? 0;
  const direct = s.shops.filter((x) => x.mode === "direct").length;
  return (
    <Card title="🛡️ 賠償責任保險" right={<span class="small dim">每日依直營店數收保費</span>}>
      <div class="stack">
        <p class="small dim">保險付的是「和解金與判決金」的一部分（扣掉自負額），不包含律師費與過料。案件成立當下的投保等級才算數，所以要事前投保。</p>
        <div class="seg">
          {INSURANCE.map((ins, i) => (
            <button key={ins.name} class={level === i ? "active" : ""} onClick={() => level !== i && run({ type: "setInsurance", level: i }, `已改為「${ins.name}」`)}>
              <b>{ins.name}</b>
              <small>
                {i === 0 ? "不花錢，官司全部自己扛" : `每店每日 ${money(ins.premium)}（目前 ${direct} 間店約 ${money(ins.premium * direct)}／日）・給付 ${Math.round(ins.rate * 100)}%、每件最高 ${money(ins.cap)}、自負額 ${money(ins.deductible)}`}
              </small>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function History({ rows }: { rows: ClosedCase[] }) {
  return (
    <Card title="📚 過去的案件">
      {rows.length === 0 ? (
        <Empty>還沒有結案的案件。</Empty>
      ) : (
        <div class="stack">
          {rows.map((r) => (
            <div class="report-row" key={r.uid}>
              <div class="row between">
                <span>
                  {LEGAL_KINDS[r.kind].icon} {r.shopName}・{LEGAL_KINDS[r.kind].label}
                </span>
                <Chip tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Chip>
              </div>
              <p class="small dim">
                {r.plaintiff}・請求 {money(r.claim)}・自付 {money(r.paid)}
                {r.insurer > 0 ? `・保險付 ${money(r.insurer)}` : ""}
                {r.lawyerFee > 0 ? `・律師費 ${money(r.lawyerFee)}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** 法務：客訴處理不當、衛生與設備管理不善，都可能升級成法律糾紛（日本民事程序）。 */
export function Legal() {
  const s = state.value;
  if (!s) return null;
  const lg = s.legal;
  const cases = lg?.cases ?? [];
  return (
    <>
      <Card title={`⚖️ 法律糾紛（${cases.length}）`} right={lg && lg.totalPaid > 0 ? <span class="small dim">累計自付 {money(lg.totalPaid)}</span> : undefined}>
        {cases.length === 0 ? (
          <Empty>目前沒有官司。客訴處理不當、清潔與設備太差、被客人抓到疏失，都可能收到請求書。保持良好的衛生與設備、認真處理客訴，並投保。</Empty>
        ) : (
          <div class="stack">
            {cases.map((c) => (
              <CaseCard key={c.uid} s={s} c={c} />
            ))}
          </div>
        )}
      </Card>
      <InsuranceCard s={s} />
      <History rows={lg?.closed ?? []} />
    </>
  );
}
