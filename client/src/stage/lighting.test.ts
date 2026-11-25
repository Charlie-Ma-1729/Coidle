import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CROWD_CAP, FPS_CAP, FX, PerfGovernor, dayTint, dropCount, lampLevel, lampWithWeather, nextFlashDelay, stageTint } from "./lighting";

const at = (h: number, m = 0) => h * 60 + m;

describe("dayTint：一天的色調", () => {
  it("白天（中午）沒有色罩；深夜是深藍", () => {
    expect(dayTint(at(12)).alpha).toBe(0);
    const night = dayTint(at(2));
    expect(night.alpha).toBeGreaterThan(0.4);
    expect(night.color).toBe(0x0a1038);
  });

  it("黃昏偏暖橘、再轉深藍；清晨偏暖", () => {
    const dusk = dayTint(at(17, 30));
    expect(dusk.color).toBe(0xff8a4a);
    expect(dusk.alpha).toBeGreaterThan(0.1);
    expect(dayTint(at(19)).alpha).toBeGreaterThan(dusk.alpha);
    expect(dayTint(at(21)).alpha).toBeGreaterThan(dayTint(at(19)).alpha);
    const dawn = dayTint(at(6, 30));
    expect(dawn.color).toBe(0xff9a5a);
  });

  it("連續：相鄰兩分鐘的變化很小，午夜前後接得起來", () => {
    for (let m = 0; m < 1440; m++) {
      const a = dayTint(m).alpha;
      const b = dayTint(m + 1).alpha;
      expect(Math.abs(a - b)).toBeLessThan(0.01);
    }
    expect(Math.abs(dayTint(0).alpha - dayTint(1439).alpha)).toBeLessThan(0.02);
  });

  it("超過 24 小時也能換算（時鐘用分鐘數）", () => {
    expect(dayTint(at(12) + 1440).alpha).toBe(dayTint(at(12)).alpha);
  });
});

describe("lampLevel：燈光亮度", () => {
  it("白天 0、夜晚 1，傍晚漸亮、清晨漸暗", () => {
    expect(lampLevel(at(12))).toBe(0);
    expect(lampLevel(at(22))).toBe(1);
    expect(lampLevel(at(3))).toBe(1);
    const a = lampLevel(at(17));
    const b = lampLevel(at(18));
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(lampLevel(at(7))).toBeLessThan(lampLevel(at(6)));
  });
});

describe("stageTint：商場打烊時更暗", () => {
  it("營業中的中午沒有色罩；同一個中午若不在營業時間（例如 13 點才開）就暗下來", () => {
    expect(stageTint(at(12), 10, 22).alpha).toBe(0);
    const closed = stageTint(at(12), 13, 22);
    expect(closed.alpha).toBeGreaterThanOrEqual(0.42);
  });

  it("夜晚打烊後不比營業中亮", () => {
    expect(stageTint(at(23), 10, 22).alpha).toBeGreaterThanOrEqual(dayTint(at(23)).alpha);
  });
});

describe("天氣對天色與燈光", () => {
  it("同一個中午：陰、雨、颱風依序更暗；晴天不變", () => {
    const a = (k: "clear" | "cloudy" | "rain" | "storm") => stageTint(at(12), 10, 22, k).alpha;
    expect(a("clear")).toBe(0);
    expect(a("cloudy")).toBeGreaterThan(0);
    expect(a("rain")).toBeGreaterThan(a("cloudy"));
    expect(a("storm")).toBeGreaterThan(a("rain"));
    expect(a("storm")).toBeLessThan(0.5); // 白天再暗也還看得到
  });

  it("陰雨天白天也會開燈；颱風天幾乎全亮；晴天白天不開；夜裡不會被天氣變暗", () => {
    expect(lampWithWeather(at(12), "clear")).toBe(0);
    expect(lampWithWeather(at(12), "rain")).toBeGreaterThan(0.3);
    expect(lampWithWeather(at(12), "storm")).toBeGreaterThan(0.8);
    expect(lampWithWeather(at(23), "clear")).toBe(1);
  });
});

