import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY, TICK_MINUTES, type PublicMallState } from "@coidle/shared";
import { advanceTo, createInitialState } from "../../../server/src/sim";
import { FEATURES, featureIndex, hubVisible, resolveTab, visibleTabs } from "./reveal";

const START = (Date.UTC(2026, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
type Mutable = ReturnType<typeof createInitialState>;

function stateAt(days: number, mutate?: (s: Mutable) => void): PublicMallState {
  let s = createInitialState(7, START);
  s = advanceTo(s, START + days * TICKS_PER_DAY + 30);
  mutate?.(s);
  const { seed: _seed, cooldowns: _cd, ...rest } = s;
  return rest;
}

describe("漸進揭露", () => {
  it("開幕時：核心樞紐都在；世界、科技、招商、稅務、日報、常客先不出現", () => {
    const s = stateAt(0);
    for (const h of ["operate", "guests", "develop", "finance"] as const) expect(hubVisible(s, h)).toBe(true);
    expect(hubVisible(s, "world")).toBe(false);
    expect(visibleTabs(s, "world")).toEqual([]);
    expect(visibleTabs(s, "develop")).toEqual(["workshop"]);
    expect(visibleTabs(s, "finance")).toEqual(["cash"]);
    expect(visibleTabs(s, "guests")).toEqual(["inbox", "walk"]);
    expect(visibleTabs(s, "operate")).toEqual(["hours", "supply", "promo", "facility"]);
  });

  it("商場升級後解鎖：Lv.2 → 科技與世界；Lv.3 → 招商", () => {
    const l2 = stateAt(0, (s) => (s.level = 2));
    expect(visibleTabs(l2, "develop")).toContain("tech");
    expect(visibleTabs(l2, "develop")).not.toContain("leasing");
    expect(hubVisible(l2, "world")).toBe(true);
    expect(visibleTabs(l2, "world")).toEqual(["dir", "rivals", "team"]);

    const l3 = stateAt(0, (s) => (s.level = 3));
    expect(visibleTabs(l3, "develop")).toEqual(["workshop", "tech", "leasing"]);
  });

  it("第一位常客上門後出現常客；第一張帳單後出現稅務；第一份日報後出現日報", () => {
    const met = stateAt(0, (s) => (s.regulars[0]!.met = true));
    expect(visibleTabs(met, "guests")).toContain("regulars");

    const bill = stateAt(0, (s) => s.tax.bills.push({ uid: "b", kind: "property", label: "x", amount: 1, createdTick: 0, dueTick: s.tick + 10, paid: 0, lateFee: 0 }));
    expect(visibleTabs(bill, "finance")).toContain("tax");

    const week = stateAt(2);
    expect(week.reports.length).toBeGreaterThan(0);
    expect(visibleTabs(week, "finance")).toContain("reports");
  });

  it("已有資料的功能一律顯示，即使等級不夠（避免老玩家找不到）", () => {
    const s = stateAt(0, (st) => {
      st.tech.done.push("t_app");
      st.world.alliances.push({ id: 1, partner: "x", endTick: st.tick + 100 });
      st.leasing.renewals.push({ uid: "r", shopId: st.shops[0]!.id, brand: "B", dueTick: st.tick + 50 } as never);
    });
    expect(s.level).toBe(1);
    expect(visibleTabs(s, "develop")).toEqual(["workshop", "tech", "leasing"]);
    expect(hubVisible(s, "world")).toBe(true);
  });

  it("功能旗標強制開啟招商時也會顯示", () => {
    const s = stateAt(0, (st) => (st.flags["feature:lease"] = true));
    expect(visibleTabs(s, "develop")).toContain("leasing");
  });

  it("全部功能索引：列出所有分頁，沒開放的附上解鎖說明", () => {
    const s = stateAt(0);
    const idx = featureIndex(s);
    expect(idx.length).toBe(FEATURES.filter((f) => f.tab !== null).length);
    const tech = idx.find((e) => e.id === "develop.tech")!;
    expect(tech.visible).toBe(false);
    expect(tech.hint).toContain("Lv.2");
    const rivals = idx.find((e) => e.id === "world.rivals")!;
    expect(rivals.visible).toBe(false); // 世界樞紐還沒開放
    expect(rivals.hint).toContain("Lv.2");
    const hours = idx.find((e) => e.id === "operate.hours")!;
    expect(hours.visible).toBe(true);
    expect(hours.hint).toBe("");
    for (const e of idx) expect(e.visible || e.hint.length > 0, `${e.id} 沒開放卻沒有說明`).toBe(true);
  });

  it("resolveTab：想開的分頁不可見時退回第一個可見分頁；樞紐不可見回傳 null", () => {
    const s = stateAt(0);
    expect(resolveTab(s, "develop", "leasing")).toBe("workshop");
    expect(resolveTab(s, "develop", "workshop")).toBe("workshop");
    expect(resolveTab(s, "develop")).toBe("workshop");
    expect(resolveTab(s, "world", "team")).toBeNull();
    expect(resolveTab(stateAt(0, (st) => (st.level = 3)), "develop", "leasing")).toBe("leasing");
  });

  it("每個功能 id 唯一，每個分頁都屬於存在的樞紐", () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    const hubs = new Set(FEATURES.filter((f) => f.tab === null).map((f) => f.id));
    for (const f of FEATURES) expect(hubs.has(f.hub)).toBe(true);
  });
});
