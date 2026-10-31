import { useEffect, useRef, useState } from "react";
import { playHold, playRelease } from "../lib/sound";
import { AnimatePresence, motion } from "motion/react";
import { IconClip, IconMic, IconSend, IconSmile, IconX } from "./Icons";

/**
 * 输入区。语音为自绘交互（不调用浏览器原生控件）：
 * 按住录音 → 显示波形与计时 → 松开发送一条语音消息。
 */
export default function Composer({
  accent,
  targetLabel,
  isGroup,
  onSend,
  onVoice,
  onAttach,
  quoting,
  onCancelQuote,
  members,
  seedText,
  seedNonce,
}: {
  accent: string;
  targetLabel: string;
  isGroup: boolean;
  onSend: (text: string) => void;
  onVoice: (seconds: number) => void;
  onAttach: () => void;
  /** 正在引用的消息（发送时写进 replyTo） */
  quoting?: { name: string; text: string } | null;
  onCancelQuote?: () => void;
  /** 群聊成员，用于 @ 提及 */
  members?: { name: string; color: string }[];
  /**
   * 从外面塞进来的文本 —— 用于「把待发的消息拿回来改」。
   *
   * `seedNonce` 每变一次就读一次 `seedText`。
   *
   * 为什么用 nonce 而不是直接传 text：如果只传 text，用户把它删空之后
   * 又拿回同一条消息，text 没变 → 不会重新写入。nonce 保证每次都是一次新动作。
   */
  seedText?: string;
  seedNonce?: number;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /** @ 提及：query 是 @ 后面已输入的字，start 是 @ 的位置 */
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /* 外面把一条待发的消息塞回来 —— 填进输入框并聚焦 */
  useEffect(() => {
    if (!seedNonce) return;
    setText(seedText ?? "");
    /* 等一帧，让受控值先落到 DOM 上再聚焦、再把光标放到末尾 */
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [seedNonce]);
  const startedAt = useRef(0);
  const timer = useRef<number>(0);

  const mentionHits = mention
    ? (members ?? []).filter((m) => !mention.query || m.name.includes(mention.query))
    : [];

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);

    if (!members || members.length === 0) return;

    /* 只在「光标前是 @xxx（无空格）」时弹列表 */
    const caret = e.target.selectionStart ?? v.length;
    const m = /@([^\s@]*)$/.exec(v.slice(0, caret));
    if (m) setMention({ query: m[1], start: caret - m[0].length });
    else setMention(null);
  };

  const insertMention = (name: string) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const next = `${before}@${name} ${after}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      const pos = before.length + name.length + 2;
      ta.setSelectionRange(pos, pos);
    });
  };

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(112, ta.scrollHeight)}px`;
  }, [text]);

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText("");
    setMention(null);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const startRec = () => {
    startedAt.current = performance.now();
    setElapsed(0);
    setRecording(true);
    timer.current = window.setInterval(
      () => setElapsed((performance.now() - startedAt.current) / 1000),
      90
    );
  };

  const endRec = () => {
    if (!recording) return;
    window.clearInterval(timer.current);
    const secs = (performance.now() - startedAt.current) / 1000;
    setRecording(false);
    setElapsed(0);
    if (secs >= 0.8) onVoice(Math.min(59, Math.max(1, Math.round(secs))));
  };

  return (
    <div className="relative shrink-0 px-4 pb-4 pt-1">
      {/* ── 录音浮层 ── */}
      <AnimatePresence>
        {recording && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-none absolute inset-x-4 bottom-[calc(100%-4px)] z-20"
          >
            <div className="glass flex items-center gap-3 rounded-xl px-3.5 py-2.5">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-coral" />
                <span className="relative h-2 w-2 rounded-full bg-coral" />
              </span>
              <div className="wave-playing flex h-5 flex-1 items-center gap-[2px]">
                {Array.from({ length: 34 }).map((_, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full"
                    style={{
                      height: `${5 + ((i * 37) % 15)}px`,
                      background: accent,
                      opacity: 0.75,
                      animationDelay: `${(i % 9) * 0.06}s`,
                      animationDuration: `${0.55 + (i % 5) * 0.09}s`,
                    }}
                  />
                ))}
              </div>
              <span className="tabular shrink-0 text-[11px] text-coral/90">
                {elapsed.toFixed(1)}s
              </span>
              <span className="shrink-0 text-[10px] text-mist/50">松开发送</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="relative rounded-[14px] border transition-colors duration-300"
        style={{
          borderColor: recording ? `${accent}55` : "rgba(255,255,255,0.075)",
          background:
            "linear-gradient(170deg, rgba(16,34,46,0.6) 0%, rgba(5,13,21,0.72) 100%)",
          boxShadow: recording
            ? `inset 0 1px 0 rgba(200,245,255,0.07), 0 0 0 3px ${accent}10`
            : "inset 0 1px 0 rgba(200,245,255,0.05)",
        }}
      >
        {/* 收件人提示 */}
        <div className="flex items-center gap-1.5 px-3 pt-2">
          <span className="h-[3px] w-[3px] rounded-full" style={{ background: accent }} />
          <span className="text-[10.5px] text-mist/45">
            发给 <span style={{ color: accent }}>{targetLabel}</span>
            {isGroup && ` · 广播给 ${members?.length ?? 0} 位成员 · 上下文隔离`}
          </span>
        </div>

        {/* 引用预览 */}
        <AnimatePresence initial={false}>
          {quoting && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div
                className="mx-3 mt-1.5 flex items-start gap-1.5 rounded-[6px] border-l-[2px] bg-white/[0.035] py-1 pl-2 pr-1.5"
                style={{ borderColor: `${accent}99` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] leading-none text-mist/45">
                    回复 {quoting.name}
                  </div>
                  <div className="mt-[3px] truncate text-[10.5px] leading-[1.4] text-ink/65">
                    {quoting.text || "（语音消息）"}
                  </div>
                </div>
                <button
                  onClick={onCancelQuote}
                  aria-label="取消引用"
                  className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[3px] text-mist/55 transition-colors hover:bg-white/[0.08] hover:text-ink/70"
                >
                  <IconX size={9} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* @ 提及候选 */}
        <AnimatePresence>
          {mentionHits.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14 }}
              className="absolute bottom-[calc(100%+6px)] left-3 z-30 min-w-[132px] overflow-hidden rounded-[8px] border border-white/[0.1] bg-[rgba(5,14,22,0.96)] p-[2px] shadow-[0_12px_28px_-12px_rgba(0,0,0,0.9)] backdrop-blur"
            >
              {mentionHits.map((m) => (
                <button
                  key={m.name}
                  onClick={() => insertMention(m.name)}
                  className="flex w-full items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] text-left text-[10.5px] text-ink/75 transition-colors hover:bg-white/[0.07] hover:text-ink"
                >
                  <span
                    className="h-[5px] w-[5px] shrink-0 rounded-full"
                    style={{ background: m.color, boxShadow: `0 0 5px ${m.color}` }}
                  />
                  {m.name}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <textarea
          ref={taRef}
          value={text}
          onChange={handleInput}
          onKeyDown={(e) => {
            if (e.key === "Escape" && mention) {
              e.preventDefault();
              setMention(null);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={`对 ${targetLabel} 说点什么…`}
          className="thin-scroll block max-h-[112px] w-full resize-none bg-transparent px-3 pt-1.5 text-[13px] leading-[1.65] text-ink/92 placeholder:text-mist/48 focus:outline-none"
        />

        {/* 工具行 */}
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <button
            onClick={() => setText((t) => `${t}🌊`)}
            className="grid h-7 w-7 place-items-center rounded-md text-mist/45 transition-colors hover:bg-white/[0.06] hover:text-ink/80"
            aria-label="插入表情"
          >
            <IconSmile size={16} />
          </button>
          <button
            onClick={onAttach}
            className="grid h-7 w-7 place-items-center rounded-md text-mist/45 transition-all duration-150 hover:bg-white/[0.06] hover:text-ink/80 active:scale-90"
            aria-label="添加附件"
          >
            <IconClip size={16} />
          </button>

          <span className="mx-1 h-3 w-px bg-white/8" />

          <span className="hidden font-mono text-[10px] text-mist/46 sm:inline">
            Enter 发送 · Shift+Enter 换行
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {/* 按住说话 */}
            <button
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                startRec();
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                endRec();
              }}
              onPointerCancel={endRec}
              className="group flex h-7 items-center gap-1.5 rounded-lg px-2.5 transition-all duration-200 active:scale-[0.97]"
              style={{
                border: `1px solid ${recording ? `${accent}66` : "rgba(255,255,255,0.09)"}`,
                background: recording ? `${accent}1c` : "rgba(255,255,255,0.035)",
                color: recording ? accent : "rgba(230,242,251,0.62)",
              }}
              aria-label="按住说话"
            >
              <IconMic size={14} />
              <span className="text-[10.5px]">{recording ? "录音中" : "按住说话"}</span>
            </button>

            <button
              onClick={submit}
              disabled={!text.trim()}
              className="grid h-7 w-7 place-items-center rounded-lg transition-all duration-200 enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed"
              style={{
                background: text.trim()
                  ? `linear-gradient(140deg, ${accent}, ${accent}bb)`
                  : "rgba(255,255,255,0.05)",
                color: text.trim() ? "#03100f" : "rgba(143,169,189,0.4)",
                boxShadow: text.trim() ? `0 0 18px -6px ${accent}` : "none",
              }}
              aria-label="发送"
            >
              <IconSend size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
