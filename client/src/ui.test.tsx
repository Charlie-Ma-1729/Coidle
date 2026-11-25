// DOM 環境在 beforeAll 才載入（而不是用 @vitest-environment）：
// 在網路磁碟上載入 happy-dom 要將近 1 分鐘，會撞到 vitest 寫死的 60 秒 worker 啟動逾時。
import { render } from "preact";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TICKS_PER_DAY, TICK_MINUTES, type PublicMallState } from "@coidle/shared";
import { advanceTo, createInitialState } from "../../server/src/sim";

const START = (Date.UTC(2026, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);

function publicState(days: number, mutate?: (s: ReturnType<typeof createInitialState>) => void): PublicMallState {
  let s = createInitialState(7, START);
  mutate?.(s);
  s = advanceTo(s, START + days * TICKS_PER_DAY + 30);
  const { seed: _seed, cooldowns: _cd, ...rest } = s;
  return rest;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
let store: typeof import("./store");
let container: HTMLElement;

beforeAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost:5173" });
  store = await import("./store"); // 它會用到 document，所以要在 DOM 就緒之後才載入
}, 240_000);

afterAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  await GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  store.toasts.value = [];
});

async function mount(node: preact.ComponentChild) {
  render(node, container);
  await tick();
}

describe("screens render with real simulated state", () => {
  it("World shows the leaderboard with NPC malls, my mall and the season", async () => {
    store.state.value = publicState(2);
    store.mallId.value = 5;
    const { WORLD_EPOCH_MS, npcEntries } = await import("@coidle/shared");
    const now = WORLD_EPOCH_MS + 3 * 86_400_000;
    const mine = { key: "m:5", kind: "player" as const, name: "我們的商場", tagline: "", level: 2, stars: 3, score: 55, localRep: 60, touristHeat: 58, revenue30: 12_000_000, shops: 9, topCategory: "拉麵", stockouts: 0, updatedAt: now };
    const { api } = await import("./api");
    api.world = async () => ({ now, season: { index: 0, start: WORLD_EPOCH_MS, end: WORLD_EPOCH_MS + 28 * 86_400_000 }, entries: [mine, ...npcEntries(now)], history: [], shields: {} });
    const { World } = await import("./screens/World");
    await mount(<World />);
    await tick();
    await tick();
    expect(container.textContent).toContain("商場名錄");
    expect(container.textContent).toContain("我們的商場");
    expect(container.textContent).toContain("港灣大賣場");
    expect(container.textContent).toContain("第 1 季");
    expect(container.textContent).toContain("你");
    expect(container.textContent).toContain("還沒有賽季成績");
  });

  it("World lists alliances with accept/decline for invitations and a joint-promo button for active ones", async () => {
    store.state.value = publicState(2);
    store.mallId.value = 5;
    const { WORLD_EPOCH_MS, npcEntries } = await import("@coidle/shared");
    const now = WORLD_EPOCH_MS + 3 * 86_400_000;
    const { api } = await import("./api");
    api.world = async () => ({ now, season: { index: 0, start: WORLD_EPOCH_MS, end: WORLD_EPOCH_MS + 28 * 86_400_000 }, entries: npcEntries(now), history: [], shields: {} });
    api.alliances = async () => ({
      alliances: [
        { id: 1, status: "pending" as const, direction: "in" as const, partnerKey: "m:9", partnerName: "鮑伯商場", partnerKind: "player" as const, until: now + 5 * 3_600_000, jointReadyAt: 0 },
        { id: 2, status: "active" as const, direction: "both" as const, partnerKey: "n:harbor", partnerName: "港灣大賣場", partnerKind: "npc" as const, until: now + 6 * 86_400_000, jointReadyAt: 0 },
      ],
    });
    const { World } = await import("./screens/World");
    await mount(<World />);
    await tick();
    await tick();
    const text = container.textContent ?? "";
    expect(text).toContain("聯名協議");
    expect(text).toContain("鮑伯商場");
    expect(text).toContain("對方邀請你");
    expect(text).toContain("接受");
    expect(text).toContain("婉拒");
    expect(text).toContain("辦聯名活動");
    expect(text).toContain("結束協議");
  });

  it("World shows trade controls for another player's mall and flags stockouts", async () => {
    store.state.value = publicState(2);
    store.mallId.value = 5;
    const { WORLD_EPOCH_MS } = await import("@coidle/shared");
    const now = WORLD_EPOCH_MS + 3 * 86_400_000;
    const other = { key: "m:9", kind: "player" as const, name: "鮑伯商場", tagline: "", level: 2, stars: 3, score: 50, localRep: 55, touristHeat: 52, revenue30: 8_000_000, shops: 7, topCategory: "串炸", stockouts: 2, updatedAt: now };
    const { api } = await import("./api");
    api.world = async () => ({ now, season: { index: 0, start: WORLD_EPOCH_MS, end: WORLD_EPOCH_MS + 28 * 86_400_000 }, entries: [other], history: [], shields: {} });
    api.alliances = async () => ({ alliances: [] });
    const { World } = await import("./screens/World");
    await mount(<World />);
    await tick();
    await tick();
    expect(container.textContent).toContain("2 間缺貨");
    const row = Array.from(container.querySelectorAll("button.linklike")).find((b) => b.textContent?.includes("鮑伯商場")) as HTMLElement;
    row.click();
    await tick();
    expect(container.textContent).toContain("送資金");
    expect(container.textContent).toContain("對方有");
    expect(container.textContent).toContain("邀請聯名");
    expect(container.textContent).toContain("搶客促銷");
  });

  it("Reports renders after a few days", async () => {
    store.state.value = publicState(4);
    const { Reports } = await import("./screens/Reports");
    await mount(<Reports />);
    expect(container.textContent).toContain("每日利潤");
    expect(container.textContent).toContain("各類客人滿意度");
    expect(container.querySelectorAll(".bars .bar").length).toBeGreaterThanOrEqual(3);
  });

  it("日報記錄當天的天氣；舊日報（沒有天氣）也能正常顯示", async () => {
    store.state.value = publicState(4);
    const s = store.state.value!;
    const last = s.reports[s.reports.length - 1]!;
    expect(last.weather).toBeDefined();
    const { Reports } = await import("./screens/Reports");
    await mount(<Reports />);
    expect(container.textContent).toContain(`${last.weather!.temp}°`);

    // 強制一份下雨的日報：晶片與條形圖提示都要出現
    last.weather = { kind: "rain", temp: 19, hours: { clear: 0, cloudy: 15, rain: 9, storm: 0 } };
    store.state.value = { ...s };
    await mount(<Reports />);
    expect(container.textContent).toContain("☔ 雨・19°（下雨約 9 小時）");

    // 舊存檔的日報沒有 weather 欄位
    delete last.weather;
    store.state.value = { ...s };
    await mount(<Reports />);
    expect(container.textContent).toContain("每日利潤");
    expect(container.textContent).not.toContain("下雨約");
  });

  it("Workshop shows the research bench with known ingredients, and a tasting card", async () => {
    store.state.value = publicState(1, (s) => {
      const shop = s.shops[0]!;
      s.workshop.tastings.push({
        uid: "tst1",
        shopId: shop.id,
        createdTick: s.tick,
        deadlineTick: s.tick + 500,
        outcome: "flop",
        dishId: null,
        picks: {},
        feedback: ["太鹹了，喝了好幾杯水"],
        clue: null,
        learned: [],
      });
    });
    const { Workshop } = await import("./screens/Workshop");
    await mount(<Workshop />);
    expect(container.textContent).toContain("廚房研發");
    expect(container.textContent).toContain("豬里肌");
    expect(container.textContent).toContain("試吃結果");
    expect(container.textContent).toContain("太鹹了");
    expect(container.textContent).not.toContain("rc_");
  });

  it("Workshop menu tab and notes tab render", async () => {
    store.state.value = publicState(1);
    const { Workshop } = await import("./screens/Workshop");
    await mount(<Workshop />);
    const tabs = Array.from(container.querySelectorAll("nav.zones button")) as HTMLButtonElement[];
    tabs.find((b) => b.textContent?.includes("菜單"))!.click();
    await tick();
    expect(container.textContent).toContain("的菜單");
    Array.from(container.querySelectorAll("nav.zones button") as unknown as HTMLButtonElement[]).find((b) => b.textContent?.includes("筆記"))!.click();
    await tick();
    expect(container.textContent).toContain("線索簿");
    expect(container.textContent).toContain("素材圖鑑");
  });

  it("DeviceCard explains install and notifications, and degrades when push is unsupported", async () => {
    store.state.value = publicState(0);
    const { DeviceCard } = await import("./components/DeviceCard");
    await mount(<DeviceCard />);
    expect(container.textContent).toContain("這台裝置");
    expect(container.textContent).toContain("遇事暫停通知");
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("開啟通知")) as HTMLButtonElement | undefined;
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true); // 測試環境沒有 Push API
  });

  it("Tax screen shows bills, the rules summary and the disclaimer", async () => {
    store.state.value = publicState(34);
    const { Tax } = await import("./screens/Tax");
    await mount(<Tax />);
    expect(container.textContent).toContain("待繳帳單");
    expect(container.textContent).toContain("消費稅");
    expect(container.textContent).toContain("發票制度");
    expect(container.textContent).toContain("法人稅等");
    expect(container.textContent).toContain("不是稅務建議");
    expect(container.textContent).toContain("許認可");
  });

  it("Tech screen lists branches, shows research progress and what is blocking each tech", async () => {
    store.state.value = publicState(1, (s) => {
      s.level = 2;
      s.tech.jobs.push({ id: "t_bms", startTick: s.tick, endTick: s.tick + 400, cost: 2_000_000 });
    });
    const { Tech } = await import("./screens/Tech");
    await mount(<Tech />);
    expect(container.textContent).toContain("研究室");
    expect(container.textContent).toContain("智慧導覽 App");
    expect(container.textContent).toContain("智慧能源管理");
    expect(container.textContent).toContain("研發中");
    expect(container.textContent).toContain("需要商場 Lv.3"); // AR 導覽
  });

  it("Leasing screen is locked before Lv.3 and shows negotiating brands afterwards", async () => {
    store.state.value = publicState(1);
    const { Leasing } = await import("./screens/Leasing");
    await mount(<Leasing />);
    expect(container.textContent).toContain("Lv.3");
    store.state.value = publicState(1, (s) => {
      s.level = 3;
      s.leasing.candidates.push({ id: "tc1", brand: "七福食堂", category: "udon", quality: 0.8, fame: 60, rent: 20_000, commission: 0.1, termDays: 30, eagerness: 0.8, createdTick: s.tick, expireTick: s.tick + 1000, countered: false });
      s.leasing.renewals.push({ uid: "rn1", shopId: s.shops[0]!.id, brand: s.shops[0]!.name, rent: 9000, termDays: 60, deadlineTick: s.tick + 500 });
    });
    await mount(<Leasing />);
    expect(container.textContent).toContain("七福食堂");
    expect(container.textContent).toContain("簽約");
    expect(container.textContent).toContain("租金 +10%");
    expect(container.textContent).toContain("租約到期");
  });

  it("Goals screen shows today's and the week's goals, a team event with its tasks, and the contribution board", async () => {
    store.state.value = publicState(3, (s) => {
      s.meta.team.nextAt = s.tick;
      s.meta.team.size = 3;
    });
    const { Goals } = await import("./screens/Goals");
    await mount(<Goals />);
    expect(container.textContent).toContain("今日目標");
    expect(container.textContent).toContain("本週團隊目標");
    expect(container.textContent).toContain("團隊事件");
    expect(container.textContent).toContain("隊員貢獻");
    expect(container.querySelectorAll(".meter, .meter-track").length).toBeGreaterThanOrEqual(3);
  });

  it("Achievements screen shows the star rating, clue collection with the guess box, and hides secret achievements", async () => {
    store.state.value = publicState(2);
    const { Achievements } = await import("./screens/Achievements");
    await mount(<Achievements />);
    expect(container.textContent).toContain("商場評鑑");
    expect(container.textContent).toContain("線索收集");
    expect(container.textContent).toContain("猜猜看");
    expect(container.textContent).toContain("開幕大吉");
    expect(container.textContent).toContain("？？？");
    expect(container.textContent).not.toContain("我知道這是哪裡");
  });

  it("Help shows starter quests with progress, the FAQ and the glossary", async () => {
    store.state.value = publicState(2, (s) => {
      s.meta.achievements["q_price"] = s.tick;
    });
    const { Help } = await import("./screens/Help");
    await mount(<Help />);
    expect(container.textContent).toContain("新手任務");
    expect(container.textContent).toContain("調整一次售價");
    expect(container.textContent).toContain("✅");
    expect(container.textContent).toContain("常見問題");
    expect(container.textContent).toContain("名詞表");
  });

  it("AccountCard offers name, password and delete flows", async () => {
    store.user.value = { id: 1, username: "tester", displayName: "測試員" };
    const { AccountCard } = await import("./components/AccountCard");
    await mount(<AccountCard />);
    expect(container.textContent).toContain("我的帳號");
    expect(container.textContent).toContain("更改密碼");
    const del = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("刪除我的帳號")) as HTMLButtonElement;
    del.click();
    await tick();
    expect(container.textContent).toContain("永久刪除帳號");
  });

  it("Admin screen asks for the token first", async () => {
    sessionStorage.clear();
    const { Admin } = await import("./screens/Admin");
    await mount(<Admin />);
    expect(container.textContent).toContain("管理後台");
    expect(container.textContent).toContain("ADMIN_TOKEN");
  });

  it("Reports shows an empty state before the first report", async () => {
    store.state.value = publicState(0);
    const { Reports } = await import("./screens/Reports");
    await mount(<Reports />);
    expect(container.textContent).toContain("還沒有日報");
  });

  it("Ops shows hours chart and maintenance controls", async () => {
    store.state.value = publicState(1);
    const { Ops } = await import("./screens/Ops");
    await mount(<Ops />);
    expect(container.textContent).toContain("營業時間");
    expect(container.querySelectorAll(".hours-chart .h").length).toBe(24);
    expect(container.textContent).toContain("清潔等級");
    expect(container.textContent).toContain("每日固定成本");
  });

  it("Ops shows the time-speed card with all presets and a pause button", async () => {
    store.state.value = publicState(1);
    const { Ops } = await import("./screens/Ops");
    await mount(<Ops />);
    expect(container.textContent).toContain("時間流速");
    for (const name of ["標準", "悠閒", "慢活", "極慢", "暫停"]) expect(container.textContent).toContain(name);
    expect(container.textContent).toContain("6 小時/日");
    expect(container.textContent).toContain("遇到重要事件自動暫停");
    expect(container.querySelectorAll(".seg.five button").length).toBe(5);
  });

  it("ClockBanner is hidden while the clock runs, and shows resume when manually paused", async () => {
    const { ClockBanner } = await import("./components/ClockBanner");
    store.state.value = publicState(1);
    await mount(<ClockBanner />);
    expect(container.textContent).toBe("");

    store.state.value = publicState(1, (s) => {
      s.clock.holds.manual = true;
    });
    await mount(<ClockBanner />);
    expect(container.textContent).toContain("時間已暫停");
    expect(container.textContent).toContain("恢復");
  });

  it("ClockBanner lists the event that paused the clock with its options", async () => {
    const { ClockBanner } = await import("./components/ClockBanner");
    store.state.value = publicState(0, (s) => {
      s.pending.push({ uid: "ev7", defId: "typhoon_warning", deadlineTick: s.tick + 500 });
      s.clock.holds.events.push("ev7");
    });
    await mount(<ClockBanner />);
    expect(container.textContent).toContain("有重要的事等你決定");
    expect(container.textContent).toContain("颱風接近");
    expect(container.textContent).toContain("提早閉館");
    expect(container.textContent).toContain("全部採預設處理並恢復");
  });

  it("Guests shows complaints with tone, reviews with stars, guest events and the walk card", async () => {
    store.state.value = publicState(0, (s) => {
      const shop = s.shops[0]!;
      s.inbox.push(
        { uid: "in1", kind: "complaint", createdTick: s.tick, deadlineTick: s.tick + 100, shopId: shop.id, persona: "local", text: `「${shop.name}」又缺貨！`, cause: "stockout", tone: "angry" },
        { uid: "in2", kind: "review", createdTick: s.tick, deadlineTick: s.tick + 200, shopId: shop.id, persona: "tourist", text: "太好吃了", stars: 5 },
      );
      s.pending.push({ uid: "ev60", defId: "lost_child", deadlineTick: s.tick + 100 });
      s.reviewLog.push({ tick: s.tick, persona: "local", stars: 2, text: "有點失望", shopName: shop.name, reply: "sincere" });
    });
    const { Guests } = await import("./screens/Guests");
    await mount(<Guests />);
    expect(container.textContent).toContain("巡場");
    expect(container.textContent).toContain("待處理（3）");
    expect(container.textContent).toContain("客訴・缺貨");
    expect(container.textContent).toContain("語氣：憤怒");
    expect(container.textContent).toContain("誠懇道歉");
    expect(container.textContent).toContain("網路評價");
    expect(container.textContent).toContain("幽默回應");
    expect(container.textContent).toContain("走失的小朋友");
    expect(container.textContent).toContain("近期評價");
    expect(container.textContent).toContain("已回覆：誠懇道歉／改進");
    expect(container.textContent).toContain("逾時將依偏好自動");
    expect(container.querySelectorAll(".stars").length).toBeGreaterThanOrEqual(2);
  });

  it("Suppliers shows families in use with the main supplier, alternatives and a locked newcomer", async () => {
    store.state.value = publicState(0, (s) => {
      const meat = s.supply.suppliers.find((x) => x.id === "meat_maru")!;
      meat.relationship = 55;
      meat.orders = 12;
      meat.status = "strike";
      meat.statusUntil = s.tick + 200;
    });
    const { Suppliers } = await import("./screens/Suppliers");
    await mount(<Suppliers />);
    expect(container.textContent).toContain("供應商與進貨");
    expect(container.textContent).toContain("丸三精肉");
    expect(container.textContent).toContain("主力");
    expect(container.textContent).toContain("罷工中");
    expect(container.textContent).toContain("山下食肉"); // 備用供應商
    expect(container.textContent).toContain("關係值");
    expect(container.textContent).toContain("（折 5%）");
    expect(container.textContent).toContain("還有 1 家你不認識的供應商");
    expect(container.textContent).not.toContain("海外直輸肉品"); // 還沒發現的不洩漏名字
    expect(container.textContent).toContain("簽 7 天");
    expect(container.textContent).toContain("免費"); // 主力出不了貨，換人免費
    expect(container.textContent).toContain("自動向備用供應商買現貨");
  });

  it("Suppliers shows contracts and disables switching while one is active", async () => {
    store.state.value = publicState(0, (s) => {
      const m = s.supply.suppliers.find((x) => x.id === "meat_maru")!;
      m.contract = { lockedMult: 1, untilTick: s.tick + 500 };
    });
    const { Suppliers } = await import("./screens/Suppliers");
    await mount(<Suppliers />);
    expect(container.textContent).toContain("長約中");
    expect(container.textContent).toContain("提前解約");
    const switchBtns = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.includes("改用")) as HTMLButtonElement[];
    expect(switchBtns.length).toBeGreaterThan(0);
  });

  it("Rivals shows the ranking with you in it, the market table, stance, rivals and news", async () => {
    store.mallInfo.value = { id: 1, name: "新街商場", members: [] };
    store.state.value = publicState(0, (s) => {
      s.rivals.news.push({ tick: s.tick, text: "「港灣大賣場」打出價格戰。" });
      const h = s.rivals.list.find((r) => r.id === "harbor")!;
      h.campaign = { kind: "price_war", startTick: s.tick, endTick: s.tick + 100, boost: { local: 14, student: 12 }, factor: 1 };
    });
    const { Rivals } = await import("./screens/Rivals");
    await mount(<Rivals />);
    expect(container.textContent).toContain("商場評鑑榜");
    expect(container.textContent).toContain("新街商場（你）");
    for (const name of ["港灣大賣場", "機場前旅客廣場", "雲端天際城", "美食橫丁"]) expect(container.textContent).toContain(name);
    expect(container.textContent).toContain("各客群的競爭力");
    expect(container.textContent).toContain("客流 ×");
    expect(container.textContent).toContain("商戰姿態");
    expect(container.textContent).toContain("價格戰");
    expect(container.textContent).toContain("刺探情報可以知道衝擊有多大"); // 沒情報看不到細節
    expect(container.textContent).toContain("商戰快訊");
    expect(container.querySelectorAll(".rank").length).toBe(5);
    expect(container.querySelectorAll(".rank.mine").length).toBe(1);
  });

  it("Rivals reveals appeal numbers only with intel, and offers counter during a campaign", async () => {
    store.state.value = publicState(0, (s) => {
      const h = s.rivals.list.find((r) => r.id === "harbor")!;
      h.intelUntil = s.tick + 300;
      h.campaign = { kind: "price_war", startTick: s.tick, endTick: s.tick + 100, boost: { local: 14 }, factor: 0.5 };
    });
    const { Rivals } = await import("./screens/Rivals");
    await mount(<Rivals />);
    expect(container.textContent).toContain("情報有效至");
    expect(container.textContent).toContain("已被反制削弱");
    const counter = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("反制")) as HTMLButtonElement;
    expect(counter.disabled).toBe(true); // 已經反制過
  });

  it("Marketing lists the catalog, active and scheduled promos, fatigue and history", async () => {
    store.state.value = publicState(0, (s) => {
      s.promos.fatigue = 0.5;
      s.promos.active.push({ uid: "pr1", defId: "discount_day", startTick: s.tick - 20, endTick: s.tick + 100, factor: 0.7, groups: 42, revenue: 123_000 });
      s.promos.scheduled.push({ uid: "pr2", defId: "collab", startTick: s.tick + 300, cost: 120_000 });
      s.promos.history.push({ defId: "tasting", startTick: 1, endTick: 80, groups: 30, revenue: 90_000, cost: 15_000 });
    });
    const { Marketing } = await import("./screens/Marketing");
    await mount(<Marketing />);
    expect(container.textContent).toContain("促銷疲勞");
    expect(container.textContent).toContain("新活動效果約 70%");
    expect(container.textContent).toContain("進行中・還有約");
    expect(container.textContent).toContain("至今接待 42 組客人");
    expect(container.textContent).toContain("排程中");
    expect(container.textContent).toContain("取消（退回 ¥120,000）");
    for (const name of ["全館折扣日", "週年慶", "買一送一", "免費試吃"]) expect(container.textContent).toContain(name);
    expect(container.textContent).toContain("進行中或已排程"); // 折扣日不能重複開
    expect(container.textContent).toContain("期間營收是預算的 6.0 倍");
  });

  it("Marketing disables launching when funds are short and offers start-time presets", async () => {
    store.state.value = publicState(0, (s) => {
      s.funds = 1000;
    });
    const { Marketing } = await import("./screens/Marketing");
    await mount(<Marketing />);
    expect(container.textContent).toContain("資金不足");
    expect(container.textContent).toContain("今晚 18:00");
    expect(container.textContent).toContain("下個假日 11:00");
    const buttons = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.includes("立刻開辦")) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("InspectionCard shows the live score and prep options, then the chosen prep", async () => {
    const { InspectionCard } = await import("./components/InspectionCard");
    const { inspectionScore } = await import("@coidle/shared");
    const s = publicState(0, (st) => {
      st.cleanliness = 60;
      st.equipment = 40;
      st.inspections.pending.push({ uid: "ins1", kind: "hygiene", notifiedTick: st.tick, inspectTick: st.tick + 60, prep: null });
    });
    store.state.value = s;
    await mount(<InspectionCard s={s} n={s.inspections.pending[0]!} />);
    expect(container.textContent).toContain("食品衛生稽查");
    expect(container.textContent).toContain(`評估分數（現在來就是這個分）${inspectionScore("hygiene", s.cleanliness, s.equipment)}`);
    for (const label of ["照常營業", "例行整理", "全力備戰"]) expect(container.textContent).toContain(label);
    expect(container.textContent).toContain("到時會自動「例行整理」");

    const done = { ...s.inspections.pending[0]!, prep: "full" as const };
    await mount(<InspectionCard s={s} n={done} />);
    expect(container.textContent).toContain("已準備：全力備戰");
  });

  it("ClockBanner lists a paused inspection notice with its prep options", async () => {
    const { ClockBanner } = await import("./components/ClockBanner");
    store.state.value = publicState(0, (st) => {
      st.inspections.pending.push({ uid: "ins2", kind: "fire", notifiedTick: st.tick, inspectTick: st.tick + 60, prep: null });
      st.clock.holds.events.push("ins2");
    });
    await mount(<ClockBanner />);
    expect(container.textContent).toContain("有重要的事等你決定");
    expect(container.textContent).toContain("消防安全檢查");
    expect(container.textContent).toContain("時間因此暫停中");
    expect(container.textContent).toContain("全部採預設處理並恢復");
  });

  it("Ops shows compliance, both live scores and past inspection results", async () => {
    store.state.value = publicState(0, (s) => {
      s.inspections.compliance = 35;
      s.inspections.log.push({ tick: s.tick - 50, kind: "hygiene", score: 30, outcome: "fine", fine: 80_000, prep: "none", surprise: true });
    });
    const { Ops } = await import("./screens/Ops");
    await mount(<Ops />);
    expect(container.textContent).toContain("稽查與合規");
    expect(container.textContent).toContain("合規 35");
    expect(container.textContent).toContain("若現在來衛生稽查");
    expect(container.textContent).toContain("若現在來消防檢查");
    expect(container.textContent).toContain("30 分・罰款");
    expect(container.textContent).toContain("（突擊）");
    expect(container.textContent).toContain("罰款 ¥80,000");
  });

  it("nextTickAt finds the next occurrence of an hour, and the next weekend", async () => {
    const f = await import("./format");
    const { timeInfo } = await import("@coidle/shared");
    const base = START + 3 * 288 + 7 * 12 + 4; // 某天 ~07:20
    const t18 = f.nextTickAt(base, 18);
    expect(timeInfo(t18).hour).toBe(18);
    expect(timeInfo(t18).minute).toBe(0);
    expect(t18).toBeGreaterThan(base);
    expect(t18 - base).toBeLessThanOrEqual(288);
    const wk = f.nextTickAt(base, 11, true);
    expect(timeInfo(wk).weekend).toBe(true);
    expect(timeInfo(wk).hour).toBe(11);
  });

  it("Regulars lists met regulars with actions and keeps strangers hidden behind hints", async () => {
    store.state.value = publicState(0, (s) => {
      const r = s.regulars.find((x) => x.id === "afu")!;
      Object.assign(r, { met: true, affinity: 72, visits: 9, mood: "happy", storyStage: 2, tipsTotal: 4200, knowsPrefs: true, lastVisitTick: s.tick - 30 });
    });
    const { Regulars } = await import("./screens/Regulars");
    await mount(<Regulars />);
    expect(container.textContent).toContain("常客（1/");
    expect(container.textContent).toContain("阿富叔");
    expect(container.textContent).toContain("愛去");
    expect(container.textContent).toContain("來過 9 次");
    expect(container.textContent).toContain("❤ 熟客");
    expect(container.textContent).toContain("故事 2/2");
    expect(container.textContent).toContain("愛吃沾醬多一點"); // 記住喜好之後才看得到
    expect(container.textContent).toContain("招呼");
    expect(container.textContent).toContain("送小禮");
    expect(container.textContent).toContain("專屬座位");
    expect(container.textContent).toContain("還沒遇見的人");
    expect(container.textContent).toContain("每天傍晚推著小推車"); // 未遇見者的線索文字（在 details 內）
    // 沒遇見的人的名字不會洩漏
    expect(container.textContent).not.toContain("小櫻");

    const storyBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("故事") && !b.textContent.includes("故事 "))!;
    storyBtn.click();
    await tick();
    expect(container.textContent).toContain("《老位子》");
    expect(container.textContent).toContain("《四十年的味道》");
  });

  it("Regulars hides unlearned preferences and locks unreached stories", async () => {
    store.state.value = publicState(0, (s) => {
      Object.assign(s.regulars.find((x) => x.id === "tanaka")!, { met: true, affinity: 12 });
    });
    const { Regulars } = await import("./screens/Regulars");
    await mount(<Regulars />);
    expect(container.textContent).not.toContain("加蛋");
    const storyBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("📖"))!;
    storyBtn.click();
    await tick();
    expect(container.textContent).toContain("親密度達到 30 解鎖");
    const reserve = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("專屬座位")) as HTMLButtonElement;
    expect(reserve.disabled).toBe(true); // 親密度不足
  });

  it("Guests shows an empty inbox, a walk cooldown hint and the stance picker", async () => {
    store.state.value = publicState(0, (s) => {
      s.walk.nextTick = s.tick + 1000;
    });
    const { Guests } = await import("./screens/Guests");
    await mount(<Guests />);
    expect(container.textContent).toContain("目前沒有客人在等你");
    expect(container.textContent).toContain("保守");
    expect(container.textContent).toContain("強硬");
    const walkBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("巡一圈")) as HTMLButtonElement;
    expect(walkBtn.disabled).toBe(true);
  });

  it("Guests lists walk voices with their options and costs", async () => {
    store.state.value = publicState(0, (s) => {
      s.walk.voices.push({ id: "wv1", shopId: s.shops[0]!.id, persona: "tourist", mood: "annoyed", situation: "queue", text: "排了好久", expireTick: s.tick + 50 });
    });
    const { Guests } = await import("./screens/Guests");
    await mount(<Guests />);
    expect(container.textContent).toContain("排了好久");
    expect(container.textContent).toContain("發號碼牌");
    expect(container.textContent).toContain("請大家喝冰麥茶");
  });

  it("Team shows members and the invite code for owners", async () => {
    store.state.value = publicState(0);
    store.user.value = { id: 1, username: "u", displayName: "我" };
    store.mallId.value = 1;
    store.mallInfo.value = {
      id: 1,
      name: "測試",
      inviteCode: "ABCD2345",
      members: [{ userId: 1, displayName: "我", role: "gm", isOwner: true, joinedAt: 0 }],
    };
    const { Team } = await import("./screens/Team");
    await mount(<Team />);
    expect(container.textContent).toContain("ABCD2345");
    expect(container.textContent).toContain("總經理");
    expect(container.textContent).toContain("遊戲時間");
  });
});

