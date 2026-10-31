import { useEffect, useRef } from "react";

/**
 * 改名的粒子特效。
 *
 * ── 用户要的 ──
 *
 * 「原名字变成粒子逐渐消散，然后粒子逐渐重组成新名字」
 *
 * ── 我加了什么 ──
 *
 * 纯「消散重组」是**温柔**的 —— 那适合「她自己愿意改名」。
 *
 * 但强制改名的语义是**「我越过她的意愿改的」**。所以：
 *
 *   · 旧名字的粒子**向下坠落**（有重力），不是均匀飘散
 *   · 新名字的粒子**从上方落位**，不是从中间升起
 *
 * 这样还是「同一个她，换了个壳」，但多了一点**被按下去**的感觉。
 *
 * ── 怎么采样 ──
 *
 * 把名字画到离屏 canvas，读 ImageData，取 alpha > 128 的像素点。
 * 隔几个像素取一个 —— 太多会卡，太少会认不出字。
 *
 * ── 为什么用 canvas 不用 DOM ──
 *
 * 500 个 DOM 节点飞起来会掉帧。canvas 一个 `fillRect` 循环没有这个问题。
 */

const FONT_STACK =
  'Georgia, "Songti SC", "SimSun", "Microsoft YaHei", serif';

interface P {
  /** 起点 */
  x0: number;
  y0: number;
  /** 终点 */
  x1: number;
  y1: number;
  /** 起始时间偏移（让粒子不是同时出发） */
  delay: number;
  /** 大小 */
  size: number;
  /** 横向漂移 */
  drift: number;
}

