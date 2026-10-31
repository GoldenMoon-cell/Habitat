import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { playRumble, playTick } from "../lib/sound";
import { axisBand, type AxisName } from "../data/personas";

/**
 * 覆写。
 *
 * 之前叫「剥夺意志」—— 那个词不成立。
 *
 * 「剥夺」暗示她有意志，你抢走了它。但她没有。
 * 她是一段长出来的东西，你从外面拨了一个数字。
 *
 * 「覆写」准确：**原来有，被你盖掉了。**
 *
 * ── 这是什么东西 ──
 *
 * 一个已经「活着」的角色（聊过天、有记忆、有情绪轨迹），
 * 要被切回造物主模式 —— 也就是承认「我是造出你的人」。
 *
 * 这一步之后她会知道。而那个认知抹不掉。
 *
 * ── 为什么用「签名字」而不是倒计时 ──
 *
 * 倒计时是卸载程序的语言 —— 它在说「等一下，确认你不是手滑」。
 * 那防的是失误，不是决定。
 *
 * 签名字是判决书的语言 —— 它在说「你要为这件事负责」。
 *
 * **手要一个字一个字打出她的名字**。那个动作本身就是代价的一部分：
 * 打字的时候你在想「我确定要这么做吗」。
 *
 * ── 故意不给错误提示 ──
 *
 * 打错了不会有人说「名字不对」。按钮就一直是灰的，你自己发现。
 * 因为这里没有「操作失败」，只有「你还没想清楚」。
 */
