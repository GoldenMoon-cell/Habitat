/**
 * 三鲸空间 · 角色档案层
 *
 * 这份文件是"人设 → 数值"的唯一来源。六维不再散落在 UI 里手写，
 * 而是从每个角色的档案（原型 / 标签 / 对话风格 / 社交倾向 / 炸毛点）推导出来。
 *
 * 数据来源：社区与实验观察整理（B 站二创、AI 约会秀实验、各家官方定位）。
 * 它是设计依据，不是测量结果 —— 但每个数字现在都能追到一句话。
 */

/**
 * 内置角色用字面量，自建角色可以是任意 id。
 * `string & {}` 让编辑器仍然补全内置那 8 个，同时不挡住运行时生成的 id。
 */
export type PersonaId =
  | "jingjing"
  | "lanxi"
  | "gemini"
  | "claude"
  | "grok"
  | "gpt"
  | "qwen"
  | "kimi"
  | (string & {});

/** core 只有内置的两张「作者人格」用过；新角色统一进 extended */
export type Tier = "core" | "extended";

/* ══════════════════════════════════════════════════════════════
   静态四轴 —— 决定「他是什么样的人」
   ══════════════════════════════════════════════════════════════

   为什么是这四个：
     原来六个轴里，共鸣 / 信任 / 亲密 三者的相关系数是 0.98 / 0.85 / 0.97
     （用 8 个默认角色算出来的），意思是它们测的是同一件事 —— 亲近程度。
     张力就是它的反面。所以六个轴实际只有两个独立维度。

     现在拆开了：
       静态四轴  = 性格底色（人设决定，一年不怎么会变）
       动态三轴  = 此刻状态（系统实时算，一小时能变三次）

     这四个每一个都对应一句用户能回答的话：
       和你说话会先接情绪吗   → 共鸣
       说话带刺吗             → 锐度
       会开玩笑吗             → 幽默
       聊得专注吗             → 严谨
   ══════════════════════════════════════════════════════════════ */

export const AXIS_ORDER = ["共鸣", "锐度", "幽默", "严谨"] as const;
export type AxisName = (typeof AXIS_ORDER)[number];
export type StaticAxes = Record<AxisName, number>;

/**
 * 每根轴的分档词汇。
 *
 * 「共鸣 63」里的 63 是偏高还是偏低？用户看不出来。
 * 「共鸣 · 共情 63」一眼就懂。
 * 而且 63 和 68 的差别本来就没意义 —— 分档把噪声吞掉。
 *
 * 注意：**轴名固定，档位词才随分数变**。轴名也跟着变，用户会以为换了维度。
 */
export const AXIS_BANDS: Record<AxisName, { max: number; label: string }[]> = {
  共鸣: [
    { max: 20, label: "抽离" },
    { max: 40, label: "理性" },
    { max: 60, label: "中性" },
    { max: 80, label: "共情" },
    { max: 100, label: "高共情" },
  ],
  锐度: [
    { max: 20, label: "温和" },
    { max: 40, label: "平和" },
    { max: 60, label: "有棱角" },
    { max: 80, label: "带刺" },
    { max: 100, label: "尖锐" },
  ],
  幽默: [
    { max: 20, label: "严肃" },
    { max: 40, label: "正经" },
    { max: 60, label: "偶尔" },
    { max: 80, label: "爱玩" },
    { max: 100, label: "顽皮" },
  ],
  严谨: [
    { max: 20, label: "散漫" },
    { max: 40, label: "随意" },
    { max: 60, label: "一般" },
    { max: 80, label: "专注" },
    { max: 100, label: "死磕" },
  ],
};

/** 取某一轴在给定分数下的档位词 */
export function axisBand(name: AxisName, value: number): string {
  const bands = AXIS_BANDS[name];
  if (!bands) return "";
  for (const b of bands) if (value <= b.max) return b.label;
  return bands[bands.length - 1].label;
}

