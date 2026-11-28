import { useEffect, useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  MAX_SHOP_LEVEL,
  REFRESH_COST,
  RUSH_PREMIUM,
  SHOCK_KINDS,
  SMART_COVER_DAYS,
  SUPPLY_LEAD_TICKS,
  SUPPLY_LOT,
  coverDays,
  restockPlan,
  storageCap,
  UPGRADE_BASE_COST,
  UPGRADE_TICKS,
  categoryHasStock,
  chosenSupplier,
  leaseEnabled,
  currentUnitCost,
  familyOf,
  PRICE_TOLERANCE,
  PRICE_MIN,
  PRICE_HARD_MAX,
  SHOP_NAME_MAX,
  BRAND_TIER_NAME,
  brandByName,
  TERMINATE_PENALTY,
  leaseRemainingRent,
  spanFactor,
  DEMOLISH_FEE_RATE,
  openPlanEnabled,
  spanCostFactor,
} from "@coidle/shared";
import { Btn, Card, Chip, Field, Meter, Sheet } from "../components/ui";
import { gameDuration, money, num } from "../format";
import { categoryIcon } from "../icons";
import { run, state } from "../store";
import { confirmThen } from "../components/ConfirmHost";

function NumberInput(props: { value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={props.value}
      step={props.step}
      min={props.min ?? 0}
      onInput={(e) => props.onChange(Number((e.target as HTMLInputElement).value))}
    />
  );
}

