import { afterEach, describe, expect, it } from "vitest";
import { REGULARS, REGULAR_BY_ID, STARTER_QUESTS, TICKS_PER_DAY, type MallState } from "@coidle/shared";
import { checkBrand, checkDish, checkRegular } from "./ai/content";
import type { ChatResult } from "./ai/openrouter";
import { ContentService, type AiConfig, type ChatFn } from "./ai/service";
import { openDb } from "./db/db";
import { Repo } from "./db/repo";
import { advanceTo, createInitialState, applyCommand } from "./sim";
import { setFlavorSource } from "./sim/flavor";
import { syncRegulars } from "./sim/regulars";

const T0 = Date.UTC(2026, 10, 24);
const START = (Date.UTC(2027, 3, 1) - 9 * 3_600_000) / 300_000;
const cfg = (over: Partial<AiConfig> = {}): AiConfig => ({ apiKey: "sk-test-secret-123", model: "test/model", budgetUsd: 1, autoApproveEvents: false, dailyCallCap: 50, ...over });

function setup(reply: () => string, over: Partial<AiConfig> = {}) {
  const repo = new Repo(openDb(":memory:"));
  const chatFn: ChatFn = async () => ({ text: reply(), model: "test/model", promptTokens: 300, completionTokens: 300, reasoningTokens: 0, costUsd: 0.0005, ms: 5, finishReason: "stop" }) satisfies ChatResult;
  const svc = new ContentService(repo, cfg(over), () => T0, chatFn);
  return { repo, svc };
}

const goodRegular = (name = "遠藤老師", over: Record<string, unknown> = {}) => ({
  name,
  persona: "local",
  fav: "soba",
  alt: "taiyaki",
  budget: 1.3,
  hint: "每個週三下午都會出現、拿著毛筆和硯台的老先生。",
  bio: "退休的書法老師，說寫字之前一定要先吃一碗熱呼呼的蕎麥麵讓心靜下來。",
  traits: ["愛聊書法", "只坐窗邊"],
  stories: [
    { title: "硯台與蕎麥", text: "他帶來一方舊硯台，說這是年輕時老師送的，今天要在你的店裡磨一次墨。" },
    { title: "新年的招牌", text: "新年前夕，他主動替店家寫了一幅大大的招牌字，客人都停下來拍照。" },
  ],
  ...over,
});

afterEach(() => setFlavorSource(null));

describe("brand, dish and regular validation", () => {
  it("accepts good names and rejects bad ones", () => {
    expect(checkBrand({ category: "ramen", name: "月影食堂", blurb: "只賣三種定食的小小食堂，老闆每天親自買菜。" }).ok).toBe(true);
    expect(checkBrand({ category: "pets", name: "月影食堂", blurb: "只賣三種定食的小小食堂，老闆每天親自買菜。" }).ok).toBe(false);
    expect(checkBrand({ category: "ramen", name: "星巴克", blurb: "只賣三種定食的小小食堂，老闆每天親自買菜。" }).ok).toBe(false); // 真實品牌
    expect(checkBrand({ category: "ramen", name: "😀😀食堂", blurb: "只賣三種定食的小小食堂，老闆每天親自買菜。" }).ok).toBe(false);
    expect(checkBrand({ category: "ramen", name: "大阪屋", blurb: "只賣三種定食的小小食堂，老闆每天親自買菜。" }).ok).toBe(false); // 真實地名
    expect(checkDish({ category: "kushikatsu", name: "柚香炸物串" }).ok).toBe(true);
    expect(checkDish({ category: "kushikatsu", name: "麥當勞套餐" }).ok).toBe(false);
    expect(checkDish({ category: "nope", name: "柚香炸物串" }).ok).toBe(false);
    expect(checkDish({ group: "food", name: "柚香炸物串" }).ok).toBe(false); // 沒指定業態
    expect(checkDish({ category: "ramen", name: "a" }).ok).toBe(false);
    // 業態決定 group，模型亂填的 group 不算數
    const d = checkDish({ group: "retail", category: "ramen", name: "濃厚豚骨拉麵" });
    expect(d.ok && d.value.group).toBe("food");
  });

  it("a regular needs valid persona/fav, fixed rewards, and a unique name", () => {
    const r = checkRegular(goodRegular());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id.startsWith("ai_")).toBe(true);
    expect(r.value.stories).toHaveLength(2);
    expect(r.value.stories.map((x) => x.at)).toEqual([30, 65]);
    // 獎勵由伺服器決定，模型給的數字不算數
    const greedy = checkRegular(goodRegular("貪心先生", { stories: [{ title: "第一章", text: "一".repeat(30), reward: { funds: 9e9, idx: 99 } }, { title: "第二章", text: "二".repeat(30), reward: { funds: 9e9, idx: 99 } }] }));
    expect(greedy.ok).toBe(true);
    if (greedy.ok) expect(greedy.value.stories[1]!.reward).toEqual({ funds: 55_000, idx: 1 });
    expect(checkRegular(goodRegular("遠藤老師", { fav: "no_such_shop" })).ok).toBe(false);
    expect(checkRegular(goodRegular("遠藤老師", { persona: "alien" })).ok).toBe(false);
    const noAlt = checkRegular(goodRegular("遠藤老師", { alt: "nope" })); // 第二選擇編錯 id：丟掉它，人物照收
    expect(noAlt.ok).toBe(true);
    if (noAlt.ok) expect(noAlt.value.alt).toBeUndefined();
    expect(checkRegular(goodRegular("遠藤老師", { stories: [{ title: "一個", text: "一".repeat(30) }] })).ok).toBe(false); // 少於 2 段
    const three = checkRegular(goodRegular("遠藤老師", { stories: [...goodRegular().stories, { title: "第三段", text: "多出來的第三段故事".repeat(4) }] }));
    expect(three.ok && three.value.stories).toHaveLength(2); // 多寫的第三段直接丟掉
    expect(checkRegular(goodRegular("阿富叔")).ok).toBe(false); // 和手寫常客同名
    expect(checkRegular(goodRegular("瑪雅·歐拉")).ok).toBe(true); // 外國人名的中點
    expect(checkRegular(goodRegular("奇怪人😀")).ok).toBe(false);
    const spaced = checkRegular(goodRegular("大和 結衣"));
    expect(spaced.ok && spaced.value.name).toBe("大和結衣"); // 名字中間的空白會去掉
    expect(checkRegular(goodRegular("簡體人", { bio: "退休的书法老师，说写字之前一定要先吃一碗热呼呼的荞麦面让心静下来。" })).ok).toBe(false);
    expect(checkRegular(goodRegular("遠藤老師", { bio: "訪問 https://example.com 了解更多更多更多更多" })).ok).toBe(false);
    expect(checkRegular(goodRegular("遠藤老師", { budget: 99 })).ok).toBe(true); // 夾限而不是拒收
    const clamped = checkRegular(goodRegular("遠藤老師", { budget: 99 }));
    if (clamped.ok) expect(clamped.value.budget).toBe(1.6);
  });
});

