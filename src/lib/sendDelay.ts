/**
 * 发送模式。
 *
 * 默认「等 6 秒」—— 这 6 秒里消息是待定的（半透明 + 环形倒计时），
 * 可以撤回，她收不到任何东西。这是这个软件的一个设计，不是延迟 bug。
 *
 * 但有人就想要「按了就发」。
 * 所以给它一个开关，而不是替用户决定。
 *
 * 两种模式下都保留的逃生门：
 *   等 6 秒模式下，按一次空 Enter 立即发出（「再按一次回车」的语义）。
 */

export type SendMode = "delayed" | "instant";

/** 待发窗口的长度。改这里就改了全局。 */
export const SEND_DELAY_MS = 6000;

const KEY = "3w:send-mode";

export function readSendMode(): SendMode {
  try {
    const v = localStorage.getItem(KEY);
    // 只有明确写了 instant 才是即时 —— 其余（含没写过、写坏了）都回到默认的延迟
    return v === "instant" ? "instant" : "delayed";
  } catch {
    return "delayed";
  }
}

export function saveSendMode(m: SendMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* 隐私模式下写不进去，忽略 —— 本次会话仍然生效 */
  }
}

/** 给 UI 用的一句人话 */
export function sendModeLabel(m: SendMode): string {
  return m === "instant" ? "按了就发" : `等 ${SEND_DELAY_MS / 1000} 秒`;
}
