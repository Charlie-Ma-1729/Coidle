import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  CAMPAIGNS,
  CONTRACT_CANCEL_FEE,
  CONTRACT_MIN_REL,
  EVENTS,
  EVENT_BY_ID,
  FAMILY_OF,
  FAMILY_ORDER,
  PRIORITY_REL,
  RIVALS,
  RIVAL_AUTO_AGGRESSIVE_COST,
  RIVAL_AUTO_DEFENSE_COST,
  RIVAL_COUNTER_COST,
  RIVAL_INTEL_COST,
  RIVAL_PACT_COST,
  SHORTAGE_FILL,
  SPOT_PREMIUM,
  SUPPLIERS,
  SUPPLIER_BY_ID,
  SUPPLIER_SWITCH_FEE,
  PERSONA_IDS,
  TICKS_PER_DAY,
  TICK_MINUTES,
  categoryHasStock,
  chosenSupplier,
  consumableCostMult,
  RUSH_PREMIUM,
  restockPlan,
  storageCap,
  shockFill,
  shocksStartingOnDay,
  type WorldShock,
  playerAppeal,
  relDiscount,
  rivalAppealNow,
  rivalMult,
  rivalScore,
  supplierCostMult,
  supplierPriceNow,
  supplierQualityFactor,
  supplierState,
  type MallState,
  type PersonaId,
} from "@coidle/shared";
import { advanceTo, applyCommand, createInitialState, migrateState, stepTick, type Command } from "./sim";
import { applyEffects, spawnEvent } from "./sim/events";
import { createRng } from "./sim/rng";
import { rivalsTick } from "./sim/rivals";
import { inventoryDaily } from "./sim/inventory";
import { deliveryTerms, pickAlternative, pickSupplier, quoteOrder, suppliersTick } from "./sim/suppliers";
import { placeOrder } from "./sim/step";

