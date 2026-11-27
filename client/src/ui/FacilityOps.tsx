import {
  BOOKING_POLICIES,
  CINEMA_TICKET,
  EXTRA_DEFS,
  PARKING_FEE,
  PARKING_POLICIES,
  PRICE_MULT_MAX,
  PRICE_MULT_MIN,
  TERMINATE_PENALTY,
  TICKS_PER_DAY,
  BOOKING_SLOT_HOURS,
  COUNTER_STEPS,
  bookingPolicy,
  conditionOf,
  facilityOf,
  isLeased,
  leaseRemainingRent,
  maintenanceCost,
  parkingBoostScale,
  parkingDailyIncome,
  parkingPolicy,
  priceMultOf,
  programmeEffect,
  timeInfo,
  weekFilms,
  type FacilityDef,
} from "@coidle/shared";
import { confirmThen } from "../components/ConfirmHost";
import { Btn, Chip, Meter } from "../components/ui";
import { money, moneyShort } from "../format";
import { run, state } from "../store";

/** 設施的營運面板：價格、政策、加值服務、排片、維護、招商。只在這座設施有蓋好的單位時顯示。 */
export function FacilityOpsPanel({ d }: { d: FacilityDef }) {
  const s = state.value;
  const f = s ? facilityOf(s, d.kind) : undefined;
  if (!s || !f || f.units <= 0) return null;
  const leased = isLeased(f);
  return <div class="stack facops">{leased ? <LeasedView d={d} /> : <OwnView d={d} />}</div>;
}

function basePrice(d: FacilityDef): number {
  if (d.kind === "parking") return PARKING_FEE;
  if (d.kind === "cinema") return CINEMA_TICKET;
  return d.econ?.price ?? 0;
}
const priceLabel = (d: FacilityDef): string =>
  d.kind === "parking" ? "停車費（每次）" : d.kind === "cinema" ? "票價" : d.kind === "hotel" || d.kind === "capsule_hotel" ? "房價（每晚）" : d.kind === "bowling" ? "球道費" : "場租";

