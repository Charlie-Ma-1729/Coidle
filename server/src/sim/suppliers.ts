import {
  CATEGORY_BY_ID,
  CONTRACT_CANCEL_FEE,
  CONTRACT_DAYS,
  CONTRACT_MIN_REL,
  FAMILY_OF,
  FAMILY_ORDER,
  REL_PER_ORDER,
  SHORTAGE_FILL,
  SPOT_PREMIUM,
  SUPPLIERS,
  SUPPLIER_BY_ID,
  SUPPLIER_SWITCH_FEE,
  SUPPLY_FAMILIES,
  SUPPLY_LEAD_TICKS,
  SHOCK_KINDS,
  activeSupplyShocks,
  chosenSupplier,
  familyOf,
  familyShopCount,
  hasContract,
  liveShock,
  newSupplierState,
  shockFill,
  shockTier,
  supplierMarketPrice,
  supplierPriceNow,
  supplierState,
  supplierUnavailable,
  type MallState,
  type Shop,
  type SupplierDef,
  type SupplierState,
  type SupplyFamily,
} from "@coidle/shared";
import type { GuestResult } from "./guests";
import { createRng, hash32, type Rng } from "./rng";
import { addLog } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

export interface Pick {
  def: SupplierDef;
  st: SupplierState;
  /** 主力無法出貨，臨時向備用供應商買現貨 */
  spot: boolean;
}

/** 「有效單價」：價格除以此刻實際能拿到的貨量比例（正在受衝擊的備用供應商沒那麼划算） */
function effectiveCost(s: MallState, def: SupplierDef, st: SupplierState): number {
  const sh = liveShock(st, s.tick);
  const fill = sh && sh.kind !== "price_spike" ? Math.max(0.25, shockFill(sh.fill, shockTier(st, s.tick))) : 1;
  return supplierPriceNow(s, st, def) / fill;
}

/**
 * 備用供應商：玩家指定了首選就用首選（還能出貨的話），否則挑「有效單價」最低的。
 * 只會從已經認識的供應商裡挑。
 */
export function pickAlternative(s: MallState, family: SupplyFamily, excludeId?: string): Pick | null {
  const preferred = s.supply.backup?.[family];
  if (preferred && preferred !== excludeId) {
    const def = SUPPLIER_BY_ID[preferred];
    const st = supplierState(s, preferred);
    if (def && def.family === family && st?.discovered && !supplierUnavailable(st, s.tick)) return { def, st, spot: true };
  }
  let best: Pick | null = null;
  for (const def of SUPPLIERS) {
    if (def.family !== family || def.id === excludeId) continue;
    const st = supplierState(s, def.id);
    if (!st || !st.discovered || supplierUnavailable(st, s.tick)) continue;
    if (!best || effectiveCost(s, def, st) < effectiveCost(s, best.def, best.st)) best = { def, st, spot: true };
  }
  return best;
}

/** 這個家族這次要向誰進貨：主力能出貨就用主力；不行且開了自動備援，就用備用供應商 */
export function pickSupplier(s: MallState, family: SupplyFamily): Pick | null {
  const main = chosenSupplier(s, family);
  if (main && !supplierUnavailable(main.st, s.tick)) return { def: main.def, st: main.st, spot: false };
  if (!s.supply.autoFallback) return null;
  return pickAlternative(s, family, main?.def.id);
}

export interface Quote {
  pick: Pick;
  /** 每份進貨價（已含全域行情、供應商價格、現貨加價） */
  unit: number;
}

/** 這間店現在向供應商下單，每份多少錢；買不到就回傳 null */
export function quoteOrder(s: MallState, shop: Shop, globalMult: number): Quote | null {
  const fam = familyOf(shop.category);
  if (!CATEGORY_BY_ID[shop.category] || !fam) return null;
  const pick = pickSupplier(s, fam);
  return pick ? quoteWith(s, shop, pick, globalMult, pick.spot ? SPOT_PREMIUM : 1) : null;
}

