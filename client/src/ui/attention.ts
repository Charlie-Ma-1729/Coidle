/**
 * 待辦中心：把「需要玩家處理的事」從 PublicMallState 彙整成單一清單。
 * 取代過去散在總覽（警告、6 種提醒卡）、客人、目標、招商各處的提示。
 * 純函式、不依賴 DOM，可直接單元測試。
 */
import {
  CATEGORY_BY_ID,
  EVENT_BY_ID,
  FAMILY_ORDER,
  INSPECTIONS,
  STARTER_QUESTS,
  SUPPLY_FAMILIES,
  TICKS_PER_DAY,
  TEAM_EVENT_BY_ID,
  billsDueWithin,
  chosenSupplier,
  familyShopCount,
  leaseEnabled,
  ticksToRealMinutes,
  type PublicMallState,
} from "@coidle/shared";
import { money } from "../format";
import type { AttentionItem, HubId, Severity } from "../stage/model";

const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, decision: 1, opportunity: 2, info: 3 };

/** 逐項列出的客人事件上限；超過的併成一項，避免清單被洗版 */
const MAX_INBOX_ITEMS = 4;

/** 同時暫停營業的店達到這個數量，就在待辦中心合併成一項 */
export const CLOSED_MERGE_AT = 3;

function within(s: PublicMallState, tick: number): string {
  const mins = Math.max(0, Math.round(ticksToRealMinutes(tick - s.tick, s.clock.speed, s.clock.lag)));
  return mins >= 60 ? `${Math.round(mins / 6) / 10} 小時` : `${mins} 分鐘`;
}

