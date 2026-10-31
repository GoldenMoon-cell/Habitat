/**
 * 上下文物理上限的解析。
 *
 * 为什么需要三层：
 *   用户通过 API 接入的模型千奇百怪 —— 有官方型号，有私有部署改了名的，
 *   还有 `my-llama3-128k` 这种把参数写进名字的。写死一个列表必然漏。
 *
 * 优先级（从高到低）：
 *   1. 用户显式填过（user）
 *   2. 内置字典精确命中（known）
 *   3. 名字里的显式数字 128k / 1m（name）  ← 必须压过前缀
 *   4. 前缀兜底 claude → 200k（prefix）
 *   5. 不认识 → 保守值（unknown）
 *
 * 关于准确性：除 DeepSeek V4（官方文档 1M）外，其余数字都是**估计**，
 * 标 estimated: true。UI 上要显示「估计」二字 —— 猜错了用户要能看出来。
 */

export type WindowSource = "user" | "known" | "name" | "prefix" | "unknown";

export interface ResolvedWindow {
  /** 物理上限，单位 token */
  window: number;
  source: WindowSource;
  /** 是否估计值（不是权威数字） */
  estimated: boolean;
  /** 给用户看的依据，例如「名字里的 128k」「claude 系列默认 200k」 */
  basis: string;
}

interface KnownEntry {
  window: number;
  estimated: boolean;
  note?: string;
}

/** 精确匹配用的字典。key 是归一化后的模型名 */
const KNOWN: Record<string, KnownEntry> = {
  // ── 服务端实测（2026-10-24 从 /v1/models 拉到，比任何文档都准）──
  "deepseek-flash": { window: 1_049_000, estimated: false, note: "服务端报 1049k" },
  "deepseek-v4-pro": { window: 1_049_000, estimated: false, note: "服务端报 1049k" },

  // DeepSeek 官方文档确认（2026-10 查到 api-docs.deepseek.com）
  "deepseek-v4": { window: 1_000_000, estimated: false, note: "官方 1M" },
  "deepseek-v4-flash": { window: 1_000_000, estimated: false, note: "官方 1M" },
  "deepseek-v3": { window: 128_000, estimated: true },
  "deepseek-chat": { window: 128_000, estimated: true },
  "deepseek-reasoner": { window: 128_000, estimated: true },

  // 以下为估计值，接真 API 前需核对
  "claude-sonnet-4.6": { window: 200_000, estimated: true },
  "claude-sonnet-4": { window: 200_000, estimated: true },
  "claude-opus-4": { window: 200_000, estimated: true },
  "claude-3-5-sonnet": { window: 200_000, estimated: true },
  "claude-3-opus": { window: 200_000, estimated: true },

  "gpt-4o": { window: 128_000, estimated: true },
  "gpt-4o-mini": { window: 128_000, estimated: true },
  "gpt-4.1": { window: 1_000_000, estimated: true },
  "gpt-5": { window: 400_000, estimated: true },

  "gemini-3-pro": { window: 1_000_000, estimated: true },
  "gemini-2.5-pro": { window: 1_000_000, estimated: true },
  "gemini-2.0-flash": { window: 1_000_000, estimated: true },

  "qwen3-max": { window: 256_000, estimated: true },
  "qwen3": { window: 128_000, estimated: true },
  "kimi-k2": { window: 256_000, estimated: true },
  "kimi-k3": { window: 1_000_000, estimated: true },
  "grok-4": { window: 256_000, estimated: true },
  "grok-3": { window: 131_072, estimated: true },
};

/** 前缀兜底：名字认不出来时按系列给个保守值 */
const PREFIX: { test: RegExp; window: number; basis: string }[] = [
  { test: /^claude/i, window: 200_000, basis: "claude 系列默认 200k" },
  { test: /^gpt/i, window: 128_000, basis: "gpt 系列默认 128k" },
  { test: /^gemini/i, window: 1_000_000, basis: "gemini 系列默认 1M" },
  { test: /^deepseek/i, window: 128_000, basis: "deepseek 系列默认 128k" },
  { test: /^qwen/i, window: 128_000, basis: "qwen 系列默认 128k" },
  { test: /^kimi|^moonshot/i, window: 256_000, basis: "kimi 系列默认 256k" },
  { test: /^grok/i, window: 131_072, basis: "grok 系列默认 128k" },
  { test: /^llama/i, window: 128_000, basis: "llama 系列默认 128k" },
];