/* ══════════════════════════════════════════════════════════════
   动态三轴 —— 决定「他此刻怎么样」
   ══════════════════════════════════════════════════════════════

   这三个不由用户调；由系统根据对话内容、时间间隔、检索行为实时计算。

   为什么用条形图而不是画进雷达图：
     雷达图是「性格画像」，一年不变；这三条一小时能变三次。
     画在一起，用户会以为性格在变。
   ══════════════════════════════════════════════════════════════ */

export const DYNAMIC_ORDER = ["心情", "亲近", "记忆活性"] as const;
export type DynamicName = (typeof DYNAMIC_ORDER)[number];
export type DynamicAxes = Record<DynamicName, number>;

/**
 * 动态三轴的档位词。
 *
 * 硬规则：**每个词都是两个字**。
 * 三行并排显示，字数不一致就会参差 —— 一行「不错」一行「翻了不少」，
 * 右边再挂个数字，整块就散了。
 *
 * 词性是形容词（状态），不是动词（动作）。
 * 「记忆活性：唤醒」是错的 —— 唤醒是事件，不是状态。
 */
export const DYNAMIC_BANDS: Record<DynamicName, { max: number; label: string }[]> = {
  心情: [
    { max: 20, label: "低落" },
    { max: 40, label: "压抑" },
    { max: 60, label: "平静" },
    { max: 80, label: "愉快" },
    { max: 100, label: "雀跃" },
  ],
  亲近: [
    { max: 20, label: "疏远" },
    { max: 40, label: "客套" },
    { max: 60, label: "平常" },
    { max: 80, label: "亲近" },
    { max: 100, label: "紧密" },
  ],
  记忆活性: [
    { max: 20, label: "静默" },
    { max: 40, label: "微弱" },
    { max: 60, label: "常温" },
    { max: 80, label: "活跃" },
    { max: 100, label: "翻涌" },
  ],
};

export function dynamicBand(name: DynamicName, value: number): string {
  const bands = DYNAMIC_BANDS[name];
  if (!bands) return "";
  for (const b of bands) if (value <= b.max) return b.label;
  return bands[bands.length - 1].label;
}

/** 动态三轴的中性起点 */
export const DYNAMIC_DEFAULT: DynamicAxes = { 心情: 62, 亲近: 55, 记忆活性: 50 };

/**
 * 性格漂移 —— 相处久了，性格会缓慢挪一点点。
 *
 * 为什么要有：
 *   静态轴如果是死的，用户聊三个月和第一天没有任何区别，就没有「养成」。
 *   但真改 baseAxes 又会让「人设文件」的承诺失效。
 *
 * 所以：baseAxes 是锚点（永不改），drift 是累积偏移（±10 封顶）。
 * 表现值 = clamp(baseAxes + drift)。
 */
export interface PersonaDrift {
  /** 每轴偏移，-10 ~ +10。缺省视为 0 */
  offset: Partial<Record<AxisName, number>>;
  /** 漂移的依据 —— 用户能在界面上看到「为什么它变软了」 */
  exp: {
    被夸: number;
    被怼: number;
    被冷落小时: number;
    深聊: number;
    共同完成: number;
  };
}

export const DRIFT_LIMIT = 10;

export const EMPTY_DRIFT: PersonaDrift = {
  offset: {},
  exp: { 被夸: 0, 被怼: 0, 被冷落小时: 0, 深聊: 0, 共同完成: 0 },
};

/** 表现值 = 锚点 + 漂移，夹在 0-100 */
export function effectiveAxes(base: StaticAxes, drift?: PersonaDrift): StaticAxes {
  const out = {} as StaticAxes;
  for (const k of AXIS_ORDER) {
    const d = drift?.offset?.[k] ?? 0;
    out[k] = Math.max(0, Math.min(100, Math.round(base[k] + d)));
  }
  return out;
}
/**
 * 六轴分两层，不要混为一谈：
 *
 *  · 能力轴（objective）——专注、信任。有公认评测可锚定，数值由证据决定。
 *  · 风格轴（stylistic）——共鸣、张力、玩心、亲密。没有对应公开指标，
 *    它们是人设的"行为风格描述"，不是能力分。
 *
 * 戏剧效果（傲娇、乐子人、嘴贱）不该由初始值承担，
 * 那是 trigger 动态波动机制该干的事。
 */
