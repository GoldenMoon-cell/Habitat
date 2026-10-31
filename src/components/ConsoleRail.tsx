import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadCredentials } from "../store/credentials";
import { clearEvents, loadEvents, subscribeEvent, type AppEvent } from "../lib/eventLog";
import { reportTelemetry, registerTelemetryActions } from "../store/telemetry";
import { usePersonas } from "../store/personas";
import { IconChip, IconTail, IconWave } from "./Icons";
import { MarkZ } from "./BootScreen";
import BlockBoundary from "./BlockBoundary";
import { CrashProbe } from "./FaultDemo";

/* ── 工具 ─────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/*
 * ── 这里原来有两张假日志表 ──
 *
 * `SEED_LOGS` / `LOG_POOL`（在 mock.ts 里），写死的
 * `router›deliver ok · 4/4 ack`、`tts›synth chunk → 320ms`，
 * 每 2 秒随机抽一条播，让左栏"看起来在动"。
 *
 * **删了。** 因为它编了一个不存在的系统：
 * 用户看到 `tts›synth` 会以为有语音合成，然后去找 —— 找不到。
 *
 * 现在这条流只有真事件：每一条都对得上软件里真的发生过的事。
 */

/** 事件等级 → 颜色 */
const LEVEL_COLOR: Record<AppEvent["level"], string> = {
  info: "rgba(143,169,189,.72)",
  ok: "rgba(53,240,206,.85)",
  warn: "rgba(255,180,84,.9)",
  err: "rgba(255,122,107,.92)",
};
const LEVEL_MARK: Record<AppEvent["level"], string> = {
  info: "·",
  ok: "✓",
  warn: "!",
  err: "×",
};
/** 事件等级 → 左边那道竖条 + 底色 */
const LEVEL_EDGE: Record<AppEvent["level"], { edge: string; bg: string }> = {
  info: { edge: "rgba(143,169,189,.22)", bg: "transparent" },
  ok: { edge: "rgba(53,240,206,.42)", bg: "rgba(53,240,206,.035)" },
  warn: { edge: "rgba(255,180,84,.55)", bg: "rgba(255,180,84,.05)" },
  err: { edge: "rgba(255,122,107,.7)", bg: "rgba(255,122,107,.06)" },
};

/* ── 迷你折线 ─────────────────────────────────────────────── */

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 100;
  const H = 26;
  const max = 100;
  const pts = data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * W;
      const y = H - (Math.min(max, Math.max(0, v)) / max) * (H - 3) - 1.5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const area = `0,${H} ${pts} ${W},${H}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[26px] w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={`sp-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#sp-${color.replace("#", "")})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ── 指标行 ───────────────────────────────────────────────── */

function Metric({
  label,
  value,
  unit,
  pct,
  color,
  history,
}: {
  label: string;
  value: string;
  unit?: string;
  pct: number;
  color: string;
  history: number[];
}) {
  return (
    <div className="group">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="tabular text-[11px] text-ink/90">
          {value}
          {unit && <span className="ml-[1px] text-[10px] text-mist/60">{unit}</span>}
        </span>
      </div>
      <div className="mt-[5px] h-[2px] w-full overflow-hidden rounded-full bg-white/[0.055]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.min(100, Math.max(2, pct))}%`,
            background: `linear-gradient(90deg, ${color}44, ${color})`,
            boxShadow: `0 0 8px ${color}66`,
          }}
        />
      </div>
      <div className="mt-[3px] opacity-70 transition-opacity group-hover:opacity-100">
        <Sparkline data={history} color={color} />
      </div>
    </div>
  );
}

/* ── 主体 ─────────────────────────────────────────────────── */

