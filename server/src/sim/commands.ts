import {
  CATEGORY_BY_ID,
  PRICE_MIN,
  validHours,
  PRICE_HARD_MAX,
  CONCEPT_BY_ID,
  CONCEPT_COOLDOWN_TICKS,
  FAMILY_ORDER,
  MAX_SHOP_LEVEL,
  SUPPLIER_BY_ID,
  supplierState,
  ZONE_BY_ID,
  expandInfo,
  isCategoryAvailable,
  REFRESH_COST,
  REFRESH_GAIN,
  SUPPLY_LOT,
  RUSH_PREMIUM,
  currentUnitCost,
  UPGRADE_BASE_COST,
  UPGRADE_TICKS,
  categoryHasStock,
  conceptChangeCost,
  leaseEnabled,
  cleanShopName,
  SHOP_NAME_MAX,
  licenseOf,
  TICKS_PER_DAY,
  DEMOLISH_COOLDOWN_DAYS,
  DEMOLISH_FEE_RATE,
  SPANS,
  applyResize,
  footprintOf,
  isLiveSlot,
  moveQuote,
  slotBusy,
  slotSpan,
  openPlanEnabled,
  instantBuildEnabled,
  planResize,
  shopSpan,
  spanCostFactor,
  spanTicksFactor,
  type Span,
  type Command,
  type ConceptId,
  type MallState,
  type RestockRule,
  type Shop,
} from "@coidle/shared";
import { counterFacilityOffer, resolveFacilityRenewal, acceptFacilityOffer, declineFacilityOffer, endFacilityLease, maintainFacility, setFacilityOps, startFacilityBuild } from "./facilities";
import { resolveChoice } from "./events";
import { resolveInbox, walkAct, walkFloor } from "./guests";
import { autoPrepareInspections, prepareInspection } from "./inspections";
import { cancelPromo, schedulePromo } from "./promos";
import { resolveLegal, setInsurance } from "./legal";
import { setMembership } from "./members";
import { chatShop, deepenIssue, endPatrol, fixIssue, inspectSpot, startPatrol } from "./patrol";
import { resolveVoice } from "./voices";
import { regularAction } from "./regulars";
import { rivalCounter, rivalIntel, rivalPact } from "./rivals";
import { cancelContract, chooseSupplier, signContract } from "./suppliers";
import { isForcedLease, repayLoan, restructureBlock, setBizInsurance, takeLoan } from "./finance";
import { rngForTick } from "./rng";
import { bump, checkStarters, contribute, guessPlace, trackActor, type Actor } from "./meta";
import { counterTenant, declineTenant, resolveRenewal, signTenant, terminateLease, vacate } from "./leasing";
import { cancelTech, startTech, techExperiment } from "./tech";
import { cancelRnd, resolveRndEvent, discardDish, listDish, startRnd, syncWorkshop, tastingAction, unlistDish } from "./workshop";
import { addLog, isFeatureEnabled, isZoneUnlocked, nextId } from "./state";
import { completeBuilds, isOpen, placeOrder } from "./step";

/** 「建造立刻完工」旗標：把所有施工中的案子改成現在完工並當場收尾（開店、翻新） */
function finishBuildsNow(s: MallState): void {
  for (const b of s.builds) b.completeTick = Math.min(b.completeTick, s.tick);
  completeBuilds(s);
}
import { timeInfo } from "./time";

export type { Command };