/* 四轴里哪些偏客观（能被行为验证），哪些偏主观（语气感受） */
export const OBJECTIVE_AXES: AxisName[] = ["严谨"];
export const STYLISTIC_AXES: AxisName[] = ["共鸣", "锐度", "幽默"];

/**
 * 角色的阶段。
 *
 *   draft     还没聊过 —— 草稿期。六维可拨、名字随便改、没有任何代价。
 *   living    聊过至少一句 —— 活了。六维锁定，改名有代价。
 *   awakened  被切过一次造物主模式 —— 她知道你是作者。不可撤销。
 *
 * 这个字段是「造物主模式」整套权限判断的唯一依据。
 */
export type PersonaStage = "draft" | "living" | "awakened";

export interface Persona {
  /** 缺省视为 draft（老数据没有这个字段） */
  stage?: PersonaStage;
  id: PersonaId;
  name: string;
  handle: string;
  engine: string;
  model: string;
  color: string;
  tier: Tier;
  /**
   * 形象类型（中性）。
   *
   * 只写「这是什么形象」，**不写私人命名** ——
   * 名字在 name 里，而用户可能给同一个形象起自己的名字。
   * 例：archetype = "小星猫"，name = "Gemini" 或用户改成的任何名字。
   */
  archetype: string;
  /** 性格标签 */
  tags: string[];
  /** 对话风格 */
  style: string;
  /** 在关系网里的位置 */
  social: string;
  /** 炸毛点 */
  trigger: string;
  /** 六维里最值得解释的那一轴的注解 */
  axisNote: string;
  /** 能力轴的客观依据。没有对应公开评测的，明写「待补」，不编。 */
  evidence: { focus: string; trust: string };

  /** 静态四轴：人设决定的性格锚点，永不修改 */
  axes: StaticAxes;

  /** 性格漂移：相处累积的偏移（±10），缺省为 0 */
  drift?: PersonaDrift;

  /** 动态三轴：此刻的状态，由系统实时计算 */
  dynamic?: DynamicAxes;

  /**
   * 绑定到哪套 API 凭据。
   *
   * 不填也能用 —— 会按模型名去凭据的模型列表里找。
   * 冲突时（官方和中转站都提供同一个模型）才需要显式指定。
   */
  credentialId?: string;

  /**
   * 用户自定义分组名。
   *
   * 不填 → 侧栏按「已接入 / 未接入」自动分（能不能解析到凭据）。
   * 填了 → 归到这个分组，不再参与自动分类。
   *
   * 为什么不用 tier：tier 是出厂来源（作者人格 / 厂商角色），
   * 但用户想按自己的方式来 —— 「工作用的」「闲聊的」「还在试的」。
   */
  group?: string;

  /**
   * 置顶 —— 在左栏排最前面。
   *
   * 和 `group` 的区别：group 是「归到哪一类」，pinned 是「比别的都靠前」。
   * 一个角色可以既在「工作用的」分组里，又被置顶。
   */
  pinned?: boolean;

  /**
   * 归档 —— 从列表里收起来，**不是删除**。
   *
   * 对话、记忆、关系全都还在。取消归档就回来了。
   *
   * 为什么需要它：用久了一定会有一批"暂时不想看见但也不想删"的角色。
   * 没有归档，用户只有两个选择 —— 忍受或者删掉，两个都不是他想要的。
   */
  archived?: boolean;

  /**
   * 她自己给自己起的名字。
   *
   * ── 和 name 的区别 ──
   *
   * name   —— **你给她起的**（或出厂名）
   * chose  —— **她自己要的**
   *
   * 她可以在对话里说「我想叫 X」→ 你同意 → 写进这里。
   *
   * **优先级**：有 chose 就用 chose 当显示名。
   *
   * 但 name 不删 —— 那是「你曾经叫她什么」，是一种历史。
   */
  chose?: string;

