/**
 * API 凭据。
 *
 * 存在 localStorage 里，**明文**。
 *
 * 为什么不加密：
 *   纯前端项目没有安全的密钥存储 —— 用固定密钥加密等于没加密，
 *   而真正的安全感需要 OS 级 keystore（Electron 的 safeStorage 能做，
 *   但那样浏览器预览就读不到，两条路径会分叉）。
 *
 * 所以选择：**明文存本机，并在 UI 上明确写出来**。
 * 用户知道自己在哪存了什么，比一个假的"已加密"更诚实。
 *
 * 唯一不做的事：**永远不把 key 发到任何地方，除了用户自己填的那个 baseUrl**。
 */

/**
 * 一套 API 凭据 = 一个 baseUrl + 一个 Key + **它提供的模型列表**。
 *
 * 为什么凭据要带模型列表：
 *   中转站一个 Key 能出几十个模型（还分不同分组、不同厂商）。
 *   如果凭据只记 baseUrl 和 key，选模型时就无法判断「这个模型走哪套凭据」——
 *   结果就是拿 claude-sonnet 去请求 api.deepseek.com。
 */
export interface ApiCredential {
  /** 内部 id，用于多套配置 */
  id: string;
  /** 显示名 */
  label: string;
  /** 例：https://api.deepseek.com/v1 */
  baseUrl: string;
  /** 明文 key */
  apiKey: string;
  /** 上次测试时间戳 */
  testedAt?: number;
  /** 这个端点能提供哪些模型 —— 拉取时记下 */
  models: CredentialModel[];
  /** 中转站可按分组归类（读不到就空） */
  groups?: { name: string; models: string[] }[];
}

/** 凭据下的一个模型 */
export interface CredentialModel {
  /** 调用时用的 id，例 "deepseek-flash" */
  id: string;
  /** 服务端报的上下文窗口。没有就是 undefined */
  contextWindow?: number;
  /** 中转站的分组名（如果模型名带前缀能解析出来） */
  group?: string;
}

const KEY = "3w:credentials";

/* ══════════════════════════════════════════════════════════════
   加密层

   磁盘上存的是 `enc:v1:<base64>`（OS 级加密：DPAPI / Keychain / libsecret）。
   内存里是明文 —— 因为发请求必须用明文。

   为什么用「启动时解密进缓存」而不是把 loadCredentials 改成异步：
     loadCredentials() 被几十处同步调用（渲染、resolveCredential、UI）。
     把它改成 Promise 会传染整个调用链。缓存方案只在一个地方异步。
   ══════════════════════════════════════════════════════════════ */

const ENC_PREFIX = "enc:v1:";

/** 解密后的凭据（明文）。null = 还没 hydrate 过 */
let cache: ApiCredential[] | null = null;

/** 主进程是否支持加密（浏览器预览里是 false） */
let cryptoReady = false;

function isEncrypted(v: string) {
  return typeof v === "string" && v.startsWith(ENC_PREFIX);
}

/** 当前是不是真的加密存着 */
export function isCredentialEncryptionOn() {
  return cryptoReady;
}

function readRaw(): ApiCredential[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ApiCredential =>
        !!c && typeof c === "object" && typeof c.baseUrl === "string" && typeof c.apiKey === "string"
    );
  } catch {
    return [];
  }
}

/** 异步：加密后写回 localStorage。密文进磁盘，明文只在内存 */
function persistEncrypted(list: ApiCredential[]) {
  const d = typeof window !== "undefined" ? window.desktop : undefined;
  void (async () => {
    const out: ApiCredential[] = [];
    for (const c of list) {
      const copy = { ...c };
      if (cryptoReady && copy.apiKey && !isEncrypted(copy.apiKey)) {
        const enc = await d?.cryptoEncrypt?.(copy.apiKey);
        if (enc) copy.apiKey = ENC_PREFIX + enc;
        else {
          /* 加密失败 → 宁可不写，也不把明文落盘 */
          console.warn("[cred] 加密失败，本次不落盘");
          return;
        }
      }
      out.push(copy);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      /* 配额满 */
    }
  })();
}

/**
 * 启动时调一次（在 mount 之前）。
 *
 * 三件事：
 *   ① 探测 OS 加密是否可用
 *   ② 把磁盘上的密文解成明文放进缓存
 *   ③ 如果发现存量明文（老版本遗留），顺手加密重写
 */