describe("舊總覽／樓層的行為，在新位置的等價驗證", () => {
  beforeEach(() => {
    store.mallId.value = 1;
    store.user.value = { id: 1, username: "u", displayName: "我" };
  });

  it("AI 事件在執行期註冊後，會以一般待決事件卡的樣子出現在事件視窗", async () => {
    const { registerEvents } = await import("@coidle/shared");
    registerEvents([
      {
        id: "ai_testevent1",
        category: "crowd",
        title: "老街聯名小攤",
        text: "對面老街的老店老闆說，今天想請商場一起辦個小攤位活動。",
        weight: 0.8,
        cooldownTicks: 2000,
        attention: "auto",
        effects: [],
        choice: { deadlineTicks: 288, defaultOption: "o1", options: [{ id: "o1", label: "出資佈置攤位", effects: [{ t: "funds", amount: -20000 }] }, { id: "o2", label: "婉拒", effects: [] }] },
      },
    ]);
    store.state.value = publicState(0, (s) => {
      s.pending.push({ uid: "ev77", defId: "ai_testevent1", deadlineTick: s.tick + 500 });
    });
    const { PendingWindow } = await import("./ui/hubs/GameHubs");
    await mount(<PendingWindow kind="event" uid="ev77" onClose={() => {}} />);
    expect(container.textContent).toContain("老街聯名小攤");
    expect(container.textContent).toContain("出資佈置攤位");
  });

  it("待決事件視窗顯示選項與「沒人回應就會…」", async () => {
    const { EVENT_BY_ID } = await import("@coidle/shared");
    store.state.value = publicState(0, (s) => {
      s.pending.push({ uid: "ev99", defId: "rival_sale", deadlineTick: s.tick + 500 });
    });
    const { PendingWindow } = await import("./ui/hubs/GameHubs");
    await mount(<PendingWindow kind="event" uid="ev99" onClose={() => {}} />);
    expect(container.textContent).toContain(EVENT_BY_ID.rival_sale!.title);
    expect(container.textContent).toContain("跟進促銷");
    expect(container.textContent).toContain("沒人回應就會");
  });

  it("已經處理掉的事件，視窗會說明而不是壞掉", async () => {
    store.state.value = publicState(0);
    const { PendingWindow } = await import("./ui/hubs/GameHubs");
    await mount(<PendingWindow kind="event" uid="gone" onClose={() => {}} />);
    expect(container.textContent).toContain("已經處理完了");
  });

  it("稽查預告出現在待辦中心與稽查視窗", async () => {
    store.state.value = publicState(0, (s) => {
      s.inspections.pending.push({ uid: "ins3", kind: "hygiene", notifiedTick: s.tick, inspectTick: s.tick + 60, prep: null });
    });
    const { buildAttention } = await import("./ui/attention");
    const item = buildAttention(store.state.value!, 1).find((i) => i.id === "inspection:ins3")!;
    expect(item.title).toContain("衛生單位預告");
    expect(item.target).toEqual({ kind: "inspection", uid: "ins3" });
    const { PendingWindow } = await import("./ui/hubs/GameHubs");
    await mount(<PendingWindow kind="inspection" uid="ins3" onClose={() => {}} />);
    expect(container.textContent).toContain("衛生單位預告");
  });

  it("主力供應商出狀況會進待辦中心，並說明是哪一家、什麼狀況", async () => {
    store.state.value = publicState(0, (s) => {
      const m = s.supply.suppliers.find((x) => x.id === "sea_naniwa")!;
      m.status = "shortage";
      m.statusUntil = s.tick + 100;
    });
    const { buildAttention } = await import("./ui/attention");
    const it = buildAttention(store.state.value!, 1).find((i) => i.id.startsWith("supplier:"))!;
    expect(it.title).toContain("浪花水產");
    expect(it.title).toContain("出貨吃緊");
    expect(it.target).toEqual({ kind: "hub", hub: "operate", tab: "supply" });
  });

  it("客人事件與評價歸在「客人」樞紐，不混進其他提醒", async () => {
    store.state.value = publicState(0, (s) => {
      s.pending.push({ uid: "ev61", defId: "lost_child", deadlineTick: s.tick + 100 });
      s.inbox.push({ uid: "in3", kind: "review", createdTick: s.tick, deadlineTick: s.tick + 100, shopId: null, persona: "local", text: "ok", stars: 4 });
    });
    const { buildAttention, hubBadges, hubOfItem } = await import("./ui/attention");
    const items = buildAttention(store.state.value!, 1);
    const ev = items.find((i) => i.id === "event:ev61")!;
    expect(hubOfItem(ev)).toBe("guests");
    expect(hubOfItem(items.find((i) => i.id === "inbox:in3")!)).toBe("guests");
    expect(hubBadges(items).guests).toBe(1); // 只有需要決定的事件算徽章；評價只是機會
  });

  it("財務總覽顯示星級評鑑", async () => {
    store.state.value = publicState(1);
    const { FinanceSummary } = await import("./screens/FinanceSummary");
    await mount(<FinanceSummary />);
    expect(container.textContent).toMatch(/★/);
  });

  it("ShopSheet 顯示定價、庫存與自動補貨、新鮮感、升級", async () => {
    store.state.value = publicState(2);
    const shop = store.state.value!.shops.find((x) => x.name === "串八")!;
    const { ShopSheet } = await import("./screens/ShopSheet");
    await mount(<ShopSheet shopId={shop.id} onClose={() => {}} />);
    for (const t of ["定價", "庫存與自動補貨", "新鮮感", "翻新升級"]) expect(document.body.textContent).toContain(t);
  });

  it("BuildSheet 列出該區域的業態與價格", async () => {
    store.state.value = publicState(2);
    const free = store.state.value!.slots.find((x) => x.zone === "b1" && !x.shopId)!;
    const { BuildSheet } = await import("./screens/BuildSheet");
    await mount(<BuildSheet slotId={free.id} onClose={() => {}} />);
    expect(document.body.textContent).toContain("招商開店");
    expect(document.body.textContent).toContain("烏龍麵");
  });

  it("旗標強制開放的區域：該層有 10 個空店面格，不再鎖定", async () => {
    store.state.value = publicState(1, (s) => {
      s.flags["zone:f1"] = true;
    });
    const { toStageModel } = await import("./stage/adapter");
    const f1 = toStageModel(store.state.value!).floors.find((f) => f.id === "f1")!;
    expect(f1.lockedLevel).toBeNull();
    expect(f1.lots).toHaveLength(10);
    expect(f1.lots.every((l) => l.shop === null)).toBe(true);
  });

  it("每個業態都有圖示", async () => {
    const { CATEGORIES } = await import("@coidle/shared");
    const { categoryIcon } = await import("./icons");
    for (const c of CATEGORIES) expect(categoryIcon(c.id), c.id).not.toBe("🏬");
  });

  it("說明頁的「重看新手提示」會重置提示並通知", async () => {
    store.state.value = publicState(0);
    store.toasts.value = [];
    const { markSeen, loadSeen } = await import("./ui/hints");
    markSeen(1, 1, "h_dock");
    expect(loadSeen(1, 1).has("h_dock")).toBe(true);
    const { Help } = await import("./screens/Help");
    await mount(<Help />);
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "重看新手提示") as HTMLElement;
    btn.click();
    await tick();
    expect(loadSeen(1, 1).has("h_dock")).toBe(false);
    expect(store.toasts.value.some((t) => t.text.includes("提示已重置"))).toBe(true);
  });
});

