import { describe, expect, it } from "vitest";
import { GLYPHS, GLYPH_TONE, glyphPalette } from "./glyphs";

describe("glyphs", () => {
  const keys = Object.keys(GLYPHS) as (keyof typeof GLYPHS)[];

  it.each(keys)("%s 是 8×8，且只用已定義的字元", (k) => {
    const rows = GLYPHS[k];
    expect(rows).toHaveLength(8);
    const pal = glyphPalette(GLYPH_TONE[k]);
    for (const row of rows) {
      expect(row).toHaveLength(8);
      for (const ch of row) expect(ch === "." || pal[ch] !== undefined, `${k}: 未定義字元 "${ch}"`).toBe(true);
    }
  });

  it("每個圖示都有色調，且至少有一個不透明像素", () => {
    for (const k of keys) {
      expect(GLYPH_TONE[k]).toBeTypeOf("number");
      expect(GLYPHS[k].some((r) => /[^.]/.test(r))).toBe(true);
    }
  });
});
