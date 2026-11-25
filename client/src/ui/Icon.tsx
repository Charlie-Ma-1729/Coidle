import { cssColor } from "../stage/color";
import { GLYPHS, GLYPH_TONE, glyphPalette, type GlyphKey } from "../stage/glyphs";

const cache = new Map<string, string>();

/** 把 8×8 圖示畫成 data URL（快取）。沒有 canvas（測試環境）就回傳空字串。 */
export function glyphUrl(name: GlyphKey, tone: number = GLYPH_TONE[name]): string {
  const key = `${name}:${tone}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = "";
  try {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const x = c.getContext("2d");
    if (x) {
      const pal = glyphPalette(tone);
      GLYPHS[name].forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          const col = pal[row[i]!];
          if (col === undefined) continue;
          x.fillStyle = cssColor(col);
          x.fillRect(i, j, 1, 1);
        }
      });
      url = c.toDataURL();
    }
  } catch {
    url = "";
  }
  cache.set(key, url);
  return url;
}

/** 像素圖示。size 是放大倍率（預設 3 倍＝24px）。 */
export function Icon(props: { name: GlyphKey; size?: number; tone?: number; title?: string }) {
  const size = props.size ?? 3;
  const url = glyphUrl(props.name, props.tone);
  return <img class="st-ico" src={url} width={8 * size} height={8 * size} alt="" aria-hidden={props.title ? undefined : "true"} title={props.title} draggable={false} />;
}
