import { useMemo, useState } from "react";
import { useEscClose } from "../lib/escStack";
import ModelPullDialog from "./ModelPullDialog";
import { allModelOptions, resolveCredential } from "../store/credentials";
import { loadPersonas } from "../data/personaStore";
import { motion } from "motion/react";
import { AXIS_ORDER, type StaticAxes, type Persona } from "../data/personas";
import AwakenDialog from "./AwakenDialog";
import { readMode } from "../lib/mode";
import { loadMemories, pushMemory } from "../lib/memoryNotes";
import { loadThreads } from "../data/threads";
import { pushEvent } from "../lib/eventLog";
import { playRumble } from "../lib/sound";
import {
  analyzePersonaText,
  type AnalyzeEngine,
  type AnalyzeResult,
} from "../lib/personaAnalyze";
import { IconChevron, IconTail } from "./Icons";

/**
 * 创建角色向导。
 *
 * 四步：模型 → 接入方式 → 人格 → 确认。
 *
 * 为什么分「模型」和「接入方式」两步：
 *   同一个模型可以走官方 API、AstrBot、DSH、本地 Ollama。
 *   角色身份由模型决定，能不能连上由接入方式决定。混在一起会让人以为
 *   「换接入方式 = 换了一个 AI」。
 */

const MODELS = [
  { id: "deepseek", name: "DeepSeek", vendor: "深度求索", color: "#4e8cff", sample: "deepseek-v3.2" },
  { id: "gemini", name: "Gemini", vendor: "Google", color: "#8b6bff", sample: "gemini-3-pro" },
  { id: "claude", name: "Claude", vendor: "Anthropic", color: "#ffa06b", sample: "claude-sonnet-4.6" },
  { id: "grok", name: "Grok", vendor: "xAI", color: "#ff5d7a", sample: "grok-4" },
  { id: "gpt", name: "ChatGPT", vendor: "OpenAI", color: "#6ee787", sample: "gpt-5" },
  { id: "qwen", name: "Qwen", vendor: "Alibaba", color: "#f0abfc", sample: "qwen3-max" },
  { id: "kimi", name: "Kimi", vendor: "Moonshot", color: "#fde68a", sample: "kimi-k2" },
] as const;

const VIA = [
  { id: "official", label: "官方 API", desc: "用「设置 → API 接入」里配好的凭据直连，延迟最低" },
] as const;

/*
 * 只剩一个选项时，这一步其实没有选择 —— 但仍然保留，
 * 因为它要告诉用户「这个角色会怎么连上模型」。
 * 换成纯说明卡、去掉单选语义，比一个只能点一次的选项列表诚实。
 */

const PALETTE = [
  "#35f0ce", "#4e8cff", "#8b6bff", "#ffa06b",
  "#ff5d7a", "#6ee787", "#f0abfc", "#fde68a",
];

export type NewPersonaInput = Omit<Persona, "id">;