const START = (Date.UTC(2027, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
const DAY = TICKS_PER_DAY;

const must = (r: ReturnType<typeof applyCommand>): MallState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const apply = (s: MallState, c: Command) => must(applyCommand(s, c));
const fails = (s: MallState, c: Command) => !applyCommand(s, c).ok;
const shopOf = (s: MallState, category: string) => s.shops.find((x) => x.category === category)!;
const sup = (s: MallState, id: string) => supplierState(s, id)!;

/** 排除干擾：把稽查、對手的下一次動作都排很遠 */
function quiet(s: MallState): MallState {
  s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
  for (const id of Object.keys(s.rivals.nextAt)) s.rivals.nextAt[id] = s.tick + 10_000_000;
  return s;
}

describe("supplier data", () => {
  it("every category on every floor has a supply family (services buy consumables)", () => {
    for (const c of CATEGORIES) expect(FAMILY_OF[c.id], c.id).toBeDefined();
    for (const fam of Object.values(FAMILY_OF)) expect(FAMILY_ORDER).toContain(fam);
    // 每個區域都有業態用到供應商
    const zones = new Set(CATEGORIES.map((c) => c.zone));
    expect(zones.size).toBe(8);
  });

  it("each family has several visible suppliers plus one hidden newcomer", () => {
    const ids = new Set<string>();
    for (const fam of FAMILY_ORDER) {
      const list = SUPPLIERS.filter((x) => x.family === fam);
      expect(list.filter((x) => !x.hidden).length).toBeGreaterThanOrEqual(3);
      expect(list.filter((x) => x.hidden).length).toBe(1);
      for (const x of list) {
        expect(ids.has(x.id)).toBe(false);
        ids.add(x.id);
        expect(x.price).toBeGreaterThan(0.7);
        expect(x.price).toBeLessThan(1.4);
        expect(x.quality).toBeGreaterThan(0.4);
        expect(x.reliability).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a new mall starts with a main supplier per family and the newcomers undiscovered", () => {
    const s = createInitialState(1, START);
    for (const fam of FAMILY_ORDER) {
      const c = chosenSupplier(s, fam);
      expect(c).not.toBeNull();
      expect(c!.def.hidden).toBeFalsy();
      expect(c!.def.price).toBe(1); // 起手都是「標準價」的老牌供應商
    }
    expect(s.supply.suppliers.filter((x) => !x.discovered)).toHaveLength(FAMILY_ORDER.length);
    expect(s.supply.autoFallback).toBe(true);
  });

  it("relationship discount tiers", () => {
    expect(relDiscount(10)).toBe(1);
    expect(relDiscount(50)).toBe(0.95);
    expect(relDiscount(80)).toBe(0.9);
  });
});

describe("ordering from suppliers", () => {
  it("starting prices match the old flat cost model (no surprise inflation)", () => {
    const s = createInitialState(1, START);
    const q = quoteOrder(s, shopOf(s, "kushikatsu"), 1)!;
    expect(q.unit).toBe(Math.ceil(CATEGORY_BY_ID.kushikatsu!.refPrice * 0.35));
    expect(q.pick.spot).toBe(false);
  });

  it("switching to a pricier supplier raises cost and quality; a cheaper one the opposite", () => {
    let s = createInitialState(1, START);
    const base = supplierCostMult(s, "kushikatsu");
    const baseQ = supplierQualityFactor(s, "kushikatsu");
    s.funds = 1_000_000;
    const kuro = apply(s, { type: "chooseSupplier", family: "meat", supplierId: "meat_kuro" });
    expect(supplierCostMult(kuro, "kushikatsu")).toBeGreaterThan(base);
    expect(supplierQualityFactor(kuro, "kushikatsu")).toBeGreaterThan(baseQ);
    const yama = apply(s, { type: "chooseSupplier", family: "meat", supplierId: "meat_yama" });
    expect(supplierCostMult(yama, "kushikatsu")).toBeLessThan(base);
    expect(supplierQualityFactor(yama, "kushikatsu")).toBeLessThan(baseQ);
  });

  it("orders strengthen the relationship, which earns discounts and shortage priority", () => {
    const s = createInitialState(1, START);
    s.funds = 100_000_000;
    const shop = shopOf(s, "kushikatsu");
    const st = sup(s, "meat_maru");
    const r0 = st.relationship;
    for (let i = 0; i < 20; i++) {
      shop.incoming = []; // 倉庫有容量上限，每次下單前先清空在途
      placeOrder(s, shop, 50);
    }
    expect(st.relationship).toBeGreaterThan(r0);
    expect(st.orders).toBe(20);
    st.relationship = 85;
    expect(supplierPriceNow(s, st, SUPPLIER_BY_ID.meat_maru!)).toBeCloseTo(0.9, 5);
    st.status = "shortage";
    st.statusUntil = s.tick + 100;
    const pick = pickSupplier(s, "meat")!;
    expect(deliveryTerms(s, shop, pick, 100).qty).toBe(100); // 高關係：缺貨也全額供貨
    st.relationship = 20;
    expect(deliveryTerms(s, shop, pick, 100).qty).toBe(Math.round(100 * SHORTAGE_FILL));
    expect(PRIORITY_REL).toBe(80);
  });

  it("a shortage delays and cuts deliveries, and the shortfall is not charged", () => {
    const s = createInitialState(1, START);
    s.funds = 10_000_000;
    s.supply.autoFallback = false; // 沒開備援：缺的那 40% 就是缺了、也不收錢
    const shop = shopOf(s, "kushikatsu");
    const st = sup(s, "meat_maru");
    st.status = "shortage";
    st.statusUntil = s.tick + 200;
    const funds = s.funds;
    const incoming = shop.incoming.length;
    expect(placeOrder(s, shop, 100)).toBe(true);
    const delivered = shop.incoming[incoming]!;
    expect(delivered.qty).toBe(60);
    expect(delivered.arriveTick - s.tick).toBeGreaterThan(36); // 比平常慢
    const unit = quoteOrder(s, shop, 1)!.unit;
    expect(funds - s.funds).toBe(unit * 60);
    expect(s.log.some((l) => l.text.includes("出貨吃緊"))).toBe(true);
  });

  it("a strike makes the main supplier unavailable: backup spot supplier costs 10% more, or no order at all without fallback", () => {
    let s = createInitialState(1, START);
    s.funds = 10_000_000;
    const shop = shopOf(s, "kushikatsu");
    sup(s, "meat_maru").status = "strike";
    sup(s, "meat_maru").statusUntil = s.tick + 300;
    const q = quoteOrder(s, shop, 1)!;
    expect(q.pick.spot).toBe(true);
    expect(q.pick.def.id).not.toBe("meat_maru");
    const normalUnit = Math.ceil(CATEGORY_BY_ID.kushikatsu!.refPrice * 0.35 * q.pick.def.price);
    expect(q.unit).toBeGreaterThanOrEqual(normalUnit); // 加了現貨溢價
    expect(q.unit).toBe(Math.ceil(CATEGORY_BY_ID.kushikatsu!.refPrice * 0.35 * q.pick.def.price * SPOT_PREMIUM));
    expect(placeOrder(s, shop, 50)).toBe(true);

    s = apply(s, { type: "setSupplyPrefs", autoFallback: false });
    const before = shop.incoming.length;
    const s2 = structuredClone(s);
    expect(placeOrder(s2, shopOf(s2, "kushikatsu"), 50)).toBe(false);
    expect(shopOf(s2, "kushikatsu").incoming.length).toBe(before);
    expect(s2.log.some((l) => l.text.includes("進不到貨"))).toBe(true);
  });

  it("with every alternative also down, ordering is impossible", () => {
    const s = createInitialState(1, START);
    for (const x of s.supply.suppliers) {
      if (SUPPLIER_BY_ID[x.id]!.family === "meat" && x.discovered) {
        x.status = "strike";
        x.statusUntil = s.tick + 500;
      }
    }
    expect(quoteOrder(s, shopOf(s, "kushikatsu"), 1)).toBeNull();
  });

  it("auto-restock keeps going through a supplier strike thanks to the backup", () => {
    let s = quiet(createInitialState(2, START));
    sup(s, "meat_maru").status = "strike";
    sup(s, "meat_maru").statusUntil = s.tick + 288 * 6;
    s.shops.forEach((x) => (x.stock = 0));
    s = advanceTo(s, START + 12 * 24);
    expect(shopOf(s, "kushikatsu").stock + shopOf(s, "kushikatsu").incoming.reduce((a, b) => a + b.qty, 0)).toBeGreaterThan(0);
  });
});

describe("choosing suppliers and contracts", () => {
  it("switching costs a fee, but is free when the current one cannot deliver", () => {
    const s = createInitialState(1, START);
    const funds = s.funds;
    const r = apply(s, { type: "chooseSupplier", family: "meat", supplierId: "meat_yama" });
    expect(r.funds).toBe(funds - SUPPLIER_SWITCH_FEE);
    expect(r.supply.choice.meat).toBe("meat_yama");
    sup(s, "meat_maru").status = "closed";
    sup(s, "meat_maru").statusUntil = s.tick + 500;
    expect(apply(s, { type: "chooseSupplier", family: "meat", supplierId: "meat_yama" }).funds).toBe(funds);
  });

  it("rejects bad switches: unknown, mismatched family, undiscovered, same, unavailable, poor", () => {
    const s = createInitialState(1, START);
    expect(fails(s, { type: "chooseSupplier", family: "meat", supplierId: "nope" })).toBe(true);
    expect(fails(s, { type: "chooseSupplier", family: "meat", supplierId: "sea_naniwa" })).toBe(true);
    expect(fails(s, { type: "chooseSupplier", family: "nope", supplierId: "meat_yama" })).toBe(true);
    expect(fails(s, { type: "chooseSupplier", family: "meat", supplierId: "meat_import" })).toBe(true); // 還沒發現
    expect(fails(s, { type: "chooseSupplier", family: "meat", supplierId: "meat_maru" })).toBe(true); // 已經是主力
    const down = structuredClone(s);
    sup(down, "meat_yama").status = "strike";
    sup(down, "meat_yama").statusUntil = down.tick + 100;
    expect(fails(down, { type: "chooseSupplier", family: "meat", supplierId: "meat_yama" })).toBe(true);
    const poor = structuredClone(s);
    poor.funds = 100;
    expect(fails(poor, { type: "chooseSupplier", family: "meat", supplierId: "meat_yama" })).toBe(true);
  });

  it("a long contract needs a good relationship, locks the price against hikes and gives shortage priority", () => {
    let s = createInitialState(1, START);
    expect(fails(s, { type: "signContract", supplierId: "meat_maru", days: 7 })).toBe(true); // 關係不夠
    sup(s, "meat_maru").relationship = CONTRACT_MIN_REL;
    expect(fails(s, { type: "signContract", supplierId: "meat_yama", days: 7 })).toBe(true); // 不是主力
    expect(fails(s, { type: "signContract", supplierId: "meat_maru", days: 3 })).toBe(true); // 天數無效
    s = apply(s, { type: "signContract", supplierId: "meat_maru", days: 7 });
    expect(sup(s, "meat_maru").contract!.untilTick - s.tick).toBe(7 * DAY);
    expect(fails(s, { type: "signContract", supplierId: "meat_maru", days: 7 })).toBe(true); // 已有長約

    const st = sup(s, "meat_maru");
    const locked = supplierCostMult(s, "kushikatsu");
    st.priceMult = 1.5; // 事件漲價
    st.priceUntil = s.tick + 500;
    expect(supplierCostMult(s, "kushikatsu")).toBeCloseTo(locked, 5); // 鎖價
    st.status = "shortage";
    st.statusUntil = s.tick + 100;
    const pick = pickSupplier(s, "meat")!;
    expect(deliveryTerms(s, shopOf(s, "kushikatsu"), pick, 100).qty).toBe(100); // 優先供貨

    // 有長約時不能換主力；解約要付違約金
    s.funds = 1_000_000;
    expect(fails(s, { type: "chooseSupplier", family: "meat", supplierId: "meat_yama" })).toBe(true);
    const funds = s.funds;
    const cancelled = apply(s, { type: "cancelContract", supplierId: "meat_maru" });
    expect(cancelled.funds).toBe(funds - CONTRACT_CANCEL_FEE);
    expect(sup(cancelled, "meat_maru").contract).toBeNull();
    expect(sup(cancelled, "meat_maru").relationship).toBeLessThan(sup(s, "meat_maru").relationship);
    expect(fails(cancelled, { type: "cancelContract", supplierId: "meat_maru" })).toBe(true);
  });

  it("contracts expire by themselves", () => {
    let s = quiet(createInitialState(1, START));
    sup(s, "meat_maru").relationship = 40;
    s = apply(s, { type: "signContract", supplierId: "meat_maru", days: 7 });
    s = advanceTo(s, s.tick + 7 * DAY + 5);
    expect(sup(s, "meat_maru").contract).toBeNull();
    expect(s.log.some((l) => l.text.includes("長約到期"))).toBe(true);
  });

  it("statuses and temporary prices recover on their own", () => {
    let s = quiet(createInitialState(1, START));
    const st = sup(s, "meat_maru");
    st.status = "strike";
    st.statusUntil = s.tick + 50;
    st.priceMult = 1.4;
    st.priceUntil = s.tick + 50;
    s = advanceTo(s, s.tick + 60);
    expect(sup(s, "meat_maru").status).toBe("ok");
    expect(sup(s, "meat_maru").priceMult).toBe(1);
    expect(s.log.some((l) => l.text.includes("恢復正常供貨"))).toBe(true);
  });
});

describe("supplier drama events", () => {
  const eff = (s: MallState, effects: Parameters<typeof applyEffects>[1]) => applyEffects(s, effects, createRng(1));

  it("status effects hit the main (or another) supplier and clamp their length", () => {
    const s = createInitialState(1, START);
    eff(s, [{ t: "supplierStatus", family: "seafood", status: "shortage", ticks: 99_999 }]);
    expect(sup(s, "sea_naniwa").status).toBe("shortage");
    expect(sup(s, "sea_naniwa").statusUntil - s.tick).toBeLessThanOrEqual(288 * 10);
    eff(s, [{ t: "supplierStatus", family: "meat", status: "cold", ticks: 100, which: "other" }]);
    const colds = s.supply.suppliers.filter((x) => x.status === "cold");
    expect(colds).toHaveLength(1);
    expect(colds[0]!.id).not.toBe("meat_maru");
    expect(sup(s, "meat_maru").status).toBe("ok");
  });

  it("price hikes, negotiation and loyalty discounts", () => {
    const s = createInitialState(1, START);
    eff(s, [{ t: "supplierPrice", family: "grain", mult: 99, ticks: 100 }]);
    expect(sup(s, "grain_yoneda").priceMult).toBe(2); // 夾限
    // 關係差：談判只讓一半
    eff(s, [{ t: "supplierNegotiate", family: "grain" }]);
    expect(sup(s, "grain_yoneda").priceMult).toBeCloseTo(1.5, 5);
    // 關係好：談判直接取消漲價
    sup(s, "grain_yoneda").relationship = 60;
    eff(s, [{ t: "supplierNegotiate", family: "grain" }]);
    expect(sup(s, "grain_yoneda").priceMult).toBe(1);

    // "best"：關係最好的那家主力
    sup(s, "meat_maru").relationship = 90;
    eff(s, [{ t: "supplierPrice", family: "best", mult: 0.9, ticks: 288 }]);
    expect(sup(s, "meat_maru").priceMult).toBe(0.9);
  });

  it("switch effect moves to the best available alternative and ignores unavailable ones", () => {
    const s = createInitialState(1, START);
    // 把其餘備用都弄成不能出貨，只留山下食肉
    for (const id of ["meat_kuro", "meat_ranch", "meat_wholesale"]) {
      sup(s, id).status = "strike";
      sup(s, id).statusUntil = s.tick + 1000;
    }
    eff(s, [{ t: "supplierSwitch", family: "meat" }]);
    expect(s.supply.choice.meat).toBe("meat_yama"); // 唯一可用的備用
    sup(s, "meat_maru").contract = { lockedMult: 1, untilTick: s.tick + 1000 };
    s.supply.choice.meat = "meat_maru";
    eff(s, [{ t: "supplierSwitch", family: "meat" }]);
    expect(sup(s, "meat_maru").contract).toBeNull(); // 事件造成的改換，不罰你
  });

  it("discovering a newcomer unlocks them for switching", () => {
    let s = createInitialState(1, START);
    const hidden = s.supply.suppliers.filter((x) => !x.discovered).length;
    eff(s, [{ t: "supplierDiscover" }]);
    const found = s.supply.suppliers.find((x) => x.discovered && SUPPLIER_BY_ID[x.id]!.hidden)!;
    expect(found).toBeDefined();
    expect(s.supply.suppliers.filter((x) => !x.discovered).length).toBe(hidden - 1);
    const fam = SUPPLIER_BY_ID[found.id]!.family;
    s.funds = 1_000_000;
    s = apply(s, { type: "chooseSupplier", family: fam, supplierId: found.id });
    expect(s.supply.choice[fam]).toBe(found.id);
  });

  it("a scandal lowers the freshness of the shops using that supply", () => {
    const s = createInitialState(1, START);
    eff(s, [{ t: "familyFreshness", family: "produce", amount: -10 }]);
    expect(shopOf(s, "grocery").freshness).toBe(90);
    expect(shopOf(s, "ramen").freshness).toBe(100);
  });

  it("every drama event has a valid default", () => {
    const drama = EVENTS.filter((e) => e.category === "supply" && (e.needsFamily || e.needsUndiscovered));
    expect(drama.length).toBeGreaterThanOrEqual(5);
    for (const e of drama) {
      if (e.choice) expect(e.choice.options.some((o) => o.id === e.choice!.defaultOption), e.id).toBe(true);
    }
    // 罷工、缺貨、倒閉改由全服供應衝擊負責，不再是各商場自己抽的事件
    for (const id of ["seafood_shortage", "meat_strike", "sweets_bankrupt"]) expect(EVENT_BY_ID[id]).toBeUndefined();
  });

  it("running a drama event through its option has the intended effect", () => {
    const s = createInitialState(1, START);
    spawnEvent(s, EVENT_BY_ID.meat_feud!, createRng(1));
    s.funds = 1_000_000;
    const uid = s.pending[0]!.uid;
    const switched = apply(s, { type: "resolveEvent", uid, optionId: "side" });
    expect(switched.funds).toBe(1_000_000 - 15_000);
    expect(switched.supply.choice.meat).not.toBe("meat_maru");
  });
});

describe("world supply shocks", () => {
  const shocksOver = (days: number) => {
    const out: WorldShock[] = [];
    for (let d = 0; d < days; d++) out.push(...shocksStartingOnDay(d));
    return out;
  };

  it("the schedule is deterministic and a pure function of the server tick", () => {
    const a = shocksOver(60).map((x) => `${x.id}:${x.supplierId}:${x.kind}:${x.startTick}`);
    const b = shocksOver(60).map((x) => `${x.id}:${x.supplierId}:${x.kind}:${x.startTick}`);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    for (const x of shocksOver(60)) {
      expect(SUPPLIER_BY_ID[x.supplierId]).toBeDefined();
      expect(x.warnTick).toBeLessThanOrEqual(x.startTick);
      expect(x.endTick).toBeGreaterThan(x.startTick);
      expect(x.fill).toBeGreaterThanOrEqual(0);
      expect(x.fill).toBeLessThanOrEqual(1);
    }
    expect(new Set(shocksOver(200).map((x) => x.kind)).size).toBeGreaterThanOrEqual(6);
  });

  it("every mall that uses the same supplier is hit by the same shock", () => {
    const sh = shocksOver(120).find((x) => x.kind === "strike")!;
    const def = SUPPLIER_BY_ID[sh.supplierId]!;
    const mk = () => {
      const s = quiet(createInitialState(1, sh.startTick - 5));
      s.supply.choice[def.family] = def.id;
      sup(s, def.id).discovered = true;
      s.tick = sh.startTick + 1;
      suppliersTick(s);
      return s;
    };
    const a = mk();
    const b = mk();
    for (const s of [a, b]) {
      expect(sup(s, def.id).shock?.id).toBe(sh.id);
      expect(sup(s, def.id).status).toBe("shortage");
    }
  });

  it("a shock is announced in advance and ends on its own", () => {
    const sh = shocksOver(120).find((x) => x.kind === "strike")!;
    const def = SUPPLIER_BY_ID[sh.supplierId]!;
    const s = quiet(createInitialState(1, sh.warnTick - 2));
    s.supply.choice[def.family] = def.id;
    sup(s, def.id).discovered = true;
    s.tick = sh.warnTick;
    suppliersTick(s);
    expect(sup(s, def.id).shock?.id).toBe(sh.id);
    expect(sup(s, def.id).status).toBe("ok"); // 預告期還能正常出貨
    expect(s.log.some((l) => l.text.includes("預告"))).toBe(true);
    s.tick = sh.endTick + 1;
    suppliersTick(s);
    expect(sup(s, def.id).shock).toBeNull();
    expect(sup(s, def.id).status).toBe("ok");
  });

  it("during a shock, long contracts and good relationships get more of the supply", () => {
    const sh = shocksOver(200).find((x) => x.kind === "strike")!;
    const def = SUPPLIER_BY_ID[sh.supplierId]!;
    const mk = (rel: number, contract: boolean) => {
      const s = quiet(createInitialState(1, sh.startTick));
      s.supply.choice[def.family] = def.id;
      const st = sup(s, def.id);
      st.discovered = true;
      st.relationship = rel;
      if (contract) st.contract = { lockedMult: 1, untilTick: s.tick + 10 * DAY };
      s.tick = sh.startTick + 2;
      suppliersTick(s);
      const shop = s.shops.find((x) => FAMILY_OF[x.category] === def.family) ?? s.shops[0]!;
      return deliveryTerms(s, shop, { def, st, spot: false }, 100).qty;
    };
    const none = mk(5, false);
    const friend = mk(60, false);
    const loyal = mk(90, false);
    const contract = mk(5, true);
    expect(none).toBeLessThan(friend);
    expect(friend).toBeLessThan(loyal);
    expect(loyal).toBeLessThanOrEqual(contract + 30);
    expect(contract).toBeGreaterThan(none);
    expect(none).toBe(Math.round(100 * shockFill(sh.fill, "none")));
  });

  it("services pay more for consumables while their supplier is in trouble", () => {
    const s = quiet(createInitialState(1, START));
    const base = consumableCostMult(s, "clinic");
    const main = chosenSupplier(s, "medical")!;
    main.st.shock = { id: "t", kind: "strike", warnTick: 0, startTick: 0, endTick: s.tick + 100, fill: 0.2 };
    expect(consumableCostMult(s, "clinic")).toBeGreaterThan(base);
    main.st.status = "closed";
    main.st.statusUntil = s.tick + 50;
    expect(consumableCostMult(s, "clinic")).toBeGreaterThan(base * 1.3);
  });

  it("old saves gain the new suppliers and families", () => {
    const s = createInitialState(1, START);
    s.supply.suppliers = s.supply.suppliers.filter((x) => SUPPLIER_BY_ID[x.id]!.family === "meat" || SUPPLIER_BY_ID[x.id]!.family === "seafood");
    s.supply.choice = { meat: "meat_maru", seafood: "sea_naniwa" };
    suppliersTick(s);
    expect(s.supply.suppliers).toHaveLength(SUPPLIERS.length);
    for (const fam of FAMILY_ORDER) expect(s.supply.choice[fam]).toBeDefined();
  });
});

describe("rivals", () => {
  const sumRival = (s: MallState, p: PersonaId) => s.rivals.list.reduce((a, r) => a + rivalAppealNow(r, p, s.tick), 0);

  it("has four distinct rivals with a profile for every persona", () => {
    expect(RIVALS).toHaveLength(4);
    for (const r of RIVALS) {
      for (const p of PERSONA_IDS) expect(r.profile[p]).toBeGreaterThan(0.5);
      for (const k of r.campaigns) expect(CAMPAIGNS[k]).toBeDefined();
    }
  });

  it("a new mall starts competitive but not dominant", () => {
    const s = createInitialState(1, START);
    expect(s.rivals.list).toHaveLength(4);
    for (const p of PERSONA_IDS) {
      const m = rivalMult(s, p);
      expect(m).toBeGreaterThan(0.8);
      expect(m).toBeLessThan(1.25);
    }
    expect(Object.keys(s.rivals.nextAt)).toHaveLength(4);
    for (const t of Object.values(s.rivals.nextAt)) expect(t).toBeGreaterThan(START + 2 * DAY);
  });

  it("a stronger mall draws more of each persona; a rival campaign pulls them away", () => {
    const s = createInitialState(1, START);
    const base = rivalMult(s, "local");
    s.localRep = 90;
    expect(rivalMult(s, "local")).toBeGreaterThan(base);
    s.localRep = 50;
    const harbor = s.rivals.list.find((r) => r.id === "harbor")!;
    harbor.campaign = { kind: "price_war", startTick: s.tick, endTick: s.tick + 100, boost: { ...CAMPAIGNS.price_war.boost }, factor: 1 };
    expect(rivalMult(s, "local")).toBeLessThan(base);
    harbor.campaign.factor = 0.5; // 反制後衝擊減半
    expect(base - rivalMult(s, "local")).toBeLessThan(base - rivalMult(Object.assign(structuredClone(s), { rivals: { ...s.rivals, list: s.rivals.list.map((r) => (r.id === "harbor" ? { ...r, campaign: { ...harbor.campaign!, factor: 1 } } : r)) } }), "local"));
    // 夾限
    s.localRep = 0;
    s.touristHeat = 0;
    expect(rivalMult(s, "tourist")).toBeGreaterThanOrEqual(0.75);
    s.localRep = 100;
    s.touristHeat = 100;
    expect(rivalMult(s, "tourist")).toBeLessThanOrEqual(1.3);
    expect(playerAppeal(s, "local")).toBeLessThanOrEqual(100);
    expect(rivalScore(s.rivals.list[0]!, s.tick)).toBeGreaterThan(0);
  });

  it("rivals launch campaigns on schedule, announce them, end them and reschedule", () => {
    let s = createInitialState(3, START);
    for (const id of Object.keys(s.rivals.nextAt)) s.rivals.nextAt[id] = s.tick + 5;
    s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
    s = advanceTo(s, s.tick + 30);
    const active = s.rivals.list.filter((r) => r.campaign);
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(s.rivals.news.length).toBeGreaterThanOrEqual(1);
    expect(s.log.some((l) => l.text.startsWith("📰"))).toBe(true);
    const longest = Math.max(...active.map((r) => r.campaign!.endTick)) - s.tick;
    s = advanceTo(s, s.tick + longest + 5);
    expect(s.rivals.list.some((r) => r.campaign && r.campaign.endTick > s.tick - 5 && r.campaign.startTick < s.tick - 360)).toBe(false);
    for (const t of Object.values(s.rivals.nextAt)) expect(t).toBeGreaterThan(s.tick - 400);
  });

  it("the stance decides how the mall reacts to a rival's campaign automatically", () => {
    const run = (stance: "defend" | "neutral" | "aggressive", funds = 5_000_000) => {
      let s = createInitialState(3, START);
      s = apply(s, { type: "setRivalStance", stance });
      s.funds = funds;
      s.inspections.nextAt = { hygiene: s.tick + 10_000_000, fire: s.tick + 10_000_000 };
      for (const id of Object.keys(s.rivals.nextAt)) s.rivals.nextAt[id] = s.tick + 10_000_000;
      s.rivals.nextAt.harbor = s.tick;
      const f0 = s.funds;
      const rng = createRng(2);
      s.rivals.list.find((r) => r.id === "harbor")!.pactUntil = 0;
      // 逼它出招：價格戰（把醜聞機率排除，用不同種子直到非醜聞）
      for (let i = 0; i < 40; i++) {
        s.rivals.nextAt.harbor = s.tick;
        s.rivals.list.find((r) => r.id === "harbor")!.campaign = null;
        rivalsTick(s, createRng(i + 10));
        const c = s.rivals.list.find((r) => r.id === "harbor")!.campaign;
        if (c && c.kind !== "scandal") return { c, spent: f0 - s.funds, log: s.log };
      }
      void rng;
      throw new Error("no non-scandal campaign");
    };
    const neutral = run("neutral");
    expect(neutral.c.factor).toBe(1);
    expect(neutral.spent).toBe(0);
    const defend = run("defend");
    expect(defend.c.factor).toBe(0.5);
    expect(defend.spent).toBe(RIVAL_AUTO_DEFENSE_COST);
    const aggressive = run("aggressive");
    expect(aggressive.c.factor).toBe(0.5);
    expect(aggressive.spent).toBe(RIVAL_AUTO_AGGRESSIVE_COST);
    // 沒錢就沒辦法自動應對
    expect(run("defend", 1000).c.factor).toBe(1);
  });

  it("intel, pact and counter cost money and have sensible rules", () => {
    let s = createInitialState(4, START);
    quiet(s);
    const funds = s.funds;
    s = apply(s, { type: "rivalIntel", rivalId: "skyline" });
    expect(s.funds).toBe(funds - RIVAL_INTEL_COST);
    expect(s.rivals.list.find((r) => r.id === "skyline")!.intelUntil).toBeGreaterThan(s.tick);
    expect(fails(s, { type: "rivalIntel", rivalId: "skyline" })).toBe(true);
    expect(fails(s, { type: "rivalIntel", rivalId: "nobody" })).toBe(true);

    s = apply(s, { type: "rivalPact", rivalId: "airport" });
    expect(s.funds).toBe(funds - RIVAL_INTEL_COST - RIVAL_PACT_COST);
    expect(fails(s, { type: "rivalPact", rivalId: "airport" })).toBe(true);
    expect(s.rivals.nextAt.airport).toBeGreaterThanOrEqual(s.rivals.list.find((r) => r.id === "airport")!.pactUntil);
    expect(s.rivals.news[0]!.text).toContain("合作協議");
    // 協議讓你的客流多一點點
    const before = rivalMult(createInitialState(4, START), "tourist");
    expect(rivalMult(s, "tourist")).toBeGreaterThan(before - 0.0001);

    // 反制：對方沒活動時不能反制，有活動時削弱一半且只能一次
    expect(fails(s, { type: "rivalCounter", rivalId: "harbor" })).toBe(true);
    const harbor = s.rivals.list.find((r) => r.id === "harbor")!;
    harbor.campaign = { kind: "price_war", startTick: s.tick, endTick: s.tick + 100, boost: { local: 14 }, factor: 1 };
    const f1 = s.funds;
    s = apply(s, { type: "rivalCounter", rivalId: "harbor" });
    expect(s.funds).toBe(f1 - RIVAL_COUNTER_COST);
    expect(s.rivals.list.find((r) => r.id === "harbor")!.campaign!.factor).toBe(0.5);
    expect(fails(s, { type: "rivalCounter", rivalId: "harbor" })).toBe(true);
    // 對方正在辦活動時簽不了協議
    const gourmet = s.rivals.list.find((r) => r.id === "gourmet")!;
    gourmet.campaign = { kind: "food_fest", startTick: s.tick, endTick: s.tick + 100, boost: { local: 8 }, factor: 1 };
    expect(fails(s, { type: "rivalPact", rivalId: "gourmet" })).toBe(true);
    // 資金不足
    const poor = structuredClone(s);
    poor.funds = 10;
    expect(fails(poor, { type: "rivalIntel", rivalId: "gourmet" })).toBe(true);
    expect(fails(s, { type: "setRivalStance", stance: "yolo" as never })).toBe(true);
  });

  it("rivals grow with your mall level over time", () => {
    let low = createInitialState(5, START);
    quiet(low);
    let high = structuredClone(low);
    high.level = 7;
    low = advanceTo(low, START + 25 * DAY);
    high = advanceTo(high, START + 25 * DAY);
    expect(sumRival(high, "local")).toBeGreaterThan(sumRival(low, "local"));
  });

  it("a long run keeps the economy bounded and the rivals active; catch-up equals tick-by-tick", () => {
    let s = createInitialState(6, START);
    s = advanceTo(s, START + 40 * DAY);
    expect(Number.isFinite(s.funds)).toBe(true);
    expect(s.rivals.news.length).toBeGreaterThanOrEqual(3);
    for (const r of s.rivals.list) for (const p of PERSONA_IDS) expect(r.appeal[p]).toBeGreaterThanOrEqual(10);

    const a = createInitialState(8, START);
    for (const id of Object.keys(a.rivals.nextAt)) a.rivals.nextAt[id] = START + 60;
    const big = advanceTo(a, START + 3 * DAY);
    const b = structuredClone(a);
    for (let i = 0; i < 3 * DAY; i++) stepTick(b);
    expect(b).toEqual(big);
  });
});

describe("migration", () => {
  it("migrates v5 to v6 with suppliers and rivals", () => {
    const v5 = { ...createInitialState(1, 700), version: 5 } as unknown as Record<string, unknown>;
    delete v5.supply;
    delete v5.rivals;
    const m = migrateState(v5, 0);
    expect(m.version).toBe(13);
    expect(m.supply.suppliers).toHaveLength(SUPPLIERS.length);
    expect(m.rivals.list).toHaveLength(4);
    expect(Object.values(m.rivals.nextAt).every((t) => t > 700)).toBe(true);
  });
});

describe("restock and inventory", () => {
  const mk = () => quiet(createInitialState(1, START));
  const incoming = (shop: { incoming: { qty: number }[] }) => shop.incoming.reduce((a, b) => a + b.qty, 0);
  const strike = (s: MallState, id: string, fill = 0.2) => {
    const st = sup(s, id);
    st.shock = { id: "t", kind: "strike", warnTick: s.tick - 10, startTick: s.tick - 1, endTick: s.tick + 1000, fill };
    st.status = "shortage";
    st.statusUntil = s.tick + 1000;
    st.relationship = 5;
  };

  it("orders are capped by the warehouse, and a full warehouse refuses more", () => {
    const s = mk();
    const shop = shopOf(s, "ramen");
    shop.stock = storageCap(shop) - 10;
    shop.incoming = [];
    s.funds = 5_000_000;
    expect(placeOrder(s, shop, 500)).toBe(true);
    expect(shop.stock + incoming(shop)).toBeLessThanOrEqual(storageCap(shop));
    expect(placeOrder(s, shop, 50)).toBe(false);
    expect(shop.level).toBe(1);
    expect(storageCap({ level: 3 })).toBeGreaterThan(storageCap({ level: 1 }));
  });

  it("a short main supplier's gap is filled from a backup when auto-fallback is on", () => {
    const s = mk();
    const shop = shopOf(s, "ramen");
    shop.incoming = [];
    s.funds = 5_000_000;
    strike(s, "grain_yoneda", 0.2);
    expect(placeOrder(s, shop, 200)).toBe(true);
    expect(incoming(shop)).toBe(200);
    expect(shop.incoming.length).toBe(2);
    expect(Object.values(s.supply.suppliers).some((x) => x.id !== "grain_yoneda" && x.orders > 0)).toBe(true);

    const s2 = mk();
    const shop2 = shopOf(s2, "ramen");
    shop2.incoming = [];
    s2.funds = 5_000_000;
    s2.supply.autoFallback = false;
    strike(s2, "grain_yoneda", 0.2);
    placeOrder(s2, shop2, 200);
    expect(incoming(shop2)).toBe(40);
    expect(shop2.day.short).toBe(160);
  });

  it("rush orders cost 30% more and arrive sooner", () => {
    const a = mk();
    const b = mk();
    for (const s of [a, b]) {
      shopOf(s, "ramen").incoming = [];
      s.funds = 5_000_000;
    }
    placeOrder(a, shopOf(a, "ramen"), 100);
    placeOrder(b, shopOf(b, "ramen"), 100, { rush: true });
    const spentA = 5_000_000 - a.funds;
    const spentB = 5_000_000 - b.funds;
    expect(spentB / spentA).toBeGreaterThan(RUSH_PREMIUM - 0.05);
    expect(spentB / spentA).toBeLessThan(RUSH_PREMIUM + 0.05);
    expect(shopOf(b, "ramen").incoming[0]!.arriveTick).toBeLessThan(shopOf(a, "ramen").incoming[0]!.arriveTick);
    // 指令
    const c = mk();
    c.funds = 5_000_000;
    const out = apply(c, { type: "orderStock", shopId: shopOf(c, "ramen").id, qty: 50, rush: true });
    expect(out.log.some((l) => l.text.includes("急件"))).toBe(true);
  });

  it("smart restock plans from daily sales and lead time, and stocks up before a warned shock", () => {
    const s = mk();
    const shop = shopOf(s, "ramen");
    shop.avgDaily = 200;
    expect(restockPlan(s, shop)).toMatchObject({ min: shop.restock.min, target: shop.restock.target }); // 固定規則
    shop.restock.smart = true;
    const base = restockPlan(s, shop);
    expect(base.min).toBeGreaterThan(0);
    expect(base.target).toBeGreaterThan(base.min);
    expect(base.target).toBeLessThanOrEqual(storageCap(shop));
    const st = sup(s, "grain_yoneda");
    st.shock = { id: "w", kind: "strike", warnTick: s.tick, startTick: s.tick + 200, endTick: s.tick + 1200, fill: 0.2 };
    const warned = restockPlan(s, shop);
    expect(warned.target).toBeGreaterThan(base.target);
    expect(warned.notes.join("")).toContain("預告");
    shop.restock.preShock = false;
    expect(restockPlan(s, shop).target).toBe(base.target);
    // 慢慢賣的店備貨少
    shop.avgDaily = 40;
    expect(restockPlan(s, shop).target).toBeLessThan(base.target);
  });

  it("only hoarded stock spoils, perishables fastest, and daily sales average updates", () => {
    const s = mk();
    const shop = shopOf(s, "ramen");
    shop.stock = 100;
    shop.day.units = 100;
    inventoryDaily(s);
    expect(shop.stock).toBe(100); // 正常周轉不壞
    expect(shop.avgDaily).toBe(100);
    shop.stock = 700;
    shop.day.units = 100;
    inventoryDaily(s);
    expect(shop.stock).toBeLessThan(700);
    expect(shop.day.waste).toBeGreaterThan(0);
    expect(shop.avgDaily!).toBeCloseTo(100, 5);
  });

  it("a preferred backup supplier is used for gap fills and fallback; invalid choices are refused", () => {
    const s = mk();
    expect(pickAlternative(s, "grain", "grain_yoneda")?.def.id).not.toBe("grain_roho");
    let t = apply(s, { type: "setSupplyPrefs", backup: { family: "grain", supplierId: "grain_roho" } });
    expect(pickAlternative(t, "grain", "grain_yoneda")?.def.id).toBe("grain_roho");
    expect(fails(t, { type: "setSupplyPrefs", backup: { family: "grain", supplierId: "grain_yoneda" } })).toBe(true); // 主力不能當備用
    expect(fails(t, { type: "setSupplyPrefs", backup: { family: "grain", supplierId: "meat_maru" } })).toBe(true);
    expect(fails(t, { type: "setSupplyPrefs", backup: { family: "grain", supplierId: "grain_organic" } })).toBe(true); // 還不認識
    t = apply(t, { type: "setSupplyPrefs", backup: { family: "grain", supplierId: null } });
    expect(t.supply.backup?.grain).toBeUndefined();
    // 首選備用自己也出事時，改挑別的
    sup(t, "grain_roho").status = "strike";
    sup(t, "grain_roho").statusUntil = t.tick + 100;
    const u = apply(t, { type: "setSupplyPrefs", backup: { family: "grain", supplierId: "grain_roho" } });
    expect(pickAlternative(u, "grain", "grain_yoneda")?.def.id).not.toBe("grain_roho");
  });
});

describe("統一補貨：setRestockMany", () => {
  it("一次把規則套到多間店，出租與無庫存的店會略過，目標低於下限整批拒絕", () => {
    const s0 = createInitialState(1, START);
    const ids = s0.shops.map((x) => x.id);
    const s = apply(s0, { type: "setRestockMany", shopIds: ids, rule: { smart: true, coverDays: 3 } });
    for (const sh of s.shops.filter((x) => x.mode === "direct" && x.restock.smart)) expect(sh.restock.coverDays).toBe(3);
    expect(s.shops.some((x) => x.restock.smart)).toBe(true);
    expect(fails(s0, { type: "setRestockMany", shopIds: ids, rule: { min: 500, target: 100 } })).toBe(true);
    expect(fails(s0, { type: "setRestockMany", shopIds: [], rule: { enabled: false } })).toBe(true);
    expect(fails(s0, { type: "setRestockMany", shopIds: ["nope"], rule: { enabled: false } })).toBe(true);
  });
});
