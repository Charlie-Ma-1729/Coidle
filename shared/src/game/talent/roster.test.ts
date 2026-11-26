// 藝人名冊（roster.data.json）的驗證：數量、欄位格式、特質標籤、年代分布、姓名去重與姓名分布、內容守則。
// 這份名冊是 AI 生成後逐筆審核入庫的；改動它（新增、刪除或重新生成）一定要讓這支測試通過。
import { describe, expect, it } from "vitest";
import roster from "./roster.data.json";
import {
  AGE_BANDS,
  BAND_ROLE_TAGS,
  GROUP_AREAS,
  ROSTER_COVERAGE,
  TALENT_AREAS,
  TALENT_AREA_SPEC,
  TALENT_TRAIT_CONFLICTS,
  type RosterFile,
} from "./rosterSpec";
import { checkText } from "../../../../server/src/ai/validate";
import { realNameHit } from "../../../../server/src/ai/realPeople";

const { talents, groups } = roster as unknown as RosterFile;
const byArea = (a: string) => talents.filter((t) => t.area === a);
const isJapanese = (t: { kana?: string }): boolean => typeof t.kana === "string";

const PERSONA_BAN = /人氣值|能力值|數值|評分|等級|粉絲數|追蹤數|身價|年收|\d|[０-９]|歲|年齡|億|萬人|千人|S級|A級|排名第|第[一二三四五六七八九十]名/;
const PLACE_IN_PERSONA = /東京|大阪|京都|北海道|沖繩|神奈川|愛知|福岡|兵庫|埼玉|千葉|宮城|廣島|靜岡|新潟|長野|岡山|熊本|鹿兒島|長崎|岐阜|三重|滋賀|奈良|青森|岩手|秋田|山形|福島|茨城|栃木|群馬|富山|石川|福井|山梨|和歌山|鳥取|島根|山口|德島|香川|愛媛|高知|佐賀|大分|宮崎|橫濱|名古屋|札幌|仙台|神戶|首爾|釜山|台北|高雄|上海|北京|香港|新加坡|紐約|洛杉磯|倫敦|巴黎|柏林|雪梨|多倫多|聖保羅|馬德里|羅馬|夏威夷|墨爾本|溫哥華/;
const cpLen = (s: string): number => [...s].length;

describe("藝人名冊：數量與格式", () => {
  it("八個領域各 100 人，三十個偶像團體與三十個樂團", () => {
    expect(talents).toHaveLength(TALENT_AREAS.length * ROSTER_COVERAGE.perArea);
    for (const a of TALENT_AREAS) expect(byArea(a), a).toHaveLength(ROSTER_COVERAGE.perArea);
    for (const a of GROUP_AREAS) expect(groups.filter((g) => g.area === a), a).toHaveLength(ROSTER_COVERAGE.groupsPerArea);
    expect(groups).toHaveLength(GROUP_AREAS.length * ROSTER_COVERAGE.groupsPerArea);
  });

  it("id 格式正確、依序、不重複", () => {
    for (const a of TALENT_AREAS) {
      byArea(a).forEach((t, i) => expect(t.id, `${a} 第 ${i + 1} 筆`).toBe(`${a}-${String(i + 1).padStart(3, "0")}`));
    }
    for (const a of GROUP_AREAS) {
      groups.filter((g) => g.area === a).forEach((g, i) => expect(g.id).toBe(`grp-${a}-${String(i + 1).padStart(2, "0")}`));
    }
  });

  it("欄位型別：area、ageBand、出身地、人設、特質", () => {
    for (const t of talents) {
      expect(Object.keys(t).every((k) => ["id", "area", "name", "kana", "birthplace", "ageBand", "persona", "traits"].includes(k)), t.id).toBe(true);
      expect((TALENT_AREAS as readonly string[]).includes(t.area), t.id).toBe(true);
      expect((AGE_BANDS as readonly string[]).includes(t.ageBand), t.id).toBe(true);
      expect(typeof t.birthplace === "string" && t.birthplace.length >= 2, t.id).toBe(true);
      expect(cpLen(t.persona), `${t.id} 人設長度`).toBeGreaterThanOrEqual(10);
      expect(cpLen(t.persona), `${t.id} 人設長度`).toBeLessThanOrEqual(ROSTER_COVERAGE.personaMax);
      expect(t.traits.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.traits.length, t.id).toBeLessThanOrEqual(3);
    }
    for (const g of groups) {
      expect((GROUP_AREAS as readonly string[]).includes(g.area), g.id).toBe(true);
      expect(cpLen(g.concept), `${g.id} 概念長度`).toBeGreaterThanOrEqual(10);
      expect(cpLen(g.concept), `${g.id} 概念長度`).toBeLessThanOrEqual(ROSTER_COVERAGE.personaMax);
    }
  });

  it("沒有任何數值屬性（只有文字欄位，人設不含數字或能力值用語）", () => {
    for (const t of talents) {
      for (const v of Object.values(t)) expect(typeof v === "number", t.id).toBe(false);
      expect(t.persona, t.id).not.toMatch(PERSONA_BAN);
    }
    for (const g of groups) expect(g.concept, g.id).not.toMatch(PERSONA_BAN);
  });
});

