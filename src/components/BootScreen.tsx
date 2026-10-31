import { useEffect, useMemo, useRef, useState } from "react";
import { playRoots } from "../lib/sound";
import { motion, useReducedMotion } from "motion/react";

/**
 * 生境 · 启动画面
 *
 * 三段动画，一条真实驱动：
 *
 *   ① 生长    U 从底部生根，枝和节点依次长出。**进度条和状态文字由真实任务驱动**
 *            （`log` 来自 bootTasks），不是固定时长。
 *   ② 循环    任务没跑完时，U 的信号一直在流、核心一直在呼吸 —— 不会定格。
 *   ③ 归位    任务跑完，U 飞向左上角，途中淡出、Z 淡入，落地亮一圈，然后整块淡出。
 *
 * 三态：
 *   warn  —— 信号变慢、进度条转黄、面板从 0 高度长出来，可「无视进入」
 *   error —— 整株转红、枝折断、藕丝浮现又枯、叶飘落，进度条转红，没有「无视」
 */
export type BootPhase = "grow" | "idle" | "dock" | "gone";

export interface BootLogItem {
  label: string;
  result: string;
  ms: number;
  status: "ok" | "warn" | "error";
}

const ACCENT = "#35f0ce";
const WARN = "#ffc46b";
const ERROR = "#ff7a6b";

/* ── 四根枝：起点都在 (50,54)/(50,70)，末端坐标是固定的 ── */
const BRANCHES = [
  { d: "M50 54 L30 33", cls: "br-1", len: 29, tip: { x: 30, y: 33 }, delay: 0.72 },
  { d: "M50 54 L70 33", cls: "br-2", len: 29, tip: { x: 70, y: 33 }, delay: 0.84 },
  { d: "M50 70 L33 51", cls: "br-3", len: 26, tip: { x: 33, y: 51 }, delay: 0.96 },
  { d: "M50 70 L67 51", cls: "br-4", len: 26, tip: { x: 67, y: 51 }, delay: 1.08 },
];

/* 每片叶各自的飘落时长 —— 差 0.3~0.9 秒，几秒后相位完全错开 */
const LEAF_DURS = [3.2, 3.9, 3.5, 4.1];

