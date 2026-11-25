import { useEffect, useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  MAX_SHOP_LEVEL,
  REFRESH_COST,
  SUPPLY_LEAD_TICKS,
  SUPPLY_LOT,
  UPGRADE_BASE_COST,
  UPGRADE_TICKS,
  categoryHasStock,
  chosenSupplier,
  leaseEnabled,
  currentUnitCost,
  familyOf,
  PRICE_TOLERANCE,
} from "@coidle/shared";
import { Btn, Card, Chip, Field, Meter, Sheet } from "../components/ui";
import { money, num, realDuration } from "../format";
import { categoryIcon } from "../icons";
import { run, state } from "../store";

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

  // 伺服器那邊價格／規則變動（隊友改了）時同步表單
  useEffect(() => {
    if (shop) setPrice(shop.price);
  }, [shop?.price]);
  useEffect(() => {
    if (shop) setRule(shop.restock);
  }, [shop?.restock.enabled, shop?.restock.min, shop?.restock.target, shop?.restock.dailyBudget]);

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
    rule.enabled !== shop.restock.enabled || rule.min !== shop.restock.min || rule.target !== shop.restock.target || rule.dailyBudget !== shop.restock.dailyBudget;
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
          <b>{Math.ceil(cat.baseCapacity * (1 + 0.3 * (shop.level - 1)))}</b>
        </div>
      </div>

      {direct && (
        <>
          <Card title="💰 定價">
            <div class="stack">
              <div class="stepper">
                <Btn onClick={() => setPrice(Math.max(1, price - step))}>−</Btn>
                <NumberInput value={price} onChange={setPrice} step={step} min={1} />
                <Btn onClick={() => setPrice(price + step)}>＋</Btn>
              </div>
              <div class="row between small">
                <span class="dim">參考價 {money(cat.refPrice)}</span>
                <span>
                  {stocked ? `進貨 ${money(uc)}／份・` : ""}毛利率 <Chip tone={priceTone}>{Math.round(margin * 100)}%</Chip>
                </span>
              </div>
              <p class="small dim">定太高客人會跑掉、口碑下滑；定太低賺不到錢，但客人開心、人氣好。標價超過參考價約 {PRICE_TOLERANCE} 倍後，客人看了價格就會走。</p>
              <Btn kind="primary" disabled={price === shop.price || price < 1} onClick={() => run({ type: "setPrice", shopId: shop.id, price }, "價格已更新")}>
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
                    {main.st.status !== "ok" && main.st.statusUntil > s.tick ? `（${{ shortage: "出貨吃緊", strike: "罷工中", closed: "已倒閉", cold: "鬧翻了" }[main.st.status]}）` : ""}
                    ・每份 {money(uc)}
                  </p>
                )}
                {incoming > 0 && <p class="small dim">在途 {num(incoming)} 份（約 {realDuration(SUPPLY_LEAD_TICKS, s.clock.speed, s.clock.lag)}內送到）</p>}
                <label class="row">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule({ ...rule, enabled: (e.target as HTMLInputElement).checked })} />
                  <span>啟用自動補貨</span>
                </label>
                <div class="two-col">
                  <Field label="低於此量就補">
                    <NumberInput value={rule.min} onChange={(v) => setRule({ ...rule, min: v })} step={SUPPLY_LOT} />
                  </Field>
                  <Field label="補到">
                    <NumberInput value={rule.target} onChange={(v) => setRule({ ...rule, target: v })} step={SUPPLY_LOT} />
                  </Field>
                </div>
                <Field label="每日採購預算上限" hint={`約可買 ${num(rule.dailyBudget / Math.max(1, uc))} 份`}>
                  <NumberInput value={rule.dailyBudget} onChange={(v) => setRule({ ...rule, dailyBudget: v })} step={10000} />
                </Field>
                <Btn disabled={!ruleChanged} onClick={() => run({ type: "setRestock", shopId: shop.id, rule }, "補貨規則已儲存")}>
                  儲存補貨規則
                </Btn>
                <div class="row">
                  <span class="small dim">手動進貨：</span>
                  {[50, 200, 500].map((q) => (
                    <Btn key={q} small onClick={() => run({ type: "orderStock", shopId: shop.id, qty: q }, `已訂購 ${q} 份`)}>
                      +{q}（{money(uc * q)}）
                    </Btn>
                  ))}
                </div>
              </div>
            </Card>
          )}

          <Card title="✨ 新鮮感" right={<span class="small dim">每遊戲日 −4</span>}>
            <div class="stack">
              <Meter label="菜單／店面新鮮感" value={shop.freshness} hint={`${Math.round(shop.freshness)}`} />
              <Btn disabled={shop.freshness >= 90} onClick={() => run({ type: "refreshShop", shopId: shop.id }, "推出新菜單！")}>
                換新菜單／辦活動（{money(refreshCost)}）
              </Btn>
            </div>
          </Card>
        </>
      )}

      <Card title="🔨 翻新升級">
        <div class="stack">
          <p class="small dim">
            升級提升品質、容量與滿意度（Lv.{shop.level} → Lv.{Math.min(MAX_SHOP_LEVEL, shop.level + 1)}），施工 {realDuration(UPGRADE_TICKS, s.clock.speed, s.clock.lag)}；店內人事成本同步增加。
          </p>
          <Btn kind="primary" disabled={shop.level >= MAX_SHOP_LEVEL || upgrading} onClick={() => run({ type: "upgradeShop", shopId: shop.id }, "開始翻新")}>
            {shop.level >= MAX_SHOP_LEVEL ? "已達最高等級" : upgrading ? "翻新中…" : `升級（${money(upgradeCost)}）`}
          </Btn>
        </div>
      </Card>

      {shop.tenant && !shop.tenant.own && (
        <Card title={`🤝 租戶：${shop.tenant.brand}`}>
          <p class="small">
            滿意度 {Math.round(shop.tenant.satisfaction)}・品質 {Math.round(shop.tenant.quality * 100)}・知名度 {shop.tenant.fame}・每日租金 {money(shop.tenant.rent)} ＋ 抽成 {Math.round(shop.tenant.commission * 100)}%。到「開發 → 招商」可以續約或解約。
          </p>
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
