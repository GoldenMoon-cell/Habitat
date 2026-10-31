/**
 * 从用户填的 API 端点拉取真实模型列表。
 *
 * 为什么要拉列表而不是猜名字：
 *   猜名字必然漏（私有部署、改了名的魔改版），而且猜错了后果是请求 400。
 *   正经客户端（DSH / Codex / Cline）都是拉列表让用户选。
 *
 * 各家字段不统一，这里做归一化：
 *   OpenAI 兼容   GET {base}/models        → { data: [{ id }] }
 *   OpenRouter    GET {base}/models        → { data: [{ id, context_length }] }
 *   Google Gemini GET {base}/models        → { models: [{ name, inputTokenLimit }] }
 *   Ollama        GET {base}/api/tags      → { models: [{ name }] }
 *
 * 只有部分服务商返回上下文长度。拉不到时交给 contextWindow.ts 的降级链。
 */

export interface RemoteModel {
  /** 调用时用的模型 ID */
  id: string;
  /** 服务商报告的上下文窗口（token）。没有就是 undefined */
  contextWindow?: number;
  ownedBy?: string;
  /** 从哪个端点拉到的 */
  origin: "openai" | "openrouter" | "google" | "ollama";
}

export type FetchError =
  | { kind: "cors"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "network"; message: string }
  | { kind: "shape"; message: string }
  | { kind: "timeout"; message: string };

export type FetchResult =
  | { ok: true; models: RemoteModel[]; endpoint: string }
  | { ok: false; error: FetchError };

const TIMEOUT_MS = 8000;

function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/** 猜各家要打哪个路径 */
function candidateEndpoints(baseUrl: string): { url: string; origin: RemoteModel["origin"] }[] {
  /* 有人会把完整端点（…/chat/completions）当 baseUrl 填进来，先削掉尾巴 */
  const b = trimSlash(baseUrl).replace(/\/(chat\/)?completions$/, "") || trimSlash(baseUrl);
  const out: { url: string; origin: RemoteModel["origin"] }[] = [];

  /* 用户填的已经是完整端点（带 /models 或 /api/tags）就原样打 */
  if (/\/(models|api\/tags)$/.test(b)) {
    out.push({ url: b, origin: b.endsWith("/api/tags") ? "ollama" : "openai" });
    return out;
  }

  /* Ollama 默认端口特殊处理：先试它的原生接口 */
  if (/:(11434)$/.test(b)) return [{ url: `${b}/api/tags`, origin: "ollama" }];

  /* 已经带版本段（/v1、/v1beta、/api/v1 …）→ 只拼 /models。
     OneAPI / NewAPI / OpenAI / DeepSeek / OpenRouter 都是这个规矩，
     不存在「再补一层版本号」的填法。 */
  if (/\/v\d+[a-z0-9]*$/i.test(b)) return [{ url: `${b}/models`, origin: "openai" }];

  /* 裸域名 → /v1/models；再兜一个 /models（部分站两个都通） */
  out.push({ url: `${b}/v1/models`, origin: "openai" });
  out.push({ url: `${b}/models`, origin: "openai" });

  return out;
}

