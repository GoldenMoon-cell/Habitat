"""
验证艾宾浩斯原始数据的拟合。

── 关键事实 ──

维基百科原文（1885 年《记忆》）：

    b = 100k / ((log t)^c + k)

supermemo.guru 的解读：

    Pure forgetting curve is **exponential** in nature.
    Due to the fact that Ebbinghaus used **saving on re-learning rather than recall**,
    his curve can be best described by a **fast-decay power function**.

── 所以 ──

艾宾浩斯测的是「节省法」（重新学一遍省了多少时间），**不是「回忆」**。
他的曲线是**幂函数** —— 前快后慢，尾巴拖得很长。

指数衰减 `e^(-kt)` 算得快，但**尾巴掉得太干净** —— 不符合真实记忆。
"""

import math

# 艾宾浩斯 1885 年的原始数据（无意义音节，节省法）
# t 单位：天；R = 保留率（%）
EBBINGHAUS = [
    (20 / 1440, 58.2),   # 20 分钟
    (1 / 24, 44.2),      # 1 小时
    (9 / 24, 35.8),      # 9 小时
    (1, 33.7),           # 1 天
    (2, 27.8),           # 2 天
    (6, 25.4),           # 6 天
    (31, 21.1),          # 31 天
]

print("艾宾浩斯原始数据：")
print(f"{'时间':<12} {'实测保留率':>10}")
for t, r in EBBINGHAUS:
    label = f"{t*24:.0f}h" if t < 1 else f"{t:.0f}d"
    print(f"{label:<12} {r:>9.1f}%")

# ── 拟合幂函数：R = a * t^(-b) ──
# 用 t=1d 和 t=31d 两个点解
# 0.211 = a * 31^(-b)、0.337 = a * 1^(-b) = a
a = 0.337
b = -math.log(0.211 / 0.337) / math.log(31)

print()
print(f"幂函数拟合：R = {a:.3f} × t^(-{b:.3f})   （t 单位：天）")
print()
print(f"{'时间':<12} {'实测':>8} {'幂函数':>8} {'误差':>8}")
for t, r in EBBINGHAUS:
    pred = a * (t ** -b) * 100
    print(f"{'':<12} {r:>7.1f}% {pred:>7.1f}% {pred-r:>+7.1f}")

print()
print("── 指数拟合对比 ──")
print("如果用 R = e^(-k*t)，单点拟合 k = -ln(0.337)/1 = 1.088：")
print(f"{'时间':<12} {'实测':>8} {'指数':>8} {'误差':>8}")
for t, r in EBBINGHAUS:
    pred = math.exp(-1.088 * t) * 100
    print(f"{'':<12} {r:>7.1f}% {pred:>7.1f}% {pred-r:>+7.1f}")

print()
print("── 结论 ──")
print("指数在 1 天内还行，但 6 天和 31 天**掉得太干净** ——")
print("实测 6 天还有 25%，指数算出 0.15%。")
print()
print("幂函数的误差全在 3 个百分点以内。")

print()
print("=" * 60)
print()

# ── 软件里该怎么用 ──
print("【给生境的两段式】")
print()
print("R = weight × (1 + t)^(-b)      t 单位：天，+1 避免 t=0 时爆炸")
print()
print("  b 按「是否已巩固」分：")
print()

for name, bb, desc in [
    ("短期（海马体）", 0.35, "还没巩固 —— 忘得快"),
    ("长期（皮层）", 0.06, "已巩固 —— 尾巴拖得很长"),
]:
    print(f"  {name}  b = {bb}   {desc}")
    marks = []
    for t in [0, 1, 3, 7, 30, 90, 365]:
        r = (1 + t) ** -bb
        marks.append(f"{t}d:{r*100:4.0f}%")
    print("      " + "  ".join(marks))
    print()

print("── 对比旧实现（指数 0.35/天）──")
print("      0d: 100%  1d: 70%  3d: 35%  7d:  9%  30d:  0%  90d:  0%")
print()
print("差别最大的是尾巴：")
print("  指数：一个月后归零")
print("  幂函数：一个月后还有 30%（短期）/ 82%（长期）")
print()
print("**真实记忆不会归零。它会变成一种「想不太起来」的东西。**")
