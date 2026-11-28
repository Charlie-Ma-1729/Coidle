// 研發等待期的中途事件：進度過半時，工坊出狀況（設備、食材、靈感、試味意見），玩家可以處理，也可以不管。
// 不管＝自動採預設選項（不付費；有風險的選項照風險結算）。事件不會暫停時間，也不需要小遊戲；
// 影響只有「這次研發的有效廚藝經驗」±1，所以不是必選、也不改變效果本身的上限。
// 全部是資料，結算在 server/src/sim/workshop.ts，風險用 (研發編號, 選項) 的雜湊決定，重放結果相同。

export interface MidOption {
  id: string;
  label: string;
  /** 白話說明，畫面上顯示 */
  hint: string;
  /** 費用＝這次研發費用的比例（先扣款；資金不足不能選） */
  costPct: number;
  /** 廚藝經驗的調整（必定生效） */
  skill: number;
  /** 另有 risk.p 的機率再調整 risk.skill（用雜湊決定，不抽引擎亂數） */
  risk?: { p: number; skill: number };
}

export interface MidEvent {
  id: string;
  icon: string;
  title: string;
  text: string;
  options: MidOption[];
  /** 逾時或沒處理時採用的選項 */
  defaultOption: string;
}

/** 進度到這個比例時出事件 */
export const MID_AT = 0.5;

export const MID_EVENTS: MidEvent[] = [
  {
    id: "equipment",
    icon: "🔧",
    title: "設備不太對勁",
    text: "工作台的設備發出怪聲，火候與計時開始不穩。",
    defaultOption: "carry_on",
    options: [
      { id: "repair", label: "請人緊急維修", hint: "花研發費的 25%，穩穩做完（廚藝經驗 +1）", costPct: 0.25, skill: 1 },
      { id: "carry_on", label: "硬撐下去", hint: "不花錢，但有 35% 機率手感大亂（廚藝經驗 −1）", costPct: 0, skill: 0, risk: { p: 0.35, skill: -1 } },
    ],
  },
  {
    id: "supplier",
    icon: "📦",
    title: "素材到貨狀況不佳",
    text: "供應商送來的素材有幾個品質參差，不太新鮮。",
    defaultOption: "make_do",
    options: [
      { id: "swap", label: "加價換一批", hint: "花研發費的 30%，品質穩定（廚藝經驗 +1）", costPct: 0.3, skill: 1 },
      { id: "make_do", label: "將就著用", hint: "不花錢，但有 50% 機率成品打折（廚藝經驗 −1）", costPct: 0, skill: 0, risk: { p: 0.5, skill: -1 } },
    ],
  },
  {
    id: "inspiration",
    icon: "💡",
    title: "突然有了靈感",
    text: "做到一半，團隊有人提出一個大膽的新點子。",
    defaultOption: "steady",
    options: [
      { id: "try_it", label: "放手一試", hint: "不花錢，45% 機率神來一筆（廚藝經驗 +1），否則照常", costPct: 0, skill: 0, risk: { p: 0.45, skill: 1 } },
      { id: "steady", label: "照原計畫做", hint: "不花錢，不變", costPct: 0, skill: 0 },
    ],
  },
  {
    id: "feedback",
    icon: "🗣️",
    title: "同事試味道後有意見",
    text: "店裡的同事試了半成品，給了一些中肯的建議。",
    defaultOption: "ignore",
    options: [
      { id: "adopt", label: "採納意見微調", hint: "花研發費的 10%，更貼近客人口味（廚藝經驗 +1）", costPct: 0.1, skill: 1 },
      { id: "ignore", label: "堅持自己的做法", hint: "不花錢，不變", costPct: 0, skill: 0 },
    ],
  },
];

export const MID_BY_ID: Record<string, MidEvent> = Object.fromEntries(MID_EVENTS.map((e) => [e.id, e]));

/** 這次研發抽到哪個事件（只看研發編號與種子，決定性） */
export function midEventFor(hash: number): MidEvent {
  return MID_EVENTS[hash % MID_EVENTS.length]!;
}