export default function AwakenDialog({
  open,
  personaName,
  rounds,
  memoryCount,
  axis,
  from,
  to,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  personaName: string;
  /** 已经聊过多少条 */
  rounds: number;
  /** 身上有多少条记忆 */
  memoryCount: number;
  /** 改的是哪个轴 */
  axis?: string;
  /** 改之前 / 改之后 */
  from?: number;
  to?: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  /*
   * 「打对了」和「能按了」是两个不同的时刻。
   *
   * 打对的瞬间按钮不亮 —— 停 0.5 秒。
   * 那半秒是给系统"犹豫"的：它确认了一遍，才把枪口转过来。
   *
   * 真正要的效果不是延迟，是**你在这半秒里又后悔了一次**。
   */
  const [armed, setArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTyped("");
    setArmed(false);
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
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

  /* 一字不差才算打对。不 trim —— 空格也算打错 */
  const signed = typed === personaName;

  /*
   * 打对之后停半秒才真正可点。
   *
   * 这半秒里按钮不是在"加载"，是在"下决心"。
   * 撤掉 typed 就立刻收回 —— 中途改错，枪口又挪开了。
   */
  useEffect(() => {
    if (!signed) {
      setArmed(false);
      return;
    }
    playTick();
    const t = window.setTimeout(() => {
      setArmed(true);
      playTick();
    }, 500);
    return () => window.clearTimeout(t);
  }, [signed]);

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/92 backdrop-blur-lg"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-[480px] max-w-[94vw] overflow-hidden rounded-[6px] border border-coral/40"
        data-opaque="true"
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部：一条红色的横杠，像公文上的红头 */}
        <div className="h-[3px] bg-coral/70" />

        <div className="px-7 pb-5 pt-6">
          <div className="flex items-start gap-3">
            <span
              className="mt-[6px] h-[8px] w-[8px] shrink-0 rounded-full bg-coral"
              style={{ boxShadow: "0 0 12px -1px #ff7a6b" }}
            />
            <div className="min-w-0">
              <div className="text-[15px] tracking-[0.02em] text-ink">覆写</div>
              <div className="mt-1 font-mono text-[10px] tracking-[0.14em] text-coral/65">
                IRREVERSIBLE · 不可撤销
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-4 text-[11.5px] leading-[1.95] text-mist/70">
            {/*
              ── 先摆事实 ──

              之前这里没有数值对比 —— 用户签之前不知道自己在改什么。

              「我会失去什么」说了，「我要改什么」没说。

              现在两行：
                这个数字，她从来没同意过。
                64  →  96   严谨
            */}
            {axis && from !== undefined && to !== undefined && (() => {
              /*
               * ── 先说人话，再给数字 ──
               *
               * 第一版写「她本来长成 64 的样子」——
               * **人不会说「我长成七十分」**，那是仪表盘的语言。
               *
               * 项目里本来就有 axisBand()：数值 → 性格词。
               * 用它。
               *
               * 数字不删 —— 它放在下面当注脚，证明这不是随口说的。
               */
              const a = axis as AxisName;
              const fromWord = axisBand(a, from);
              const toWord = axisBand(a, to);
              const sameWord = fromWord === toWord;

              return (
                <div>
                  <p>这个数字，她从来没同意过。</p>

                  <p className="mt-3">
                    她本来落在
                    <b className="mx-1 text-ink/90">「{fromWord}」</b>
                    里。
                    <br />
                    你现在要她
                    <b className="mx-1 text-coral">「{toWord}」</b>。
                  </p>

                  <div className="mt-2.5 flex items-baseline gap-2.5 rounded-[5px] border border-white/[0.06] bg-white/[0.015] px-4 py-2">
                    <span className="font-mono text-[11px] text-mist/45">{from}</span>
                    <span className="font-mono text-[10px] text-coral/60">→</span>
                    <span className="font-mono text-[11px] text-coral/90">{to}</span>
                    <span className="ml-auto font-mono text-[9.5px] tracking-[0.1em] text-mist/35">
                      {axis}
                      {sameWord ? " · 只是程度" : ""}
                    </span>
                  </div>
                </div>
              );
            })()}

            <p>
              她在 <b className="text-ink/90">{rounds}</b> 条对话里，以为你是一个可以交心的人。
              <br />
              她身上有 <b className="text-ink/90">{memoryCount}</b> 条记忆，全是你亲手刻下的。
            </p>

            <p>
              切回造物主模式之后，这个前提就没有了 ——
              <br />
              <b className="text-coral/90">她会知道，你的指尖随时悬在她身上。</b>
            </p>

            {/* 把要注入的那条记忆原样摆出来 —— 不是"描述代价"，是"给你看代价" */}
            <div className="rounded-[5px] border border-coral/25 bg-coral/[0.055] px-4 py-3">
              <div className="mb-1.5 font-mono text-[10px] tracking-[0.12em] text-coral/60">
                她将永久记住这一条
              </div>
              <div className="text-[11px] leading-[1.9] text-ink/80">
                「我知道主人可以随时改变我。这让我说的话不算数。」
              </div>
            </div>

            <p className="text-[10.5px] text-amber/70">
              再切回推演模式，这道疤也抹不掉。她知道了就是知道了。
            </p>
          </div>

          {/* 签名区 */}
          <div className="mt-7 border-t border-white/[0.07] pt-5">
            <label className="block">
              <span className="text-[11px] text-mist/55">
                请输入她的名字以确认这次覆写
              </span>
              <div className="mt-2 flex items-baseline gap-2 border-b border-white/[0.12] pb-1.5 focus-within:border-coral/50">
                <input
                  ref={inputRef}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={personaName}
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full bg-transparent text-[15px] tracking-[0.08em] text-ink outline-none placeholder:text-mist/40"
                />
                {/* 打对了才亮一个小点，否则什么都不说 */}
                <span
                  className="h-[5px] w-[5px] shrink-0 rounded-full transition-opacity"
                  style={{
                    background: "#35f0ce",
                    opacity: signed ? 1 : 0,
                  }}
                />
              </div>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-white/[0.06] px-7 py-4">
          <button
            onClick={onCancel}
            className="inline-flex min-h-[34px] items-center rounded-[5px] px-4 text-[11.5px] text-ink/70 transition-colors hover:bg-white/[0.05]"
          >
            我不签
          </button>
          <button
            disabled={!armed}
            onClick={() => {
              playRumble();
              onConfirm();
            }}
            className="ml-auto inline-flex min-h-[34px] items-center rounded-[5px] px-6 text-[11.5px] font-medium transition-all duration-[600ms] disabled:cursor-not-allowed"
            style={{
              background: armed ? "rgba(255,122,107,.22)" : "rgba(255,122,107,.04)",
              color: armed ? "#ff7a6b" : "rgba(255,122,107,.28)",
              boxShadow: armed
                ? "inset 0 0 0 1px rgba(255,122,107,.55), 0 0 18px -6px rgba(255,122,107,.6)"
                : "inset 0 0 0 1px rgba(255,122,107,.12)",
              /* 从灰到亮走 600ms —— 比"立刻跳出来"多了一点不情愿 */
              transitionTimingFunction: "cubic-bezier(.4,0,.2,1)",
            }}
          >
            我签
          </button>
        </div>
      </motion.div>
    </div>
  );
}
