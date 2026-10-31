/**
 * 解析引擎配置 —— 多级降级架构（Fallback Architecture）
 *
 * 关键认识：这两级不是"Level 越高越好"的直线，而是两个互相冲突的维度：
 *
 *   精度    L2 云端大模型  >  L1 内置正则
 *   隐私    L1（本地）    >  L2（文本要出本机）
 *   门槛    L1 零配置     <  L2 一个凭据
 *
 * 所以 UI 不能用"进度条"表达，得让用户看见这张取舍表。
 *
 * 曾经有 L3（端侧 WebGPU）和 L4（本地 Ollama），2026-10-24 砍掉，见 D-015：
 * L3 的 0.5B 模型精度不如正则、门槛却要 WebGPU + 380 MB；
 * L4 要装 Ollama 再下几 GB 模型，而且从来没真跑起来过。
 *
 * 本文件只管规格与配置结构。真实调用逻辑在第二阶段接入，
 * 现在全部是 mock 状态。
 */

import type { PersonaId } from "./personas";

export type EngineLevel = 1 | 2 | 3 | 4;

export type EngineStatus = "ready" | "needs-setup" | "unsupported" | "off";

export interface EngineSpec {
  level: EngineLevel;
  /** 展示名 */
  name: string;
  /** 一句话定位 */
  tag: string;
  desc: string;
  /** 维度评分，用于那张取舍表 */
  scores: {
    precision: "低" | "中" | "高";
    privacy: "本地" | "出网";
    latency: string;
    footprint: string;
  };
  /** 前置条件 */
  requires: string;
  /** 默认状态（真实状态由运行时探测覆写） */
  defaultStatus: EngineStatus;
  /** 选它必须接受的代价，一句实话 */
  caveat: string;
}

export const ENGINES: EngineSpec[] = [
  {
    level: 1,
    name: "内置正则",
    tag: "零配置 · 默认",
    desc: "15 条 Gold Set 规则直接跑在渲染进程里。快到无感，能识别关键词与权重。",
    scores: { precision: "中", privacy: "本地", latency: "< 1 ms", footprint: "0 KB" },
    requires: "无",
    defaultStatus: "ready",
    caveat: "认不出否定句。「不要撒娇」会同时命中正向和负向规则，互相抵消。",
  },
  {
    level: 2,
    name: "云端 API",
    tag: "复用 API 接入",
    desc: "把人格文本交给 GLM / DeepSeek / Claude，直接返回结构化 JSON。精度最高。",
    scores: { precision: "高", privacy: "出网", latency: "1.2 – 3 s", footprint: "0 KB" },
    requires: "「API 接入」里配好的凭据（不用在这儿再填一遍）",
    defaultStatus: "needs-setup",
    caveat: "人格文件会离开这台机器。如果你的 prompt 里写了私事，这条要慎选。",
  },
];

export const ENGINE_MAP = Object.fromEntries(
  ENGINES.map((e) => [e.level, e])
) as Record<EngineLevel, EngineSpec>;

/* ══════════════════════════════════════════════════════════════
   配置结构
   ══════════════════════════════════════════════════════════════ */

export type CloudProvider = "deepseek" | "openai" | "claude" | "glm";

import { loadCredentials } from "../store/credentials";

export const PROVIDERS: { id: CloudProvider; name: string; model: string }[] = [
  { id: "deepseek", name: "DeepSeek", model: "deepseek-v3.2" },
  { id: "openai", name: "OpenAI", model: "gpt-5" },
  { id: "claude", name: "Claude", model: "claude-sonnet-4.6" },
  { id: "glm", name: "智谱 GLM", model: "glm-4.6" },
];

export interface EngineConfig {
  /** 用户选定的主引擎 */
  active: EngineLevel;
  /** 主引擎失败时是否自动落到下一级 */
  autoFallback: boolean;
  /** 降级顺序（可调整） */
  chain: EngineLevel[];
  level2: {
    /**
     * @deprecated 只剩兼容旧存档的作用。可用性现在由「API 接入」里的真实凭据决定
     * （见 statusOf / hasCloudCredential）。
     */
    provider: CloudProvider;
    /** @deprecated 同上 */
    keySet: boolean;
    /** @deprecated 同上 */
    keyMask: string;
    /** 用哪套凭据（3w:credentials 里的 id）。空 = 用第一套 */
    credentialId?: string;
    /** 用哪个模型。空 = 用该凭据的第一个模型 */
    modelId?: string;
  };
}

export const DEFAULT_CONFIG: EngineConfig = {
  active: 1,
  autoFallback: true,
  chain: [2, 1],
  level2: { provider: "deepseek", keySet: false, keyMask: "" },
};

/* ══════════════════════════════════════════════════════════════
   运行时状态推导
   ══════════════════════════════════════════════════════════════ */

/** 「API 接入」里有没有一套真能用的凭据（解不开的 apiKey 是空串，不算） */
export function hasCloudCredential(): boolean {
  try {
    return loadCredentials().some((c) => !!c.apiKey);
  } catch {
    return false;
  }
}

export const statusOf = (level: EngineLevel, cfg: EngineConfig): EngineStatus => {
  if (level === 1) return "ready";
  if (level === 2) {
    /*
     * 直接看「API 接入」里有没有能用的凭据。
     *
     * 以前这里读的是 cfg.level2.keySet —— 那是解析引擎自己维护的一把假钥匙，
     * 用户得在「API 接入」和「解析引擎」两个地方各填一遍同样的 Key。
     * 更糟的是那个「保存」按钮只把输入变成掩码，根本没存。
     *
     * 现在只有一处真相：3w:credentials。
     */
    return hasCloudCredential() ? "ready" : "needs-setup";
  }

  /* L3 / L4 已移除 —— 永远不可用，让链路走到 L1/L2 */
  if (level === 3 || level === 4) return "off";

  return "off";
};

export const STATUS_META: Record<
  EngineStatus,
  { label: string; color: string; hint: string }
> = {
  ready: { label: "可用", color: "#35f0ce", hint: "已就绪，可立即执行" },
  "needs-setup": { label: "待配置", color: "#ffc46b", hint: "还需要一步配置" },
  unsupported: { label: "不可用", color: "#ff7a6b", hint: "当前环境不满足" },
  off: { label: "未启用", color: "#5c7385", hint: "已从链路中移除" },
};

/**
 * 从选定引擎开始，沿降级链找到第一个真正可用的引擎。
 * 返回链路轨迹，UI 用它画"实际会走哪条路"。
 */
export const resolveChain = (
  cfg: EngineConfig
): { effective: EngineLevel; trail: { level: EngineLevel; status: EngineStatus }[] } => {
  const order = [cfg.active, ...cfg.chain.filter((l) => l !== cfg.active)];
  const trail = order.map((level) => ({ level, status: statusOf(level, cfg) }));

  const hit = trail.find((t) => t.status === "ready");
  if (hit) return { effective: hit.level, trail };

  // 全都不行 —— 正则永远在，理论上到不了这里
  return { effective: 1, trail };
};

/* ══════════════════════════════════════════════════════════════
   UI 文案：把取舍讲清楚，而不是画成进度条
   ══════════════════════════════════════════════════════════════ */

export const DIMENSION_NOTE =
  "编号只代表接入门槛，不代表能力等级。精度：L2 > L1；隐私：L1 > L2；门槛：L1 < L2。选哪个取决于你更在乎哪一维。";

/** 用于 mock：某个角色会在哪一级上被解析 */
export const engineForPersona = (
  _id: PersonaId,
  cfg: EngineConfig
): EngineLevel => resolveChain(cfg).effective;
