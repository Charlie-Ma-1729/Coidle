/**
 * 漸進揭露：沒用到的功能先不出現，第一次相關時才出現。
 * 只決定「顯示時機」，不改任何遊戲規則；已有資料的功能一律顯示，避免老玩家找不到。
 * 「全部功能」索引會把沒顯示的也列出來，並說明何時開放。
 * 純函式、不依賴 DOM，可單元測試。
 */
import { leaseEnabled, LEASE_MIN_LEVEL, type PublicMallState } from "@coidle/shared";
import type { HubId } from "../stage/model";

export const TECH_MIN_LEVEL = 2;
export const WORLD_MIN_LEVEL = 2;

export interface FeatureDef {
  /** 唯一 id：`hub` 或 `hub.tab` */
  id: string;
  hub: HubId;
  /** 樞紐內的分頁 id；樞紐本身為 null */
  tab: string | null;
  label: string;
  /** 還沒開放時，告訴玩家怎麼解鎖 */
  unlockHint: string;
  /** 目前是否顯示 */
  visible: (s: PublicMallState) => boolean;
}

const always = (): boolean => true;

export const FEATURES: FeatureDef[] = [
  // 營運
  { id: "operate", hub: "operate", tab: null, label: "營運", unlockHint: "", visible: always },
  { id: "operate.hours", hub: "operate", tab: "hours", label: "營業時間", unlockHint: "", visible: always },
  { id: "operate.supply", hub: "operate", tab: "supply", label: "補貨與供應", unlockHint: "", visible: always },
  { id: "operate.promo", hub: "operate", tab: "promo", label: "行銷", unlockHint: "", visible: always },
  { id: "operate.facility", hub: "operate", tab: "facility", label: "設備與稽查", unlockHint: "", visible: always },
  // 客人
  { id: "guests", hub: "guests", tab: null, label: "客人", unlockHint: "", visible: always },
  { id: "guests.inbox", hub: "guests", tab: "inbox", label: "客訴與評價", unlockHint: "", visible: always },
  { id: "guests.regulars", hub: "guests", tab: "regulars", label: "常客", unlockHint: "第一位常客上門之後出現", visible: (s) => s.regulars.some((r) => r.met) },
  { id: "guests.walk", hub: "guests", tab: "walk", label: "巡場", unlockHint: "", visible: always },
  // 開發
  { id: "develop", hub: "develop", tab: null, label: "開發", unlockHint: "", visible: always },
  { id: "develop.workshop", hub: "develop", tab: "workshop", label: "研發工坊", unlockHint: "", visible: always },
  {
    id: "develop.tech",
    hub: "develop",
    tab: "tech",
    label: "科技",
    unlockHint: `商場 Lv.${TECH_MIN_LEVEL} 開放`,
    visible: (s) => s.level >= TECH_MIN_LEVEL || s.tech.jobs.length > 0 || s.tech.done.length > 0,
  },
  {
    id: "develop.leasing",
    hub: "develop",
    tab: "leasing",
    label: "招商",
    unlockHint: `商場 Lv.${LEASE_MIN_LEVEL} 開放`,
    visible: (s) => leaseEnabled(s) || s.leasing.candidates.length > 0 || s.leasing.renewals.length > 0 || s.shops.some((x) => x.tenant && !x.tenant.own),
  },
  // 財務
  { id: "finance", hub: "finance", tab: null, label: "財務", unlockHint: "", visible: always },
  { id: "finance.cash", hub: "finance", tab: "cash", label: "資金與損益", unlockHint: "", visible: always },
  { id: "finance.reports", hub: "finance", tab: "reports", label: "日報", unlockHint: "第一份日報出爐後出現（遊戲內隔天凌晨）", visible: (s) => s.reports.length > 0 },
  {
    id: "finance.tax",
    hub: "finance",
    tab: "tax",
    label: "稅務與帳單",
    unlockHint: "出現第一張帳單後出現",
    visible: (s) => s.tax.bills.length > 0 || s.tax.history.length > 0,
  },
  // 世界
  {
    id: "world",
    hub: "world",
    tab: null,
    label: "世界",
    unlockHint: `商場 Lv.${WORLD_MIN_LEVEL} 開放`,
    visible: (s) => s.level >= WORLD_MIN_LEVEL || s.world.alliances.length > 0 || s.world.seasons.length > 0,
  },
  { id: "world.dir", hub: "world", tab: "dir", label: "名錄與榜單", unlockHint: "", visible: always },
  { id: "world.rivals", hub: "world", tab: "rivals", label: "商戰", unlockHint: "", visible: (s) => s.rivals.list.length > 0 },
  { id: "world.team", hub: "world", tab: "team", label: "團隊", unlockHint: "", visible: always },
];

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

/** 這個樞紐現在要不要顯示在 dock */
export function hubVisible(s: PublicMallState, hub: HubId): boolean {
  return BY_ID.get(hub)!.visible(s);
}

/** 某個樞紐目前要顯示的分頁 id（依定義順序）；樞紐不可見時回傳空陣列 */
export function visibleTabs(s: PublicMallState, hub: HubId): string[] {
  if (!hubVisible(s, hub)) return [];
  return FEATURES.filter((f) => f.hub === hub && f.tab !== null && f.visible(s)).map((f) => f.tab!);
}

export interface IndexEntry {
  id: string;
  hub: HubId;
  tab: string | null;
  label: string;
  hubLabel: string;
  visible: boolean;
  /** 沒顯示時的解鎖說明 */
  hint: string;
}

/** 「全部功能」索引：顯示的與還沒開放的都列出來 */
export function featureIndex(s: PublicMallState): IndexEntry[] {
  return FEATURES.filter((f) => f.tab !== null).map((f) => {
    const hubDef = BY_ID.get(f.hub)!;
    const hubShown = hubDef.visible(s);
    const visible = hubShown && f.visible(s);
    // 樞紐本身沒開放時，說明以樞紐為準
    const hint = visible ? "" : hubShown ? f.unlockHint : hubDef.unlockHint;
    return { id: f.id, hub: f.hub, tab: f.tab, label: f.label, hubLabel: hubDef.label, visible, hint };
  });
}

/** 把待辦項目要開的分頁收斂到「目前可見」的分頁；找不到就退回該樞紐第一個可見分頁 */
export function resolveTab(s: PublicMallState, hub: HubId, wanted?: string): string | null {
  const tabs = visibleTabs(s, hub);
  if (tabs.length === 0) return null;
  return wanted && tabs.includes(wanted) ? wanted : tabs[0]!;
}
