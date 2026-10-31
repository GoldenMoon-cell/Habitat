import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

/**
 * 自定义确认框。
 *
 * 之前用 `window.confirm()`，那是操作系统的原生对话框 —— 微软的窗口样式、
 * 微软的按钮、跟深海 UI 完全两个世界。Electron 里也一样丑。
 *
 * 这里给和 Onboarding / Wizard 同一套语言的确认面板。
 *
 * ── 人体工学修正（这一版）──
 *
 * ① **危险操作不再默认聚焦「确定」**
 *    原来无论 danger 与否都 autoFocus 在确认键上 —— 手在键盘上按个回车
 *    就把角色删了。现在：普通操作聚焦确认（一路回车很顺），
 *    危险操作聚焦**取消**（一路回车什么都不会发生）。
 *
 * ② **「取消」不再是半透明灰字**
 *    原来看起来像一句说明文字，不像按钮。现在有边框、有对比度、
 *    和确认键同高 —— 想反悔的人在哪儿点都很确定。
 *
 * ③ **可点区域从 26px 提到 32px**
 *    原来 py-[5px] 只有约 26px 高，低于 Windows / Material 的 32px 下限，
 *    鼠标快速移动时容易点空。
 *
 * ④ **Esc 关闭**
 *    原来只能点遮罩或按钮。现在 Esc 直接取消 —— 这是对话框的默认期待。
 */
export default function ConfirmDialog({
  title,
  desc,
  confirmText = "确定",
  danger = false,
  requireWord,
  onOk,
  onCancel,
}: {
  title: string;
  desc?: string;
  confirmText?: string;
  danger?: boolean;
  /**
   * 要求用户**手打**这个词才能确认。
   *
   * 给「比普通危险操作还重一档」的事用 —— 比如删档。
   * 同一个确认框会让人以为它和「全部重置」是一个量级。
   */
  requireWord?: string;
  onOk: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const needWord = typeof requireWord === "string" && requireWord.length > 0;
  const wordOk = !needWord || typed.trim() === requireWord;

  const accent = danger ? "#ff7a6b" : "#35f0ce";
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  /* Esc 取消 —— 对话框的默认期待 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  /* 危险操作：焦点落在「取消」上（回车 = 什么都不做） */
  useEffect(() => {
    if (danger) cancelRef.current?.focus();
  }, [danger]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-abyss/88 backdrop-blur-md"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-[420px] max-w-[92vw] overflow-hidden rounded-[14px]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="px-5 pb-4 pt-4">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ background: accent, boxShadow: `0 0 10px -1px ${accent}` }}
            />
            <div className="min-w-0">
              <div className="text-[12.5px] leading-[1.5] text-ink">{title}</div>
              {desc && (
                <p className="mt-1.5 whitespace-pre-line text-[10.5px] leading-[1.75] text-mist/50">
                  {desc}
                </p>
              )}
            </div>
          </div>

          {/*
            需要手打确认词时，输入框放在正文下面。
            确认按钮在打对之前是灰的 —— 让「不能点」本身成为提示。
          */}
          {needWord && (
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[9.5px] tracking-[0.08em] text-mist/40">
                输入「{requireWord}」确认
              </div>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && wordOk) onOk();
                }}
                placeholder={requireWord}
                className="w-full rounded-[6px] border border-white/[0.1] bg-black/25 px-2.5 py-1.5 font-mono text-[11.5px] text-ink outline-none placeholder:text-mist/20 focus:border-coral/40"
              />
            </div>
          )}
        </div>

        {/* 按钮区：取消有实体边框，两者同高 32px */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="inline-flex min-h-[32px] items-center rounded-[7px] border border-white/[0.12] px-3.5 text-[11.5px] text-ink/70 transition-colors hover:border-white/25 hover:bg-white/[0.04] hover:text-ink/95"
          >
            取消
          </button>
          <button
            autoFocus={!danger && !needWord}
            disabled={!wordOk}
            onClick={onOk}
            className="ml-auto inline-flex min-h-[32px] items-center rounded-[7px] px-4 text-[11.5px] font-medium transition-all duration-150 hover:brightness-125"
            style={{
              background: danger ? `${accent}26` : `${accent}1f`,
              color: accent,
              boxShadow: `inset 0 0 0 1px ${accent}55`,
              opacity: wordOk ? 1 : 0.35,
              cursor: wordOk ? "pointer" : "not-allowed",
            }}
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