describe("format helpers", () => {
  it("formats money and real durations", async () => {
    const f = await import("./format");
    expect(f.money(1234567)).toBe("¥1,234,567");
    expect(f.moneyShort(12_345_678)).toBe("¥12.3M");
    expect(f.moneyShort(-250_000)).toBe("-¥250k");
    expect(f.realDuration(144)).toBe("約 3 小時"); // 144 ticks = 12 遊戲小時 = 3 真實小時
    expect(f.realDuration(12)).toBe("約 15 分鐘");
  });
});

describe("stage UI panels with real state", () => {
  const originalFetch = globalThis.fetch;
  let calls: { url: string; body: any }[] = [];

  /** 把 fetch 換掉：記下送出的指令，並回傳指定的狀態 */
  function stubFetch(reply: () => unknown) {
    calls = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(reply()), { status: 200 });
    }) as typeof fetch;
  }

  beforeEach(() => {
    store.mallId.value = 1;
    store.user.value = { id: 1, username: "u", displayName: "我" };
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  async function floorOf(zoneIndex = 0) {
    const { toStageModel } = await import("./stage/adapter");
    return toStageModel(store.state.value!, 1).floors[zoneIndex]!;
  }

  it("RealShopPanel shows the real shop and sends setPrice to the server", async () => {
    store.state.value = publicState(0);
    stubFetch(() => store.state.value);
    const shop = store.state.value!.shops.find((x) => x.mode === "direct")!;
    const { RealShopPanel } = await import("./ui/RealShopPanel");
    await mount(<RealShopPanel slot={shop.slot} floor={await floorOf()} onClose={() => {}} openHub={() => {}} openSheet={() => {}} />);
    expect(container.textContent).toContain(shop.name);
    expect(container.textContent).toContain("售價");
    expect(container.textContent).toContain("升級到 Lv.2");

    const plus = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "＋") as HTMLElement;
    plus.click();
    await tick();
    const apply = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "套用") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    apply.click();
    await tick();
    await tick();
    const call = calls.find((c) => c.url.endsWith("/commands"))!;
    expect(call.body.command.type).toBe("setPrice");
    expect(call.body.command.shopId).toBe(shop.id);
    expect(call.body.command.price).toBeGreaterThan(shop.price);
  });

  it("RealShopPanel offers an order button when out of stock, and sends orderStock", async () => {
    const { CATEGORY_BY_ID, categoryHasStock } = await import("@coidle/shared");
    store.state.value = publicState(0, (s) => {
      const sh = s.shops.find((x) => x.mode === "direct" && categoryHasStock(CATEGORY_BY_ID[x.category]!))!;
      sh.stock = 0;
      sh.incoming = [];
    });
    stubFetch(() => store.state.value);
    const shop = store.state.value!.shops.find((x) => x.stock === 0)!;
    const { RealShopPanel } = await import("./ui/RealShopPanel");
    await mount(<RealShopPanel slot={shop.slot} floor={await floorOf()} onClose={() => {}} openHub={() => {}} openSheet={() => {}} />);
    expect(container.textContent).toContain("缺貨中");
    const order = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("補 50 份")) as HTMLElement;
    order.click();
    await tick();
    await tick();
    const call = calls.find((c) => c.url.endsWith("/commands"))!;
    expect(call.body.command).toMatchObject({ type: "orderStock", shopId: shop.id, qty: 50 });
  });

  it("RealShopPanel: locked floors explain the unlock level; building lots show progress", async () => {
    store.state.value = publicState(0, (s) => {
      const free = s.slots.find((x) => x.zone === "b1" && !x.shopId)!;
      s.builds.push({ id: "bx", kind: "open", slot: free.id, category: "ramen", completeTick: s.tick + 40, cost: 1 });
    });
    const { RealShopPanel } = await import("./ui/RealShopPanel");
    const locked = await floorOf(1);
    await mount(<RealShopPanel slot={locked.lots[0]!.slot} floor={locked} onClose={() => {}} openHub={() => {}} openSheet={() => {}} />);
    expect(container.textContent).toContain("尚未解鎖");
    expect(container.textContent).toContain(`Lv.${locked.lockedLevel}`);

    const b1 = await floorOf(0);
    const building = b1.lots.find((l) => l.shop?.state === "building")!;
    await mount(<RealShopPanel slot={building.slot} floor={b1} onClose={() => {}} openHub={() => {}} openSheet={() => {}} />);
    expect(container.textContent).toContain("施工進度");
  });

  it("GameHub: 營運有 4 個分頁、摘要與徽章；指定分頁會直接打開", async () => {
    store.state.value = publicState(0);
    const { GameHub } = await import("./ui/hubs/GameHubs");
    await mount(<GameHub hub="operate" tab="facility" badges={{ facility: 2 }} onClose={() => {}} />);
    const tabs = Array.from(container.querySelectorAll(".st-tabs button")).map((b) => b.textContent);
    expect(tabs).toEqual(["營業時間", "補貨與供應", "行銷", "設備與稽查 (2)"]);
    expect(container.querySelector(".st-tabs button.on")?.textContent).toContain("設備與稽查");
    expect(container.textContent).toContain("清潔等級");
    expect(container.querySelector(".st-win-sum")?.textContent).toContain("營業");
  });

  it("GameHub: 還沒開放的分頁先隱藏，升級後出現；樞紐內只剩一個分頁時不顯示分頁列", async () => {
    const { GameHub } = await import("./ui/hubs/GameHubs");
    store.state.value = publicState(0);
    await mount(<GameHub key="d1" hub="develop" badges={{}} onClose={() => {}} />);
    expect(container.querySelector(".st-tabs")).toBeNull(); // 只有研發工坊
    expect(container.textContent).toContain("選好素材就能開始試做新菜"); // 工坊的內容

    store.state.value = publicState(0, (s) => (s.level = 3));
    await mount(<GameHub key="d3" hub="develop" badges={{}} onClose={() => {}} />);
    expect(Array.from(container.querySelectorAll(".st-tabs button")).map((b) => b.textContent)).toEqual(["研發工坊", "科技", "招商"]);
  });

  it("GameHub: 想開的分頁還沒開放時退回第一個可見分頁", async () => {
    store.state.value = publicState(0);
    const { GameHub } = await import("./ui/hubs/GameHubs");
    await mount(<GameHub key="f1" hub="finance" tab="tax" badges={{}} onClose={() => {}} />);
    expect(container.querySelector(".st-tabs")).toBeNull(); // 資金與損益是唯一可見分頁
    expect(container.textContent).toContain("口碑與狀態");
  });

  it("全部功能：列出所有分頁，沒開放的附解鎖說明，開放的可以開啟", async () => {
    store.state.value = publicState(0);
    const { MenuWindow } = await import("./ui/hubs/GameHubs");
    const opened: string[] = [];
    await mount(<MenuWindow page="all" onClose={() => {}} onOpenHub={(h, t) => opened.push(`${h}.${t}`)} />);
    expect(container.textContent).toContain("科技");
    expect(container.textContent).toContain("Lv.2 開放");
    expect(container.textContent).toContain("稅務與帳單");
    const open = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "開啟");
    expect(open.length).toBeGreaterThan(3);
    (open[0] as HTMLElement).click();
    expect(opened).toHaveLength(1);
  });

  it("財務總覽只有數字與狀態，不重複提醒卡", async () => {
    store.state.value = publicState(2);
    const { FinanceSummary } = await import("./screens/FinanceSummary");
    await mount(<FinanceSummary />);
    expect(container.textContent).toContain("資金");
    expect(container.textContent).toContain("累計營收");
    expect(container.textContent).toContain("在地口碑");
    expect(container.textContent).not.toContain("新手任務");
    expect(container.querySelector(".alert")).toBeNull();
  });

  it("每日快訊彈窗顯示最新日報的標題與重點", async () => {
    store.state.value = publicState(2);
    const last = store.state.value!.reports[store.state.value!.reports.length - 1]!;
    const { ReportPopup } = await import("./ui/hubs/GameHubs");
    let opened = false;
    await mount(<ReportPopup onClose={() => {}} onOpenReports={() => (opened = true)} />);
    expect(container.textContent).toContain(last.headline);
    expect(container.textContent).toContain(last.date);
    expect(container.textContent).toContain(`${last.weather!.temp}°`); // 快訊也帶天氣
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "看完整日報") as HTMLElement;
    btn.click();
    expect(opened).toBe(true);
  });

  it("設定視窗：遊戲時間與商場帳號兩個分頁", async () => {
    store.state.value = publicState(0);
    store.mallInfo.value = { id: 1, name: "測試", inviteCode: "ABCD2345", members: [{ userId: 1, displayName: "我", role: "gm", isOwner: true, joinedAt: 0 }] };
    const { MenuWindow } = await import("./ui/hubs/GameHubs");
    await mount(<MenuWindow page="settings" onClose={() => {}} onOpenHub={() => {}} />);
    expect(container.textContent).toContain("時間流速");
    const tab = Array.from(container.querySelectorAll(".st-tabs button")).find((b) => b.textContent === "商場與帳號") as HTMLElement;
    tab.click();
    await tick();
    expect(container.textContent).toContain("登出");
    expect(container.textContent).toContain("切換商場");
  });

  it("AttentionCenter renders real items grouped by severity and reports the clicked item", async () => {
    store.state.value = publicState(0, (s) => {
      s.funds = -500;
    });
    const { buildAttention } = await import("./ui/attention");
    const { AttentionCenter } = await import("./ui/AttentionCenter");
    const items = buildAttention(store.state.value!, 1);
    let got: string | null = null;
    await mount(<AttentionCenter items={items} onClose={() => {}} onAct={(it) => (got = it.id)} />);
    expect(container.textContent).toContain("緊急");
    expect(container.textContent).toContain("帳上資金為負");
    (container.querySelector(".st-item.urgent button") as HTMLElement).click();
    expect(got).toBe("funds-negative");
  });

  it("Dock shows hub badges from the attention list", async () => {
    store.state.value = publicState(0, (s) => {
      s.cleanliness = 10;
    });
    const { buildAttention, hubBadges } = await import("./ui/attention");
    const { Dock } = await import("./ui/Dock");
    const badges = hubBadges(buildAttention(store.state.value!, 1));
    await mount(<Dock active={null} badges={badges} onPick={() => {}} />);
    const operate = container.querySelectorAll(".st-dock button")[0]!;
    expect(operate.textContent).toContain("營運");
    expect(operate.querySelector(".st-badge")?.textContent).toBe(String(badges.operate));
  });
});
