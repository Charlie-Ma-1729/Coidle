import { describe, expect, it, afterEach } from "vitest";
import { EVENT_BY_ID, TICKS_PER_DAY } from "@coidle/shared";
import { checkEvent, checkNews, checkReview } from "./ai/content";
import { chat, extractJson, LlmError, type ChatResult } from "./ai/openrouter";
import { ContentService, type AiConfig, type ChatFn } from "./ai/service";
import { checkText, SIMILAR_LIMIT, textSimilarity } from "./ai/validate";
import { buildApp } from "./app";
import { openDb } from "./db/db";
import { Repo } from "./db/repo";
import { advanceTo, createInitialState } from "./sim";
import { setFlavorSource } from "./sim/flavor";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 24);
const cfg = (over: Partial<AiConfig> = {}): AiConfig => ({ apiKey: "sk-test-secret-123", model: "test/model", budgetUsd: 1, autoApproveEvents: false, dailyCallCap: 12, ...over });

function setup(over: Partial<AiConfig> = {}, reply?: (n: number) => string, cost = 0.0005) {
  const clock = { t: T0 };
  const repo = new Repo(openDb(":memory:"));
  let calls = 0;
  const chatFn: ChatFn = async () => {
    calls++;
    const text = reply ? reply(calls) : JSON.stringify({ items: [] });
    return { text, model: "test/model", promptTokens: 300, completionTokens: 300, reasoningTokens: 0, costUsd: cost, ms: 5, finishReason: "stop" } satisfies ChatResult;
  };
  const svc = new ContentService(repo, cfg(over), () => clock.t, chatFn);
  return { clock, repo, svc, calls: () => calls };
}

// 測試用的假內容：每一則的「鑰匙」對應一段互不重疊的字，所以彼此不會被「太像」擋掉；同一把鑰匙每次給的字都一樣（用來測重複）
const SIMPLE = "篮这们时对说过还么发开见买卖热汤鱼饭鸡烧样种听吗为让门问间网电车长马鸟书东风头关气经现应总题无业乐华货费";
const POOL = Array.from({ length: 6000 }, (_, k) => String.fromCharCode(0x4e00 + k * 3)).filter((c) => !SIMPLE.includes(c));
const WINDOWS = new Map<string, number>();
const win = (key: string, len: number): string => {
  if (!WINDOWS.has(key)) WINDOWS.set(key, WINDOWS.size);
  const at = WINDOWS.get(key)! * 16;
  return POOL.slice(at, at + len).join("");
};
const news = (n: number, tag = "") => JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ mood: (["good", "bad", "neutral", "season"] as const)[i % 4], text: `今天的${win(`news-${tag}${i}`, 14)}` })) });
const goodEvent = (title: string, over: Record<string, unknown> = {}) => ({
  title,
  text: "對面老街的老店老闆說，今天想請商場一起辦個小攤位活動，順便把客人帶過來，人情味滿滿。",
  category: "crowd",
  options: [
    { label: "出資佈置攤位，一起辦", effects: [{ t: "funds", amount: -50000 }, { t: "index", which: "localRep", amount: 1 }] },
    { label: "只借場地，其餘自理", effect: { t: "index", which: "localRep", amount: 0.5 } },
  ],
  ...over,
});

