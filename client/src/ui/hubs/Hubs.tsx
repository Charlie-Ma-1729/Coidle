import { useState } from "preact/hooks";
import { hourWeight } from "../../stage/crowd";
import type { HubId, StageModel } from "../../stage/model";
import { HUBS } from "../Dock";
import { Window, type WinTab } from "../Window";

export type { HubId };

/** 樞紐 → 分頁 → 對應的現有畫面（正式版會把這些畫面依新分組重新切分、收合） */
const HUB_PLAN: Record<Exclude<HubId, "operate">, { title: string; tabs: { tab: WinTab; from: string[]; note: string }[] }> = {
  guests: {
    title: "客人",
    tabs: [
      { tab: { id: "inbox", label: "客訴與評價" }, from: ["客人（Guests）：客訴、評價、客人事件", "處理偏好（離線時自動處理）"], note: "待辦中心的「決定」類項目也會出現在這裡。" },
      { tab: { id: "regulars", label: "常客" }, from: ["常客（Regulars）：好感度、故事、預約座位"], note: "常客會以有名字的 NPC 在場景裡走動，點他就開這頁。" },
      { tab: { id: "walk", label: "巡場" }, from: ["巡場（walk）：聽客人的聲音"], note: "改成玩家頭像在走道上走動，走到店面觸發。" },
    ],
  },
  develop: {
    title: "開發",
    tabs: [
      { tab: { id: "workshop", label: "研發工坊" }, from: ["工坊（Workshop）：素材、配方、試吃、線索"], note: "試吃待決會顯示在待辦中心與工坊入口的徽章。" },
      { tab: { id: "tech", label: "科技" }, from: ["科技（Tech）：12 項科技"], note: "第一次可研發時才顯示。" },
      { tab: { id: "leasing", label: "招商", badge: 2 }, from: ["招商（Leasing）：候選品牌、還價、續約"], note: "目前有 2 個品牌想進駐（示範）。" },
    ],
  },
  finance: {
    title: "財務",
    tabs: [
      { tab: { id: "cash", label: "資金與損益" }, from: ["總覽（Overview）的 KPI：資金、今日損益、累計營收、等級進度"], note: "HUD 只留最重要的兩個數字，詳細在這裡。" },
      { tab: { id: "reports", label: "日報" }, from: ["日報（Reports）：每日快訊與歷史"], note: "每日結算時彈出一次，不再常駐在首頁。" },
      { tab: { id: "tax", label: "稅務與帳單" }, from: ["稅務（Tax）：消費稅、法人稅、保險、逾期"], note: "第一張帳單出現後才顯示。" },
    ],
  },
  world: {
    title: "世界",
    tabs: [
      { tab: { id: "dir", label: "名錄與榜單" }, from: ["名錄（World）：目錄、榜單、季賽、信箱、聯盟、交易、競爭"], note: "目前 355 行的單頁，會依功能再切分。" },
      { tab: { id: "rivals", label: "商戰" }, from: ["商戰（Rivals）：NPC 與玩家商場的促銷戰"], note: "" },
      { tab: { id: "team", label: "團隊" }, from: ["團隊（Team）：成員、7 種角色、邀請碼", "團隊事件認領"], note: "團隊事件也會出現在待辦中心。" },
    ],
  },
};

function StubWindow(props: { hub: Exclude<HubId, "operate">; onClose: () => void }) {
  const plan = HUB_PLAN[props.hub];
  const meta = HUBS.find((h) => h.id === props.hub)!;
  const [tab, setTab] = useState(plan.tabs[0]!.tab.id);
  const cur = plan.tabs.find((t) => t.tab.id === tab)!;
  return (
    <Window title={plan.title} icon={meta.glyph} tabs={plan.tabs.map((t) => t.tab)} tab={tab} onTab={setTab} onClose={props.onClose}>
      <div class="st-sec">
        <h4>這一頁會收納的現有功能</h4>
        <div class="st-list">
          {cur.from.map((f) => (
            <div class="st-li" key={f}>
              <span>✅</span>
              <span class="grow">{f}</span>
            </div>
          ))}
        </div>
        {cur.note && <p class="st-hint">{cur.note}</p>}
        <p class="st-hint">示範版只有營運樞紐是完整示範；真實內容請開 #stage。</p>
      </div>
    </Window>
  );
}

