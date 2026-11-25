import { useEffect, useState } from "preact/hooks";
import type { StageShop } from "../stage/model";
import { money, num } from "../format";

const BUILD_OPTIONS = [
  { id: "cafe", name: "咖啡館", cost: 480_000, hours: 2 },
  { id: "ramen", name: "拉麵店", cost: 560_000, hours: 3 },
  { id: "book", name: "書店", cost: 390_000, hours: 2 },
  { id: "cloth", name: "服飾店", cost: 720_000, hours: 4 },
  { id: "arcade", name: "遊戲中心", cost: 900_000, hours: 5 },
  { id: "tea", name: "茶舖", cost: 320_000, hours: 1.5 },
];

function Bar(props: { value: number; label: string; hint: string }) {
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

/**
 * 店面面板：單店的所有操作都在這裡（價格、補貨、菜單、升級、直營/出租）。
 * 缺貨 → 就地補貨；沒新鮮感 → 直通工坊。不必再跑到別的頁面找。
 */
export function ShopPanel(props: { shop: StageShop | null; floorName: string; onClose: () => void; act: (msg: string) => void; openHub: (h: "develop" | "operate") => void }) {
  const { shop } = props;
  const [price, setPrice] = useState(shop?.price ?? 0);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    setPrice(shop?.price ?? 0);
    setPick(null);
  }, [shop?.id]);

  if (!shop || shop.state === "empty") {
    const opt = BUILD_OPTIONS.find((o) => o.id === pick);
    return (
      <aside class="st-side st-panel" aria-label="空地">
        <div class="st-side-head">
          <div class="st-sign" style={{ background: "#3a3a5a" }} />
          <div>
            <h2>空地</h2>
            <small>{props.floorName}・可以在這裡開店</small>
          </div>
          <button class="st-btn sq st-x" onClick={props.onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        <div class="st-side-body">
          <div class="st-sec">
            <h4>選擇業種</h4>
            <div class="st-chips">
              {BUILD_OPTIONS.map((o) => (
                <button key={o.id} class={`st-cat ${pick === o.id ? "on" : ""}`} onClick={() => setPick(o.id)}>
                  <b>{o.name}</b>
                  <small>
                    {money(o.cost)}・施工約 {o.hours} 小時
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div class="st-cta">
            <button class="st-btn pri" disabled={!opt} onClick={() => opt && props.act(`（示範）已下單蓋「${opt.name}」，施工 ${opt.hours} 小時`)}>
              {opt ? `開店：${opt.name}（${money(opt.cost)}）` : "先選一種業種"}
            </button>
          </div>
          <p class="st-hint">施工中這格會出現鷹架與進度條；完工時商場會通知你。業種清單與價格在正式版會照目前的區域與商場等級過濾。</p>
        </div>
      </aside>
    );
  }

  if (shop.state === "building") {
    return (
      <aside class="st-side st-panel" aria-label="施工中">
        <div class="st-side-head">
          <div class="st-sign" style={{ background: `#${shop.color.toString(16).padStart(6, "0")}` }} />
          <div>
            <h2>{shop.name}</h2>
            <small>{shop.category}・施工中</small>
          </div>
          <button class="st-btn sq st-x" onClick={props.onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        <div class="st-side-body">
          <Bar value={(shop.progress ?? 0) * 100} label="施工進度" hint={`${Math.round((shop.progress ?? 0) * 100)}%`} />
          <p class="st-hint">預計約 1 小時 20 分後完工。施工期間不會有客人，也不需要你做任何事。</p>
        </div>
      </aside>
    );
  }

  const gap = price - shop.price;
  return (
    <aside class="st-side st-panel" aria-label={`${shop.name} 店面面板`}>
      <div class="st-side-head">
        <div class="st-sign" style={{ background: `#${shop.color.toString(16).padStart(6, "0")}` }} />
        <div>
          <h2>{shop.name}</h2>
          <small>
            {shop.category}・Lv.{shop.level}・{shop.mode === "direct" ? "直營" : "出租"}・{shop.state === "closed" ? "暫停營業" : "營業中"}
          </small>
        </div>
        <button class="st-btn sq st-x" onClick={props.onClose} aria-label="關閉">
          ✕
        </button>
      </div>
      <div class="st-side-body">
        {shop.flags.includes("broken") && (
          <div class="st-tip red">
            <span>
              🔧 <b>設備故障，暫停營業中。</b>叫修需要約 2 小時，費用 ¥18,000。
            </span>
            <button class="st-btn pri" onClick={() => props.act("（示範）已叫修")}>
              立即叫修
            </button>
          </div>
        )}
        {shop.flags.includes("stockout") && (
          <div class="st-tip red">
            <span>
              📦 <b>快缺貨了</b>（剩 {shop.stock} 份）。供應商今天出貨吃緊，補貨會慢約 1 小時。
            </span>
            <div class="st-row">
              <button class="st-btn pri" onClick={() => props.act("（示範）已補貨到目標量")}>
                補貨到 60 份
              </button>
              <button class="st-btn" onClick={() => props.openHub("operate")}>
                看供應商
              </button>
            </div>
          </div>
        )}
        {shop.flags.includes("stale") && (
          <div class="st-tip">
            <span>
              🍃 <b>菜單太老氣</b>，客人覺得沒新鮮感（{Math.round(shop.freshness)}）。
            </span>
            <button class="st-btn" onClick={() => props.openHub("develop")}>
              去工坊研發新品
            </button>
          </div>
        )}
        {shop.flags.includes("complaint") && (
          <div class="st-tip">
            <span>
              😠 <b>有一則客訴</b>：排隊太久。
            </span>
            <button class="st-btn" onClick={() => props.act("（示範）已開啟客訴處理")}>
              處理客訴
            </button>
          </div>
        )}

        <div class="st-kpis">
          <div class="st-kpi">
            <small>今日營收</small>
            <b>{money(shop.todayRevenue)}</b>
          </div>
          <div class="st-kpi">
            <small>客人組數</small>
            <b>{num(shop.todayGroups)}</b>
          </div>
          <div class="st-kpi">
            <small>庫存</small>
            <b>{num(shop.stock)}</b>
          </div>
        </div>

        <Bar value={shop.freshness} label="新鮮感" hint={`${Math.round(shop.freshness)}／100`} />

        <div class="st-sec">
          <h4>售價</h4>
          <div class="st-row between">
            <div class="st-stepper">
              <button class="st-btn" onClick={() => setPrice((p) => Math.max(100, p - 20))}>
                −
              </button>
              <b>{money(price)}</b>
              <button class="st-btn" onClick={() => setPrice((p) => p + 20)}>
                ＋
              </button>
            </div>
            <button class="st-btn" disabled={gap === 0} onClick={() => props.act(`（示範）售價改為 ${money(price)}`)}>
              套用
            </button>
          </div>
          <p class="st-hint">
            {gap === 0 ? "目前售價。價格越高，單價賺越多但客人越少。" : gap > 0 ? `比現在貴 ${money(gap)}：客人可能變少。` : `比現在便宜 ${money(-gap)}：客人可能變多。`}
          </p>
        </div>

        <div class="st-cta">
          <button class="st-btn" onClick={() => props.act(`（示範）「${shop.name}」升級到 Lv.${shop.level + 1}`)}>
            ⬆ 升級到 Lv.{shop.level + 1}（¥260,000）
          </button>
          <div class="st-row">
            <button class="st-btn" onClick={() => props.act("（示範）已更新補貨規則")}>
              🔁 補貨規則
            </button>
            <button class="st-btn" onClick={() => props.openHub("develop")}>
              🧪 菜單／工坊
            </button>
            <button class="st-btn" onClick={() => props.act("（示範）已切換為出租模式")}>
              🏷 {shop.mode === "direct" ? "改為出租" : "改為直營"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
