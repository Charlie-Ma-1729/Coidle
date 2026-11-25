import { useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  COUNTER_STEPS,
  LEASE_MIN_LEVEL,
  TICKS_PER_DAY,
  leaseEnabled,
  leaseRemainingRent,
  marketRent,
  TERMINATE_PENALTY,
  type PublicMallState,
  type Shop,
  type TenantCandidate,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { dateText, money, realDuration } from "../format";
import { categoryIcon } from "../icons";
import { FLOOR_LABELS } from "../stage/adapter";
import { run, state } from "../store";

function freeSlots(s: PublicMallState, zone: string): number[] {
  return s.slots.filter((x) => x.zone === zone && !x.shopId && !s.builds.some((b) => b.slot === x.id)).map((x) => x.id);
}

function Candidate({ s, c }: { s: PublicMallState; c: TenantCandidate }) {
  const cat = CATEGORY_BY_ID[c.category];
  const free = freeSlots(s, cat?.zone ?? "");
  const [slot, setSlot] = useState<number | undefined>(undefined);
  const market = marketRent(c.category);
  const vsMarket = c.rent / Math.max(1, market);
  return (
    <div class="tenant">
      <div class="row between">
        <b>
          {categoryIcon(c.category)} {c.brand}
        </b>
        <Chip tone="dim">{cat?.name}</Chip>
      </div>
      {c.blurb && <p class="small dim">{c.blurb}</p>}
      <div class="grid two">
        <Meter label="品牌品質" value={c.quality * 100} hint={`${Math.round(c.quality * 100)}`} tone="pink" />
        <Meter label="知名度（帶客力）" value={c.fame} hint={`${c.fame}`} tone="cyan" />
      </div>
      <p class="small">
        開價：每日租金 <b>{money(c.rent)}</b>（行情 {money(market)}，{vsMarket >= 1 ? "高" : "低"} {Math.abs(Math.round((vsMarket - 1) * 100))}%）＋ 營業額抽成 {Math.round(c.commission * 100)}%・租期 {c.termDays} 天
      </p>
      <p class="small dim">
        想進駐的程度：{c.eagerness >= 0.7 ? "很想" : c.eagerness >= 0.45 ? "普通" : "不太急"}・洽談只剩約 {realDuration(c.expireTick - s.tick, s.clock.speed)}
      </p>
      {free.length > 1 && (
        <div class="row small">
          <span class="dim">店面：</span>
          {free.map((id) => (
            <button key={id} class={`zone-tab ${(slot ?? free[0]) === id ? "active" : ""}`} onClick={() => setSlot(id)}>
              {FLOOR_LABELS[cat?.zone ?? ""] ?? ""} #{id + 1}
            </button>
          ))}
        </div>
      )}
      <div class="row">
        <Btn small kind="primary" disabled={free.length === 0} title={free.length === 0 ? "這個區域沒有空店面了" : ""} onClick={() => run({ type: "signTenant", candidateId: c.id, slot: slot ?? free[0] }, `與「${c.brand}」簽約`)}>
          簽約
        </Btn>
        {!c.countered &&
          COUNTER_STEPS.map((m) => (
            <Btn key={m} small onClick={() => run({ type: "counterTenant", candidateId: c.id, rentMult: m }, "已提出還價")} title="租金加幾成：開得越高，越可能把對方嚇跑">
              租金 +{Math.round((m - 1) * 100)}%
            </Btn>
          ))}
        <Btn small onClick={() => run({ type: "declineTenant", candidateId: c.id })}>
          婉拒
        </Btn>
      </div>
      {c.countered && <p class="small dim">已經還過價，只能再簽約或婉拒。</p>}
    </div>
  );
}

function TenantRow({ s, shop }: { s: PublicMallState; shop: Shop }) {
  const t = shop.tenant;
  if (!t) return null;
  const left = t.endTick - s.tick;
  const penalty = Math.round(leaseRemainingRent(t.rent, t.endTick, s.tick) * TERMINATE_PENALTY);
  const fitting = t.startTick > s.tick;
  return (
    <div class="tenant">
      <div class="row between">
        <b>
          {categoryIcon(shop.category)} {t.brand}
        </b>
        <Chip tone={t.satisfaction >= 60 ? "green" : t.satisfaction >= 35 ? "amber" : "red"}>{fitting ? "裝修中" : `滿意度 ${Math.round(t.satisfaction)}`}</Chip>
      </div>
      <Meter label="租戶滿意度" value={t.satisfaction} hint={t.lowDays > 0 ? `⚠️ 連續 ${t.lowDays} 天過低` : `${Math.round(t.satisfaction)}`} tone={t.satisfaction >= 60 ? "green" : t.satisfaction >= 35 ? "amber" : "red"} />
      <p class="small dim">
        每日租金 {money(t.rent)} ＋ 抽成 {Math.round(t.commission * 100)}%・品質 {Math.round(t.quality * 100)}・知名度 {t.fame}・
        {left > 0 ? `租約剩 ${Math.ceil(left / TICKS_PER_DAY)} 天（到 ${dateText(t.endTick)}）` : "租約已到期，等待續約"}
      </p>
      <div class="row">
        <Btn small kind="danger" onClick={() => confirm(`提前解約要付違約金 ${money(penalty)}，確定嗎？`) && run({ type: "terminateLease", shopId: shop.id }, "已解約")}>
          提前解約（違約金 {money(penalty)}）
        </Btn>
      </div>
    </div>
  );
}

export function Leasing() {
  const s = state.value;
  if (!s) return null;
  if (!leaseEnabled(s)) {
    return (
      <Card title="🏪 招商">
        <Empty>商場升到 Lv.{LEASE_MIN_LEVEL} 就能招商：知名品牌會主動來洽談，簽約後由租戶自己裝修、經營，你收租金與營業額抽成。目前 Lv.{s.level}。</Empty>
      </Card>
    );
  }
  const tenants = s.shops.filter((x) => x.mode === "lease" && x.tenant && !x.tenant.own);
  const fitting = s.builds.filter((b) => b.tenant);
  const renewals = s.leasing.renewals;
  return (
    <>
      {renewals.map((r) => {
        const shop = s.shops.find((x) => x.id === r.shopId);
        return (
          <div class="alert cyan" key={r.uid}>
            <h4>📄 「{r.brand}」的租約到期了</h4>
            <p class="small">
              想續約 {r.termDays} 天，每日租金 {money(r.rent)}。滿意度 {Math.round(shop?.tenant?.satisfaction ?? 0)}。沒處理的話，滿意度夠高會自動續約，不夠就讓他走。（約 {realDuration(r.deadlineTick - s.tick, s.clock.speed)}後）
            </p>
            <div class="row">
              <Btn small kind="primary" onClick={() => run({ type: "resolveRenewal", uid: r.uid, action: "renew" }, "續約完成")}>
                照開價續約
              </Btn>
              <Btn small onClick={() => run({ type: "resolveRenewal", uid: r.uid, action: "raise" })} title="要求再加租 10%：租戶滿意度夠高才會答應，否則搬走">
                要求加租 10%
              </Btn>
              <Btn small onClick={() => run({ type: "resolveRenewal", uid: r.uid, action: "release" })}>
                不續約
              </Btn>
            </div>
          </div>
        );
      })}

      <Card title="🤝 洽談中的品牌" right={<span class="small dim">{s.leasing.candidates.length} 個</span>}>
        {s.leasing.candidates.length === 0 ? (
          <Empty>目前沒有品牌來洽談。有空店面、區域也開放的話，品牌會陸續上門；升級與口碑越好，來的品牌越好。</Empty>
        ) : (
          <div class="stack">
            {s.leasing.candidates.map((c) => (
              <Candidate key={c.id} s={s} c={c} />
            ))}
          </div>
        )}
        <p class="small dim">簽約後租戶自己出錢裝修、自己進貨與營運，你不用付人事費，只要維持館內環境與人氣。租金太高、沒客人或館內髒亂，租戶會不滿並撤櫃。</p>
      </Card>

      <Card title="🏬 我的租戶" right={<span class="small dim">{tenants.length} 間</span>}>
        {tenants.length === 0 && fitting.length === 0 ? (
          <Empty>還沒有租戶。</Empty>
        ) : (
          <div class="stack">
            {fitting.map((b) => (
              <p class="small" key={b.id}>
                🚧 「{b.tenant?.brand}」裝修中，約 {realDuration(b.completeTick - s.tick, s.clock.speed)}後開張。
              </p>
            ))}
            {tenants.map((x) => (
              <TenantRow key={x.id} s={s} shop={x} />
            ))}
          </div>
        )}
      </Card>

      <Card title="📜 招商紀錄">
        {s.leasing.log.length === 0 ? (
          <Empty>還沒有紀錄。</Empty>
        ) : (
          <div class="log">
            <ul>
              {s.leasing.log.slice(0, 8).map((l, i) => (
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