describe("content service: brand, dish and regular pools", () => {
  it("brand and dish names go straight into the pool and feed the flavor source", async () => {
    const brands = JSON.stringify({ items: ["ramen", "fashion", "cinema", "spa"].map((c, i) => ({ category: c, name: `星屑${i}堂`, blurb: "一間很有個性的小店，老闆總是笑咪咪的。" })) });
    const { svc, repo } = setup(() => brands);
    const r = await svc.generate("brand");
    expect(r.accepted).toBe(4);
    expect(repo.contentCount("brand", "active")).toBe(4);
    expect(svc.flavorSource().brands?.("fashion")[0]?.name).toBe("星屑1堂");
    expect(svc.flavorSource().brands?.("ramen")).toHaveLength(1);
    expect(svc.flavorSource().brands?.("kushikatsu")).toEqual([]); // 別種店不會拿到拉麵店的簡介

    const dishes = JSON.stringify({ items: [{ category: "kushikatsu", name: "柚香炸物串" }, { category: "spa", name: "晨光舒活療程" }] });
    const d = setup(() => dishes);
    expect((await d.svc.generate("dish")).accepted).toBe(2);
    expect(d.svc.flavorSource().dishes?.("kushikatsu")).toEqual(["柚香炸物串"]);
    expect(d.svc.flavorSource().dishes?.("spa")).toEqual(["晨光舒活療程"]);
    expect(d.svc.flavorSource().dishes?.("ramen")).toEqual([]); // 別種店不會拿到串炸的名字
  });

  it("regulars wait for approval, then register and show up for existing malls", async () => {
    const { svc, repo } = setup(() => JSON.stringify({ items: [goodRegular("遠藤老師"), goodRegular("壞人", { fav: "xxx" })] }));
    const r = await svc.generate("regular");
    expect(r.accepted).toBe(1);
    expect(r.rejected).toHaveLength(1);
    expect(repo.contentCount("regular", "pending")).toBe(1);
    expect(svc.publicRegulars()).toHaveLength(0); // 還沒核准

    const s = createInitialState(7, START, 0); // 核准之前建立的商場（沒有他的紀錄）
    const id = repo.contentList("regular", "pending", 5)[0]!.id;
    expect(svc.approveEvent(id)).toBe(true);
    const ai = svc.publicRegulars();
    expect(ai).toHaveLength(1);
    expect(REGULAR_BY_ID[ai[0]!.id]?.name).toBe("遠藤老師");

    // 既有商場補上紀錄，並且真的能遇到他
    expect(s.regulars.some((x) => x.id === ai[0]!.id)).toBe(false);
    syncRegulars(s);
    expect(s.regulars.some((x) => x.id === ai[0]!.id)).toBe(true);
    syncRegulars(s);
    expect(s.regulars.filter((x) => x.id === ai[0]!.id)).toHaveLength(1); // 不會重複

    // 清掉，避免影響其他測試
    const i = REGULARS.findIndex((x) => x.id === ai[0]!.id);
    REGULARS.splice(i, 1);
    delete REGULAR_BY_ID[ai[0]!.id];
  });

  it("an active regular cannot be 'retired' (only pending ones can be rejected)", async () => {
    const { svc, repo } = setup(() => JSON.stringify({ items: [goodRegular("遠藤老師")] }), { autoApproveEvents: true });
    await svc.generate("regular");
    const row = repo.contentList("regular", "active", 5)[0]!;
    expect(svc.rejectEvent(row.id)).toBe(false);
    const i = REGULARS.findIndex((x) => x.name === "遠藤老師");
    if (i >= 0) {
      delete REGULAR_BY_ID[REGULARS[i]!.id];
      REGULARS.splice(i, 1);
    }
  });

  it("topUp keeps filling the brand and dish pools once news and reviews are full", async () => {
    const kinds: string[] = [];
    const repo = new Repo(openDb(":memory:"));
    const chatFn: ChatFn = async (o) => {
      const p = o.messages[1]!.content;
      kinds.push(p.includes("租戶品牌") ? "brand" : p.includes("研發工坊") ? "dish" : "other");
      return { text: JSON.stringify({ items: [] }), model: "m", promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0.0001, ms: 1, finishReason: "stop" };
    };
    const svc = new ContentService(repo, cfg(), () => T0, chatFn);
    // 快訊與評價已滿
    for (const mood of ["good", "bad", "neutral", "season"]) for (let i = 0; i < 12; i++) repo.addContent("news", "active", `n${mood}${i}`, { mood, text: `快訊 ${mood} ${i} 站前的小店今天很熱鬧` }, "m", T0);
    for (const tier of ["high", "mid", "low"]) for (let i = 0; i < 12; i++) repo.addContent("review", "active", `r${tier}${i}`, { tier, text: `{shop} 評價 ${tier} ${i} 很不錯的一家店` }, "m", T0);
    svc.reload();
    await svc.topUp();
    expect(kinds[0]).toBe("brand");
  });
});