describe("藝人名冊：特質標籤", () => {
  it("特質都在該領域的標籤表裡、不重複、沒有互斥組合", () => {
    for (const t of talents) {
      const tags = new Set(TALENT_AREA_SPEC[t.area].tags.map((x) => x.id));
      expect(new Set(t.traits).size, t.id).toBe(t.traits.length);
      for (const x of t.traits) expect(tags.has(x), `${t.id} 標籤 ${x}`).toBe(true);
      for (const group of TALENT_TRAIT_CONFLICTS[t.area] ?? []) expect(t.traits.filter((x) => group.includes(x)).length, `${t.id} 互斥特質`).toBeLessThanOrEqual(1);
    }
  });

  it("標籤表每個領域 12 個，每個標籤至少有 8 人使用", () => {
    for (const a of TALENT_AREAS) {
      const spec = TALENT_AREA_SPEC[a];
      expect(spec.tags, a).toHaveLength(12);
      for (const tag of spec.tags) expect(byArea(a).filter((t) => t.traits.includes(tag.id)).length, `${a}/${tag.id}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("樂團成員恰有一個角色標籤（主唱／吉他手／貝斯手／鼓手／鍵盤手），嘶吼一定是主唱", () => {
    for (const t of byArea("band")) {
      expect(t.traits.filter((x) => BAND_ROLE_TAGS.includes(x)).length, t.id).toBe(1);
      if (t.traits.includes("screamer")) expect(t.traits, t.id).toContain("vocal");
    }
    for (const r of BAND_ROLE_TAGS) expect(byArea("band").filter((t) => t.traits.includes(r)).length, r).toBeGreaterThanOrEqual(10);
  });

  it("年代分布符合各領域的設定", () => {
    for (const a of TALENT_AREAS) {
      for (const band of AGE_BANDS) expect(byArea(a).filter((t) => t.ageBand === band).length, `${a}/${band}`).toBe(TALENT_AREA_SPEC[a].ages[band]);
    }
  });
});

describe("藝人名冊：姓名", () => {
  it("姓名與團名不重複（含藝人與團體之間，忽略大小寫與「·」）", () => {
    const norm = (s: string): string => s.replace(/[\s·]/g, "").toLowerCase();
    const all = [...talents.map((t) => t.name), ...groups.map((g) => g.name)].map(norm);
    expect(new Set(all).size).toBe(all.length);
  });

  it("日式姓名占 62%–78%，且一定有假名讀音（平假名、姓名間一個半形空格）；非日式沒有讀音", () => {
    const jp = talents.filter(isJapanese);
    const share = jp.length / talents.length;
    expect(share).toBeGreaterThanOrEqual(ROSTER_COVERAGE.japaneseShare[0]);
    expect(share).toBeLessThanOrEqual(ROSTER_COVERAGE.japaneseShare[1]);
    for (const t of jp) {
      expect(t.kana, t.id).toMatch(/^[ぁ-ゖー]{1,6} [ぁ-ゖー]{1,6}$/);
      expect(t.name, t.id).toMatch(/^(?=.*[一-鿿])[一-鿿々〆ヶぁ-ゖ]{3,6}$/);
    }
    for (const t of talents.filter((x) => !isJapanese(x))) expect(Object.keys(t), t.id).not.toContain("kana");
  });

  it("同姓同名上限：同一個姓（假名）≤ 3 人、同一個名 ≤ 3 人、姓＋名不重複", () => {
    const sur = new Map<string, number>();
    const giv = new Map<string, number>();
    const full = new Set<string>();
    for (const t of talents.filter(isJapanese)) {
      const [s, g] = t.kana!.split(" ") as [string, string];
      sur.set(s, (sur.get(s) ?? 0) + 1);
      giv.set(g, (giv.get(g) ?? 0) + 1);
      expect(full.has(t.kana!), `${t.id} 讀音重複`).toBe(false);
      full.add(t.kana!);
    }
    for (const [k, v] of sur) expect(v, `姓「${k}」`).toBeLessThanOrEqual(ROSTER_COVERAGE.surnameCap);
    for (const [k, v] of giv) expect(v, `名「${k}」`).toBeLessThanOrEqual(ROSTER_COVERAGE.givenCap);
  });

  it("出身地：日本都道府縣為主，海外城市為輔", () => {
    const jpPlace = /(?:都|道|府|縣)$/;
    const japan = talents.filter((t) => jpPlace.test(t.birthplace));
    expect(japan.length / talents.length).toBeGreaterThan(0.6);
    expect(japan.length / talents.length).toBeLessThan(0.9);
    for (const t of talents.filter(isJapanese)) expect(t.birthplace.length, t.id).toBeGreaterThanOrEqual(2);
  });
});

describe("藝人名冊：內容守則", () => {
  it("姓名、團名、人設、概念都過內容驗證，沒有真實企業、真實藝人與團體", () => {
    for (const t of talents) {
      const kanaFold = (s: string): string => s.replace(/[ぁ-ヿ]+/g, "ア");
      expect(checkText(kanaFold(t.name), { min: 1, max: 16, allowPlaces: true }), `${t.id} 姓名`).toBeNull();
      expect(checkText(t.persona, { min: 10, max: 80, allowPlaces: true }), `${t.id} 人設`).toBeNull();
      expect(realNameHit(t.name), `${t.id} 姓名`).toBeNull();
      expect(realNameHit(t.persona), `${t.id} 人設`).toBeNull();
    }
    for (const g of groups) {
      expect(checkText(g.name.replace(/[ぁ-ヿ]+/g, "ア"), { min: 1, max: 20, allowPlaces: true }), `${g.id} 團名`).toBeNull();
      expect(checkText(g.concept, { min: 10, max: 80, allowPlaces: true }), `${g.id} 概念`).toBeNull();
      expect(realNameHit(g.name), `${g.id} 團名`).toBeNull();
      expect(realNameHit(g.concept), `${g.id} 概念`).toBeNull();
    }
  });

  it("人設不寫出身地與年齡（那些有專屬欄位）、不重複姓名、不含作品名符號", () => {
    for (const t of talents) {
      expect(t.persona, t.id).not.toMatch(PLACE_IN_PERSONA);
      expect(t.persona, t.id).not.toContain(t.name);
      expect(t.persona, t.id).not.toMatch(/《|》/);
    }
  });

  it("人設開頭不過度集中（同領域前 3 字相同者 ≤ 6 人）", () => {
    for (const a of TALENT_AREAS) {
      const tally = new Map<string, number>();
      for (const t of byArea(a)) tally.set(t.persona.slice(0, 3), (tally.get(t.persona.slice(0, 3)) ?? 0) + 1);
      const [top, n] = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]!;
      expect(n, `${a} 的開頭「${top}」`).toBeLessThanOrEqual(6);
    }
  });
});
