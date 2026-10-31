"""
遗忘曲线 + 复习 —— 具体数值。

场景：一条「短期」记忆，初始 weight 0.9。
"""

import math

W = 0.9
RATE = 0.35  # 短期


def R(days, rate=RATE, w=W):
    return w * math.exp(-rate * days)


print("【不复习】")
for d in [0, 1, 2, 3, 5, 7, 10]:
    r = R(d)
    mark = "  ← 跌破阈值 0.2" if r < 0.2 else ""
    print(f"  Day {d:<2}  R = {r:.3f}  ({r*100:5.1f}%){mark}")

print()
print("【Day 3 复习一次】—— 现在的实现")
print(f"  Day 3 复习前   R = {R(3):.3f}")
print(f"  Day 3 复习后   R = {R(0):.3f}   ← lastAccessed 刷新，回到原点")
for d in [1, 2, 3, 5, 7]:
    r = R(d)
    mark = "  ← 又跌破了" if r < 0.2 else ""
    print(f"  Day 3+{d:<2}      R = {r:.3f}  ({r*100:5.1f}%){mark}")

print()
print("── 问题 ──")
print("  第 1 次复习之后，衰减速度和从没复习过时**一模一样**。")
print("  真实记忆不是这样：复习过的会忘得更慢（间隔效应）。")

print()
print("【加上间隔效应】—— 每次复习让衰减率降一点")
print("  rate' = rate / (1 + accessCount * 0.6)")
print()
for ac in [0, 1, 2, 3, 5, 10]:
    r2 = RATE / (1 + ac * 0.6)
    print(f"  复习过 {ac} 次  →  rate' = {r2:.3f}/天  （三天后剩 {math.exp(-r2*3)*100:4.1f}%）")

print()
print("【对比：Day 3 和 Day 5 各复习一次】")
print("  ── 现在（无间隔效应）──")
r = W
prev = 0
for d in [1, 2, 3]:
    r *= math.exp(-RATE * (d - prev))
    prev = d
print(f"  Day 3 复习前  R = {r:.3f}")
r = W
prev = 3
for d in [4, 5]:
    r *= math.exp(-RATE * (d - prev))
    prev = d
print(f"  Day 5 复习前  R = {r:.3f}")
print(f"  Day 5 复习后  R = {W:.3f}")

print()
print("  ── 有间隔效应 ──")
r = W
prev = 0
for d in [1, 2, 3]:
    r *= math.exp(-RATE * (d - prev))
    prev = d
print(f"  Day 3 复习前  R = {r:.3f}  （同）")
r = W
prev = 3
r2 = RATE / (1 + 1 * 0.6)  # 复习过 1 次
for d in [4, 5]:
    r *= math.exp(-r2 * (d - prev))
    prev = d
print(f"  Day 5 复习前  R = {r:.3f}  ← 比上面高（忘得慢了）")
print(f"  Day 5 复习后  R = {W:.3f}")

print()
print("【一个月后】如果每 3 天复习一次")
print("  ── 无间隔效应 ── 永远是同一节奏，但每次复习后第二天掉 30%")
print("  ── 有间隔效应 ── 复习越多次，掉得越慢，最后几乎不掉了")
for ac in [0, 3, 5, 10, 20]:
    r2 = RATE / (1 + ac * 0.3)
    print(f"    复习 {ac} 次后，一个月不碰：R = {W * math.exp(-r2*30):.3f}")