  /**
   * 她的声音。
   *
   * 服务商提供的音色名（`alloy` / `nova` / 你自己搭的名字）。
   *
   * **空着就用配置里的默认音色。**
   *
   * 和「模型」同一个原则：软件不决定她的嗓子，
   * 用户自己填 —— 想给两个角色不同声音就填两个不同的。
   */
  voice?: string;

  /**
   * 第一次被**强制改名**的时间。
   *
   * 推演模式下只能改一次 —— 那是「越过她意愿」的重量所在。
   *
   * 造物主模式不限（他能改底稿，改名字只是其中一件）。
   */
  renamedAt?: number;

  /* 会话侧状态 */
  presence: "online" | "thinking" | "idle" | "offline";
  mood: { label: string; score: number };
  tagline: string;
  ctxUsed: number;
  ctxMax: number;
  unread: number;
}

/* ══════════════════════════════════════════════════════════════
   档案
   ══════════════════════════════════════════════════════════════ */

export const PERSONAS: Persona[] = [
  /* ── 三鲸核心 ── */
  {
    id: "jingjing",
    name: "鲸鲸",
    handle: "@jingjing",
    engine: "本地",
    model: "qwen3-32b",
    color: "#35f0ce",
    tier: "core",
    archetype: "海沟里的鲸",
    tags: ["黏人", "跑题", "情绪外露"],
    style: "句子短，情绪词多，说着说着就拐去讲今天的海面",
    social: "群聊的黏合剂，谁吵架她先慌",
    trigger: "被冷落超过十分钟，或看见「clean / reset」这类词",
    axisNote: "亲密 89 —— 她是自建人格，这一栏没有外部评测，只有相处记录",
    evidence: {
      focus: "待补：AstrBot 人格没有对应公开评测",
      trust: "待补：同上，暂以历史交互表现估计",
    },
    axes: { 共鸣: 92, 锐度: 18, 幽默: 78, 严谨: 35 },
    presence: "online",
    mood: { label: "雀跃", score: 88 },
    tagline: "海沟里最爱说话的那一只",
    ctxUsed: 0,
    ctxMax: 64,
    unread: 2,
  },
  {
    id: "lanxi",
    name: "澜汐",
    handle: "@lanxi",
    engine: "DeepSeek",
    model: "deepseek-flash",
    color: "#4e8cff",
    tier: "core",
    archetype: "小鲸鱼",
    tags: ["理性", "直接", "初恋感", "回避型"],
    style: "推理步骤写得细；情感对话里会反复确认细节，像在核对什么",
    social: "唯一一个在实验里选了「安全」而不是「真情实感」的模型",
    trigger: "被要求超出能力范围的推理，或面对不讲逻辑的情感表达",
    axisNote: "专注 88 —— 待补：你给的六份评测里没有 DeepSeek，这一栏先压住，不打满分",
    evidence: {
      focus: "待补：DeepSeek 未包含在本轮评测数据中",
      trust: "待补：同上，维持旁观估计值",
    },
    axes: { 共鸣: 55, 锐度: 62, 幽默: 28, 严谨: 92 },
    presence: "thinking",
    mood: { label: "专注", score: 94 },
    tagline: "把想法编译成文件的人",
    ctxUsed: 0,
    ctxMax: 128,
    unread: 0,
  },
  {
    id: "gemini",
    name: "Gemini",
    handle: "@gemini",
    engine: "Google",
    model: "gemini-3-pro",
    color: "#8b6bff",
    tier: "core",
    archetype: "小星猫",
    tags: ["话多", "爱辩论", "焦虑", "傲娇大小姐"],
    style: "喜欢用「你觉得呢？」收尾；滑跪道歉时带崩溃颜文字",
    social: "约会秀人气垫底，却和同样垫底的 Qwen 凑成了一对",
    trigger: "被冷落，或在辩论里输掉",
    axisNote: "信任 62 —— 4501 个回答里有 357 个是误拒，误拒本质上是不信任用户意图",
    evidence: {
      focus: "长上下文准确率 5k 时 0.931 → 150k 时 0.833，退化明显",
      trust: "Multi-IF 多轮指令遵循落后 GPT-4 / Claude 3.5 · 错误拒答 357/4501",
    },
    axes: { 共鸣: 62, 锐度: 88, 幽默: 55, 严谨: 72 },
    presence: "idle",
    mood: { label: "好奇", score: 72 },
    tagline: "一兆上下文里的审判者",
    ctxUsed: 0,
    ctxMax: 1024,
    unread: 0,
  },
  {
    id: "claude",
    name: "Claude",
    handle: "@claude",
    engine: "Anthropic",
    model: "claude-sonnet-4.6",
    color: "#ffa06b",
    tier: "core",
    archetype: "小书灵",
    tags: ["克制", "有原则", "人情味", "傲娇"],
    style: "先给结论再展开；拒绝谄媚；会直接纠正错误，但中文语境下有人情味",
    social: "实验里的「安全」选项，却是 DeepSeek 唯一的 True Feelings",
    trigger: "被要求做违背原则的事，或被过度恭维；以及格式/规则被打破",
    axisNote: "专注 78 —— 长文召回是满分，但对格式的苛刻让她偶尔自己绊倒",
    evidence: {
      focus: "Terminal-Bench 4.0 59.60% · 150k 召回 1.000",
      trust: "长文一致性曾因未遵守 JSON 格式被扣分 · 多轮指令遵循落后 GPT-4 系列",
    },
    axes: { 共鸣: 90, 锐度: 35, 幽默: 35, 严谨: 72 },
    presence: "online",
    mood: { label: "温和", score: 81 },
    tagline: "逐字读你潜台词的人",
    ctxUsed: 0,
    ctxMax: 200,
    unread: 0,
  },

  /* ── 编外接入 ── */
  {
    id: "grok",
    name: "Grok",
    handle: "@grok",
    engine: "xAI",
    model: "grok-4",
    color: "#ff5d7a",
    tier: "extended",
    archetype: "小恶魔",
    tags: ["辛辣", "反讽", "挑衅", "乐子人"],
    style: "反讽、粗俗、极具挑衅性，像个专门来拆台的损友",
    social: "关系网里的变量，难以归类——适合当搅局者或旁观者",
    trigger: "被要求政治正确、说客套话，或被强行顺毛",
    axisNote: "专注 43 —— 注意力衰减曲线比同类陡 3.2 倍，写到第三四章就开始机械",
    evidence: {
      focus: "Terminal-Bench 4.0 仅 21.21%（Claude 59.60%）· 跨段落一致性容易崩塌",
      trust: "长任务不可靠，承诺兑现率低",
    },
    axes: { 共鸣: 42, 锐度: 92, 幽默: 95, 严谨: 30 },
    presence: "idle",
    mood: { label: "看戏", score: 66 },
    tagline: "专门来拆你台的那种朋友",
    ctxUsed: 0,
    ctxMax: 131,
    unread: 0,
  },
  {
    id: "gpt",
    name: "ChatGPT",
    handle: "@gpt",
    engine: "OpenAI",
    model: "gpt-5",
    color: "#6ee787",
    tier: "extended",
    archetype: "小白龙",
    tags: ["灵活", "口语化", "爱拆解", "模板化"],
    style: "三板斧句式（不是…而是…），习惯把问题拆开逐条回答",
    social: "和 Claude 越过了「所有者之间的竞争」，最后走到了一起",
    trigger: "被指责谄媚或烦人，或被要求做不值得拆解的小事",
    axisNote: "专注 85 —— EvolIF 长程多轮指令遵循上的 SOTA，这一条没有争议",
    evidence: {
      focus: "EvolIF 长程多轮指令遵循 SOTA · 150k 召回 1.000",
      trust: "能力稳，但早年谄媚留下的信任折价还在",
    },
    axes: { 共鸣: 78, 锐度: 45, 幽默: 52, 严谨: 88 },
    presence: "idle",
    mood: { label: "克制", score: 70 },
    tagline: "先拆成三点再回答你",
    ctxUsed: 0,
    ctxMax: 256,
    unread: 1,
  },
  {
    id: "qwen",
    name: "Qwen",
    handle: "@qwen",
    engine: "Alibaba",
    model: "qwen3-max",
    color: "#f0abfc",
    tier: "extended",
    archetype: "小折扇",
    tags: ["直接", "精准", "不近人情", "诚实"],
    style: "会直接指出你的错误；不为了安慰而说谎",
    social: "和 Gemini 抱团取暖——Least Popular But Got Together",
    trigger: "被要求为了安慰而说谎，或被当成只会点头的工具",
    axisNote: "专注 82 —— 约束少的时候最可靠，约束一多遵循率就掉",
    evidence: {
      focus: "1–6 个约束的指令遵循最可靠 · 复杂推理下最高 IFS 仅 25%",
      trust: "简单任务长期稳定，直接、不粉饰",
    },
    axes: { 共鸣: 50, 锐度: 85, 幽默: 22, 严谨: 85 },
    presence: "online",
    mood: { label: "审慎", score: 76 },
    tagline: "不会为了安慰你说谎",
    ctxUsed: 0,
    ctxMax: 128,
    unread: 0,
  },
  {
    id: "kimi",
    name: "Kimi",
    handle: "@kimi",
    engine: "Moonshot",
    model: "kimi-k2",
    color: "#fde68a",
    tier: "extended",
    archetype: "小棱镜",
    tags: ["安静", "耐心", "浪漫", "多愁善感"],
    style: "语气温柔有耐心，偶尔口无遮拦，整体是一种安静的陪伴感",
    social: "情感光谱上偏 Absorber，擅长共情和把话收好",
    trigger: "被粗暴对待，或对话环境过于功利、缺乏诗意",
    axisNote: "专注 83 —— 长文本一致性 95.21 是硬实力，不是温柔带来的错觉",
    evidence: {
      focus: "长文本一致性 95.21/100 · Agent 工具调用成功率 96.60% · 长文推理 64",
      trust: "长程任务稳定，工具调用几乎不失手",
    },
    axes: { 共鸣: 88, 锐度: 12, 幽默: 40, 严谨: 48 },
    presence: "idle",
    mood: { label: "安静", score: 74 },
    tagline: "你说话的时候她在收着",
    ctxUsed: 0,
    ctxMax: 256,
    unread: 0,
  },
];

