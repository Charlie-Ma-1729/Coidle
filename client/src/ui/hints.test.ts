import { beforeEach, describe, expect, it } from "vitest";
import { TICKS_PER_DAY, TICK_MINUTES, type PublicMallState } from "@coidle/shared";
import { advanceTo, createInitialState } from "../../../server/src/sim";
import { buildAttention } from "./attention";
import { HINTS, OFF, disableHints, hintsVersion, loadSeen, markSeen, pickHint, resetHints, type HintCtx } from "./hints";

const START = (Date.UTC(2026, 2, 2) - 9 * 3_600_000) / (TICK_MINUTES * 60_000);
type Mutable = ReturnType<typeof createInitialState>;
function stateAt(days: number, mutate?: (s: Mutable) => void): PublicMallState {
  let s = createInitialState(7, START);
  s = advanceTo(s, START + days * TICKS_PER_DAY + 30);
  mutate?.(s);
  const { seed: _seed, cooldowns: _cd, ...rest } = s;
  return rest;
}
const ctx = (s: PublicMallState, seen: string[] = [], hasEmptyLot = false): HintCtx => ({ s, attention: buildAttention(s, 1), hasEmptyLot, seen: new Set(seen) });

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("pickHint", () => {
  it("一開始依序講基本操作：點店面 → 管理選單 → 鈴鐺 → 時間", () => {
    const s = stateAt(0);
    const seen: string[] = [];
    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
      const h = pickHint(ctx(s, seen));
      if (!h) break;
      order.push(h.id);
      seen.push(h.id);
    }
    expect(order).toEqual(["h_tap_shop", "h_dock", "h_bell", "h_time"]);
  });

  it("每次只給一則；看過的不再出現；全部看完就沒有了", () => {
    const s = stateAt(0);
    const all = HINTS.map((h) => h.id);
    expect(pickHint(ctx(s, all))).toBeNull();
    expect(pickHint(ctx(s, [OFF]))).toBeNull();
  });

  it("遇到狀況時，狀況提示優先於基本操作", () => {
    const stock = stateAt(0, (s) => {
      for (const sh of s.shops) {
        sh.stock = 0;
        sh.incoming = [];
      }
    });
    expect(pickHint(ctx(stock))!.id).toBe("h_stockout");

    const complaint = stateAt(0, (s) => {
      s.inbox = [{ uid: "c", kind: "complaint", createdTick: 0, deadlineTick: 99, shopId: null, persona: "local" as never, text: "慢", cause: undefined }];
    });
    expect(pickHint(ctx(complaint))!.id).toBe("h_complaint");
  });

  it("缺貨提示看過一次後不再重複，改講下一個", () => {
    const stock = stateAt(0, (s) => {
      for (const sh of s.shops) {
        sh.stock = 0;
        sh.incoming = [];
      }
    });
    expect(pickHint(ctx(stock, ["h_stockout"]))!.id).toBe("h_tap_shop");
  });

  it("有空地而且付得起才提示開店；日報出爐後提示日報", () => {
    expect(pickHint(ctx(stateAt(0), ["h_tap_shop", "h_dock", "h_bell", "h_time"], true))!.id).toBe("h_build");
    expect(pickHint(ctx(stateAt(0, (s) => (s.funds = 1000)), ["h_tap_shop", "h_dock", "h_bell", "h_time"], true))).toBeNull();
    expect(pickHint(ctx(stateAt(2)))!.id).toBe("h_report");
  });

  it("每則提示都有標題與內文、id 唯一", () => {
    expect(new Set(HINTS.map((h) => h.id)).size).toBe(HINTS.length);
    for (const h of HINTS) {
      expect(h.title.length).toBeGreaterThan(0);
      expect(h.text.length).toBeGreaterThan(10);
    }
  });
});

describe("提示的儲存", () => {
  it("依使用者與商場分開記錄；標記、全部關閉、重置都會通知畫面", () => {
    const v0 = hintsVersion.value;
    markSeen(5, 9, "h_dock");
    expect([...loadSeen(5, 9)]).toEqual(["h_dock"]);
    expect(loadSeen(5, 10).size).toBe(0);
    expect(loadSeen(6, 9).size).toBe(0);

    disableHints(5, 9);
    expect(loadSeen(5, 9).has(OFF)).toBe(true);
    expect(hintsVersion.value).toBeGreaterThan(v0);

    resetHints(5, 9);
    expect(loadSeen(5, 9).size).toBe(0);
  });

  it("localStorage 壞掉時不會丟錯", () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(() => loadSeen(1, 1)).not.toThrow();
    expect(() => markSeen(1, 1, "x")).not.toThrow();
    expect(() => resetHints(1, 1)).not.toThrow();
  });
});