/** 指定供應商的報價（premium＝現貨、補缺口、急件等加價） */
export function quoteWith(s: MallState, shop: Shop, pick: Pick, globalMult: number, premium = 1): Quote | null {
  const cat = CATEGORY_BY_ID[shop.category];
  if (!cat) return null;
  const mult = globalMult * supplierPriceNow(s, pick.st, pick.def) * premium;
  return { pick, unit: Math.max(1, Math.ceil(cat.refPrice * cat.costRatio * mult)) };
}

export interface Delivery {
  qty: number;
  lead: number;
}

/** 缺貨時實際出貨多少、多久送到。長約或高關係的老客人優先供貨。 */
export function deliveryTerms(s: MallState, shop: Shop, pick: Pick, qty: number): Delivery {
  const { def, st } = pick;
  const shock = liveShock(st, s.tick);
  const tier = shockTier(st, s.tick);
  const priority = tier === "contract" || tier === "loyal";
  const hit = shock && shock.kind !== "price_spike" ? shock : null;
  const short = !!hit || (st.status === "shortage" && st.statusUntil > s.tick);
  // 全服衝擊：供貨比例看關係與長約；其他（舊的單店事件）缺貨沿用固定比例
  const fill = hit ? shockFill(hit.fill, tier) : short && !priority ? SHORTAGE_FILL : 1;
  let lead = SUPPLY_LEAD_TICKS * def.lead * (short ? 1.6 : 1);
  // 可靠度低的供應商偶爾會延遲（由種子決定，所以可重現）
  const roll = createRng(hash32(s.seed ^ 0x7a11, s.tick * 31 + (Number(shop.id.replace(/\D/g, "")) || 0))).next();
  if (roll < (1 - def.reliability) * 0.4) lead *= 1.6;
  return { qty: Math.max(0, Math.round(qty * fill)), lead: Math.round(lead) };
}

/** 下單成交後的關係變化 */
export function recordOrder(s: MallState, pick: Pick): void {
  pick.st.orders++;
  pick.st.relationship = clamp(pick.st.relationship + (pick.spot ? REL_PER_ORDER / 2 : REL_PER_ORDER), 0, 100);
  void s;
}

/** 每天、每種貨品、每種狀況最多提醒一次（輕微的提醒不會擋掉更嚴重的） */
export function warnSupplyTrouble(s: MallState, family: SupplyFamily, level: "short" | "spot" | "none", text: string): void {
  const key = `supplywarn:${family}:${level}`;
  if ((s.cooldowns[key] ?? 0) > s.tick) return;
  s.cooldowns[key] = s.tick + 288;
  addLog(s, "warn", text);
  note(s, text);
}

// ───────── 每個 tick／每天的維護 ─────────

/** 補上舊存檔沒有的供應商與家族（供應商名單擴充後，冪等） */
export function syncSupply(s: MallState): void {
  if (s.supply.suppliers.length === SUPPLIERS.length && FAMILY_ORDER.every((f) => s.supply.choice[f])) return;
  const have = new Set(s.supply.suppliers.map((x) => x.id));
  for (const def of SUPPLIERS) if (!have.has(def.id)) s.supply.suppliers.push(newSupplierState(def));
  for (const fam of FAMILY_ORDER) {
    if (s.supply.choice[fam]) continue;
    const first = SUPPLIERS.find((x) => x.family === fam && !x.hidden);
    if (first) s.supply.choice[fam] = first.id;
  }
}

/** 這家供應商出事，對這座商場有沒有實際影響（主力、有訂過貨、或有長約才會被通知） */
function shockMatters(s: MallState, st: SupplierState, def: SupplierDef | undefined): boolean {
  if (!def || !st.discovered) return false;
  return s.supply.choice[def.family] === st.id || st.orders > 0 || hasContract(st, s.tick);
}

