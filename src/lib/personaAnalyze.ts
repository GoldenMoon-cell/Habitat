/**
 * 人格文本 → 四轴 Δ
 *
 * 两个实现，同一个返回结构，UI 可以无差别切换：
 *
 *   L1  analyzeWithRules()  纯正则，零配置，< 1 ms，离线
 *   L2  analyzeWithLlm()    调 LLM 返回 JSON，准，要出网
 *
 * 设计约束沿用 personaModifier 的四条硬规矩：
 *   ① 只产生 Δ，绝不覆盖角色的出厂基线
 *   ② 每条 Δ 必须能追到原文片段（没有 snippet 的修正是耍流氓）
 *   ③ 单轴 Δ 封顶 ±28
 *   ④ 读不懂就说读不懂，不假装
 */

import { AXIS_ORDER, type AxisName, type PersonaId, type StaticAxes } from "../data/personas";
import { analyzePersonaConfig, type AxisDelta } from "../data/personaModifier";
import { chatViaMain, chat, hasMainProcessLlm, type ChatMsg } from "./llm";
import { loadCredentials, resolveCredential } from "../store/credentials";

export type AnalyzeEngine = "l1" | "l2";

export interface AnalyzeResult {
  /** 每轴净 Δ（已封顶） */
  axes: Partial<StaticAxes>;
  /** 逐条依据 */
  deltas: AxisDelta[];
  /** 用了哪一级 */
  engine: AnalyzeEngine;
  /** 覆盖率 0–1，UI 用来说「这份配置的 62% 被识别了」 */
  coverage: number;
  /** L2 失败时的原因，UI 直接显示 */
  error?: string;
}

const AXIS_CAP = 28;

/* ══════════════ 缓存与节流 ══════════════
 *
 * 为什么两样都要：
 *
 *   缓存 —— LLM 有随机性，同一段文本点两次「解析」会得到两个不同的结果，
 *           用户会怀疑哪个是对的。而且每次都烧 token。
 *           同一 (引擎 + 模型 + 文本) 直接返回上次的结果。
 *
 *   节流 —— 连续快速请求会撞上模型端限流，它不返回 429，而是**返回空字符串**。
 *           表现就是「点几次之后突然解析不了了」。加个最小间隔。
 */
const CACHE = new Map<string, AnalyzeResult>();
const CACHE_MAX = 40;

/** 上一可以请求的时间点 */
let nextAllowedAt = 0;
const MIN_GAP_MS = 1500;

/**
 * 把文本规范化，只用于**缓存匹配**，不改变发给模型的内容。
 *
 * 目的：删一个句号、多一个空格、全角改半角，都不该触发重新解析。
 *
 * 那不是「同一段文本」，那是「同一份人格写得稍微不一样」——
 * 对它重新问 AI 只会得到另一个同样合理的答案，然后把用户搞糊涂。
 */