/** U —— 生长态 / 失败态用这个 */
function MarkU({ state }: { state: "ok" | "error" }) {
  const bad = state === "error";
  return (
    <svg viewBox="0 0 100 100" width="240" height="240" style={{ overflow: "visible" }}>
      {/*
       * 不用 feGaussianBlur。
       *
       * 那个滤镜每帧要对整块区域重算高斯模糊，而且断掉 GPU 合成 ——
       * 冷启动第一次播放时能明显看到卡一下。
       *
       * 「发光」改用**分层描边**：同一根线画两遍，外层粗且淡、内层细且实。
       * 视觉上几乎一样，但只是两次描边，没有滤镜管线。
       */}
      <g style={{ color: ACCENT }}>
        {/* 主干外发光（粗、淡） */}
        <motion.path
          d="M50 88 V54"
          stroke={bad ? ERROR : ACCENT}
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
          opacity={0.1}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.58, delay: 0.12, ease: [0.4, 0, 0.2, 1] }}
        />
        {/* 主干 */}
        <motion.path
          d="M50 88 V54"
          stroke={bad ? ERROR : ACCENT}
          strokeWidth={2.8}
          strokeLinecap="round"
          fill="none"
          style={{ transition: "stroke .9s" }}
          initial={{ pathLength: 0, opacity: 0.9 }}
          animate={{ pathLength: 1, opacity: 0.88 }}
          transition={{ duration: 0.58, delay: 0.12, ease: [0.4, 0, 0.2, 1] }}
        />

        {/* 四根枝 + 藕丝，绑在一个组里 —— 折的时候一起转 */}
        {BRANCHES.map((b, i) => (
          <motion.g
            key={b.cls}
            style={{ transformOrigin: "50px 54px", transition: "transform .9s cubic-bezier(.4,0,.3,1)" }}
            animate={
              bad
                ? { rotate: i % 2 === 0 ? (i < 2 ? 19 : 13) : -(i < 2 ? 19 : 13) }
                : { rotate: 0 }
            }
          >
            <motion.path
              d={b.d}
              pathLength={100}
              stroke={bad ? ERROR : ACCENT}
              strokeWidth={1.9}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={bad ? "36 20 44" : "none"}
              style={{ transition: "stroke .9s, stroke-dasharray .9s" }}
              initial={{ pathLength: 0, opacity: 0.66 }}
              animate={{ pathLength: 1, opacity: 0.66 }}
              transition={{ duration: 0.4, delay: b.delay, ease: "easeOut" }}
            />

            {/* 藕丝：枝条路径自己的那一段，用 dash 只露出缺口处 */}
            {bad &&
              [0, 1].map((k) => (
                <motion.path
                  key={k}
                  d={b.d}
                  pathLength={100}
                  stroke="#ff9a8b"
                  strokeWidth={k === 0 ? 1.35 : 0.72}
                  strokeLinecap="butt"
                  fill="none"
                  strokeDasharray={k === 0 ? "12 999" : "6 999"}
                  strokeDashoffset={k === 0 ? -40 : -46}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.75, 0.3, 0.55, 0.15, 0] }}
                  transition={{ duration: 3.2, delay: 2.2 + k * 0.2, times: [0, 0.3, 0.52, 0.68, 1] }}
                />
              ))}

            {/* 信号流：任务没完时一直跑 */}
            {!bad && (
              <motion.path
                d={b.d}
                stroke={ACCENT}
                strokeWidth={2.5}
                strokeLinecap="round"
                fill="none"
                strokeDasharray="6 20"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: [0.22, 0.8, 0.22],
                  strokeDashoffset: [0, -26, -26],
                }}
                transition={{
                  duration: 3.8,
                  repeat: Infinity,
                  delay: i * 0.5,
                  ease: "linear",
                }}
              />
            )}
          </motion.g>
        ))}

        {/* 末端节点 / 枯叶 */}
        {BRANCHES.map((b, i) => (
          <motion.circle
            key={`tip-${i}`}
            cx={b.tip.x}
            cy={b.tip.y}
            r={2.6}
            fill={bad ? ERROR : ACCENT}
            initial={{ scale: 0, opacity: 0 }}
            animate={
              bad
                ? {
                    opacity: [0.16, 0.15, 0.12, 0.06, 0],
                    x: [0, -4.6, 4.2, -2.8, 1.6, 0],
                    y: [0, 15, 36, 54, 68, 78],
                    rotate: [0, -42, 36, -26, 20, -8],
                  }
                : { scale: 1, opacity: i < 2 ? 0.88 : 0.62 }
            }
            transition={
              bad
                ? { duration: LEAF_DURS[i], delay: 1.1 + i * 0.28, ease: [0.37, 0.08, 0.63, 0.92] }
                : { duration: 0.34, delay: 1.05 + i * 0.09, ease: [0.34, 1.56, 0.64, 1] }
            }
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        ))}

        {/* 根部横线 */}
        <motion.line
          x1={40}
          y1={88}
          x2={60}
          y2={88}
          stroke={bad ? ERROR : ACCENT}
          strokeWidth={2.2}
          strokeLinecap="round"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.36 }}
          transition={{ delay: 0.5 }}
          style={{ transition: "stroke .9s" }}
        />

        {/* 核心 */}
        <motion.circle
          cx={50}
          cy={54}
          r={4.2}
          fill={bad ? ERROR : ACCENT}
          initial={{ scale: 0, opacity: 0 }}
          animate={
            bad
              ? { scale: 1, opacity: 0.34 }
              : { scale: [1, 1.13, 1], opacity: [0.93, 1, 0.93] }
          }
          transition={
            bad
              ? { duration: 0.45, delay: 0 }
              : { duration: 4.2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }
          }
          style={{ transformBox: "fill-box", transformOrigin: "center", transition: "fill .9s" }}
        />
      </g>
    </svg>
  );
}

/**
 * Z —— 归位之后的形状。
 *
 * 导出：主界面标题栏左上角用的就是它，两处必须同一个组件，
 * 否则「飞过去之后变成另一个图标」会穿帮。
 */
