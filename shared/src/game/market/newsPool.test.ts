// 股市新聞內容庫（news.data.json）的驗證：格式、佔位符、長度、傳聞配對、情境 id 有效、覆蓋矩陣、內容守則。
// 這個庫是 AI 生成後逐則審核入庫的；改動它（新增、刪除或重新生成）一定要讓這支測試通過。
import { describe, expect, it } from "vitest";
import pool from "./news.data.json";
import { NewsEngine, SECTORS, type NewsKind, type NewsPoolItem } from "./news";
import { ANALYST_ARCHETYPES, COMPANY_ARCHETYPES, COVERAGE, ENT_ARCHETYPES, ENT_SECTORS, NEWS_CONTEXTS, NEWS_KINDS, NEWS_SECTORS, NEWS_WEATHER_IDS, RUMOR_TOPICS } from "../marketNewsSpec";
import { OBSERVANCES } from "../calendar";
import { WEATHER_NAMES } from "../weather";
import { checkText } from "../../../../server/src/ai/validate";

const items = pool as unknown as NewsPoolItem[];
const byId = new Map(items.map((i) => [i.id, i]));

/** 與生成腳本相同的展開方式：用 8 字的虛構名字代入佔位符再量長度 */
const NAME_X = "天河精機工業集團";
const PEER_X = "北辰物產控股集團";
const expand = (t: string): string => t.replaceAll("{name}", NAME_X).replaceAll("{peer}", PEER_X).replaceAll("{sector}", "資訊科技");

const CAL_TAGS = ["weekend", "holiday", "long_weekend", "golden_week", "obon", "new_year", "year_end", "school_break", "payday", "season_event", "moving_season"];
const CALENDAR_IDS = new Set<string>([...CAL_TAGS, ...OBSERVANCES.map((o) => o.id), ...OBSERVANCES.flatMap((o) => o.tags ?? [])]);
const WEATHER_IDS = new Set<string>([...Object.keys(WEATHER_NAMES), "hot", "cold"]);
const SEASONS = new Set(["spring", "summer", "autumn", "winter", "rainy", "typhoon"]);
const SECTOR_IDS = NEWS_SECTORS.map((s) => s.id);
const NAME_KINDS = new Set<NewsKind>(["company", "analyst", "rumor"]);
const count = (f: (i: NewsPoolItem) => boolean): number => items.filter(f).length;