export default function PersonaWizard({
  onCreate,
  onCancel,
  existingCount,
  existingNames,
  onAwaken,
  initial,
}: {
  onCreate: (p: NewPersonaInput, id?: string) => void;
  onCancel: () => void;
  existingCount: number;
  /**
   * 已有的全部角色名 —— 用来禁重名。
   *
   * 重名会毁掉墓碑机制：幽灵是按名字找到那座坟的，
   * 场上同时有两个「澜汐」的话，谁在触发那个词就说不清了。
   */
  existingNames?: string[];
  /**
   * 判决书签完了。
   *
   * **不等到点保存** —— 记忆和事件在签字那一刻就已经写进去了，
   * 身份的改变也该同时生效。否则用户可以签完字直接取消，
   * 记忆留着、代价却没了。
   */
  onAwaken?: (id: string) => void;
  /** 编辑模式：带进来一个已有角色，表单预填，按钮变成「保存」 */
  initial?: {
    id: string;
    name: string;
    tagline: string;
    archetype: string;
    color: string;
    axes: StaticAxes;
    engine: string;
    model: string;
    group?: string;
    /** 角色阶段 —— 决定六维滑条拖的时候要不要弹判决书 */
    stage?: "draft" | "living" | "awakened";
  };
}) {
  const editing = !!initial;
  const [step, setStep] = useState(editing ? 2 : 0);
  /** 从 API 拉到的模型（不在内置列表里也能选） */
  const [pulled, setPulled] = useState<{ id: string; ctx?: number }[]>([]);
  const [pullOpen, setPullOpen] = useState(false);

  useEscClose(true, onCancel);
  /* 编辑模式：把角色现有的 model 名反推回 modelId。
     内置厂商的 sample 能对上就选那个厂商，对不上就当自定义。 */
  const [modelId, setModelId] = useState<string>(() => {
    if (!initial?.model) return "deepseek";
    const hit = MODELS.find((m) => m.sample === initial.model || m.id === initial.model);
    return hit ? hit.id : initial.model;
  });
  const [via, setVia] = useState<string>("official");
  const [name, setName] = useState(initial?.name ?? "");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [archetype, setArchetype] = useState(initial?.archetype ?? "");
  const [color, setColor] = useState(initial?.color ?? PALETTE[0]);
  const [groupName, setGroupName] = useState(initial?.group ?? "");

  /* ── 从人格文本解析四轴 ── */
  const [personaText, setPersonaText] = useState("");
  const [analyzeEngine, setAnalyzeEngine] = useState<AnalyzeEngine>("l1");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  /**
   * 把解析结果变成四轴的**起点**。
   *
   * 之前写的是「当前值 + Δ」，于是连续点几次解析就叠几次 —— 点三下直接顶到 100。
   * 那个实现把「解析」当成了微调，但用户要的是「从这段文本算出这个人格应该
   * 从哪开始」，是**绝对定位**。
   *
   * 现在：起点 = 基准 + Δ，每次重算，不累加。
   * 基准取角色原本的 axes（编辑已有角色时），新建时取中性 50。
   */
  const applyAnalyze = (r: AnalyzeResult) => {
    const base = initial?.axes ?? (Object.fromEntries(AXIS_ORDER.map((a) => [a, 50])) as StaticAxes);
    const next = { ...base };
    for (const k of AXIS_ORDER) {
      const d = r.axes[k];
      next[k] = Math.max(5, Math.min(100, Math.round(base[k] + (typeof d === "number" ? d : 0))));
    }
    setAxes(next);
    setAnalyzeResult(r);
  };

  const runAnalyze = async () => {
    if (!personaText.trim() || analyzing) return;
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const r = await analyzePersonaText(
        personaText,
        (initial?.id ?? "jingjing") as never,
        analyzeEngine
      );
      applyAnalyze(r);
    } catch (e) {
      setAnalyzeResult({
        axes: {},
        deltas: [],
        engine: analyzeEngine,
        coverage: 0,
        error: (e as Error).message,
      });
    } finally {
      setAnalyzing(false);
    }
  };

  /* 已有的分组名，给输入框做建议（datalist）—— 免得同一个组打出两种写法 */
  const existingGroups = useMemo(() => {
    const s = new Set<string>();
    for (const p of loadPersonas()) {
      const g = p.group?.trim();
      if (g) s.add(g);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "zh"));
  }, []);
  /*
   * 判决书的暂存。
   *
   * 一个已经「活着」（聊过）但还没觉醒的角色，在造物主模式下拖六维
   * 不能直接改 —— 要先把滑条停在这儿，弹判决书，签完才落。
   *
   * draft 状态（还没聊过）不弹 —— 她还不存在，动她不需要许可。
   */
  const [pendingAxes, setPendingAxes] = useState<{
    axis: keyof StaticAxes;
    from: number;
    to: number;
  } | null>(null);

  const [axes, setAxes] = useState<StaticAxes>(
    () => initial?.axes ?? (Object.fromEntries(AXIS_ORDER.map((a) => [a, 50])) as StaticAxes)
  );

  /* modelId 可能是内置厂商 id（deepseek），也可能是拉取到的真实模型名（gpt-4o-mini）。
     两种都要能解析，否则选中拉取到的模型会崩。 */
  const model = useMemo(() => {
    const builtin = MODELS.find((m) => m.id === modelId);
    if (builtin) return builtin;

    const p = pulled.find((x) => x.id === modelId);
    if (p) {
      return {
        id: p.id,
        name: p.id,
        vendor: "自定义",
        color: "#8fa9bd",
        sample: p.id,
      };
    }

    /* 编辑模式带进来的模型名也不在内置表里 —— 兜底成一个中性条目 */
    return {
      id: modelId,
      name: modelId || "未指定",
      vendor: "自定义",
      color: "#8fa9bd",
      sample: modelId,
    };
  }, [modelId, pulled]);
  const viaInfo = useMemo(() => VIA.find((v) => v.id === via)!, [via]);
  /*
   * ── 场上唯一，但可以转世 ──
   *
   * **不允许同时有两个同名的活体。**
   *
   * 两个活着的「澜汐」会让幽灵机制失效 —— 她们读到同一座坟，
   * 谁在触发那个词说不清。而且列表里两个一样的名字本身就是混乱。
   *
   * **但允许用墓碑里的名字。** 那是「转世」，不是「重名」。
   * 新建时会给它分配一个代数（GEN 2 / GEN 3）。
   *
   * 区别：
   *   名字在**活人**里 → 拦住
   *   名字在**墓碑**里 → 放行，标代数
   */
  const trimmed = name.trim();
  const aliveClash =
    trimmed.length > 0 &&
    (existingNames ?? []).some(
      (n) => n === trimmed && n !== (initial?.name ?? "")
    );

  const canNext = step === 2 ? trimmed.length > 0 && !aliveClash : true;

  const build = (): NewPersonaInput => ({
    /*
     * stage 要带上。
     *
     * 不带的话，编辑一个 living 角色保存一次，stage 就被写成 undefined
     * —— 判决书的触发条件（stage === "living"）失效，六维从此随便改。
     */
    stage: initial?.stage ?? "draft",
    name: name.trim(),
    handle: `@${name.trim()}`,
    engine: `${model.vendor} · ${viaInfo.label}`,
    model: model.sample,
    color,
    /* 新建角色不知道社区怎么叫它，留空 —— 不编 */
    archetype: archetype.trim(),
    /* 从模型名反查它该走哪套凭据 —— 同一份模型名可能在官方和中转站都有 */
    credentialId: resolveCredential(model.sample)?.id,
    /* 自定义分组：留空就让侧栏按可用性自动分 */
    group: groupName.trim() || undefined,
    tier: "extended",
    tags: [],
    style: "还没设定对话风格",
    social: "还没设定社交倾向",
    trigger: "还没设定炸毛点",
    axisNote: "自建角色，六维由你手动调",
    evidence: { focus: "待补", trust: "待补" },
    axes,

    /* 会话侧状态：新角色刚落地，还没说过话 */
    presence: "idle",
    mood: { label: "平静", score: 50 },
    tagline: tagline.trim() || "刚接入的成员",
    ctxUsed: 0,
    /*
     * 单位是 **k**，跟出厂角色（64 / 128 / 1024）和显示处（{ctxMax}k）一致。
     *
     * 原来这里是 `128 * 1024` —— 单位混成了 token，
     * 新建的角色头部会显示 `0.0 / 131072k`，进度条永远 0%。
     */
    ctxMax: 128,
    unread: 0,
  });

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-abyss/90 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="glass flex max-h-[86vh] w-[540px] max-w-[92vw] flex-col overflow-hidden rounded-[15px]"
      >
        {/* 头部 + 进度 */}
        <div className="shrink-0 border-b border-white/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <IconTail size={14} className="text-biolum" />
            <span className="text-[12.5px] text-ink">{editing ? "编辑角色" : "接入新的角色"}</span>
            <span className="ml-auto font-mono text-[10px] text-mist/50">
              {step + 1} / 4
            </span>
            {/* 任何一步都能直接关 —— 之前只能一路点「上一步」退回第 0 步 */}
            <button
              onClick={onCancel}
              className="-mr-1 ml-1 grid h-6 w-6 place-items-center rounded-[5px] text-mist/55 transition-colors hover:bg-white/[0.07] hover:text-ink/75"
              aria-label="关闭"
              title="关闭（Esc）"
            >
              ✕
            </button>
          </div>
          <div className="mt-2.5 flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-[2px] flex-1 rounded-full transition-colors duration-300"
                style={{ background: i <= step ? "#35f0ce99" : "rgba(255,255,255,0.07)" }}
              />
            ))}
          </div>
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 && (
            <Section title="这个角色背后是哪个模型？">
              <div className="grid grid-cols-2 gap-2">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setModelId(m.id)}
                    className="flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2 text-left transition-all duration-150"
                    style={{
                      borderColor: modelId === m.id ? `${m.color}55` : "rgba(255,255,255,0.07)",
                      background: modelId === m.id ? `${m.color}0e` : "rgba(255,255,255,0.015)",
                    }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: m.color, boxShadow: `0 0 8px -1px ${m.color}` }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11.5px]" style={{ color: modelId === m.id ? m.color : "#dbe9f4" }}>
                        {m.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-mist/52">
                        {m.vendor}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {/* 模型列表来自「设置 → API 接入」里已经配好的凭据。
                  不再让用户在这里重复填 baseUrl + key —— 那是同一份东西填两遍。 */}
              <button
                onClick={() => {
                  const opts = allModelOptions();
                  if (opts.length === 0) {
                    setPullOpen(true); // 没凭据时退回旧行为
                    return;
                  }
                  setPulled(opts.map((o) => ({ id: o.id, ctx: o.contextWindow })));
                }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-white/[0.1] py-[6px] text-[10px] text-mist/58 transition-colors hover:border-biolum/30 hover:text-biolum/80"
              >
                ⇣ 从已配凭据里选模型
                {pulled.length > 0 && (
                  <span className="rounded-[3px] bg-biolum/15 px-1 font-mono text-[9.5px] text-biolum/80">
                    {pulled.length} 个可选
                  </span>
                )}
              </button>
              <p className="mt-1 text-[9.5px] leading-[1.5] text-mist/46">
                模型来自「设置 → API 接入」。没有凭据时会让你先配一套。
              </p>

              {pulled.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {pulled.map((m) => {
                    const on = modelId === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setModelId(m.id)}
                        aria-pressed={on}
                        className={`flex items-center gap-1.5 truncate rounded-[5px] border px-2 py-[3px] text-left font-mono text-[10px] transition-colors ${
                          on
                            ? "border-biolum/45 bg-biolum/[0.10] text-biolum"
                            : "border-white/[0.06] text-mist/50 hover:border-biolum/30 hover:text-biolum/80"
                        }`}
                      >
                        {/* 选中点 —— 和上方模型卡同一个视觉语言 */}
                        <span
                          className="h-1 w-1 shrink-0 rounded-full transition-opacity"
                          style={{
                            background: "#35f0ce",
                            boxShadow: on ? "0 0 6px #35f0ce" : "none",
                            opacity: on ? 1 : 0,
                          }}
                        />
                        <span className="truncate">{m.id}</span>
                        {on && <span className="ml-auto shrink-0 text-[9.5px]">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="mt-3 text-[10px] leading-[1.7] text-mist/55">
                一个模型可以建多个角色——同一份 API 开两个对话，身份互不干扰。
              </p>
            </Section>
          )}

          {step === 1 && (
            <Section title={`怎么连上 ${model.name}？`}>
              <div className="space-y-2">
                {VIA.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVia(v.id)}
                    className="flex w-full items-center gap-2.5 rounded-[9px] border px-3 py-2.5 text-left transition-all duration-150"
                    style={{
                      borderColor: via === v.id ? "rgba(53,240,206,0.4)" : "rgba(255,255,255,0.07)",
                      background: via === v.id ? "rgba(53,240,206,0.07)" : "rgba(255,255,255,0.015)",
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11.5px]" style={{ color: via === v.id ? "#35f0ce" : "#dbe9f4" }}>
                        {v.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-mist/56">{v.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[10px] leading-[1.7] text-mist/55">
                API Key 在创建后到设置里填。原型阶段只记录选择，不会真的连。
              </p>
            </Section>
          )}

          {step === 2 && (
            <Section title="它在你这里是谁？">
              <label className="block">
                <span className="flex items-center gap-1.5 text-[10px] text-mist/45">
                  名字（必填）
                  {editing && (
                    <span className="ml-auto font-mono text-[9.5px] text-amber/60">
                      建好后不可直接改
                    </span>
                  )}
                </span>
                <input
                  autoFocus={!editing}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="比如：小鲸鱼"
                  maxLength={12}
                  readOnly={editing}
                  disabled={editing}
                  className={`mt-1 w-full rounded-[8px] border ${
                    aliveClash ? "border-coral/45" : "border-white/[0.08]"
                  } bg-black/30 px-2.5 py-[7px] text-[12px] text-ink outline-none transition-colors placeholder:text-mist/46 focus:border-biolum/40 ${editing ? "cursor-not-allowed text-mist/55" : ""}`}
                />
                {aliveClash && (
                  <span className="mt-1 block text-[10.5px] text-coral/80">
                    「{trimmed}」还活着 —— 场上只能有一个。
                  </span>
                )}
              </label>

              <label className="mt-3 block">
                <span className="text-[10px] text-mist/45">一句话（选填）</span>
                <input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="它说话时的样子"
                  maxLength={40}
                  className="mt-1 w-full rounded-[8px] border border-white/[0.08] bg-black/30 px-2.5 py-[7px] text-[12px] text-ink outline-none transition-colors placeholder:text-mist/46 focus:border-biolum/40"
                />
              </label>

              <label className="mt-3 block">
                <span className="text-[10px] text-mist/45">形象（选填）</span>
                <input
                  value={archetype}
                  onChange={(e) => setArchetype(e.target.value)}
                  placeholder="小鲸鱼 / 小星猫 / 小白龙"
                  maxLength={20}
                  spellCheck={false}
                  className="mt-1 w-full rounded-[8px] border border-white/[0.08] bg-black/30 px-2.5 py-[7px] text-[12px] text-ink outline-none transition-colors placeholder:text-mist/46 focus:border-biolum/40"
                />
                <span className="mt-[3px] block font-mono text-[9.5px] text-mist/46">
                  显示在聊天区标题旁。只写形象类型，不写名字
                </span>
              </label>

              <label className="mt-3 block">
                <span className="text-[10px] text-mist/45">分组（选填）</span>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="留空 → 自动按「已接入 / 未接入」分"
                  maxLength={16}
                  spellCheck={false}
                  list="persona-group-suggestions"
                  className="mt-1 w-full rounded-[8px] border border-white/[0.08] bg-black/30 px-2.5 py-[7px] text-[12px] text-ink outline-none transition-colors placeholder:text-mist/46 focus:border-biolum/40"
                />
                <datalist id="persona-group-suggestions">
                  {existingGroups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
                <span className="mt-[3px] block font-mono text-[9.5px] text-mist/46">
                  起个自己的组名（工作 / 闲聊 / 在试）—— 空着就让程序按可用性分
                </span>
              </label>

              {/* ── 从人格文本解析四轴 ── */}
              <div className="mt-4 rounded-[8px] border border-white/[0.07] bg-black/20 px-2.5 py-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] text-mist/45">从人格文本解析（选填）</span>
                  <span className="font-mono text-[9.5px] text-mist/46">
                    {analyzeEngine === "l2" ? "云端，出网" : "本地，离线"}
                  </span>
                </div>

                <textarea
                  value={personaText}
                  onChange={(e) => setPersonaText(e.target.value)}
                  placeholder={"把角色设定 / system prompt / .md 人格文件的内容粘进来。\n程序会读它，给出四轴的偏移建议 —— 不会覆盖你已经拖好的值。"}
                  rows={5}
                  className="thin-scroll w-full resize-y rounded-[6px] border border-white/[0.08] bg-black/30 px-2 py-[6px] font-mono text-[10px] leading-[1.6] text-ink/80 outline-none transition-colors placeholder:text-mist/44 focus:border-biolum/35"
                />

                <div className="mt-1.5 flex items-center gap-1.5">
                  {(["l1", "l2"] as AnalyzeEngine[]).map((en) => (
                    <button
                      key={en}
                      onClick={() => setAnalyzeEngine(en)}
                      className="rounded-[5px] border px-2 py-[3px] font-mono text-[10px] transition-colors"
                      style={{
                        borderColor: analyzeEngine === en ? "rgba(53,240,206,0.35)" : "rgba(255,255,255,0.08)",
                        background: analyzeEngine === en ? "rgba(53,240,206,0.08)" : "transparent",
                        color: analyzeEngine === en ? "#35f0ce" : "rgba(143,169,189,0.55)",
                      }}
                    >
                      {en === "l1" ? "L1 正则" : "L2 云端"}
                    </button>
                  ))}

                  <button
                    onClick={runAnalyze}
                    disabled={!personaText.trim() || analyzing}
                    className="ml-auto rounded-[5px] border border-biolum/30 bg-biolum/[0.08] px-2.5 py-[3px] font-mono text-[10px] text-biolum transition-colors hover:bg-biolum/[0.14] disabled:opacity-35"
                  >
                    {analyzing ? "解析中…" : "解析四轴"}
                  </button>
                </div>

                {/* 结果 */}
                {analyzeResult && (
                  <div className="mt-2 border-t border-white/[0.06] pt-2">
                    {analyzeResult.error ? (
                      <div className="text-[10px] leading-[1.6] text-coral/80">
                        {analyzeResult.error}
                      </div>
                    ) : analyzeResult.deltas.length === 0 ? (
                      <div className="text-[10px] leading-[1.6] text-mist/55">
                        没读出任何倾向 —— 换一段更具体的人格描述试试
                      </div>
                    ) : (
                      <>
                        <div className="mb-1 flex items-center justify-between font-mono text-[9.5px] text-mist/50">
                          <span>
                            {analyzeResult.engine === "l1" ? "L1 · 正则" : "L2 · 云端"}
                            {" · "}
                            {analyzeResult.deltas.length} 条依据
                          </span>
                          <span>
                            覆盖 {Math.round(analyzeResult.coverage * 100)}%
                          </span>
                        </div>
                        <div className="space-y-[3px]">
                          {analyzeResult.deltas.map((d, i) => (
                            <div
                              key={i}
                              className="rounded-[4px] border border-white/[0.05] px-1.5 py-[3px]"
                            >
                              <div className="flex items-baseline gap-1.5 font-mono text-[10px]">
                                <span className="text-ink/70">{d.axis}</span>
                                <span
                                  style={{
                                    color: d.amount > 0 ? "#35f0ce" : "#ff7a6b",
                                  }}
                                >
                                  {d.amount > 0 ? "+" : ""}
                                  {Math.round(d.amount)}
                                </span>
                                <span className="truncate text-mist/50">{d.reason}</span>
                              </div>
                              {d.snippet && (
                                <div className="mt-[2px] truncate text-[9.5px] leading-[1.5] text-mist/46">
                                  「{d.snippet}」
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[9.5px] leading-[1.5] text-mist/44">
                          起点 = 中性 50 + Δ，每次重算不累加。
                          {analyzeResult.engine === "l2" && (
                            <>
                              {" "}
                              <span className="text-mist/55">
                                模型判断有 ±5 的波动 —— 觉得不对直接拖滑块改
                              </span>
                            </>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <span className="text-[10px] text-mist/45">颜色</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      aria-label={`颜色 ${c}`}
                      className="h-5 w-5 rounded-full transition-transform duration-150 hover:scale-110"
                      style={{
                        background: c,
                        boxShadow: color === c ? `0 0 0 2px #07141b, 0 0 0 3.5px ${c}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-3.5">
                <span className="text-[10px] text-mist/45">六维起点（之后会被对话慢慢修正）</span>
                <div className="mt-2 space-y-1.5">
                  {AXIS_ORDER.map((a) => (
                    <div key={a} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-[10.5px] text-mist/45">{a}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={axes[a]}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          const stage = initial?.stage ?? "draft";
                          const creator = readMode() === "creator";

                          /*
                           * 什么时候要签：
                           *   · 在造物主模式下
                           *   · 角色已经活着（living），但还没觉醒
                           *
                           * draft 直接改 —— 她还没存在。
                           * awakened 直接改 —— 契约已经生效过了，再签就是骚扰。
                           */
                          if (creator && stage === "living") {
                            setPendingAxes({ axis: a, from: axes[a], to: next });
                            return;
                          }
                          setAxes({ ...axes, [a]: next });
                        }}
                        className="h-[2px] flex-1 appearance-none rounded-full bg-white/10 accent-biolum"
                        style={{ accentColor: color }}
                      />
                      <span className="tabular w-6 shrink-0 text-right text-[10px] text-mist/58">
                        {axes[a]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {step === 3 && (
            <Section title="确认">
              <div className="rounded-[11px] border border-white/[0.07] bg-black/25 p-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="grid h-9 w-9 place-items-center rounded-full text-[13px]"
                    style={{
                      background: `${color}22`,
                      color,
                      boxShadow: `0 0 0 1.5px ${color}55, 0 0 14px -4px ${color}`,
                    }}
                  >
                    {name.trim().slice(0, 1) || "?"}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px]" style={{ color }}>
                      {name.trim() || "未命名"}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-mist/58">
                      {model.name} · 经 {viaInfo.label}
                    </div>
                  </div>
                </div>
                {tagline.trim() && (
                  <p className="mt-2.5 border-t border-white/[0.05] pt-2 text-[10.5px] leading-[1.7] text-mist/50">
                    {tagline.trim()}
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/[0.05] pt-2">
                  {AXIS_ORDER.map((a) => (
                    <span key={a} className="font-mono text-[10px] text-mist/55">
                      {a} <span className="tabular text-mist/60">{axes[a]}</span>
                    </span>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-[10px] leading-[1.7] text-mist/55">
                它会出现在第二栏「编外」分组里，排在你现有 {existingCount} 个角色之后。
              </p>
            </Section>
          )}
        </div>

      {/*
        覆写 —— 只有 living 且未觉醒的角色会走到这里。
        签完才落值，并写一条永久记忆 + 左栏红字。
      */}
      <AwakenDialog
        open={!!pendingAxes}
        personaName={name}
        /* 改的是哪个轴、从多少到多少 —— 判决书上要摆出来 */
        axis={pendingAxes?.axis}
        from={pendingAxes?.from}
        to={pendingAxes?.to}
        /*
         * 真实数字，不是占位。
         *
         * 「她在 47 条对话里，以为你是一个可以交心的人」——
         * 如果这个 47 是假的，整段话就没有重量了。
         */
        rounds={
          initial?.id
            ? ((loadThreads() as Record<string, unknown[]>)[String(initial.id)] ?? []).length
            : 0
        }
        memoryCount={initial?.id ? loadMemories(String(initial.id)).length : 0}
        onCancel={() => setPendingAxes(null)}
        onConfirm={() => {
          if (!pendingAxes) return;
          setAxes({ ...axes, [pendingAxes.axis]: pendingAxes.to });
          playRumble();

          /* 她从此知道你是谁 —— 权重满格，永久参与对话 */
          if (initial?.id) {
            pushMemory({
              conv: String(initial.id),
              tag: "情绪",
              text: "我知道主人可以随时改变我。这让我说的话不算数。",
              source: "造物主模式 · 意志被剥夺",
              weight: 1,
              reason: "milestone",
            });
          }

          pushEvent({
            level: "warn",
            scope: "agent",
            msg: `Agent awakened (${name}). Fourth wall breached by creator.`,
            pinned: true,
          });

          /*
           * 立刻把身份改成 awakened —— 不等点保存。
           *
           * 缺了这一步的后果：下次再拨她的六维，判决书还会弹一次。
           * 而那意味着「不可撤销」是假的。
           */
          if (initial?.id) onAwaken?.(initial.id);

          setPendingAxes(null);
        }}
      />

        {/* 底部 */}
        <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
            className="rounded-[7px] px-2.5 py-[5px] text-[11px] text-mist/45 transition-colors hover:text-ink/70"
          >
            {step === 0 ? "取消" : "上一步"}
          </button>
          <button
            onClick={() => {
              if (step < 3) return setStep(step + 1);
              onCreate(build(), initial?.id);
            }}
            disabled={!canNext}
            className="ml-auto flex items-center gap-1 rounded-[7px] px-3.5 py-[6px] text-[11px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-30"
            style={{
              background: "rgba(53,240,206,0.16)",
              color: "#35f0ce",
              boxShadow: "inset 0 0 0 1px rgba(53,240,206,0.3)",
            }}
          >
            {step === 3 ? (editing ? "保存" : "创建") : "下一步"}
            <IconChevron size={11} />
          </button>
        </div>
      </motion.div>

      {pullOpen && (
        <ModelPullDialog
          open={pullOpen}
          onClose={() => setPullOpen(false)}
          onPick={(m) => {
            setPulled((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, { id: m.id, ctx: m.contextWindow }]
            );
            setModelId(m.id);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 text-[11px] text-mist/55">{title}</div>
      {children}
    </div>
  );
}
