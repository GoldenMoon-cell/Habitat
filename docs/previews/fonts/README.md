# 自制西文字体 · 素材说明

> **状态：素材，不进软件。**
> 2026-11-08 决定。这个目录的文件不参与构建，app 也不用它。

## 这是什么

一套自己画的几何等宽西文字体，89 个字形（A-Z / a-z / 0-9 / 标点），
6 KB woff2。设计语言是「全直角 + 45° 切角，没有一条曲线」，
为的是贴《生境》深海 / 仪表盘的观感。

| 文件 | 说明 |
|---|---|
| `Habitat-Regular.woff2` | 产物，6 KB |
| `Habitat-Regular.ttf` | 产物，13 KB |
| `../../../scripts/font-design.mjs` | **字形真源**：82 个字形 = 折线坐标表 |
| `../../../scripts/dump-outlines.mjs` | 折线 → 描边轮廓 JSON |
| `../../../scripts/merge-outlines.py` | 重叠矩形 → 干净轮廓（skia-pathops）+ 垂直基准线裁切 |
| `../../../scripts/make-font.py` | 轮廓 → TTF / woff2（fonttools） |
| `../../../scripts/push-fontlab.mjs` | 推给 FontLab（带 fontId 守卫） |
| `../../../scripts/fix-zero.py` | 零字形去斜杠（改字形，不是改特性） |

## 为什么不进软件

原计划是接 `--font-mono`，覆盖控制台 / 数字 / HUD 读数。

**但那个位置后来被更纱黑体占了。** 原因是能力边界，不是画得好不好：

| | 更纱黑体 | 自制西文 |
|---|---|---|
| 中文 | ✅ 思源黑体 | ❌ 没有 |
| 中西文对齐 | ✅ 一个汉字 = 两个西文字宽 | ❌ 遇到汉字就崩 |
| 字重 | 4 个 | **1 个（只有 Regular）** |
| 独有味道 | 中性 | ✅ 切角 |

等宽层必然出现汉字（`已接入 3`、`群聊上下文`），
纯西文字体在那里一定会露馅。所以更纱胜出，这是对的。

**剩下能用的位置只有两处，而且都很小：**

- 星图 HUD 的 `SEDIMENT`（9px，原来是宋体栈）
- 左栏的 `local stack`（10px）

为两处 9px 的字内置一个字体，不值。

## 已知缺陷（要接着做的话先修这些）

1. **`S` `r` `G` `a` 四个字拓扑是坏的**
   `S` 读起来像反向 Z（`SEDIMENT` 打头那个就是它）。
   其余 78 个能直接用。
2. **只有 Regular 一个字重**
   哪里有 `font-medium` / `font-semibold`，换过去会触发**合成假粗**
   （浏览器把轮廓往外糊一圈），比细体更难看。
   要用在标题上，得先补一套 semibold。
3. **标点没细调**
   `·` `.` `,` 的字宽和位置是按等宽格摆的，没做过光学调整。

## 怎么重建

```bash
node scripts/dump-outlines.mjs            # 折线 → .font.json
python scripts/merge-outlines.py          # 合并 + 垂直裁切 → .font-clean.json
python scripts/make-font.py               # → Habitat-Regular.ttf / .woff2
python scripts/fix-zero.py <字体> --out <输出>   # 去斜杠零（可选）
```

改字形只需要改 `scripts/font-design.mjs` 里的坐标，然后重跑上面三步。

## 设计参数

```
网格 6 × 7（×100 单位），基线 y=0，大写字高 700
笔画 84，全直角 + 45° 切角
等宽步进 780（字形 600 + 左右各 90 侧距）
UPM 1000

垂直基准线（这一步是量出来的，不是猜的）：
  扁平字  E F H I J L T Z      墨迹卡 0 / 700
  圆形字  O C G S Q + 0 6 8 9  溢出 14（约 2%）
  尖角字  A V W X Y            溢出 20
```

## 如果以后要用

优先级排序：

1. 修 `S` `r` `G` `a`
2. 补一套 semibold
3. 接在**纯西文、字号大**的位置：启动画面的大字、关于页、
   以后的封面 —— 这些地方不会出现中文，它的切角才是加分
4. **不要接在等宽层**，那里更纱是对的

## 试样页

`font-test.html`（真字体渲染）、`font-specimen.html`（坐标定义的 SVG 试样）、
`font-metrics.html`（光学测量：墨迹边界 + 每字形墨量）。
