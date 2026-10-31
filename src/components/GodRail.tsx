import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  forgetMemory,
  imprintMemory,
  loadMemories,
  promoteMemory,
  recallMemory,
  suppressMemory,
} from "../lib/memoryNotes";
import { effectiveWeight, freshness, isConsolidated } from "../lib/forgetting";
import { eyeOfYou } from "../lib/eyeOfYou";
import { readMode } from "../lib/mode";
import { useScripts } from "../lib/scripts";
import { readTts } from "../lib/tts";
import { deadlineOf, remainingLabel } from "../lib/deadline";
import {
  EMOTION,
  MEMORY,
  QUICK_ACTIONS,
  type AgentId,
  type ConvId,
  type EmotionAxis,
  isGroupId,
} from "../data/mock";
import { usePersonas } from "../store/personas";
import { useGroups } from "../store/groups";
import { NEUTRAL, readDynamic } from "../lib/dynamic";
import {
  AXIS_ORDER,
  axisBand,
  DYNAMIC_ORDER,
  dynamicBand,
  BONDS,
  PERSONA_MAP,
  bondsOf,
  otherSide,
  type Bond,
  type BondKind,
  type PersonaId,
} from "../data/personas";
import {
  loadMockModifier,
  resolveProfile,
  type PersonaModifier,
} from "../data/personaModifier";
import {
  ENGINE_MAP,
  resolveChain,
  type EngineConfig,
  type EngineLevel,
} from "../data/engines";
import EmotionRadar from "./EmotionRadar";
import BlockBoundary from "./BlockBoundary";
import { ICONS, IconArrow, IconBroom, IconChevron, IconPlus, IconSpark, IconTail } from "./Icons";
import { notify } from "../lib/notify";

const TAG_STYLE: Record<string, string> = {
  长期: "border-tide/30 bg-tide/10 text-tide/90",
  短期: "border-white/10 bg-white/[0.05] text-mist/70",
  情绪: "border-coral/30 bg-coral/10 text-coral/90",
  偏好: "border-amber/30 bg-amber/10 text-amber/90",
};

const LAYER: Record<string, string> = {
  长期: "L3 · 不参与常规检索",
  短期: "L1 · 24h 后半衰",
  情绪: "L2 · 情绪关联层",
  偏好: "L3 · 人格锚点",
};

const KIND_LABEL: Record<BondKind, string> = {
  cp: "CP",
  rival: "对手",
  ally: "同盟",
  observer: "搅局",
};

const KIND_COLOR: Record<BondKind, string> = {
  cp: "#ff7a8a",
  rival: "#ffc46b",
  ally: "#35f0ce",
  observer: "#8b6bff",
};

const MONO: Record<string, string> = {
  jingjing: "鲸",
  lanxi: "汐",
  gemini: "G",
  claude: "C",
  grok: "X",
  gpt: "G",
  qwen: "Q",
  kimi: "K",
};

export interface CommandEvent {
  label: string;
  hint: string;
  icon: string;
  accent: string;
}

