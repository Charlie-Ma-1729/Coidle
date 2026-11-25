import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 版面規則的回歸測試（happy-dom 量不出版面，所以直接檢查樣式規則）。
 * 起因：開發頁在手機上要左右滑動——視窗內容區的 grid 沒有欄寬上限，
 * 加上工坊的橫向捲動選項列，會把整個視窗撐到 800px 以上。
 */
const css = readFileSync(new URL("./stage.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 取出「以這個選擇器開頭」的規則的內容（簡單字串比對，選擇器要寫得跟檔案裡一樣） */
function ruleOf(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("手機版面規則（不能橫向撐寬）", () => {
  it("視窗／面板／彈出層的內容區：欄寬有上限，子元素可以縮", () => {
    expect(ruleOf(".st-win-body, .st-side-body, .st-pop-body")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(ruleOf(".st-win-body > *, .st-side-body > *, .st-pop-body > *")).toContain("min-width: 0");
  });

  it("既有畫面的橫向選項列（.zones）在視窗裡改成換行，不是左右捲動", () => {
    const rule = ruleOf(".st-win-body .zones");
    expect(rule).toContain("flex-wrap: wrap");
    expect(rule).toContain("overflow: visible");
  });

  it("視窗固定高度；內容在視窗內捲動", () => {
    expect(ruleOf(".st-win")).toContain("height: min(600px");
    expect(ruleOf(".st-win-body")).toContain("overflow: auto");
  });

  it("暫停橫幅在場景上有實心底色", () => {
    expect(ruleOf(".st-banners .clock-banner")).toContain("var(--st-panel)");
  });
});