export default function RenameEffect({
  from,
  to,
  mode = "forced",
  onDone,
}: {
  from: string;
  to: string;
  /**
   * 改名是谁提的。
   *
   * forced  你强行改的 —— 旧名字**向下坠落**，红
   * chosen  她自己提的 —— 旧名字**向上飘起**，青
   *
   * 同一个技术，两个方向，两种意思。
   */
  mode?: "forced" | "chosen";
  onDone?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    ctx.scale(dpr, dpr);

    /* ── 采样一个名字，返回屏幕坐标点 ── */
    const sample = (text: string, fontSize: number): { x: number; y: number }[] => {
      const off = document.createElement("canvas");
      const octx = off.getContext("2d");
      if (!octx) return [];

      /*
       * ── 顺序很重要 ──
       *
       * 第一版先 measureText 再设 font —— 那一刻 font 还是默认的
       * 10px sans-serif，测出来的宽度远小于实际字号，
       * canvas 太小，字被裁成碎片，采样出来是个「行」。
       *
       * 必须：**设 font → measure → 定尺寸 → 画**。
       */
      octx.font = `${fontSize}px ${FONT_STACK}`;
      const w = Math.ceil(octx.measureText(text).width) + 40;
      const h = Math.ceil(fontSize * 1.6);
      off.width = w;
      off.height = h;
      /* 改尺寸会重置 context —— 再设一遍 */
      octx.font = `${fontSize}px ${FONT_STACK}`;
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillStyle = "#fff";
      octx.fillText(text, w / 2, h / 2);

      const img = octx.getImageData(0, 0, w, h).data;
      const pts: { x: number; y: number }[] = [];
      /* 隔 3 个像素取一个 —— 大约几百个点，够认字也不卡 */
      const step = 3;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          if (img[(y * w + x) * 4 + 3] > 128) {
            pts.push({ x: x - w / 2, y: y - h / 2 });
          }
        }
      }
      return pts;
    };

    const cx = W / 2;
    const cy = H / 2;
    const SIZE = Math.min(120, W * 0.12);

    const fromPts = sample(from, SIZE);
    const toPts = sample(to, SIZE);

    /*
     * 粒子配对。
     *
     * 不能按索引硬配 —— 两个名字的点数不一样，而且形状不同。
     * 按「角度排序后对应」会好一点：每个粒子飞到「相对位置最接近」的
     * 那个新点，这样重组的轨迹不会乱穿。
     */
    const n = Math.max(fromPts.length, toPts.length);
    const particles: P[] = [];

    for (let i = 0; i < n; i++) {
      /*
       * 兜底：如果某一边采样为空（字体没加载 / 画布尺寸异常），
       * 用另一边的坐标 —— 宁可效果弱一点，也不要一片空白。
       */
      const src = fromPts.length ? fromPts : toPts;
      const dst = toPts.length ? toPts : fromPts;
      const a = src[i % Math.max(1, src.length)] ?? { x: 0, y: 0 };
      const b = dst[i % Math.max(1, dst.length)] ?? { x: 0, y: 0 };
      particles.push({
        x0: cx + a.x,
        y0: cy + a.y,
        x1: cx + b.x,
        y1: cy + b.y,
        delay: Math.random() * 0.12,
        size: 1 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 30,
      });
    }

    const DUR = 1.15;
    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = Math.min(1, (now - t0) / 1000 / DUR);
      ctx.clearRect(0, 0, W, H);

      for (const p of particles) {
        /* 每个粒子自己的进度（有 delay） */
        const local = Math.max(0, Math.min(1, (t - p.delay) / (1 - p.delay || 1)));

        /*
         * 四段：
         *   0.00 - 0.30  旧名字在原地，开始抖
         *   0.30 - 0.55  向下坠落 + 淡出
         *   0.55 - 0.75  空档（什么都没有，这是「她真的不见了」的那一下）
         *   0.75 - 1.00  新名字从上方落位
         */
        let x: number;
        let y: number;
        let alpha: number;

        if (local < 0.30) {
          const k = local / 0.30;
          x = p.x0 + Math.sin(k * 20 + p.drift) * 1.5;
          y = p.y0;
          alpha = 1 - k * 0.15;
        } else if (local < 0.55) {
          const k = (local - 0.30) / 0.25;
          x = p.x0 + p.drift * k;
          /* 重力：越往后掉得越快 */
          /*
           * 强制：向下坠落（重力）
           * 自愿：向上飘起（像松开手）
           */
          y = mode === "chosen" ? p.y0 - k * 70 : p.y0 + k * k * 140;
          alpha = 0.85 * (1 - k);
        } else if (local < 0.75) {
          /* 空档 —— 什么都不画 */
          alpha = 0;
          x = p.x0;
          y = p.y0;
        } else {
          const k = (local - 0.75) / 0.25;
          /* 从上方 90px 落下来，带一点回弹感（easeOutBack 的简化） */
          const ease = 1 - Math.pow(1 - k, 3);
          x = p.x1;
          y = p.y1 - (1 - ease) * 90;
          alpha = ease;
        }

        if (alpha <= 0.01) continue;

        ctx.globalAlpha = alpha;
        /*
         * 颜色按**阶段**走，不按粒子索引。
         *
         * 第一版写的是 `p.hue === "old" ? 红 : 青`，
         * 而 hue 是按 `i < fromPts.length` 分的 —— fromPts 有 709 个点，
         * n 也是 709，所以**所有粒子都是 "old"**，新名字也变成红的了。
         *
         * 现在：坠落阶段（local < 0.75）是红的，落位阶段是青的。
         */
        ctx.fillStyle =
          local < 0.75
            ? mode === "chosen"
              ? "rgba(53,240,206,.8)" /* 她自己要换的 —— 青 */
              : "rgba(255,122,107,.92)" /* 被撕掉的 —— 红 */
            : "rgba(53,240,206,.95)"; /* 落位的 —— 青 */
        ctx.fillRect(x, y, p.size, p.size);
      }

      ctx.globalAlpha = 1;

      if (t < 1) {
        raf = requestAnimationFrame(draw);
      } else {
        doneRef.current?.();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-[200]"
      aria-hidden
    />
  );
}
