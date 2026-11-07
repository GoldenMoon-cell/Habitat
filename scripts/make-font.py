"""
轮廓 JSON → 真的字体文件（TTF + woff2）

为什么不用 FontLab 导出：
  MCP 那层的 save_font 只认 .vfj / .vfc / .vfjp；
  导出 OTF 要走 ExportControl —— 那是个需要 Qt 上下文的类，
  在 MCP 的 run_python 里 init() 都调不动。

  所以分工改成：
    · 字形数据在 scripts/font-design.mjs（唯一真源）
    · FontLab 用来肉眼看和做 remove_overlap 之类的动作
    · 最终产物由 fonttools 确定性生成（不依赖 GUI）

用法：
  python scripts/make-font.py            # 出 ttf + woff2
  python scripts/make-font.py --ttf-only
"""

import io, json, sys, os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".font.json")
OUT_DIR = os.path.join(ROOT, "docs", "previews", "fonts")
FAMILY = "Habitat"
STYLE = "Regular"
UPM = 1000

def main():
    with io.open(SRC, encoding="utf-8") as f:
        data = json.load(f)

    # 只保留有轮廓的字形（空格没有轮廓，但要有 advance）
    items = [(ch, d) for ch, d in data.items() if ch.strip()]
    chars = sorted(items, key=lambda kv: ord(kv[0]))

    # 字形名必须能进 post 表的 Latin-1 —— 直接用 "—" 会崩。
    # 字母数字用自己，其余用 uniXXXX。
    def gname(ch):
        if ch.isascii() and ch.isalnum():
            return ch
        known = {".": "period", ",": "comma", ":": "colon", ";": "semicolon",
                 "-": "hyphen", "_": "underscore", "(": "parenleft", ")": "parenright",
                 "[": "bracketleft", "]": "bracketright", "/": "slash",
                 "\\": "backslash", "+": "plus", "=": "equal", "<": "less",
                 ">": "greater", "*": "asterisk", "#": "numbersign", "@": "at",
                 "&": "ampersand", "%": "percent", "!": "exclam", "?": "question",
                 "'": "quotesingle", '"': "quotedbl"}
        return known.get(ch) or "uni%04X" % ord(ch)

    order = [".notdef"] + [gname(ch) for ch, _ in chars] + ["space"]
    glyphs = {}
    metrics = {}

    # .notdef：一个空心方框
    nd = TTGlyphPen(None)
    for c in [
        [(80, 0), (580, 0), (580, 700), (80, 700)],
        [(160, 80), (160, 620), (500, 620), (500, 80)],
    ]:
        nd.moveTo(c[0])
        for p in c[1:]:
            nd.lineTo(p)
        nd.closePath()
    glyphs[".notdef"] = nd.glyph()
    metrics[".notdef"] = (600, 0)

    total_c = 0
    for ch, d in chars:
        pen = TTGlyphPen(None)
        for contour in d["contours"]:
            if len(contour) < 3:
                continue
            pen.moveTo(contour[0])
            for p in contour[1:]:
                pen.lineTo(p)
            pen.closePath()
            total_c += 1
        glyphs[gname(ch)] = pen.glyph()
        metrics[gname(ch)] = (d["advance"], 0)

    # 空格
    sp = TTGlyphPen(None)
    glyphs["space"] = sp.glyph()
    metrics["space"] = (780, 0)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({ord(ch): gname(ch) for ch, _ in chars})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=900, descent=-250)
    fb.setupNameTable({
        "familyName": FAMILY,
        "styleName": STYLE,
        "uniqueFontIdentifier": f"{FAMILY}-{STYLE}-v0.1",
        "fullName": f"{FAMILY} {STYLE}",
        "psName": f"{FAMILY}-{STYLE}",
        "version": "Version 0.1",
    })
    fb.setupOS2(sTypoAscender=700, sTypoDescender=-200, usWinAscent=900, usWinDescent=250)
    fb.setupPost()

    os.makedirs(OUT_DIR, exist_ok=True)
    ttf_path = os.path.join(OUT_DIR, f"{FAMILY}-{STYLE}.ttf")
    fb.save(ttf_path)
    print(f"  ✓ {os.path.basename(ttf_path)}  {os.path.getsize(ttf_path)/1024:.0f} KB")

    if "--ttf-only" not in sys.argv:
        try:
            from fontTools.ttLib import TTFont
            f = TTFont(ttf_path)
            f.flavor = "woff2"
            w2 = os.path.join(OUT_DIR, f"{FAMILY}-{STYLE}.woff2")
            f.save(w2)
            print(f"  ✓ {os.path.basename(w2)}  {os.path.getsize(w2)/1024:.0f} KB")
        except Exception as e:
            print("  ! woff2 失败:", e)

    print(f"\n  字形 {len(chars)} 个 · 子路径 {total_c} 条 · UPM {UPM}")

if __name__ == "__main__":
    main()