export async function hydrateCredentials(): Promise<{
  encrypted: boolean;
  migrated: number;
  failed: number;
}> {
  const d = typeof window !== "undefined" ? window.desktop : undefined;

  cryptoReady = false;
  try {
    cryptoReady = !!(await d?.cryptoAvailable?.());
  } catch {
    cryptoReady = false;
  }

  const list = readRaw();
  let migrated = 0;
  let failed = 0;

  for (const c of list) {
    const v = c.apiKey;
    if (!v) continue;
    if (isEncrypted(v)) {
      const plain = await d?.cryptoDecrypt?.(v.slice(ENC_PREFIX.length));
      if (plain === null || plain === undefined) {
        /* 换机器 / 换系统账户 / 系统重置密钥 → 解不开 */
        failed++;
        c.apiKey = "";
      } else {
        c.apiKey = plain;
      }
    } else if (cryptoReady) {
      migrated++;
    }
  }

  cache = list;

  if (migrated > 0) {
    persistEncrypted(list);
    console.info(`[cred] 已把 ${migrated} 套明文凭据加密（${cryptoReady ? "OS 级" : "无加密可用"}）`);
  }

  return { encrypted: cryptoReady, migrated, failed };
}

export function loadCredentials(): ApiCredential[] {
  /* 正常路径：hydrateCredentials() 已经把明文放进缓存 */
  if (cache) return cache;

  /* 兜底（理论上不该走到）：还没 hydrate 就有人来读 */
  return readRaw();
}

export function saveCredentials(list: ApiCredential[]) {
  cache = list;
  if (cryptoReady) {
    persistEncrypted(list);
  } else {
    /* 浏览器预览 / 加密不可用 → 只能明文，UI 上要说明 */
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* 配额满 / 隐私模式：调用方会看到没生效 */
    }
  }
}

export function upsertCredential(c: ApiCredential): ApiCredential[] {
  const list = loadCredentials();
  const i = list.findIndex((x) => x.id === c.id);
  if (i >= 0) list[i] = c;
  else list.push(c);
  saveCredentials(list);
  return list;
}

export function removeCredential(id: string): ApiCredential[] {
  const list = loadCredentials().filter((x) => x.id !== id);
  saveCredentials(list);
  return list;
}

/** 打码显示：sk-abcd...wxyz */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/** 预设端点，减少手打 */
/**
 * 预设端点。
 *
 * 只收 **OpenAI 兼容格式**（`POST {base}/chat/completions`）的服务 ——
 * 因为 `lib/llm.ts` 只实现这一种协议。
 *
 * Anthropic 官方也收进来了 —— `electron/main.cjs` 的 `llm:chat` 里有单独分支，
 * 会把 system 拆成顶层字段、换 x-api-key 鉴权、从 content 数组里取正文。
 *
 * Ollama 保留 —— 它是「聊天后端」，和砍掉的解析引擎 L4 不是一件事。
 */
