// @vitest-environment happy-dom
import { render } from "preact";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  store = await import("./store");
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
