import math

print("=== 那个 AI 说「负数天数会 NaN」===")
print()

# 我的实际代码：
#   const days = Math.max(0, (now - since) / 86400000);
#   return m.weight * Math.pow(1 + days, -b);

b = 0.6
for raw in [-9, -1, 0, 1]:
    days = max(0, raw)
    r = 0.9 * math.pow(1 + days, -b)
    tag = "  ← NaN!" if math.isnan(r) else ""
    print(f"  raw days = {raw:>3}  ->  max(0,raw) = {days}  ->  R = {r:.3f}{tag}")

print()
print("=== 结论 ===")
print("  Math.max(0, ...) 已经夹住了。")
print("  Math.pow(1+0, -0.6) = 1.0，不是 NaN。")
print()

print("=== 如果**没有** max(0) 呢 ===")
for raw in [-9, -1]:
    base = 1 + raw
    if base < 0:
        print(f"  raw = {raw}  ->  base = {base}（负数）-> math.pow 会抛 ValueError / JS 里返回 NaN")
    else:
        print(f"  raw = {raw}  ->  {math.pow(base, -b)}")

print()
print("  负数底数 + 分数指数 = NaN。**这才是那个 AI 担心的场景。**")
print("  但我们的代码有 max(0)，所以到不了那一步。")
print()

print("=== 那 `time -3` 呢 ===")
print("  已经在命令层被拒了（只能往未来拨）。")
print("  即使绕过，setTimeOffsetDays 里也有 Math.max(0, ...) 兜底。")
print()
print("=== 真正的风险是「用户改系统时间」===")
print("  不是通过 time 命令，而是直接改 Windows 时钟。")
print("  那时候 Date.now() 真的会变小 ——")
print("  lastAccessed 是「未来」的时间戳，now 是「过去」的。")
print("  差值负 -> max(0) -> days = 0 -> R = 100%。")
print("  不会崩溃，但所有记忆会一起「返老还童」。")
