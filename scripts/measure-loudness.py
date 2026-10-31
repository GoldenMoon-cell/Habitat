"""
算每个音效的真实响度。

── 为什么要算 ──

sound.ts 里写的是 `gain: 0.058` —— 那是**线性增益**，不是 dB，
也不是「多大声」。

Web Audio 的 destination 是满刻度（0 dBFS），所以：

  正弦波 gain 0.058  →  峰值 -24.7 dBFS
  
但一个音效往往是好几个音叠在一起，而且有 attack/decay 包络，
所以真实峰值要看加起来的结果。

── 参考值 ──

  -6 dBFS    很响（接近爆音）
  -12 dBFS   明显
  -18 dBFS   中等
  -24 dBFS   偏轻（背景音乐级别）
  -30 dBFS   很轻（能听见但要用点心）
  -40 dBFS   几乎听不见
"""

import math

def db(x):
    return 20 * math.log10(max(x, 1e-9))

# 每个音效：(名字, [(gain, type), ...], 是否有混响加成)
# 混响会把尾巴拉长，但不增加峰值多少 —— 忽略
SOUNDS = {
    "roots":        [(0.032 + 0.035 + 0.038 + 0.041 + 0.047, "sine")] + [(0.032*0.14 + 0.035*0.14 + 0.038*0.14 + 0.041*0.14 + 0.047*0.14, "sine")],
    "boot":         [(0.05, "sine"), (0.032, "sine"), (0.022, "sine")],
    "enterCreator": [(0.055, "sine"), (0.055, "sine"), (0.014, "noise")],
    "leaveCreator": [(0.05, "sine"), (0.028, "sine")],
    "rumble":       [(0.05, "sine")] * 4,   # 4 个低频叠加
    "tick":         [(0.055, "square")],
    "send":         [(0.05, "sine"), (0.02, "sine")],
    "receive":      [(0.058, "sine"), (0.02, "sine")],
    "switch":       [(0.045, "sine"), (0.025, "sine")],
    "consoleOpen":  [(0.055, "sine"), (0.014, "square")],
    "consoleClose": [(0.06, "sine")],
    "panelOpen":    [(0.055, "triangle")],
    "panelClose":   [(0.05, "triangle")],
    "birth":        [(0.05, "triangle"), (0.026, "sine")],
    "delete":       [(0.055, "sine"), (0.012, "noise")],
    "settle":       [(0.032, "triangle"), (0.028, "triangle"), (0.024, "triangle"), (0.02, "triangle")],
    "shift":        [(0.046, "square"), (0.028, "square")],
    "hold":         [(0.06, "sine"), (0.01, "noise")],
    "release":      [(0.052, "triangle")],
    "deny":         [(0.058, "triangle")],
    "error":        [(0.042, "triangle")] * 3 + [(0.035, "sine"), (0.05, "sine")],
}

# 波形对 RMS 的影响：sqrt(2) 是正弦，方波更"实"，三角更"虚"
WAVE_RMS = {"sine": 0.707, "triangle": 0.577, "square": 1.0, "noise": 0.577}

print(f"{'音效':<15} {'峰值和':>8} {'peak dBFS':>10} {'RMS dBFS':>10}  评价")
print("─" * 70)

rows = []
for name, parts in SOUNDS.items():
    # 峰值：最坏情况全部同相相加（实际会略低，但这是上界）
    peak_sum = sum(g for g, _ in parts)
    # RMS：能量相加（更接近真实听感）
    energy = sum((g * WAVE_RMS.get(t, 0.707)) ** 2 for g, t in parts)
    rms = math.sqrt(energy)

    pk_db = db(peak_sum)
    rms_db = db(rms)

    if pk_db > -9:
        verdict = "⚠️ 太响"
    elif pk_db > -15:
        verdict = "偏响"
    elif pk_db > -21:
        verdict = "中等"
    elif pk_db > -27:
        verdict = "偏轻"
    else:
        verdict = "很轻"

    rows.append((name, peak_sum, pk_db, rms_db, verdict))
    print(f"{name:<15} {peak_sum:>8.3f} {pk_db:>9.1f} {rms_db:>9.1f}  {verdict}")

print()
print("─" * 70)
print("参考：")
print("  -6 dBFS   很响（接近爆音）")
print("  -12 dBFS  明显")
print("  -18 dBFS  中等")
print("  -24 dBFS  偏轻（背景音乐级别）")
print("  -30 dBFS  很轻")
print()
print("注：这是**上界**（假设所有音同时同相达到峰值）。")
print("    真实的峰值会低 1-3 dB，因为各音的包络不是同时到顶的。")
print()
print(f"最响的：{max(rows, key=lambda r: r[2])[0]}  ({max(rows, key=lambda r: r[2])[2]:.1f} dBFS)")
print(f"最轻的：{min(rows, key=lambda r: r[2])[0]}  ({min(rows, key=lambda r: r[2])[2]:.1f} dBFS)")