/** 套用全服供應衝擊：預告→生效→結束。排程是伺服器 tick 的純函式（見 shared/supplyShock.ts） */
function applyShocks(s: MallState): void {
  if (s.flags.noWorldShocks) return; // 測試與隔離環境可以關掉全服衝擊
  const act = activeSupplyShocks(s.tick);
  for (const st of s.supply.suppliers) {
    const def = SUPPLIER_BY_ID[st.id];
    const sh = act.get(st.id) ?? null;
    if (sh && st.lastShockId !== sh.id) {
      st.lastShockId = sh.id;
      st.shock = { id: sh.id, kind: sh.kind, warnTick: sh.warnTick, startTick: sh.startTick, endTick: sh.endTick, fill: sh.fill, ...(sh.priceMult ? { priceMult: sh.priceMult } : {}) };
      if (shockMatters(s, st, def)) {
        const k = SHOCK_KINDS[sh.kind];
        if (sh.startTick > s.tick) {
          const text = `${k.icon}【預告】「${def?.name}」${k.warnText}，${Math.max(1, Math.round((sh.startTick - s.tick) / 12))} 小時後可能出貨受影響。`;
          addLog(s, "warn", text);
          note(s, text);
        }
      }
    }
    const cur = st.shock;
    if (!cur) continue;
    if (cur.endTick <= s.tick) {
      if (shockMatters(s, st, def)) addLog(s, "info", `${SHOCK_KINDS[cur.kind].icon}「${def?.name}」${SHOCK_KINDS[cur.kind].endText}。`);
      st.shock = null;
      continue;
    }
    if (cur.startTick > s.tick) continue;
    // 已生效：這家的狀態跟著衝擊走
    if (cur.kind === "price_spike") {
      if (cur.priceMult && st.priceUntil <= s.tick) {
        st.priceMult = cur.priceMult;
        st.priceUntil = cur.endTick;
      }
    } else if (st.status === "ok" || st.status === "shortage") {
      const generic = cur.kind === "bankrupt" ? "closed" : "shortage";
      if (st.status !== generic || st.statusUntil !== cur.endTick) {
        const fresh = st.status === "ok";
        st.status = generic;
        st.statusUntil = cur.endTick;
        if (fresh && shockMatters(s, st, def)) {
          const k = SHOCK_KINDS[cur.kind];
          const text = `${k.icon}「${def?.name}」${k.startText}。`;
          addLog(s, "warn", text);
          note(s, text);
        }
      }
    }
  }
}

export function suppliersTick(s: MallState): void {
  syncSupply(s);
  applyShocks(s);
  for (const st of s.supply.suppliers) {
    if (st.status !== "ok" && st.statusUntil <= s.tick) {
      const def = SUPPLIER_BY_ID[st.id];
      st.status = "ok";
      if (def && st.discovered) addLog(s, "info", `📦 「${def.name}」恢復正常供貨。`);
    }
    if (st.contract && st.contract.untilTick <= s.tick) {
      const def = SUPPLIER_BY_ID[st.id];
      st.contract = null;
      addLog(s, "info", `📑 與「${def?.name}」的長約到期了。`);
      note(s, `與「${def?.name}」的長約到期。`);
    }
    if (st.priceUntil !== 0 && st.priceUntil <= s.tick) {
      st.priceMult = 1;
      st.priceUntil = 0;
    }
  }
}

// ───────── 玩家指令 ─────────

export function chooseSupplier(s: MallState, family: string, supplierId: string): GuestResult {
  const fam = FAMILY_ORDER.find((f) => f === family);
  const def = SUPPLIER_BY_ID[supplierId];
  if (!fam || !def || def.family !== fam) return { ok: false, error: "供應商與貨品不符" };
  const st = supplierState(s, supplierId);
  if (!st?.discovered) return { ok: false, error: "你還不認識這家供應商" };
  if (supplierUnavailable(st, s.tick)) return { ok: false, error: "這家供應商現在不能出貨" };
  const cur = chosenSupplier(s, fam);
  if (cur?.def.id === supplierId) return { ok: false, error: "他已經是主力供應商了" };
  if (cur && hasContract(cur.st, s.tick)) return { ok: false, error: `要先和「${cur.def.name}」解約才能換主力` };
  const free = !!cur && (supplierUnavailable(cur.st, s.tick) || !!liveShock(cur.st, s.tick)); // 現任出不了貨或正受全服衝擊，換人不收費
  const fee = free ? 0 : SUPPLIER_SWITCH_FEE;
  if (s.funds < fee) return { ok: false, error: "資金不足" };
  s.funds -= fee;
  s.today.purchases += fee;
  s.supply.choice[fam] = supplierId;
  addLog(s, "info", `📦 ${SUPPLY_FAMILIES[fam].name}的主力供應商換成「${def.name}」。`);
  return { ok: true, note: `改向「${def.name}」進貨${fee ? `（轉換費 ${money(fee)}）` : "。"}` };
}

