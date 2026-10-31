/**
 * 极轻的全局通知总线。
 *
 * 占位型按钮（新建会话 / 设置 / 搜索…）不必层层透传 props，
 * 直接广播一个事件，App 顶部统一转成 Toast —— 保证"点哪儿都有回应"。
 */

export interface NotifyPayload {
  title: string;
  desc?: string;
  accent?: string;
  icon?: string;
}

export const notify = (p: NotifyPayload) => {
  window.dispatchEvent(new CustomEvent<NotifyPayload>("3w:notify", { detail: p }));
};

export const NOTIFY_EVENT = "3w:notify";
