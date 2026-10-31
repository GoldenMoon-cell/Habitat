import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useEscClose } from "../lib/escStack";
import { useAnchorPopover, chatBoundary } from "../lib/useAnchorPopover";
import { fmtWindow, learnFromError, loadOverrides, resolveContextWindow, saveOverride } from "../lib/contextWindow";

/**
 * 会话设置。
 *
 * 只放**真的会生效**的东西：上下文上限直接写回角色档案的 ctxMax，
 * 头部那个 `34.1/128k` 立刻跟着变。
 *
 * 之前这个按钮弹的是「上下文上限 / 语气 / TTS 声线 · 第二阶段」——
 * 列了三项，一项都没做。这次不列没做的。
 */

const PRESETS = [32, 64, 128, 256, 512];

export default function SessionSettings({
  open,
  onClose,
  subject,
  modelName,
  ctxUsed,
  ctxMax,
  anchor,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  /** 触发按钮的位置 —— 面板就长在它旁边，而不是屏幕正中 */
  anchor?: DOMRect | null;
  /** 显示在标题下面：角色名或群名 */
  subject: string;
  /** 用来解析物理上限；群会话传 "group" */
  modelName: string;
  ctxUsed: number;
  ctxMax: number;
  onSave: (ctxMax: number) => void;
}) {
  const [value, setValue] = useState(ctxMax);
  const [custom, setCustom] = useState(""); // 未知模型时手填的 token 数
  const [errText, setErrText] = useState(""); // 粘贴的 API 报错
  useEscClose(open, onClose);

  /* 三级匹配出的物理上限 */
  const overrides = loadOverrides();
  const physical = resolveContextWindow(modelName, overrides[modelName.trim().toLowerCase()]);
  const maxK = Math.floor(physical.window / 1000);

  /* 每次打开都对齐到当前真实值 */
  useEffect(() => {
    if (open) setValue(ctxMax);
  }, [open, ctxMax]);

  const pct = Math.min(100, (ctxUsed / Math.max(1, value)) * 100);
  const changed = value !== ctxMax;

  /*
   * 锚定定位。
   *
   * 原来这个面板是 fixed inset-0 + 居中 —— 点一下「会话设置」，整块屏幕被
   * 半透明遮罩盖住，看起来像进了另一个页面。但用户只是想改一个数，
   * 改完还要记得「我刚才从哪儿点的」。
   *
   * 现在：贴着触发按钮长出来。默认在下方，超出视口就翻到上方/内侧。
   * 遮罩只剩一层**完全透明**的点击层 —— 用来接「点别处关闭」，
   * 视觉上什么都没盖住。
   */
  const PANEL_W = 400;
  const PANEL_H = 430;
  /* 边界用聊天区的 rect —— 面板不越出聊天区，别盖到会话列表或 VITALS */
  const pos = useAnchorPopover(open, anchor, PANEL_W, PANEL_H, chatBoundary());

  return (
    <div className="fixed inset-0 z-[100]" onClick={onClose}>
      <motion.div
        /*
         * 全息投影，不是「滑出来」。
         * 和群设置用同一套参数 —— 两个气泡必须看起来是同一个东西。
         */
        initial={{ opacity: 0, scale: 0.96, clipPath: "inset(0 0 100% 0)" }}
        animate={{ opacity: 1, scale: 1, clipPath: "inset(0 0 0% 0)" }}
        exit={{
          opacity: 0,
          scale: 0.97,
          clipPath: "inset(0 0 100% 0)",
          transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
        }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{ position: "fixed", top: pos.top, left: pos.left, width: PANEL_W, transformOrigin: "top right" }}
        className="glass max-h-[86vh] max-w-[92vw] overflow-y-auto rounded-[13px] border border-biolum/25 shadow-[0_20px_56px_-14px_rgba(0,0,0,.9)]"
        /*
         * .glass 的渐变顶部只有 46% 不透明（为了四栏那种「透出海底」的观感）。
         * 但对一个浮在内容上的面板来说太透了 —— 底下的记忆流文字会透出来。
         * 这里单独覆盖成接近实底。
         */
        data-opaque="true"
      >
        {/* 标题 */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="text-[12px] text-biolum/70">⇄</span>
          <div className="min-w-0">
            <div className="text-[12px] text-ink">会话设置</div>
            <div className="mt-[1px] truncate text-[10px] text-mist/52">{subject}</div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto grid h-6 w-6 place-items-center rounded-[5px] text-mist/55 transition-colors hover:bg-white/[0.07] hover:text-ink/75"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label">上下文上限</span>
            <span className="tabular font-mono text-[11px] text-biolum/85">{value}k</span>
          </div>

          {/* 滑块 */}
          <input
            type="range"
            min={4}
            max={maxK}
            step={4}
            value={Math.min(value, maxK)}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-full accent-biolum"
            aria-label="上下文预算"
          />

          {/* 物理上限从哪来的 —— 猜的要标出来 */}
          <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[9.5px]">
            <span className="text-mist/46">物理上限</span>
            <span className={physical.estimated ? "text-amber/70" : "text-biolum/75"}>
              {fmtWindow(physical.window)}
            </span>
            <span className="text-mist/46">· {physical.basis}</span>
            {physical.estimated && (
              <span className="rounded-[3px] border border-amber/25 px-1 text-[9px] text-amber/65">
                估计
              </span>
            )}
          </div>

          {/* 预设 */}
          <div className="mt-2 flex gap-1.5">
            {PRESETS.filter((p) => p <= maxK).map((p) => (
              <button
                key={p}
                onClick={() => setValue(p)}
                className={`flex-1 rounded-[5px] border py-[3px] font-mono text-[10px] transition-colors ${
                  value === p
                    ? "border-biolum/40 bg-biolum/[0.1] text-biolum/90"
                    : "border-white/[0.07] text-mist/58 hover:border-white/[0.14] hover:text-mist/65"
                }`}
              >
                {p}k
              </button>
            ))}
          </div>

          {/* 第三级兜底：认不出 / 认错时，允许手动填物理上限 */}
          {(physical.source === "unknown" || physical.source === "prefix") && (
            <div className="mt-2.5 rounded-[6px] border border-white/[0.06] px-2.5 py-2">
              <div className="text-[10px] leading-[1.6] text-mist/58">
                不知道这个模型的真实窗口？
              </div>
              <div className="mt-1 flex gap-1.5">
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="填 token 数，例如 128000"
                  inputMode="numeric"
                  className="min-w-0 flex-1 rounded-[4px] border border-white/[0.08] bg-black/30 px-2 py-[3px] font-mono text-[10px] text-ink/80 placeholder:text-mist/42 focus:border-biolum/35 focus:outline-none"
                />
                <button
                  disabled={!custom || Number(custom) < 1000}
                  onClick={() => {
                    const n = Number(custom);
                    if (!n || n < 1000) return;
                    saveOverride(modelName, n);
                    setCustom("");
                    /* 改完刷新一次，让 maxK 重新算 */
                    window.location.reload();
                  }}
                  className="shrink-0 rounded-[4px] border border-biolum/30 bg-biolum/[0.08] px-2 py-[3px] font-mono text-[10px] text-biolum/85 transition-colors hover:bg-biolum/[0.14] disabled:opacity-35"
                >
                  记住
                </button>
              </div>

              {/* 第四层：把 API 报错粘进来，让它自己认 */}
              <details className="mt-1.5">
                <summary className="cursor-pointer font-mono text-[9.5px] text-mist/46 hover:text-mist/45">
                  或者粘贴 API 报错，自动校准
                </summary>
                <textarea
                  value={errText}
                  onChange={(e) => setErrText(e.target.value)}
                  placeholder={"This model's maximum context length is 128000 tokens."}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-[4px] border border-white/[0.08] bg-black/30 px-2 py-[4px] font-mono text-[10px] leading-[1.5] text-ink/70 placeholder:text-mist/40 focus:border-biolum/35 focus:outline-none"
                />
                <button
                  disabled={!errText.trim()}
                  onClick={() => {
                    const n = learnFromError(modelName, errText);
                    if (n) {
                      setErrText("");
                      window.location.reload();
                    } else {
                      setErrText("");
                      window.alert("没从这段文字里认出上限数字");
                    }
                  }}
                  className="mt-1 w-full rounded-[4px] border border-white/[0.09] py-[3px] font-mono text-[9.5px] text-mist/50 transition-colors hover:border-biolum/30 hover:text-biolum/80 disabled:opacity-30"
                >
                  解析并记住
                </button>
              </details>
            </div>
          )}

          {/* 当前占用：改了上限立刻能看出比例变化 */}
          <div className="mt-3 rounded-[6px] border border-white/[0.05] px-2.5 py-2">
            <div className="flex items-baseline justify-between font-mono text-[10px]">
              <span className="text-mist/58">当前占用</span>
              <span className="tabular text-ink/70">
                {ctxUsed.toFixed(1)} / {value}k
              </span>
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background: pct > 85 ? "#ff7a6b" : "#35f0ce",
                }}
              />
            </div>
            {pct > 85 && (
              <div className="mt-1.5 text-[9.5px] leading-[1.5] text-coral/70">
                接近上限时会先压缩旧消息，压缩失败才截断
              </div>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <span className="font-mono text-[9.5px] text-mist/46">
            {changed ? "有未保存的修改" : "无改动"}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-[6px] px-2.5 py-[4px] text-[10.5px] text-mist/45 transition-colors hover:text-ink/70"
          >
            取消
          </button>
          <button
            disabled={!changed}
            onClick={() => {
              onSave(value);
              onClose();
            }}
            className="rounded-[6px] px-3 py-[4px] text-[10.5px] transition-colors disabled:opacity-40"
            style={{
              background: changed ? "rgba(53,240,206,0.16)" : "rgba(255,255,255,0.05)",
              color: changed ? "#35f0ce" : "rgba(143,169,189,0.5)",
              boxShadow: changed ? "inset 0 0 0 1px rgba(53,240,206,0.3)" : "none",
            }}
          >
            保存
          </button>
        </div>
      </motion.div>
    </div>
  );
}