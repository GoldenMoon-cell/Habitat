"""
把零字形的斜杠去掉

为什么：
  更纱黑体（Iosevka）默认的 0 带一条斜杠 —— 这是程序员的习惯，
  用来区分 0 和 O。在控制台/日志里是对的。

  但 `v0.1.0` 会读成 `vØ.1.Ø`。版本号、价格、日期这些地方，
  斜杠零看着像乱码。

  原字体有 `zero` 特性，但默认就是斜杠版，
  实测 font-feature-settings / font-variant-numeric 全都改不动。

做法：
  拿 `O` 的轮廓，横向收窄到 78%，垂直居中，装进 `0`。
  这是等宽字体里最常见的手工方案 ——
  既去掉斜杠，又保留「0 比 O 窄」这个必要的区分。

用法：
  python scripts/fix-zero.py <输入.woff2> [--out 输出.woff2]
"""

import io, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.misc.transform import Transform

NARROW = 0.78   # 相对 O 的宽度


def main():
    if len(sys.argv) < 2:
        print("用法: python scripts/fix-zero.py <输入字体> [--out 输出]")
        sys.exit(1)

    src = sys.argv[1]
    dst = src
    if "--out" in sys.argv:
        dst = sys.argv[sys.argv.index("--out") + 1]

    font = TTFont(src)
    order = font.getGlyphOrder()

    # 找 0 和 O 的字形名
    zero_name = None
    for cand in ("zero", "uni0030", "zero.slash", "zero.0"):
        if cand in order:
            zero_name = cand
            break
    if zero_name is None:
        cmap = font.getBestCmap()
        zero_name = cmap.get(0x30)
    if zero_name is None:
        print("  ✗ 找不到 0 的字形")
        sys.exit(1)

    cmap = font.getBestCmap()
    o_name = cmap.get(0x4F) or cmap.get(0x6F)   # 大写 O，退而求其次小写 o
    if o_name is None:
        print("  ✗ 找不到 O 的字形")
        sys.exit(1)

    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]

    # 取 0 的步进（等宽字体里和 O 一样，但保险起见用 0 自己的）
    adv_zero = hmtx[zero_name][0]
    # 取 O 的墨迹边界，算出居中偏移
    glyf = font["glyf"] if "glyf" in font else None

    pen = TTGlyphPen(glyph_set)
    if glyf is not None:
        g = glyf[o_name]
        g.recalcBounds(glyf)
        x_min, x_max = g.xMin, g.xMax
        cx = (x_min + x_max) / 2.0
        # 收窄 + 移回原点
        t = Transform().translate(-cx, 0).scale(NARROW, 1.0).translate(adv_zero / 2.0, 0)
    else:
        # CFF 轮廓：没有 xMin，用字宽中心近似
        t = Transform().scale(NARROW, 1.0).translate(adv_zero * (1 - NARROW) / 2.0, 0)

    glyph_set[o_name].draw(TransformPen(pen, t))
    new_glyph = pen.glyph()

    if glyf is not None:
        glyf[zero_name] = new_glyph
        glyf[zero_name].recalcBounds(glyf)
    hmtx[zero_name] = (adv_zero, hmtx[zero_name][1])

    # 顺手把所有 zero 相关的交替字形也换掉（免得别的特性又把它换回来）
    swapped = 1
    for name in list(order):
        if name != zero_name and name.lower().startswith("zero"):
            try:
                pen2 = TTGlyphPen(glyph_set)
                glyph_set[o_name].draw(TransformPen(pen2, t))
                if glyf is not None:
                    glyf[name] = pen2.glyph()
                swapped += 1
            except Exception:
                pass

    font.save(dst)
    print(f"  ✓ {os.path.basename(src)}: 用 O 收窄 {int(NARROW*100)}% 替换 {zero_name}")
    print(f"    另替换交替字形 {swapped - 1} 个")
    print(f"    → {dst}  ({os.path.getsize(dst)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