export type CommandResult = { ok: true; state: MallState } | { ok: false; error: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** 把部分補貨規則合進現有規則；不合法回傳錯誤訊息字串 */
function mergeRestock(cur: RestockRule, r: Partial<RestockRule>): RestockRule | string {
  const next: RestockRule = { ...cur };
  if (typeof r.enabled === "boolean") next.enabled = r.enabled;
  if (typeof r.min === "number") next.min = Math.max(0, Math.round(r.min));
  if (typeof r.target === "number") next.target = Math.max(0, Math.round(r.target));
  if (typeof r.dailyBudget === "number") next.dailyBudget = Math.max(0, Math.round(r.dailyBudget));
  if (typeof r.smart === "boolean") next.smart = r.smart;
  if (typeof r.coverDays === "number") next.coverDays = Math.min(6, Math.max(1, Math.round(r.coverDays * 2) / 2));
  if (typeof r.preShock === "boolean") next.preShock = r.preShock;
  if (next.target < next.min) return "補貨目標不可低於下限";
  return next;
}

/**
 * 套用玩家指令。呼叫前請先把狀態推進到「現在」（advanceTo），
 * 才能確保指令作用在與離線結算一致的時間點上。
 * 回傳新的狀態（不修改傳入的物件）。
 */
export function applyCommand(state: MallState, cmd: Command, actor?: Actor): CommandResult {
  const s = structuredClone(state);
  const err = (error: string): CommandResult => ({ ok: false, error });
  const findShop = (id: string) => s.shops.find((x) => x.id === id);
  /** 店名是否已被其他店（含施工中的新店）使用 */
  const nameTaken = (n: string, exceptShopId?: string) =>
    s.shops.some((x) => x.id !== exceptShopId && x.name === n) || s.builds.some((b) => b.name === n);

  // 重整期間（逾期或接受緊急授信）：擴建、升級、興建設施、科技立項暫時凍結
  const frozenTypes: string[] = ["buildShop", "expandZone", "buildFacility", "upgradeShop", "startTech"];
  if (frozenTypes.includes(cmd.type)) {
    const frozen = restructureBlock(s);
    if (frozen) return err(frozen);
  }

  switch (cmd.type) {
    case "touch":
      break;

    case "setPrice": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (typeof cmd.price !== "number" || !Number.isFinite(cmd.price)) return err("價格無效");
      const cat = CATEGORY_BY_ID[shop.category];
      if (!cat) return err("業態無效");
      shop.price = clamp(Math.round(cmd.price), PRICE_MIN, PRICE_HARD_MAX);
      break;
    }

    case "setHours": {
      if (!validHours(cmd.open, cmd.close)) {
        return err("營業時間至少 4 小時、最多 24 小時；開門 0–23 點，打烊最晚隔天 05:00（可以跨午夜，例如 05:00–03:00）");
      }
      s.hours = { open: cmd.open, close: cmd.close };
      break;
    }

    case "setConcept": {
      const def = typeof cmd.id === "string" ? CONCEPT_BY_ID[cmd.id as ConceptId] : undefined;
      if (!def) return err("找不到這個定位");
      if (def.id === (s.concept?.id ?? "general")) return err("目前就是這個定位");
      // 第一次選免費；之後每次要付改裝與宣傳的費用，而且要隔一段時間才能再換
      const first = s.concept === undefined;
      if (!first) {
        const left = s.concept!.since + CONCEPT_COOLDOWN_TICKS - s.tick;
        if (left > 0) return err(`剛換過定位，還要 ${Math.ceil(left / TICKS_PER_DAY)} 個遊戲日才能再換`);
      }
      const cost = first ? 0 : conceptChangeCost(s.level);
      if (s.funds < cost) return err("資金不足");
      s.funds -= cost;
      s.concept = { id: def.id, since: s.tick };
      addLog(s, "info", `商場重新定位為「${def.name}」${cost > 0 ? `（花費 ¥${cost.toLocaleString("en-US")}）` : ""}。`);
      break;
    }

    case "setRestock": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      const next = mergeRestock(shop.restock, cmd.rule);
      if (typeof next === "string") return err(next);
      shop.restock = next;
      break;
    }

    // 統一補貨頁：一次把同一組規則套到多間店（分樓層設定）。有進貨需求且非出租的店才會套用
    case "setRestockMany": {
      if (!Array.isArray(cmd.shopIds) || cmd.shopIds.length === 0 || cmd.shopIds.length > 200) return err("沒有選到店");
      const targets = cmd.shopIds.map(findShop);
      if (targets.some((x) => !x)) return err("找不到這間店");
      const done: Shop[] = [];
      for (const shop of targets as Shop[]) {
        const cat = CATEGORY_BY_ID[shop.category];
        if (!cat || !categoryHasStock(cat) || shop.mode === "lease") continue;
        const next = mergeRestock(shop.restock, cmd.rule);
        if (typeof next === "string") return err(`「${shop.name}」：${next}`);
        done.push(shop);
        shop.restock = next;
      }
      if (done.length === 0) return err("這些店都不需要自己補貨");
      break;
    }

    case "orderStock": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      const cat = CATEGORY_BY_ID[shop.category];
      if (!cat || !categoryHasStock(cat)) return err("這種店不需要進貨");
      if (shop.mode === "lease") return err("出租的店由租戶自行進貨");
      if (!isInt(cmd.qty) || cmd.qty < SUPPLY_LOT || cmd.qty % SUPPLY_LOT !== 0 || cmd.qty > 2000) {
        return err(`進貨量須為 ${SUPPLY_LOT} 的倍數（最多 2000）`);
      }
      if (cmd.rush !== undefined && typeof cmd.rush !== "boolean") return err("設定無效");
      // 手動進貨要付得起（自動補貨有供應商賒帳額度，手動沒有）：資金不夠就不能再把帳拉得更深
      const estimate = currentUnitCost(s, shop.category) * cmd.qty * (cmd.rush ? RUSH_PREMIUM : 1);
      if (s.funds < estimate) return err(`資金不足：這批約需 ¥${Math.round(estimate).toLocaleString("en-US")}`);
      const before = shop.incoming.reduce((a, b) => a + b.qty, 0);
      if (!placeOrder(s, shop, cmd.qty, { rush: !!cmd.rush })) return err("下不了單：倉庫已滿、供應商不能出貨，或進不到貨");
      const got = shop.incoming.reduce((a, b) => a + b.qty, 0) - before;
      addLog(s, "order", `${cmd.rush ? "急件" : "手動"}向盤商訂購「${shop.name}」${cmd.qty} 份${got < cmd.qty ? `（實際進貨 ${got} 份）` : ""}。`);
      break;
    }

    case "setCleaning":
      if (![0, 1, 2].includes(cmd.level)) return err("等級無效");
      s.cleaningLevel = cmd.level;
      break;

    case "setMaintenance":
      if (![0, 1, 2].includes(cmd.level)) return err("等級無效");
      s.maintenanceLevel = cmd.level;
      break;

    case "buildShop": {
      const slot = s.slots[cmd.slot];
      const cat = CATEGORY_BY_ID[cmd.category];
      if (!slot || !cat) return err("店面或業態無效");
      if (cat.facility) return err("這是大型設施，請改用「設施」興建，不佔店面格");
      if (cat.zone !== slot.zone) return err("這個業態不能開在這個區域");
      if (!isZoneUnlocked(s, slot.zone)) return err("這個區域尚未解鎖");
      if (!isCategoryAvailable(s, cat.id)) return err(`這個業態要商場 Lv.${cat.minLevel ?? 1} 才能開`);
      if (slot.shopId || s.builds.some((b) => b.slot === slot.id)) return err("這個店面已被使用或正在施工");
      if (!isLiveSlot(slot)) return err("店面無效");
      // 大小（階段 C，樓層空地化）：旗標關閉時只能 1 格，行為與以前完全相同
      const span: Span = cmd.span ?? 1;
      if (span !== 1) {
        if (!openPlanEnabled(s)) return err("大店尚未開放");
        if (!SPANS.includes(span)) return err("大小無效");
        if (!footprintOf(cat).options.includes(span)) return err("這個業態不能開這個大小");
      }
      if (cmd.cells !== undefined && (!Array.isArray(cmd.cells) || !cmd.cells.every((c) => isInt(c) && c >= 0))) return err("選的格子無效");
      const rp = planResize(s, slot.id, span, cmd.cells);
      if (!rp.ok) return err(rp.error ?? "放不下這個大小");
      const lic = licenseOf(cat.id); // 許認可：規費與審查時間
      const total = cat.buildCost * spanCostFactor(span) + (lic?.fee ?? 0);
      let name: string | undefined;
      if (cmd.name !== undefined && cmd.name !== "") {
        const n = cleanShopName(cmd.name);
        if (!n) return err(`店名要 1–${SHOP_NAME_MAX} 個字`);
        if (nameTaken(n)) return err("已經有同名的店了");
        name = n;
      }
      if (s.funds < total) return err("資金不足");
      s.funds -= total;
      applyResize(s, slot.id, span, rp); // 先把格子留給這間店（吸收旁邊的空格）
      s.builds.push({
        id: nextId(s, "bld"),
        kind: "open",
        slot: slot.id,
        category: cat.id,
        completeTick: s.tick + Math.round(cat.buildTicks * spanTicksFactor(span)) + (lic?.extraTicks ?? 0),
        cost: total,
        ...(name ? { name } : {}),
      });
      addLog(s, "build", `開始興建「${cat.name}」。${lic ? `（同步辦理：${lic.name}）` : ""}`);
      if (instantBuildEnabled(s)) finishBuildsNow(s);
      break;
    }

    case "demolishShop": {
      if (!openPlanEnabled(s)) return err("拆除重排尚未開放");
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (shop.mode === "lease") return err("出租中的店請先「解約」或「收回自營」");
      if (s.builds.some((b) => b.shopId === shop.id)) return err("翻新施工中，完工後才能拆除");
      if (s.shops.length <= 1) return err("商場至少要留一間店");
      const slot = s.slots[shop.slot];
      const cat = CATEGORY_BY_ID[shop.category];
      if (!slot || !cat) return err("店面無效");
      const last = s.demolishAt?.[slot.zone];
      if (last !== undefined && s.tick < last + DEMOLISH_COOLDOWN_DAYS * TICKS_PER_DAY) return err("這一層剛拆過店，要隔一個遊戲日才能再拆");
      const fee = Math.round(cat.buildCost * spanCostFactor(shopSpan(shop)) * DEMOLISH_FEE_RATE);
      if (s.funds < fee) return err(`資金不足（拆除費 ¥${fee.toLocaleString("en-US")}）`);
      s.funds -= fee;
      s.today.repairs += fee;
      const old = shop.name;
      vacate(s, shop);
      const rp = planResize(s, slot.id, 1);
      if (rp.ok) applyResize(s, slot.id, 1, rp); // 把吸收的格子還給樓板
      s.demolishAt = { ...(s.demolishAt ?? {}), [slot.zone]: s.tick };
      addLog(s, "build", `「${old}」拆除了（拆除費 ¥${fee.toLocaleString("en-US")}），變回空地。`);
      break;
    }

    case "expandZone": {
      const z = ZONE_BY_ID[cmd.zone];
      if (!z) return err("區域無效");
      if (!isZoneUnlocked(s, z.id)) return err("這個區域尚未解鎖");
      const info = expandInfo(s, z.id);
      if (!info.canBuy) return err(info.reason ?? "目前不能擴建");
      s.funds -= info.cost;
      s.slots.push({ id: s.slots.length, zone: z.id, shopId: null });
      addLog(s, "build", `「${z.name}」擴建完成，多了一個店面（第 ${info.n + 1}／${info.max} 次擴建）。`);
      break;
    }

    case "buildFacility": {
      const e = startFacilityBuild(s, cmd.kind);
      if (e) return err(e);
      break;
    }

    case "setFacilityOps": {
      const e = setFacilityOps(s, cmd);
      if (e) return err(e);
      break;
    }

    case "maintainFacility": {
      const e = maintainFacility(s, cmd.kind);
      if (e) return err(e);
      break;
    }

    case "acceptFacilityOffer": {
      const e = acceptFacilityOffer(s, cmd.kind, cmd.offerId);
      if (e) return err(e);
      break;
    }

    case "declineFacilityOffer": {
      const e = declineFacilityOffer(s, cmd.kind, cmd.offerId);
      if (e) return err(e);
      break;
    }

    case "counterFacilityOffer": {
      const e = counterFacilityOffer(s, cmd.kind, cmd.offerId, cmd.mult);
      if (e) return err(e);
      break;
    }

    case "resolveFacilityRenewal": {
      const e = resolveFacilityRenewal(s, cmd.kind, cmd.action);
      if (e) return err(e);
      break;
    }

    case "endFacilityLease": {
      const e = endFacilityLease(s, cmd.kind);
      if (e) return err(e);
      break;
    }

    case "upgradeShop": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (shop.level >= MAX_SHOP_LEVEL) return err("已達最高等級");
      if (s.builds.some((b) => b.shopId === shop.id)) return err("正在翻新中");
      const cost = UPGRADE_BASE_COST * shop.level * spanCostFactor(shop.span);
      if (s.funds < cost) return err("資金不足");
      s.funds -= cost;
      s.builds.push({
        id: nextId(s, "bld"),
        kind: "upgrade",
        slot: shop.slot,
        shopId: shop.id,
        completeTick: s.tick + UPGRADE_TICKS,
        cost,
      });
      addLog(s, "build", `「${shop.name}」開始翻新。`);
      if (instantBuildEnabled(s)) finishBuildsNow(s);
      break;
    }

    case "moveShop": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (shop.mode === "lease") return err("出租中的店不能搬遷");
      if (shopSpan(shop) !== 1) return err("大店牽涉併格，請用「拆除重排」");
      if (s.builds.some((b) => b.shopId === shop.id)) return err("施工中的店不能搬遷");
      const from = s.slots[shop.slot];
      const to = s.slots[cmd.toSlot];
      const cat = CATEGORY_BY_ID[shop.category];
      if (!from || !to || !cat) return err("店面無效");
      if (to.id === from.id) return err("已經在這個店面了");
      if (!isLiveSlot(to) || slotSpan(to) !== 1) return err("目的地不是一般店面");
      if (slotBusy(s, to)) return err("目的地已被使用或正在施工");
      if (to.zone !== from.zone) return err("只能搬到同一層樓的店面");
      const q = moveQuote(cat.buildCost, cat.buildTicks, 1);
      if (s.funds < q.cost) return err(`資金不足（搬遷費 ¥${q.cost.toLocaleString("en-US")}）`);
      s.funds -= q.cost;
      s.today.repairs += q.cost;
      const completeTick = s.tick + q.ticks;
      s.builds.push({ id: nextId(s, "bld"), kind: "move", slot: to.id, fromSlot: from.id, shopId: shop.id, completeTick, cost: q.cost });
      shop.closedUntilTick = Math.max(shop.closedUntilTick, completeTick);
      addLog(s, "build", `「${shop.name}」開始搬遷（搬遷費 ¥${q.cost.toLocaleString("en-US")}，搬遷期間歇業）。`);
      if (instantBuildEnabled(s)) finishBuildsNow(s);
      break;
    }

    case "refreshShop": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (shop.mode === "lease") return err("出租的店由租戶自行更新");
      const cost = REFRESH_COST * shop.level;
      if (s.funds < cost) return err("資金不足");
      if (shop.freshness >= 90) return err("才剛更新過，客人還很新鮮");
      s.funds -= cost;
      shop.freshness = Math.min(100, shop.freshness + REFRESH_GAIN);
      addLog(s, "info", `「${shop.name}」推出新菜單／新活動，新鮮感回升了。`);
      break;
    }

    case "resolveEvent": {
      if (!resolveChoice(s, cmd.uid, cmd.optionId, rngForTick(s.seed, s.tick ^ 0x5bd1e995))) {
        return err("事件不存在或選項無效");
      }
      break;
    }

    case "resolveAllDefault": {
      // 把所有待決事件與稽查預告都採預設處理（遇事暫停時「採預設處理並恢復」用）
      const unprepared = s.inspections.pending.some((p) => p.prep === null);
      if (s.pending.length === 0 && !unprepared) return err("沒有待處理的事件");
      const rng = rngForTick(s.seed, s.tick ^ 0x5bd1e995);
      for (const p of s.pending.slice()) resolveChoice(s, p.uid, null, rng);
      autoPrepareInspections(s);
      break;
    }

    case "schedulePromo": {
      const r = schedulePromo(s, cmd.defId, cmd.startTick);
      if (!r.ok) return err(r.error);
      bump(s, "promos");
      break;
    }

    case "cancelPromo": {
      const r = cancelPromo(s, cmd.uid);
      if (!r.ok) return err(r.error);
      break;
    }

    case "prepareInspection": {
      const r = prepareInspection(s, cmd.uid, cmd.level);
      if (!r.ok) return err(r.error);
      break;
    }

    case "regularVoice": {
      const r = resolveVoice(s, cmd.uid, cmd.optionId);
      if (!r.ok) return err(r.error);
      addLog(s, "info", `🏮 ${r.note}`);
      bump(s, "handled");
      break;
    }

    case "setMembership": {
      const r = setMembership(s, cmd.rate);
      if (!r.ok) return err(r.error);
      break;
    }

    case "legalAction": {
      const r = resolveLegal(s, cmd.uid, cmd.optionId);
      if (!r.ok) return err(r.error);
      addLog(s, "info", `⚖️ ${r.note}`);
      bump(s, "handled");
      break;
    }

    case "setInsurance": {
      const r = setInsurance(s, cmd.level);
      if (!r.ok) return err(r.error);
      break;
    }

    case "resolveInbox": {
      const r = resolveInbox(s, cmd.uid, cmd.optionId);
      if (!r.ok) return err(r.error);
      bump(s, "handled");
      break;
    }

    case "walkFloor": {
      const r = walkFloor(s, rngForTick(s.seed, s.tick ^ 0x3c6ef372), isOpen(s, timeInfo(s.tick)));
      if (!r.ok) return err(r.error);
      bump(s, "walks");
      break;
    }

    case "walkAct": {
      const r = walkAct(s, cmd.voiceId, cmd.optionId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "patrolStart": {
      const r = startPatrol(s, isOpen(s, timeInfo(s.tick)));
      if (!r.ok) return err(r.error);
      break;
    }
    case "patrolInspect": {
      const r = inspectSpot(s, cmd.shopId, cmd.spot);
      if (!r.ok) return err(r.error);
      addLog(s, "info", `🚶 ${r.note}`);
      break;
    }
    case "patrolChat": {
      const r = chatShop(s, cmd.shopId, rngForTick(s.seed, s.tick ^ 0x7a1c3d5b));
      if (!r.ok) return err(r.error);
      break;
    }
    case "patrolDeepen": {
      const r = deepenIssue(s, cmd.issueId);
      if (!r.ok) return err(r.error);
      addLog(s, "info", `🚶 ${r.note}`);
      break;
    }
    case "patrolFix": {
      const r = fixIssue(s, cmd.issueId, cmd.option);
      if (!r.ok) return err(r.error);
      bump(s, "handled");
      break;
    }
    case "patrolEnd": {
      const r = endPatrol(s);
      if (!r.ok) return err(r.error);
      break;
    }

    case "chooseSupplier": {
      const r = chooseSupplier(s, cmd.family, cmd.supplierId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "signContract": {
      const r = signContract(s, cmd.supplierId, cmd.days);
      if (!r.ok) return err(r.error);
      break;
    }

    case "cancelContract": {
      const r = cancelContract(s, cmd.supplierId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "setSupplyPrefs": {
      if (cmd.autoFallback !== undefined) {
        if (typeof cmd.autoFallback !== "boolean") return err("設定無效");
        s.supply.autoFallback = cmd.autoFallback;
      }
      if (cmd.backup !== undefined) {
        const fam = FAMILY_ORDER.find((f) => f === cmd.backup!.family);
        if (!fam) return err("貨品類別無效");
        if (cmd.backup.supplierId === null) {
          if (s.supply.backup) delete s.supply.backup[fam];
        } else {
          const def = SUPPLIER_BY_ID[cmd.backup.supplierId];
          const st = supplierState(s, cmd.backup.supplierId);
          if (!def || def.family !== fam) return err("供應商與貨品不符");
          if (!st?.discovered) return err("你還不認識這家供應商");
          if (s.supply.choice[fam] === def.id) return err("他已經是主力供應商了");
          s.supply.backup = { ...(s.supply.backup ?? {}), [fam]: def.id };
        }
      }
      break;
    }

    case "rivalIntel": {
      const r = rivalIntel(s, cmd.rivalId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "rivalPact": {
      const r = rivalPact(s, cmd.rivalId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "rivalCounter": {
      const r = rivalCounter(s, cmd.rivalId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "setRivalStance": {
      if (!["defend", "neutral", "aggressive"].includes(cmd.stance)) return err("姿態無效");
      s.rivals.stance = cmd.stance;
      break;
    }

    case "regularAction": {
      const r = regularAction(s, cmd.regularId, cmd.action);
      if (!r.ok) return err(r.error);
      break;
    }

    case "startRnd": {
      const r = startRnd(s, cmd.shopId, cmd.picks ?? {}, cmd.play);
      if (!r.ok) return err(r.error);
      break;
    }

    case "cancelRnd": {
      const r = cancelRnd(s, cmd.shopId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "resolveRndEvent": {
      const r = resolveRndEvent(s, cmd.shopId, cmd.optionId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "tastingAction": {
      if (!["list", "keep", "discard"].includes(cmd.action)) return err("操作無效");
      const r = tastingAction(s, cmd.uid, cmd.action, cmd.slotIndex);
      if (!r.ok) return err(r.error);
      break;
    }

    case "listDish": {
      const r = listDish(s, cmd.shopId, cmd.dishId, cmd.slotIndex);
      if (!r.ok) return err(r.error);
      break;
    }

    case "unlistDish": {
      const r = unlistDish(s, cmd.shopId, cmd.slotIndex);
      if (!r.ok) return err(r.error);
      break;
    }

    case "discardDish": {
      const r = discardDish(s, cmd.dishId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "setGuestPrefs": {
      if (cmd.complaintStance !== undefined) {
        if (!["soft", "balanced", "firm"].includes(cmd.complaintStance)) return err("處理偏好無效");
        s.guestPrefs.complaintStance = cmd.complaintStance;
      }
      if (cmd.autoReplyReviews !== undefined) {
        if (typeof cmd.autoReplyReviews !== "boolean") return err("設定無效");
        s.guestPrefs.autoReplyReviews = cmd.autoReplyReviews;
      }
      break;
    }

    case "contribute": {
      const r = contribute(s, cmd.taskId, actor);
      if (!r.ok) return err(r.error);
      break;
    }

    case "guessPlace": {
      const r = guessPlace(s, cmd.text);
      if (!r.ok) return err(r.error);
      break;
    }

    case "startTech": {
      const r = startTech(s, cmd.id, cmd.plan);
      if (!r.ok) return err(r.error);
      break;
    }

    case "techExperiment": {
      const r = techExperiment(s, cmd.id, cmd.optionId, cmd.analysis);
      if (!r.ok) return err(r.error);
      bump(s, "handled");
      break;
    }

    case "cancelTech": {
      const r = cancelTech(s, cmd.id);
      if (!r.ok) return err(r.error);
      break;
    }

    case "signTenant": {
      const r = signTenant(s, cmd.candidateId, cmd.slot);
      if (!r.ok) return err(r.error);
      break;
    }

    case "counterTenant": {
      const r = counterTenant(s, cmd.candidateId, cmd.rentMult);
      if (!r.ok) return err(r.error);
      break;
    }

    case "declineTenant": {
      const r = declineTenant(s, cmd.candidateId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "resolveRenewal": {
      if (!["renew", "raise", "release"].includes(cmd.action)) return err("操作無效");
      const r = resolveRenewal(s, cmd.uid, cmd.action);
      if (!r.ok) return err(r.error);
      break;
    }

    case "terminateLease": {
      const r = terminateLease(s, cmd.shopId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "renameShop": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (shop.mode === "lease") return err("出租中的店名稱由租戶品牌決定");
      const n = cleanShopName(cmd.name);
      if (!n) return err(`店名要 1–${SHOP_NAME_MAX} 個字`);
      if (nameTaken(n, shop.id)) return err("已經有同名的店了");
      shop.name = n;
      break;
    }

    case "closeShop": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (shop.mode === "lease") return err("出租中的店請用「解約」或「收回自營」");
      if (s.builds.some((b) => b.shopId === shop.id)) return err("翻新施工中，完工後才能歇業");
      if (s.shops.length <= 1) return err("商場至少要留一間店");
      const old = shop.name;
      vacate(s, shop);
      addLog(s, "build", `「${old}」歇業了，店面空出來了。`);
      break;
    }

    case "setLease": {
      // 改回直營一律可以（重整時銀行會把店強制轉成出租，商場還沒到出租功能的等級也要能改回來）
      if (cmd.enabled && !leaseEnabled(s)) return err("出租功能尚未開放（商場 Lv.3）");
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (!cmd.enabled && shop.tenant && !shop.tenant.own) return err("這是簽約的租戶，要解約請到「開發 → 招商」（有違約金）");
      if (!cmd.enabled && isForcedLease(s, shop.id)) return err("重整期間，這間店是銀行要求轉成出租的，還清貸款後才能改回直營");
      shop.mode = cmd.enabled ? "lease" : "direct";
      if (!cmd.enabled) shop.tenant = null;
      else if (!shop.tenant) shop.tenant = { brand: shop.name, quality: 0.65, fame: 30, rent: shop.rent, commission: shop.commission, startTick: s.tick, endTick: s.tick + 60 * TICKS_PER_DAY, satisfaction: 60, lowDays: 0, own: true };
      if (cmd.rent !== undefined) shop.rent = Math.round(clamp(cmd.rent, 0, 1_000_000));
      if (cmd.commission !== undefined) shop.commission = clamp(cmd.commission, 0, 0.4);
      break;
    }

    case "takeLoan": {
      const r = takeLoan(s, cmd.product, cmd.amount, cmd.terms?.climate);
      if (!r.ok) return err(r.error);
      break;
    }

    case "repayLoan": {
      const r = repayLoan(s, cmd.loanId, cmd.amount);
      if (!r.ok) return err(r.error);
      break;
    }

    case "setBizInsurance": {
      const r = setBizInsurance(s, cmd.level);
      if (!r.ok) return err(r.error);
      break;
    }

    default:
      return err("未知的指令");
  }

  syncWorkshop(s); // 指令可能解鎖新素材或線索（刺探情報、簽約…）
  trackActor(s, actor, cmd.type);
  bump(s, `cmd_${cmd.type}`);
  checkStarters(s);
  return { ok: true, state: s };
}
