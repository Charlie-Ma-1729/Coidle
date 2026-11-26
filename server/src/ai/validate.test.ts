import { describe, expect, it } from "vitest";
import { checkText } from "./validate";

describe("checkText allowPlaces（股市新聞庫專用）", () => {
  const rule = { min: 4, max: 80 };

  it("預設仍擋真實地名", () => {
    expect(checkText("大阪的百貨業者今年業績亮眼", rule)).toMatch(/真實地名/);
    expect(checkText("九州的百貨業者今年業績亮眼", rule)).toBeNull();
  });

  it("allowPlaces 放行一般地名", () => {
    expect(checkText("大阪與九州的觀光需求回升，旅行業者受惠", { ...rule, allowPlaces: true })).toBeNull();
    expect(checkText("北海道的雪季提早開始，航空訂位增加", { ...rule, allowPlaces: true })).toBeNull();
  });

  it("allowPlaces 仍擋老街區原型周邊的地名", () => {
    for (const w of ["西成", "新今宮", "通天閣", "釜崎", "愛隣"]) expect(checkText(`${w}一帶的店家公布新的營業時間`, { ...rule, allowPlaces: true })).toMatch(/真實地名/);
  });

  it("allowPlaces 仍擋真實品牌", () => {
    expect(checkText("星巴克宣布調漲咖啡售價", { ...rule, allowPlaces: true })).toMatch(/真實/);
    expect(checkText("Sony 發表新一代遊戲主機", { ...rule, allowPlaces: true })).toMatch(/真實/);
  });

  it("allowPlaces 額外擋真實企業、指數、央行與商品", () => {
    for (const t of ["豐田宣布增產", "三菱重工獲得大單", "日經平均收高", "日本銀行維持利率不變", "iPhone 需求轉弱", "JR 連休客流增加", "彭博報導指出", "任天堂新品熱賣"]) {
      expect(checkText(t, { ...rule, allowPlaces: true }), t).not.toBeNull();
    }
  });

  it("allowPlaces 不誤殺一般詞", () => {
    for (const t of ["蘋果與梨子的收成不如預期，青果批發轉虧", "朝日升起時港口開始作業", "麒麟草在山坡盛開", "三星級的旅館業者增加訂位", "大和民族的傳統節慶帶動消費"]) {
      expect(checkText(t, { ...rule, allowPlaces: true }), t).toBeNull();
    }
  });

  it("allowPlaces 仍擋網址、粗話、簡體字與整句日文", () => {
    const r = { ...rule, allowPlaces: true };
    expect(checkText("詳見 https://example.com 的公告內容", r)).toMatch(/網址/);
    expect(checkText("他媽的這家公司又出包了真的很扯", r)).toMatch(/不當/);
    expect(checkText("这家公司的新产品开始热卖了", r)).toMatch(/簡體/);
    expect(checkText("これはとてもおいしいですよねぇ今日も元気", r)).not.toBeNull();
  });
});