const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n)}…` : t);

/** 待回覆的聯名邀請（來自 /world/alliances；不在遊戲狀態裡，所以由畫面另外傳入） */
export interface PendingInvite {
  id: number;
  partnerName: string;
  /** 邀請失效的真實時間（毫秒） */
  until: number;
}

/** 這則跨商場通知在待辦中心保留多久（遊戲日） */
const NOTICE_DAYS = 2;
const MAX_NOTICE_ITEMS = 3;

export function buildAttention(s: PublicMallState, userId?: string | number | null, invites: PendingInvite[] = [], nowMs: number = Date.now()): AttentionItem[] {
  const out: AttentionItem[] = [];
  const add = (it: AttentionItem) => out.push(it);

  // ───── 緊急 ─────
  if (s.funds < 0) {
    add({ id: "funds-negative", severity: "urgent", icon: "coin", title: "帳上資金為負", detail: "自動補貨已暫停。先想辦法回血。", cta: "看財務", target: { kind: "hub", hub: "finance", tab: "cash" } });
  }
  const overdue = s.tax.bills.filter((b) => b.dueTick < s.tick);
  if (overdue.length > 0) {
    add({ id: "bills-overdue", severity: "urgent", icon: "coin", title: `有 ${overdue.length} 筆稅金／保險費逾期`, detail: "每天會加收延滯稅。", cta: "去繳", target: { kind: "hub", hub: "finance", tab: "tax" } });
  }

  // 稽查停業、停電這類事件常常一次讓好幾間店停下來：3 間以上就合併成一項（場景裡每間店仍會各自標示）
  const closedShops = s.shops.filter((x) => x.closedUntilTick > s.tick);
  const mergeClosed = closedShops.length >= CLOSED_MERGE_AT;
  if (mergeClosed) {
    const latest = Math.max(...closedShops.map((x) => x.closedUntilTick));
    add({ id: "closed:many", severity: "urgent", icon: "wrench", title: `${closedShops.length} 間店暫停營業中`, detail: `最晚約 ${within(s, latest)}後恢復。`, cta: "看看", target: { kind: "hub", hub: "operate", tab: "facility" } });
  }
  for (const sh of s.shops) {
    if (sh.closedUntilTick > s.tick) {
      if (!mergeClosed) add({ id: `closed:${sh.id}`, severity: "urgent", icon: "wrench", title: `「${sh.name}」暫停營業中`, detail: `預計 ${within(s, sh.closedUntilTick)}後恢復。`, cta: "看看", target: { kind: "shop", shopId: sh.id } });
    } else if (sh.mode === "direct" && sh.stock < 1 && ["food", "retail"].includes(CATEGORY_BY_ID[sh.category]?.group ?? "")) {
      add({ id: `stockout:${sh.id}`, severity: "urgent", icon: "box", title: `「${sh.name}」缺貨中`, detail: "沒有庫存就賣不出去。", cta: "補貨", target: { kind: "shop", shopId: sh.id } });
    }
  }

  for (const fam of FAMILY_ORDER) {
    if (familyShopCount(s, fam) === 0) continue;
    const c = chosenSupplier(s, fam);
    if (c && c.st.status !== "ok" && c.st.statusUntil > s.tick) {
      const label = { shortage: "出貨吃緊", strike: "罷工中", closed: "已倒閉", cold: "和你鬧翻了" }[c.st.status];
      add({
        id: `supplier:${fam}`,
        severity: c.st.status === "shortage" ? "decision" : "urgent",
        icon: "box",
        title: `${SUPPLY_FAMILIES[fam].icon}「${c.def.name}」${label}`,
        detail: `${SUPPLY_FAMILIES[fam].name}的主力供應商。`,
        cta: "看供應商",
        target: { kind: "hub", hub: "operate", tab: "supply" },
      });
    }
  }

  // ───── 需要你決定 ─────
  for (const n of s.inspections.pending) {
    if (s.clock.holds.events.includes(n.uid)) continue; // 已因此暫停的稽查，頂部橫幅有顯示
    const def = INSPECTIONS[n.kind];
    add({ id: `inspection:${n.uid}`, severity: "decision", icon: "event", title: `${def.authority}預告：${def.name}`, detail: `約 ${within(s, n.inspectTick)}後到訪。${n.prep === null ? "還沒備戰。" : "已備戰。"}`, cta: n.prep === null ? "備戰" : "看看", target: { kind: "inspection", uid: n.uid } });
  }

  for (const p of s.pending) {
    const def = EVENT_BY_ID[p.defId];
    if (!def?.choice) continue;
    const dflt = def.choice.options.find((o) => o.id === def.choice!.defaultOption)?.label;
    add({
      id: `event:${p.uid}`,
      severity: "decision",
      icon: def.category === "guest" ? "face" : "event",
      title: def.title,
      detail: `${within(s, p.deadlineTick)}內回覆；沒回應就會「${dflt ?? "套用預設"}」。`,
      cta: "決定",
      target: { kind: "event", uid: p.uid },
    });
  }

  const inbox = [...s.inbox].sort((a, b) => a.deadlineTick - b.deadlineTick);
  inbox.slice(0, MAX_INBOX_ITEMS).forEach((it) => {
    const shop = it.shopId ? s.shops.find((x) => x.id === it.shopId) : undefined;
    const complaint = it.kind === "complaint";
    add({
      id: `inbox:${it.uid}`,
      severity: complaint ? "decision" : "opportunity",
      icon: "face",
      title: `${complaint ? "客訴" : "評價"}${shop ? `：${shop.name}` : ""}`,
      detail: clip(it.text, 36),
      cta: complaint ? "處理" : "回覆",
      target: shop ? { kind: "shop", shopId: shop.id } : { kind: "hub", hub: "guests", tab: "inbox" },
    });
  });
  if (inbox.length > MAX_INBOX_ITEMS) {
    add({ id: "inbox:more", severity: "decision", icon: "face", title: `還有 ${inbox.length - MAX_INBOX_ITEMS} 件客人的事等你`, detail: "客訴與評價。", cta: "去看看", target: { kind: "hub", hub: "guests", tab: "inbox" } });
  }

  const due30 = billsDueWithin(s, 30 * 288);
  if (overdue.length === 0 && due30 > 0 && s.funds < due30) {
    add({ id: "bills-soon", severity: "decision", icon: "coin", title: `30 天內要繳 ${money(due30)}`, detail: `但帳上只有 ${money(s.funds)}。`, cta: "看帳單", target: { kind: "hub", hub: "finance", tab: "tax" } });
  }
  if (s.cleanliness < 40) add({ id: "dirty", severity: "decision", icon: "wrench", title: "館內太髒了", detail: "提高清潔等級吧。", cta: "調整", target: { kind: "hub", hub: "operate", tab: "facility" } });
  if (s.equipment < 40) add({ id: "worn", severity: "decision", icon: "wrench", title: "設備老舊，小心故障", detail: "提高維護等級。", cta: "調整", target: { kind: "hub", hub: "operate", tab: "facility" } });
  for (const sh of s.shops) {
    if (sh.mode === "direct" && sh.freshness < 40 && sh.closedUntilTick <= s.tick) {
      add({ id: `stale:${sh.id}`, severity: "decision", icon: "event", title: `「${sh.name}」菜單太老氣`, detail: "客人覺得沒新鮮感，去工坊研發新作品。", cta: "看看", target: { kind: "shop", shopId: sh.id } });
    }
  }
  if (s.leasing.renewals.length > 0) {
    add({ id: "renewals", severity: "decision", icon: "lease", title: `有 ${s.leasing.renewals.length} 份租約到期等你決定`, detail: "沒處理的話，滿意度夠高的租戶會自動續約。", cta: "去看看", target: { kind: "hub", hub: "develop", tab: "leasing" } });
  }
  if (s.workshop.tastings.length > 0) {
    add({ id: "tastings", severity: "decision", icon: "event", title: `有 ${s.workshop.tastings.length} 道試做結果等你決定`, detail: "要上架、留著還是丟掉。", cta: "去看看", target: { kind: "hub", hub: "develop", tab: "workshop" } });
  }
  const te = s.meta.team.event;
  if (te && userId !== undefined && userId !== null && !te.contributions.some((c) => c.actorId === String(userId))) {
    add({ id: "team-event", severity: "decision", icon: "event", title: `團隊事件：${TEAM_EVENT_BY_ID[te.defId]?.title ?? "任務"}`, detail: `需要 ${te.needed} 位隊員各認領一項（目前 ${te.contributions.length} 位）。`, cta: "去認領", target: { kind: "menu", page: "goals" } });
  }

  for (const inv of invites) {
    const hrs = Math.max(0, Math.ceil((inv.until - nowMs) / 3_600_000));
    add({
      id: `alliance:${inv.id}`,
      severity: "decision",
      icon: "lease",
      title: `「${clip(inv.partnerName, 12)}」邀請你們聯名`,
      detail: hrs > 0 ? `約 ${hrs} 小時內回覆；沒回覆視為婉拒。` : "邀請快失效了。",
      cta: "回覆",
      target: { kind: "hub", hub: "world", tab: "dir" },
    });
  }

  // ───── 機會 ─────
  if (leaseEnabled(s) && s.leasing.candidates.length > 0) {
    add({ id: "candidates", severity: "opportunity", icon: "lease", title: `有 ${s.leasing.candidates.length} 個品牌想進駐洽談`, detail: s.leasing.candidates.slice(0, 3).map((c) => c.brand).join("、"), cta: "看看", target: { kind: "hub", hub: "develop", tab: "leasing" } });
  }
  const doneQuests = STARTER_QUESTS.filter((q) => s.meta.achievements[q.id] !== undefined).length;
  const nextQuest = STARTER_QUESTS.find((q) => s.meta.achievements[q.id] === undefined);
  if (nextQuest) {
    add({ id: "starter-quest", severity: "opportunity", icon: "quest", title: `新手任務 ${doneQuests}／${STARTER_QUESTS.length}：${nextQuest.name}`, cta: "看清單", target: { kind: "menu", page: "help" } });
  }

  // ───── 資訊 ─────
  // 剛升級：新樓層與新業態開放了（一個遊戲日內）
  const lvUp = s.log.find((l) => l.text.startsWith("商場升到 Lv.") && s.tick - l.tick <= TICKS_PER_DAY);
  if (lvUp) {
    add({ id: `levelup:${s.level}`, severity: "opportunity", icon: "star", title: `商場升到 Lv.${s.level}！`, detail: "新的樓層與業態開放了，看看多了什麼。", cta: "全部功能", target: { kind: "menu", page: "all" } });
  }
  // 被搶客：帶著對方 key 的那一則，提供「反擊」（預選被搶走的客群）；效果只有約一個遊戲日，所以只提示一天
  s.world.notices
    .filter((n) => n.from && s.tick - n.tick <= TICKS_PER_DAY)
    .slice(0, 2)
    .forEach((n, i) => add({ id: `counter:${n.tick}:${i}`, severity: "opportunity", icon: "exclaim", title: clip(n.text, 40), detail: "可以辦一場同客群的搶客促銷反擊（要花錢，有冷卻與每日上限），也可以不理它。", cta: "反擊", target: { kind: "hub", hub: "world", tab: "dir", focus: { key: n.from!, persona: n.persona } } }));
  // 跨商場來信：收到的資金與貨、被搶客、季賽獎勵、對方解除協議…（邀請本身另有一項，不重複）
  s.world.notices
    .filter((n) => s.tick - n.tick <= NOTICE_DAYS * TICKS_PER_DAY && !n.text.includes("想和你們簽") && !(n.from && s.tick - n.tick <= TICKS_PER_DAY))
    .slice(0, MAX_NOTICE_ITEMS)
    .forEach((n, i) => add({ id: `notice:${n.tick}:${i}`, severity: "info", icon: "news", title: clip(n.text, 40), cta: "看看", target: { kind: "hub", hub: "world", tab: "dir" } }));
  const last = s.reports[s.reports.length - 1];
  if (last) {
    add({ id: `report:${last.date}`, severity: "info", icon: "news", title: `${last.date} 日報：${last.headline}`, cta: "閱讀", target: { kind: "hub", hub: "finance", tab: "reports" } });
  }

  // 穩定排序：依嚴重度，同嚴重度維持產生順序
  return out.map((it, i) => ({ it, i })).sort((a, b) => SEVERITY_ORDER[a.it.severity] - SEVERITY_ORDER[b.it.severity] || a.i - b.i).map((x) => x.it);
}

/** 這個待辦「屬於」哪個樞紐（徽章與點擊後開啟哪個視窗用）；屬於全域的回傳 null */
export function hubOfItem(it: AttentionItem): HubId | null {
  switch (it.target.kind) {
    case "hub":
      return it.target.hub;
    case "shop":
      return it.icon === "face" ? "guests" : "operate";
    case "inspection":
      return "operate";
    case "event":
      return it.icon === "face" ? "guests" : null;
    case "menu":
      return null;
  }
}

/** 彙整每個樞紐的待辦數（只算緊急與需要決定的），給 dock 徽章用 */
export function hubBadges(items: AttentionItem[]): Partial<Record<HubId, number>> {
  const b: Partial<Record<HubId, number>> = {};
  for (const it of items) {
    if (it.severity !== "urgent" && it.severity !== "decision") continue;
    const hub = hubOfItem(it);
    if (hub) b[hub] = (b[hub] ?? 0) + 1;
  }
  return b;
}

/** 每間店目前要掛的氣泡類型（場景與樓層紅點用） */
export function shopFlagsFrom(items: AttentionItem[]): Map<string, Set<"stockout" | "broken" | "complaint" | "stale">> {
  const m = new Map<string, Set<"stockout" | "broken" | "complaint" | "stale">>();
  const put = (id: string, f: "stockout" | "broken" | "complaint" | "stale") => m.set(id, (m.get(id) ?? new Set()).add(f));
  for (const it of items) {
    if (it.target.kind !== "shop") continue;
    const id = it.target.shopId;
    if (it.id.startsWith("closed:")) put(id, "broken");
    else if (it.id.startsWith("stockout:")) put(id, "stockout");
    else if (it.id.startsWith("inbox:")) put(id, "complaint");
    else if (it.id.startsWith("stale:")) put(id, "stale");
  }
  return m;
}

/**
 * 每個分頁上的待辦數（只算緊急與需要決定的），給樞紐視窗的分頁標籤用。
 * 沒指定分頁的項目不計入分頁（只算在樞紐徽章）。
 */
export function tabBadges(items: AttentionItem[], hub: HubId): Record<string, number> {
  const out: Record<string, number> = {};
  const bump = (tab: string) => (out[tab] = (out[tab] ?? 0) + 1);
  for (const it of items) {
    if (it.severity !== "urgent" && it.severity !== "decision") continue;
    if (hubOfItem(it) !== hub) continue;
    const t = it.target;
    if (t.kind === "hub" && t.tab) bump(t.tab);
    else if (t.kind === "inspection") bump("facility");
    else if (hub === "guests") bump("inbox");
  }
  return out;
}