/** 完全认不出来时的默认预估。2026 年主流模型基本 ≥128k，
    设太小会白白浪费窗口；设大了超限有第四层兜底自动校正。 */
const CONSERVATIVE = 128_000;

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * 从名字里抠出显式窗口：`128k` / `200K` / `1m` / `1M` / `1000k`
 * 只认 k / m 后缀，不会把 `20241022` 这种日期当成窗口。
 */
function extractFromName(name: string): { window: number; literal: string } | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*([km])\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const window = Math.round(unit === "m" ? n * 1_000_000 : n * 1_000);
  if (window < 1_000 || window > 20_000_000) return null;
  return { window, literal: m[0] };
}

export function resolveContextWindow(
  modelName: string,
  userOverride?: number
): ResolvedWindow {
  /* 1. 用户显式填过 —— 最高优先，但仅在这个模型上生效 */
  if (userOverride && userOverride > 0) {
    return {
      window: userOverride,
      source: "user",
      estimated: false,
      basis: "你手动填的",
    };
  }

  /* 2. 内置字典精确命中 */
  const key = normalize(modelName);
  const hit = KNOWN[key] ?? KNOWN[key.replace(/-\d{8}$/, "")] ?? null;
  if (hit) {
    return {
      window: hit.window,
      source: "known",
      estimated: hit.estimated,
      basis: hit.note ?? (hit.estimated ? "内置估计值" : "内置已知值"),
    };
  }

  /* 3. 名字里的显式数字 —— 必须压过前缀兜底。
        `gpt-4-turbo-128k` 应该取 128k，不能因为前缀是 gpt 就取 128k 之外的值；
        `my-llama3-32k` 应该取 32k，而不是 llama 默认的 128k。 */
  const num = extractFromName(modelName);
  if (num) {
    return {
      window: num.window,
      source: "name",
      estimated: false,
      basis: `名字里的 ${num.literal}`,
    };
  }

  /* 4. 前缀兜底 */
  for (const p of PREFIX) {
    if (p.test.test(modelName)) {
      return { window: p.window, source: "prefix", estimated: true, basis: p.basis };
    }
  }

  /* 5. 完全不认识 */
  return {
    window: CONSERVATIVE,
    source: "unknown",
    estimated: true,
    basis: "未知模型 · 按 128k 预估",
  };
}

/** 格式化：1200000 → "1.2M" */
export function fmtWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * 第四层：从 API 的 400 报错里反向学习真实上限。
 *
 * 各种服务商的错误措辞不一样，常见形态：
 *   OpenAI:   "This model's maximum context length is 128000 tokens."
 *   Anthropic: "prompt is too long: 210000 tokens > 200000 maximum"
 *   vLLM:     "The model's max seq len is 4096"
 *   通用:     "context_length_exceeded"
 *
 * 抓到的数字写进 overrides，下次直接生效 —— 不需要用户做任何事。
 *
 * 现在没有真实 API 调用，所以这个函数不会被自动触发；
 * UI 上给了手动粘贴入口（引擎面板的「从报错校准」）。
 */
export function learnFromError(modelName: string, errorText: string): number | null {
  if (!errorText) return null;

  const patterns = [
    /maximum context (?:length|window)[^0-9]{0,20}(\d{3,})/i,
    /max(?:imum)?[^0-9]{0,20}context[^0-9]{0,20}(\d{3,})/i,
    /(\d{4,})\s*tokens?\s*>\s*\d+/i,
    /maximum[^0-9]{0,30}(\d{3,})\s*tokens?/i,
    /max (?:seq|sequence) len(?:gth)?[^0-9]{0,12}(\d{3,})/i,
    /context_length_exceeded[^0-9]{0,40}(\d{3,})/i,
  ];

  for (const re of patterns) {
    const m = errorText.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1_000 || n > 20_000_000) continue;
    saveOverride(modelName, n);
    return n;
  }

  return null;
}

/** 用户手填值存在这里，按模型名分开存 */
const OVERRIDE_KEY = "3w:ctx-window-overrides";

export function loadOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOverride(modelName: string, tokens: number) {
  try {
    const all = loadOverrides();
    all[normalize(modelName)] = tokens;
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
