/**
 * 統一補貨頁：所有直營、需要進貨的店集中在這裡，依樓層分組。
 * 每層樓可以一次設定補貨規則（啟用／智慧補貨／備貨天數／下限與目標），也可以對單間店手動進貨。
 */
import { useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  RUSH_PREMIUM,
  SMART_COVER_DAYS,
  SUPPLY_LOT,
  ZONES,
  categoryHasStock,
  coverDays,
  currentUnitCost,
  restockPlan,
  storageCap,
  type PublicMallState,
  type RestockRule,
  type Shop,
} from "@coidle/shared";
import { Btn, Card, Chip, Field } from "../components/ui";
import { confirmThen } from "../components/ConfirmHost";
import { money, num } from "../format";
import { categoryIcon } from "../icons";
import { run, state } from "../store";
import { floorTitle, zoneOfShop } from "./Workshop";

type FloorRule = Pick<RestockRule, "enabled" | "min" | "target" | "smart" | "coverDays" | "preShock">;

const needsStock = (shop: Shop): boolean => {
  const cat = CATEGORY_BY_ID[shop.category];
  return shop.mode === "direct" && !!cat && categoryHasStock(cat);
};

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

/** 一組樓層（或全部）共用的規則表單：預設值取自第一間店 */
function RuleEditor({ label, shops }: { label: string; shops: Shop[] }) {
  const first = shops[0]!.restock;
  const [rule, setRule] = useState<FloorRule>({
    enabled: first.enabled,
    min: first.min,
    target: first.target,
    smart: !!first.smart,
    coverDays: first.coverDays ?? SMART_COVER_DAYS,
    preShock: first.preShock !== false,
  });
  const bad = !rule.smart && rule.target < rule.min;
  const apply = () =>
    confirmThen(`把這組補貨規則套用到${label}的 ${shops.length} 間店？\n各店原本的規則會被覆蓋（每日採購預算不變）。`, () =>
      run({ type: "setRestockMany", shopIds: shops.map((x) => x.id), rule }, `已套用到 ${shops.length} 間店`),
    );
  return (
    <div class="stack">
      <label class="row">
        <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule({ ...rule, enabled: (e.target as HTMLInputElement).checked })} />
        <span>啟用自動補貨</span>
      </label>
      <label class="row">
        <input type="checkbox" checked={!!rule.smart} onChange={(e) => setRule({ ...rule, smart: (e.target as HTMLInputElement).checked })} />
        <span>智慧補貨：依各店日均銷量與供應商交期自動決定下限與目標</span>
      </label>
      {rule.smart ? (
        <div class="two-col">
          <Field label="備貨天數" hint="備太多會放壞、佔倉庫">
            <NumberInput value={rule.coverDays ?? SMART_COVER_DAYS} onChange={(v) => setRule({ ...rule, coverDays: v })} step={0.5} min={1} />
          </Field>
          <label class="row" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={rule.preShock !== false} onChange={(e) => setRule({ ...rule, preShock: (e.target as HTMLInputElement).checked })} />
            <span>預告時先囤貨</span>
          </label>
        </div>
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
      {bad && <p class="small neg">補貨目標不可低於下限。</p>}
      <Btn kind="primary" disabled={bad} onClick={apply}>
        套用到{label}（{shops.length} 間）
      </Btn>
    </div>
  );
}

function ShopRow({ s, shop }: { s: PublicMallState; shop: Shop }) {
  const cat = CATEGORY_BY_ID[shop.category]!;
  const incoming = shop.incoming.reduce((a, b) => a + b.qty, 0);
  const have = shop.stock + incoming;
  const cap = storageCap(shop);
  const cover = coverDays(shop);
  const plan = restockPlan(s, shop);
  const uc = currentUnitCost(s, shop.category);
  const budgetLeft = shop.restock.dailyBudget - shop.spentToday;
  const tone = shop.stock < 1 ? "red" : cover !== null && cover < 1 ? "red" : cover !== null && cover < 1.5 ? "amber" : "green";
  return (
    <div class="stack" style={{ padding: "8px 0", borderTop: "1px solid var(--line, #3333)" }}>
      <div class="row between">
        <b>
          {categoryIcon(shop.category)} {shop.name}
        </b>
        <span class="row" style={{ gap: "6px" }}>
          <Chip tone={tone}>庫存 {num(shop.stock)}</Chip>
          {cover !== null && <Chip tone={tone}>約 {cover.toFixed(1)} 天</Chip>}
        </span>
      </div>
      <p class="small dim">
        {cat.name}・{shop.restock.enabled ? `${shop.restock.smart ? "智慧" : "固定"}補貨：低於 ${num(plan.min)} 補到 ${num(plan.target)}` : "自動補貨已關閉"}・在途 {num(incoming)}・倉庫 {num(have)}／{num(cap)}
        {budgetLeft < SUPPLY_LOT * uc ? "・今日預算用完" : ""}
      </p>
      <div class="row" style={{ gap: "6px", flexWrap: "wrap" }}>
        <label class="row small">
          <input
            type="checkbox"
            checked={shop.restock.enabled}
            onChange={(e) => run({ type: "setRestock", shopId: shop.id, rule: { enabled: (e.target as HTMLInputElement).checked } })}
          />
          <span>自動</span>
        </label>
        {[50, 200].map((q) => (
          <Btn key={q} small disabled={have >= cap} onClick={() => run({ type: "orderStock", shopId: shop.id, qty: q }, `已訂購 ${q} 份`)}>
            +{q}（{money(uc * q)}）
          </Btn>
        ))}
        <Btn small disabled={have >= cap} onClick={() => run({ type: "orderStock", shopId: shop.id, qty: 50, rush: true }, "已下急件 50 份")}>
          急件 +50（{money(Math.ceil(uc * RUSH_PREMIUM) * 50)}）
        </Btn>
      </div>
    </div>
  );
}

export function Restock() {
  const s = state.value;
  if (!s) return null;
  const all = s.shops.filter(needsStock);
  if (all.length === 0) {
    return (
      <Card title="📦 統一補貨">
        <p class="empty">目前沒有需要進貨的直營店。</p>
      </Card>
    );
  }
  const floors = ZONES.map((z) => ({ id: z.id, shops: all.filter((x) => zoneOfShop(s, x) === z.id) })).filter((f) => f.shops.length > 0);
  const low = all.filter((x) => {
    const c = coverDays(x);
    return x.stock < 1 || (c !== null && c < 1);
  }).length;
  const off = all.filter((x) => !x.restock.enabled).length;
  return (
    <>
      <Card title="📦 統一補貨" right={<span class="small dim">共 {all.length} 間店・{floors.length} 層</span>}>
        <div class="row small" style={{ gap: "6px", flexWrap: "wrap" }}>
          <Chip tone={low > 0 ? "red" : "green"}>{low > 0 ? `${low} 間快沒貨` : "庫存都夠"}</Chip>
          {off > 0 && <Chip tone="amber">{off} 間自動補貨關閉</Chip>}
        </div>
        <details style={{ marginTop: "8px" }}>
          <summary>全部樓層一起設定</summary>
          <RuleEditor label="全部樓層" shops={all} />
        </details>
      </Card>
      {floors.map((f) => (
        <Card key={f.id} title={floorTitle(f.id)} right={<span class="small dim">{f.shops.length} 間店</span>}>
          <details>
            <summary>這一層的補貨規則</summary>
            <RuleEditor label="這一層" shops={f.shops} />
          </details>
          {f.shops.map((x) => (
            <ShopRow key={x.id} s={s} shop={x} />
          ))}
        </Card>
      ))}
    </>
  );
}
