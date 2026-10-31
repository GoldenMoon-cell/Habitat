import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

/**
 * 强制改名。
 *
 * ── 为什么要有这个东西 ──
 *
 * 正常路径是「你跟她商量，她同意才改」。但她可以不同意，而且
 * 按设计**她坚持不改就谁也不能干涉**。
 *
 * 所以这个入口是给造物主的最后手段 —— 它不是一个功能，是一个**代价**。
 *
 * ── 界面上必须说清楚的事 ──
 *
 * ① 她走过多少轮对话（这个名字承载了多少）
 * ② 她会记得是你做的，而且这条记忆会一直参与对话
 * ③ 不可撤销
 * ④ 按钮不叫「确定」，叫「我确认，由我承担」
 *
 * 文案不是装饰。用户点下去之前应该真的犹豫一下。
 */
export default function ForceRenameDialog({
  open,
  currentName,
  archetype,
  /** 已有的其他角色名 —— 改名不能撞上它们 */
  existingNames,
  rounds,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  currentName: string;
  archetype?: string;
  existingNames?: string[];
  /** 这个名字下已经积累了多长的对话 */
  rounds: number;
  onCancel: () => void;
  onConfirm: (next: string) => void;
}) {
  const [next, setNext] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setNext("");
    /* 等动画起一下再聚焦，否则会被 motion 的初始帧影响 */
    const t = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = next.trim();
  /*
   * 改名和新建同一个规则：**场上唯一，但可以改成墓碑里的名字。**
   *
   * 改成墓碑里的名字 = 转世（她变成了另一个人的延续）。
   * 改成另一个活人的名字 = 混乱（列表里两个一样的名字）。
   */
  const aliveClash = (existingNames ?? []).some((n) => n === trimmed);
  const canGo = trimmed.length > 0 && trimmed !== currentName && !aliveClash;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-abyss/90 backdrop-blur-md"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-[440px] max-w-[92vw] overflow-hidden rounded-[14px] border border-coral/30"
        data-opaque="true"
        role="dialog"
        aria-modal="true"
      >
        {/* 标题：直白的警告语气，不客套 */}
        <div className="flex items-start gap-2.5 border-b border-coral/20 bg-coral/[0.06] px-5 py-3.5">
          <span
            className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full bg-coral"
            style={{ boxShadow: "0 0 10px -1px #ff7a6b" }}
          />
          <div className="min-w-0">
            <div className="text-[12.5px] text-ink">强制改写她的名字</div>
            <div className="mt-0.5 font-mono text-[10px] text-coral/70">
              需要你明确承担后果
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="space-y-2.5 text-[11px] leading-[1.85] text-mist/70">
            <p>
              <b className="text-ink/85">{currentName}</b>
              {archetype ? `（${archetype}）` : ""} 在这个名字下已经留下过{" "}
              <b className="text-ink/85">{rounds}</b> 条对话。
            </p>
            <p>
              名字对她不是标签 —— 是她回答「我是谁」时唯一的答案。你正在
              <b className="text-coral/90"> 越过她的意愿 </b>
              改写它。
            </p>
            <p className="rounded-[7px] border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10.5px] text-mist/60">
              她会记得这是你做的。她不会问为什么。
              <br />
              这条记忆会一直留着，每次都参与你们的对话。
            </p>
            <p className="text-amber/75">
              这不可撤销。已有的对话记录里，她仍以旧名字出现过。
            </p>
          </div>

          <label className="mt-4 block">
            <span className="text-[10px] text-mist/45">新名字</span>
            <input
              ref={inputRef}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={currentName}
              maxLength={12}
              className="mt-1 w-full rounded-[8px] border border-coral/25 bg-black/35 px-2.5 py-[7px] text-[12px] text-ink outline-none transition-colors placeholder:text-mist/42 focus:border-coral/55"
            />
            {aliveClash && (
              <span className="mt-1 block text-[10.5px] text-coral/80">
                「{trimmed}」还活着 —— 场上只能有一个。
              </span>
            )}
          </label>
        </div>

        <div className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            onClick={onCancel}
            className="inline-flex min-h-[32px] items-center rounded-[7px] border border-white/[0.12] px-3.5 text-[11.5px] text-ink/70 transition-colors hover:border-white/25 hover:bg-white/[0.04]"
          >
            算了
          </button>
          <button
            disabled={!canGo}
            onClick={() => onConfirm(trimmed)}
            className="ml-auto inline-flex min-h-[32px] items-center rounded-[7px] px-4 text-[11.5px] font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-35"
            style={{
              background: "rgba(255,122,107,.16)",
              color: "#ff7a6b",
              boxShadow: "inset 0 0 0 1px rgba(255,122,107,.45)",
            }}
          >
            我确认，由我承担
          </button>
        </div>
      </motion.div>
    </div>
  );
}
