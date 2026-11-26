import {
  CONTRACT_CANCEL_FEE,
  CONTRACT_DAYS,
  CONTRACT_MIN_REL,
  FAMILY_ORDER,
  FAMILY_OF,
  SHOCK_KINDS,
  SUPPLIERS,
  SUPPLIER_BY_ID,
  SUPPLIER_SWITCH_FEE,
  SUPPLY_FAMILIES,
  categoryHasStock,
  CATEGORY_BY_ID,
  chosenSupplier,
  coverDays,
  familyShopCount,
  hasContract,
  liveShock,
  shockFill,
  shockTier,
  supplierPriceNow,
  supplierState,
  supplierUnavailable,
  type PublicMallState,
  type SupplierDef,
  type SupplierState,
  type SupplyFamily,
} from "@coidle/shared";
import { Btn, Card, Chip, Meter } from "../components/ui";
import { gameDeadline, money } from "../format";
import { run, state } from "../store";

const STATUS: Record<string, { label: string; tone: "amber" | "red" | "cyan" }> = {
  shortage: { label: "出貨吃緊", tone: "amber" },
  strike: { label: "罷工中", tone: "red" },
  closed: { label: "已倒閉", tone: "red" },
  cold: { label: "和你鬧翻了", tone: "red" },
};

function until(s: PublicMallState, tick: number): string {
  return `到${gameDeadline(tick, s.tick)}`;
}

const TIER_LABEL = { contract: "長約客戶", loyal: "老主顧", friend: "有交情", none: "一般客戶" } as const;

