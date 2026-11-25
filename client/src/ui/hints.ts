/**
 * 情境提示：取代舊的「七頁新手導覽」。
 * 依目前狀況一次只提示一則；遇到狀況才講那件事（缺貨、客訴、有空地…），
 * 沒有特別狀況時才依序講基本操作。看過的不再出現，也可以一鍵全部關閉。
 * 純函式＋localStorage，不依賴 DOM 元件，可單元測試。
 */
import { signal } from "@preact/signals";
import type { PublicMallState } from "@coidle/shared";
import type { AttentionItem } from "../stage/model";

export interface Hint {
  id: string;
  title: string;
  text: string;
}

export interface HintCtx {
  s: PublicMallState;
  attention: AttentionItem[];
  /** 目前樓層（已解鎖）有沒有空地可以開店 */
  hasEmptyLot: boolean;
  seen: ReadonlySet<string>;
}

interface HintDef extends Hint {
  when: (c: HintCtx) => boolean;
}

/** 開店最便宜的業態大約的價格，資金低於這個就不用提示「去開店」 */
const CHEAPEST_BUILD = 900_000;

/** 狀況提示：遇到才講，依優先順序 */
const CONTEXT: HintDef[] = [
  {
    id: "h_stockout",
    title: "缺貨了",
    text: "缺貨會讓客人白跑一趟。點那間店，面板裡可以一鍵補貨；也可以設定自動補貨規則。",
    when: (c) => c.attention.some((a) => a.id.startsWith("stockout:")),
  },
  {
    id: "h_complaint",
    title: "有客訴",
    text: "客訴有時限。到「客人 → 客訴與評價」處理；你不在時，會依你設的偏好自動處理。",
    when: (c) => c.s.inbox.some((i) => i.kind === "complaint"),
  },
  {
    id: "h_event",
    title: "有事件等你決定",
    text: "事件有時限，沒回應就套用預設選項。右上角的鈴鐺會列出所有需要你決定的事。",
    when: (c) => c.s.pending.length > 0,
  },
  {
    id: "h_inspection",
    title: "稽查預告",
    text: "衛生或消防單位快來了。到「營運 → 設備與稽查」看現在的分數，並選擇要不要備戰。",
    when: (c) => c.s.inspections.pending.length > 0,
  },
  {
    id: "h_build",
    title: "有空地可以開店",
    text: "點場景裡的「空地」就能選業種開新店。業態越多元整體客流越大，同一種開太多則會互相搶客。",
    when: (c) => c.hasEmptyLot && c.s.funds >= CHEAPEST_BUILD && c.s.shops.length < 8,
  },
  {
    id: "h_report",
    title: "第一份日報出爐了",
    text: "每個遊戲日結束都會出一份日報，告訴你賺了多少、哪裡出問題。看「財務 → 日報」。",
    when: (c) => c.s.reports.length > 0,
  },
];

/** 基本操作：沒有特別狀況時依序講 */
const INTRO: HintDef[] = [
  {
    id: "h_tap_shop",
    title: "點店面開始經營",
    text: "點場景裡的店面，就能調價格、補貨、升級。拖曳可以平移，滾輪或雙指可以縮放。",
    when: () => true,
  },
  {
    id: "h_dock",
    title: "底部是管理選單",
    text: "營運、客人、開發、財務…每個領域一個視窗。數字旁的紅點代表那裡有事等你；還沒用到的功能會在需要時才出現。",
    when: () => true,
  },
  {
    id: "h_bell",
    title: "待辦都在鈴鐺裡",
    text: "右上角的鈴鐺把所有需要你處理的事排好了優先順序，點一下就會帶你到該去的地方。",
    when: () => true,
  },
  {
    id: "h_time",
    title: "不用一直盯著",
    text: "你不在線時商場照常營業，回來看日報、做幾個決定就好。沒空顧的時候，可以按 ⏸ 暫停時間，什麼都不會流失。",
    when: () => true,
  },
];

export const HINTS: Hint[] = [...CONTEXT, ...INTRO].map(({ id, title, text }) => ({ id, title, text }));

/** 關掉全部提示用的特殊標記 */
export const OFF = "*off";

/** 現在該顯示哪一則提示；沒有（或已全部關閉）回傳 null */
export function pickHint(c: HintCtx): Hint | null {
  if (c.seen.has(OFF)) return null;
  for (const h of [...CONTEXT, ...INTRO]) {
    if (!c.seen.has(h.id) && h.when(c)) return { id: h.id, title: h.title, text: h.text };
  }
  return null;
}

// ───────── 儲存 ─────────

const key = (userId: number | undefined, mallId: number | null) => `coidle.hints.${userId ?? 0}.${mallId ?? 0}`;

export function loadSeen(userId: number | undefined, mallId: number | null): Set<string> {
  try {
    const raw = localStorage.getItem(key(userId, mallId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function save(userId: number | undefined, mallId: number | null, seen: Set<string>): void {
  try {
    localStorage.setItem(key(userId, mallId), JSON.stringify([...seen]));
  } catch {
    // 無痕模式等情況：下次再提示一次也無妨
  }
  hintsVersion.value++;
}

/** 提示狀態有變時遞增，讓畫面重新讀取 */
export const hintsVersion = signal(0);

export function markSeen(userId: number | undefined, mallId: number | null, id: string): void {
  const seen = loadSeen(userId, mallId);
  seen.add(id);
  save(userId, mallId, seen);
}

export function disableHints(userId: number | undefined, mallId: number | null): void {
  markSeen(userId, mallId, OFF);
}

/** 「重看新手提示」：清掉所有已看過與關閉的標記 */
export function resetHints(userId: number | undefined, mallId: number | null): void {
  try {
    localStorage.removeItem(key(userId, mallId));
  } catch {
    // ignore
  }
  hintsVersion.value++;
}
