import {
  CONTRACT_CANCEL_FEE,
  CONTRACT_DAYS,
  CONTRACT_MIN_REL,
  FAMILY_ORDER,
  FAMILY_OF,
  SUPPLIERS,
  SUPPLIER_SWITCH_FEE,
  SUPPLY_FAMILIES,
  chosenSupplier,
  familyShopCount,
  hasContract,
  supplierPriceNow,
  supplierState,
  supplierUnavailable,
  ticksToRealMinutes,
  type PublicMallState,
  type SupplierDef,
  type SupplierState,
  type SupplyFamily,
} from "@coidle/shared";
import { Btn, Card, Chip, Meter } from "../components/ui";
import { money } from "../format";
import { run, state } from "../store";

const STATUS: Record<string, { label: string; tone: "amber" | "red" | "cyan" }> = {
  shortage: { label: "出貨吃緊", tone: "amber" },
  strike: { label: "罷工中", tone: "red" },
  closed: { label: "已倒閉", tone: "red" },
  cold: { label: "和你鬧翻了", tone: "red" },
};

function until(s: PublicMallState, tick: number): string {
  const m = Math.max(1, Math.round(ticksToRealMinutes(tick - s.tick, s.clock.speed, s.clock.lag)));
  return m >= 60 ? `還要約 ${Math.round(m / 6) / 10} 小時` : `還要約 ${m} 分鐘`;
}

function StatusChip({ s, st }: { s: PublicMallState; st: SupplierState }) {
  if (st.status === "ok" || st.statusUntil <= s.tick) return <Chip tone="green">正常</Chip>;
  const info = STATUS[st.status]!;
  return (
    <Chip tone={info.tone}>
      {info.label}・{until(s, st.statusUntil)}
    </Chip>
  );
}

function Traits({ def }: { def: SupplierDef }) {
  return (
    <div class="row" style={{ gap: "4px" }}>
      <Chip tone={def.price > 1.02 ? "amber" : def.price < 0.98 ? "green" : "dim"}>價格 ×{def.price.toFixed(2)}</Chip>
      <Chip tone={def.quality >= 0.85 ? "green" : def.quality < 0.7 ? "amber" : "dim"}>品質 {Math.round(def.quality * 100)}</Chip>
      <Chip tone={def.reliability >= 0.85 ? "green" : def.reliability < 0.7 ? "amber" : "dim"}>可靠 {Math.round(def.reliability * 100)}</Chip>
    </div>
  );
}

