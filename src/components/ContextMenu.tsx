import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

/**
 * 右键菜单。
 *
 * 整个软件之前**一个右键菜单都没有** —— 所有次要操作都塞在悬停出现的小图标里，
 * 或者干脆没有入口。右键是最自然放「次要但常用」操作的地方：
 * 导出这个角色、复制这个名字、打开它的数据目录。
 *
 * ── 定位 ──
 *
 * 在鼠标点击处弹出，但**靠近视口右边/下边时翻到另一侧** ——
 * 否则菜单会被屏幕边缘截掉一半。
 *
 * ── 关闭 ──
 *
 * 点菜单外任何地方、Esc、滚动、窗口失焦 —— 都关。
 * 这是右键菜单的默认期待，不需要额外解释。
 */

export interface MenuItem {
  /** 分隔线：只写 { sep: true } */
  sep?: boolean;
  label?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [ready, setReady] = useState(false);

  /* 量出实际尺寸后再决定翻不翻边 —— 先渲染在点击点，下一步再挪 */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const M = 8;
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - M) left = Math.max(M, x - r.width);
    if (top + r.height > window.innerHeight - M) top = Math.max(M, y - r.height);
    setPos({ left, top });
    setReady(true);
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => onClose();
    const onBlur = () => onClose();

    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  /*
   * ── 必须挂到 body ──
   *
   * 这个菜单是 `position: fixed` —— 但 fixed **不是永远对着视口**。
   *
   * CSS 规范：祖先只要带 `filter` / `transform` / `perspective` / `contain`，
   * 就成了 fixed 后代的「包含块」，fixed 变成相对那个祖先定位。
   *
   * 消息行的根节点正好带着 `filter: blur(0px)`（入场动画留下的），
   * 于是菜单变成相对**那一行**定位 —— 而那一行在 `overflow-y-auto` 的
   * 滚动容器里，菜单直接被裁到看不见。
   *
   * 之前测试时 DOM 里能查到菜单项，但截图里什么都看不到 ——
   * 就是这个原因：**它存在，只是被裁掉了。**
   *
   * portal 到 body 之后，fixed 恢复成对着视口，任何父级样式都影响不到它。
   */
  const menu = (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: ready ? 1 : 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        transformOrigin: "top left",
        zIndex: 200,
      }}
      className="glass min-w-[168px] overflow-hidden rounded-[9px] border border-biolum/20 p-1 shadow-[0_18px_48px_-12px_rgba(0,0,0,.92)]"
      data-opaque="true"
      role="menu"
    >
      {items.map((it, i) => {
        if (it.sep) {
          return <div key={`sep-${i}`} className="my-1 h-px bg-white/[0.07]" />;
        }
        return (
          <button
            key={`${it.label}-${i}`}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              it.onSelect?.();
              onClose();
            }}
            className={`flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[6px] text-left text-[11.5px] transition-colors ${
              it.disabled
                ? "cursor-not-allowed text-mist/46"
                : it.danger
                  ? "text-coral/80 hover:bg-coral/12 hover:text-coral"
                  : "text-ink/75 hover:bg-white/[0.07] hover:text-ink"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && (
              <span className="shrink-0 font-mono text-[10px] text-mist/50">{it.hint}</span>
            )}
          </button>
        );
      })}
    </motion.div>
  );

  /* 服务端渲染时没有 document —— 但那不该发生（这是个 Electron 单页应用） */
  if (typeof document === "undefined") return null;
  return createPortal(menu, document.body);
}
