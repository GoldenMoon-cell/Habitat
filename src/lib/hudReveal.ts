/**
 * 启动序列的逐块展开。
 *
 * 为什么不用 CSS 动画：
 *   写了两版 `.hud-blocks > * { animation: ... }`，规则都编译进了产物，
 *   DOM 上就是不生效。CSS 层叠隔着屏幕没法逐条排查。
 *   这里直接调 Web Animations API —— 查到哪块动哪块，没有中间层。
 *
 * 为什么移除 prefers-reduced-motion 的早退：
 *   原来第一行是 `if (matches) return []`，浏览器一旦报 reduce，
 *   整段就是「静默什么都不做」—— 表现为「动画代码写了但完全没动静」。
 *   现在改成：reduce 时保留一个极短的淡入（不跳过），
 *   这样即使系统关着动画，至少不会出现「一片空白等 2 秒」。
 */

type Dir = "left" | "right" | "up";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

function prefersReduced(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

function railKeyframes(dir: Dir): Keyframe[] {
  const from =
    dir === "left"
      ? "translateX(-40px)"
      : dir === "right"
        ? "translateX(40px)"
        : "translateY(26px)";

  /*
   * 去掉了 filter: blur()。
   *
   * 原来栏位和块都带模糊，4 栏 × 5 块 = 20 个元素同时跑高斯模糊——
   * 这是展开时「卡一下」的主因。blur 还断 GPU 合成。
   *
   * 现在只留 opacity + transform + clipPath：前两个是合成层属性，
   * clipPath 会重绘但比 blur 便宜一个数量级。观感差别很小。
   */
  return [
    {
      opacity: 0,
      transform: from,
      /* 科幻感：从一条窄缝里划开，而不是整块淡入 */
      clipPath:
        dir === "left"
          ? "inset(0 100% 0 0)"
          : dir === "right"
            ? "inset(0 0 0 100%)"
            : "inset(0 0 100% 0)",
    },
    {
      opacity: 1,
      transform: "none",
      clipPath: "inset(0 0 0 0)",
    },
  ];
}

const blockKeyframes: Keyframe[] = [
  { opacity: 0, transform: "translateY(16px) scale(0.99)" },
  { opacity: 1, transform: "none" },
];

/**
 * @param aside  栏位根元素
 * @param index  第几栏（0 起）
 * @param dir    入场方向
 */
export function revealRail(
  aside: HTMLElement,
  index: number,
  dir: Dir
): Animation[] {
  const reduced = prefersReduced();
  const base = reduced ? 0 : 40 + index * 150;
  const railDur = reduced ? 160 : 620;
  const blockDur = reduced ? 160 : 540;
  const step = reduced ? 0 : 110;

  const out: Animation[] = [];

  /* ── 栏位本体：划开 + 上浮 ── */
  out.push(
    aside.animate(railKeyframes(dir), {
      duration: railDur,
      delay: base,
      easing: EASE,
      fill: "backwards",
    })
  );

  /* 边框荧光：一条从透明到可见的描边呼吸 */
  if (!reduced) {
    out.push(
      aside.animate(
        [
          { boxShadow: "inset 0 0 0 1px rgba(53,240,206,0)" },
          { boxShadow: "inset 0 0 0 1px rgba(53,240,206,0.22)" },
          { boxShadow: "inset 0 0 0 1px rgba(53,240,206,0)" },
        ],
        { duration: 900, delay: base + railDur, easing: "ease-out", fill: "none" }
      )
    );
  }

  /* ── 栏内功能区：逐块浮现 ── */
  const host = aside.querySelector<HTMLElement>(".hud-blocks");
  const blocks = host ? Array.from(host.children) : [];

  blocks.forEach((el, i) => {
    if (!(el instanceof HTMLElement)) return;
    out.push(
      el.animate(blockKeyframes, {
        duration: blockDur,
        delay: base + (reduced ? 0 : 240 + i * step),
        easing: EASE,
        fill: "backwards",
      })
    );
  });

  return out;
}

/** 测试用：把当前栏里的块数列出来，方便在控制台确认选择器命中 */
export function debugRailBlocks(aside: HTMLElement | null): string {
  if (!aside) return "aside 为 null";
  const host = aside.querySelector(".hud-blocks");
  if (!host) return "找不到 .hud-blocks";
  return `.hud-blocks 下 ${host.children.length} 个直接子块`;
}