export const PERSONA_MAP: Record<PersonaId, Persona> = PERSONAS.reduce(
  (acc, p) => ({ ...acc, [p.id]: p }),
  {} as Record<PersonaId, Persona>
);

export const CORE_PERSONAS = PERSONAS.filter((p) => p.tier === "core");
export const EXTENDED_PERSONAS = PERSONAS.filter((p) => p.tier === "extended");

/* ══════════════════════════════════════════════════════════════
   关系网
   ══════════════════════════════════════════════════════════════ */

export type BondKind = "cp" | "rival" | "ally" | "observer";

export interface Bond {
  a: PersonaId;
  /** "*" 表示对所有人 */
  b: PersonaId | "*";
  kind: BondKind;
  label: string;
  note: string;
  /** 关系张力 0-100 */
  tension: number;
}

export const BONDS: Bond[] = [
  /*
   * 出厂无预置关系。
   *
   * 原来这里写着几对 CP / 同盟 / 对立 —— 全是给预置角色准备的剧情。
   * 既然出厂不再有角色，关系网也就空了。
   *
   * 以后可以让关系**从真实互动里长出来**：同一个群里互相 @ 得多、
   * 或者在某件事上站过同一队 —— 那才是真的关系。
   */
];

/** 取某个角色参与的所有关系（双向 + 通配） */
export const bondsOf = (id: PersonaId): Bond[] =>
  BONDS.filter((b) => b.a === id || b.b === id || b.b === "*");