function FamilyCard({ s, family }: { s: PublicMallState; family: SupplyFamily }) {
  const info = SUPPLY_FAMILIES[family];
  const users = s.shops.filter((x) => x.mode === "direct" && FAMILY_OF[x.category] === family);
  const main = chosenSupplier(s, family);
  const alts = SUPPLIERS.filter((d) => d.family === family && d.id !== main?.def.id);
  const hiddenCount = alts.filter((d) => !supplierState(s, d.id)?.discovered).length;
  return (
    <Card title={`${info.icon} ${info.name}`} right={<span class="small dim">{users.length > 0 ? `${users.length} 間店使用：${users.map((u) => u.name).join("、")}` : "目前沒有店用到"}</span>}>
      <div class="stack">
        {main && (
          <div class="supplier main">
            <div class="row between">
              <div>
                <b>{main.def.name}</b> <Chip tone="pink">主力</Chip>
              </div>
              <StatusChip s={s} st={main.st} />
            </div>
            <p class="small dim">{main.def.bio}</p>
            <Traits def={main.def} />
            <div class="row small">
              <span>
                目前進貨價 ×<b>{supplierPriceNow(s, main.st, main.def).toFixed(2)}</b>
              </span>
              {main.st.priceUntil > s.tick && main.st.priceMult !== 1 && <Chip tone={main.st.priceMult > 1 ? "red" : "green"}>{main.st.priceMult > 1 ? "調漲中" : "特價中"}</Chip>}
              <span class="dim">累計下單 {main.st.orders} 次</span>
            </div>
            <Meter label="💞 關係值（越高越有折扣、缺貨時優先供貨）" value={main.st.relationship} hint={`${Math.round(main.st.relationship)}${main.st.relationship >= 80 ? "（折 10%・優先供貨）" : main.st.relationship >= 50 ? "（折 5%）" : ""}`} tone="pink" />
            {hasContract(main.st, s.tick) ? (
              <div class="row between small">
                <span>
                  📑 長約中（鎖價、缺貨優先）・{until(s, main.st.contract!.untilTick)}
                </span>
                <Btn small kind="danger" onClick={() => run({ type: "cancelContract", supplierId: main.def.id }, "已解約")}>
                  提前解約（違約金 {money(CONTRACT_CANCEL_FEE)}）
                </Btn>
              </div>
            ) : (
              <div class="row small">
                <span class="dim">長約：</span>
                {CONTRACT_DAYS.map((d) => (
                  <Btn key={d} small disabled={main.st.relationship < CONTRACT_MIN_REL || main.st.status !== "ok"} title={`關係值需達 ${CONTRACT_MIN_REL}；鎖定目前市價，缺貨時優先供貨`} onClick={() => run({ type: "signContract", supplierId: main.def.id, days: d }, `簽下 ${d} 天長約`)}>
                    簽 {d} 天
                  </Btn>
                ))}
                {main.st.relationship < CONTRACT_MIN_REL && <span class="dim">（關係值需 {CONTRACT_MIN_REL}）</span>}
              </div>
            )}
          </div>
        )}

        {alts.map((d) => {
          const st = supplierState(s, d.id);
          if (!st?.discovered) return null;
          const down = supplierUnavailable(st, s.tick);
          const free = !!main && supplierUnavailable(main.st, s.tick);
          return (
            <div class="supplier" key={d.id}>
              <div class="row between">
                <b>{d.name}</b>
                <StatusChip s={s} st={st} />
              </div>
              <p class="small dim">{d.bio}</p>
              <div class="row between">
                <Traits def={d} />
                <Btn small disabled={down || (!!main && hasContract(main.st, s.tick))} title={main && hasContract(main.st, s.tick) ? "要先和目前的主力解約" : ""} onClick={() => run({ type: "chooseSupplier", family, supplierId: d.id }, `改向「${d.name}」進貨`)}>
                  改用{free ? "（免費）" : `（${money(SUPPLIER_SWITCH_FEE)}）`}
                </Btn>
              </div>
            </div>
          );
        })}
        {hiddenCount > 0 && <p class="small dim">🔒 還有 {hiddenCount} 家你不認識的供應商。有新業務上門拜訪時，就會認識他們。</p>}
      </div>
    </Card>
  );
}

export function Suppliers() {
  const s = state.value;
  if (!s) return null;
  const used = FAMILY_ORDER.filter((f) => familyShopCount(s, f) > 0);
  const unused = FAMILY_ORDER.filter((f) => familyShopCount(s, f) === 0);
  return (
    <>
      <Card title="📦 供應商與進貨">
        <div class="stack">
          <p class="small dim">進貨不再只有一個行情價：每種貨品都有一位主力供應商，價格、品質、可靠度各不相同。長期合作能換到折扣與優先供貨，但他們也會有自己的「狀況」——缺貨、罷工、漲價、倒閉。</p>
          <label class="row">
            <input type="checkbox" checked={s.supply.autoFallback} onChange={(e) => run({ type: "setSupplyPrefs", autoFallback: (e.target as HTMLInputElement).checked })} />
            <span>主力無法出貨時，自動向備用供應商買現貨（貴一成），避免店家斷貨</span>
          </label>
        </div>
      </Card>
      {used.map((f) => (
        <FamilyCard key={f} s={s} family={f} />
      ))}
      {unused.length > 0 && (
        <details class="unmet">
          <summary>目前還沒用到的貨品（{unused.length}）</summary>
          <p class="small dim" style={{ marginTop: "8px" }}>
            {unused.map((f) => `${SUPPLY_FAMILIES[f].icon}${SUPPLY_FAMILIES[f].name}`).join("、")}——開了對應的店，就會用到這些供應商。
          </p>
        </details>
      )}
    </>
  );
}