function MiniAvatar({ id, size = 22 }: { id: PersonaId; size?: number }) {
  const p = PERSONA_MAP[id];
  if (!p) return null;
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, ${p.color}3a, rgba(4,12,20,0.9) 70%)`,
        boxShadow: `0 0 0 1px ${p.color}4d`,
      }}
      aria-hidden
    >
      <span className="font-semibold leading-none" style={{ fontSize: size * 0.44, color: p.color }}>
        {MONO[id] ?? p.name[0]}
      </span>
    </div>
  );
}

function BondRow({ bond, self, index }: { bond: Bond; self: ConvId; index: number }) {
  const other = isGroupId(self) ? bond.a : otherSide(bond, self as PersonaId);
  const isWild = other === "*";
  const p = isWild ? null : PERSONA_MAP[other as PersonaId];
  const color = KIND_COLOR[bond.kind];

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.36, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="group rounded-lg border border-white/[0.055] bg-white/[0.022] p-2 transition-colors duration-200 hover:border-white/[0.12] hover:bg-white/[0.04]"
    >
      <div className="flex items-center gap-2">
        {p ? (
          <MiniAvatar id={other as PersonaId} />
        ) : (
          <div className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-lumen/40 bg-lumen/10 text-[10px] text-lumen">
            ✳
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10.5px] text-ink/85">{bond.label}</div>
          <div className="truncate font-mono text-[9.5px] text-mist/52">
            {p ? p.name : "所有人"}
          </div>
        </div>
        <span
          className="shrink-0 rounded-[3px] border px-[3px] py-[0.5px] text-[9.5px] leading-none"
          style={{ borderColor: `${color}3d`, background: `${color}14`, color }}
        >
          {KIND_LABEL[bond.kind]}
        </span>
      </div>

      <p className="mt-1.5 text-[10px] leading-[1.5] text-ink/62">{bond.note}</p>

      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="font-mono text-[9.5px] text-mist/50">张力</span>
        <span className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
          <span
            className="block h-full rounded-full"
            style={{ width: `${bond.tension}%`, background: color, opacity: 0.8 }}
          />
        </span>
        <span className="tabular text-[9.5px] text-mist/45">{bond.tension}</span>
      </div>
    </motion.div>
  );
}

/* ── 人格配置页 ─────────────────────────────────────────────── */

function PersonaConfigPanel({
  modifier,
  accent,
  onInject,
  injected,
  scanning,
  engineLevel,
}: {
  modifier: PersonaModifier | null;
  accent: string;
  onInject: () => void;
  injected: boolean;
  scanning: boolean;
  engineLevel: EngineLevel;
}) {
  if (!modifier) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="label">persona config</span>
          <span className="font-mono text-[9.5px] text-mist/48">未配置</span>
        </div>
        <div className="rounded-lg border border-dashed border-white/[0.08] p-3 text-center">
          <p className="text-[10px] leading-[1.6] text-mist/58">
            这个角色还在用出厂基线。
            <br />
            指定一份 .md / .txt，或从 AstrBot / DSH 拉 system_prompt。
          </p>
          <button
            onClick={() =>
              notify({
                title: "选择人格配置文件",
                desc: "本地 .md / .txt · 第二阶段接文件选择器",
                accent: "#8fa9bd",
                icon: "log",
              })
            }
            className="mt-2 rounded-[5px] border border-white/[0.1] px-2.5 py-[4px] text-[10.5px] text-ink/70 transition-colors hover:border-biolum/35 hover:text-biolum"
          >
            选择文件…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">persona config</span>
        <span className="flex items-center gap-1 font-mono text-[9.5px]" style={{ color: `${accent}b0` }}>
          {modifier.source}
        </span>
      </div>

      {/* 来源卡片 */}
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2">
        <div className="flex items-start gap-1.5">
          <IconSpark size={11} className="mt-[2px] shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[10.5px] text-ink/85">{modifier.label}</div>
            <div className="mt-[2px] truncate font-mono text-[9.5px] text-mist/52">
              {modifier.origin}
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-[9px] text-mist/48">
          <span>{(modifier.chars / 1000).toFixed(1)}k chars</span>
          <span>·</span>
          <span>#{modifier.hash}</span>
          <span>·</span>
          <span>{modifier.loadedAt}</span>
        </div>

        {/* 覆盖率 */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-mist/50">识别覆盖</span>
          <span className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.span
              initial={{ width: 0 }}
              animate={{ width: `${modifier.coverage * 100}%` }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="block h-full rounded-full"
              style={{ background: accent, opacity: 0.8 }}
            />
          </span>
          <span className="tabular text-[9px] text-mist/45">
            {Math.round(modifier.coverage * 100)}%
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-mist/48">
          <span>引擎</span>
          <span style={{ color: accent }}>
            L{engineLevel} · {ENGINE_MAP[engineLevel].name}
          </span>
          <span className="opacity-60">这套规则将被用于本次注入</span>
        </div>
      </div>

      {/* 注入按钮 */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={onInject}
        className="relative mt-2 overflow-hidden rounded-lg border py-[6px] text-[10px] transition-colors duration-300"
        style={{
          borderColor: injected ? `${accent}3d` : `${accent}55`,
          background: injected ? `${accent}12` : `linear-gradient(120deg, ${accent}22, ${accent}0d)`,
          color: accent,
        }}
      >
        {scanning ? (
          <span className="flex items-center justify-center gap-1.5">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              className="inline-block h-[8px] w-[8px] rounded-full border border-current border-t-transparent"
            />
            正在解析…
          </span>
        ) : injected ? (
          `已注入 ${modifier.deltas.length} 处修正`
        ) : (
          `载入并注入人格（${modifier.deltas.length} 处命中）`
        )}
      </motion.button>

      {/* 命中明细 */}
      <div className="mt-2 mb-1 flex items-center justify-between">
        <span className="label">hits</span>
        <span className="font-mono text-[9.5px] text-mist/48">{modifier.deltas.length}</span>
      </div>
      <div
        className="thin-scroll -mr-1.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1.5 pb-1"
        style={{
          maskImage: "linear-gradient(180deg, black 0%, black 92%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 92%, transparent 100%)",
        }}
      >
        {modifier.deltas.map((d, i) => (
          <motion.div
            key={`${d.axis}-${i}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.04 }}
            className="rounded-[6px] border border-white/[0.05] bg-white/[0.02] px-1.5 py-1"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-ink/70">{d.axis}</span>
              <span
                className="tabular text-[10px]"
                style={{ color: d.amount > 0 ? accent : "#ff7a6b" }}
              >
                {d.amount > 0 ? `+${d.amount}` : d.amount}
              </span>
              <span className="ml-auto truncate font-mono text-[9px] text-mist/50">
                {d.reason}
              </span>
            </div>
            <div className="mt-[2px] truncate font-mono text-[9px] leading-[1.45] text-mist/45">
              「{d.snippet}」
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ── 主体 ───────────────────────────────────────────────────── */

