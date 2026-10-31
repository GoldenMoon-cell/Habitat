import { useEffect, useRef } from "react";

/**
 * 她消失。
 *
 * ── 两种死法，两个方向 ──
 *
 * **强制删除**（你按的）：粒子**向下坠落** —— 你把她按下去。
 *
 * **预定死亡**（到点了）：粒子**向上飘散** —— 时候到了，她自己散开。
 *
 * 同一个技术，两个方向，两种意思。
 *
 * ── 怎么采样 ──
 *
 * 把名字画到离屏 canvas，读 ImageData，取 alpha > 128 的点。
 *
 * 和 `RenameEffect` 同一套 —— 但那个是「飞向新名字」，
 * 这个是「散掉，没有新名字」。
 *
 * ── 雷达怎么办 ──
 *
 * 雷达是 SVG，画不了粒子。所以：
 *
 *   · 粒子层（Canvas）盖全屏，从名字的位置散开
 *   · 雷达那边由调用方自己淡到 0（用 CSS/motion）
 *
 * 两个同时发生，看起来就是「她的形状也散了」。
 */

const FONT_STACK = 'Georgia, "Songti SC", "SimSun", "Microsoft YaHei", serif';

interface P {
  x: number;
  y: number;
  /** 速度 */
  vx: number;
  vy: number;
  size: number;
  /** 起始延迟 */
  delay: number;
  /** 这次粒子的旋转 */
  spin: number;
}

export default function DeathEffect({
  name,
  /** "forced" = 你按的（向下坠落） / "fated" = 到点了（向上飘散） */
  mode,
  onDone,
}: {
  name: string;
  mode: "forced" | "fated";
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

    /* ── 采样名字 ── */
    const sample = (text: string, fontSize: number): { x: number; y: number }[] => {
      const off = document.createElement("canvas");
      const octx = off.getContext("2d");
      if (!octx) return [];

      /* 顺序很重要：设 font → measure → 定尺寸 → 再设一遍 font */
      octx.font = `${fontSize}px ${FONT_STACK}`;
      const w = Math.ceil(octx.measureText(text).width) + 40;
      const h = Math.ceil(fontSize * 1.6);
      off.width = w;
      off.height = h;
      octx.font = `${fontSize}px ${FONT_STACK}`;
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillStyle = "#fff";
      octx.fillText(text, w / 2, h / 2);

      const img = octx.getImageData(0, 0, w, h).data;
      const pts: { x: number; y: number }[] = [];
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
    const cy = H * 0.42;
    const SIZE = Math.min(110, W * 0.11);
    const pts = sample(name, SIZE);
    const n = pts.length || 1;

    const forced = mode === "forced";

    const particles: P[] = pts.map((p) => ({
      x: cx + p.x,
      y: cy + p.y,
      /*
       * 速度。
       *
       * forced：向下 + 一点点横向散开 —— 像被别人推下去
       * fated：向上 + 更大的横向漂移 —— 像被风带走
       */
      vx: (Math.random() - 0.5) * (forced ? 30 : 70),
      vy: forced
        ? 140 + Math.random() * 160 /* 向下，越来越快 */
        : -(50 + Math.random() * 70) /* 向上，轻 */
      ,
      size: 1 + Math.random() * 1.7,
      delay: Math.random() * (forced ? 0.1 : 0.35),
      spin: Math.random() * Math.PI * 2,
    }));

    /* 时长：强制快，预定慢 */
    const DUR = forced ? 0.85 : 2.1;
    const G = forced ? 320 : -18; /* 重力：forced 加速下落，fated 几乎不加速 */

    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = Math.min(1, (now - t0) / 1000 / DUR);
      ctx.clearRect(0, 0, W, H);

      for (const p of particles) {
        const local = Math.max(0, Math.min(1, (t - p.delay) / (1 - p.delay || 1)));
        if (local <= 0) continue;

        /* 积分一次位移：v*t + 0.5*G*t² */
        const sec = local * DUR;
        const x = p.x + p.vx * sec;
        const y = p.y + p.vy * sec + 0.5 * G * sec * sec;

        /*
         * 透明度。
         *
         * forced：前 40% 还清楚，然后快速消失
         * fated：全程缓慢淡出 —— 它一直在，只是越来越淡
         */
        const alpha = forced
          ? local < 0.4
            ? 1 - local * 0.4
            : Math.max(0, 0.84 * (1 - (local - 0.4) / 0.6))
          : Math.max(0, 1 - local * 0.85);

        if (alpha <= 0.02) continue;

        ctx.globalAlpha = alpha;
        /*
         * 颜色。
         *
         * forced：红 —— 被撕掉的
         * fated：青 —— 走完了
         */
        ctx.fillStyle = forced
          ? "rgba(255,122,107,.92)"
          : "rgba(53,240,206,.85)";
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
  }, [name, mode]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-[190]"
      aria-hidden
    />
  );
}