export function MarkZ({ size = 240 }: { size?: number }) {
  const HEX = "M50 8 L87 29 L87 71 L50 92 L13 71 L13 29 Z";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ overflow: "visible" }}>
      {/* 同上：不用滤镜，靠分层描边出光 */}
      <g>
        <motion.path
          d={HEX}
          fill="none"
          stroke={ACCENT}
          strokeWidth={2.2}
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0.6 }}
          animate={{ pathLength: 1, opacity: 0.6 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {/* 边框上一直跑的信号 */}
        <motion.path
          d={HEX}
          fill="none"
          stroke={ACCENT}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="16 248"
          animate={{ strokeDashoffset: [0, -264] }}
          transition={{ duration: 8.5, repeat: Infinity, ease: "linear" }}
        />
        {/* 内部三条走线 */}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 0.45 }} transition={{ delay: 0.3 }}>
          <path d="M34 76 L34 62 L44 56" fill="none" stroke={ACCENT} strokeWidth={1.9} strokeLinecap="round" />
          <path d="M50 80 L50 62" fill="none" stroke={ACCENT} strokeWidth={1.9} strokeLinecap="round" />
          <path d="M66 76 L66 62 L56 56" fill="none" stroke={ACCENT} strokeWidth={1.9} strokeLinecap="round" />
        </motion.g>
        {/* 核心 */}
        <motion.circle
          cx={50}
          cy={52}
          r={6.6}
          fill={ACCENT}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.92, 1, 0.92] }}
          transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut", delay: 0.35 }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      </g>
    </svg>
  );
}

