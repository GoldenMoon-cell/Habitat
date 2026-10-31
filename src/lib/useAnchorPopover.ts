import { useEffect, useState } from "react";

/**
 * 锚定浮层的位置计算。
 *
 * ── 方向规则 ──
 *
 * **先试向右，放不下再翻向左。** 不是固定某一个方向。
 *
 * 之前我把它写死成「右缘对齐、向左展开」—— 因为第一个用它的按钮
 * （会话设置）贴着右边界。但群设置的按钮在聊天区偏左，向左长就跨到
 * 会话列表去了。
 *
 * ── 边界 ──
 *
 * 判断「放不放得下」用的是**所属功能区的边界**，不是视口。
 *
 * 视口判断会得出「722 + 420 = 1142，视口 1900，放得下」——
 * 但聊天区只到 1194 的左边一点，1142 早就越界了。
 *
 * 功能区通过 `boundary` 传入（ChatStage 的根元素 rect）。
 */
export function useAnchorPopover(
  open: boolean,
  anchor: DOMRect | null | undefined,
  width: number,
  height: number,
  boundary?: { left: number; right: number; top: number; bottom: number } | null
) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;

    const M = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!anchor) {
      setPos({
        top: Math.max(M, (vh - height) / 2),
        left: Math.max(M, (vw - width) / 2),
      });
      return;
    }

    /* 横向可用范围：优先用所属功能区，没有就用视口 */
    const minLeft = boundary ? boundary.left + 6 : M;
    const maxRight = boundary ? boundary.right - 6 : vw - M;

    /* 先试向右（左缘对齐），放不下再翻向左（右缘对齐） */
    let left = anchor.left;
    if (left + width > maxRight) {
      left = anchor.right - width;
    }
    /* 最后夹进功能区 —— 宽度本身就超了的话，贴左边界 */
    left = Math.max(minLeft, Math.min(left, maxRight - width));

    /* 纵向：优先下方，放不下翻上方 */
    let top = anchor.bottom + 8;
    if (top + height > vh - M) {
      top = Math.max(M, anchor.top - height - 8);
    }

    setPos({ top, left });
  }, [open, anchor, width, height, boundary]);

  return pos;
}
/**
 * 聊天区的可展开边界。
 *
 * 两个锚定弹窗（会话设置 / 群设置）都属于聊天区，面板不该越到
 * 会话列表或 VITALS 上 —— 所以横向上限取聊天区的实际矩形。
 *
 * 找不到就返回 null，hook 会退回用视口边界。
 */
export function chatBoundary() {
  /* App.tsx 给聊天区的 aside 打了 data-boot-block="stage" */
  const el = document.querySelector<HTMLElement>('[data-boot-block="stage"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}