export default function GodRail({
  conv,
  onCommand,
  onScript,
  engine,
  onCollapse,
}: {
  conv: ConvId;
  onCommand: (e: CommandEvent) => void;
  /** 快捷剧本触发 —— 真的发一条消息（和 onCommand 的假系统条不同） */
  onScript: (s: { label: string; text: string }) => void;
  engine: EngineConfig;
  onCollapse?: () => void;
}) {
  /*
   * 快捷命令折叠。
   *
   * VITALS 这一栏本来是「记忆流 / 雷达 / 心智指标 / 快捷命令」四块纵向堆叠，
   * 快捷命令固定贴在底部（shrink-0），把上面三块挤得很紧 —— 记忆流经常只能露出两三条。
   *
   * 但快捷命令是**低频**操作（发牌、投喂、朗读），记忆流是**常看**的信息。
   * 低频的默认收起，让常看的拿到空间。
   *
   * 状态写进 localStorage：收起过就一直收着，不用每次重新收。
   */
  const [quickOpen, setQuickOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("3w:quickOpen") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("3w:quickOpen", quickOpen ? "1" : "0");
    } catch {
      /* 存不进去不影响使用 */
    }
  }, [quickOpen]);
  const { map: AGENT_MAP, personas, update: updatePersona } = usePersonas();
  /* 群名是用户改的，从 store 读 —— 以前这里硬编码「三鲸之家」，改群名也不会变 */
  const { groups } = useGroups();
  const isGroup = isGroupId(conv);
  const groupName = groups.find((g) => String(g.id) === String(conv))?.name ?? "群聊";
  const agent = isGroup ? null : AGENT_MAP[conv as AgentId];
  const accent = agent?.color ?? "#a9e8ff";

  /* 动态三轴：此刻状态。
     有存档就用存档，没有就用中性起点 —— 绝不显示「0」冒充数据。 */
  /* 从动态存储读 —— 不在 Persona 里存，因为这两者写入频率差三个数量级
     （角色一年改一次，心情一小时变三次）。 */
  const [dyn, setDyn] = useState(() => (isGroup ? NEUTRAL : readDynamic(String(conv))));
  useEffect(() => {
    setDyn(isGroup ? NEUTRAL : readDynamic(String(conv)));
    /* 每秒重读一次 —— 动态值由 push() 写入，这里只负责「把变化画出来」。
       1 秒的粒度对「呼吸」够用，而且比订阅省事。 */
    const t = window.setInterval(() => {
      setDyn(isGroup ? NEUTRAL : readDynamic(String(conv)));
    }, 1000);
    return () => window.clearInterval(t);
  }, [conv, isGroup]);
  /*
   * 静态记忆 + 注入记忆。
   *
   * MEMORY 是 mock 里的美术素材；注入记忆是真实事件留下的痕迹
   * （比如「强制改名」）。两者合并显示 —— 注入的排最前，因为它最新。
   *
   * 新建的群（g2 / g3…）不在这两张表里，兜底成空数组，
   * 否则 .map / .length 会崩掉整个右栏。
   */
  /*
   * 记忆全部来自 3w:memories —— 唯一来源。
   *
   * 原来这里还要和 mock.ts 的 MEMORY 合并，那两套现在都没了：
   * mock 清空了，真实记忆统一写在 memoryNotes。
   *
   * 用一个 refreshKey 触发重读 —— 提权/忘掉之后要能立刻看到变化。
   */
  const [memRefresh, setMemRefresh] = useState(0);
  const memories = useMemo(
    () =>
      loadMemories(String(conv), true).map((m) => ({
        id: m.id,
        time: m.time,
        text: m.text,
        source: m.source,
        /*
         * confidence 现在是**当前有效权重**，不是初始值。
         *
         * 一条 0.9 的短期记忆放三天就掉到 0.3，
         * 卡片上的进度条和数字都会跟着变。
         */
        confidence: effectiveWeight(m),
        /** 0~1，给 UI 褪色用 */
        fresh: freshness(m),
        tag: m.tag,
        weight: m.weight,
        accessCount: m.accessCount ?? 0,
        forgotten: m.forgotten,
        suppressed: m.suppressed,
        /** 已搬进皮层 —— UI 上要和短期记忆区分开 */
        consolidated: isConsolidated(m),
        /**
         * 被造物主「铭刻」过。
         *
         * 和 consolidated 不同：
         *   consolidated  →  自然巩固（被提起来三次）
         *   imprinted     →  造物主手动钉进去
         *
         * 按钮文案必须看这个，**不是 suppressed**（那是「被压抑」）。
         */
        imprinted: m.reason === "milestone" && m.weight === 1,
        /** 时间偏移期间产生的 */
        fromTimeShift: m.fromTimeShift,
        fromEvent: true,
      })),
    [conv, memRefresh]
  );

  /*
   * ── 她眼里的你 ──
   *
   * 从记忆里摘出来，改写成她的口吻。
   *
   * 和上面那个 `memories` 的区别：
   *   memories    —— 全部记忆，按数据库的方式列出来（可操作）
   *   impressions —— 只挑 4 条，按「她先知道什么」排序，改写成她的话（只读）
   *
   * 为什么单独算：`memories` 里已经 map 成了 UI 结构，丢了原始 Memory。
   * 这里直接读 store，拿到干净的 Memory[]。
   */
  const impressions = useMemo(
    () => eyeOfYou(loadMemories(String(conv), false), 4),
    [conv, memRefresh]
  );
  /*
   * 快捷剧本 —— 真的。
   *
   * 之前是 `QUICK_ACTIONS[conv] ?? []` —— 出厂就是空的，一直是 0 条。
   *
   * 现在从 `3w:quick-scripts` 读，用户可改。
   */
  const { list: scripts, add: addScript, remove: removeScript, reset: resetScripts } = useScripts();

  const [tab, setTab] = useState<"memory" | "bonds" | "persona">("memory");
  /* 声音草稿 —— 失焦才落盘，和设置里那些输入一致 */
  const [voiceDraft, setVoiceDraft] = useState("");

  /* 换会话 → 声音草稿跟着换。不清的话会显示上一个角色的音色 */
  useEffect(() => {
    const p = AGENT_MAP[String(conv)];
    setVoiceDraft((p as unknown as { voice?: string })?.voice ?? "");
  }, [conv, AGENT_MAP]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [injected, setInjected] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);

  const keyOf = (i: number) => `${conv}-${i}`;
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      const k = keyOf(i);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const allOpen = memories.length > 0 && open.size >= memories.length;
  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(memories.map((_, i) => keyOf(i))));

  /* ── Base + Δ = Effective ── */
  const modifier = useMemo(
    () => (isGroup ? null : loadMockModifier(conv as PersonaId)),
    [conv, isGroup]
  );

  const profile = useMemo(
    () => (agent ? resolveProfile(agent.axes, modifier) : null),
    [agent, modifier]
  );

  const isInjected = !!injected[conv];

  const shownAxes: EmotionAxis[] = useMemo(() => {
    if (!profile) {
      // 群聊：用推导值（核心成员平均 + 场景修正），没有"人格注入"这回事
      return EMOTION[conv] ?? [];   /* EmotionAxis[] —— 空的雷达比崩掉好 */
    }
    const src = isInjected ? profile.effective : profile.base;
    return AXIS_ORDER.map((k) => ({ label: k, value: src[k], band: axisBand(k, src[k]) }));
  }, [profile, isInjected, conv]);

  const baseAxes: EmotionAxis[] | undefined = useMemo(() => {
    if (!profile || !isInjected) return undefined;
    return AXIS_ORDER.map((k) => ({ label: k, value: profile.base[k], band: axisBand(k, profile.base[k]) }));
  }, [profile, isInjected]);

  const dominant = useMemo(
    () => [...shownAxes].sort((a, b) => b.value - a.value)[0] ?? { label: "—", value: 0 },
    [shownAxes]
  );

  const bondList = isGroup ? BONDS : bondsOf(conv as PersonaId);

  /** 按降级链算出来的实际引擎 */
  const effectiveLevel = useMemo(() => resolveChain(engine).effective, [engine]);

  const doInject = () => {
    if (!modifier) return;
    setScanning(true);
    window.setTimeout(() => {
      setScanning(false);
      setInjected((p) => ({ ...p, [conv]: true }));
      onCommand({
        label: `已注入 ${modifier.deltas.length} 处人格修正`,
        hint: modifier.label,
        icon: "log",
        accent,
      });
    }, 720);
  };

  const TABS = [
    { k: "memory" as const, label: "记忆", n: memories.length },
    { k: "bonds" as const, label: "关系", n: bondList.length },
    { k: "persona" as const, label: "人格", n: modifier ? modifier.deltas.length : 0 },
  ];

  return (
    <div className="hud-blocks rail-sep grain relative flex min-h-0 flex-1 flex-col">
      {/* ═══ 标题 ═══ */}
      <div className="px-3.5 pb-2 pt-4">
        <div className="flex items-center gap-1.5">
          <span className="label">vitals</span>
          <span className="ml-auto flex items-center gap-1 font-mono text-[9.5px] text-mist/50">
            <span className="h-1 w-1 rounded-full bg-biolum/70 pulse-dot" />
            live
          </span>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="收起右侧栏"
              aria-label="收起右侧栏"
              className="-mr-1 ml-0.5 grid h-5 w-5 place-items-center rounded-[4px] text-mist/50 transition-colors hover:bg-white/[0.06] hover:text-ink/70"
            >
              <IconChevron size={11} className="rotate-180" />
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="h-[9px] w-[2px] rounded-full" style={{ background: accent }} />
          <span className="truncate text-[11.5px] text-ink/75">
            {isGroup ? `${groupName} · ${personas.length} 人` : `${agent!.name} · 专属档案`}
          </span>
        </div>
      </div>

      {/* ═══ 视图切换 ═══ */}
      <div className="mx-3.5 mb-2 flex items-center gap-1 rounded-lg border border-white/[0.055] bg-black/25 p-[3px]">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className="relative flex-1 rounded-[5px] py-[3px] text-[10px] transition-colors duration-200"
            style={{ color: tab === t.k ? "#e6f2fb" : "rgba(143,169,189,0.5)" }}
          >
            {tab === t.k && (
              <motion.span
                layoutId="god-tab"
                transition={{ type: "spring", stiffness: 460, damping: 36 }}
                className="absolute inset-0 rounded-[5px]"
                style={{
                  background: `linear-gradient(120deg, ${accent}1f, ${accent}0a)`,
                  border: `1px solid ${accent}30`,
                }}
              />
            )}
            <span className="relative">
              {t.label}
              {t.n > 0 && <span className="ml-[2px] opacity-55">{t.n}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="mx-3.5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ═══ 视图区 ═══ */}
      <BlockBoundary kind="sealed" name="MEMORY STREAM">
      <section className="flex min-h-0 flex-[1.2] flex-col px-3.5 pt-3">
        <AnimatePresence mode="wait" initial={false}>
          {tab === "memory" && (
            <motion.div
              key="memory"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              transition={{ duration: 0.24 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="label">memory stream</span>
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-1 rounded-[4px] px-1 py-[1px] font-mono text-[9.5px] text-mist/55 transition-colors hover:bg-white/[0.05] hover:text-biolum/80"
                >
                  {allOpen ? "收起" : "全部展开"}
                  <IconChevron
                    size={9}
                    className={`transition-transform duration-200 ${allOpen ? "rotate-90" : ""}`}
                  />
                </button>
              </div>

              <motion.div
                key={`mem-${conv}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="thin-scroll -mr-1.5 flex-1 space-y-2 overflow-y-auto pr-1.5 pb-1"
                style={{
                  maskImage: "linear-gradient(180deg, black 0%, black 90%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(180deg, black 0%, black 90%, transparent 100%)",
                }}
              >
                {memories.map((m, i) => {
                  const k = keyOf(i);
                  const isOpen = open.has(k);
                  return (
                    <motion.article
                      key={`${conv}-${m.time}-${i}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        opacity: { duration: 0.4, delay: 0.04 * i },
                        x: { duration: 0.4, delay: 0.04 * i },
                      }}
                      onClick={() => toggle(i)}
                      /*
                       * 三种状态，优先级：忘掉 > 注入记忆 > 普通
                       *
                       * 「忘掉」是整体淡下去 —— 她真的想不起来了，
                       * 卡片还在这里，但已经不参与任何对话。
                       */
                      /*
                       * ── 卡片亮度 = 记忆的新鲜度 ──
                       *
                       * 四档：
                       *   忘掉      → 0.30，几乎看不见
                       *   很淡 <0.3 → 0.55，像隔着雾
                       *   偏淡 <0.7 → 0.80
                       *   新鲜      → 1.00
                       *
                       * 除了整体透明度，还有三层递进：
                       *   · **边框**跟着变淡（0.7 以下才显出来）
                       *   · **模糊**（0.15 以下，像想不起来了）
                       *   · **文字灰度**（用 onText / onBorder 单独控制）
                       *
                       * 她真的记不住的东西，卡片自己也会暗下去。
                       */
                      style={{
                        opacity: m.forgotten
                          ? 0.3
                          : m.fresh < 0.3
                            ? 0.55
                            : m.fresh < 0.7
                              ? 0.8
                              : 1,
                        /* 淡到阈值以下再加一点模糊 —— 像想不起来了 */
                        filter:
                          !m.forgotten && m.fresh < 0.15
                            ? "blur(0.4px)"
                            : undefined,
                        /* 边框跟着淡 —— 比整体 opacity 更细一层 */
                        borderColor:
                          !m.forgotten && m.fresh < 0.5
                            ? "rgba(255,255,255,.03)"
                            : undefined,
                        ...("fromEvent" in m && m.fromEvent
                          ? {
                              borderLeftColor: "rgba(255,122,107,.55)",
                              borderLeftWidth: 2,
                              background: "rgba(255,122,107,.055)",
                            }
                          : {}),
                      }}
                      className="group relative cursor-pointer rounded-lg border border-white/[0.055] bg-white/[0.022] p-2 transition-colors duration-200 hover:border-white/[0.12] hover:bg-white/[0.04]"
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <span
                          className={`rounded-[3px] border px-[3.5px] py-[0.5px] text-[9.5px] leading-none ${TAG_STYLE[m.tag]}`}
                        >
                          {m.tag}
                        </span>
                        <span className="tabular text-[9.5px] text-mist/50">{m.time}</span>
                        <span className="ml-auto flex items-center gap-[3px]">
                          <span className="h-[2px] w-5 overflow-hidden rounded-full bg-white/10">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${m.confidence * 100}%`,
                                background: accent,
                                opacity: 0.75,
                              }}
                            />
                          </span>
                          <span className="tabular text-[9.5px] text-mist/58">
                            {m.confidence.toFixed(2)}
                          </span>
                          <IconChevron
                            size={9}
                            className={`transition-transform duration-300 ${
                              isOpen ? "rotate-90 text-biolum/60" : "text-mist/46"
                            }`}
                          />
                        </span>
                      </div>

                      <p
                        className={`text-[11px] leading-[1.55] text-ink/78 ${
                          isOpen ? "" : "line-clamp-2"
                        }`}
                      >
                        {m.text}
                      </p>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="mt-1.5 space-y-1 border-t border-white/[0.055] pt-1.5">
                              <div className="flex items-center justify-between font-mono text-[9.5px] text-mist/52">
                                <span className="flex items-center gap-1">
                                  {m.fromTimeShift && (
                                    <span
                                      title="这条记忆是在你拨动时间时产生的"
                                      className="rounded-[2px] px-1 py-[0.5px] text-[8.5px]"
                                      style={{
                                        background: "rgba(255,196,107,.1)",
                                        color: "rgba(255,196,107,.75)",
                                      }}
                                    >
                                      ⏱
                                    </span>
                                  )}
                                  {m.source}
                                </span>
                                {/*
                                  已巩固 = 搬进皮层了。
                                  它不再是一条「对话留下的印象」，而是她的一部分。
                                */}
                                <span className="flex items-center gap-1">
                                  {m.consolidated && (
                                    <span
                                      className="rounded-[2px] px-1 py-[0.5px] text-[8.5px]"
                                      style={{
                                        background: "rgba(53,240,206,.1)",
                                        color: "rgba(53,240,206,.7)",
                                      }}
                                    >
                                      已巩固
                                    </span>
                                  )}
                                  {LAYER[m.tag]}
                                </span>
                              </div>
                              <div className="flex items-center justify-between font-mono text-[9.5px] text-mist/48">
                                {/* 「想起过 N 次」—— 复习次数，不是命中数 */}
                                <span>
                                  想起过 {m.accessCount}
                                </span>
                                <span>权重 {Math.round(m.confidence * 100)}%</span>
                              </div>
                              {readMode() === "creator" && (
                              <div className="flex gap-1 pt-0.5">
                                {/*
                                  * 这两个按钮现在**真的改数据**。
                                  *
                                  * 之前它们只调 onCommand() —— 弹一句
                                  * 「记忆权重已提升」，然后什么也没发生。
                                  * 现在提权会真的加权重、忘掉会真的标记，
                                  * 而且两者都影响下一次对话的 prompt。
                                  */}
                                {/*
                                  ── 两个按钮，两种权限 ──

                                  **推演模式下它们是灰的。**

                                  有了遗忘曲线之后，这两个动作的语义变了：
                                    「忘掉」不再是整理 —— 自然遗忘要几天，一键归零是抹除
                                    「提权」不再是强调 —— 那是绕过遗忘，是洗脑

                                  两件事都不该由「一个只想和她说说话的人」来做。
                                */}
                                {/*
                                  **推演模式下这两行不存在。**
 
                                  不是灰掉、不是锁着 —— 是根本不渲染。
 
                                  理由：整个项目的隐藏原则是一致的 ——
                                  `creator` 不在 help 里、不在补全表里。那在 UI 上挂一个
                                  「造物主专属」的标签，等于贴了一张「这里有隐藏功能」的告示，
                                  自己拆自己的台。
 
                                  进造物主模式之后它们突然出现 —— 那正是「开了眼」的感觉。
                                */}
                                {readMode() !== "creator" ? null : m.forgotten ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      recallMemory(m.id);
                                      setMemRefresh((n) => n + 1);
                                      onCommand({
                                        label: "她又想起来了",
                                        hint: "这条重新进入她能想起的范围",
                                        icon: "log",
                                        accent: "#35f0ce",
                                      });
                                    }}
                                    className="flex-1 rounded-[5px] border border-white/[0.07] py-[3px] text-[10px] text-sim/70 transition-colors hover:border-sim/35"
                                  >
                                    捞回来
                                  </button>
                                ) : (
                                  <>
                                    {/* 铭刻 —— weight 锁 1.0，不衰减 */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        imprintMemory(m.id);
                                        setMemRefresh((n) => n + 1);
                                        onCommand({
                                          label: "已经刻进去了",
                                          hint: "这条记忆不会再淡，每次对话都在",
                                          icon: "log",
                                          accent: "#ff7a6b",
                                        });
                                      }}
                                      className={`flex-1 rounded-[5px] border py-[3px] text-[10px] transition-colors ${
                                        m.imprinted
                                          ? "border-white/[0.07] text-mist/45 hover:border-white/25"
                                          : "border-coral/30 bg-coral/[0.06] text-coral/80 hover:bg-coral/[0.12]"
                                      }`}
                                    >
                                      {/*
                                        看 imprinted，不看 suppressed。
                                        原来写成 suppressed —— 于是从没铭刻过的记忆
                                        一进来就显示「已铭刻」，骗人。
                                      */}
                                      {m.imprinted ? "已铭刻" : "铭刻"}
                                    </button>
                                    {/* 压抑 —— weight 压到 0.01，但会被关键词唤醒 */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        suppressMemory(m.id);
                                        setMemRefresh((n) => n + 1);
                                        onCommand({
                                          label: "已经压下去了",
                                          hint: "她够不着了 —— 但如果她碰到那个词，它会回来",
                                          icon: "broom",
                                          accent: "#8fa9bd",
                                        });
                                      }}
                                      className="flex-1 rounded-[5px] border border-white/[0.07] py-[3px] text-[10px] text-mist/45 transition-colors hover:border-white/25"
                                    >
                                      压抑
                                    </button>
                                  </>
                                )}
                              </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {!isOpen && (
                        <div className="mt-1 font-mono text-[9.5px] tracking-wide text-mist/46">
                          {m.source}
                        </div>
                      )}
                    </motion.article>
                  );
                })}
              </motion.div>
            </motion.div>
          )}

          {tab === "bonds" && (
            <motion.div
              key="bonds"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              transition={{ duration: 0.24 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {/*
                两栏内容放进**同一个滚动容器**。

                一开始把「她眼里的你」做成 `shrink-0` 的固定块放在外面，
                结果它把 bond network 挤到只剩几十像素 —— 一屏全是空的。

                现在两个都在这里一起滚：谁内容多谁占地方，不会互相挤。
              */}
              <div
                className="thin-scroll -mr-1.5 flex-1 space-y-3 overflow-y-auto pr-1.5 pb-1"
                style={{
                  maskImage: "linear-gradient(180deg, black 0%, black 90%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(180deg, black 0%, black 90%, transparent 100%)",
                }}
              >
                {/*
                  ── 她眼里的你 ──

                  **措辞是她的口吻**，不是「记忆 3：他买了什么」。
                  改写规则在 `src/lib/eyeOfYou.ts`。
                */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="label">她眼里的你</span>
                    <span className="font-mono text-[9.5px] text-mist/40">
                      {impressions.length > 0 ? `${impressions.length} 条` : "—"}
                    </span>
                  </div>

                  {impressions.length === 0 ? (
                    <div className="rounded-[6px] border border-white/[0.05] bg-white/[0.015] px-2.5 py-2.5">
                      <div className="text-[10px] leading-[1.7] text-mist/48">
                        她还没有关于你的印象。
                      </div>
                      <div className="mt-1 font-mono text-[9px] leading-[1.6] text-mist/30">
                        说点关于你自己的事 —— 「我不吃香菜」「我叫什么」
                        <br />
                        她记得的，会出现在这里
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-[3px]">
                      {impressions.map((it, i) => (
                        <motion.div
                          key={it.id}
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.26, delay: i * 0.05 }}
                          className="flex items-start gap-1.5"
                        >
                          <span className="mt-[5px] h-[3px] w-[3px] shrink-0 rounded-full bg-biolum/40" />
                          <span className="text-[10.5px] leading-[1.7] text-mist/72">
                            「{it.text}」
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label">bond network</span>
                    <span className="font-mono text-[9.5px] text-mist/48">
                      {isGroup ? "全局" : "仅相关"}
                    </span>
                  </div>
                  {bondList.length === 0 && (
                  <div className="px-1 py-6 text-center">
                    <div className="mx-auto mb-2.5 grid h-9 w-9 place-items-center rounded-full border border-white/[0.07] bg-white/[0.02] text-mist/46">
                      <IconTail size={14} />
                    </div>
                    <div className="text-[10px] leading-[1.6] text-mist/60">
                      {agent?.name ?? "这个角色"}还没有出现在任何关系里
                    </div>
                    <div className="mt-1.5 font-mono text-[9.5px] leading-[1.6] text-mist/44">
                      关系来自群聊里发生过的对话
                      <br />
                      私聊不会产生关系记录
                    </div>
                  </div>
                )}
                  {bondList.map((b, i) => (
                    <BondRow key={`${b.a}-${b.b}-${i}`} bond={b} self={conv} index={i} />
                  ))}
                  <div className="pt-1 text-center font-mono text-[9.5px] tracking-wider text-mist/44">
                    观察整理 · 非测量结果
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {tab === "persona" && (
            <motion.div
              key="persona"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              transition={{ duration: 0.24 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {isGroup ? (
                <div className="px-1 py-6 text-center text-[10px] leading-[1.7] text-mist/52">
                  群聊没有独立人格配置。
                  <br />
                  每个人的 Δ 在各自的私聊里注入。
                </div>
              ) : (
                <>
                  {/*
                    ── 声音 ──

                    服务商提供的音色名。**空着就用设置里的默认值。**

                    和「模型」同一个原则：软件不决定她的嗓子，
                    你自己填 —— 想给两个角色不同声音就填两个不同的。
                  */}
                  <div className="mb-2 rounded-[6px] border border-white/[0.055] bg-white/[0.015] px-2.5 py-2">
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="font-mono text-[9px] tracking-[0.08em] text-mist/40">
                        声音
                      </span>
                      <span className="font-mono text-[8.5px] text-mist/24">
                        空着用默认
                      </span>
                    </div>
                    <input
                      value={voiceDraft}
                      onChange={(e) => setVoiceDraft(e.target.value)}
                      onBlur={() => {
                        const id = String(conv);
                        if (voiceDraft.trim() !== (AGENT_MAP[id]?.voice ?? "")) {
                          updatePersona(id as never, { voice: voiceDraft.trim() || undefined } as never);
                        }
                      }}
                      placeholder={readTts().voice || "alloy"}
                      className="w-full rounded-[4px] border border-white/[0.05] bg-white/[0.012] px-2 py-[4px] font-mono text-[10px] text-ink/80 outline-none transition-colors placeholder:text-mist/22 focus:border-biolum/25"
                    />
                  </div>

                  <PersonaConfigPanel
                    modifier={modifier}
                    accent={accent}
                    onInject={doInject}
                    injected={isInjected}
                    scanning={scanning}
                    engineLevel={effectiveLevel}
                  />
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
      </BlockBoundary>

      <div className="mx-3.5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ═══ 情绪雷达（双层） ═══ */}
      <BlockBoundary kind="radar" name="AFFECT RADAR">
      <section className="relative shrink-0 px-3.5 pt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="label">affect radar</span>
          <span className="flex items-center gap-1 text-[10px]" style={{ color: accent }}>
            {dominant.label}
            <span className="tabular opacity-70">{dominant.value}</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2.2, repeat: Infinity }}
              className="h-[3px] w-[3px] rounded-full"
              style={{ background: accent }}
            />
          </span>
        </div>

        <div className="relative">
          {/* 注入时的扫描光 */}
          <AnimatePresence>
            {scanning && (
              <motion.div
                initial={{ top: "-6%", opacity: 0 }}
                animate={{ top: ["-6%", "104%"], opacity: [0, 0.9, 0.9, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.72, ease: "linear" }}
                className="pointer-events-none absolute inset-x-2 z-10 h-[16px]"
                style={{
                  background: `linear-gradient(180deg, transparent, ${accent}66, ${accent}aa, ${accent}66, transparent)`,
                  filter: "blur(1px)",
                }}
              />
            )}
          </AnimatePresence>

          <div className="mb-0.5 flex items-center gap-2.5 px-1 font-mono text-[9px] text-mist/46">
            <span className="flex items-center gap-1">
              <span className="h-[3px] w-[3px] rounded-full bg-biolum" />
              客观锚定
            </span>
            <span className="flex items-center gap-1">
              <span className="h-[3px] w-[3px] rounded-full bg-white/25" />
              风格描述
            </span>
            {baseAxes && (
              <span className="flex items-center gap-1">
                <span className="h-px w-2 border-t border-dashed border-white/40" />
                出厂基线
              </span>
            )}
          </div>

          <div className="-mx-1">
            <EmotionRadar
              axes={shownAxes}
              baseAxes={baseAxes}
              color={accent}
              conv={conv}
              mood={dyn.心情}
              /*
               * 她被判了日子 —— 数值不变，只是形状褪色。
               */
              doomed={!!deadlineOf(conv)}
            />
          </div>

          {/* ── 此刻状态：动态三轴，不进雷达图 ──
              雷达图是「他是什么样的人」，这几条是「他此刻怎么样」。
              混在一起画，用户会以为性格在变。 */}
          <div className="mt-2 space-y-[5px] border-t border-white/[0.05] pt-2">
            <div className="mb-[3px] font-mono text-[9.5px] tracking-[0.14em] text-mist/48">
              此刻
            </div>
            {DYNAMIC_ORDER.map((k) => {
              const v = dyn[k];
              const band = dynamicBand(k, v);
              return (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="w-[42px] shrink-0 text-[9.5px] text-mist/58">{k}</span>
                  <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ background: accent, opacity: 0.55 }}
                      initial={{ width: 0 }}
                      animate={{ width: `${v}%` }}
                      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <span
                    className="w-[62px] shrink-0 text-right font-mono text-[9.5px] tabular-nums whitespace-nowrap"
                    style={{ color: `${accent}cc` }}
                    title={
                      k === "记忆活性" && dyn.lastHits !== undefined
                        ? `上次回复唤醒了 ${dyn.lastHits} 层记忆`
                        : undefined
                    }
                  >
                    {band}
                    {k === "记忆活性" && dyn.lastHits !== undefined && (
                      /* 状态词是主信息（和上两行对齐），数字是副信息 */
                      <span className="ml-[3px] opacity-45">{dyn.lastHits}层</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 基础 + Δ = 最终 */}
        {profile && isInjected && (
          <div className="mt-1 space-y-[2px] px-1">
            {AXIS_ORDER.filter((k) => profile.breakdown[k].delta !== 0).map((k) => {
              const b = profile.breakdown[k];
              return (
                <motion.div
                  key={k}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-1.5 font-mono text-[9.5px]"
                >
                  <span className="w-[22px] shrink-0 text-mist/58">{k}</span>
                  <span className="tabular w-6 text-right text-mist/45">{b.base}</span>
                  <span
                    className="tabular w-8 text-right"
                    style={{ color: b.delta > 0 ? accent : "#ff7a6b" }}
                  >
                    {b.delta > 0 ? `+${b.delta}` : b.delta}
                  </span>
                  <span className="text-mist/42">=</span>
                  <span className="tabular text-ink/80">{b.eff}</span>
                </motion.div>
              );
            })}
          </div>
        )}

        {profile && !isInjected && (
          <div className="mt-0.5 px-1 text-[9.5px] leading-[1.5] text-mist/56">
            {modifier ? (
              <>
                当前为出厂基线。
                <span className="text-mist/46">「人格」页可注入 {modifier.deltas.length} 处修正</span>
              </>
            ) : (
              agent!.axisNote
            )}
          </div>
        )}
      </section>
      </BlockBoundary>

      <div className="mx-3.5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ═══ 快捷命令 ═══ */}
      <BlockBoundary kind="strike" name="QUICK CO{{ANDS">
      <section className="shrink-0 px-3.5 py-2.5">
        {/* 标题本身就是开关 —— 不用另找一个折叠按钮 */}
        <button
          onClick={() => setQuickOpen((v) => !v)}
          aria-expanded={quickOpen}
          aria-controls="god-quick-list"
          className="mb-1.5 flex w-full items-center justify-between rounded-[5px] py-[3px] text-left transition-colors hover:text-ink/70"
        >
          <span className="label">quick commands</span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[9.5px] text-mist/50">
              {quickOpen ? "收起" : `${scripts.length} 条`}
            </span>
            <IconArrow
              size={11}
              className={`text-mist/50 transition-transform duration-200 ${quickOpen ? "rotate-90" : ""}`}
            />
          </span>
        </button>

        <motion.div
          id="god-quick-list"
          initial={false}
          animate={{ height: quickOpen ? "auto" : 0, opacity: quickOpen ? 1 : 0 }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
        <div className="space-y-1">
          {scripts.length === 0 && (
            <div className="px-2 py-2 font-mono text-[9.5px] leading-relaxed text-mist/32">
              没有剧本。下面加一条。
            </div>
          )}
          {scripts.map((s) => (
            <motion.button
              key={s.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                if (s.prompt) {
                  const v = window.prompt(s.prompt);
                  if (!v?.trim()) return;
                  onScript({ label: s.label, text: v.trim() });
                } else {
                  onScript({ label: s.label, text: s.text });
                }
              }}
              className="group relative flex w-full items-center gap-2 overflow-hidden rounded-lg border border-transparent px-1.5 py-[5px] text-left transition-all duration-200 hover:border-white/[0.09] hover:bg-white/[0.04]"
            >
              <span
                className="absolute inset-y-0 left-0 w-[2px] origin-bottom scale-y-0 rounded-full transition-transform duration-200 group-hover:scale-y-100"
                style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
              />
              <span
                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] transition-transform duration-200 group-hover:scale-110 group-active:scale-95"
                style={{ background: `${accent}16`, color: accent }}
              >
                {s.prompt ? <IconPlus size={12} /> : <IconArrow size={12} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-ink/78 group-hover:text-ink">
                  {s.label}
                </span>
                <span className="block truncate font-mono text-[9.5px] text-mist/52">
                  {s.prompt ? "要先填一句" : s.text.slice(0, 26)}
                </span>
              </span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  removeScript(s.id);
                }}
                className="shrink-0 px-1 font-mono text-[10px] text-mist/0 transition-colors group-hover:text-mist/35 hover:!text-coral"
                title="删掉这条"
              >
                ✕
              </span>
            </motion.button>
          ))}
        </div>

        {/*
          加一条。
          
          两步：先起名，再写字。
          用 window.prompt 而不是自绘弹窗 —— 这个功能值是「省打字」，
          不是「有仪式感」。自绘一个反而挡住了。
        */}
        <button
          onClick={() => {
            const label = window.prompt("这条剧本叫什么？（2-6 个字）");
            if (!label?.trim()) return;
            const text = window.prompt("发出去的内容：");
            if (!text?.trim()) return;
            addScript({ label: label.trim().slice(0, 8), text: text.trim() });
          }}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.07] py-[5px] text-[10.5px] text-mist/55 transition-colors hover:border-biolum/30 hover:text-biolum/80"
        >
          <IconPlus size={11} />
          加一条剧本
        </button>

        <button
          onClick={() =>
            onCommand({
              label: "已清空本会话的短期记忆",
              hint: "L3 长期记忆不受影响",
              icon: "broom",
              accent: "#ff7a6b",
            })
          }
          className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.07] py-[5px] text-[10.5px] text-mist/55 transition-colors hover:border-coral/30 hover:text-coral/80"
        >
          <IconBroom size={11} />
          清空短期记忆
        </button>
        </motion.div>
      </section>
      </BlockBoundary>
    </div>
  );
}