describe("新聞庫：格式", () => {
  it("庫不是空的、依 id 排序、id 唯一", () => {
    expect(items.length).toBeGreaterThan(1500);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("每則的欄位型別與範圍正確", () => {
    for (const it of items) {
      expect(it.id, it.id).toMatch(/^[a-z]{2}-[a-z_]+-[pnz][123]-[0-9a-f]{8}$/);
      expect(NEWS_KINDS).toContain(it.kind);
      expect(["pos", "neg", "neutral"]).toContain(it.sentiment);
      expect([1, 2, 3]).toContain(it.mag);
      expect(typeof it.archetype).toBe("string");
      expect(it.weight).toBeGreaterThan(0);
      expect(it.id.startsWith({ company: "co", sector: "sc", macro: "mc", analyst: "an", rumor: "rm", wrap: "wp", preopen: "po" }[it.kind] + "-"), it.id).toBe(true);
    }
  });

  it("標題 12–40 字、本文 60–120 字（佔位符以 8 字名字展開後計）", () => {
    for (const it of items) {
      const h = expand(it.headline).length;
      const b = expand(it.body).length;
      expect(h, it.id + " 標題").toBeGreaterThanOrEqual(12);
      expect(h, it.id + " 標題").toBeLessThanOrEqual(40);
      expect(b, it.id + " 本文").toBeGreaterThanOrEqual(60);
      expect(b, it.id + " 本文").toBeLessThanOrEqual(120);
      expect(it.headline.trim(), it.id).toBe(it.headline);
      expect(it.body.trim(), it.id).toBe(it.body);
    }
  });

  it("佔位符合法：公司／分析師／傳聞類標題要有 {name}；板塊最多 {sector}；全市場、評語、前瞻不可有佔位符", () => {
    for (const it of items) {
      const all = it.headline + it.body;
      const tokens = all.match(/\{[^{}]*\}|[{}]/g) ?? [];
      for (const t of tokens) expect(["{name}", "{peer}", "{sector}"], `${it.id} ${t}`).toContain(t);
      if (NAME_KINDS.has(it.kind)) {
        expect(it.headline, it.id).toContain("{name}");
        expect((all.match(/\{peer\}/g) ?? []).length, it.id).toBeLessThanOrEqual(it.kind === "rumor" ? 4 : 2);
      } else if (it.kind === "sector") {
        expect(tokens.every((t) => t === "{sector}"), it.id).toBe(true);
      } else {
        expect(tokens, it.id).toEqual([]);
      }
    }
  });

  it("when 條件：板塊、月份、季節、日曆 id、天氣 id 都真實存在", () => {
    for (const it of items) {
      const w = it.when;
      if (!w) continue;
      for (const s of w.sectors ?? []) expect(SECTOR_IDS, `${it.id} 板塊 ${s}`).toContain(s);
      for (const m of w.months ?? []) expect(m >= 1 && m <= 12, it.id).toBe(true);
      for (const s of w.seasons ?? []) expect(SEASONS.has(s), `${it.id} 季節 ${s}`).toBe(true);
      for (const c of w.calendar ?? []) expect(CALENDAR_IDS.has(c), `${it.id} 日曆 ${c}`).toBe(true);
      for (const x of w.weather ?? []) expect(WEATHER_IDS.has(x), `${it.id} 天氣 ${x}`).toBe(true);
      if (w.mood !== undefined) expect(["up", "down", "flat"]).toContain(w.mood);
      if (w.earnings !== undefined) expect(typeof w.earnings).toBe("boolean");
      if (it.kind === "sector") expect(w.sectors?.length, it.id).toBe(1);
      if (w.sectors && !ENT_ARCHETYPES.some((a) => a.id === it.archetype)) expect(it.kind, it.id).toBe("sector");
      if (it.kind === "wrap") expect(w.mood, it.id).toBeDefined();
    }
  });

  it("規格裡的板塊與天氣 id 與引擎一致", () => {
    expect(NEWS_SECTORS).toHaveLength(39);
    expect([...SECTORS].sort()).toEqual([...SECTOR_IDS].sort());
    for (const id of NEWS_WEATHER_IDS) expect(WEATHER_IDS.has(id)).toBe(true);
    for (const c of NEWS_CONTEXTS) {
      for (const x of c.when.calendar ?? []) expect(CALENDAR_IDS.has(x), x).toBe(true);
      for (const x of c.when.weather ?? []) expect(WEATHER_IDS.has(x), x).toBe(true);
    }
  });

  it("引擎可以載入這個庫", () => {
    const e = new NewsEngine(items);
    expect(e.size).toBe(items.length);
  });
});

describe("新聞庫：傳聞三連組", () => {
  const rumors = items.filter((i) => i.kind === "rumor" && i.archetype.startsWith("rumor_"));

  it("每則傳聞都有證實與否認各一，互相指向", () => {
    for (const r of rumors) {
      const confirm = byId.get(r.pair ?? "");
      expect(confirm, r.id + " 的 pair 找不到").toBeDefined();
      expect(confirm!.archetype, r.id).toBe(`confirm_${r.archetype.slice(6)}`);
      const followers = items.filter((i) => i.pair === r.id);
      expect(followers.map((f) => f.archetype.split("_")[0]).sort(), r.id).toEqual(["confirm", "deny"]);
      const deny = followers.find((f) => f.archetype.startsWith("deny_"))!;
      expect(confirm!.pair, r.id).toBe(r.id);
      // 證實＝傳聞的方向；否認＝相反的方向；幅度相同
      expect(confirm!.sentiment, r.id).toBe(r.sentiment);
      expect(deny.sentiment, r.id).toBe(r.sentiment === "pos" ? "neg" : "pos");
      expect(confirm!.mag).toBe(r.mag);
      expect(deny.mag).toBe(r.mag);
    }
  });

  it("每則證實／否認都對應到一則傳聞", () => {
    for (const f of items.filter((i) => i.kind === "rumor" && !i.archetype.startsWith("rumor_"))) {
      expect(/^(confirm|deny)_/.test(f.archetype), f.id).toBe(true);
      expect(byId.get(f.pair ?? "")?.archetype.startsWith("rumor_"), f.id).toBe(true);
    }
  });

  it("傳聞標題有不確定的語氣；證實與否認的語氣各自成立", () => {
    for (const r of rumors) expect(r.headline, r.id).toMatch(/傳|據|消息|外界|疑|可能|或將|恐|擬|有意|風聲|盛傳|謠/);
    for (const i of items.filter((x) => x.archetype.startsWith("confirm_"))) expect(i.headline + i.body, i.id).toMatch(/證實|確認|公告|宣布|宣佈|正式|發布|公布|揭露|承認|表示|說明/);
    for (const i of items.filter((x) => x.archetype.startsWith("deny_"))) expect(i.headline + i.body, i.id).toMatch(/否認|澄清|不實|並無|沒有|未有|駁斥|無此|並未|不會|尚無|無意/);
  });
});

describe("新聞庫：覆蓋矩陣", () => {
  it(`公司：每個原型 × 利多／利空 ≥ ${COVERAGE.companyPerArchetypeSentiment} 則`, () => {
    expect(COMPANY_ARCHETYPES.length).toBeGreaterThanOrEqual(24);
    for (const a of COMPANY_ARCHETYPES) {
      for (const s of ["pos", "neg"]) {
        expect(count((i) => i.kind === "company" && i.archetype === a.id && i.sentiment === s), `${a.id}/${s}`).toBeGreaterThanOrEqual(COVERAGE.companyPerArchetypeSentiment);
      }
    }
    // 沒有「幽靈」原型（娛樂題材原型另算，見下一則）
    const known = new Set([...COMPANY_ARCHETYPES, ...ENT_ARCHETYPES].map((a) => a.id));
    for (const i of items.filter((x) => x.kind === "company")) expect(known.has(i.archetype), i.id).toBe(true);
  });

  it("娛樂題材：9 個原型 × 利多／利空 ≥ 8 則，只限娛樂／動漫出版／遊戲板塊", () => {
    expect(ENT_ARCHETYPES).toHaveLength(9);
    for (const a of ENT_ARCHETYPES) {
      for (const s of ["pos", "neg"]) {
        expect(count((i) => i.kind === "company" && i.archetype === a.id && i.sentiment === s), `${a.id}/${s}`).toBeGreaterThanOrEqual(COVERAGE.companyPerArchetypeSentiment);
      }
      for (const m of [1, 2, 3]) expect(count((i) => i.archetype === a.id && i.mag === m), `${a.id}/m${m}`).toBeGreaterThan(0);
    }
    for (const i of items.filter((x) => ENT_ARCHETYPES.some((a) => a.id === x.archetype))) {
      expect(i.kind, i.id).toBe("company");
      expect(i.when?.sectors?.length, i.id).toBeGreaterThan(0);
      for (const sec of i.when!.sectors!) expect((ENT_SECTORS as readonly string[]).includes(sec), `${i.id} ${sec}`).toBe(true);
      expect(i.headline, i.id).toContain("{name}");
    }
    // 情境版本：新番季、聖誕、暑假音樂祭、年末
    expect(count((i) => i.archetype.startsWith("ent_") && (i.when?.months?.length ?? 0) > 0)).toBeGreaterThanOrEqual(8);
    expect(count((i) => i.archetype.startsWith("ent_") && (i.when?.calendar?.length ?? 0) > 0)).toBeGreaterThanOrEqual(8);
  });

  it("公司消息涵蓋三種幅度，決算類綁定決算期", () => {
    for (const a of COMPANY_ARCHETYPES) {
      for (const m of [1, 2, 3]) expect(count((i) => i.kind === "company" && i.archetype === a.id && i.mag === m), `${a.id}/m${m}`).toBeGreaterThan(0);
      if (a.earnings) for (const i of items.filter((x) => x.kind === "company" && x.archetype === a.id)) expect(i.when?.earnings, i.id).toBe(true);
    }
  });

  it("板塊 × 每個季節／節日／天氣情境 × 利多／利空，至少各有專屬文案", () => {
    for (const sec of SECTOR_IDS) {
      for (const c of NEWS_CONTEXTS) {
        for (const s of ["pos", "neg"]) {
          const n = count((i) => i.kind === "sector" && i.sentiment === s && i.when?.sectors?.[0] === sec && JSON.stringify({ seasons: i.when?.seasons, calendar: i.when?.calendar, weather: i.when?.weather }) === JSON.stringify({ seasons: c.when.seasons, calendar: c.when.calendar, weather: c.when.weather }));
          expect(n, `${sec} × ${c.id} × ${s}`).toBeGreaterThanOrEqual(COVERAGE.sectorPerContextSentiment);
        }
      }
    }
  });

  it("每個板塊都有不限情境的通用消息，利多與利空各三種幅度", () => {
    for (const sec of SECTOR_IDS) {
      for (const s of ["pos", "neg"]) {
        for (const m of [1, 2, 3]) {
          const n = count((i) => i.kind === "sector" && i.archetype === "sector_trend" && i.when?.sectors?.[0] === sec && i.sentiment === s && i.mag === m);
          expect(n, `${sec}/${s}/m${m}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("全市場、分析師、市況評語、傳聞、開盤前瞻的數量", () => {
    expect(count((i) => i.kind === "macro")).toBeGreaterThanOrEqual(COVERAGE.macroMin);
    expect(count((i) => i.kind === "analyst")).toBeGreaterThanOrEqual(COVERAGE.analystMin);
    expect(count((i) => i.kind === "wrap")).toBeGreaterThanOrEqual(COVERAGE.wrapMin);
    expect(count((i) => i.kind === "rumor" && i.archetype.startsWith("rumor_"))).toBeGreaterThanOrEqual(COVERAGE.rumorTriplesMin);
    expect(count((i) => i.kind === "preopen")).toBeGreaterThanOrEqual(30);
    for (const mood of ["up", "down", "flat"]) expect(count((i) => i.kind === "wrap" && i.when?.mood === mood), `wrap/${mood}`).toBeGreaterThanOrEqual(20);
    for (const a of ANALYST_ARCHETYPES) expect(count((i) => i.kind === "analyst" && i.archetype === a.id), a.id).toBeGreaterThanOrEqual(5);
    for (const t of RUMOR_TOPICS) for (const d of ["pos", "neg"]) expect(count((i) => i.archetype === `rumor_${t.id}` && i.sentiment === d), `rumor_${t.id}/${d}`).toBeGreaterThanOrEqual(1);
  });

  it("全市場消息：情境專屬文案涵蓋每個情境", () => {
    for (const c of NEWS_CONTEXTS) {
      const n = count((i) => i.kind === "macro" && JSON.stringify(i.when?.seasons ?? i.when?.calendar ?? i.when?.weather) === JSON.stringify(c.when.seasons ?? c.when.calendar ?? c.when.weather) && i.when !== undefined);
      expect(n, `macro × ${c.id}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("新聞庫：內容守則", () => {
  it("沒有真實企業／品牌／網址／粗話／簡體字／整句日文（validate.ts 的 allowPlaces 規則）", () => {
    for (const it of items) {
      for (const t of [it.headline, it.body]) expect(checkText(expand(t), { min: 1, max: 400, allowPlaces: true }), it.id).toBeNull();
    }
  });

  it("標題與本文不重複", () => {
    const heads = new Set<string>();
    const bodies = new Set<string>();
    for (const it of items) {
      expect(heads.has(it.headline), it.id + " 標題重複").toBe(false);
      expect(bodies.has(it.body), it.id + " 本文重複").toBe(false);
      heads.add(it.headline);
      bodies.add(it.body);
    }
  });

  it("開頭詞不過度集中（同種類同語氣的標題，前 3 字相同者不超過 15%；傳聞的證實／否認本來就以「公司證實／否認…」起頭，另計）", () => {
    const opener = (h: string): string => h.replaceAll("{name}", "某").replaceAll("{peer}", "他").replaceAll("{sector}", "業").slice(0, 3);
    const groups = new Map<string, string[]>();
    for (const it of items) {
      const role = /^(confirm|deny)_/.exec(it.archetype)?.[1];
      if (role) continue; // 證實／否認的標題用字固定，由傳聞配對測試把關
      groups.set(`${it.kind}/${it.sentiment}`, [...(groups.get(`${it.kind}/${it.sentiment}`) ?? []), opener(it.headline)]);
    }
    for (const [g, ops] of groups) {
      const tally = new Map<string, number>();
      for (const o of ops) tally.set(o, (tally.get(o) ?? 0) + 1);
      const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
      // 傳聞標題本來就偏愛「外界盛傳／據傳／市場傳出」這幾種起手式，上限放寬到 35%
      const cap = g.startsWith("rumor/") ? Math.ceil(ops.length * 0.35) : Math.max(8, Math.ceil(ops.length * 0.15));
      expect(n, `${g} 的開頭「${top}」`).toBeLessThanOrEqual(cap);
    }
  });

  it("通用內容（沒有情境條件）不提季節、節日與天氣", () => {
    const ctx = /春天|春季|夏天|夏季|盛夏|秋天|秋季|冬天|冬季|寒冬|梅雨|颱風|酷暑|酷熱|寒流|嚴寒|黃金週|盂蘭盆|年末|年底|年始|新年(?!度)|歲末|聖誕|連休|連假|暑假|寒假|櫻花|賞花|紅葉|楓葉|發薪|跨年|豪雨|暴雨/;
    for (const it of items) {
      const w = it.when;
      const hasCtx = !!(w?.seasons?.length || w?.calendar?.length || w?.weather?.length || w?.months?.length);
      if (!hasCtx) expect(it.headline + it.body, it.id).not.toMatch(ctx);
    }
  });

  it("不寫年份、具體日期、股價漲跌幅與投資建議", () => {
    for (const it of items) {
      const t = it.headline + it.body;
      expect(t, it.id).not.toMatch(/\d{4}\s*年|\d{1,2}\s*月|漲停|跌停|股價(?:大|急|狂)?(?:漲|跌|飆|創)|建議投資人|穩賺|保證獲利/);
    }
  });

  it("沒有夾雜英文單字（少數縮寫除外）", () => {
    const ok = new Set(["REIT", "ESG", "AI", "IT", "EV", "DX", "IPO", "5G", "M&A", "ETF", "CPI", "GDP", "PMI", "LNG", "SaaS", "IoT", "EPS", "ROE", "PER", "PBR", "CEO", "CFO", "COO", "R&D"]);
    for (const it of items) {
      const words = (it.headline + it.body).replace(/\{(?:name|peer|sector)\}/g, "").match(/[A-Za-z][A-Za-z0-9&+.-]*/g) ?? [];
      for (const w of words) expect(ok.has(w), `${it.id} ${w}`).toBe(true);
    }
  });
});
