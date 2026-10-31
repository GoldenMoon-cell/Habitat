/**
 * 运行时故障注入。
 *
 * 控制台敲 `sys glitch radar` → 右侧雷达当场崩掉。
 * 这是 BlockBoundary 崩溃路径的**同一条路**，只是触发源不同：
 *
 *   真实渲染异常  → getDerivedStateFromError → CrashBlock
 *   sys glitch    → 全局 glitch 标记     → CrashBlock
 *
 * 不是「假装崩」，渲染的是同一套组件。
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let glitchKind: string | null = null;

/** 可用的目标，和 CrashKind 一一对应 */
export const GLITCH_TARGETS = [
  "ident",
  "sparkline",
  "api",
  "freeze",
  "tomb",
  "lost",
  "void",
  "tear",
  "inputlock",
  "sealed",
  "radar",
  "strike",
] as const;

export function getGlitch(): string | null {
  return glitchKind;
}

export function setGlitch(kind: string | null): boolean {
  if (kind !== null && !GLITCH_TARGETS.includes(kind as (typeof GLITCH_TARGETS)[number])) {
    return false;
  }
  glitchKind = kind === glitchKind ? null : kind; // 同一个再敲一次 = 关掉
  listeners.forEach((fn) => fn());
  return true;
}

export function clearGlitch() {
  glitchKind = null;
  listeners.forEach((fn) => fn());
}

export function subscribeGlitch(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