describe("simulation uses pooled names but stays unchanged when pools are empty", () => {
  const mk = (): MallState => {
    const s = createInitialState(11, START, 0);
    s.level = 3;
    s.funds = 100_000_000;
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] = 0;
    return s;
  };

  it("tenant candidates sometimes carry an AI brand name and blurb", () => {
    setFlavorSource({
      news: () => [],
      reviews: () => [],
      brands: (c) => [1, 2, 3, 4, 5, 6].map((i) => ({ name: `${c}星屑${i}`, blurb: "很有個性的小店，老闆總是笑咪咪。" })),
      dishes: () => [],
    });
    const s = advanceTo(mk(), START + 40 * TICKS_PER_DAY);
    const names = new Set<string>();
    for (const c of s.leasing.candidates) if (c.blurb) names.add(c.brand);
    const tenants = s.shops.filter((x) => x.tenant && /星屑/.test(x.tenant.brand));
    expect(names.size + tenants.length).toBeGreaterThan(0);
  });

  it("empty pools give exactly the same result as no flavor source", () => {
    const a = advanceTo(mk(), START + 20 * TICKS_PER_DAY);
    setFlavorSource({ news: () => [], reviews: () => [], brands: () => [], dishes: () => [] });
    const b = advanceTo(mk(), START + 20 * TICKS_PER_DAY);
    expect(b.leasing).toEqual(a.leasing);
    expect(b.funds).toBe(a.funds);
  });

  it("original creations take a pooled dish name when one is available", () => {
    setFlavorSource({ news: () => [], reviews: () => [], dishes: (c) => (c === "kushikatsu" ? ["晨光柚子串"] : []) });
    let s = mk();
    // 隨便做一次研發，讓它在池子有名字的時候完成
    const shop = s.shops.find((x) => x.category === "kushikatsu")!;
    const pick = (slot: string) => s.workshop.ingredients.find((i) => i.group === "food" && i.slot === slot)!.id;
    const r = applyCommand(s, { type: "startRnd", shopId: shop.id, picks: { base: pick("base"), season: pick("season"), method: pick("method") } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = advanceTo(r.state, r.state.tick + 6 * TICKS_PER_DAY);
    const last = s.workshop.log[s.workshop.log.length - 1];
    if (last?.outcome === "original") expect(last.dishName).toBe("晨光柚子串");
    else expect(["signature", "almost", "burnt", "original"]).toContain(last?.outcome);
  });
});