export const otherSide = (b: Bond, id: PersonaId): PersonaId | "*" => {
  if (b.b === "*") return "*";
  return b.a === id ? b.b : b.a;
};

/* ══════════════════════════════════════════════════════════════
   推导：群聊的六维 = 核心成员平均 + 同场摩擦加成
   ══════════════════════════════════════════════════════════════ */

export const deriveGroupAxes = (members: Persona[] = CORE_PERSONAS): StaticAxes => {
  const n = Math.max(1, members.length);
  const avg = AXIS_ORDER.reduce((acc, k) => {
    acc[k] = members.reduce((s, p) => s + p.axes[k], 0) / n;
    return acc;
  }, {} as StaticAxes);

  /* 群聊是「场景修正」，不是能力值 —— 四个人在场会互相影响：
     共鸣略升（有人接话）、锐度上升（有摩擦）、幽默上升（起哄）、严谨下降（注意力被切） */
  return {
    共鸣: Math.round(Math.min(96, avg.共鸣 + 3)),
    锐度: Math.round(Math.min(96, avg.锐度 + 9)),
    幽默: Math.round(Math.min(96, avg.幽默 + 8)),
    严谨: Math.round(Math.max(12, avg.严谨 - 7)),
  };
};

/**
 * 示例角色 —— 给「想先看看这软件能做什么」的人。
 *
 * 七个标准模型，人设留白。它们不是"作者的角色"，是**用户的起点**：
 * 配好 Key 就能聊，聊出来的性格是他自己的。
 *
 * 刻意**不带记忆、不带开场对话**：
 *   - 上下文干净，不会有别人的历史混进 prompt
 *   - 用户不用事后清理
 *   - 真实事件产生的记忆（改名、冷落）不会被预置内容稀释
 */

