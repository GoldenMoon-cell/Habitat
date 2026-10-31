/**
 * 把各家 LLM 五花八门的报错压成一句人话。
 *
 * 原始错误长这样，直接怼给用户没有意义：
 *
 *   503: {"error":{"message":"No available accounts: no available accounts
 *         supporting model: claude-sonnet-5-5 (chan)"}}
 *
 * 用户需要知道的是三件事：
 *   ① 出什么事了（一句话）
 *   ② 换个模型会不会好（这决定要不要自动重试）
 *   ③ 是不是自己配错了
 *
 * 中转站的错误格式不统一（OpenAI 风格 / 自研风格 / 网关风格），
 * 所以这里靠关键字归类，认不出来就原样截断 —— 不编。
 */

export interface LlmErrorInfo {
  /** 给用户看的一句话 */
  brief: string;
  /** 原始消息（截断），放 tooltip 或控制台 */
  detail: string;
  /** 换成同家族的别的模型可能就好了 */
  retryable: boolean;
  /** 是上下文超限 —— 调用方可以顺手学一下真实上限 */
  contextIssue: boolean;
  /** 归类结果，便于埋点/统计 */
  kind:
    | "channel"
    | "overload"
    | "ratelimit"
    | "context"
    | "auth"
    | "model"
    | "network"
    | "shape"
    | "unknown";
}

const LIMIT = 220;

/** 从任意字符串里揪出第一个 JSON 对象并解析 */
function pickJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 挖出各家放在不同位置的消息字段 */
function pickMessage(j: Record<string, unknown> | null): string {
  if (!j) return "";
  const e = j.error as Record<string, unknown> | string | undefined;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const m = (e as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  if (typeof j.message === "string") return j.message;
  if (typeof j.msg === "string") return j.msg;
  if (typeof j.detail === "string") return j.detail;
  return "";
}

export function explainLlmError(raw: unknown): LlmErrorInfo {
  const detail = String((raw as Error)?.message ?? raw ?? "");
  const json = pickJson(detail);
  const msg = pickMessage(json) || detail;
  const hay = `${detail} ${msg}`.toLowerCase();

  const mk = (
    kind: LlmErrorInfo["kind"],
    brief: string,
    retryable: boolean,
    contextIssue = false
  ): LlmErrorInfo => ({ kind, brief, detail: detail.slice(0, LIMIT), retryable, contextIssue });

  /* 中转站渠道空了 —— 最常见的一种，换同家族模型通常能绕开 */
  if (/no available accounts?|no available channel|无可用渠道|渠道/.test(hay)) {
    return mk("channel", "这个中转站现在没有可用账号支持这个模型（渠道空了或额度用完）", true);
  }
  if (/model.*(not found|not exist|does not exist|unsupported)|no such model|不支持该模型/.test(hay)) {
    return mk("model", "这个模型在服务端不存在（可能已下线或名字写错）", true);
  }
  if (/rate.?limit|too many requests|429|请求过于频繁|频率限制/.test(hay)) {
    return mk("ratelimit", "请求太频繁，被限流了", true);
  }
  if (/overload|502|503|504|bad gateway|service unavailable|upstream/.test(hay)) {
    return mk("overload", "上游服务暂时不可用", true);
  }
  if (/context.*(length|window|limit)|too long|maximum.*token|exceed.*token|上下文/.test(hay)) {
    return mk("context", "上下文超出模型上限了", false, true);
  }
  if (/invalid.*(api.?)?key|unauthorized|401|403|authentication|key.*invalid/.test(hay)) {
    return mk("auth", "Key 被拒绝（无效、过期或没有权限）", false);
  }
  if (/timeout|timed out|abort|econnrefused|enotfound|fetch failed|network/.test(hay)) {
    return mk("network", "连不上，可能是网络或端点地址的问题", true);
  }
  if (/empty|空内容/.test(hay)) {
    return mk("shape", "模型返回了空内容", true);
  }

  return mk("unknown", msg.slice(0, 120) || "调用失败", false);
}
