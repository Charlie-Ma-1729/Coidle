import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_CLOCK } from "../time";
import { dayOfYmd } from "../calendar";
import {
  AM_END,
  AM_OPEN,
  PM_END,
  PM_OPEN,
  TRADING_STEPS_PER_DAY,
  isTradingDay,
  marketStatus,
  nextOpenGstep,
  openOrdinal,
  sessionOfStep,
  stepOfOrdinal,
  dayOfGstep,
  gstepOf,
  lastOpenGstep,
  tradingDayIndex,
  tradingDayAt,
} from "./exchange";
import { PriceEngineV2, PRICE_LIMIT, dw40, dwpix, isExDividendDay } from "./engine";
import { NewsEngine } from "./news";
import { STOCK_GROUPS, LEGACY_STOCK_COUNT, stockGroupOf, dividendPerShare } from "./stocks";

const day = (y: number, m: number, d: number) => dayOfYmd(y, m, d);
const REAL0 = Date.UTC(2026, 10, 24, 0, 0, 0); // 預設時鐘錨點：遊戲 2027-04-01 00:00 JST

describe("交易所時間", () => {
  it("交易日：平日、非國定假日、非 12/31–1/3", () => {
    expect(isTradingDay(day(2027, 4, 1))).toBe(true); // 週四
    expect(isTradingDay(day(2027, 4, 3))).toBe(false); // 週六
    expect(isTradingDay(day(2027, 4, 4))).toBe(false); // 週日
    expect(isTradingDay(day(2027, 4, 29))).toBe(false); // 昭和之日
    expect(isTradingDay(day(2027, 5, 3))).toBe(false); // 憲法紀念日
    expect(isTradingDay(day(2027, 12, 31))).toBe(false);
    expect(isTradingDay(day(2028, 1, 3))).toBe(false);
    expect(isTradingDay(day(2028, 1, 4))).toBe(true);
    // 黃金週的平日若不是國定假日，東證照開（公司放假的日子不等於休市）
    expect(isTradingDay(day(2027, 5, 6))).toBe(true);
  });

  it("時段邊界與步數：9:00–11:30、12:30–15:30 共 110 步", () => {
    expect(sessionOfStep(AM_OPEN - 1)).toBe("pre");
    expect(sessionOfStep(AM_OPEN)).toBe("am");
    expect(sessionOfStep(AM_END - 1)).toBe("am");
    expect(sessionOfStep(AM_END)).toBe("lunch");
    expect(sessionOfStep(PM_OPEN - 1)).toBe("lunch");
    expect(sessionOfStep(PM_OPEN)).toBe("pm");
    expect(sessionOfStep(PM_END - 1)).toBe("pm");
    expect(sessionOfStep(PM_END)).toBe("after");
    expect(AM_OPEN * 3).toBe(9 * 60);
    expect(AM_END * 3).toBe(11 * 60 + 30);
    expect(PM_OPEN * 3).toBe(12 * 60 + 30);
    expect(PM_END * 3).toBe(15 * 60 + 30);
    expect(TRADING_STEPS_PER_DAY).toBe(110);
    for (let k = 0; k < TRADING_STEPS_PER_DAY; k++) expect(openOrdinal(stepOfOrdinal(k))).toBe(k);
    expect(openOrdinal(AM_END)).toBe(-1);
  });

  it("真實時間換成市場狀態（1 真實分鐘＝6 遊戲分鐘；價格步 30 真實秒）", () => {
    const at = (min: number) => marketStatus(REAL0 + min * 60_000, DEFAULT_SERVER_CLOCK);
    // 遊戲 9:00＝真實第 90 分鐘
    expect(at(89).session).toBe("pre");
    expect(at(89).open).toBe(false);
    expect(at(90).session).toBe("am");
    expect(at(90).open).toBe(true);
    expect(at(90).clock).toBe("09:00");
    expect(at(114).session).toBe("am");
    expect(at(115).session).toBe("lunch");
    expect(at(125).session).toBe("pm");
    expect(at(154).session).toBe("pm");
    expect(at(155).session).toBe("after");
    // 前場中：下一個開盤是後場（真實第 125 分鐘）；收盤後：下一個交易日 9:00
    expect(at(100).nextOpenAt).toBe(REAL0 + 125 * 60_000);
    expect(at(100).nextCloseAt).toBe(REAL0 + 115 * 60_000);
    expect(at(160).nextOpenAt).toBe(REAL0 + (240 + 90) * 60_000); // 4/2（週五）
    // 一個遊戲日＝240 真實分鐘；4/3、4/4 休市，下個週一（4/5）開盤
    const fri = at(240 + 160); // 4/2 收盤後
    expect(fri.nextOpenAt).toBe(REAL0 + (4 * 240 + 90) * 60_000);
    const sat = at(2 * 240 + 100);
    expect(sat.session).toBe("closed");
    expect(sat.reason).toBe("週六休市");
  });

  it("lastOpenGstep：休市時指向最近一個開市步", () => {
    const d = day(2027, 4, 1);
    expect(lastOpenGstep(gstepOf(d, AM_OPEN + 3))).toBe(gstepOf(d, AM_OPEN + 3));
    expect(lastOpenGstep(gstepOf(d, AM_END + 2))).toBe(gstepOf(d, AM_END - 1));
    expect(lastOpenGstep(gstepOf(d, PM_END + 20))).toBe(gstepOf(d, PM_END - 1));
    expect(lastOpenGstep(gstepOf(d + 1, 10))).toBe(gstepOf(d, PM_END - 1)); // 4/2 開盤前
    expect(dayOfGstep(nextOpenGstep(gstepOf(d + 2, 100)))).toBe(day(2027, 4, 5)); // 週六 → 週一
    expect(tradingDayAt(tradingDayIndex(d))).toBe(d);
  });
});