export function signContract(s: MallState, supplierId: string, days: number): GuestResult {
  const def = SUPPLIER_BY_ID[supplierId];
  const st = supplierState(s, supplierId);
  if (!def || !st) return { ok: false, error: "找不到這家供應商" };
  if (!(CONTRACT_DAYS as readonly number[]).includes(days)) return { ok: false, error: "合約天數無效" };
  if (s.supply.choice[def.family] !== supplierId) return { ok: false, error: "只能和主力供應商簽長約" };
  if (hasContract(st, s.tick)) return { ok: false, error: "已經有長約了" };
  if (st.relationship < CONTRACT_MIN_REL) return { ok: false, error: `關係值要達到 ${CONTRACT_MIN_REL} 才能簽長約` };
  if (st.status !== "ok") return { ok: false, error: "供應商現在狀況不穩，等恢復再簽" };
  st.contract = { lockedMult: supplierMarketPrice(s, st, def), untilTick: s.tick + days * 288 };
  addLog(s, "info", `📑 與「${def.name}」簽下 ${days} 個遊戲日的長約，鎖定價格。`);
  return { ok: true, note: `和「${def.name}」簽了 ${days} 天的長約。` };
}

export function cancelContract(s: MallState, supplierId: string): GuestResult {
  const def = SUPPLIER_BY_ID[supplierId];
  const st = supplierState(s, supplierId);
  if (!def || !st || !hasContract(st, s.tick)) return { ok: false, error: "沒有進行中的長約" };
  if (s.funds < CONTRACT_CANCEL_FEE) return { ok: false, error: "資金不足以支付違約金" };
  s.funds -= CONTRACT_CANCEL_FEE;
  s.today.purchases += CONTRACT_CANCEL_FEE;
  st.contract = null;
  st.relationship = Math.max(0, st.relationship - 8);
  addLog(s, "warn", `📑 提前解除與「${def.name}」的長約（違約金 ${money(CONTRACT_CANCEL_FEE)}）。`);
  return { ok: true, note: "已解約，付了違約金，對方也有點不開心。" };
}

// ───────── 事件造成的戲劇（白名單效果的實作） ─────────

function mainOf(s: MallState, family: SupplyFamily) {
  return chosenSupplier(s, family);
}

/** 關係最好的那家主力供應商（只算有在使用的貨品） */
export function bestMain(s: MallState): { family: SupplyFamily; def: SupplierDef; st: SupplierState } | null {
  let best: { family: SupplyFamily; def: SupplierDef; st: SupplierState } | null = null;
  for (const family of FAMILY_ORDER) {
    if (familyShopCount(s, family) === 0) continue;
    const m = mainOf(s, family);
    if (m && (!best || m.st.relationship > best.st.relationship)) best = { family, ...m };
  }
  return best;
}

function targetOf(s: MallState, family: SupplyFamily | "best") {
  if (family === "best") return bestMain(s);
  const m = mainOf(s, family);
  return m ? { family, ...m } : null;
}

