import { useEffect, useRef } from "react";

/**
 * 深海背景层。
 *
 * 三层构成：
 *  1. 极慢漂移的体积光（纯 CSS，走 GPU 合成，几乎零成本）
 *  2. Canvas 浮游粒子（预渲染 sprite + additive 叠加，120 粒稳定 60fps）
 *  3. 三条鲸影 —— 全篇唯一的"记忆点"，90 到 150 秒横渡一次
 */

/* 侧视鲸形。低透明度下只留一个"那里有东西在游"的印象。 */
const WHALE_PATH =
  "M6 60C10 42 40 30 80 30c32 0 52 10 62 20 6 6 12 8 18 7l18-13c4-3 10-1 10 4 0 4-4 6-6 10l8 8c2 4-2 8-6 5l-18-11c-6 4-14 6-26 4-12-2-22 6-44 8-30 3-58-2-74-12Z";
const FLIPPER_PATH = "M64 58c8-2 18 4 24 14-8 4-18 4-26-2-6-4-4-10 2-12Z";

export default function OceanBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* 预渲染光点 sprite：避免逐帧 shadowBlur */
    const SPRITE = 64;
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = SPRITE;
    const sctx = sprite.getContext("2d")!;
    const g = sctx.createRadialGradient(
      SPRITE / 2,
      SPRITE / 2,
      0,
      SPRITE / 2,
      SPRITE / 2,
      SPRITE / 2
    );
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.28, "rgba(190,255,246,0.55)");
    g.addColorStop(1, "rgba(120,230,255,0)");
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, SPRITE, SPRITE);

    let w = 0;
    let h = 0;
    let dpr = 1;

    type P = {
      x: number;
      y: number;
      r: number;
      vy: number;
      vx: number;
      a: number;
      phase: number;
      tint: string;
      twinkle: number;
    };
    let parts: P[] = [];

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(130, Math.round((w * h) / 12000));
      const tints = ["#7ff5e2", "#9fd8ff", "#c7f0ff", "#8fe0c8"];
      parts = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.5 + Math.random() * 2.1,
        vy: -(0.05 + Math.random() * 0.2),
        vx: (Math.random() - 0.5) * 0.07,
        a: 0.18 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
        tint: tints[(Math.random() * tints.length) | 0],
        twinkle: 0.4 + Math.random() * 1.4,
      }));
    };

    build();

    let raf = 0;
    let t = 0;
    let visible = true;

    const frame = () => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      for (const p of parts) {
        p.y += p.vy;
        p.x += p.vx + Math.sin(t * 0.55 + p.phase) * 0.13;

        if (p.y < -12) {
          p.y = h + 12;
          p.x = Math.random() * w;
        }
        if (p.x < -14) p.x = w + 14;
        if (p.x > w + 14) p.x = -14;

        const flicker = 0.72 + Math.sin(t * p.twinkle + p.phase) * 0.28;
        const size = p.r * 7;

        ctx.globalAlpha = p.a * flicker;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      }

      // 少数大粒子给一层实心核，做出"生物荧光"的实感
      ctx.globalCompositeOperation = "source-over";
      for (const p of parts) {
        if (p.r < 1.5) continue;
        ctx.globalAlpha = p.a * 0.5;
        ctx.fillStyle = p.tint;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      if (visible && !reduce) raf = requestAnimationFrame(frame);
    };

    frame();

    const onVis = () => {
      visible = document.visibilityState === "visible";
      if (visible && !reduce) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const ro = new ResizeObserver(() => {
      build();
      if (reduce) frame();
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-abyss">
      {/* 体积光：三团极慢漂移的冷光 */}
      <div
        className="absolute -left-[15%] top-[-25%] h-[75vh] w-[75vh] rounded-full opacity-[0.5] blur-[90px]"
        style={{
          background:
            "radial-gradient(circle, rgba(30,120,150,0.42) 0%, rgba(10,50,70,0.18) 45%, transparent 70%)",
          animation: "drift-a 46s ease-in-out infinite",
        }}
      />
      <div
        className="absolute right-[-10%] top-[10%] h-[60vh] w-[60vh] rounded-full opacity-[0.42] blur-[100px]"
        style={{
          background:
            "radial-gradient(circle, rgba(60,90,200,0.34) 0%, rgba(20,30,80,0.14) 50%, transparent 72%)",
          animation: "drift-b 62s ease-in-out infinite",
        }}
      />
      <div
        className="absolute bottom-[-25%] left-[38%] h-[65vh] w-[65vh] rounded-full opacity-[0.34] blur-[110px]"
        style={{
          background:
            "radial-gradient(circle, rgba(20,180,160,0.3) 0%, rgba(8,60,60,0.12) 48%, transparent 70%)",
          animation: "drift-c 54s ease-in-out infinite",
        }}
      />

      {/* 鲸影：三只，速度与深度各不相同。高度锁死，否则 SVG 会吃掉整个屏幕高度 */}
      <svg
        className="absolute left-0 top-[26%] h-[17vh] w-auto text-[#7fe8ff]"
        style={{ opacity: 0.055, animation: "swim-1 148s linear infinite" }}
        viewBox="0 0 200 100"
        fill="currentColor"
        aria-hidden
      >
        <path d={WHALE_PATH} />
        <path d={FLIPPER_PATH} />
      </svg>

      <svg
        className="absolute left-0 top-[62%] h-[22vh] w-auto text-[#8fd0ff]"
        style={{ opacity: 0.042, animation: "swim-2 196s linear infinite 24s" }}
        viewBox="0 0 200 100"
        fill="currentColor"
        aria-hidden
      >
        <g transform="translate(200,0) scale(-1,1)">
          <path d={WHALE_PATH} />
          <path d={FLIPPER_PATH} />
        </g>
      </svg>

      <svg
        className="absolute left-0 top-[8%] h-[12vh] w-auto text-[#9ff0e0]"
        style={{ opacity: 0.03, animation: "swim-1 260s linear infinite 70s" }}
        viewBox="0 0 200 100"
        fill="currentColor"
        aria-hidden
      >
        <path d={WHALE_PATH} />
      </svg>

      {/* 浮游粒子 */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* 顶部与底部的暗角，把注意力压回中间 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, transparent 35%, rgba(3,7,13,0.55) 100%)",
        }}
      />

      <style>{`
        @keyframes drift-a {
          0%,100% { transform: translate3d(0,0,0) scale(1); }
          50%     { transform: translate3d(6vw,4vh,0) scale(1.12); }
        }
        @keyframes drift-b {
          0%,100% { transform: translate3d(0,0,0) scale(1.05); }
          50%     { transform: translate3d(-7vw,6vh,0) scale(0.95); }
        }
        @keyframes drift-c {
          0%,100% { transform: translate3d(0,0,0) scale(0.98); }
          50%     { transform: translate3d(-4vw,-5vh,0) scale(1.1); }
        }
        @keyframes swim-1 {
          0%   { transform: translate3d(-26vw, 0, 0) rotate(-1.2deg); }
          50%  { transform: translate3d(60vw, -2.4vh, 0) rotate(0.6deg); }
          100% { transform: translate3d(132vw, 1.2vh, 0) rotate(-0.8deg); }
        }
        @keyframes swim-2 {
          0%   { transform: translate3d(128vw, 0, 0) rotate(1deg); }
          50%  { transform: translate3d(48vw, 3vh, 0) rotate(-0.5deg); }
          100% { transform: translate3d(-30vw, -1.4vh, 0) rotate(0.7deg); }
        }
      `}</style>
    </div>
  );
}
