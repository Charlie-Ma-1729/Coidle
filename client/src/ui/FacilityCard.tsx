import { FACILITY_DEFS, TICKS_PER_HOUR, facilityAmount, facilityOf, nextFacilityUnit, timeInfo, type FacilityDef } from "@coidle/shared";
import { confirmThen } from "../components/ConfirmHost";
import { Btn, Card, Chip } from "../components/ui";
import { money, moneyShort } from "../format";
import { run, state } from "../store";
import { FacilityOpsPanel } from "./FacilityOps";

/** 營運頁的「大型設施」卡；傳 kind 時只畫那一種（設施樓層的面板用），from/to 是這層放的單位。 */
export function FacilityCard({ kind, from, to }: { kind?: string; from?: number; to?: number } = {}) {
  const s = state.value;
  if (!s) return null;
  const defs = kind ? FACILITY_DEFS.filter((d) => d.kind === kind) : FACILITY_DEFS;
  const body = (
    <div class="stack">
      {defs.map((d) => (
        <FacilityBlock key={d.kind} d={d} from={from} to={to} />
      ))}
    </div>
  );
  return kind ? body : <Card title="🏗 大型設施">{body}</Card>;
}

/** 解鎖路線：每個單位要幾級、多少錢、多久、多大；已蓋／下一個／還鎖著 */
function Roadmap({ d }: { d: FacilityDef }) {
  const s = state.value!;
  const f = facilityOf(s, d.kind);
  const done = f?.units ?? 0;
  const building = f?.building ? done : -1;
  return (
    <details class="small">
      <summary class="dim">解鎖路線（共 {d.units.length} {d.unit}）</summary>
      <div class="stack">
        {d.units.map((u, i) => {
          const state2 = i < done ? "已蓋" : i === building ? "施工中" : s.level >= u.minLevel ? (i === done ? "可蓋" : "待蓋") : `Lv.${u.minLevel} 解鎖`;
          return (
            <div class="row between" key={i}>
              <span class={i < done ? "dim" : ""}>
                第 {i + 1} {d.unit}・{moneyShort(u.cost)}・約 {Math.ceil(u.ticks / TICKS_PER_HOUR)} 小時・{d.kind === "parking" ? `${u.amount} 位` : `${u.amount} 座`}
              </span>
              <Chip tone={i < done ? "green" : i === building ? "amber" : s.level >= u.minLevel ? "cyan" : "dim"}>{state2}</Chip>
            </div>
          );
        })}
        <p class="dim">建議：商場等級夠、現金多於費用的 1.5 倍再蓋，蓋完還要留錢付維護與固定成本。</p>
      </div>
    </details>
  );
}

function FacilityBlock({ d, from, to }: { d: FacilityDef; from?: number; to?: number }) {
  const s = state.value!;
  const f = facilityOf(s, d.kind);
  const next = nextFacilityUnit(s, d.kind);
  const done = f?.units ?? 0;
  const left = f?.building ? Math.max(0, f.building.completeTick - s.tick) : 0;
  const unitAmountText = (n: number) => (d.kind === "parking" ? `${n} 個車位` : `${n} 個座位`);
  const rows = from !== undefined && to !== undefined ? Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i) : [];
  const today = f?.today && f.today.day === timeInfo(s.tick).day ? f.today : undefined;

  return (
    <div class="tenant">
      <div class="row between">
        <b>{d.name}</b>
        <Chip tone="dim">
          {done}／{d.units.length} {d.unit}・{facilityAmount(s, d.kind)} {d.kind === "parking" ? "位" : "座"}
        </Chip>
      </div>
      <p class="small dim">{d.desc}</p>
      {d.kind === "cinema" && done > 0 && (
        <p class="small">
          今日：{Math.round(today?.viewers ?? 0).toLocaleString()} 人次・票房 {money(Math.round(today?.revenue ?? 0))}
        </p>
      )}
      {rows.length > 0 && (
        <div class="stack">
          {rows.map((i) => {
            const u = d.units[i];
            const built = i < done;
            const building = !built && i === done && !!f?.building;
            return (
              <div class="row between small" key={i}>
                <span>
                  第 {i + 1} {d.unit}
                  <span class="dim">・{u ? unitAmountText(u.amount) : ""}</span>
                </span>
                <Chip tone={built ? "green" : building ? "amber" : "dim"}>{built ? "營運中" : building ? `施工中・約 ${Math.ceil(left / TICKS_PER_HOUR)} 遊戲小時` : "尚未興建"}</Chip>
              </div>
            );
          })}
        </div>
      )}
      {rows.length === 0 && f?.building && (
        <p class="small">
          施工中：第 {done + 1} {d.unit}，約 {Math.ceil(left / TICKS_PER_HOUR)} 遊戲小時後落成。
        </p>
      )}
      {next.def && !f?.building && (
        <div class="row between">
          <span class="small dim">
            下一{d.unit}：{unitAmountText(next.def.amount)}・Lv.{next.def.minLevel}
          </span>
          <Btn
            small
            kind="primary"
            disabled={!next.canBuy}
            onClick={() =>
              confirmThen(`興建「${d.name}」第 ${next.index + 1} ${d.unit}？\n費用 ${moneyShort(next.def!.cost)}，現在就會扣款，增加 ${unitAmountText(next.def!.amount)}。`, () =>
                run({ type: "buildFacility", kind: d.kind }, `開始興建第 ${next.index + 1} ${d.unit}`),
              )
            }
          >
            {next.canBuy ? `興建 ${moneyShort(next.def.cost)}` : (next.reason ?? "不能蓋")}
          </Btn>
        </div>
      )}
      {!next.def && !f?.building && <p class="small dim">{next.reason}</p>}
      {rows.length === 0 && <Roadmap d={d} />}
      {done > 0 && !from && <FacilityOpsPanel d={d} />}
    </div>
  );
}