export function applySupplierStatus(s: MallState, family: SupplyFamily, status: Exclude<SupplierState["status"], "ok">, ticks: number, which: "main" | "other" = "main"): void {
  const main = mainOf(s, family);
  let target: { def: SupplierDef; st: SupplierState } | null = main;
  if (which === "other") {
    target = null;
    for (const def of SUPPLIERS) {
      if (def.family !== family || def.id === main?.def.id) continue;
      const st = supplierState(s, def.id);
      if (st?.discovered) {
        target = { def, st };
        break;
      }
    }
  }
  if (!target) return;
  target.st.status = status;
  target.st.statusUntil = s.tick + clamp(ticks, 1, 288 * 10);
  if (status === "cold") target.st.relationship = Math.max(0, target.st.relationship - 20);
  const label = { shortage: "出貨吃緊", strike: "罷工中", closed: "倒閉了", cold: "和你鬧翻了" }[status];
  addLog(s, "warn", `📦 「${target.def.name}」${label}。`);
  note(s, `「${target.def.name}」${label}。`);
}

export function applySupplierPrice(s: MallState, family: SupplyFamily | "best", mult: number, ticks: number): void {
  const t = targetOf(s, family);
  if (!t) return;
  t.st.priceMult = clamp(mult, 0.5, 2);
  t.st.priceUntil = s.tick + clamp(ticks, 1, 288 * 10);
  addLog(s, "info", `📦 「${t.def.name}」${mult >= 1 ? "調漲" : "給你特別優惠"}：價格 ×${mult.toFixed(2)}。`);
}

export function applySupplierRel(s: MallState, family: SupplyFamily | "best", amount: number): void {
  const t = targetOf(s, family);
  if (t) t.st.relationship = clamp(t.st.relationship + clamp(amount, -30, 30), 0, 100);
}

/** 改向最划算的備用供應商（不收費；費用由事件選項的 funds 效果決定） */
export function applySupplierSwitch(s: MallState, family: SupplyFamily): void {
  const cur = mainOf(s, family);
  let best: SupplierDef | null = null;
  for (const def of SUPPLIERS) {
    if (def.family !== family || def.id === cur?.def.id) continue;
    const st = supplierState(s, def.id);
    if (!st?.discovered || supplierUnavailable(st, s.tick)) continue;
    // 價格便宜、品質好、可靠的優先
    const score = (d: SupplierDef) => d.price - d.quality * 0.3 - d.reliability * 0.2;
    if (!best || score(def) < score(best)) best = def;
  }
  if (!best) return;
  if (cur?.st.contract) cur.st.contract = null; // 事件造成的改換，視為對方違約，不罰你
  s.supply.choice[family] = best.id;
  addLog(s, "info", `📦 ${SUPPLY_FAMILIES[family].name}的主力供應商換成「${best.name}」。`);
}

/** 談判：關係夠好就取消漲價，否則只讓一半 */
export function applySupplierNegotiate(s: MallState, family: SupplyFamily): void {
  const m = mainOf(s, family);
  if (!m || m.st.priceUntil <= s.tick || m.st.priceMult <= 1) return;
  if (m.st.relationship >= 50) {
    m.st.priceMult = 1;
    m.st.priceUntil = 0;
    addLog(s, "info", `📦 看在長年交情，「${m.def.name}」同意不漲價了。`);
  } else {
    m.st.priceMult = 1 + (m.st.priceMult - 1) / 2;
    addLog(s, "info", `📦 談了半天，「${m.def.name}」只肯少漲一半。`);
  }
}

export function applySupplierDiscover(s: MallState, rng: Rng): void {
  const hidden = s.supply.suppliers.filter((x) => !x.discovered);
  const st = hidden[rng.int(0, hidden.length - 1)];
  if (!st) return;
  st.discovered = true;
  st.relationship = 5;
  const def = SUPPLIER_BY_ID[st.id];
  addLog(s, "info", `🆕 新的供應商「${def?.name}」留下了報價單（${SUPPLY_FAMILIES[def?.family ?? "goods"].name}）。`);
  note(s, `新供應商「${def?.name}」登場。`);
}

export function applyFamilyFreshness(s: MallState, family: SupplyFamily, amount: number): void {
  for (const shop of s.shops) {
    if (shop.mode === "direct" && FAMILY_OF[shop.category] === family) shop.freshness = clamp(shop.freshness + clamp(amount, -30, 30), 0, 100);
  }
}
