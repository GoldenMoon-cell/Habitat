/**
 * 今日用量。
 *
 * ── 为什么要有这个 ──
 *
 * 左栏原来那块 `API CREDIT ¥42.6 / 120` 是 `mock.ts` 里的硬编码，
 * 从第一天起就没被更新过。那是**假的**。
 *
 * 余额确实拿不到（各家接口不同、OpenAI 官方那个经典接口对 API Key 已关），
 * 但有两件事我们**真的知道**：
 *
 *   ① 今天调了几次           —— 请求是我们自己发的，数得清
 *   ② 今天烧了多少 token     —— 供应商在响应里报了 `usage` 就有真数
 *
 * 第 ② 条要诚实：有些中转站不返回 usage，那就只能退回 `estimateTokens()`。
 * **所以这个模块记录「这一天的数字里有没有估算成分」**，
 * 界面上据此决定要不要打「≈」。
 */

import { estimateTokens } from "./tokens";

export interface DayUsage {
  /** 调用次数 —— 永远精确 */
  calls: number;
  /** 供应商回报的 prompt token 合计 */
  prompt: number;
  /** 供应商回报的 completion token 合计 */
  completion: number;
  /**
   * 有多少次调用**没有**拿到真实 usage。
   *
   * > 0 表示这一天里混进了估算值 —— 界面必须打「≈」。
   */
  fellBack: number;
}

export interface UsageToday extends DayUsage {
  /** 数字里含估算成分 */
  estimated: boolean;
}

const KEY = "3w:usage-daily";
/** 只留最近 30 天，别让 localStorage 无限长 */
const KEEP_DAYS = 30;

type Store = Record<string, DayUsage>;

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function emptyDay(): DayUsage {
  return { calls: 0, prompt: 0, completion: 0, fellBack: 0 };
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(s: Store) {
  try {
    /* 只留最近 KEEP_DAYS 天 —— 按 key 排序就是按日期排序 */
    const keys = Object.keys(s).sort();
    while (keys.length > KEEP_DAYS) {
      delete s[keys.shift() as string];
    }
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 写不进去就算了，不能因为统计把人卡住 */
  }
}

/**
 * 记一次调用。
 *
 * `real` 有值 → 累加真数。
 * `real` 为空 → 用 `fallbackText` 估一个，并给 `fellBack` +1。
 *
 * **估的那部分永远带着 `fellBack` 的标记**，界面骗不了人。
 */
export function recordCall(opts: {
  promptTokens?: number;
  completionTokens?: number;
  /** 没拿到真数时用来估算的文本（请求侧） */
  promptText?: string;
  /** 没拿到真数时用来估算的文本（响应侧） */
  replyText?: string;
}): void {
  const s = readStore();
  const k = today();
  const day = s[k] ?? emptyDay();

  day.calls += 1;

  const gotPrompt = typeof opts.promptTokens === "number";
  const gotCompletion = typeof opts.completionTokens === "number";

  if (gotPrompt && gotCompletion) {
    day.prompt += opts.promptTokens ?? 0;
    day.completion += opts.completionTokens ?? 0;
  } else {
    /*
     * 没有真数 —— 估。
     *
     * 注意这里是**系统性偏低**的：`estimateTokens` 数不到
     * system prompt、人格、记忆注入。所以估出来的值只能当参考。
     */
    if (!gotPrompt) day.prompt += estimateTokens(opts.promptText ?? "");
    if (!gotCompletion) day.completion += estimateTokens(opts.replyText ?? "");
    day.fellBack += 1;
  }

  s[k] = day;
  writeStore(s);
}

/** 今天到目前为止的用量 */
export function usageToday(): UsageToday {
  const s = readStore();
  const day = s[today()] ?? emptyDay();
  return { ...day, estimated: day.fellBack > 0 };
}

/**
 * 近 30 天里最忙的一天用了多少 token。
 *
 * 左栏那根进度条需要个分母 —— 没有分母的进度条是装饰品。
 *
 * 用它做分母的含义是：「今天相对你最忙的那天，用了多少」。
 * **比编一个 512k 的上限诚实。**
 */
export function peakTokens(): number {
  const s = readStore();
  let peak = 0;
  for (const k of Object.keys(s)) {
    const n = (s[k].prompt ?? 0) + (s[k].completion ?? 0);
    if (n > peak) peak = n;
  }
  return peak;
}

/** 清空统计（「全部重置」用） */
export function clearUsage(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 把数字写成人看的样子：12.4k / 934 */
export function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