describe("text validation", () => {
  it("accepts ordinary text and rejects real places, real brands, urls and bad words", () => {
    expect(checkText("站前的小店今天來了一位熟客，老闆笑著多送一碟小菜", { max: 60 })).toBeNull();
    expect(checkText("今天在大阪的商場很熱鬧呢，客人很多很多", { max: 60 })).toContain("地名");
    expect(checkText("新今宮站前的人潮好多好多好多好多", { max: 60 })).toContain("地名");
    expect(checkText("旁邊的星巴克今天也大排長龍喔喔喔", { max: 60 })).toContain("品牌");
    expect(checkText("詳情請見 https://example.com 喔喔喔喔", { max: 60 })).toContain("網址");
    expect(checkText("這裡真是貧民窟一樣的地方啊啊啊啊啊", { max: 60 })).toContain("不當");
    expect(checkText("這道醬汁蔥花大阪燒是今天的主打招牌", { max: 60 })).toBeNull(); // 料理名稱不算地名
    expect(checkText("今天大阪的客人特別多特別多喔喔喔", { max: 60 })).toContain("地名");
    expect(checkText("當季鮮蔬早市篮裡面有很多好東西喔", { max: 60 })).toContain("簡體");
    expect(checkText("當季鮮蔬早市籃裡面有很多好東西喔", { max: 60 })).toBeNull();
    expect(checkText("太短", { max: 60 })).toBe("太短");
    expect(checkText("字".repeat(80), { max: 60 })).toBe("太長");
  });

  it("news and reviews: moods/tiers, placeholders and shape are enforced", () => {
    expect(checkNews({ mood: "good", text: "站前的小店今天來了一位熟客，老闆笑著多送一碟小菜" }).ok).toBe(true);
    expect(checkNews({ mood: "angry", text: "站前的小店今天來了一位熟客，老闆笑著多送一碟小菜" }).ok).toBe(false);
    expect(checkNews({ mood: "good", text: "今天{shop}的生意特別好，大家都很開心喔喔喔" }).ok).toBe(false);
    expect(checkReview({ tier: "high", text: "{shop}的東西真好吃，老闆又親切，下次還要帶朋友來" }).ok).toBe(true);
    expect(checkReview({ tier: "high", text: "東西真好吃，老闆又親切，下次還要帶朋友一起來喔" }).ok).toBe(false); // 沒有 {shop}
    expect(checkReview({ tier: "high", text: "{shop}和{shop}都很好吃，老闆又親切，下次還要來喔" }).ok).toBe(false);
    expect(checkReview({ tier: "high", text: "{ shop }的東西真好吃，老闆又親切，下次還要帶朋友來" }).ok).toBe(true); // 容忍空白
    expect(checkReview(null).ok).toBe(false);
  });
});