export default function BootScreen({
  log,
  done,
  onEnter,
}: {
  log: BootLogItem[];
  done: boolean;
  onEnter: () => void;
}) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<BootPhase>("grow");
  /**
   * 「生长够了没有」。
   *
   * 真实任务可能 200ms 就跑完，但 U 的枝才长了一根 —— 这时候收画面，
   * 用户看到的是「闪了一下」。所以最早也要到 3.2 秒才允许归位。
   * 慢机器不受影响：任务是串行 await 的，done 本来就晚。
   */
  const [grown, setGrown] = useState(false);

  /*
   * 根系生长音。
   *
   * 只在这一段播 —— 3.2 秒，和 U 长成枝干的时间对齐。
   *
   * 这一声的意义不在于"好听"，在于那三秒**不再是静音**。
   * 原来它是「等加载」，现在它是「有东西在长」。
   */
  useEffect(() => {
    if (reduce) return;
    playRoots();
  }, [reduce]);

  /*
   * 归位终点的算法。
   *
   * 之前用 getBoundingClientRect 量元素中心 —— 量出来是错的：
   * 元素带 marginTop: -60，flex 居中后 getBoundingClientRect 给的
   * 是「含 margin 之后的框」，和 transform 的参考原点差一截，
   * 结果 logo 飞到了 (52, 126) 而不是标题栏里的 (33, 28)。
   *
   * 改成**直接按视口算**：元素在 flex 居中里，中心就是 (vw/2, vh/2)，
   * 再减掉 marginTop 的一半。不需要测量，也不会因为布局时机出错。
   */
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  /*
   * 归位目标：标题栏 logo 的中心。
   * 标题栏高 38，logo 在 padding-left 52 之后、半径 8 —— 中心约 (33, 19)。
   *
   * 起点：**视口正中**。因为 logo 已经用绝对定位锁在 50%/50%，
   * 不再受 flex 布局影响 —— 之前量的 origin 偏了 600px 就是因为
   * logo 和文字在同一个 flex 列里被整体居中。
   */
  const TARGET = { x: 25, y: 18 };
  const TARGET_SIZE = 17;
  const ORIGIN = { x: vp.w / 2, y: vp.h / 2 };

  /*
   * 三态判定有个时序问题：
   *
   * 「核对本地留底」这类步骤经常返回 warn（跳过 / 无记录），但它不代表出事。
   * 如果一上来就按 warn 渲染，用户先看到「部分组件未就绪」，然后才看到加载 —— 顺序反了。
   *
   * 所以：**error 立刻报（要停），warn 等 done 之后才报（来得及）**。
   */
  /*
   * 启动画面只管两种状态：**能启动 / 不能启动**。
   *
   * 「超时但能用」这类情况一律不在这里报 —— 它挪到主界面的弹窗里。
   * 理由：启动画面是"正在发生"的地方，任何警告放这儿都会让人以为**启动失败了**；
   * 而实际上程序好好的，只是某个非关键组件慢了半拍。
   *
   * 所以：error（拦住启动）留在这里，warn（带伤继续）交给 App 的 notify。
   */
  const state = useMemo<"ok" | "error">(() => {
    if (!done) return "ok";
    if (log.some((l) => l.status === "error")) return "error";
    return "ok";
  }, [log, done]);

  const total = 6;
  const progress = done ? 100 : Math.min(96, Math.round((log.length / total) * 100));
  const last = log[log.length - 1];

  /* 生长 + 循环展示，至少 3.2 秒 */
  useEffect(() => {
    const t = window.setTimeout(() => setGrown(true), 3200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (grown) setPhase((p) => (p === "grow" ? "idle" : p));
  }, [grown]);

  /* 任务跑完 + 动画走够 → 归位 */
  useEffect(() => {
    if (!done || !grown) return;
    if (state === "error") return;
    setPhase("dock");
    /* 飞到左上角 0.95s + 停一下 0.55s，然后交出去 */
    const t = window.setTimeout(() => {
      setPhase("gone");
      /*
       * 提前交棒。
       *
       * 原来等 BootScreen 完全淡完（380ms）才通知外面 —— 结果中间有一帧
       * 两边都没内容，看起来像卡了一下。
       *
       * 现在 140ms 就通知：主界面开始展开时，启动画面还在淡出，两层重叠。
       */
      window.setTimeout(onEnter, 380);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [done, state, phase, onEnter]);

  if (phase === "gone" && !log.length) return null;

  const bad = state === "error";
  /* 只有「不能启动」才弹面板 */
  const showPanel = bad;

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style={{
        background:
          "radial-gradient(760px 520px at 50% 40%, rgba(53,240,206,.05), transparent 68%), #04080c",
        /* 挡住下面的一切点击 —— 启动动画播放时点屏幕不该穿透进去 */
        pointerEvents: phase === "gone" ? "none" : "auto",
      }}
      animate={{ opacity: phase === "gone" ? 0 : 1 }}
      transition={{ duration: 0.36, ease: "easeOut" }}
    >
      {/* ── logo 容器：整块飞向左上角并缩小 ── */}
      <motion.div
        className="grid place-items-center"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 240,
          height: 240,
          marginLeft: -120,
          marginTop: -120,
        }}
        animate={
          phase === "dock"
            ? {
                /*
                 * 不要用 -50vw + margin —— motion 的 margin 不参与 transform，
                 * 而且 vw 是相对视口算的，元素本身在 flex 里居中，两个偏移叠起来就飞出去了。
                 *
                 * 直接算：元素中心原本在 (vw/2, vh/2)，目标中心是标题栏里的 (33, 28)。
                 */
                x: TARGET.x - ORIGIN.x,
                y: TARGET.y - ORIGIN.y,
                scale: TARGET_SIZE / 240,
              }
            : { x: 0, y: 0, scale: 1 }
        }
        transition={{ duration: 0.95, ease: [0.55, 0.06, 0.28, 1] }}
      >
        {/* U 和 Z 交叉淡化，在飞行途中完成切换 */}
        <motion.div
          className="absolute"
          animate={{ opacity: phase === "dock" ? 0 : 1 }}
          transition={{ duration: 0.55, delay: phase === "dock" ? 0.16 : 0 }}
        >
          <MarkU state={state} />
        </motion.div>
        <motion.div
          className="absolute"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "dock" ? 1 : 0 }}
          transition={{ duration: 0.55, delay: phase === "dock" ? 0.3 : 0 }}
        >
          <MarkZ />
        </motion.div>

        {/* 落地那一圈光 */}
        {phase === "dock" && (
          <motion.div
            className="pointer-events-none absolute rounded-full"
            style={{
              width: 40,
              height: 40,
              background:
                "radial-gradient(circle, rgba(53,240,206,.42) 0%, rgba(53,240,206,.10) 45%, transparent 72%)",
            }}
            initial={{ scale: 0.55, opacity: 0 }}
            animate={{ scale: [0.55, 1.1, 2.6], opacity: [0, 0.55, 0] }}
            transition={{ duration: 0.78, delay: 0.95, ease: [0.2, 0.75, 0.3, 1] }}
          />
        )}
      </motion.div>

      {/* ── 文字 + 进度 + 面板：归位时淡出 ── */}
      <motion.div
        className="absolute flex flex-col items-center"
        style={{ left: "50%", top: "50%", transform: "translateX(-50%)", marginTop: 132 }}
        animate={{ opacity: phase === "dock" ? 0 : 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="text-center">
          <div
            style={{
              fontSize: 30,
              fontWeight: 300,
              letterSpacing: ".42em",
              textIndent: ".42em",
              color: "#e8f6ff",
            }}
          >
            生 境
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 9.5,
              letterSpacing: ".32em",
              textIndent: ".32em",
              color: "rgba(143,199,219,.5)",
            }}
          >
            HABITAT
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 8,
              letterSpacing: ".16em",
              color: "rgba(91,120,138,.55)",
            }}
          >
            SYSTEMIC ECOSYSTEM FOR AGENTS
          </div>
        </div>

        {/* 只有「不能启动」才弹面板；warn 交给主界面 */}
        <motion.div
          style={{ width: 470, overflow: "hidden" }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: showPanel ? "auto" : 0, opacity: showPanel ? 1 : 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            style={{
              marginTop: 24,
              borderRadius: 9,
              padding: "13px 16px",
              border: `1px solid rgba(255,122,107,.36)`,
              background: "rgba(255,122,107,.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11.5,
                color: ERROR,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: ERROR,
                  boxShadow: `0 0 8px ${ERROR}`,
                }}
              />
              启动被中断，需要先排查
            </div>
            <div
              style={{
                marginTop: 9,
                fontSize: 10,
                lineHeight: 1.8,
                color: "rgba(200,222,236,.62)",
              }}
            >
              <b style={{ color: "rgba(232,246,255,.82)" }}>出错步骤</b>：{last?.label ?? "未知"}
              <br />
              <b style={{ color: "rgba(232,246,255,.82)" }}>现象</b>：{last?.result ?? "无详细信息"}
              <br />
              数据文件可能损坏。请在 <code>%APPDATA%\habitat\data\</code> 里把{" "}
              <code>current.json</code> 改名留档，用最近的 <code>backup-日期.json</code> 还原后重启。
            </div>
          </div>
        </motion.div>

        {/* 进度条 */}
        <div style={{ width: 470, marginTop: 22 }}>
          <div
            style={{
              height: 1.6,
              borderRadius: 2,
              background: "rgba(255,255,255,.07)",
              overflow: "hidden",
            }}
          >
            <motion.div
              style={{
                height: "100%",
                borderRadius: 2,
                background: `linear-gradient(90deg, ${bad ? "rgba(255,122,107,.3)" : "rgba(53,240,206,.3)"}, ${bad ? ERROR : ACCENT})`,
                boxShadow: `0 0 9px ${bad ? "rgba(255,122,107,.55)" : "rgba(53,240,206,.55)"}`,
                transition: "background .5s, box-shadow .5s",
              }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: [0.3, 0.9, 0.3, 1] }}
            />
          </div>
          <div
            style={{
              marginTop: 10,
              textAlign: "center",
              fontFamily: "ui-monospace, monospace",
              fontSize: 9,
              letterSpacing: ".15em",
              color: bad ? "rgba(255,122,107,.85)" : "rgba(91,120,138,.65)",
              transition: "color .45s",
            }}
          >
            {bad ? "· 启动中断" : done ? "· 就绪" : `· ${last?.label ?? "初始化"}`}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}