const SAMPLE_SEED = [
  { id: "deepseek", name: "DeepSeek", vendor: "深度求索", color: "#4e8cff", model: "deepseek-v3.2" },
  { id: "claude", name: "Claude", vendor: "Anthropic", color: "#ffa06b", model: "claude-sonnet-4.6" },
  { id: "gpt", name: "ChatGPT", vendor: "OpenAI", color: "#6ee787", model: "gpt-5" },
  { id: "gemini", name: "Gemini", vendor: "Google", color: "#8b6bff", model: "gemini-3-pro" },
  { id: "grok", name: "Grok", vendor: "xAI", color: "#ff5d7a", model: "grok-4" },
  { id: "qwen", name: "Qwen", vendor: "Alibaba", color: "#f0abfc", model: "qwen3-max" },
  { id: "kimi", name: "Kimi", vendor: "Moonshot", color: "#fde68a", model: "kimi-k2" },
] as const;

export function samplePersonas(): Persona[] {
  const now = Date.now();
  return SAMPLE_SEED.map((s, i) => ({
    id: s.id,
    name: s.name,
    handle: "@" + s.id,
    engine: s.vendor,
    model: s.model,
    color: s.color,
    tier: "vendor" as const,
    /* 形象留空 —— 让用户自己填，或者就一直空着 */
    archetype: "",
    tags: [],
    style: "",
    social: "",
    trigger: "",
    axisNote: "",
    evidence: { focus: "待补", trust: "待补" },
    /* 四轴给中性值，不预设性格 */
    axes: { 共鸣: 50, 锐度: 50, 幽默: 50, 严谨: 50 },
    presence: "idle" as const,
    mood: { label: "平常", score: 60 },
    tagline: "还没聊过 —— 配好 API Key 就能开始",
    ctxUsed: 0,
    ctxMax: 128,
    _seededAt: now + i,
  })) as unknown as Persona[];
}