export function ShopSheet({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const s = state.value;
  const shop = s?.shops.find((x) => x.id === shopId);

  const [price, setPrice] = useState(shop?.price ?? 0);
  const [rule, setRule] = useState(shop?.restock ?? { enabled: true, min: 100, target: 350, dailyBudget: 0 });
  const [newName, setNewName] = useState(shop?.name ?? "");
  useEffect(() => {
    if (shop) setNewName(shop.name);
  }, [shop?.name]);

  // 伺服器那邊價格／規則變動（隊友改了）時同步表單
  useEffect(() => {
    if (shop) setPrice(shop.price);
  }, [shop?.price]);
  useEffect(() => {
    if (shop) setRule(shop.restock);
  }, [shop?.restock.enabled, shop?.restock.min, shop?.restock.target, shop?.restock.dailyBudget, shop?.restock.smart, shop?.restock.coverDays, shop?.restock.preShock]);

  if (!s || !shop) {
    return (
      <Sheet title="店鋪" onClose={onClose}>
        <p class="empty">這間店不見了。</p>
      </Sheet>
    );
  }
  const cat = CATEGORY_BY_ID[shop.category]!;
  const stocked = categoryHasStock(cat);
  const direct = shop.mode === "direct";
  const uc = currentUnitCost(s, shop.category);
  const fam = familyOf(shop.category);
  const main = fam ? chosenSupplier(s, fam) : null;
  const margin = stocked ? (price - uc) / Math.max(1, price) : 1 - cat.costRatio;
  const step = Math.max(10, Math.round((cat.refPrice * 0.05) / 10) * 10);
  const incoming = shop.incoming.reduce((a, b) => a + b.qty, 0);
  const upgrading = s.builds.some((b) => b.kind === "upgrade" && b.shopId === shop.id);
  const upgradeCost = UPGRADE_BASE_COST * shop.level;
  const refreshCost = REFRESH_COST * shop.level;
  const ruleChanged =
    rule.enabled !== shop.restock.enabled ||
    rule.min !== shop.restock.min ||
    rule.target !== shop.restock.target ||
    rule.dailyBudget !== shop.restock.dailyBudget ||
    !!rule.smart !== !!shop.restock.smart ||
    (rule.coverDays ?? SMART_COVER_DAYS) !== (shop.restock.coverDays ?? SMART_COVER_DAYS) ||
    (rule.preShock !== false) !== (shop.restock.preShock !== false);
  const cap = storageCap(shop);
  const have = shop.stock + incoming;
  const cover = coverDays(shop);
  const plan = stocked ? restockPlan(s, { ...shop, restock: rule }) : null;
  const mainShock = main?.st.shock && main.st.shock.endTick > s.tick ? main.st.shock : null;
  const outOfRange = !Number.isFinite(price) || price < PRICE_MIN || price > PRICE_HARD_MAX;
  const priceTone = price > cat.refPrice * 1.3 ? "amber" : price < cat.refPrice * 0.8 ? "cyan" : "green";

  return (
    <Sheet
      title={
        <>
          {categoryIcon(shop.category)} {shop.name}
        </>
      }
      onClose={onClose}
    >
      <div class="row">
        <Chip tone="amber">Lv.{shop.level}</Chip>
        <Chip tone="dim">{cat.name}</Chip>
        {shop.closedUntilTick > s.tick && <Chip tone="red">休息中</Chip>}
        {shop.mode === "lease" && <Chip tone="cyan">出租</Chip>}
      </div>

      <div class="stat-grid">
        <div class="stat">
          <span>今日營收</span>
          <b>{money(shop.day.revenue)}</b>
        </div>
        <div class="stat">
          <span>售出份數</span>
          <b>{num(shop.day.units)}</b>
        </div>
        <div class="stat">
          <span>接待組數</span>
          <b>{num(shop.day.groups)}</b>
        </div>
        <div class="stat">
          <span>缺貨損失</span>
          <b class={shop.day.stockouts > 0 ? "neg" : ""}>{num(shop.day.stockouts)}</b>
        </div>
        <div class="stat">
          <span>排不到位子</span>
          <b class={shop.day.lost > 0 ? "neg" : ""}>{num(shop.day.lost)}</b>
        </div>
        <div class="stat">
          <span>每 5 分鐘容量</span>
          <b>{Math.ceil(cat.baseCapacity * (1 + 0.3 * (shop.level - 1)) * spanFactor(shop.span))}</b>
        </div>
      </div>

      {direct && (
        <>
          <Card title="💰 定價">
            <div class="stack">
              <div class="stepper">
                <Btn disabled={price <= PRICE_MIN} onClick={() => setPrice(Math.max(PRICE_MIN, price - step))}>−</Btn>
                <NumberInput value={price} onChange={setPrice} step={step} min={PRICE_MIN} />
                <Btn disabled={price >= PRICE_HARD_MAX} onClick={() => setPrice(Math.min(PRICE_HARD_MAX, price + step))}>＋</Btn>
              </div>
              <div class="row between small">
                <span class="dim">參考價 {money(cat.refPrice)}</span>
                <span>
                  {stocked ? `進貨 ${money(uc)}／份・` : ""}毛利率 <Chip tone={priceTone}>{Math.round(margin * 100)}%</Chip>
                </span>
              </div>
              <p class="small dim">定太高客人會跑掉、口碑下滑；定太低賺不到錢，但客人開心、人氣好。標價超過參考價約 {PRICE_TOLERANCE} 倍後，客人看了價格就會走。</p>
              {outOfRange && <p class="small neg">價格要在 {money(PRICE_MIN)}～{money(PRICE_HARD_MAX)} 之間。</p>}
              <Btn kind="primary" disabled={price === shop.price || outOfRange} onClick={() => run({ type: "setPrice", shopId: shop.id, price }, "價格已更新")}>
                套用價格
              </Btn>
            </div>
          </Card>

          {stocked && (
            <Card title="📦 庫存與自動補貨" right={<Chip tone={shop.stock < 1 ? "red" : "dim"}>庫存 {num(shop.stock)}</Chip>}>
              <div class="stack">
                {main && (
                  <p class="small dim">
                    進貨：{main.def.name}
                    {main.st.status !== "ok" && main.st.statusUntil > s.tick ? `（${mainShock ? SHOCK_KINDS[mainShock.kind].label : { shortage: "出貨吃緊", strike: "罷工中", closed: "已倒閉", cold: "鬧翻了" }[main.st.status]}）` : ""}
                    ・每份 {money(uc)}
                  </p>
                )}
                {mainShock && (
                  <p class="small" style={{ color: "var(--amber, #d89b00)" }}>
                    {SHOCK_KINDS[mainShock.kind].icon} {mainShock.startTick > s.tick ? `供應商預告：${SHOCK_KINDS[mainShock.kind].warnText || SHOCK_KINDS[mainShock.kind].label}` : `供應商${SHOCK_KINDS[mainShock.kind].label}中`}。{rule.smart && rule.preShock !== false ? "智慧補貨已提前加大備貨。" : "可以先多備一些貨，或開啟智慧補貨。"}
                  </p>
                )}
                <Meter label={`倉庫（容量 ${num(cap)} 份，含在途）`} value={Math.min(100, (have / cap) * 100)} hint={`${num(have)} / ${num(cap)}`} tone={have >= cap ? "red" : "cyan"} />
                <div class="row small" style={{ gap: "6px" }}>
                  {cover !== null && <Chip tone={cover < 1 ? "red" : cover < 1.5 ? "amber" : "green"}>夠賣約 {cover.toFixed(1)} 天</Chip>}
                  {shop.avgDaily !== undefined && <span class="dim">日均賣出 {num(Math.round(shop.avgDaily))} 份</span>}
                  {(shop.day.waste ?? 0) > 0 && <Chip tone="amber">今天放壞 {num(shop.day.waste ?? 0)} 份</Chip>}
                  {(shop.day.short ?? 0) > 0 && <Chip tone="red">今天缺口 {num(shop.day.short ?? 0)} 份沒補到</Chip>}
                </div>
                {incoming > 0 && <p class="small dim">在途 {num(incoming)} 份（約{gameDuration(SUPPLY_LEAD_TICKS)}內送到，依供應商而異）</p>}
                <label class="row">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule({ ...rule, enabled: (e.target as HTMLInputElement).checked })} />
                  <span>啟用自動補貨</span>
                </label>
                <label class="row">
                  <input type="checkbox" checked={!!rule.smart} onChange={(e) => setRule({ ...rule, smart: (e.target as HTMLInputElement).checked })} />
                  <span>智慧補貨：依日均銷量與供應商交期自動決定下限與目標</span>
                </label>
                {rule.smart ? (
                  <>
                    <div class="two-col">
                      <Field label="備貨天數" hint="備太多會放壞（易腐品）、佔倉庫">
                        <NumberInput value={rule.coverDays ?? SMART_COVER_DAYS} onChange={(v) => setRule({ ...rule, coverDays: v })} step={0.5} min={1} />
                      </Field>
                      <label class="row" style={{ alignSelf: "end" }}>
                        <input type="checkbox" checked={rule.preShock !== false} onChange={(e) => setRule({ ...rule, preShock: (e.target as HTMLInputElement).checked })} />
                        <span>預告時先囤貨</span>
                      </label>
                    </div>
                    {plan && (
                      <p class="small dim">
                        目前規則：低於 <b>{num(plan.min)}</b> 就補、補到 <b>{num(plan.target)}</b>。{plan.notes.join("；")}
                      </p>
                    )}
                  </>
                ) : (
                  <div class="two-col">
                    <Field label="低於此量就補">
                      <NumberInput value={rule.min} onChange={(v) => setRule({ ...rule, min: v })} step={SUPPLY_LOT} />
                    </Field>
                    <Field label="補到">
                      <NumberInput value={rule.target} onChange={(v) => setRule({ ...rule, target: v })} step={SUPPLY_LOT} />
                    </Field>
                  </div>
                )}
                <Field label="每日採購預算上限" hint={`約可買 ${num(rule.dailyBudget / Math.max(1, uc))} 份`}>
                  <NumberInput value={rule.dailyBudget} onChange={(v) => setRule({ ...rule, dailyBudget: v })} step={10000} />
                </Field>
                <Btn disabled={!ruleChanged} onClick={() => run({ type: "setRestock", shopId: shop.id, rule }, "補貨規則已儲存")}>
                  儲存補貨規則
                </Btn>
                <div class="row">
                  <span class="small dim">手動進貨：</span>
                  {[50, 200, 500].map((q) => (
                    <Btn key={q} small disabled={have >= cap} onClick={() => run({ type: "orderStock", shopId: shop.id, qty: q }, `已訂購 ${q} 份`)}>
                      +{q}（{money(uc * q)}）
                    </Btn>
                  ))}
                </div>
                <div class="row">
                  <span class="small dim" title="貴三成、交期縮短，適合臨時缺貨">急件：</span>
                  {[50, 200].map((q) => (
                    <Btn key={q} small disabled={have >= cap} onClick={() => run({ type: "orderStock", shopId: shop.id, qty: q, rush: true }, `已下急件 ${q} 份`)}>
                      +{q}（{money(Math.ceil(uc * RUSH_PREMIUM) * q)}）
                    </Btn>
                  ))}
                </div>
              </div>
            </Card>
          )}

          <Card title="✨ 新鮮感" right={<span class="small dim">每遊戲日 −4</span>}>
            <div class="stack">
              <Meter label="菜單／店面新鮮感" value={shop.freshness} hint={`${Math.round(shop.freshness)}`} />
              <Btn disabled={shop.freshness >= 90} onClick={() => confirmThen(`幫「${shop.name}」換新菜單／辦活動？\n費用 ${money(refreshCost)}，現在就會扣款，新鮮感會回升。`, () => run({ type: "refreshShop", shopId: shop.id }, "推出新菜單！"))}>
                換新菜單／辦活動（{money(refreshCost)}）
              </Btn>
            </div>
          </Card>
        </>
      )}

      <Card title="🔨 翻新升級">
        <div class="stack">
          <p class="small dim">
            升級提升品質、容量與滿意度（Lv.{shop.level} → Lv.{Math.min(MAX_SHOP_LEVEL, shop.level + 1)}），施工{gameDuration(UPGRADE_TICKS)}；店內人事成本同步增加。
          </p>
          <Btn kind="primary" disabled={shop.level >= MAX_SHOP_LEVEL || upgrading} onClick={() => confirmThen(`把「${shop.name}」翻新升級到 Lv.${shop.level + 1}？\n費用 ${money(upgradeCost)}，現在就會扣款；施工${gameDuration(UPGRADE_TICKS)}，店內人事成本也會增加。`, () => run({ type: "upgradeShop", shopId: shop.id }, "開始翻新"))}>
            {shop.level >= MAX_SHOP_LEVEL ? "已達最高等級" : upgrading ? "翻新中…" : `升級（${money(upgradeCost)}）`}
          </Btn>
        </div>
      </Card>

      {shop.tenant && !shop.tenant.own && (
        <Card title={`🤝 租戶：${shop.tenant.brand}`}>
          <p class="small">
            滿意度 {Math.round(shop.tenant.satisfaction)}・品質 {Math.round(shop.tenant.quality * 100)}・知名度 {shop.tenant.fame}・每日租金 {money(shop.tenant.rent)} ＋ 抽成 {Math.round(shop.tenant.commission * 100)}%。到「開發 → 招商」可以續約或解約。
          </p>
          <Btn
            small
            kind="danger"
            onClick={() => {
              const t = shop.tenant!;
              const penalty = Math.round(leaseRemainingRent(t.rent, t.endTick, s.tick) * TERMINATE_PENALTY);
              confirmThen(`提前解約要付違約金 ${money(penalty)}，店面會空出來，確定嗎？`, async () => {
                if (await run({ type: "terminateLease", shopId: shop.id }, "已解約")) onClose();
              });
            }}
          >
            提前解約
          </Btn>
        </Card>
      )}
      {shop.mode === "direct" && (
        <Card title="🏷️ 店名與歇業">
          {brandByName(shop.name) && (
            <p class="small dim">
              連鎖品牌「{brandByName(shop.name)!.name}」（{BRAND_TIER_NAME[brandByName(shop.name)!.tier]}）：{brandByName(shop.name)!.blurb}
            </p>
          )}
          <div class="stack">
            <div class="row">
              <input type="text" value={newName} maxLength={SHOP_NAME_MAX} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
              <Btn small disabled={!newName.trim() || newName.trim() === shop.name} onClick={() => run({ type: "renameShop", shopId: shop.id, name: newName.trim() }, "已改名")}>
                改名
              </Btn>
            </div>
            <Btn
              small
              kind="danger"
              onClick={() =>
                confirmThen(`讓「${shop.name}」歇業？\n店面會空出來，庫存與研發進度作廢、不退費，之後可以重新蓋別的店或招商。`, async () => {
                  if (await run({ type: "closeShop", shopId: shop.id }, "已歇業")) onClose();
                })
              }
            >
              歇業
            </Btn>
            {openPlanEnabled(s) && (
              <Btn
                small
                kind="danger"
                onClick={() => {
                  const fee = Math.round(cat.buildCost * spanCostFactor(shop.span) * DEMOLISH_FEE_RATE);
                  confirmThen(
                    `拆除「${shop.name}」？\n拆除費 ${money(fee)}（建造費的 ${Math.round(DEMOLISH_FEE_RATE * 100)}%，裝潢報廢不退款），現在就會扣款。${shop.span && shop.span > 1 ? "\n併進來的格子會還成空地，之後可以重新規劃大小。" : ""}\n同一層拆完要隔一個遊戲日才能再拆。`,
                    async () => {
                      if (await run({ type: "demolishShop", shopId: shop.id }, "已拆除")) onClose();
                    },
                  );
                }}
              >
                拆除重建
              </Btn>
            )}
          </div>
        </Card>
      )}
      {leaseEnabled(s) && (!shop.tenant || shop.tenant.own) && (
        <Card title="🤝 出租">
          <Btn onClick={() => run({ type: "setLease", shopId: shop.id, enabled: shop.mode !== "lease" }, shop.mode === "lease" ? "改回直營" : "已出租")}>
            {shop.mode === "lease" ? "收回自營" : `出租給品牌（每日租金 ${money(shop.rent)} + 抽成 ${Math.round(shop.commission * 100)}%）`}
          </Btn>
        </Card>
      )}
    </Sheet>
  );
}