describe("股價引擎 v2", () => {
  const start = REAL0 + 60_000; // 切換點：第 1 分鐘（開盤前）
  const mk = (seed = 12345) => new PriceEngineV2(seed, DEFAULT_SERVER_CLOCK, { startRealMs: start });

  it("40 檔、既有 16 檔排在前面且鍵唯一", () => {
    expect(STOCK_GROUPS.length).toBe(40);
    expect(new Set(STOCK_GROUPS.map((g) => g.key)).size).toBe(40);
    expect(LEGACY_STOCK_COUNT).toBe(16);
    expect(STOCK_GROUPS[0]!.key).toBe("g:hokurei_rail");
    expect(STOCK_GROUPS[15]!.key).toBe("g:mitsuhashi_trading");
    // 凍結的既有參數
    expect(stockGroupOf("g:hokurei_rail")).toMatchObject({ base: 2400, beta: 0.6, sigma: 0.003 });
    expect(stockGroupOf("g:todai_soft")).toMatchObject({ base: 880, sigma: 0.0068 });
  });

  it("決定性：同種子同時間同價；不同種子不同", () => {
    const a = mk();
    const b = mk();
    const t = REAL0 + 3 * 240 * 60_000 + 100 * 60_000;
    for (const g of STOCK_GROUPS) expect(a.priceAt(g.key, t)).toBe(b.priceAt(g.key, t));
    const c = mk(999);
    expect(STOCK_GROUPS.some((g) => a.priceAt(g.key, t) !== c.priceAt(g.key, t))).toBe(true);
  });

  it("休市價格不動：午休、收盤後、週末都等於最近一次收盤／午休價", () => {
    const e = mk();
    const key = "g:minato_rail";
    const am = (s: number) => REAL0 + (AM_OPEN + s) * 60_000 + 240 * 60_000; // 4/2 前場
    const lastAm = e.priceAt(key, am(AM_END - AM_OPEN - 1));
    const lunch = REAL0 + 240 * 60_000 + (AM_END + 3) * 60_000;
    expect(e.priceAt(key, lunch)).toBe(lastAm);
    const close = e.priceAt(key, REAL0 + 240 * 60_000 + (PM_END - 1) * 60_000);
    const afterClose = REAL0 + 240 * 60_000 + (PM_END + 30) * 60_000;
    expect(e.priceAt(key, afterClose)).toBe(close);
    const sat = REAL0 + 2 * 240 * 60_000 + 100 * 60_000; // 4/3 週六
    const fri = e.priceAt(key, REAL0 + 240 * 60_000 + 239 * 60_000);
    expect(e.priceAt(key, sat)).toBe(fri);
  });

  it("起點之前沒有 v2 價格（交給 v1）；起點接續 handoff", () => {
    const e = new PriceEngineV2(7, DEFAULT_SERVER_CLOCK, { startRealMs: start, handoff: (k) => (k === "g:hokurei_rail" ? { x: 0.1, price: Math.round(2400 * Math.exp(0.1)) } : null) });
    expect(e.priceAt("g:hokurei_rail", REAL0)).toBeNull();
    // 起點是 4/1 開盤前 → 第一個交易日就是 4/1
    expect(e.startDay).toBe(day(2027, 4, 1));
    const open = e.candle("g:hokurei_rail", 0)!.open;
    expect(Math.abs(open / Math.round(2400 * Math.exp(0.1)) - 1)).toBeLessThan(0.1); // 只有一個跳空的距離
    // 沒有 handoff 的新標的從基準價附近開始
    const first = e.candle("g:tokai_semi", 0)!.open;
    expect(Math.abs(first / 5200 - 1)).toBeLessThan(0.15);
  });

  it("切換發生在開市中：從下一個交易日開始", () => {
    const e = new PriceEngineV2(7, DEFAULT_SERVER_CLOCK, { startRealMs: REAL0 + 100 * 60_000 });
    expect(e.startDay).toBe(day(2027, 4, 2));
  });

  it("OHLC 自洽、價格在制限值幅內且有下限", () => {
    const e = mk();
    for (const g of STOCK_GROUPS.slice(0, 12)) {
      let prev = e.prevClose(g.key, 0)!;
      for (let i = 0; i < 80; i++) {
        const c = e.candle(g.key, i)!;
        const pts = e.intradayPrices(g.key, i)!;
        expect(pts.length).toBe(TRADING_STEPS_PER_DAY);
        expect(c.open).toBe(pts[0]);
        expect(c.close).toBe(pts[TRADING_STEPS_PER_DAY - 1]);
        expect(c.high).toBe(Math.max(...pts));
        expect(c.low).toBe(Math.min(...pts));
        expect(c.low).toBeGreaterThanOrEqual(10);
        expect(c.high).toBeLessThanOrEqual(Math.floor(prev * (1 + PRICE_LIMIT)) + 1);
        expect(c.low).toBeGreaterThanOrEqual(Math.min(prev, Math.ceil(prev * (1 - PRICE_LIMIT)) - 1));
        prev = c.close;
      }
    }
  });

  it("盤中快取被擠出後重算結果相同", () => {
    const e = mk();
    const key = "g:tsubame_tel";
    const first = Array.from(e.intradayPrices(key, 5)!);
    for (let i = 6; i < 60; i++) for (const g of STOCK_GROUPS) e.intradayPrices(g.key, i);
    expect(Array.from(e.intradayPrices(key, 5)!)).toEqual(first);
  });

  it("指數：基準價時 DW40＝10000、DWPIX＝1000", () => {
    const base = STOCK_GROUPS.map((g) => g.base);
    expect(dw40(base)).toBeCloseTo(10_000, 6);
    expect(dwpix(base)).toBeCloseTo(1_000, 6);
  });

  it("除權息：配息月的下一個月第一個交易日、每股金額大於 0", () => {
    const g = stockGroupOf("g:hokurei_rail")!; // 決算月 3 → 配息月 3 與 9 → 除權息日 4 月與 10 月第一個交易日
    expect(dividendPerShare(g)).toBeGreaterThan(0);
    expect(isExDividendDay(g, day(2027, 4, 1))).toBe(true);
    expect(isExDividendDay(g, day(2027, 4, 2))).toBe(false);
    expect(isExDividendDay(g, day(2027, 10, 1))).toBe(true);
    expect(isExDividendDay(g, day(2027, 9, 1))).toBe(false);
    expect(isExDividendDay(stockGroupOf("g:kagaribi_pay")!, day(2027, 4, 1))).toBe(false); // 不配息
  });

  it("冷啟動：算一年（約 250 個交易日 × 40 檔）要夠快", () => {
    const e = mk();
    const t0 = Date.now();
    e.candle("g:hokurei_rail", 250);
    const ms = Date.now() - t0;
    expect(e.computedDays).toBe(251);
    expect(ms).toBeLessThan(4000);
  });

  it("沒有期望漂移：多種子的平均對數報酬接近 0", () => {
    const rets: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const e = new PriceEngineV2(seed * 7919, DEFAULT_SERVER_CLOCK, { startRealMs: start });
      for (const key of ["g:tsubame_tel", "g:todai_soft", "g:mitsuhashi_trading"]) {
        const open = e.candle(key, 0)!.open;
        rets.push(Math.log(e.candle(key, 60)!.close / open));
      }
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
    expect(Math.abs(mean)).toBeLessThan(3.5 * (sd / Math.sqrt(rets.length)));
  });
});