describe("event validation: whitelist and clamping", () => {
  it("clamps numbers into safe ranges and forces 'never pause the clock'", () => {
    const r = checkEvent(
      goodEvent("老街聯名小攤", {
        options: [
          { label: "出資佈置攤位，一起辦", effects: [{ t: "funds", amount: -9_999_999 }, { t: "index", which: "localRep", amount: 1 }] },
          { label: "請客人排隊拍照打卡", effect: { t: "traffic", persona: "tourist", mult: 50, ticks: 99999 } },
          { label: "婉拒，維持原樣", effect: { t: "index", which: "localRep", amount: 99 } },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.value;
    expect(ev.id.startsWith("ai_")).toBe(true);
    expect(ev.attention).toBe("auto");
    expect(ev.effects).toEqual([]);
    const opts = ev.choice!.options;
    expect(opts[0]!.effects[0]).toEqual({ t: "funds", amount: -60000 });
    expect(opts[1]!.effects[0]).toMatchObject({ t: "traffic", mult: 1.5, ticks: 144 });
    expect(opts[2]!.effects[0]).toEqual({ t: "index", which: "localRep", amount: 2 });
    expect(ev.choice!.options.some((o) => o.id === ev.choice!.defaultOption)).toBe(true);
  });

  it("rejects unknown effect types, odd categories, wrong option counts and one-sided options", () => {
    const bad = (over: Record<string, unknown>) => checkEvent(goodEvent("老街聯名小攤", over)).ok;
    expect(bad({ options: [{ label: "出資佈置攤位，一起辦", effect: { t: "supplierStatus", family: "meat" } }, { label: "婉拒，維持原樣", effect: { t: "funds", amount: 0 } }] })).toBe(false);
    expect(bad({ options: [{ label: "出資佈置攤位，一起辦", effect: { t: "funds", amount: 100 } }] })).toBe(false);
    expect(bad({ category: "weather" })).toBe(false);
    // 每個選項都只有好處、沒有代價：不收
    expect(bad({ options: [{ label: "出資佈置攤位，一起辦", effect: { t: "funds", amount: 50000 } }, { label: "再多拿一點好處啦", effect: { t: "index", which: "localRep", amount: 2 } }] })).toBe(false);
    expect(checkEvent("not an object").ok).toBe(false);
    expect(checkEvent(goodEvent("大阪的老街小攤")).ok).toBe(false); // 真實地名
  });
});

describe("generation pipeline and budget", () => {
  it("stores accepted items, dedupes repeats, and feeds the flavor source", async () => {
    const { svc, repo } = setup({}, () => news(8));
    const r = await svc.generate("news", 8);
    expect(r).toMatchObject({ ok: true, accepted: 8 });
    expect(repo.contentCount("news", "active")).toBe(8);
    expect(svc.flavorSource().news("good").length).toBe(2);
    const again = await svc.generate("news", 8);
    expect(again.accepted).toBe(0);
    expect(again.rejected).toContain("重複");
    expect(repo.ledgerRecent(5)).toHaveLength(2);
  });

  it("rejected items never enter the pool", async () => {
    const mixed = JSON.stringify({ items: [{ mood: "good", text: "大阪的商場今天好熱鬧好熱鬧好熱鬧啊啊" }, { mood: "good", text: "站前的小店今天來了一位熟客，老闆笑著多送一碟小菜" }, { mood: "nope", text: "站前的小店今天又來了一位熟客，老闆多送小菜" }, "junk"] });
    const { svc, repo } = setup({}, () => mixed);
    const r = await svc.generate("news");
    expect(r.accepted).toBe(1);
    expect(r.rejected.length).toBe(3);
    expect(repo.contentCount("news", "active")).toBe(1);
  });

  it("without an API key nothing is called", async () => {
    const { svc, calls } = setup({ apiKey: null }, () => news(4));
    expect(svc.enabled).toBe(false);
    expect((await svc.generate("news")).error).toContain("OPENROUTER_API_KEY");
    expect(await svc.topUp()).toBeNull();
    expect(calls()).toBe(0);
  });

  it("the 30-day window starts at first use, stops at 85% of the budget, and resets after 30 days", async () => {
    const { svc, clock, calls } = setup({ budgetUsd: 0.1, dailyCallCap: 100 }, (n) => news(4, `r${n}-`), 0.0059);
    expect(svc.budget().windowStart).toBe(T0);
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      clock.t += 25 * 3600_000; // 隔超過一天，避開單日上限
      const r = await svc.generate("news", 4);
      if (r.ok) ok++;
    }
    expect(ok).toBeGreaterThan(5);
    expect(ok).toBeLessThan(20); // 預算用完後就停了
    expect(svc.budget().spentUsd).toBeLessThanOrEqual(0.1 * 0.85 + 1e-9);
    const stopped = await svc.generate("news", 4);
    expect(stopped.error).toMatch(/預算|上限/);
    const before = calls();
    clock.t = T0 + 31 * DAY;
    const fresh = await svc.generate("news", 4);
    expect(calls()).toBe(before + 1); // 新視窗，又能用了
    expect(fresh.ok).toBe(true);
    expect(svc.budget().windowStart).toBe(T0 + 30 * DAY);
    expect(svc.budget().spentUsd).toBeCloseTo(0.0059, 6);
  });

  it("honours a fixed window start, money already spent elsewhere, the daily spend cap and the daily call cap", async () => {
    const a = setup({ budgetStart: T0 - 10 * DAY, spentElsewhereUsd: 0.845 }, () => news(4));
    expect(a.svc.budget().windowStart).toBe(T0 - 10 * DAY);
    expect((await a.svc.generate("news")).error).toMatch(/預算/); // 0.845 + 估價 > 0.85
    expect(a.calls()).toBe(0);

    const b = setup({ dailyCallCap: 2 }, (n) => news(4, `x${n}-`));
    await b.svc.generate("news");
    await b.svc.generate("news");
    expect((await b.svc.generate("news")).error).toContain("次數");
    b.clock.t += DAY + 1;
    expect((await b.svc.generate("news")).ok).toBe(true);

    const c = setup({ budgetUsd: 1 }, (n) => news(4, `y${n}-`), 0.075); // 單日上限 8% ＝ 0.08
    expect((await c.svc.generate("news")).ok).toBe(true);
    expect((await c.svc.generate("news")).error).toContain("今天");
  });

  it("a failed call is logged, costs nothing, and backs off for an hour", async () => {
    const clock = { t: T0 };
    const repo = new Repo(openDb(":memory:"));
    let calls = 0;
    const svc = new ContentService(repo, cfg(), () => clock.t, async () => {
      calls++;
      throw new LlmError("OpenRouter 錯誤（HTTP 500）：boom", 500);
    });
    expect((await svc.generate("news")).error).toContain("500");
    expect(repo.ledgerRecent(1)[0]).toMatchObject({ ok: 0, cost_usd: 0 });
    expect((await svc.generate("news")).error).toContain("稍後");
    expect(calls).toBe(1);
    clock.t += 3_600_001;
    await svc.generate("news");
    expect(calls).toBe(2);
  });

  it("garbage output (not JSON) is handled and still billed", async () => {
    const { svc, repo } = setup({}, () => "抱歉，我無法完成這個要求。");
    const r = await svc.generate("review");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(repo.ledgerRecent(1)[0]!.cost_usd).toBeGreaterThan(0);
  });

  it("top-up fills news, reviews, brand and dish names, then proposes events, and stops when pools are full", async () => {
    const reviews = JSON.stringify({ items: Array.from({ length: 45 }, (_, i) => ({ tier: (["high", "mid", "low"] as const)[i % 3], text: `{shop}${win(`review-${i}`, 16)}` })) });
    const groups = ["food", "retail", "entertainment", "service"] as const;
    const bcats = ["ramen", "fashion", "cinema", "spa"];
    const brands = JSON.stringify({ items: Array.from({ length: 180 }, (_, i) => ({ category: bcats[i % 4], name: `星屑${i}堂`, blurb: "一間很有個性的小店，老闆總是笑咪咪的。" })) });
    const cats = ["ramen", "fashion", "cinema", "spa"];
    const dishes = JSON.stringify({ items: Array.from({ length: 130 }, (_, i) => ({ category: cats[i % 4], name: `晨光新品${i}號` })) });
    const seq = [news(60), reviews, brands, dishes, JSON.stringify({ items: [goodEvent("老街聯名小攤")] })];
    const { svc, repo } = setup({ dailyCallCap: 50, budgetUsd: 10 }, (n) => seq[n - 1] ?? "{}");
    expect((await svc.topUp())?.kind).toBe("news");
    expect((await svc.topUp())?.kind).toBe("review");
    expect((await svc.topUp())?.kind).toBe("brand");
    expect((await svc.topUp())?.kind).toBe("dish");
    expect((await svc.topUp())?.kind).toBe("event");
    expect(repo.contentCount("event", "pending")).toBe(1);
  });
});

describe("similarity and tradeoff checks", () => {
  it("textSimilarity flags the same story told twice, but not unrelated lines", () => {
    const a = "地下美食街的排氣扇昨晚故障，今早整條走廊飄著油煙味，店家們正忙著叫修繕師傅，還請大家多多包涵。";
    const b = "地下美食街的排風扇昨晚故障，今早已請維修人員處理，造成的不便還請多多包涵。";
    const c = "對面老街的福引商店街今日舉辦小型抽獎，不少常客特地繞過來逛一圈。";
    expect(textSimilarity(a, b)).toBeGreaterThanOrEqual(SIMILAR_LIMIT);
    expect(textSimilarity(a, c)).toBeLessThan(SIMILAR_LIMIT);
    expect(textSimilarity("", c)).toBe(0);
  });

  it("generation drops a line that is too close to one already in the pool (and the prompt tells the model what to avoid)", async () => {
    const first = "地下美食街的排氣扇昨晚故障，今早整條走廊飄著油煙味，店家們正忙著叫修繕師傅，還請大家多多包涵。";
    const second = "地下美食街的排風扇昨晚故障，今早已請維修人員處理，造成的不便還請多多包涵。";
    const fresh = "對面老街的福引商店街今日舉辦小型抽獎，不少常客特地繞過來逛一圈。";
    const replies = [JSON.stringify({ items: [{ mood: "bad", text: first }] }), JSON.stringify({ items: [{ mood: "bad", text: second }, { mood: "good", text: fresh }] })];
    const seen: string[] = [];
    const clock = { t: T0 };
    const repo = new Repo(openDb(":memory:"));
    let n = 0;
    const svc = new ContentService(repo, cfg(), () => clock.t, async (o) => {
      seen.push(o.messages.map((m) => m.content).join("
"));
      return { text: replies[n++]!, model: "test/model", promptTokens: 300, completionTokens: 300, reasoningTokens: 0, costUsd: 0.0005, ms: 5, finishReason: "stop" } satisfies ChatResult;
    });
    expect((await svc.generate("news", 1)).accepted).toBe(1);
    const r = await svc.generate("news", 2);
    expect(r.accepted).toBe(1);
    expect(r.rejected).toContain("太像已有的");
    expect(seen[1]).toContain(first); // 第二次呼叫時，提示詞裡有第一則，叫模型避開
  });

  it("an option that only costs money while another only helps is not a real choice", () => {
    const costOnly = goodEvent("老街聯名小攤", { options: [{ label: "出資佈置攤位，一起辦", effect: { t: "funds", amount: -25000 } }, { label: "只借場地，其餘自理", effect: { t: "index", which: "localRep", amount: 1 } }] });
    expect(checkEvent(costOnly).ok).toBe(false);
    expect(checkEvent(goodEvent("老街聯名小攤")).ok).toBe(true); // 花錢的選項同時帶來口碑，才算取捨
  });
});

describe("AI events need approval and never pause the clock", () => {
  afterEach(() => setFlavorSource(null));

  it("pending until approved; approving registers the definition; rejecting an active one retires it", async () => {
    const { svc, repo } = setup({}, () => JSON.stringify({ items: [goodEvent("老街聯名小攤"), goodEvent("屋頂花園音樂夜", { text: "屋頂花園有人自願辦一場小小的音樂夜，客人可以邊吹風邊聽歌，氣氛很好，不過要多派人手。" })] }));
    const r = await svc.generate("event", 2);
    expect(r.accepted).toBe(2);
    expect(repo.contentCount("event", "pending")).toBe(2);
    expect(svc.publicEvents()).toEqual([]);

    const row = repo.contentList("event", "pending")[0]!;
    const id = (row.payload as { id: string }).id;
    expect(EVENT_BY_ID[id]).toBeUndefined();
    expect(svc.approveEvent(row.id)).toBe(true);
    expect(EVENT_BY_ID[id]?.title).toBeTruthy();
    expect(EVENT_BY_ID[id]?.attention).toBe("auto");
    expect(svc.publicEvents().map((e) => e.id)).toContain(id);
    expect(svc.approveEvent(row.id)).toBe(false); // 不能重複核准

    expect(svc.rejectEvent(row.id)).toBe(true); // 已上線的改為下架
    expect(EVENT_BY_ID[id]?.weight).toBe(0);
    expect(svc.publicEvents().map((e) => e.id)).toContain(id); // 進行中的待決事件還認得
  });

  it("autoApproveEvents puts them live straight away", async () => {
    const { svc, repo } = setup({ autoApproveEvents: true }, () => JSON.stringify({ items: [goodEvent("老街聯名小攤2", { text: "對面老街的老店老闆說，今天想請商場一起辦個小攤位活動，順便把客人帶過來，也許能多一些新面孔。" })] }));
    await svc.generate("event", 1);
    expect(repo.contentCount("event", "active")).toBe(1);
  });
});

describe("pool content reaches the game", () => {
  afterEach(() => setFlavorSource(null));

  it("daily reports pick a blurb from the pool and reviews mix pooled sentences in", () => {
    const blurb = "站前的小店今天來了一位熟客，老闆笑著多送一碟小菜";
    const review = "{shop}的店員很貼心，下次還要再來，推薦給朋友們";
    setFlavorSource({ news: () => [blurb], reviews: () => [review] });
    let s = createInitialState(7, 0);
    s = advanceTo(s, 4 * TICKS_PER_DAY + 30);
    expect(s.reports.length).toBeGreaterThanOrEqual(3);
    expect(s.reports.every((r) => r.notes.some((n) => n.includes(blurb)))).toBe(true);
    const texts = s.reviewLog.map((r) => r.text).concat(s.inbox.map((i) => i.text));
    expect(texts.some((t) => t.includes("店員很貼心"))).toBe(true);
    expect(texts.some((t) => !t.includes("店員很貼心"))).toBe(true); // 手寫的仍在
    expect(texts.every((t) => !t.includes("{shop}"))).toBe(true);
  });

  it("without a pool the game behaves exactly as before (no extra blurb)", () => {
    let s = createInitialState(7, 0);
    s = advanceTo(s, 3 * TICKS_PER_DAY + 30);
    expect(s.reports.every((r) => r.notes.every((n) => !n.startsWith("📰")))).toBe(true);
  });
});

describe("OpenRouter client", () => {
  it("never leaks the API key in errors, and reads cost/tokens from usage", async () => {
    const fail = (async () => new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })) as unknown as typeof fetch;
    await expect(chat({ apiKey: "sk-super-secret", model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 10, fetchImpl: fail })).rejects.toThrow(/401/);
    try {
      await chat({ apiKey: "sk-super-secret", model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 10, fetchImpl: fail });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("sk-super-secret");
    }
    let sentAuth = "";
    let sentBody: Record<string, unknown> = {};
    const ok = (async (_u: string, init: RequestInit) => {
      sentAuth = String((init.headers as Record<string, string>).authorization);
      sentBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "{\"items\":[]}" }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 22, cost: 0.00042 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await chat({ apiKey: "sk-abc", model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 50, json: true, fetchImpl: ok });
    expect(sentAuth).toBe("Bearer sk-abc");
    expect(sentBody.max_tokens).toBe(50);
    expect(sentBody.response_format).toEqual({ type: "json_object" });
    expect(r).toMatchObject({ promptTokens: 11, completionTokens: 22, costUsd: 0.00042 });
  });

  it("extractJson tolerates fences and chatter", () => {
    expect(extractJson('```json\n{"items":[1]}\n```')).toEqual({ items: [1] });
    expect(extractJson('好的，這是結果：{"items":[2]} 希望有幫助')).toEqual({ items: [2] });
    expect(() => extractJson("沒有 JSON")).toThrow();
    expect(() => extractJson("{壞掉的")).toThrow();
  });
});

describe("HTTP endpoints", () => {
  const opened: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    while (opened.length) await opened.pop()!.app.close();
    setFlavorSource(null);
  });
  const make = (adminToken: string | null) => {
    const b = buildApp({ config: { dbPath: ":memory:", adminToken, ai: { ...cfg({ apiKey: null }), budgetStart: null, spentElsewhereUsd: 0 } } });
    opened.push(b);
    return b.app;
  };

  it("event definitions need a login; admin endpoints need the admin token", async () => {
    const app = make("tok-123");
    expect((await app.inject({ url: "/api/content/events" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/admin/ai/status" })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/admin/ai/status", headers: { "x-admin-token": "wrong" } })).statusCode).toBe(403);
    const ok = await app.inject({ url: "/api/admin/ai/status", headers: { "x-admin-token": "tok-123" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().enabled).toBe(false);
    expect(JSON.stringify(ok.json())).not.toContain("sk-");
    const gen = await app.inject({ method: "POST", url: "/api/admin/ai/generate", headers: { "x-admin-token": "tok-123" }, payload: { kind: "news" } });
    expect(gen.json().error).toContain("OPENROUTER_API_KEY");
    expect((await make(null).inject({ url: "/api/admin/ai/status", headers: { "x-admin-token": "" } })).statusCode).toBe(403);
  });
});