function OwnView({ d }: { d: FacilityDef }) {
  const s = state.value!;
  const f = facilityOf(s, d.kind)!;
  const mult = priceMultOf(f);
  const cond = conditionOf(f);
  const cost = maintenanceCost(d, f);
  const day = timeInfo(s.tick).day;
  const extra = EXTRA_DEFS[d.kind];
  const policy = d.kind === "parking" ? parkingPolicy(f) : bookingPolicy(f);
  const setMult = (m: number) => run({ type: "setFacilityOps", kind: d.kind, priceMult: Math.round(m * 20) / 20 });
  const showPrice = d.kind !== "parking" || policy !== "free";
  const offers = f.ops?.offers ?? [];

  return (
    <>
      <div class="row between">
        <b class="small">營運設定</b>
        <Chip tone="green">自營</Chip>
      </div>

      {d.kind === "parking" && (
        <div class="stack">
          <span class="small dim">收費政策</span>
          <div class="row wrap">
            {Object.entries(PARKING_POLICIES).map(([id, p]) => (
              <Btn key={id} small kind={policy === id ? "primary" : "ghost"} onClick={() => run({ type: "setFacilityOps", kind: d.kind, policy: id })}>
                {p.label}
              </Btn>
            ))}
          </div>
          <p class="small dim">{PARKING_POLICIES[policy]?.desc}</p>
          <p class="small">
            預估停車收入：{money(Math.round(parkingDailyIncome(s)))}／天・自駕客來客加成 ×{parkingBoostScale(f).toFixed(2)}
          </p>
        </div>
      )}

      {(d.kind === "conference" || d.kind === "event_space") && (
        <div class="stack">
          <span class="small dim">接單原則</span>
          <div class="row wrap">
            {Object.entries(BOOKING_POLICIES).map(([id, p]) => (
              <Btn key={id} small kind={policy === id ? "primary" : "ghost"} onClick={() => run({ type: "setFacilityOps", kind: d.kind, policy: id })}>
                {p.label}
              </Btn>
            ))}
          </div>
          <p class="small dim">{BOOKING_POLICIES[policy]?.desc}</p>
        </div>
      )}

      {showPrice && (
        <div class="row between">
          <span class="small">
            {priceLabel(d)}：<b>{money(Math.round(basePrice(d) * mult))}</b>
            <span class="dim">（×{mult.toFixed(2)}）</span>
            {mult > 1.2 && <span class="dim">・客人會嫌貴</span>}
          </span>
          <span class="row">
            <Btn small disabled={mult <= PRICE_MULT_MIN + 1e-6} onClick={() => setMult(mult - 0.05)}>
              −
            </Btn>
            <Btn small disabled={mult >= PRICE_MULT_MAX - 1e-6} onClick={() => setMult(mult + 0.05)}>
              ＋
            </Btn>
          </span>
        </div>
      )}

      {extra && (
        <div class="row between">
          <span class="small">
            {extra.label}
            <span class="dim">・{extra.desc}</span>
          </span>
          <Btn small kind={f.ops?.extra ? "primary" : "ghost"} onClick={() => run({ type: "setFacilityOps", kind: d.kind, extra: !f.ops?.extra })}>
            {f.ops?.extra ? "已開" : "開啟"}
          </Btn>
        </div>
      )}

      {d.kind === "cinema" && <Programme />}
      {(d.kind === "conference" || d.kind === "event_space") && <Board d={d} day={day} />}

      <div class="stack">
        <Meter label="設備狀態" value={cond} hint={cond >= 70 ? `${Math.round(cond)}（良好）` : `${Math.round(cond)}（營收打折）`} />
        <div class="row between">
          <span class="small dim">每天老化，太舊會影響營收；維護費約 {moneyShort(cost)}</span>
          <Btn small disabled={cond >= 100} onClick={() => confirmThen(`維護「${d.name}」？\n花費 ${money(cost)}，設備狀態回到 100。`, () => run({ type: "maintainFacility", kind: d.kind }, "設備維護完成"))}>
            維護
          </Btn>
        </div>
      </div>

      <div class="stack">
        <b class="small">招商（交給營運商經營）</b>
        <p class="small dim">收租金與抽成，不用管價格與維護；賺得比自營少，但穩定。</p>
        {offers.length === 0 && <p class="small dim">目前沒有營運商來洽談；商場 Lv.3 起，營運商會不定期上門。</p>}
        {offers.map((o) => (
          <div class="tenant" key={o.id}>
            <div class="row between">
              <b>{o.brand}</b>
              <Chip tone="dim">{o.termDays} 天</Chip>
            </div>
            {o.blurb && <p class="small dim">{o.blurb}</p>}
            <p class="small">
              租金 {money(o.rent)}／天・抽成 {Math.round(o.commission * 100)}%・知名度 {o.fame}・品質 {Math.round(o.quality * 100)}
            </p>
            <div class="row">
              <Btn
                small
                kind="primary"
                onClick={() =>
                  confirmThen(`把「${d.name}」交給「${o.brand}」經營 ${o.termDays} 天？\n每日租金 ${money(o.rent)}、營收抽成 ${Math.round(o.commission * 100)}%。期間你不能調價與維護；提前解約要付違約金。`, () =>
                    run({ type: "acceptFacilityOffer", kind: d.kind, offerId: o.id }, `「${o.brand}」開始經營`),
                  )
                }
              >
                簽約
              </Btn>
              {!o.countered &&
                COUNTER_STEPS.map((m) => (
                  <Btn key={m} small title="租金加價；越想經營的營運商越可能答應，不答應就離開（只能還一次）" onClick={() => run({ type: "counterFacilityOffer", kind: d.kind, offerId: o.id, mult: m }, "已還價")}>
                    還價 +{Math.round((m - 1) * 100)}%
                  </Btn>
                ))}
              <Btn small onClick={() => run({ type: "declineFacilityOffer", kind: d.kind, offerId: o.id })}>
                婉拒
              </Btn>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function LeasedView({ d }: { d: FacilityDef }) {
  const s = state.value!;
  const f = facilityOf(s, d.kind)!;
  const t = f.ops!.operator!;
  const left = Math.max(0, Math.ceil((t.endTick - s.tick) / TICKS_PER_DAY));
  const penalty = Math.round(leaseRemainingRent(t.rent, t.endTick, s.tick) * TERMINATE_PENALTY);
  const today = f.today;
  return (
    <>
      <div class="row between">
        <b class="small">營運商</b>
        <Chip tone="amber">招商中</Chip>
      </div>
      <div class="tenant">
        <div class="row between">
          <b>{t.brand}</b>
          <Chip tone="dim">剩 {left} 天</Chip>
        </div>
        <p class="small">
          租金 {money(t.rent)}／天・抽成 {Math.round(t.commission * 100)}%・滿意度 {Math.round(t.satisfaction)}
        </p>
        {today && today.revenue > 0 && <p class="small dim">營運商今日營收約 {money(Math.round(today.revenue))}，你的抽成約 {money(Math.round(today.revenue * t.commission))}</p>}
        <p class="small dim">營運商負責價格與維護。滿意度太低會提前退出；租約到期時滿意的營運商會來談續約。</p>
        {f.ops?.renewal && (
          <div class="tenant">
            <b class="small">續約洽談</b>
            <p class="small">
              「{t.brand}」想再 {f.ops.renewal.termDays} 天，每日租金 {money(f.ops.renewal.rent)}。{Math.max(0, Math.ceil((f.ops.renewal.deadlineTick - s.tick) / TICKS_PER_DAY))} 天內沒處理就照這個條件自動續約。
            </p>
            <div class="row wrap">
              <Btn small kind="primary" onClick={() => run({ type: "resolveFacilityRenewal", kind: d.kind, action: "renew" }, "已續約")}>
                照條件續約
              </Btn>
              <Btn small title="要求加租 10%；營運商滿意度夠高才肯，不然直接走人" onClick={() => run({ type: "resolveFacilityRenewal", kind: d.kind, action: "raise" })}>
                要求加租 10%
              </Btn>
              <Btn small kind="danger" onClick={() => confirmThen(`不跟「${t.brand}」續約？「${d.name}」會回到自營。`, () => run({ type: "resolveFacilityRenewal", kind: d.kind, action: "release" }))}>
                不續約
              </Btn>
            </div>
          </div>
        )}
        <Btn
          small
          kind="danger"
          onClick={() => confirmThen(`提前收回「${d.name}」自營？\n違約金約 ${money(penalty)}（剩餘租金的 ${Math.round(TERMINATE_PENALTY * 100)}%）。`, () => run({ type: "endFacilityLease", kind: d.kind }, "已收回自營"))}
        >
          收回自營（違約金 {moneyShort(penalty)}）
        </Btn>
      </div>
    </>
  );
}

/** 影城：每廳排哪一部片 */
function Programme() {
  const s = state.value!;
  const f = facilityOf(s, "cinema")!;
  const day = timeInfo(s.tick).day;
  const films = weekFilms(day);
  const cur = f.ops?.films ?? [];
  const eff = programmeEffect(f, day);
  const set = (i: number, id: string) => {
    const next = Array.from({ length: f.units }, (_, k) => (k === i ? id : (cur[k] ?? "")));
    run({ type: "setFacilityOps", kind: "cinema", films: next });
  };
  return (
    <div class="stack">
      <span class="small dim">
        排片（本週上映 6 部，每週輪替）・整體熱度 ×{eff.heat.toFixed(2)}・片商抽成 {Math.round(eff.licensePct * 100)}%
      </span>
      {Array.from({ length: f.units }, (_, i) => {
        const id = cur[i] ?? "";
        const valid = films.some((x) => x.id === id) ? id : "";
        return (
          <div class="row between small" key={i}>
            <span>第 {i + 1} 廳</span>
            <select value={valid} onChange={(e) => set(i, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">院線平均片</option>
              {films.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}（{x.genre}・熱度 {x.heat.toFixed(2)}・抽成 {Math.round(x.licensePct * 100)}%）
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

/** 會議中心／活動場地的預約看板：沒有預約就沒有收入。未來 7 天，每個廳／活動區每天幾場 */
function Board({ d, day }: { d: FacilityDef; day: number }) {
  const s = state.value!;
  const f = facilityOf(s, d.kind)!;
  const hours = BOOKING_SLOT_HOURS[d.kind] ?? [];
  const list = f.ops?.bookings ?? [];
  const days = Array.from({ length: 7 }, (_, i) => day + i);
  const total = list.filter((b) => b.day >= day).reduce((a, b) => a + b.fee, 0);
  const capacity = f.units * hours.length * 7;
  const booked = list.filter((b) => b.day >= day && b.day < day + 7).length;
  return (
    <div class="stack">
      <span class="small dim">
        預約看板：未來 7 天已預約 {booked}／{capacity} 場，預計場租 {money(total)}。沒有預約就沒有收入；價格與設備狀態會影響預約，連假與活動日更多。
      </span>
      {days.map((dd) => {
        const slots = list.filter((b) => b.day === dd);
        return (
          <div class="row between small" key={dd}>
            <span class="dim">{dd === day ? "今天" : `+${dd - day} 天`}</span>
            <span class="row wrap">
              {slots.length === 0 && <Chip tone="dim">沒有預約</Chip>}
              {slots.map((x) => (
                <Chip key={`${x.unit}-${x.slot}`} tone={x.kind === "rent" ? "green" : x.kind === "own" ? "cyan" : "pink"} title={`${d.unit === "廳" ? "第" : "第"} ${x.unit + 1} ${d.unit}`}>
                  {hours[x.slot]}:00 {x.client}・{moneyShort(x.fee)}
                </Chip>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
