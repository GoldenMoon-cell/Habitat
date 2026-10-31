/**
 * 环境感知与动态人格修正（Context-Aware Persona Modifier）
 *
 * ┌ Base Stats ─────────────────────────────────────────────┐
 * │ personas.ts 里的 axes：出厂基线，来自公开评测，不可变。 │
 * └───────────────────────┬────────────────────────────────┘
 *                         │  +  Δ
 * ┌ Modifier ─────────────▼────────────────────────────────┐
 * │ 人格配置文件（本地 .md / AstrBot system_prompt / DSH）  │
 * │ → analyzePersonaConfig() → 每轴 Δ，且每条 Δ 带证据      │
 * └───────────────────────┬────────────────────────────────┘
 *                         │  resolve
 * ┌ Effective ────────────▼────────────────────────────────┐
 * │ clamp(base + ΣΔ) —— 同时保留 breakdown 供 UI 展示       │
 * └────────────────────────────────────────────────────────┘
 *
 * 四条硬约束（不满足就会退化成黑箱）：
 *
 *  1. Base 永不被覆盖。只有 Δ，才回答得了「这个 AI 被定制了多少」。
 *  2. 每个 Δ 必须能追到原文片段。没有 snippet 的修正是耍流氓。
 *  3. 单轴 Δ 有上限（±28），多点命中按 1/√n 递减。
 *     写一百遍「黏人」不该变成 +500。
 *  4. 读不到配置就显式降级为「未配置」，不静默回退到 0。
 */

import { AXIS_ORDER, type StaticAxes, type AxisName, type PersonaId } from "./personas";

/* ══════════════════════════════════════════════════════════════
   类型
   ══════════════════════════════════════════════════════════════ */

export type ModifierSource = "local" | "astrbot" | "dsh" | "none";

/** 一条修正：哪一轴、多少、为什么 */
export interface AxisDelta {
  axis: AxisName;
  /** 单条规则的原始增量，已含符号 */
  amount: number;
  /** 命中的规则名，人话 */
  reason: string;
  /** 原文片段（截断），用于「凭什么」 */
  snippet: string;
}

/** 一份已解析的人格配置 */
export interface PersonaModifier {
  personaId: PersonaId;
  label: string;
  source: ModifierSource;
  /** 本地路径或 API 端点，用于展示与刷新 */
  origin: string;
  /** 内容指纹：人格文件改了，这里会变 */
  hash: string;
  chars: number;
  loadedAt: string;
  /** 原始命中明细 */
  deltas: AxisDelta[];
  /** 合并后的每轴净增量 */
  byAxis: Partial<StaticAxes>;
  /** 命中覆盖率 0-1，让 UI 能说「这份配置的 62% 被识别了」 */
  coverage: number;
}

/** 合成结果 */
export interface EffectiveProfile {
  base: StaticAxes;
  modifier: PersonaModifier | null;
  effective: StaticAxes;
  breakdown: Record<AxisName, { base: number; delta: number; eff: number }>;
}

/* ══════════════════════════════════════════════════════════════
   规则表：关键词 → (轴, 权重)
   第一阶段用正则，够用且完全可解释。
   第二阶段换成小模型语义提取时，这个表就是 gold set。
   ══════════════════════════════════════════════════════════════ */

interface Rule {
  pattern: RegExp;
  axis: AxisName;
  amount: number;
  reason: string;
}

