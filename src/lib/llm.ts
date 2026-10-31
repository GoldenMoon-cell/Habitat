/**
 * 统一的 LLM 调用层。
 *
 * 为什么要有这一层：
 *   后端可能换 —— Ollama 本地、OpenAI 兼容、AstrBot、DSH。
 *   上层（发消息的地方）不该知道这些差异，它只想要「一个字一个字吐出来」。
 *
 * 两种流格式：
 *   Ollama      POST /api/chat          → NDJSON，每行 {"message":{"content":"..."},"done":false}
 *   OpenAI 兼容  POST /v1/chat/completions → SSE，`data: {"choices":[{"delta":{"content":"..."}}]}`
 *
 * 浏览器里直连远程 API 会被 CORS 拦。Electron 里走主进程（main.cjs 的 llm:chat）。
 */

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMsg[];
  /** 不带就按 model 猜 */
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  /** 供应商回报真实用量时回调 —— 可能一次都不触发（有些中转站不返回） */
  onUsage?: (u: Usage) => void;
  /** 上限（token）。超了由服务商报错，第四层学习会接住 */
  maxTokens?: number;
  signal?: AbortSignal;
}

export type LLMBackend = "ollama" | "openai";

/**
 * 供应商回报的**真实**用量。
 *
 * 为什么必须有这个：
 *
 * `tokens.ts` 里的 `estimateTokens()` 是按字数估的 —— 它只数「消息文本」，
 * 数不到 system prompt、人格设定、记忆注入、每条消息的格式开销。
 * 那些加起来常常比对话本身还多，所以估算值是**系统性偏低**的。
 *
 * 而 OpenAI / Anthropic / Ollama 的响应里本来就带着真实数字，
 * 我们以前直接把它丢了。
 *
 * **有真数就用真数；没有才退回估算，而且界面上要标出「≈」。**
 */
export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export function guessBackend(baseUrl: string): LLMBackend {
  const b = baseUrl.toLowerCase();
  if (b.includes("11434") || b.includes("/api/chat") || b.includes("localhost:1234") === false && b.includes("ollama")) {
    return "ollama";
  }
  if (b.includes("11434")) return "ollama";
  return "openai";
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/* ─────────────────────────── Ollama ─────────────────────────── */

async function* streamOllama(base: string, opts: ChatOptions): AsyncGenerator<string> {
  const url = /\/api\/chat$/.test(base) ? base : `${trimSlash(base)}/api/chat`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.8,
        ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => "")}`);
  }
  if (!res.body) throw new Error("Ollama 没有返回流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        const piece = j?.message?.content;
        if (typeof piece === "string" && piece) yield piece;
        if (j?.done) return;
      } catch {
        /* 半行 / 非 JSON，跳过 */
      }
    }
  }
}

/* ────────────────────── OpenAI 兼容（SSE）────────────────────── */

async function* streamOpenAI(base: string, opts: ChatOptions): AsyncGenerator<string> {
  const b = trimSlash(base);
  const url = /\/chat\/completions$/.test(b) ? b : `${b}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      /*
       * 让最后一块带上 usage。
       *
       * 这是 OpenAI 协议的扩展项：不发它，流式响应里就不会出现 usage。
       * 部分中转站不支持 —— 不支持时字段直接不出现，不会报错。
       */
      stream_options: { include_usage: true },
      temperature: opts.temperature ?? 0.8,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });

  if (!res.ok) {
    /* 400 的正文里通常有真实上限，原样抛给上层让 learnFromError 接住 */
    throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  }
  if (!res.body) throw new Error("接口没有返回流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const j = JSON.parse(data);

        /* 真数优先：这一块可能只有 usage 没有 content */
        if (j?.usage && opts.onUsage) {
          opts.onUsage({
            promptTokens: j.usage.prompt_tokens,
            completionTokens: j.usage.completion_tokens,
            totalTokens: j.usage.total_tokens,
          });
        }

        const piece = j?.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) yield piece;
      } catch {
        /* 跳过 */
      }
    }
  }
}

/* ─────────────────────────── 入口 ─────────────────────────── */

/**
 * 逐块吐文本。上层 for await 就行。
 *
 * 后端选择：
 *   传了 baseUrl → 按 URL 猜
 *   Electron 里 → 走主进程（绕 CORS），见 electronLlm()
 */
export async function* chat(opts: ChatOptions): AsyncGenerator<string> {
  const base = opts.baseUrl?.trim();
  if (!base) throw new Error("没有配置 Base URL（设置 → 引擎 → 接口地址）");

  if (guessBackend(base) === "ollama") {
    yield* streamOllama(base, opts);
  } else {
    yield* streamOpenAI(base, opts);
  }
}

/* ─────────────────── Electron 主进程通道（绕 CORS）─────────────────── */

/**
 * 在 Electron 里调用时走这条：主进程发请求，逐块推回渲染进程。
 * 浏览器预览没有 window.desktop.llmChat，会返回 false。
 */
export function hasMainProcessLlm(): boolean {
  return typeof window !== "undefined" && typeof window.desktop?.llmChat === "function";
}

export async function* chatViaMain(opts: ChatOptions): AsyncGenerator<string> {
  if (!window.desktop?.llmChat) throw new Error("不在 Electron 里");

  const got = await window.desktop.llmChat({
    model: opts.model,
    messages: opts.messages,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  });

  /*
   * 主进程回的是 `{ chunks, usage }`。
   *
   * 兼容旧形状（字符串数组）：旧版 preload 还在缓存里时也能跑，
   * 只是拿不到 usage。
   */
  const chunks = Array.isArray(got) ? got : (got?.chunks ?? []);
  if (!Array.isArray(got) && got?.usage && opts.onUsage) opts.onUsage(got.usage);

  for (const c of chunks) yield c;
}
/* ─────────────────── 健康探测 ─────────────────── */

export interface LLMProbe {
  ok: boolean;
  baseUrl: string;
  /** 服务端报告有几个模型 */
  count?: number;
  error?: string;
}

/**
 * 探一次 Ollama 是否活着。
 *
 * 启动时调一次，结果决定发消息时走真实调用还是退回 mock。
 * 每次发消息都探太慢（多一次往返）。
 */
export async function probeOllama(baseUrl = "http://localhost:11434"): Promise<LLMProbe> {
  const b = trimSlash(baseUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);

  try {
    const res = await fetch(`${b}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, baseUrl: b, error: `HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    const n = Array.isArray(json?.models) ? json.models.length : 0;
    return { ok: true, baseUrl: b, count: n };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      baseUrl: b,
      error: err.name === "AbortError" ? "2.5s 没响应" : "连不上",
    };
  } finally {
    clearTimeout(timer);
  }
}