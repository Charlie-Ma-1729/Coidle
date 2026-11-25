import { describe, expect, it } from "vitest";
import { CATEGORY_BY_ID, TICKS_PER_DAY, TICK_MINUTES, registerEvents, type InboxItem, type PublicMallState } from "@coidle/shared";
import { advanceTo, createInitialState } from "../../../server/src/sim";
import { attentionShopId } from "../stage/model";
import { buildAttention, hubBadges, hubOfItem, shopFlagsFrom } from "./attention";

const START = (Date.UTC(2026, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);

type Mutable = ReturnType<typeof createInitialState>;

/** 真實模擬出來的狀態（開幕店面＋推進幾天），可在推進前後改資料 */
function stateAt(days: number, mutate?: (s: Mutable) => void): PublicMallState {
  let s = createInitialState(7, START);
  s = advanceTo(s, START + days * TICKS_PER_DAY + 30);
  mutate?.(s);
  const { seed: _seed, cooldowns: _cd, ...rest } = s;
  return rest;
}

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("buildAttention", () => {
  it("開幕不久：沒有緊急事項，有新手任務；依嚴重度排序", () => {
    const items = buildAttention(stateAt(0));
    expect(items.some((i) => i.severity === "urgent")).toBe(false);
    expect(ids(items)).toContain("starter-quest");
    const order = { urgent: 0, decision: 1, opportunity: 2, info: 3 } as const;
    for (let i = 1; i < items.length; i++) expect(order[items[i]!.severity]).toBeGreaterThanOrEqual(order[items[i - 1]!.severity]);
  });

  it("資金為負 → 緊急，導向財務", () => {
    const items = buildAttention(stateAt(0, (s) => (s.funds = -1000)));
    const it = items.find((i) => i.id === "funds-negative")!;
    expect(it.severity).toBe("urgent");
    expect(it.target).toEqual({ kind: "hub", hub: "finance", tab: "cash" });
    expect(items[0]!.id).toBe("funds-negative");
  });

  it("缺貨的直營餐飲／零售店 → 緊急，導向該店；出租店與其他業態不算", () => {
    const isStocked = (g?: string) => g === "food" || g === "retail";
    let target = "";
    let leased = "";
    let other = "";
    const items = buildAttention(
      stateAt(0, (s) => {
        const sh = s.shops.find((x) => x.mode === "direct" && isStocked(CATEGORY_BY_ID[x.category]?.group))!;
        target = sh.id;
        sh.stock = 0;
        const lease = s.shops.find((x) => x.id !== sh.id && isStocked(CATEGORY_BY_ID[x.category]?.group));
        if (lease) {
          lease.mode = "lease";
          lease.stock = 0;
          leased = lease.id;
        }
        const svc = s.shops.find((x) => x.mode === "direct" && x.id !== sh.id && !isStocked(CATEGORY_BY_ID[x.category]?.group));
        if (svc) {
          svc.stock = 0;
          other = svc.id;
        }
      }),
    );
    const it = items.find((i) => i.id === `stockout:${target}`)!;
    expect(it.severity).toBe("urgent");
    expect(it.target).toEqual({ kind: "shop", shopId: target });
    if (leased) expect(ids(items)).not.toContain(`stockout:${leased}`);
    if (other) expect(ids(items)).not.toContain(`stockout:${other}`);
  });

  it("暫停營業的店 → 緊急；之後不再報缺貨", () => {
    let id = "";
    const items = buildAttention(
      stateAt(0, (s) => {
        const sh = s.shops[0]!;
        id = sh.id;
        sh.closedUntilTick = s.tick + 100;
        sh.stock = 0;
      }),
    );
    expect(ids(items)).toContain(`closed:${id}`);
    expect(ids(items)).not.toContain(`stockout:${id}`);
  });

  it("3 間以上同時暫停營業 → 合併成一項（不逐間洗版）；1–2 間仍逐間列出", () => {
    const some = (n: number) =>
      buildAttention(
        stateAt(0, (s) => {
          for (const sh of s.shops.slice(0, n)) sh.closedUntilTick = s.tick + 30;
        }),
      );
    const two = some(2);
    expect(two.filter((i) => i.id.startsWith("closed:"))).toHaveLength(2);
    expect(ids(two)).not.toContain("closed:many");

    const many = some(4);
    expect(ids(many)).toContain("closed:many");
    expect(many.filter((i) => i.id.startsWith("closed:"))).toHaveLength(1);
    expect(many.find((i) => i.id === "closed:many")!.title).toContain("4 間");
    expect(many.find((i) => i.id === "closed:many")!.severity).toBe("urgent");
  });

  it("待決事件 → 需要你決定，附上時限與預設結果", () => {
    registerEvents([
      {
        id: "ai_attn_test",
        category: "crowd",
        title: "老街聯名小攤",
        text: "測試事件",
        weight: 0.8,
        cooldownTicks: 2000,
        attention: "auto",
        effects: [],
        choice: { deadlineTicks: 288, defaultOption: "o1", options: [{ id: "o1", label: "出資佈置攤位", effects: [] }, { id: "o2", label: "婉拒", effects: [] }] },
      },
    ]);
    const items = buildAttention(stateAt(0, (s) => s.pending.push({ uid: "p1", defId: "ai_attn_test", deadlineTick: s.tick + 36 })));
    const it = items.find((i) => i.id === "event:p1")!;
    expect(it.severity).toBe("decision");
    expect(it.target).toEqual({ kind: "event", uid: "p1" });
    expect(it.detail).toContain("出資佈置攤位");
  });

  it("客訴與評價：前 4 項逐一列出，其餘併成一項；客訴比評價急", () => {
    const mk = (i: number, kind: InboxItem["kind"], shopId: string | null): InboxItem => ({ uid: `i${i}`, kind, createdTick: 0, deadlineTick: 100 + i, shopId, persona: "local" as never, text: `第 ${i} 則`, cause: undefined });
    let shopId = "";
    const items = buildAttention(
      stateAt(0, (s) => {
        shopId = s.shops[0]!.id;
        s.inbox = [mk(0, "complaint", shopId), mk(1, "review", null), mk(2, "complaint", null), mk(3, "complaint", null), mk(4, "complaint", null), mk(5, "complaint", null)];
      }),
    );
    const inbox = items.filter((i) => i.id.startsWith("inbox:"));
    expect(inbox).toHaveLength(5); // 4 項 + 「還有 N 件」
    expect(ids(items)).toContain("inbox:more");
    expect(items.find((i) => i.id === "inbox:i0")!.target).toEqual({ kind: "shop", shopId });
    expect(items.find((i) => i.id === "inbox:i1")!.severity).toBe("opportunity");
    expect(items.find((i) => i.id === "inbox:i2")!.severity).toBe("decision");
  });

  it("菜單太老氣的直營店 → 需要你決定；髒與設備舊也會提醒", () => {
    let id = "";
    const items = buildAttention(
      stateAt(0, (s) => {
        const sh = s.shops.find((x) => x.mode === "direct")!;
        id = sh.id;
        sh.freshness = 10;
        s.cleanliness = 20;
        s.equipment = 20;
      }),
    );
    expect(ids(items)).toEqual(expect.arrayContaining([`stale:${id}`, "dirty", "worn"]));
  });

  it("逾期帳單 → 緊急；30 天內付不起 → 需要決定（逾期時不重複）", () => {
    const overdue = buildAttention(
      stateAt(0, (s) => s.tax.bills.push({ uid: "b1", kind: "property", label: "固定資產稅", amount: 5000, createdTick: 0, dueTick: s.tick - 5, paid: 0, lateFee: 0 })),
    );
    expect(overdue.find((i) => i.id === "bills-overdue")!.severity).toBe("urgent");
    expect(ids(overdue)).not.toContain("bills-soon");

    const soon = buildAttention(
      stateAt(0, (s) => {
        s.funds = 100;
        s.tax.bills.push({ uid: "b2", kind: "property", label: "固定資產稅", amount: 900_000, createdTick: 0, dueTick: s.tick + 100, paid: 0, lateFee: 0 });
      }),
    );
    expect(ids(soon)).toContain("bills-soon");
  });

  it("團隊事件：沒給使用者就不顯示；還沒認領才顯示；認領後消失", () => {
    const withEvent = (contrib: string[]) =>
      stateAt(0, (s) => {
        s.meta.team.event = { uid: "t1", defId: "team_typhoon", startTick: s.tick, deadlineTick: s.tick + 500, needed: 2, contributions: contrib.map((a) => ({ taskId: "sign", actorId: a, name: a, tick: s.tick })) };
      });
    expect(ids(buildAttention(withEvent([])))).not.toContain("team-event");
    expect(ids(buildAttention(withEvent([]), 5))).toContain("team-event");
    expect(ids(buildAttention(withEvent(["5"]), 5))).not.toContain("team-event");
  });

  it("每個項目都有穩定、唯一的 id 與可用的 target", () => {
    const items = buildAttention(
      stateAt(0, (s) => {
        s.funds = -5;
        s.cleanliness = 10;
        s.shops[0]!.stock = 0;
      }),
    );
    expect(new Set(ids(items)).size).toBe(items.length);
    for (const it of items) {
      expect(it.title.length).toBeGreaterThan(0);
      expect(it.cta.length).toBeGreaterThan(0);
    }
    expect(ids(buildAttention(stateAt(0)))).toEqual(ids(buildAttention(stateAt(0))));
  });
});

describe("hubBadges / hubOfItem / shopFlagsFrom", () => {
  it("只算緊急與需要決定；機會與資訊不加徽章", () => {
    const items = buildAttention(stateAt(0, (s) => (s.cleanliness = 10)));
    const b = hubBadges(items);
    expect(b.operate).toBeGreaterThanOrEqual(1);
    const total = Object.values(b).reduce((a, c) => a + (c ?? 0), 0);
    const counted = items.filter((i) => (i.severity === "urgent" || i.severity === "decision") && hubOfItem(i) !== null).length;
    expect(total).toBe(counted);
  });

  it("hubOfItem：客訴屬於客人、稽查屬於營運、選單類屬於全域", () => {
    expect(hubOfItem({ id: "x", severity: "decision", icon: "face", title: "", cta: "", target: { kind: "shop", shopId: "s" } })).toBe("guests");
    expect(hubOfItem({ id: "x", severity: "decision", icon: "box", title: "", cta: "", target: { kind: "shop", shopId: "s" } })).toBe("operate");
    expect(hubOfItem({ id: "x", severity: "decision", icon: "event", title: "", cta: "", target: { kind: "inspection", uid: "u" } })).toBe("operate");
    expect(hubOfItem({ id: "x", severity: "opportunity", icon: "quest", title: "", cta: "", target: { kind: "menu", page: "help" } })).toBeNull();
  });

  it("shopFlagsFrom：把缺貨／暫停／客訴／老氣對應回店，給場景氣泡用", () => {
    let a = "";
    let b = "";
    const items = buildAttention(
      stateAt(0, (s) => {
        a = s.shops[0]!.id;
        b = s.shops[1]!.id;
        s.shops[0]!.closedUntilTick = s.tick + 50;
        s.shops[1]!.freshness = 5;
        s.inbox = [{ uid: "c1", kind: "complaint", createdTick: 0, deadlineTick: 99, shopId: b, persona: "local" as never, text: "太慢", cause: undefined }];
      }),
    );
    const m = shopFlagsFrom(items);
    expect(m.get(a)?.has("broken")).toBe(true);
    expect(m.get(b)?.has("stale")).toBe(true);
    expect(m.get(b)?.has("complaint")).toBe(true);
    for (const it of items) if (it.target.kind === "shop") expect(attentionShopId(it)).toBe(it.target.shopId);
  });
});

describe("跨商場待辦", () => {
  const NOW = 1_800_000_000_000;

  it("待回覆的聯名邀請 → 需要決定，導向世界 → 名錄，並算進世界樞紐徽章", () => {
    const items = buildAttention(stateAt(0), 1, [{ id: 5, partnerName: "月見百貨", until: NOW + 5 * 3_600_000 }], NOW);
    const it = items.find((i) => i.id === "alliance:5")!;
    expect(it.severity).toBe("decision");
    expect(it.title).toContain("月見百貨");
    expect(it.detail).toContain("5 小時");
    expect(it.target).toEqual({ kind: "hub", hub: "world", tab: "dir" });
    expect(hubBadges(items).world).toBe(1);
    expect(buildAttention(stateAt(0), 1, [], NOW).some((i) => i.id.startsWith("alliance:"))).toBe(false);
  });

  it("近兩天的跨商場通知列為資訊；太舊的不列；邀請通知不重複", () => {
    const items = buildAttention(
      stateAt(0, (s) => {
        s.world.notices = [
          { tick: s.tick, text: "收到「月見百貨」送來的資金 ¥50,000，雪中送炭。" },
          { tick: s.tick, text: "「月見百貨」想和你們簽聯名協議。到「世界 → 名錄與榜單」回覆。" },
          { tick: s.tick - 5 * TICKS_PER_DAY, text: "很久以前的通知" },
        ];
      }),
    );
    const notes = items.filter((i) => i.id.startsWith("notice:"));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toContain("雪中送炭");
    expect(notes[0]!.severity).toBe("info");
  });

  it("被搶客 → 提供反擊（帶對方 key 與客群）；一天後不再提示，也不和一般通知重複", () => {
    const hit = (age: number) =>
      stateAt(0, (s) => {
        s.world.notices = [{ tick: s.tick - age, text: "「對手百貨」辦了針對特定客群的促銷，把我們一部分客人搶走了（暫時的）。", from: "m:7", persona: "student" }];
      });
    const fresh = buildAttention(hit(10));
    const it = fresh.find((i) => i.id.startsWith("counter:"))!;
    expect(it.cta).toBe("反擊");
    expect(it.target).toEqual({ kind: "hub", hub: "world", tab: "dir", focus: { key: "m:7", persona: "student" } });
    expect(fresh.some((i) => i.id.startsWith("notice:"))).toBe(false);
    const older = buildAttention(hit(TICKS_PER_DAY + 20));
    expect(older.some((i) => i.id.startsWith("counter:"))).toBe(false);
    expect(older.some((i) => i.id.startsWith("notice:"))).toBe(true); // 過了一天，退回成一般資訊
  });

  it("剛升級 → 提示新樓層開放；過了一天就不再提示", () => {
    const fresh = buildAttention(stateAt(0, (s) => s.log.unshift({ tick: s.tick, kind: "info", text: "商場升到 Lv.3！新的區域與業態開放了。" })));
    expect(fresh.find((i) => i.id.startsWith("levelup:"))?.target).toEqual({ kind: "menu", page: "all" });
    const old = buildAttention(stateAt(0, (s) => s.log.unshift({ tick: s.tick - 2 * TICKS_PER_DAY, kind: "info", text: "商場升到 Lv.3！新的區域與業態開放了。" })));
    expect(old.some((i) => i.id.startsWith("levelup:"))).toBe(false);
  });
});
