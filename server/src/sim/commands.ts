import {
  CATEGORY_BY_ID,
  MAX_SHOP_LEVEL,
  REFRESH_COST,
  REFRESH_GAIN,
  SUPPLY_LOT,
  UPGRADE_BASE_COST,
  UPGRADE_TICKS,
  categoryHasStock,
  leaseEnabled,
  licenseOf,
  TICKS_PER_DAY,
  type Command,
  type MallState,
  type RestockRule,
} from "@coidle/shared";
import { resolveChoice } from "./events";
import { resolveInbox, walkAct, walkFloor } from "./guests";
import { autoPrepareInspections, prepareInspection } from "./inspections";
import { cancelPromo, schedulePromo } from "./promos";
import { regularAction } from "./regulars";
import { rivalCounter, rivalIntel, rivalPact } from "./rivals";
import { cancelContract, chooseSupplier, signContract } from "./suppliers";
import { rngForTick } from "./rng";
import { counterTenant, declineTenant, resolveRenewal, signTenant, terminateLease } from "./leasing";
import { cancelTech, startTech } from "./tech";
import { cancelRnd, discardDish, listDish, startRnd, syncWorkshop, tastingAction, unlistDish } from "./workshop";
import { addLog, isFeatureEnabled, isZoneUnlocked, nextId } from "./state";
import { isOpen, placeOrder } from "./step";
import { timeInfo } from "./time";

export type { Command };

export type CommandResult = { ok: true; state: MallState } | { ok: false; error: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * 套用玩家指令。呼叫前請先把狀態推進到「現在」（advanceTo），
 * 才能確保指令作用在與離線結算一致的時間點上。
 * 回傳新的狀態（不修改傳入的物件）。
 */
export function applyCommand(state: MallState, cmd: Command): CommandResult {
  const s = structuredClone(state);
  const err = (error: string): CommandResult => ({ ok: false, error });
  const findShop = (id: string) => s.shops.find((x) => x.id === id);

  switch (cmd.type) {
    case "touch":
      break;

    case "setPrice": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (typeof cmd.price !== "number" || !Number.isFinite(cmd.price)) return err("價格無效");
      const cat = CATEGORY_BY_ID[shop.category];
      if (!cat) return err("業態無效");
      shop.price = Math.round(clamp(cmd.price, cat.refPrice * 0.5, cat.refPrice * 2.5));
      break;
    }

    case "setHours": {
      if (!isInt(cmd.open) || !isInt(cmd.close) || cmd.open < 0 || cmd.close > 24 || cmd.close - cmd.open < 4) {
        return err("營業時間至少 4 小時，且須在 0–24 點之間");
      }
      s.hours = { open: cmd.open, close: cmd.close };
      break;
    }

    case "setRestock": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      const r = cmd.rule;
      const next: RestockRule = { ...shop.restock };
      if (typeof r.enabled === "boolean") next.enabled = r.enabled;
      if (typeof r.min === "number") next.min = Math.max(0, Math.round(r.min));
      if (typeof r.target === "number") next.target = Math.max(0, Math.round(r.target));
      if (typeof r.dailyBudget === "number") next.dailyBudget = Math.max(0, Math.round(r.dailyBudget));
      if (next.target < next.min) return err("補貨目標不可低於下限");
      shop.restock = next;
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
      placeOrder(s, shop, cmd.qty);
      addLog(s, "order", `手動向盤商訂購「${shop.name}」${cmd.qty} 份。`);
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
      if (cat.zone !== slot.zone) return err("這個業態不能開在這個區域");
      if (!isZoneUnlocked(s, slot.zone)) return err("這個區域尚未解鎖");
      if (slot.shopId || s.builds.some((b) => b.slot === slot.id)) return err("這個店面已被使用或正在施工");
      const lic = licenseOf(cat.id); // 許認可：規費與審查時間
      const total = cat.buildCost + (lic?.fee ?? 0);
      if (s.funds < total) return err("資金不足");
      s.funds -= total;
      s.builds.push({
        id: nextId(s, "bld"),
        kind: "open",
        slot: slot.id,
        category: cat.id,
        completeTick: s.tick + cat.buildTicks + (lic?.extraTicks ?? 0),
        cost: total,
      });
      addLog(s, "build", `開始興建「${cat.name}」。${lic ? `（同步辦理：${lic.name}）` : ""}`);
      break;
    }

    case "upgradeShop": {
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (shop.level >= MAX_SHOP_LEVEL) return err("已達最高等級");
      if (s.builds.some((b) => b.shopId === shop.id)) return err("正在翻新中");
      const cost = UPGRADE_BASE_COST * shop.level;
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

    case "resolveInbox": {
      const r = resolveInbox(s, cmd.uid, cmd.optionId);
      if (!r.ok) return err(r.error);
      break;
    }

    case "walkFloor": {
      const r = walkFloor(s, rngForTick(s.seed, s.tick ^ 0x3c6ef372), isOpen(s, timeInfo(s.tick)));
      if (!r.ok) return err(r.error);
      break;
    }

    case "walkAct": {
      const r = walkAct(s, cmd.voiceId, cmd.optionId);
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
      const r = startRnd(s, cmd.shopId, cmd.picks ?? {});
      if (!r.ok) return err(r.error);
      break;
    }

    case "cancelRnd": {
      const r = cancelRnd(s, cmd.shopId);
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

    case "startTech": {
      const r = startTech(s, cmd.id);
      if (!r.ok) return err(r.error);
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

    case "setLease": {
      if (!leaseEnabled(s)) return err("出租功能尚未開放（商場 Lv.3）");
      const shop = findShop(cmd.shopId);
      if (!shop) return err("找不到這間店");
      if (!cmd.enabled && shop.tenant && !shop.tenant.own) return err("這是簽約的租戶，要解約請到「更多 → 招商」（有違約金）");
      shop.mode = cmd.enabled ? "lease" : "direct";
      if (!cmd.enabled) shop.tenant = null;
      else if (!shop.tenant) shop.tenant = { brand: shop.name, quality: 0.65, fame: 30, rent: shop.rent, commission: shop.commission, startTick: s.tick, endTick: s.tick + 60 * TICKS_PER_DAY, satisfaction: 60, lowDays: 0, own: true };
      if (cmd.rent !== undefined) shop.rent = Math.round(clamp(cmd.rent, 0, 1_000_000));
      if (cmd.commission !== undefined) shop.commission = clamp(cmd.commission, 0, 0.4);
      break;
    }

    default:
      return err("未知的指令");
  }

  syncWorkshop(s); // 指令可能解鎖新素材或線索（刺探情報、簽約…）
  return { ok: true, state: s };
}
