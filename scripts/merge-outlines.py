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