function normalizeForCache(text: string): string {
  return text
    /* 所有空白（含全角空格、换行、制表） */
    .replace(/[\s\u3000\u00a0]+/g, "")
    /* 中英文标点 */
    .replace(/[，。、；：！？…—·,.;:!?]/g, "")
    /* 引号、括号、破折号类 */
    .replace(/[「」『』“”‘’"'（）()【】\[\]《》<>]/g, "")
    /* 全角转半角字母数字 */
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/**
 * 缓存 key。
 *
 * 用**规范化后**的文本 —— 这样「……敢拆我的台。」和「……敢拆我的台」
 * 会命中同一条缓存，返回同一个结果。
 */
function cacheKey(engine: string, model: string, text: string): string {
  const norm = normalizeForCache(text);
  /* FNV-1a —— 只用来做 key，不需要密码学强度 */
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `${engine}|${model}|${norm.length}|${h.toString(36)}`;
}

function cacheGet(k: string): AnalyzeResult | null {
  const hit = CACHE.get(k);
  if (!hit) return null;
  /* 命中了就挪到最近使用（Map 保持插入顺序，删了重插即可） */
  CACHE.delete(k);
  CACHE.set(k, hit);
  return hit;
}

function cacheSet(k: string, v: AnalyzeResult) {
  CACHE.set(k, v);
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 四轴的中文说明 —— 给 LLM 的 prompt 用，也给人看 */
const AXIS_HINT: Record<AxisName, string> = {
  共鸣: "在意对方感受、愿意先接住情绪的程度",
  锐度: "直接、不回避冲突、敢拆对方台的程度",
  幽默: "俏皮、玩梗、撒娇、把话说过头的程度",
  严谨: "讲结构、讲证据、不糊弄、不粉饰的程度",
};

/* ══════════════ L1 · 正则 ══════════════ */

export function analyzeWithRules(text: string, personaId: PersonaId): AnalyzeResult {
  const m = analyzePersonaConfig(text, personaId, {
    label: "人格文本",
    source: "local",
    origin: "粘贴 / 导入",
  });
  return {
    axes: m.byAxis as Partial<StaticAxes>,
    deltas: m.deltas,
    engine: "l1",
    coverage: m.coverage,
  };
}

/* ══════════════ L2 · LLM ══════════════ */

/**
 * 给 LLM 的 prompt。
 *
 * 这里的**长度和结构是试出来的**，不是随便写的：
 *   deepseek-flash 面对「要求堆太多」的 prompt 不会报错，会**直接返回空字符串**。
 *   实测：只提 evidence 要求而不给格式示例 → 0 字符；给了完整示例 → 118 字符且正确。
 *
 * 所以原则是：**要求合并成一句，格式示例给全，别列 1234。**
 */
function buildPrompt(text: string): string {
  const axisLines = AXIS_ORDER.map((a) => `${a} = ${AXIS_HINT[a]}`).join("；");

  return [
    "读下面这段 AI 角色设定，判断它在四个轴上相对中性偏了多少（每个 -28 到 +28 的整数，正数更强、负数更弱）。",
    "",
    axisLines + "。",
    "",
    /*
     * 这里千万别写「evidence 必须是从原文原样摘的短句」这类要求。
     * 实测 deepseek-flash 会因此**直接返回空字符串**（不报错、不拒绝）。
     * 格式示例里已经有 evidence 字段，模型自然会填 —— 而且填的就是原文片段。
     */
    "只输出 JSON，不要解释。",
    '{"axes":{"共鸣":0,"锐度":0,"幽默":0,"严谨":0},"evidence":{"共鸣":"","锐度":"","幽默":"","严谨":""}}',
    "",
    "人格文本：",
    '"""',
    text.slice(0, 6000),
    '"""',
  ].join("\n");
}

/** 空回复兜底用的极简 prompt —— 只要 axes，不要 evidence */
function buildPromptMinimal(text: string): string {
  return [
    "判断这段 AI 人格在四个轴上相对中性偏多少（-28 到 +28 的整数）。只输出 JSON：",
    '{"axes":{"共鸣":0,"锐度":0,"幽默":0,"严谨":0}}',
    "",
    "文本：",
    text.slice(0, 4000),
  ].join("\n");
}

/**
 * 从模型回复里把 JSON 抠出来。
 *
 * **这个函数必须能扛住脏输出。** 之前的版本只做「取第一个 { 到最后一个 }」
 * 再 JSON.parse，一旦模型在 evidence 的字符串里写了一个未转义的引号或换行，
 * 整条解析就失败 —— 而 axes 其实完全正常，用户看到的却是「没返回有效结果」。
 *
 * 三级策略：
 *   ① 原样解析（干净的回复走这条）
 *   ② 清掉字符串里的裸控制字符再解析
 *   ③ 放弃 evidence，正则只抠 "axes":{...} 里的四个数
 *
 * 第三级是保底：**拿不到依据也要拿到数值**，因为数值才是用户要的东西。
 */
function extractJson(raw: string): Record<string, unknown> | null {
  let s = raw.trim();

  /* ```json ... ``` */
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const body = s.slice(a, b + 1);

  /* ① 原样 */
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    /* 继续 */
  }

  /* ② 裸控制字符（换行 / 制表）出现在字符串里会让 JSON 非法 —— 换成空格 */
  try {
    return JSON.parse(body.replace(/[\u0000-\u001f]+/g, " ")) as Record<string, unknown>;
  } catch {
    /* 继续 */
  }

  /* ③ 只抠 axes，evidence 放弃 */
  const axisBlock = body.match(/"(?:axes)"\s*:\s*\{([\s\S]*?)\}/);
  if (!axisBlock) return null;

  const axes: Record<string, number> = {};
  const pair = /"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = pair.exec(axisBlock[1])) !== null) {
    axes[m[1]] = Number(m[2]);
  }
  if (Object.keys(axes).length === 0) return null;

  /* 没有 evidence，但数值拿到了 —— 比整条丢掉强 */
  return { axes, evidence: {} };
}

/**
 * 把模型给的数**量化到 5 的倍数**。
 *
 * 理由：模型对同一段文本，两次可能给 +6 和 +8 —— 那是同一个判断的两种表达，
 * 不是两个不同的测量结果。把 +6 和 +8 都显示成精确数字，等于向用户
 * 承诺一个它给不了的精度。
 *
 * 量化后：6 → 5、8 → 10、18 → 20。看起来更一致，也更诚实。
 * |Δ| < 3 视为 0（太小，不值得动滑块）。
 */
const clampDelta = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(-AXIS_CAP, Math.min(AXIS_CAP, n));
  if (Math.abs(clamped) < 3) return 0;
  return Math.round(clamped / 5) * 5;
};

/**
 * 用 LLM 解析。
 *
 * 需要「API 接入」里有可用凭据 —— 不给的话直接返回 error，不弹窗不带路。
 * modelId 不填就用该凭据的第一个模型。
 */
export async function analyzeWithLlm(
  text: string,
  personaId: PersonaId,
  opts: {
    credentialId?: string;
    modelId?: string;
    signal?: AbortSignal;
    /**
     * 采样几次取中位数。
     *
     * 1 = 快（4–6 s），但同一段文本两次可能差 5 分 —— LLM 不是确定性函数，
     *     temperature: 0 也修不掉。
     * 3 = 试图用中位数压掉波动，**但实测不可靠**：连续调用会被模型端
     *     静默限流（返回空），3 次里常常只成功 1 次，等于白等。
     *
     * 所以默认 1。把「有波动」这件事交给 UI 说清楚，而不是假装能消除。
     * 如果以后换到限流宽松的端点，可以把这里调成 3。
     */
    samples?: number;
  } = {}
): Promise<AnalyzeResult> {
  const empty: AnalyzeResult = { axes: {}, deltas: [], engine: "l2", coverage: 0 };

  /* 找凭据：① 指定的 ② 按模型名反查 ③ 第一套有 key 的 */
  let cred = null as ReturnType<typeof resolveCredential>;
  if (opts.credentialId) {
    cred = resolveCredential(opts.modelId ?? "", opts.credentialId);
  }
  if (!cred && opts.modelId) {
    cred = resolveCredential(opts.modelId);
  }
  if (!cred) {
    /*
     * 调用方没指定 —— 这在「从人格文本解析」里是常态。
     * 以前这里没有兜底，于是明明配了三套凭据也会报「没有可用的」。
     */
    cred = loadCredentials().find((c) => !!c.apiKey) ?? null;
  }

  if (!cred || !cred.apiKey) {
    return { ...empty, error: "没有可用的 API 凭据 —— 先去「API 接入」配一套" };
  }

  const model = opts.modelId || cred.models?.[0]?.id;
  if (!model) {
    return { ...empty, error: `「${cred.label}」下面没有模型 —— 去 API 接入里重新拉一次` };
  }

  /* 命中缓存直接返回 —— 同一段文本不会算出两个不同答案，也不再烧 token */
  const samples = Math.max(1, Math.min(5, Math.round(opts.samples ?? 1)));
  const ck = cacheKey("l2", `${model}:s${samples}`, text);
  const cached = cacheGet(ck);
  if (cached) return cached;

  /* 节流：距离上次请求太近就等一会儿，避免撞上模型端的静默限流 */
  const wait = nextAllowedAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextAllowedAt = Date.now() + MIN_GAP_MS;

  const call = async (content: string): Promise<string> => {
    let acc = "";
    const req = {
      model,
      messages: [{ role: "user", content }] as ChatMsg[],
      baseUrl: cred.baseUrl,
      apiKey: cred.apiKey,
      /* 0 —— 解析是测量不是创作。虽然 LLM 不保证完全确定，
         但 0 比 0.2 稳定得多；剩下的波动靠下面「量化到 5」和 UI 说明来消化 */
      temperature: 0,
      maxTokens: 900,
      signal: opts.signal,
    };
    const iter = hasMainProcessLlm() ? chatViaMain(req) : chat(req);
    for await (const chunk of iter) acc += chunk;
    return acc;
  };

  /** 跑一次，拿到解析后的原始值（未量化） */
  const runOnce = async (): Promise<{
    raw: Record<string, number>;
    evidence: Record<string, string>;
  } | null> => {
    let out = "";
    try {
      out = await call(buildPrompt(text));

      /*
       * 兜底一：空回复。
       * 某些模型（实测 deepseek-flash）在指令太密时会**直接返回空**，不报错也不拒绝。
       */
      if (!out.trim()) out = await call(buildPromptMinimal(text));
    } catch (e) {
      throw e;
    }

    if (!out.trim()) return null;

    let json = extractJson(out);

    /*
     * 兜底二：解析失败。
     * 模型在 evidence 里写了未转义的引号 / 换行时，整条 JSON 就废了 ——
     * 这时候换极简 prompt（不要 evidence）再问一次，它给的结构一定干净。
     */
    if (!json) {
      const retry = await call(buildPromptMinimal(text));
      if (retry.trim()) json = extractJson(retry);
    }

    if (!json) return null;

    const ra = (json.axes ?? {}) as Record<string, unknown>;
    const re = (json.evidence ?? {}) as Record<string, unknown>;

    const raw: Record<string, number> = {};
    const evidence: Record<string, string> = {};
    for (const axis of AXIS_ORDER) {
      const n = typeof ra[axis] === "number" ? (ra[axis] as number) : Number(ra[axis]);
      raw[axis] = Number.isFinite(n) ? n : 0;
      evidence[axis] = typeof re[axis] === "string" ? (re[axis] as string).trim() : "";
    }
    return { raw, evidence };
  };

  /* 采样：跑 samples 次，每轴取中位数 */
  const runs: { raw: Record<string, number>; evidence: Record<string, string> }[] = [];
  let lastErr: unknown = null;

  for (let i = 0; i < samples; i++) {
    if (i > 0) {
      /* 采样之间也要间隔，否则连续请求会被静默限流 */
      const w = nextAllowedAt - Date.now();
      if (w > 0) await sleep(w);
      nextAllowedAt = Date.now() + MIN_GAP_MS;
    }
    /*
     * 每次采样内部再重试 3 轮。
     *
     * 起因：实测**冷启动后的第一个请求必失败**（主 prompt 和极简兜底都返回空），
     * 第二个请求就正常。像连接池/TLS 还在建。这不是模型的问题，是链路冷启动。
     *
     * 所以不能「试一次就放弃」—— 否则用户从此处开的第一个解析永远失败。
     */
    let r: Awaited<ReturnType<typeof runOnce>> = null;
    for (let attempt = 0; attempt < 3 && !r; attempt++) {
      if (attempt > 0) await sleep(1200);
      try {
        r = await runOnce();
      } catch (e) {
        lastErr = e;
      }
    }
    if (r) runs.push(r);
  }

  if (runs.length === 0) {
    if (lastErr) {
      return { ...empty, error: `调用 ${model} 失败：${(lastErr as Error).message?.slice(0, 120)}` };
    }
    return {
      ...empty,
      error: `${model} 没返回有效结果 —— 换个大点的模型，或者改用 L1`,
    };
  }

  /* 每个轴取中位数，再量化 */
  const axes: Partial<StaticAxes> = {};
  const deltas: AxisDelta[] = [];

  for (const axis of AXIS_ORDER) {
    const vals = runs.map((r) => r.raw[axis]).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const amount = clampDelta(med);
    if (amount === 0) continue;
    axes[axis] = amount;
    /* 依据取第一次有内容的 —— 采样多次时它们说的其实是一回事 */
    const ev = runs.map((r) => r.evidence[axis]).find((s) => s && s.length > 0) ?? "";
    deltas.push({ axis, amount, reason: `模型判断${samples > 1 ? `（${runs.length} 次取中位）` : ""}`, snippet: ev.slice(0, 120) });
  }

  /* 覆盖率：有依据的轴数 / 4，再乘上「模型有没有给出任何非零判断」 */
  const withEvidence = deltas.filter((d) => d.snippet.length > 0).length;
  const coverage = deltas.length === 0 ? 0 : Math.min(1, 0.3 + (withEvidence / 4) * 0.7);

  const result: AnalyzeResult = { axes, deltas, engine: "l2", coverage };
  cacheSet(ck, result);
  return result;
}

/* ══════════════ 统一入口 ══════════════ */

export async function analyzePersonaText(
  text: string,
  personaId: PersonaId,
  engine: AnalyzeEngine,
  opts: { credentialId?: string; modelId?: string; signal?: AbortSignal } = {}
): Promise<AnalyzeResult> {
  if (!text.trim()) {
    return { axes: {}, deltas: [], engine, coverage: 0, error: "文本是空的" };
  }
  if (engine === "l2") return analyzeWithLlm(text, personaId, opts);
  return analyzeWithRules(text, personaId);
}
