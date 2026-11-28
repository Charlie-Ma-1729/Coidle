import { useEffect, useState } from "preact/hooks";
import { CATEGORY_BY_ID, MAX_SHOP_LEVEL, PRICE_TOLERANCE, REFRESH_COST, PRICE_MIN, PRICE_HARD_MAX, UPGRADE_BASE_COST, UPGRADE_TICKS, categoryHasStock, currentUnitCost, leaseEnabled, leaseRemainingRent, TERMINATE_PENALTY, BIG_UNLOCK, DEMOLISH_FEE_RATE, PERSONA_BY_ID, openPlanEnabled, spanCostFactor } from "@coidle/shared";
import { gameDeadline, gameDuration, money, num } from "../format";
import { workshopFocus } from "../screens/Workshop";
import type { HubId, StageFloor } from "../stage/model";
import { busy, run, state } from "../store";
import { confirmThen } from "../components/ConfirmHost";

const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

function Meter(props: { value: number; label: string; hint: string }) {
  const tone = props.value < 30 ? "red" : props.value < 50 ? "amber" : "";
  return (
    <div class="st-sec">
      <div class="st-row between">
        <span class="st-hint">{props.label}</span>
        <b style={{ fontSize: "0.82rem" }}>{props.hint}</b>
      </div>
      <div class="st-meter">
        <i class={tone} style={{ width: `${Math.max(0, Math.min(100, props.value))}%` }} />
      </div>
    </div>
  );
}

function Head(props: { color: string; title: string; sub: string; onClose: () => void }) {
  return (
    <div class="st-side-head">
      <div class="st-sign" style={{ background: props.color }} />
      <div>
        <h2>{props.title}</h2>
        <small>{props.sub}</small>
      </div>
      <button class="st-btn sq st-x" onClick={props.onClose} aria-label="關閉">
        ✕
      </button>
    </div>
  );
}

/**
 * 店面面板（真實資料）：價格、補貨、新鮮感、升級、出租都在這裡就地處理；
 * 補貨規則等進階設定開啟既有的完整設定。
 */
