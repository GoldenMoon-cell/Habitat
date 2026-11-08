/**
 * 折线 → 轮廓 JSON（喂给 merge-outlines.py）
 *
 * 把 font-design.mjs 里的折线坐标表展开成「描边轮廓」：
 *   每段折线 → 一个矩形   每个拐角 → 一个方块
 *
 * ⚠ 这些矩形**互相重叠**。浏览器和 fonttools 靠非零环绕能吃下，
 *   但 FontLab 吃不下（664 条重叠子路径把它的内部状态搞崩过）。
 *   所以推给 FontLab 之前必须过一遍 merge-outlines.py。
 *
 * 用法：
 *   node scripts/dump-outlines.mjs          # → .font.json
 */

import { writeFileSync } from "node:fs";
import { GLYPHS, PUNCT, ADV, STROKE } from "./font-design.mjs";

const H = STROKE / 2;
const S = 100;

/** 一段线 → 矩形 */
function segRect(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * H, ny = (dx / len) * H;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
}

function square(p) {
  return [
    [p[0] - H, p[1] - H], [p[0] + H, p[1] - H],
    [p[0] + H, p[1] + H], [p[0] - H, p[1] + H],
  ];
}

/**
 * ★ 顺序很重要：**先放大到字体单位，再做描边扩展。**
 * 反过来做会把半笔宽 42 也乘 100，坐标飞出几万。
 */
export function strokesToContours(strokes) {
  const polys = strokes.map((poly) => poly.map(([x, y]) => [x * S, y * S]));
  const out = [];
  for (const poly of polys) {
    if (poly.length < 2) {
      if (poly.length === 1) out.push(square(poly[0]));
      continue;
    }
    for (let i = 0; i < poly.length - 1; i++) out.push(segRect(poly[i], poly[i + 1]));
    for (let i = 1; i < poly.length - 1; i++) out.push(square(poly[i]));
  }
  return out.map((c) => c.map(([x, y]) => [Math.round(x), Math.round(y)]));
}

const out = {};
for (const [ch, strokes] of Object.entries({ ...GLYPHS, ...PUNCT })) {
  out[ch] = { contours: strokes.length ? strokesToContours(strokes) : [], advance: ADV };
}

writeFileSync(".font.json", JSON.stringify(out));
const total = Object.values(out).reduce((n, d) => n + d.contours.length, 0);
console.log(`  导出 ${Object.keys(out).length} 个字形 · ${total} 条子路径 → .font.json`);