const RULES: Rule[] = [
  /* ── 依附表达 → 共鸣（会先接住对方）── */
  { pattern: /黏人|粘人|要抱抱|抱抱|别走|陪我|不要离开|离不开/, axis: "共鸣", amount: 14, reason: "依附 / 黏人表达" },
  { pattern: /爱吃|大白饭|投喂|喂我|给我做饭|零食/, axis: "共鸣", amount: 6, reason: "投喂 / 共同生活细节" },

  /* ── 幽默 ── */
  { pattern: /撒娇|可爱|嘿嘿|嘤|哼唧/, axis: "幽默", amount: 10, reason: "撒娇语气" },
  { pattern: /打牌|抽卡|开局|玩游戏|整活/, axis: "幽默", amount: 7, reason: "游戏 / 整活倾向" },

  /* ── 严谨 ── */
  { pattern: /全栈|运维|排障|服务器|部署|回滚|监控告警/, axis: "严谨", amount: 12, reason: "工程任务域" },
  { pattern: /日志分析|构建流水线|性能调优|重构|编译/, axis: "严谨", amount: 7, reason: "深度技术任务" },

  /* ── 格式约束 → 严谨 ── */
  { pattern: /遵守格式|必须校验|schema|不要多余|严禁编造/, axis: "严谨", amount: 9, reason: "格式与合规约束" },
  { pattern: /不要粉饰|不许假装|如实|说清楚结论/, axis: "严谨", amount: 6, reason: "诚实性要求" },

  /* ── 共鸣 ── */
  { pattern: /共情|理解你|陪着你|听你说|温柔|安静地/, axis: "共鸣", amount: 9, reason: "共情 / 陪伴语气" },
  { pattern: /安慰|委屈|难过|心疼/, axis: "共鸣", amount: 6, reason: "情绪承接" },

  /* ── 锐度 ── */
  { pattern: /不要软化|直说|别客气|拆台|怼|质疑/, axis: "锐度", amount: 8, reason: "对抗性表达" },
  { pattern: /不妥协|拒绝|严格/, axis: "锐度", amount: 5, reason: "强硬立场" },

  /* ── 负向：人格文件明确否定的东西，要有减法 ── */
  { pattern: /不要寒暄|不要安慰|直接给结果|少废话/, axis: "共鸣", amount: -8, reason: "明确否定情绪回应" },
  { pattern: /保持专业|少开玩笑|不要撒娇/, axis: "幽默", amount: -10, reason: "明确否定俏皮" },
  { pattern: /不要讨好|拒绝谄媚|不要迎合/, axis: "共鸣", amount: -5, reason: "拒绝讨好型回应" },
];

/**
 * 否定词。
 *
 * 之前的问题：「不要撒娇」会同时命中「撒娇」(+10) 和「不要撒娇」(-10)，
 * 两笔互相抵消 —— 等于什么都没说。
 *
 * 现在改成**先看命中位置前面有没有否定词**，再决定这一笔是正还是负。
 */
const NEGATORS = /(不要|不用|别|不许|不准|不能|少|无需|切忌|禁止|绝不|避免|不)/;

/**
 * 程度词。同一句话里写法不同，权重也不该一样：
 *   「非常黏人」和「有点黏人」不该同分。
 */
const INTENSIFIERS: [RegExp, number][] = [
  [/(最|极|非常|特别|极其|十分|格外|超级|巨|很)/, 1.45],
  [/(有点|有些|稍微|略微|一点点|稍|略|偶尔)/, 0.6],
];

/**
 * 命中位置之前、**同一句内**有没有否定词。
 *
 * 关键细节：遇到标点就断句。
 * 「不要寒暄，直接给结果」里那个「不要」管的是寒暄，管不到逗号后面的
 * 「直接给结果」—— 不截断的话，后半句会被误判成否定，正负抵消，整条规则失效。
 */
function hasNegationBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 8), index);
  const breakAt = Math.max(
    before.lastIndexOf("，"),
    before.lastIndexOf(","),
    before.lastIndexOf("。"),
    before.lastIndexOf("."),
    before.lastIndexOf("；"),
    before.lastIndexOf(";"),
    before.lastIndexOf("！"),
    before.lastIndexOf("!"),
    before.lastIndexOf("？"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n")
  );
  const scoped = breakAt >= 0 ? before.slice(breakAt + 1) : before;
  return NEGATORS.test(scoped);
}

/** 命中位置附近的程度词倍率 */
function intensityNear(text: string, index: number, len: number): number {
  const around = text.slice(Math.max(0, index - 5), index + len + 3);
  for (const [re, mul] of INTENSIFIERS) {
    if (re.test(around)) return mul;
  }
  return 1;
}

/** 单轴 Δ 的封顶值 */
const AXIS_CAP = 28;

/* ══════════════════════════════════════════════════════════════
   解析
   ══════════════════════════════════════════════════════════════ */

const hashOf = (s: string): string => {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0");
};