/** 从各家不同的响应形状里抠出统一结构 */
function normalize(json: unknown, origin: RemoteModel["origin"]): RemoteModel[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;

  /* OpenAI / OpenRouter 风格 */
  if (Array.isArray(obj.data)) {
    const out: RemoteModel[] = [];
    for (const m of obj.data as unknown[]) {
      if (!m || typeof m !== "object") continue;
      const r = m as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      if (!id) continue;
      const ctx =
        typeof r.context_length === "number"
          ? r.context_length
          : typeof r.max_model_len === "number"
            ? r.max_model_len
            : typeof r.context_window === "number"
              ? r.context_window
              : undefined;
      out.push({
        id,
        contextWindow: ctx,
        ownedBy: typeof r.owned_by === "string" ? r.owned_by : undefined,
        origin,
      });
    }
    return out;
  }

  /* Google Gemini / Ollama 风格 */
  if (Array.isArray(obj.models)) {
    const out: RemoteModel[] = [];
    for (const m of obj.models as unknown[]) {
      if (!m || typeof m !== "object") continue;
      const r = m as Record<string, unknown>;
      const rawName =
        (typeof r.name === "string" && r.name) ||
        (typeof r.model === "string" && r.model) ||
        null;
      if (!rawName) continue;
      /* Google 返回 "models/gemini-2.5-pro"，去掉前缀 */
      const id = rawName.replace(/^models\//, "");
      const ctx =
        typeof r.inputTokenLimit === "number"
          ? r.inputTokenLimit
          : typeof r.num_ctx === "number"
            ? r.num_ctx
            : typeof r.context_length === "number"
              ? r.context_length
              : undefined;
      out.push({
        id,
        contextWindow: ctx,
        ownedBy: typeof r.owned_by === "string" ? r.owned_by : undefined,
        origin: origin === "openai" ? "ollama" : origin,
      });
    }
    return out;
  }

  return [];
}

/**
 * 拉模型列表。
 * 依次尝试几个可能的端点，第一个成功的返回。
 */
/**
 * 通过主进程拉模型 —— 绕开 CORS。
 *
 * 浏览器里 fetch 远程 API 会被同源策略拦，403 / CORS 错误都是这个原因。
 * 主进程是 Node，没有这个限制。
 *
 * 不在 Electron 里时返回 null，调用方回退到浏览器版。
 */
export async function fetchModelsViaMain(
  baseUrl: string,
  apiKey: string
): Promise<FetchResult | null> {
  if (typeof window === "undefined" || typeof window.desktop?.llmModels !== "function") {
    return null;
  }

  try {
    const r = await window.desktop.llmModels({ baseUrl, apiKey });
    /* 主进程把原始 body 带回来，这里复用同一套 normalize */
    const parsed = JSON.parse(r.body);
    const models = normalize(parsed, pickOrigin(r.url));
    if (models.length === 0) {
      return {
        ok: false,
        error: { kind: "shape", message: `连上了 ${r.url}，但没解析出模型` },
      };
    }
    return { ok: true, models, endpoint: r.url };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return {
      ok: false,
      error: {
        kind: /401|403/.test(msg) ? "auth" : /timeout|abort/i.test(msg) ? "timeout" : "network",
        message: msg,
      },
    };
  }
}

/** 从实际 URL 反推 origin 类型 */
function pickOrigin(url: string): RemoteModel["origin"] {
  if (url.includes("/api/tags")) return "ollama";
  if (url.includes("openrouter")) return "openrouter";
  if (url.includes("generativelanguage") || url.includes("google")) return "google";
  return "openai";
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<FetchResult> {
  if (!baseUrl.trim()) {
    return { ok: false, error: { kind: "network", message: "还没填 Base URL" } };
  }

  const candidates = candidateEndpoints(baseUrl);
  let lastError: FetchError | null = null;

  for (const c of candidates) {
    try {
      const res = await withTimeout(c.url, {
        method: "GET",
        headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
      });

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: { kind: "auth", message: `Key 被拒绝（HTTP ${res.status}）` },
        };
      }
      if (!res.ok) {
        /* 「连上了但解析不出模型」比「HTTP 404」有信息量得多，
           不要让后面的 404 把它盖掉。 */
        if (lastError?.kind !== "shape") {
          lastError = { kind: "network", message: `HTTP ${res.status} · ${c.url}` };
        }
        continue;
      }

      const json = await res.json().catch(() => null);
      const models = normalize(json, c.origin);

      if (models.length === 0) {
        lastError = { kind: "shape", message: `响应里没有模型列表 · ${c.url}` };
        continue;
      }

      /* 同一个 id 去重，带 contextWindow 的优先 */
      const byId = new Map<string, RemoteModel>();
      for (const m of models) {
        const prev = byId.get(m.id);
        if (!prev || (!prev.contextWindow && m.contextWindow)) byId.set(m.id, m);
      }

      return { ok: true, models: [...byId.values()], endpoint: c.url };
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        lastError = { kind: "timeout", message: `${TIMEOUT_MS / 1000}s 没响应 · ${c.url}` };
      } else if (err.message.includes("Failed to fetch") || err.name === "TypeError") {
        /* 浏览器里最常见的就是 CORS —— 但错误信息不会告诉你 */
        lastError = {
          kind: "cors",
          message: "被浏览器拦了（CORS）。远程 API 需要走 Electron 主进程，本地 Ollama 不受影响",
        };
      } else {
        lastError = { kind: "network", message: err.message };
      }
    }
  }

  return {
    ok: false,
    error: lastError ?? { kind: "network", message: "所有端点都没响应" },
  };
}
