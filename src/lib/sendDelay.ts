/**
 * 发送模式。
 *
 * 默认「按了就发」—— 和手机短信一样。按下去她就收到了。
 *
 * 「等 6 秒」是一个功能，不是默认行为：这 6 秒里消息是待定的
 * （半透明 + 环形倒计时），可以撤回，她收不到任何东西。
 * 想用的人自己在设置里打开。
 *
 * 打开后多一条逃生门：
 *   待发期间按一次空 Enter → 立刻发出，不用等满 6 秒。
 */

export type SendMode = "delayed" | "instant";

/** 待发窗口的长度。改这里就改了全局。 */
export const SEND_DELAY_MS = 6000;

const KEY = "3w:send-mode";

export function readSendMode(): SendMode {
  try {
    const v = localStorage.getItem(KEY);
    // 只有明确写了 delayed 才等 6 秒 —— 其余（含没写过、写坏了）都是即时
    return v === "delayed" ? "delayed" : "instant";
  } catch {
    return "instant";
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
