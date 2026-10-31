import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { paramOptions, useConsoleCmd } from "../lib/consoleCmd";
import { getGlitch } from "../lib/glitch";
import { usePersonas } from "../store/personas";
import { readTelemetry } from "../store/telemetry";
import { useEscClose } from "../lib/escStack";
import { readMode } from "../lib/mode";
import GraveyardPanel from "./GraveyardPanel";

/**
 * 控制台抽屉。
 *
 * 终端不该常占一栏 —— 它是「按需唤出」的。所以你可以在任何会话里
 * 按下 Ctrl+` 把它拉出来，敲完 sys glitch radar 再收回去。
 *
 * 从底部滑出、横跨全宽，因为命令输出需要宽度（help 有 20 行）。
 */

export default function ConsoleDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { personas, update } = usePersonas();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 面板本体 —— 用来判断点击是否落在外部 */
  const panelRef = useRef<HTMLDivElement | null>(null);
  /* 每次渲染读一次快照；抽屉不追求实时刷新 */
  const t = readTelemetry();

  /* 模式切换后强制重渲染 —— 让 UI 立刻知道现在在哪个视角 */
  const [, setModeTick] = useState(0);
  /**
   * 命令要求开的面板。
   *
   * 目前只有 graves —— 造物主模式下才能摸到那条指令。
   */
  const [panel, setPanel] = useState<"graves" | null>(null);

  const cli = useConsoleCmd(() => ({
    cpuNow: t.cpuNow,
    memNow: t.memNow,
    logs: new Array(t.logCount).fill(null).map(() => ({
      time: "",
      level: "",
      scope: "",
      msg: "",
    })),
    engineLevel: 1,
    /*
     * 造物主模式的唯一入口就在这个控制台里。
     *
     * 传 mode 进去是为了让 creator/sim 知道当前状态（避免重复切换），
     * 传 onModeChange 是为了切完之后立刻重渲染 —— 否则要等下次
     * 别的原因触发渲染才知道模式变了。
     */
    mode: readMode(),
    onModeChange: () => setModeTick((n) => n + 1),
    logPaused: t.logPaused,
    onPauseLog: t.setLogPaused,
    onClearLog: t.clearLogs,
    personas: personas.map((p) => ({
      id: String(p.id),
      name: p.name,
      handle: p.handle,
      model: p.model,
      presence: p.presence,
      mood: p.mood,
      ctxUsed: p.ctxUsed,
      ctxMax: p.ctxMax,
    })),
    updatePersona: (id, patch) => update(id as never, patch as never),
  }), (name) => setPanel(name));

  /* 新输出滚到底 */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cli.history, cli.tabOptions, open]);

  /* 打开时自动聚焦输入框 */
  useLayoutEffect(() => {
    if (open) {
      const id = window.setTimeout(() => cli.inputRef.current?.focus(), 120);
      return () => window.clearTimeout(id);
    }
  }, [open, cli.inputRef]);

  /* 注册到 Esc 栈。输入有内容时自己的 onKeyDown 先 e.preventDefault() 清空，
     栈收到时已 defaultPrevented，不会再关抽屉。 */
  useEscClose(open, onClose);

  /*
   * 点面板外面收起。
   *
   * 延时一帧再注册：打开控制台的那一下点击会冒泡到 document，
   * 不延后的话刚打开就被自己关掉。
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      /*
       * 用 closest 判断，不用 ref.contains ——
       * motion.div 的 ref 在某些挂载顺序下可能还是 null，
       * 一旦为 null 这个监听就静默失效（表现为「点外面没反应」）。
       */
      const inside = (e.target as HTMLElement | null)?.closest?.("[data-console-panel]");
      if (!inside) onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose]);

  const glitch = getGlitch();
  /* 传整个 roster，不只是名字 —— 模型候选要按角色当前凭据过滤，
     只有名字的话就不知道该出哪套凭据的模型。 */
  const roster = personas.map((p) => ({
    name: p.name,
    model: p.model,
    credentialId: p.credentialId,
  }));

  /* 参数候选：把「该选什么」摆出来，不用背 */
  const chips = paramOptions(cli.input, roster);

  /**
   * 点 chip 的两种结局：
   *   还有下一层 → 补全到输入框，等用户继续点
   *   已经是末层 → 直接执行
   */
  const onChip = (value: string) => {
    const base = cli.input.replace(/\s+$/, "");
    const next = base ? `${base} ${value}` : value;
    const more = paramOptions(`${next} `, roster);
    if (more.length > 0) {
      cli.setInput(`${next} `);
    } else {
      cli.submitWith(next);
    }
    cli.inputRef.current?.focus();
  };

  const QUICK: { label: string; cmd: string }[] = [
    { label: "status", cmd: "sys status" },
    { label: "restore", cmd: "sys restore" },
    { label: "ai list", cmd: "ai list" },
    { label: t.logPaused ? "log resume" : "log pause", cmd: t.logPaused ? "log resume" : "log pause" },
    { label: "help", cmd: "help" },
  ];

  return (
    <>
    <motion.div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[105] flex flex-col items-center px-3 pb-3"
      initial={false}
      animate={open ? "open" : "closed"}
      style={{ pointerEvents: open ? "auto" : "none" }}
      aria-hidden={!open}
    >
      {/* ═══ 唤醒线：展开时先划出来，收起时最后消失 ═══ */}
      <motion.div
        variants={{
          open: {
            width: "100%",
            maxWidth: 1180,
            opacity: [0, 1, 0.55],
            transition: { duration: 0.42, times: [0, 0.35, 1], ease: "easeOut" },
          },
          closed: {
            width: "0%",
            opacity: 0,
            transition: { duration: 0.26, delay: 0.2, ease: "easeIn" },
          },
        }}
        className="h-px shrink-0"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(53,240,206,0.85) 30%, rgba(160,245,255,0.95) 50%, rgba(53,240,206,0.85) 70%, transparent)",
          boxShadow: "0 0 14px 1px rgba(53,240,206,0.55)",
        }}
      />

      {/* ═══ 面板：从底边向上卷开（clip-path 裁切，内容不变形）═══ */}
      <motion.div
        ref={panelRef}
        data-console-panel
        className="glass relative mt-[2px] flex w-full max-w-[1180px] flex-col overflow-hidden rounded-[14px]"
        variants={{
          open: {
            clipPath: "inset(0% 0 0 0)",
            opacity: 1,
            transition: {
              clipPath: { duration: 0.38, delay: 0.08, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.12, delay: 0.08 },
            },
          },
          closed: {
            clipPath: "inset(100% 0 0 0)",
            opacity: 0,
            transition: {
              clipPath: { duration: 0.24, ease: "easeIn" },
              opacity: { duration: 0.1, delay: 0.14 },
            },
          },
        }}
        style={{
          height: "min(46vh, 420px)",
          /*
           * 覆盖 .glass 的半透明渐变 —— 控制台上是要读文字的地方，
           * 后面的聊天记录透上来会糊成一片。这里用接近不透明的底。
           */
          background:
            "linear-gradient(166deg, rgba(10, 26, 36, 0.97) 0%, rgba(5, 14, 21, 0.985) 50%, rgba(3, 9, 14, 0.99) 100%)",
          backdropFilter: "blur(20px)",
          boxShadow: "0 -20px 60px -30px rgba(0,0,0,0.9), inset 0 1px 0 rgba(200,245,255,0.07)",
        }}
      >
        {/* 展开瞬间横扫一遍的扫描光 */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-[60px]"
          style={{
            background:
              "linear-gradient(180deg, transparent, rgba(53,240,206,0.10) 50%, transparent)",
          }}
          variants={{
            open: {
              top: ["-60px", "100%"],
              opacity: [0, 1, 0],
              transition: { duration: 0.75, delay: 0.32, ease: "easeInOut" },
            },
            closed: { opacity: 0, transition: { duration: 0.1 } },
          }}
        />
        {/* 内容比面板晚一拍出现，让它像「从壳里长出来」 */}
        <motion.div
          className="flex min-h-0 flex-1 flex-col"
          variants={{
            open: { opacity: 1, transition: { duration: 0.26, delay: 0.3 } },
            closed: { opacity: 0, transition: { duration: 0.1 } },
          }}
        >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3.5 py-2">
          <span className="h-[3px] w-[3px] rounded-full bg-biolum/80" />
          <span className="font-mono text-[10px] tracking-[0.18em] text-mist/50">CONSOLE</span>

          {t.logPaused && (
            <span className="font-mono text-[9.5px] tracking-wider text-amber/70">LOG PAUSED</span>
          )}
          {glitch && (
            <span className="rounded-[3px] border border-coral/30 bg-coral/[0.08] px-1.5 py-[1px] font-mono text-[9px] tracking-wider text-coral/80">
              GLITCH {glitch}
            </span>
          )}

          <span className="ml-auto font-mono text-[9.5px] tracking-wider text-mist/44">
            {t.cpuNow}% · {t.logCount} lines
          </span>
          <button
            onClick={onClose}
            className="ml-2 inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded-[5px] px-1.5 font-mono text-[10px] text-mist/45 transition-colors hover:bg-white/[0.07] hover:text-ink/80 transition-colors hover:bg-white/[0.07] hover:text-ink/70"
            title="收起（Esc）"
          >
            ✕
          </button>
        </div>

        {/* 快捷指令：不用敲，点一下就跑 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.05] px-3.5 py-1.5">
          {QUICK.map((q) => (
            <button
              key={q.label}
              onClick={() => cli.submitWith(q.cmd)}
              className="rounded-[4px] border border-white/[0.08] px-1.5 py-[2px] font-mono text-[10px] text-mist/45 transition-colors hover:border-biolum/35 hover:bg-biolum/[0.07] hover:text-biolum/85"
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* 输出区 */}
        <div
          ref={scrollRef}
          className="thin-scroll min-h-0 flex-1 space-y-[3px] overflow-y-auto px-3.5 py-2.5"
        >
          {cli.history.length === 0 && (
            <div className="space-y-1 font-mono text-[10.5px] leading-[1.6]">
              <div className="text-mist/55">HABITAT console · 输入 help 查看指令</div>
              <div className="text-mist/44">↑↓ 历史 · Tab 补全 · Esc 清空</div>
            </div>
          )}

          {cli.history.map((h, i) => (
            <div key={`cmd-${i}`} className="space-y-[1px]">
              <div className="flex gap-1.5 font-mono text-[10px] leading-[1.6]">
                <span className="shrink-0 text-biolum/55">›</span>
                <span className="min-w-0 break-words text-ink/85">{h.input}</span>
              </div>
              {h.lines.map((l, j) => (
                <div
                  key={j}
                  className={`whitespace-pre-wrap break-words pl-4 font-mono text-[10px] leading-[1.62] ${
                    l.kind === "err" || l.kind === "warn"
                      ? "text-coral/85"
                      : l.kind === "ok"
                        ? "text-biolum/80"
                        : l.kind === "dim"
                          ? "text-mist/52"
                          : "text-mist/62"
                  }`}
                >
                  {l.text}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 参数候选：当前输入走到哪一层，就把下一层的可选项摆出来。
            数量可能很多 —— 一个中转站 22 个模型、另一个 15 个，合起来 37 个 chip。
            所以这里必须有高度上限 + 自己滚动，否则它会把输出区挤没，
            或者撑出容器被裁掉，看起来就是「显示不全」。 */}
        {chips.length > 0 && (
          <div className="shrink-0 border-t border-white/[0.05]">
            <div className="thin-scroll flex max-h-[78px] flex-wrap items-start gap-1.5 overflow-y-auto px-3.5 pb-1.5 pt-1.5">
              <span className="shrink-0 pt-[3px] font-mono text-[9.5px] tracking-wider text-mist/46">
                可选{chips.length > 10 ? ` ${chips.length}` : ""}
              </span>
              {chips.map((o) => (
                <button
                  key={o.value}
                  onClick={() => onChip(o.value)}
                  title={o.value}
                  className="shrink-0 whitespace-nowrap rounded-[4px] border border-white/[0.07] bg-white/[0.02] px-1.5 py-[2px] font-mono text-[10px] text-mist/55 transition-colors hover:border-biolum/35 hover:bg-biolum/[0.08] hover:text-biolum/90"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 输入行 */}
        <div className="shrink-0 border-t border-white/[0.06] px-3.5 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
            <span className={t.logPaused ? "text-amber/70" : "text-biolum/65"}>›</span>
            <input
              ref={cli.inputRef}
              value={cli.input}
              onChange={(e) => cli.setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  cli.submit();
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  cli.recall(-1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  cli.recall(1);
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  cli.complete();
                } else if (e.key === "Escape") {
                  if (cli.input) {
                    /* 有输入 → 只清空，不关抽屉；preventDefault 让栈跳过 */
                    e.preventDefault();
                    e.stopPropagation();
                    cli.setInput("");
                  }
                  /* 输入为空 → 交给 Esc 栈关掉 */
                }
              }}
              placeholder="输入指令 · help 查看 · Esc 收起"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[10.5px] text-ink/90 placeholder:text-mist/44 focus:outline-none"
            />
          </div>

          {cli.tabOptions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-4 font-mono text-[10px] leading-none">
              {cli.tabOptions.map((o) => (
                <span key={o} className="text-mist/56">
                  {o}
                </span>
              ))}
            </div>
          )}
        </div>
        </motion.div>
      </motion.div>
    </motion.div>

      {/*
        命令要求开的面板。
        目前只有 graves —— 造物主模式下才能摸到那条指令。
      */}
      {panel === "graves" && <GraveyardPanel onClose={() => setPanel(null)} />}

    </>
  );
}