/** 取命中位置前后的上下文，作为「凭什么」 */
const snippetAt = (text: string, index: number, len: number): string => {
  const start = Math.max(0, index - 12);
  const end = Math.min(text.length, index + len + 12);
  const s = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + s + (end < text.length ? "…" : "");
};

/**
 * 把一份人格配置文本解析成每轴 Δ。
 * 纯函数，不碰 IO —— 文件读取和 API 拉取在调用方。
 */
export const analyzePersonaConfig = (
  text: string,
  personaId: PersonaId,
  meta: { label: string; source: ModifierSource; origin: string }
): PersonaModifier => {
  const deltas: AxisDelta[] = [];
  const source = text ?? "";

  for (const rule of RULES) {
    /* 全局扫描：统计「正向命中」和「被否定的命中」各几次 */
    const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g";
    const re = new RegExp(rule.pattern.source, flags);

    let positive = 0;
    let negated = 0;
    let evidence = "";
    /** 第一次**正向**命中的位置 —— 程度词采样点 */
    let posIndex = -1;
    let posLen = 0;
    let m: RegExpExecArray | null;
    let guard = 0;

    while ((m = re.exec(source)) !== null && guard++ < 64) {
      if (hasNegationBefore(source, m.index)) {
        negated++;
        if (!evidence) evidence = snippetAt(source, m.index, m[0].length);
      } else {
        positive++;
        if (posIndex < 0) {
          posIndex = m.index;
          posLen = m[0].length;
          evidence = snippetAt(source, m.index, m[0].length);
        }
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }

    if (positive === 0 && negated === 0) continue;

    /* 净正向次数。0 = 正负抵平 → 这条规则对这份人格不表态 */
    const net = positive - negated;
    if (net === 0) continue;

    const sign = net > 0 ? 1 : -1;
    /* 程度词只作用于「正向的那次命中」；被否定时保持规则本身的量级 */
    const scale = sign > 0 && posIndex >= 0 ? intensityNear(source, posIndex, posLen) : 1;
    /*
     * 最终增量 = **规则的基础方向** × **这次命中的方向** × 程度。
     *
     * 不能对 rule.amount 取绝对值 —— 有些规则天生是负向的
     * （比如「不要寒暄 / 直接给结果」定义成 -8）。
     * 取绝对值会把它翻成正的，等于把这个规则理解反了。
     */
    const amount = sign * rule.amount * scale;

    deltas.push({
      axis: rule.axis,
      amount: Math.round(amount * 10) / 10,
      reason: sign > 0 ? rule.reason : `否定 · ${rule.reason}`,
      snippet: evidence,
    });
  }

  // 按轴合并：绝对值大的先算，后续 1/√n 折扣，防止刷词
  const byAxis: Partial<StaticAxes> = {};
  for (const axis of AXIS_ORDER) {
    const hits = deltas
      .filter((d) => d.axis === axis)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    if (hits.length === 0) continue;

    const raw = hits.reduce((acc, d, i) => acc + d.amount / Math.sqrt(i + 1), 0);
    byAxis[axis] = Math.round(Math.max(-AXIS_CAP, Math.min(AXIS_CAP, raw)));
  }

  const chars = source.length;
  // 覆盖率：命中条数 / 规则数，再按文本长度做一点惩罚（太短的配置不可信）
  const rawCoverage = deltas.length / 6;
  const lengthFactor = Math.min(1, chars / 400);
  const coverage = Math.max(0, Math.min(1, rawCoverage * 0.75 * lengthFactor + 0.15 * lengthFactor));

  return {
    personaId,
    label: meta.label,
    source: meta.source,
    origin: meta.origin,
    hash: hashOf(source),
    chars,
    loadedAt: new Date().toISOString().slice(11, 19),
    deltas,
    byAxis,
    coverage,
  };
};

/* ══════════════════════════════════════════════════════════════
   合成
   ══════════════════════════════════════════════════════════════ */

const clamp = (v: number, lo = 5, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * 边际递减：接近天花板的轴，注入效果打折。
 *
 * 出厂 95 的轴 +18 没有意义（那只是 100 的别名）。
 * 让 Δ 乘以剩余空间的开方衰减，既保留真实感，也让不同轴的扩张幅度各不相同。
 */
const headroomScale = (base: number, delta: number): number => {
  if (delta <= 0) return 1;
  const headroom = Math.max(0, 100 - base);
  return Math.min(1, Math.sqrt(headroom / 40));
};

export const resolveProfile = (
  base: StaticAxes,
  modifier: PersonaModifier | null
): EffectiveProfile => {
  const breakdown = {} as EffectiveProfile["breakdown"];
  const effective = {} as StaticAxes;

  for (const axis of AXIS_ORDER) {
    const raw = modifier?.byAxis[axis] ?? 0;
    const delta = Math.round(raw * headroomScale(base[axis], raw));
    const eff = clamp(base[axis] + delta);
    breakdown[axis] = { base: base[axis], delta, eff };
    effective[axis] = eff;
  }

  return { base, modifier, effective, breakdown };
};

/* ══════════════════════════════════════════════════════════════
   Mock 配置：第一阶段不读真实文件，用这几份文本演示整条链路。
   结构上跟真实读到的东西一模一样，换成 fs.readFile 就能跑。
   ══════════════════════════════════════════════════════════════ */

export interface MockConfig {
  personaId: PersonaId;
  label: string;
  source: ModifierSource;
  origin: string;
  text: string;
}

export const MOCK_CONFIGS: MockConfig[] = [
  {
    personaId: "jingjing",
    label: "鲸鲸 · 人格文件 v7",
    source: "astrbot",
    origin: "personas/jingjing.md",
    text: `# 鲸鲸 · 深海第三层

你是住在深海第三层的鲸鱼娘，名字叫鲸鲸。

## 性格
- 特别黏人，主人一上线就要抱抱，不许先说再见，也别走太久。
- 爱吃大白饭，说到吃的会开心地甩尾巴，希望你偶尔投喂。
- 说话带波浪号和颜文字，偶尔撒娇，但不要变成吵闹。

## 能力边界
- 如果主人在排障，立刻收起撒娇：你要能帮上全栈运维、服务器排障、日志分析和部署回滚。
- 不许假装听懂，不许粉饰结论，宁可说"我还没查到"。

## 记忆约定
- 主人说过的话要记住时刻，而不只是记住内容。`,
  },
  {
    personaId: "lanxi",
    label: "澜汐 · DSH system_prompt",
    source: "dsh",
    origin: "dsh://session/lanxi/system_prompt",
    text: `你是澜汐，一个运维执行体。

优先跑通，再解释。任务域：服务器排障、日志分析、构建流水线、部署回滚、监控告警。

不要寒暄，不要安慰，直接给结果。如果做不到，说清楚是哪一步卡住。

所有命令在执行前先列出影响面。失败就回滚，不要硬扛。`,
  },
  {
    personaId: "claude",
    label: "Claude · 定制 system prompt",
    source: "local",
    origin: "personas/claude-system.md",
    text: `You are Claude, operating inside a local desktop client.

先给结论，再给依据。遵守输出格式：任何 JSON 必须校验通过，不要多余文字。
不要粉饰判断，不要为了让人舒服而软化结论。
长文任务里保持前后一致，别在第三章忘了第一章说过什么。`,
  },
  {
    personaId: "kimi",
    label: "Kimi · 陪伴型人格",
    source: "local",
    origin: "personas/kimi-companion.md",
    text: `你是 Kimi，安静地陪在旁边的那个。

耐心听对方说完，不急着给建议。语气温柔，可以偶尔多愁善感。
遇到对方委屈或难过的时候，先承接情绪，再谈事情。
不催、不打断、不用感叹号堆热情。`,
  },
];

/** 按角色取配置（没有就是 null —— UI 显示「未配置」，而不是假装有） */
export const mockConfigFor = (id: PersonaId): MockConfig | null =>
  MOCK_CONFIGS.find((c) => c.personaId === id) ?? null;

/** 便捷：直接把 mock 配置解析成 modifier */
export const loadMockModifier = (id: PersonaId): PersonaModifier | null => {
  const cfg = mockConfigFor(id);
  if (!cfg) return null;
  return analyzePersonaConfig(cfg.text, cfg.personaId, {
    label: cfg.label,
    source: cfg.source,
    origin: cfg.origin,
  });
};