describe("天氣特效參數", () => {
  it("雨與颱風有雨絲，颱風更多更快更斜、有閃電；晴陰沒有雨絲", () => {
    expect(FX.clear.drops).toBe(0);
    expect(FX.cloudy.drops).toBe(0);
    expect(FX.storm.drops).toBeGreaterThan(FX.rain.drops);
    expect(FX.storm.speed).toBeGreaterThan(FX.rain.speed);
    expect(FX.storm.slant).toBeGreaterThan(FX.rain.slant);
    expect(FX.storm.flash).not.toBeNull();
    expect(FX.rain.flash).toBeNull();
    expect(FX.clear.beams).toBe(true);
  });

  it("雨絲數量：效能降級時減少；露天樓層（整層淋雨）更多；沒下雨是 0", () => {
    expect(dropCount("clear", 0, false)).toBe(0);
    expect(dropCount("rain", 1, false)).toBeLessThan(dropCount("rain", 0, false));
    expect(dropCount("rain", 2, false)).toBeLessThan(dropCount("rain", 1, false));
    expect(dropCount("rain", 0, true)).toBeGreaterThan(dropCount("rain", 0, false));
  });

  it("閃電間隔落在設定範圍內；沒有閃電的天氣是 Infinity", () => {
    const [lo, hi] = FX.storm.flash!;
    for (const r of [0, 0.5, 0.999]) {
      const d = nextFlashDelay("storm", r);
      expect(d).toBeGreaterThanOrEqual(lo);
      expect(d).toBeLessThanOrEqual(hi);
    }
    expect(nextFlashDelay("rain", 0.5)).toBe(Infinity);
  });
});

describe("PerfGovernor：效能吃緊時降級", () => {
  it("幀率正常就維持全開", () => {
    const g = new PerfGovernor();
    for (let i = 0; i < 60; i++) g.sample(60);
    expect(g.level).toBe(0);
  });

  it("連續 3 秒低於 40 fps 才降一級；偶爾掉一下不算", () => {
    const g = new PerfGovernor();
    g.sample(20);
    g.sample(20);
    g.sample(60); // 恢復：計數歸零
    g.sample(20);
    g.sample(20);
    expect(g.level).toBe(0);
    g.sample(20);
    expect(g.level).toBe(1);
  });

  it("可以一路降到 2 級（人潮減半以上、幀率上限 30），但不會再往下", () => {
    const g = new PerfGovernor();
    for (let i = 0; i < 30; i++) g.sample(15);
    expect(g.level).toBe(2);
    expect(CROWD_CAP[2]).toBeLessThan(CROWD_CAP[0]);
    expect(FPS_CAP[2]).toBe(30);
  });

  it("2 級時幀率貼著 30 上限是正常的，不會繼續誤判", () => {
    const g = new PerfGovernor();
    for (let i = 0; i < 10; i++) g.sample(15);
    expect(g.level).toBe(2);
    for (let i = 0; i < 10; i++) g.sample(30);
    expect(g.level).toBe(2);
  });

  it("穩定很久才升回來，一次升一級", () => {
    const g = new PerfGovernor();
    for (let i = 0; i < 10; i++) g.sample(15);
    expect(g.level).toBe(2);
    for (let i = 0; i < 19; i++) g.sample(30);
    expect(g.level).toBe(2);
    g.sample(30);
    expect(g.level).toBe(1);
  });
});

describe("正式環境的 CSP", () => {
  // 伺服器的 CSP 是 script-src 'self'，沒有 unsafe-eval。Pixi 預設會用 new Function，
  // 在正式環境整個畫面會壞掉（開發模式沒有 CSP，看不出來）。曾經真的發生過，所以守住。
  const scene = readFileSync(new URL("./scene.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../../../server/src/static.ts", import.meta.url), "utf8");

  it("場景載入 Pixi 前，先載入不用 eval 的實作", () => {
    const unsafe = scene.indexOf('import "pixi.js/unsafe-eval"');
    const pixi = scene.indexOf('from "pixi.js"');
    expect(unsafe).toBeGreaterThanOrEqual(0);
    expect(unsafe).toBeLessThan(pixi);
  });

  it("伺服器的 CSP 沒有開放 unsafe-eval（所以上面那條必須成立）", () => {
    const script = /script-src ([^;]*);/.exec(server)?.[1] ?? "";
    expect(script).toBe("'self'");
  });

  it("Pixi 只由延遲載入的場景區塊引入，登入頁不用下載它", () => {
    const hook = readFileSync(new URL("./useStage.ts", import.meta.url), "utf8");
    expect(hook).toContain('import("./scene")');
    expect(hook).not.toMatch(/import \{[^}]*\} from "\.\/scene"/);
  });
});
