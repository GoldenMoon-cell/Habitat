import { useEffect, useRef } from "react";

/**
 * Esc 键栈。
 *
 * 问题：每个弹窗自己往 window 上挂 keydown，按一下 Esc 会把所有层一起关掉；
 * 而控制台的 Esc 挂在输入框上，焦点一离开就失效。
 *
 * 解法：所有层注册到一个栈里，全局只有一个监听器，
 * 按 Esc 只关**最上层**那个（后注册的在上）。
 *
 * 用法：
 *   useEscClose(open, onClose)    // 弹窗
 *   useEscClose(true, () => {})   // 常驻层
 */

type Entry = { id: number; close: () => void };

const stack: Entry[] = [];
let seq = 0;
let installed = false;

/** 注册一个层；返回注销函数 */
export function pushEsc(close: () => void): () => void {
  const id = ++seq;
  stack.push({ id, close });
  install();

  return () => {
    const i = stack.findIndex((e) => e.id === id);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 关掉最上层；返回是否处理了 */
export function handleEsc(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** 当前有几层在等 Esc（调试用） */
export function escDepth(): number {
  return stack.length;
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    /* keydown 已经被更内层处理掉（比如输入框清空）就不再冒泡处理 */
    if (e.defaultPrevented) return;
    if (handleEsc()) e.preventDefault();
  });
}

/** 弹窗/hook 用法：active 为真时注册，卸载或失活时注销 */
export function useEscClose(active: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;

  useEffect(() => {
    if (!active) return;
    return pushEsc(() => ref.current());
  }, [active]);
}
