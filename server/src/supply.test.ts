import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
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
import { deliveryTerms, pickSupplier, quoteOrder } from "./sim/suppliers";
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
  it("every stocked category has a supply family; entertainment and services do not", () => {
    for (const c of CATEGORIES) {
      if (categoryHasStock(c)) expect(FAMILY_OF[c.id], c.id).toBeDefined();
      else expect(FAMILY_OF[c.id], c.id).toBeUndefined();
    }
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
    expect(q.unit).toBe(Math.ceil(1500 * 0.35)); // 525
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
    for (let i = 0; i < 20; i++) placeOrder(s, shop, 50);
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
    const normalUnit = Math.ceil(1500 * 0.35 * q.pick.def.price);
    expect(q.unit).toBeGreaterThanOrEqual(normalUnit); // 加了現貨溢價
    expect(q.unit).toBe(Math.ceil(1500 * 0.35 * q.pick.def.price * SPOT_PREMIUM));
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
    sup(s, "meat_kuro").status = "strike";
    sup(s, "meat_kuro").statusUntil = s.tick + 1000;
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

  it("every drama event has a valid default, and shortages/strikes/bankruptcies pause the clock when nobody is around", () => {
    const drama = EVENTS.filter((e) => e.category === "supply" && (e.needsFamily || e.needsUndiscovered));
    expect(drama.length).toBeGreaterThanOrEqual(8);
    for (const e of drama) {
      if (e.choice) expect(e.choice.options.some((o) => o.id === e.choice!.defaultOption), e.id).toBe(true);
    }
    for (const id of ["seafood_shortage", "meat_strike", "sweets_bankrupt"]) expect(EVENT_BY_ID[id]!.attention, id).toBe("pause");
  });

  it("running a drama event through its default option has the intended effect", () => {
    const s = createInitialState(1, START);
    spawnEvent(s, EVENT_BY_ID.seafood_shortage!, createRng(1));
    expect(s.pending.some((p) => p.defId === "seafood_shortage")).toBe(true);
    const out = apply(s, { type: "resolveAllDefault" });
    expect(sup(out, "sea_naniwa").status).toBe("shortage");
    const s2 = createInitialState(1, START);
    spawnEvent(s2, EVENT_BY_ID.meat_strike!, createRng(1));
    s2.funds = 1_000_000;
    const uid = s2.pending[0]!.uid;
    const switched = apply(s2, { type: "resolveEvent", uid, optionId: "switch" });
    expect(switched.funds).toBe(1_000_000 - 15_000);
    expect(switched.supply.choice.meat).not.toBe("meat_maru");
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
    expect(m.version).toBe(6);
    expect(m.supply.suppliers).toHaveLength(SUPPLIERS.length);
    expect(m.rivals.list).toHaveLength(4);
    expect(Object.values(m.rivals.nextAt).every((t) => t > 700)).toBe(true);
  });
});