/** 營運樞紐（Phase 0 的完整示範）：營業時間／補貨與供應／行銷／設備與稽查 */
function Operate(props: { model: StageModel; act: (m: string) => void }) {
  const { model } = props;
  const [tab, setTab] = useState("hours");
  const [open, setOpen] = useState(model.openHour);
  const [close, setClose] = useState(model.closeHour);
  const [clean, setClean] = useState(1);
  const [maint, setMaint] = useState(1);

  const tabs: WinTab[] = [
    { id: "hours", label: "營業時間" },
    { id: "supply", label: "補貨與供應", badge: 1 },
    { id: "promo", label: "行銷" },
    { id: "facility", label: "設備與稽查" },
  ];

  const weights = Array.from({ length: 24 }, (_, h) => hourWeight(h * 60 + 30));
  const mx = Math.max(...weights);
  const total = weights.reduce((a, b) => a + b, 0);
  const captured = weights.reduce((a, v, h) => (h >= open && h < close ? a + v : a), 0);
  const nowH = Math.floor(model.minuteOfDay / 60);

  return (
    <Window
      title="營運"
      icon="store"
      summary={[
        { label: "營業", value: `${open}:00–${close}:00` },
        { label: "清潔", value: ["不做", "標準", "加強"][clean]! },
        { label: "設備", value: `${model.equipment}%` },
      ]}
      tabs={tabs}
      tab={tab}
      onTab={setTab}
      onClose={() => props.act("__close__")}
    >
      {tab === "hours" && (
        <>
          <div class="st-sec">
            <h4>24 小時客流（平日）・涵蓋約 {Math.round((captured / total) * 100)}%</h4>
            <div class="st-hours" aria-label="24 小時客流">
              {weights.map((v, h) => (
                <i key={h} class={h === nowH ? "now" : h >= open && h < close ? "in" : ""} style={{ height: `${(v / mx) * 100}%` }} title={`${h}:00`} />
              ))}
            </div>
            <div class="st-hour-labels">
              <span>0</span>
              <span>6</span>
              <span>12</span>
              <span>18</span>
              <span>24</span>
            </div>
          </div>
          <div class="st-sec">
            <div class="st-slider">
              <label>
                <span>開店</span>
                <b>{open}:00</b>
              </label>
              <input type="range" min={6} max={14} value={open} onInput={(e) => setOpen(Number((e.target as HTMLInputElement).value))} />
            </div>
            <div class="st-slider">
              <label>
                <span>打烊</span>
                <b>{close}:00</b>
              </label>
              <input type="range" min={16} max={28 - 1} value={close} onInput={(e) => setClose(Number((e.target as HTMLInputElement).value))} />
            </div>
            <p class="st-hint">營業越久涵蓋越多客流，但<b>人事費</b>與水電也會增加。調整後場景的日夜與人潮會立刻跟著變。</p>
            <div class="st-row">
              <button class="st-btn pri" onClick={() => props.act(`（示範）營業時間改為 ${open}:00–${close}:00`)}>
                套用
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "supply" && (
        <div class="st-sec">
          <h4>供應商（依貨品家族）</h4>
          <div class="st-list">
            {[
              { n: "🍜 食材", s: "北濱食品", rel: 72, st: "出貨吃緊", warn: true },
              { n: "☕ 飲品", s: "港灣咖啡商", rel: 64, st: "正常", warn: false },
              { n: "🧴 日用品", s: "梅田雜貨批發", rel: 55, st: "正常", warn: false },
              { n: "👕 服飾", s: "堺織物", rel: 48, st: "正常", warn: false },
            ].map((f) => (
              <div class="st-li" key={f.n}>
                <span class="grow">
                  <b>{f.n}</b>・{f.s}
                  <small>關係 {f.rel}／100</small>
                </span>
                <span class="st-pill" style={f.warn ? { borderColor: "var(--amber)", color: "var(--amber)" } : {}}>
                  {f.st}
                </span>
              </div>
            ))}
          </div>
          <p class="st-hint">單店的補貨規則在「店面面板」裡；這裡只管供應商關係與切換。</p>
        </div>
      )}

      {tab === "promo" && (
        <div class="st-sec">
          <h4>促銷活動</h4>
          <div class="st-list">
            {[
              { n: "📣 全館折扣週", d: "客流 +18%，持續 3 天；疲勞度 20%" },
              { n: "🎆 夜市祭", d: "觀光熱度 +6，持續 1 天；疲勞度 55%" },
              { n: "🎁 集點加倍", d: "常客好感 +2；疲勞度 0%" },
            ].map((p) => (
              <div class="st-li" key={p.n}>
                <span class="grow">
                  <b>{p.n}</b>
                  <small>{p.d}</small>
                </span>
                <button class="st-btn" onClick={() => props.act(`（示範）啟動「${p.n.slice(2)}」`)}>
                  啟動
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "facility" && (
        <>
          <div class="st-sec">
            <div class="st-row between">
              <span>🧹 清潔等級</span>
              <div class="st-lvl">
                {["不做", "標準", "加強"].map((l, i) => (
                  <button key={l} class={clean === i ? "on" : ""} onClick={() => setClean(i)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div class="st-meter">
              <i style={{ width: `${model.cleanliness}%` }} />
            </div>
            <div class="st-row between">
              <span>🔧 維護等級</span>
              <div class="st-lvl">
                {["不做", "標準", "加強"].map((l, i) => (
                  <button key={l} class={maint === i ? "on" : ""} onClick={() => setMaint(i)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div class="st-meter">
              <i class={model.equipment < 50 ? "amber" : ""} style={{ width: `${model.equipment}%` }} />
            </div>
            <p class="st-hint">設備 {model.equipment}%：偏低，小心故障（場景裡會看到「小熊玩具」停業）。</p>
          </div>
          <div class="st-sec">
            <h4>稽查</h4>
            <div class="st-li">
              <span class="grow">
                <b>衛生稽查預告</b>・3 天後
                <small>準備度 62%。做「加強清潔」可以提高。</small>
              </span>
              <button class="st-btn" onClick={() => props.act("（示範）已安排加強準備")}>
                準備
              </button>
            </div>
          </div>
        </>
      )}
    </Window>
  );
}

export function HubWindow(props: { hub: HubId; model: StageModel; onClose: () => void; act: (m: string) => void }) {
  if (props.hub === "operate") {
    return <Operate model={props.model} act={(m) => (m === "__close__" ? props.onClose() : props.act(m))} />;
  }
  return <StubWindow key={props.hub} hub={props.hub} onClose={props.onClose} />;
}