export const PRESET_ENDPOINTS = [
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  /* 直连官方：走 Anthropic Messages 协议，代码里已单独适配 */
  { label: "Claude 官方", baseUrl: "https://api.anthropic.com" },
  { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "Kimi", baseUrl: "https://api.moonshot.cn/v1" },
  { label: "Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { label: "中转站", baseUrl: "" },
  { label: "Ollama 本地", baseUrl: "http://localhost:11434" },
];

/* ══════════════════════════════════════════════════════════════
   模型 → 凭据的解析
   ══════════════════════════════════════════════════════════════ */

/**
 * 模型名归一化。
 *
 * 各家写法不统一，同一个东西能写出四种样子：
 *   claude-sonnet-4.6  /  claude-sonnet-4-6  /  Claude_Sonnet_4_6
 *   gpt-5.6-terra      /  gpt-5_6_terra
 *
 * 不归一化的话，「点名要的模型」和「凭据里有的模型」永远对不上，
 * 用户看到的现象是「配了凭据但角色还是回假话」。
 */
function normModel(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[._\s/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 按模型名找能提供它的凭据。
 *
 * 顺序（从可信到模糊）：
 *   1. 角色显式绑定的 credentialId —— 最可信，给了就用
 *   2. 归一化后精确相等
 *   3. 同家族前缀：要 gpt-5，凭据有 gpt-5.1 / gpt-5.2 … → 取名字最短的
 *      （最短 = 最接近泛型号，不经手一堆 -thinking / -compact 后缀）
 *   4. baseUrl 里带厂商名
 *   5. 都没有 → null
 *
 * **绝不「随便挑一个」**：拿 DeepSeek 的 key 去请求 Claude 的模型，
 * 只会得到一个 400，比明确说「找不到」更浪费用户时间。
 */
export function resolveCredential(
  modelId: string,
  boundId?: string
): ApiCredential | null {
  const list = loadCredentials();
  if (list.length === 0) return null;

  if (boundId) {
    const hit = list.find((c) => c.id === boundId);
    if (hit) return hit;
  }

  const want = normModel(modelId);

  /* ② 归一化后精确相等 */
  const exact = list.find((c) => c.models?.some((m) => normModel(m.id) === want));
  if (exact) return exact;

  /* ③ 同家族前缀。require want 是一个完整的词段前缀，
     避免 gpt-5 命中 gpt-50 这种。 */
  const family: { cred: ApiCredential; id: string }[] = [];
  for (const c of list) {
    for (const m of c.models ?? []) {
      const n = normModel(m.id);
      if (n.startsWith(`${want}-`)) family.push({ cred: c, id: n });
    }
  }
  if (family.length > 0) {
    family.sort((a, b) => a.id.length - b.id.length);
    return family[0].cred;
  }

  /* ④ 反向前缀：角色写 gpt-5.1，凭据只给了 gpt-5（罕见但存在） */
  const reverse = list.find((c) =>
    c.models?.some((m) => want.startsWith(`${normModel(m.id)}-`))
  );
  if (reverse) return reverse;

  /* ⑤ baseUrl 带厂商名 */
  const providers: [RegExp, RegExp][] = [
    [/^deepseek/i, /deepseek/i],
    [/^claude/i, /anthropic|claude/i],
    [/^(gpt|o1|o3|chatgpt)/i, /openai|chatgpt/i],
    [/^gemini/i, /google|gemini/i],
    [/^grok/i, /xai|grok/i],
    [/^qwen/i, /aliyun|dashscope|qwen/i],
    [/^kimi|^moonshot/i, /moonshot|kimi/i],
  ];
  for (const [modelRe, baseRe] of providers) {
    if (!modelRe.test(modelId)) continue;
    const hit = list.find((c) => baseRe.test(c.baseUrl));
    if (hit) return hit;
  }

  /* 对不上就是 null。让上层明确告诉用户「模型找不到」，
     不要静默退回 mock 假装一切正常。 */
  return null;
}

/** 两个字符串的公共前缀长度 —— 用来判断「哪个备选最接近原型号」 */
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * 找「同家族的备选模型」。
 *
 * 用在中转站某个模型挂了的时候：`claude-sonnet-5-5` 报
 * 「No available accounts」，但 `claude-sonnet-5` 或 `claude-sonnet-4-6`
 * 往往还活着。换一个能说话，比整个角色死掉好。
 *
 * 排序不是按字母，也不是按长度 —— 按**和原型号的公共前缀长度**。
 * `claude-sonnet-5` 和 `claude-sonnet-5-5` 共享 15 个字符，
 * `claude-sonnet-4-6` 只共享 14 个，所以前者优先。这符合直觉：
 * 名字越像，能力越接近。
 */
export function siblingModels(modelId: string, credId?: string, limit = 3): string[] {
  const creds = loadCredentials();
  const pool = credId ? creds.filter((c) => c.id === credId) : creds;

  const all = pool
    .flatMap((c) => c.models?.map((m) => m.id) ?? [])
    .filter((id) => id !== modelId);
  if (all.length === 0) return [];

  const want = normModel(modelId);
  const parts = want.split("-");

  /* 从最严到最松逐级放宽前缀：claude-sonnet-5- → claude-sonnet- → claude- */
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = `${parts.slice(0, i).join("-")}-`;
    const hits = all.filter((id) => normModel(id).startsWith(prefix));
    if (hits.length === 0) continue;

    hits.sort((a, b) => commonPrefixLen(normModel(b), want) - commonPrefixLen(normModel(a), want));
    return hits.slice(0, limit);
  }

  return [];
}

/** 所有凭据的所有模型，带来源标签。给「选模型」界面用 */
export interface ModelOption {
  id: string;
  contextWindow?: number;
  /** 哪个凭据提供的 */
  credentialId: string;
  credentialLabel: string;
  /** 中转站的分组 */
  group?: string;
}

export function allModelOptions(): ModelOption[] {
  const out: ModelOption[] = [];
  for (const c of loadCredentials()) {
    for (const m of c.models ?? []) {
      out.push({
        id: m.id,
        contextWindow: m.contextWindow,
        credentialId: c.id,
        credentialLabel: c.label,
        group: m.group,
      });
    }
  }
  return out;
}

/** 兼容旧调用：拿第一套凭据 */
export function activeCredential(): ApiCredential | null {
  const list = loadCredentials();
  return list.length > 0 ? list[0] : null;
}

/** 把拉取结果写进凭据 */
export function saveCredentialModels(
  id: string,
  models: { id: string; contextWindow?: number }[]
): ApiCredential[] {
  const list = loadCredentials();
  const hit = list.find((c) => c.id === id);
  if (hit) {
    hit.models = models.map((m) => ({ id: m.id, contextWindow: m.contextWindow }));
    hit.testedAt = Date.now();
    saveCredentials(list);
  }
  return list;
}
/* ── 已拉到的模型名，给控制台的 ai model 做候选 ── */

const MODELS_KEY = "3w:known-models";

/** 保存一次拉取结果（去重合并） */
export function rememberModels(ids: string[]) {
  try {
    const prev = loadKnownModels();
    const merged = Array.from(new Set([...prev, ...ids])).slice(0, 200);
    localStorage.setItem(MODELS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
}

export function loadKnownModels(): string[] {
  try {
    const raw = localStorage.getItem(MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}