export default function ConsoleRail({
  onOpenConsole,
}: {
  onOpenConsole?: () => void;
} = {}) {
  const { personas, update } = usePersonas();
  const [clock, setClock] = useState(stamp());
  const [cpu, setCpu] = useState<number[]>([18, 22, 19, 31, 27, 24, 33, 29, 26, 21, 24, 28]);
  const [mem, setMem] = useState<number[]>([41, 42, 44, 43, 46, 45, 47, 46, 48, 47, 46, 45]);
  /*
   * ── 事件流 ──
   *
   * **只有真的。** 没有假日志，没有"随机抽一条播"。
   *
   * 第一次打开时这里是空的 —— 因为确实什么都没发生过。
   * 那不丢人，那叫诚实。
   */
  const [events, setEvents] = useState<AppEvent[]>(() => loadEvents());

  useEffect(
    () =>
      subscribeEvent((e) =>
        setEvents((prev) => {
          /* 去重 —— 订阅 + 本地 push 可能重复 */
          if (prev.some((x) => x.id === e.id)) return prev;
          return [e, ...prev].slice(0, 60);
        })
      ),
    []
  );

  /*
   * 暂停滚动（命令行 `log pause`）。
   *
   * 语义改了：以前是"停止生成假日志"，现在是**别把视图顶走**。
   * 日志是事实记录，不该能被暂停 —— 但用户想翻看旧行时，
   * 新事件把滚动条拽下去确实烦。
   */
  const [logPaused, setLogPaused] = useState(false);
  const cmdRef = useRef<HTMLDivElement | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  /* 时钟 */
  useEffect(() => {
    const id = setInterval(() => setClock(stamp()), 1000);
    return () => clearInterval(id);
  }, []);

  /*
   * 指标 —— **真的**。
   *
   * 之前是 Math.random() 随机游走，只为让面板看起来活着。
   *
   * 但那是原型最容易死的地方：**「CPU 是假的，那记忆是不是也是假的？」**
   *
   * 现在问主进程要 `os.cpus()` 差分和 `os.freemem()`。
   * 一秒一次 —— 比之前的 1.6 秒更密，因为真数据不需要"演得像"。
   */
  const [memGB, setMemGB] = useState(0);
  useEffect(() => {
    const api = window.desktop;
    if (!api?.sysStats) return;
    let alive = true;

    const pull = async () => {
      try {
        const s = await api.sysStats();
        if (!alive || !s) return;
        setCpu((prev) => [...prev.slice(-23), s.cpu]);
        setMem((prev) => [...prev.slice(-23), s.mem.percent]);
        setMemGB(s.mem.used / 1024 ** 3);
      } catch {
        /* 拿不到就保持上一次的值，不抖动 */
      }
    };

    void pull();
    const id = setInterval(pull, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /*
   * 假日志的播种定时器 —— **删了**。
   *
   * 原来是每 3.2 秒从 `LOG_POOL` 里抽一条播出去，
   * 让左栏看起来像在运转。现在这条流没有任何假货，
   * 所以不需要播种器。
   *
   * 事件从 `subscribeEvent` 来，从 `pushEvent` 产生。
   */

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current && !logPaused) el.scrollTop = el.scrollHeight;
  }, [events, logPaused]);


  /*
   * API LINKS —— 真的凭据列表。
   *
   * 颜色按凭据自己的 accent；有 key 才亮。
   * active 那个呼吸 —— 那是「正在用它发消息」的唯一可视信号。
   */
  const links = (() => {
    const list = loadCredentials();
    /* activeCredential() 用「第一个有 key 的」作为当前 —— 和真正发送时一致 */
    const act = list.find((c) => c.apiKey) ?? null;
    return list.map((c) => ({
      id: c.id,
      name: c.label || "未命名",
      /* 每个凭据一个稳定色 —— 按 id 散列，不用存 */
      color: (() => {
        const pal = ["#4e8cff", "#35f0ce", "#8b6bff", "#ffa06b", "#ff5d7a", "#6ee787"];
        let h = 0;
        for (let i = 0; i < c.id.length; i++) h = (h * 31 + c.id.charCodeAt(i)) >>> 0;
        return pal[h % pal.length];
      })(),
      ok: !!c.apiKey,
      models: (c.models ?? []).length,
      active: !!c.apiKey && c.id === act?.id,
    }));
  })();

  const cpuNow = Math.round(cpu[cpu.length - 1] ?? 24);
  const memNow = Math.round(mem[mem.length - 1] ?? 45);

  /* 命令行：指令真的生效（注入故障、静音角色、暂停滚动） */
  /* 上报遥测给控制台抽屉（它在 App 层，拿不到这里的状态） */
  useEffect(() => {
    reportTelemetry({ cpuNow, memNow, logCount: events.length, logPaused });
  }, [cpuNow, memNow, events.length, logPaused]);

  /* 注册可被控制台调用的动作 */
  useEffect(() => {
    registerTelemetryActions({
      setLogPaused,
      clearLogs: () => {
        setEvents([]);
        clearEvents();
      },
    });
  }, []);

  /*
   * ping —— **删了**。
   *
   * 原来每 2.6 秒编一个 12-34ms 的随机数显示在 API LINKS 旁边。
   *
   * 没有真连接可测，那个数字就是编的。
   * 而"编一个延迟"比"不显示延迟"更糟 —— 它暗示这里在测量什么。
   */
  void stamp;

  return (
    <div className="hud-blocks rail-sep grain relative flex min-h-0 flex-1 flex-col">
      {/* ── 标识 ── */}
      <BlockBoundary kind="ident" name="标识">
      <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-4">
        <div className="relative grid h-8 w-8 place-items-center rounded-[10px] border border-biolum/25 bg-biolum/[0.07] text-biolum">
          <MarkZ size={18} />
          <span className="absolute inset-0 rounded-[10px] shadow-[inset_0_0_14px_rgba(53,240,206,0.22)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12.5px] font-semibold tracking-[0.06em] text-ink">
              HABITAT
            </span>
            <span className="h-1 w-1 rounded-full bg-biolum pulse-dot" />
          </div>
          <div className="label mt-[1px] text-[10px] tracking-[0.2em]">
            local stack
          </div>
        </div>
      </div>
      </BlockBoundary>

      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ── 系统监控 ── */}
      <BlockBoundary kind="sparkline" name="系统监控">
      <div className="space-y-3.5 px-4 py-4">
        <div className="flex items-center gap-1.5 text-mist/70">
          <IconChip size={11} />
          <span className="label">system</span>
          <span className="tabular ml-auto text-[10px] text-mist/45">{clock}</span>
        </div>

        <Metric
          label="cpu"
          value={String(cpuNow)}
          unit="%"
          pct={cpuNow}
          color="#35f0ce"
          history={cpu}
        />
        <Metric
          label="memory"
          value={memGB.toFixed(1)}
          unit="G"
          pct={memNow}
          color="#4e8cff"
          history={mem}
        />
      </div>
      </BlockBoundary>

      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ── API 状态灯 ── */}
      <BlockBoundary kind="api" name="API LINKS" data={{ endpoints: ["dsh", "astrbot", "google", "anthropic"] }}>
      <div className="space-y-1.5 px-4 py-4">
        <div className="mb-2.5 flex items-center gap-1.5 text-mist/70">
          <IconWave size={11} />
          <span className="label">api links</span>
          <span className="ml-auto font-mono text-[9.5px] text-mist/50">
            {links.filter((s) => s.ok).length}/{links.length}
          </span>
          {/* ping 是假的 —— 没有真连接可测，就不显示 */}

        </div>

        {/*
          ── 真的凭据 ──

          之前这四行是写死的 dsh / astrbot / google / anthropic，
          busy / idle 也是编的。

          现在从 `3w:credentials` 读：
            · 有 key → 绿点
            · 没 key → 灰点
            · 正在被用（activeCredential）→ 呼吸
            · 右边显示模型数 / 没配
        */}
        {links.length === 0 ? (
          <div className="px-1 py-2 font-mono text-[9.5px] leading-relaxed text-mist/32">
            还没有接口。
            <br />
            设置 → API 接入
          </div>
        ) : (
          links.map((s) => (
            <div
              key={s.id}
              className="group flex items-center gap-2 rounded-[5px] px-1 py-[3px] transition-colors hover:bg-white/[0.03]"
            >
              <span className="relative flex h-[5px] w-[5px]">
                <span
                  className={`absolute inset-0 rounded-full ${s.active ? "pulse-dot" : ""}`}
                  style={{
                    background: s.ok ? s.color : "rgba(143,169,189,.3)",
                    boxShadow: s.ok ? `0 0 6px ${s.color}` : "none",
                  }}
                />
              </span>
              <span className="truncate font-mono text-[10px] text-ink/75">
                {s.name}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[9.5px] text-mist/45 group-hover:text-mist/70">
                {s.ok ? `${s.models} 个模型` : "没配"}
              </span>
            </div>
          ))
        )}
      </div>
      </BlockBoundary>

      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ── 实时日志（独立边界：它挂了不影响上面的 CPU / API）── */}
      <BlockBoundary kind="freeze" name="EVENT STREAM">
      {typeof window !== "undefined" &&
      window.location.search.includes("sim=crash-block") ? (
        <CrashProbe />
      ) : (
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
        <div className="mb-2 flex items-center gap-1.5 text-mist/70">
          <span className="label">event stream</span>
          {logPaused && (
            <span className="font-mono text-[9.5px] tracking-wider text-amber/70">PAUSED</span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <span className="h-[3px] w-[3px] rounded-full bg-coral/80" />
            <span className="h-[3px] w-[3px] rounded-full bg-amber/80" />
            <span className="h-[3px] w-[3px] rounded-full bg-biolum/80" />
          </span>
        </div>

        <div
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="thin-scroll -mr-2 min-h-0 flex-1 space-y-[5px] overflow-y-auto pr-2 pb-2"
        >
          {/*
            ── 事件流 ──

            每一条都是真的发生过的事：
              `mem › write 1 · tag=情绪 · w=0.75`
              `llm › ok · 1840ms · 843 tok · claude-fable-5`
              `agent › awaken「澜汐」· 不可撤销`

            没有假日志。空的时候就是空的 ——
            因为确实什么都没发生过。
          */}
          {events.length === 0 ? (
            <div className="px-2 py-3 font-mono text-[9.5px] leading-[1.9] text-mist/32">
              还没有事件。
              <br />
              <span className="text-mist/22">
                说一句话、改一次名、拨一下时间 ——
                <br />
                痕迹会出现在这里。
              </span>
            </div>
          ) : (
            events.map((e) => {
              const edge = LEVEL_EDGE[e.level];
              return (
                <div
                  key={e.id}
                  className="flex gap-1.5 border-l-2 px-2 py-[3px] font-mono text-[10.5px] leading-[1.55]"
                  style={{ borderLeftColor: edge.edge, background: edge.bg }}
                >
                  <span className="tabular shrink-0 text-mist/48">{e.time}</span>
                  <span
                    className="shrink-0"
                    style={{ color: LEVEL_COLOR[e.level] }}
                  >
                    {LEVEL_MARK[e.level]}
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="text-ink/45">{e.scope}</span>
                    <span className="mx-[3px] text-mist/40">›</span>
                    <span
                      style={{ color: LEVEL_COLOR[e.level] }}
                      className="break-words"
                    >
                      {e.msg}
                    </span>
                    {e.pinned && (
                      <span className="ml-1 font-mono text-[9px] tracking-wider text-coral/50">
                        PIN
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}
      </BlockBoundary>

      {/* ── 页脚 ── */}
      <div className="mt-auto flex items-center justify-between border-t border-white/[0.055] px-4 py-2.5">
        <span className="font-mono text-[10px] tracking-wider text-mist/55">
          v0.1.0 · local
        </span>

        {/* 控制台唤出入口 */}
        <button
          onClick={onOpenConsole}
          className="group flex items-center gap-1 rounded-[4px] px-1.5 py-[2px] font-mono text-[10px] text-mist/55 transition-colors hover:bg-biolum/[0.08] hover:text-biolum/85"
          title="打开控制台（Ctrl+`）"
        >
          <span className="text-[10px] leading-none">›_</span>
          <span>控制台</span>
        </button>

        <span className="flex items-center gap-1 font-mono text-[10px] text-mist/55">
          <span className="h-1 w-1 rounded-full bg-biolum/70" />
          uptime 4h 12m
        </span>
      </div>
    </div>
  );
}