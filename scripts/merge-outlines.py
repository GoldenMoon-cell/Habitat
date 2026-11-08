"""
轮廓合并（skia-pathops）

为什么需要这一步：

  build-font.mjs 把折线展开成一堆**互相重叠的矩形**。
  浏览器和 fonttools 靠非零环绕规则能合成一个形状，但
  FontLab 吃不下 —— 600 多条重叠子路径直接把它的内部状态搞崩了
  （症状：之后每次启动都卡在崩溃报告窗口）。

  所以推给 FontLab 之前，先用 pathops 把重叠矩形真正合并成
  一条（或几条）干净的闭合轮廓。

用法：
  python scripts/merge-outlines.py            # 读 .font.json，写 .font-clean.json
  python scripts/merge-outlines.py --stats    # 只看合并前后子路径数
"""

import io, json, os, sys
import pathops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".font.json")
DST = os.path.join(ROOT, ".font-clean.json")


# ── 垂直基准线 ─────────────────────────────────────────
#
# 为什么需要这个：
#
#   描边展开时，横笔沿法向（垂直）各溢出半个笔宽 42，
#   竖笔沿法向（水平）不溢出。于是 E 顶到 745、H 顶到 700 ——
#   同一行里差 42 单位（字高的 6%）。
#
#   这不是"缺少 overshoot"，是**没有统一基准线**。
#
# 真字体的做法：
#   扁平字（E F H I L T Z）墨迹正好卡 0 / 700
#   圆形字（O C G Q S）溢出约 1.5%（这里是 14）才显等高
#   尖角字（A V W X Y M N）溢出约 2%（这里是 20），因为尖角视觉上"虚"
#
OFS_ROUND = 14
OFS_POINT = 20

# 上下都扁
FLAT = set("EFHIJLTZ")
# 上下都圆
ROUND = set("OCGSQ")
# 上下都尖
POINT = set("AVWXY")   # 只有对角/收尖的才溢出；M N 上下是竖笔端，是平的
# 数字：0 6 8 9 圆，其余扁
DIGIT_ROUND = set("0689")


def clip_box(ch):
    """返回 (top, bottom)：墨迹应该达到的上下界"""
    if ch in ROUND or (ch.isdigit() and ch in DIGIT_ROUND):
        return 700 + OFS_ROUND, -OFS_ROUND
    if ch in POINT:
        return 700 + OFS_POINT, -OFS_POINT
    if ch.upper() in ROUND:
        return 700 + OFS_ROUND, -OFS_ROUND
    return 700, 0


def clip_to_box(contours, ch):
    """把合并后的轮廓垂向裁到基准线内"""
    top, bot = clip_box(ch)
    if not contours:
        return contours
    box = pathops.Path()
    box.moveTo(-500, bot)
    box.lineTo(1400, bot)
    box.lineTo(1400, top)
    box.lineTo(-500, top)
    box.close()

    src = pathops.Path()
    for c in contours:
        src.moveTo(c[0][0], c[0][1])
        for p in c[1:]:
            src.lineTo(p[0], p[1])
        src.close()

    out = pathops.op(src, box, pathops.PathOp.INTERSECTION, fix_winding=True)
    res = []
    for contour in out.contours:
        pts = []
        for verb, points in contour.segments:
            if verb == "closePath" or not points:
                continue
            x, y = points[-1]
            pts.append([round(x), round(y)])
        if len(pts) >= 3:
            res.append(pts)
    return res


def merge_one(contours):
    """把一组可能重叠的多边形合成干净轮廓"""
    if not contours:
        return []

    path = pathops.Path()
    for c in contours:
        if len(c) < 3:
            continue
        path.moveTo(c[0][0], c[0][1])
        for p in c[1:]:
            path.lineTo(p[0], p[1])
        path.close()

    # simplify = 自相交/重叠的去重合并
    out = pathops.simplify(path, fix_winding=True, clockwise=False)

    result = []
    for contour in out.contours:
        pts = []
        # segments 的形状是 (verb, points)：('lineTo', ((x, y),))
        for verb, points in contour.segments:
            if verb == "closePath" or not points:
                continue
            # 取这一段最后一个点作为终点（我们的输入全是直线）
            x, y = points[-1]
            pts.append([round(x), round(y)])
        if len(pts) >= 3:
            result.append(pts)
    return result


def main():
    if not os.path.exists(SRC):
        print(f"  ✗ 找不到 {SRC} —— 先跑 build-font.mjs 的 dump")
        sys.exit(1)

    data = json.load(io.open(SRC, encoding="utf-8"))
    out = {}
    before = after = 0
    worst = []

    for ch, d in data.items():
        cs = d.get("contours", [])
        before += len(cs)
        merged = merge_one(cs)
        merged = clip_to_box(merged, ch)
        after += len(merged)
        out[ch] = {"contours": merged, "advance": d.get("advance", 780)}
        if len(cs) != len(merged):
            worst.append((ch, len(cs), len(merged)))

    io.open(DST, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))

    print(f"  字形 {len(data)} 个")
    print(f"  子路径 {before} → {after}   （减少 {before - after} 条）")
    if "--stats" in sys.argv:
        print("\n  合并幅度最大的 8 个：")
        for ch, b, a in sorted(worst, key=lambda x: -(x[1] - x[2]))[:8]:
            print(f"    {ch!r:<6} {b:>3} → {a}")
    print(f"\n  → {DST}")


if __name__ == "__main__":
    main()