describe("消息", () => {
  const news = new NewsEngine([]);
  const g = stockGroupOf("g:hokurei_rail")!;

  it("決定性、有標題、發生時間在一天之內", () => {
    let n = 0;
    for (let d = day(2027, 4, 1); d < day(2027, 4, 1) + 400; d++) {
      const a = news.eventsFor(5, g, d);
      const b = news.eventsFor(5, g, d);
      expect(a).toEqual(b);
      for (const x of a) {
        n++;
        expect(x.news.headline.length).toBeGreaterThan(3);
        expect(x.news.stepOfDay).toBeGreaterThanOrEqual(0);
        expect(x.news.stepOfDay).toBeLessThan(480);
        expect(Math.abs(x.pct)).toBeLessThan(25);
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it("傳聞→證實／否認是 martingale：傳聞之後的平均額外跳動接近 0", () => {
    const extras: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      for (const sg of STOCK_GROUPS.slice(0, 20)) {
        const d0 = day(2027, 4, 1);
        const rumors = new Map<number, number>();
        for (let d = d0; d < d0 + 1500; d++) for (const n of news.stockNewsOnDay(seed, sg, d)) if (n.phase === "rumor") rumors.set(d, Math.sign(n.pct));
        for (const [r, sgn] of rumors) {
          for (let d = r + 2; d <= r + 7; d++) {
            for (const n of news.stockNewsOnDay(seed, sg, d)) {
              if (n.phase === "confirm" || n.phase === "deny") extras.push(n.pct * sgn);
            }
          }
        }
      }
    }
    expect(extras.length).toBeGreaterThan(40);
    const mean = extras.reduce((a, b) => a + b, 0) / extras.length;
    const sd = Math.sqrt(extras.reduce((a, b) => a + (b - mean) ** 2, 0) / (extras.length - 1));
    expect(Math.abs(mean)).toBeLessThan(3.5 * (sd / Math.sqrt(extras.length)));
  });

  it("內容庫優先、條件式觸發、佔位符會被代換", () => {
    const pool = new NewsEngine([
      { id: "t1", kind: "company", archetype: "x", sentiment: "pos", mag: 1, headline: "{name}與{peer}（{sector}）共同發表新品", body: "本文{name}", weight: 1 },
      { id: "t2", kind: "company", archetype: "x", sentiment: "pos", mag: 2, headline: "{name}大幅成長", body: "b", weight: 1 },
      { id: "t3", kind: "company", archetype: "x", sentiment: "neg", mag: 1, headline: "{name}下修", body: "b", weight: 1 },
      { id: "t4", kind: "company", archetype: "x", sentiment: "neg", mag: 2, headline: "{name}虧損", body: "b", weight: 1 },
      { id: "t5", kind: "company", archetype: "x", sentiment: "neg", mag: 3, headline: "{name}重挫", body: "b", weight: 1 },
      { id: "t6", kind: "company", archetype: "x", sentiment: "pos", mag: 3, headline: "{name}暴漲", body: "b", weight: 1 },
    ]);
    const seen = new Set<string>();
    for (let d = day(2027, 4, 1); d < day(2027, 4, 1) + 2000; d++) {
      for (const a of pool.stockNewsOnDay(3, g, d)) {
        if (a.poolId) {
          seen.add(a.poolId);
          expect(a.headline).not.toContain("{");
          expect(a.headline).toContain(g.name);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("傳聞起始只用 rumor_*、證實／否認用各自的文案；分析師依強度與中性都抽得到", () => {
    const mk = (id: string, kind: "rumor" | "analyst", archetype: string, sentiment: "pos" | "neg" | "neutral", mag: 1 | 2 | 3, pair?: string) => ({ id, kind, archetype, sentiment, mag, headline: `${id}:{name}`, body: "b", weight: 1, ...(pair ? { pair } : {}) });
    const items = [
      ...(["pos", "neg"] as const).flatMap((s) =>
        ([1, 2, 3] as const).flatMap((m) => [
          mk(`r-${s}-${m}`, "rumor", "rumor_x", s, m),
          mk(`c-${s}-${m}`, "rumor", "confirm_x", s, m, `r-${s}-${m}`),
          mk(`d-${s}-${m}`, "rumor", "deny_x", s, m, `r-${s}-${m}`),
        ]),
      ),
      ...(["pos", "neg", "neutral"] as const).flatMap((s) => ([1, 2, 3] as const).map((m) => mk(`a-${s}-${m}`, "analyst", "rating", s, m))),
    ];
    const pool = new NewsEngine(items);
    const starts = new Set<string>();
    const ends = new Set<string>();
    const analyst = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      for (const sg of STOCK_GROUPS.slice(0, 20)) {
        for (let d = day(2027, 4, 1); d < day(2027, 4, 1) + 700; d++) {
          for (const n of pool.stockNewsOnDay(seed, sg, d)) {
            if (n.phase === "rumor" && n.poolId) starts.add(n.poolId);
            if ((n.phase === "confirm" || n.phase === "deny") && n.poolId) ends.add(n.poolId);
            if (n.archetype === "rating" && n.poolId) analyst.add(n.poolId);
          }
        }
      }
    }
    expect(starts.size).toBeGreaterThan(0);
    expect([...starts].every((id) => id.startsWith("r-"))).toBe(true);
    expect(ends.size).toBeGreaterThan(0);
    expect([...ends].every((id) => id.startsWith("c-") || id.startsWith("d-"))).toBe(true);
    for (const m of [1, 2, 3]) expect([...analyst].some((id) => id.endsWith(`-${m}`) && !id.includes("neutral"))).toBe(true);
    expect([...analyst].some((id) => id.includes("neutral"))).toBe(true);
  });
});
