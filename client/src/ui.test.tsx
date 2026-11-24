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
  it("Overview shows key numbers", async () => {
    store.state.value = publicState(3);
    const { Overview } = await import("./screens/Overview");
    await mount(<Overview />);
    expect(container.textContent).toContain("資金");
    expect(container.textContent).toContain("在地口碑");
    expect(container.textContent).toContain("商場快訊");
  });

  it("Overview shows pending event choices with a countdown", async () => {
    const { EVENT_BY_ID } = await import("@coidle/shared");
    store.state.value = publicState(0, (s) => {
      s.pending.push({ uid: "ev99", defId: "rival_sale", deadlineTick: s.tick + 500 });
    });
    const { Overview } = await import("./screens/Overview");
    await mount(<Overview />);
    expect(container.textContent).toContain(EVENT_BY_ID.rival_sale!.title);
    expect(container.textContent).toContain("跟進促銷");
    expect(container.textContent).toContain("沒人回應就會");
  });

  it("Floor lists shops, locked zones and opens shop/build sheets", async () => {
    store.state.value = publicState(2);
    const { Floor } = await import("./screens/Floor");
    await mount(<Floor />);
    expect(container.textContent).toContain("串八");
    expect(container.textContent).toContain("空店面");

    // 開啟店鋪詳情
    const shopTile = Array.from(container.querySelectorAll("button.slot")).find((b) => b.textContent?.includes("串八")) as HTMLElement;
    shopTile.click();
    await tick();
    expect(document.body.textContent).toContain("定價");
    expect(document.body.textContent).toContain("庫存與自動補貨");
    expect(document.body.textContent).toContain("新鮮感");
    (document.querySelector(".sheet .icon-btn") as HTMLElement).click();
    await tick();
    expect(document.querySelector(".sheet")).toBeNull();

    // 開啟開店清單
    (container.querySelector("button.empty-slot") as HTMLElement).click();
    await tick();
    expect(document.body.textContent).toContain("招商開店");
    expect(document.body.textContent).toContain("烏龍麵");
    (document.querySelector(".sheet .icon-btn") as HTMLElement).click();
    await tick();

    // 未解鎖的區域顯示鎖頭
    const f1Tab = Array.from(container.querySelectorAll(".zone-tab")).find((b) => b.textContent?.includes("1F")) as HTMLElement;
    f1Tab.click();
    await tick();
    expect(container.textContent).toContain("Lv.2");
    expect(container.textContent).toContain("後開放");
  });

  it("Floor shows an unlocked zone when its flag is on", async () => {
    store.state.value = publicState(1, (s) => {
      s.flags["zone:f1"] = true;
    });
    const { Floor } = await import("./screens/Floor");
    await mount(<Floor />);
    const f1Tab = Array.from(container.querySelectorAll(".zone-tab")).find((b) => b.textContent?.includes("1F")) as HTMLElement;
    f1Tab.click();
    await tick();
    expect(container.querySelectorAll("button.empty-slot").length).toBe(8);
  });

  it("Reports renders after a few days", async () => {
    store.state.value = publicState(4);
    const { Reports } = await import("./screens/Reports");
    await mount(<Reports />);
    expect(container.textContent).toContain("每日利潤");
    expect(container.textContent).toContain("各類客人滿意度");
    expect(container.querySelectorAll(".bars .bar").length).toBeGreaterThanOrEqual(3);
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
    expect(container.textContent).toContain("有重要事件等你決定");
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

  it("Overview points to the Guests tab instead of listing guest events", async () => {
    store.state.value = publicState(0, (s) => {
      s.pending.push({ uid: "ev61", defId: "lost_child", deadlineTick: s.tick + 100 });
      s.inbox.push({ uid: "in3", kind: "review", createdTick: s.tick, deadlineTick: s.tick + 100, shopId: null, persona: "local", text: "ok", stars: 4 });
    });
    const { Overview } = await import("./screens/Overview");
    await mount(<Overview />);
    expect(container.textContent).toContain("客人那邊有 2 件事等你");
    expect(container.textContent).not.toContain("走失的小朋友");
  });

  it("More switches between ops and team", async () => {
    store.state.value = publicState(0);
    store.user.value = { id: 1, username: "u", displayName: "我" };
    store.mallId.value = 1;
    store.mallInfo.value = { id: 1, name: "測試", inviteCode: "ABCD2345", members: [{ userId: 1, displayName: "我", role: "gm", isOwner: true, joinedAt: 0 }] };
    const { More } = await import("./screens/More");
    const nav = await import("./nav");
    nav.moreSub.value = "ops";
    await mount(<More />);
    expect(container.textContent).toContain("時間流速");
    nav.moreSub.value = "team";
    await tick();
    expect(container.textContent).toContain("ABCD2345");
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