export function RealShopPanel(props: {
  slot: number;
  floor: StageFloor;
  onClose: () => void;
  openHub: (hub: HubId, tab?: string) => void;
  openSheet: (shopId: string) => void;
}) {
  const s = state.value;
  const lot = props.floor.lots.find((l) => l.slot === props.slot);
  const stage = lot?.shop ?? null;
  const shop = s && stage ? s.shops.find((x) => x.id === stage.id) : undefined;
  const [price, setPrice] = useState(shop?.price ?? 0);
  useEffect(() => {
    if (shop) setPrice(shop.price);
  }, [shop?.id, shop?.price]);

  const floorName = `${props.floor.label} ${props.floor.name}`;

  if (props.floor.lockedLevel != null) {
    return (
      <aside class="st-side st-panel" aria-label="尚未解鎖">
        <Head color="#3a3a5a" title="尚未解鎖" sub={floorName} onClose={props.onClose} />
        <div class="st-side-body">
          <p class="st-hint">
            商場升到 <b>Lv.{props.floor.lockedLevel}</b> 後開放（目前 Lv.{s?.level ?? 1}）。累積營收、維持口碑，就能解鎖新的區域與業態。
          </p>
          {props.floor.description && <p class="st-hint">{props.floor.description}</p>}
        </div>
      </aside>
    );
  }

  if (stage?.state === "building" && s) {
    const task = s.builds.find((b) => b.kind === "open" && b.slot === props.slot);
    return (
      <aside class="st-side st-panel" aria-label="施工中">
        <Head color={hex(stage.color)} title={stage.name} sub={`${floorName}・施工中`} onClose={props.onClose} />
        <div class="st-side-body">
          <Meter value={(stage.progress ?? 0) * 100} label="施工進度" hint={`${Math.round((stage.progress ?? 0) * 100)}%`} />
          {task && <p class="st-hint">預計{gameDeadline(task.completeTick, s.tick)}完工。施工期間不會有客人，也不需要你做任何事。</p>}
        </div>
      </aside>
    );
  }

  if (!s || !shop || !stage) return null;

  const cat = CATEGORY_BY_ID[shop.category]!;
  const stocked = categoryHasStock(cat);
  const direct = shop.mode === "direct";
  const uc = currentUnitCost(s, shop.category);
  const step = Math.max(10, Math.round((cat.refPrice * 0.05) / 10) * 10);
  const closed = shop.closedUntilTick > s.tick;
  const out = direct && stocked && shop.stock < 1;
  const stale = direct && shop.freshness < 40;
  const complaints = s.inbox.filter((i) => i.shopId === shop.id).length;
  const upgrading = s.builds.some((b) => b.kind === "upgrade" && b.shopId === shop.id);
  const upgradeCost = UPGRADE_BASE_COST * shop.level * spanCostFactor(shop.span);
  const refreshCost = REFRESH_COST * shop.level;
  const gap = price - shop.price;
  const canLease = leaseEnabled(s) && (!shop.tenant || shop.tenant.own);

  return (
    <aside class="st-side st-panel" aria-label={`${shop.name} 店面面板`}>
      <Head
        color={hex(stage.color)}
        title={shop.name}
        sub={`${cat.name}${shop.span && shop.span > 1 ? `・${shop.span} 格大店` : ""}・Lv.${shop.level}・${shop.mode === "direct" ? "直營" : "出租"}・${closed ? "休息中" : "營業中"}`}
        onClose={props.onClose}
      />
      <div class="st-side-body">
        {shop.span && shop.span > 1 && BIG_UNLOCK[shop.category] && (
          <div class="st-tip">
            <span>
              🏬 <b>大店解鎖客層</b>：{BIG_UNLOCK[shop.category]!.label}（{Object.keys(BIG_UNLOCK[shop.category]!.demand).map((p) => PERSONA_BY_ID[p as keyof typeof PERSONA_BY_ID]?.name ?? p).join("、")}）
            </span>
          </div>
        )}
        {closed && (
          <div class="st-tip red">
            <span>
              <b>暫停營業中</b>，預計{gameDeadline(shop.closedUntilTick, s.tick)}恢復。
            </span>
          </div>
        )}
        {out && !closed && (
          <div class="st-tip red">
            <span>
              <b>缺貨中</b>：沒有庫存就賣不出去。
            </span>
            <div class="st-row">
              {[50, 200].map((q) => (
                <button key={q} class="st-btn pri" disabled={busy.value || s.funds < uc * q} onClick={() => run({ type: "orderStock", shopId: shop.id, qty: q }, `已訂購 ${q} 份`)}>
                  補 {q} 份（{money(uc * q)}）
                </button>
              ))}
              <button class="st-btn" onClick={() => props.openHub("operate", "supply")}>
                看供應商
              </button>
            </div>
          </div>
        )}
        {stale && (
          <div class="st-tip">
            <span>
              <b>菜單太老氣</b>，客人覺得沒新鮮感（{Math.round(shop.freshness)}）。
            </span>
            <div class="st-row">
              <button class="st-btn" disabled={busy.value || s.funds < refreshCost} onClick={() => confirmThen(`幫「${shop.name}」換新菜單？\n費用 ${money(refreshCost)}，現在就會扣款，新鮮感會回升。`, () => run({ type: "refreshShop", shopId: shop.id }, "推出新菜單！"))}>
                換新菜單（{money(refreshCost)}）
              </button>
              <button
                class="st-btn"
                onClick={() => {
                  workshopFocus.value = shop.id;
                  props.openHub("develop", "workshop");
                }}
              >
                去工坊研發
              </button>
            </div>
          </div>
        )}
        {complaints > 0 && (
          <div class="st-tip">
            <span>
              <b>有 {complaints} 則客人的事</b>等你處理。
            </span>
            <button class="st-btn" onClick={() => props.openHub("guests", "inbox")}>
              去處理
            </button>
          </div>
        )}

        <div class="st-kpis">
          <div class="st-kpi">
            <small>今日營收</small>
            <b>{money(shop.day.revenue)}</b>
          </div>
          <div class="st-kpi">
            <small>接待組數</small>
            <b>{num(shop.day.groups)}</b>
          </div>
          <div class="st-kpi">
            <small>庫存</small>
            <b>{stocked ? num(shop.stock) : "—"}</b>
          </div>
        </div>

        {direct && <Meter value={shop.freshness} label="新鮮感" hint={`${Math.round(shop.freshness)}／100`} />}

        {direct && (
          <div class="st-sec">
            <h4>售價</h4>
            <div class="st-row between">
              <div class="st-stepper">
                <button class="st-btn" aria-label="降價" disabled={price <= PRICE_MIN} onClick={() => setPrice((p) => Math.max(PRICE_MIN, p - step))}>
                  −
                </button>
                <b>{money(price)}</b>
                <button class="st-btn" aria-label="漲價" disabled={price >= PRICE_HARD_MAX} onClick={() => setPrice((p) => Math.min(PRICE_HARD_MAX, p + step))}>
                  ＋
                </button>
              </div>
              <button class="st-btn" disabled={busy.value || gap === 0 || price < PRICE_MIN || price > PRICE_HARD_MAX} onClick={() => run({ type: "setPrice", shopId: shop.id, price }, "價格已更新")}>
                套用
              </button>
            </div>
            <p class="st-hint">
              參考價 {money(cat.refPrice)}              {stocked ? `・進貨 ${money(uc)}／份` : ""}。{gap === 0 ? `價格越高單價賺越多，但客人越少；超過參考價約 ${PRICE_TOLERANCE} 倍後，客人看了價格就會走。` : gap > 0 ? `比現在貴 ${money(gap)}：客人可能變少。` : `比現在便宜 ${money(-gap)}：客人可能變多。`}
            </p>
          </div>
        )}

        <div class="st-cta">
          <button class="st-btn" disabled={busy.value || shop.level >= MAX_SHOP_LEVEL || upgrading || s.funds < upgradeCost} onClick={() => confirmThen(`把「${shop.name}」翻新升級到 Lv.${shop.level + 1}？\n費用 ${money(upgradeCost)}，現在就會扣款；施工${gameDuration(UPGRADE_TICKS)}，店內人事成本也會增加。`, () => run({ type: "upgradeShop", shopId: shop.id }, "開始翻新"))}>
            {shop.level >= MAX_SHOP_LEVEL ? "已達最高等級" : upgrading ? "翻新中…" : `升級到 Lv.${shop.level + 1}（${money(upgradeCost)}）`}
          </button>
          <div class="st-row">
            <button class="st-btn" onClick={() => props.openSheet(shop.id)}>
              補貨規則與更多設定
            </button>
            {canLease && (
              <button class="st-btn" disabled={busy.value} onClick={() => run({ type: "setLease", shopId: shop.id, enabled: shop.mode !== "lease" }, shop.mode === "lease" ? "改回直營" : "已出租")}>
                {shop.mode === "lease" ? "收回自營" : "改為出租"}
              </button>
            )}
            {shop.tenant && !shop.tenant.own && (
              <button class="st-btn" onClick={() => props.openHub("develop", "leasing")}>
                租戶：{shop.tenant.brand}
              </button>
            )}
            {shop.tenant && !shop.tenant.own && (
              <button
                class="st-btn"
                disabled={busy.value}
                onClick={() => {
                  const t = shop.tenant!;
                  const penalty = Math.round(leaseRemainingRent(t.rent, t.endTick, s.tick) * TERMINATE_PENALTY);
                  confirmThen(`提前解約要付違約金 ${money(penalty)}，店面會空出來，確定嗎？`, () => run({ type: "terminateLease", shopId: shop.id }, "已解約"));
                }}
              >
                解約
              </button>
            )}
            {shop.mode === "direct" && (
              <button class="st-btn" disabled={busy.value} onClick={() => confirmThen(`讓「${shop.name}」歇業？\n店面會空出來，庫存與研發進度作廢、不退費。${shop.span && shop.span > 1 ? "\n併進來的格子會還成空地。" : ""}`, () => run({ type: "closeShop", shopId: shop.id }, "已歇業"))}>
                歇業
              </button>
            )}
            {shop.mode === "direct" && openPlanEnabled(s) && (
              <button
                class="st-btn"
                disabled={busy.value}
                onClick={() => {
                  const fee = Math.round(cat.buildCost * spanCostFactor(shop.span) * DEMOLISH_FEE_RATE);
                  const merged = shop.span && shop.span > 1 ? "併進來的格子會還成空地，之後可以重新規劃大小。" : "";
                  confirmThen(
                    ["拆除「" + shop.name + "」？", `拆除費 ${money(fee)}（建造費的 ${Math.round(DEMOLISH_FEE_RATE * 100)}%，裝潢報廢不退款），現在就會扣款。`, merged, "同一層拆完要隔一個遊戲日才能再拆。"].filter(Boolean).join("\n"),
                    () => run({ type: "demolishShop", shopId: shop.id }, "已拆除"),
                  );
                }}
              >
                拆除重建
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
