"""
三鲸空间 · 应用图标生成器
口径与 UI 一致：深海断面 + 磷光青的鲸尾剪影。
运行：python scripts/make-icon.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

S = 2048  # 超采样画布


def cubic(p0, p1, p2, p3, n=110):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = (np.asarray(p, np.float32) for p in (p0, p1, p2, p3))
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3


def unit_to_px(pts, scale=0.92, cy=0.50):
    """归一化坐标（原点居中，y 向下）→ 像素坐标"""
    out = np.empty_like(pts)
    out[:, 0] = S * 0.5 + pts[:, 0] * S * scale * 0.5
    out[:, 1] = S * cy + pts[:, 1] * S * scale * 0.5
    return [tuple(p) for p in out]


# ── 1. 圆角矩形底 ────────────────────────────────────────────
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.232), fill=255)

# ── 2. 垂直渐变 + 径向辉光 ───────────────────────────────────
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
t = (yy / S)[..., None]

top = np.array([10, 30, 44], np.float32)
bot = np.array([2, 5, 11], np.float32)
rgb = top * (1 - t) + bot * t

cx, cy_glow = S * 0.5, S * 0.44
d = np.sqrt((xx - cx) ** 2 + (yy - cy_glow) ** 2) / (S * 0.60)
glow = np.clip(1 - d, 0, 1) ** 2.1
rgb = rgb + glow[..., None] * np.array([53, 240, 206], np.float32) * 0.40

rng = np.random.default_rng(7)
rgb = rgb + rng.normal(0, 3.0, (S, S, 1)).astype(np.float32)

bg = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert("RGBA")
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(bg, (0, 0), mask)

# ── 3. 鲸尾：上缘是两个向下的 V 形缺口 ───────────────────────
STEM_L = (-0.078, 0.50)
STEM_R = (0.078, 0.50)
LTIP = (-0.95, -0.10)
RTIP = (0.95, -0.10)
SHL = (-0.24, -0.03)   # 左"肩"：上缘先近乎水平外走
SHR = (0.24, -0.03)
NOTCH = (0.00, 0.20)   # 缺口只在中间 ~25% 宽度内

# 外缘：饱满外凸的“鳍面”
outer_l = cubic(STEM_L, (-0.26, 0.32), (-0.82, 0.10), LTIP)
# 上缘：先平着出去，再陡折进缺口 → 这是鲸尾和 V 字的分界
inner_l1 = cubic(LTIP, (-0.72, -0.16), (-0.42, -0.10), SHL)
inner_l2 = cubic(SHL, (-0.15, 0.02), (-0.06, 0.13), NOTCH)
inner_r2 = cubic(NOTCH, (0.06, 0.13), (0.15, 0.02), SHR)
inner_r1 = cubic(SHR, (0.42, -0.10), (0.72, -0.16), RTIP)
outer_r = cubic(RTIP, (0.82, 0.10), (0.26, 0.32), STEM_R)

tail_pts = np.vstack([outer_l, inner_l1, inner_l2, inner_r2, inner_r1, outer_r])
tail_px = unit_to_px(tail_pts, scale=0.96, cy=0.50)

raw_mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(raw_mask).polygon(tail_px, fill=255)

# 轻微圆角，避免鳍尖像刀片
raw_mask = raw_mask.filter(ImageFilter.GaussianBlur(S * 0.0075)).point(
    lambda v: 255 if v > 120 else 0
)
a = np.array(raw_mask, np.float32) / 255.0

ys = np.array(tail_px)[:, 1]
ymin, ymax = ys.min(), ys.max()
f = np.clip((yy - ymin) / max(ymax - ymin, 1), 0, 1)[..., None]

c_top = np.array([132, 255, 240], np.float32)
c_bot = np.array([18, 178, 158], np.float32)
tail_rgb = c_top * (1 - f) + c_bot * f

# 内侧亮边：mask 减去模糊后的 mask，得到一圈细线
soft = np.array(
    Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(S * 0.007)),
    np.float32,
) / 255.0
rim = np.clip(a - soft, 0, 1)
rim = rim / max(rim.max(), 1e-6)
rim = rim[..., None] ** 1.4

tail_rgb = tail_rgb + rim * np.array([60, 90, 86], np.float32)

tail = Image.fromarray(
    np.dstack([np.clip(tail_rgb, 0, 255), a * 242]).astype(np.uint8)
)

# 外发光
halo_src = np.dstack([np.full((S, S, 3), [53, 240, 206], np.float32), a * 255]).astype(np.uint8)
halo = Image.fromarray(halo_src).filter(ImageFilter.GaussianBlur(S * 0.026))
h = np.array(halo)
h[..., 3] = (h[..., 3].astype(np.float32) * 0.62).astype(np.uint8)

img = Image.alpha_composite(img, Image.fromarray(h))
img = Image.alpha_composite(img, tail)

# ── 4. 输出 ─────────────────────────────────────────────────
master = img.filter(ImageFilter.GaussianBlur(S * 0.0012))

targets = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

for name, size in targets.items():
    master.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)

master.resize((256, 256), Image.LANCZOS).save(
    OUT / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print(f"icons written -> {OUT}")
for p in sorted(OUT.iterdir()):
    print(f"  {p.name:26s} {p.stat().st_size/1024:6.1f} KB")