function StatusChip({ s, st }: { s: PublicMallState; st: SupplierState }) {
  const sh = st.shock && st.shock.endTick > s.tick ? st.shock : null;
  if (sh && sh.startTick > s.tick) return <Chip tone="cyan">{SHOCK_KINDS[sh.kind].icon} 預告：{SHOCK_KINDS[sh.kind].label}</Chip>;
  if (sh && sh.kind !== "price_spike" && st.status !== "ok") return <Chip tone={sh.kind === "bankrupt" ? "red" : "amber"}>{SHOCK_KINDS[sh.kind].icon} {SHOCK_KINDS[sh.kind].label}・{until(s, sh.endTick)}</Chip>;
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

/** 全服供應衝擊的說明：預告或進行中，以及這座商場在對方心中的優先層級 */
function ShockNote({ s, st }: { s: PublicMallState; st: SupplierState }) {
  const sh = st.shock && st.shock.endTick > s.tick ? st.shock : null;
  if (!sh) return null;
  const k = SHOCK_KINDS[sh.kind];
  const upcoming = sh.startTick > s.tick;
  const tier = shockTier(st, s.tick);
  const fill = Math.round(shockFill(sh.fill, tier) * 100);
  return (
    <div class="small" style={{ borderLeft: "3px solid var(--amber, #d89b00)", padding: "4px 8px", marginTop: "4px" }}>
      <div>
        <b>
          {k.icon} {upcoming ? `預告：${k.warnText || k.label}` : `${k.label}進行中`}
        </b>
        <span class="dim">
          {" "}
          ・{upcoming ? `約${gameDeadline(sh.startTick, s.tick)}起` : `預計${gameDeadline(sh.endTick, s.tick)}結束`}・全服商場都受影響
        </span>
      </div>
      {sh.kind === "price_spike" ? (
        <div class="dim">價格將調漲到 ×{(sh.priceMult ?? 1).toFixed(2)}。簽長約可以鎖住價格。</div>
      ) : (
        <div class="dim">
          你是對方的「{TIER_LABEL[tier]}」，期間預計能拿到約 <b>{fill}%</b> 的貨量{tier === "none" ? "（沒有交情的客戶只分到最少）" : ""}。長約與好關係會排在前面；也可以換別家供應商（受衝擊時免費）。
        </div>
      )}
    </div>
  );
}

function FamilyCard({ s, family }: { s: PublicMallState; family: SupplyFamily }) {
  const info = SUPPLY_FAMILIES[family];
  const users = s.shops.filter((x) => x.mode === "direct" && FAMILY_OF[x.category] === family);
  const main = chosenSupplier(s, family);
  const alts = SUPPLIERS.filter((d) => d.family === family && d.id !== main?.def.id);
  const hiddenCount = alts.filter((d) => !supplierState(s, d.id)?.discovered).length;
  const known = alts.filter((d) => supplierState(s, d.id)?.discovered);
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
            <ShockNote s={s} st={main.st} />
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

        {users.some((u) => CATEGORY_BY_ID[u.category] && categoryHasStock(CATEGORY_BY_ID[u.category]!)) && (
          <div class="row small" style={{ gap: "6px", flexWrap: "wrap" }}>
            <span class="dim">庫存天數：</span>
            {users
              .filter((u) => CATEGORY_BY_ID[u.category] && categoryHasStock(CATEGORY_BY_ID[u.category]!))
              .map((u) => {
                const c = coverDays(u);
                return (
                  <Chip key={u.id} tone={c === null ? "dim" : c < 1 ? "red" : c < 1.5 ? "amber" : "green"}>
                    {u.name} {c === null ? "—" : `${c.toFixed(1)} 天`}
                  </Chip>
                );
              })}
          </div>
        )}
        {known.length > 0 && (
          <label class="row small">
            <span class="dim">首選備用供應商：</span>
            <select
              value={s.supply.backup?.[family] ?? ""}
              onChange={(e) => run({ type: "setSupplyPrefs", backup: { family, supplierId: (e.target as HTMLSelectElement).value || null } }, "已更新首選備用供應商")}
            >
              <option value="">自動（挑最划算的）</option>
              {known.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span class="dim">主力缺貨時，缺口先向他補</span>
          </label>
        )}
        {alts.map((d) => {
          const st = supplierState(s, d.id);
          if (!st?.discovered) return null;
          const down = supplierUnavailable(st, s.tick);
          const free = !!main && (supplierUnavailable(main.st, s.tick) || !!liveShock(main.st, s.tick));
          return (
            <div class="supplier" key={d.id}>
              <div class="row between">
                <b>{d.name}</b>
                <StatusChip s={s} st={st} />
              </div>
              <p class="small dim">{d.bio}</p>
              <ShockNote s={s} st={st} />
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

/** 全服供應動態：你認識的供應商裡，哪些正在或即將出事 */
function ShockOverview({ s }: { s: PublicMallState }) {
  const rows = s.supply.suppliers
    .filter((st) => st.discovered && st.shock && st.shock.endTick > s.tick)
    .map((st) => ({ st, sh: st.shock!, def: SUPPLIER_BY_ID[st.id]! }))
    .filter((x) => x.def)
    .sort((a, b) => a.sh.startTick - b.sh.startTick);
  return (
    <Card title="🌐 全服供應動態" right={<span class="small dim">所有商場同步發生</span>}>
      {rows.length === 0 ? (
        <p class="small dim">目前沒有供應商出狀況。罷工、颱風、食安回收、海關延誤、歉收……都會同時影響所有用到同一家供應商的商場，而且通常會提前預告。</p>
      ) : (
        <div class="stack">
          {rows.map(({ st, sh, def }) => {
            const k = SHOCK_KINDS[sh.kind];
            const upcoming = sh.startTick > s.tick;
            const mine = s.supply.choice[def.family] === def.id;
            return (
              <div class="row between small" key={st.id}>
                <span>
                  {k.icon} <b>{def.name}</b>（{SUPPLY_FAMILIES[def.family].name}）{k.label}
                  {mine && <Chip tone="pink">主力</Chip>}
                </span>
                <span class="dim">{upcoming ? `預告・約${gameDeadline(sh.startTick, s.tick)}起` : `進行中・${gameDeadline(sh.endTick, s.tick)}結束`}</span>
              </div>
            );
          })}
        </div>
      )}
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
          <p class="small dim">進貨不再只有一個行情價：每種貨品（餐飲、零售的庫存，以及娛樂、服務、旅宿的耗材）都有一位主力供應商，價格、品質、可靠度各不相同。長期合作能換到折扣；而當供應商出狀況——罷工、颱風、食安回收、海關延誤、倒閉——全服商場一起受影響，貨量會依長約與關係好壞優先分配。</p>
          <label class="row">
            <input type="checkbox" checked={s.supply.autoFallback} onChange={(e) => run({ type: "setSupplyPrefs", autoFallback: (e.target as HTMLInputElement).checked })} />
            <span>主力無法出貨或湊不齊貨時，自動向備用供應商補缺口／買現貨（貴一成到一成半），避免店家斷貨</span>
          </label>
        </div>
      </Card>
      <ShockOverview s={s} />
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
