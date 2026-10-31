/**
 * 数据留底：导出 / 导入 / 自动备份。
 *
 * 原则（见 docs/decisions.md D-011）：
 *   **localStorage 只是缓存，不是档案。**
 *
 *   浏览器里只能手动导出（没有文件系统权限）。
 *   Electron 里自动留底到 %APPDATA%/Habitat/data/。
 *
 * 为什么值得做：
 *   用户的角色档案、对话记录、配的 API 是花时间弄出来的。
 *   换入口、清缓存、file:// 换 http:// —— 任何一件事都能让它消失。
 */

import { log } from "./eventLog";
import { loadCredentials } from "../store/credentials";

/** 所有需要留底的 key */
export const DATA_KEYS = [
  "3w:threads",
  "3w:personas",
  "3w:groups",
  "3w:engine",
  "3w:credentials",
  "3w:dynamic-v1",
  /*
   * ── 三个之前漏掉的 ──
   *
   * 3w:memories     记忆。漏了它，换机器所有记忆全丢 —— 「提升权重」
   *                 和「忘掉」这些操作也跟着没了。
   * 3w:awaken-ledger 觉醒账本。漏了它，从备份恢复后指纹对不上，
   *                 会把一次合法恢复报成「外部篡改」。
   * 3w:events       真实事件日志（左栏那些红字）。
   */
  "3w:memories",
  "3w:awaken-ledger",
  "3w:events",
  "3w:mode",
  "3w:known-models",
  "3w:ctx-window-overrides",
  /*
   * ── 第四个漏掉的：档案 ──
   *
   * `3w:profile` 存的是**你的名字**，而名字是「定下之后就改不了」的。
   *
   * 不在这个清单里的后果，比上面三个都重：
   *
   *   localStorage 一旦丢（重装 / 换 Electron 存储目录 / 系统清理）
   *     → onboarded 补回来了，档案补不回来
   *     → 引导显示「已完成」，名字却是空的
   *     → 进应用后回退成兜底的「主人」，而且**再也没有机会重定**
   *
   * **一个不可改的东西，必须留底。**
   */
  "3w:profile",
  "3w:onboarded",
  /* 今日用量 —— 不珍贵，但丢了会让左栏那块凭空归零 */
  "3w:usage-daily",
  "3w:app-name",
  "3w:rail-collapsed",
] as const;

export const EXPORT_FORMAT = 1;

export interface DataBundle {
  /** 格式版本 —— 导入时校验 */
  format: number;
  /** 导出时间 */
  exportedAt: string;
  /** app 版本，便于排查 */
  appVersion?: string;
  /** key → 原始字符串（不做 JSON 二次解析，避免结构漂移） */
  data: Record<string, string | null>;
}

/* ══════════════ 导出 ══════════════ */

export interface CollectOptions {
  /**
   * 导出时怎么处理 API Key。
   *
   *   "strip"（默认）  整个 3w:credentials 不导出 —— 最安全，换机器后重填
   *   "plain"          解密成明文写进去 —— 换机器能直接用，但这份 JSON 谁拿到谁有
   *   "encrypted"      原样（密文）—— 只有本机本账户能解开，换机器就是废数据
   *
   * 自动存档（autosave）永远用 "encrypted"：那个文件就在本机，没必要明文。
   */
  secrets?: "strip" | "plain" | "encrypted";
}

export function collectData(opts: CollectOptions = {}): DataBundle {
  const mode = opts.secrets ?? "strip";
  const data: Record<string, string | null> = {};

  for (const k of DATA_KEYS) {
    try {
      data[k] = localStorage.getItem(k);
    } catch {
      data[k] = null;
    }
  }

  if (mode === "strip") {
    data["3w:credentials"] = null;
  } else if (mode === "plain") {
    /* 内存缓存里是明文。解密不了的那几套 apiKey 是空字符串，导出也没意义 */
    try {
      const list = loadCredentials().map((c) => ({ ...c }));
      data["3w:credentials"] = list.length > 0 ? JSON.stringify(list) : null;
    } catch {
      data["3w:credentials"] = null;
    }
  }
  /* "encrypted" → 保持 localStorage 里的原值不动 */

  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** 生成文件名：habitat-2026-10-24-1830.json */
export function bundleFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `habitat-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/** 浏览器里下载 */
export function downloadBundle(bundle = collectData()) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = bundleFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ══════════════ 导入 ══════════════ */

/** key → 给用户看的名字。数据层的知识，别散到各个组件里。 */
export const KEY_LABELS: Record<string, string> = {
  "3w:threads": "对话记录",
  "3w:personas": "角色档案",
  "3w:groups": "群聊",
  "3w:engine": "引擎配置",
  "3w:credentials": "API 凭据",
  "3w:dynamic-v1": "动态状态",
  "3w:memories": "记忆",
  "3w:awaken-ledger": "觉醒账本",
  "3w:events": "事件日志",
  "3w:mode": "当前模式",
  "3w:known-models": "模型缓存",
  "3w:ctx-window-overrides": "上下文覆盖",
  "3w:onboarded": "新手引导",
  "3w:app-name": "应用名",
  "3w:rail-collapsed": "分组折叠",
};

export function keyLabel(k: string): string {
  return KEY_LABELS[k] ?? k;
}

export interface BundleEntry {
  key: string;
  label: string;
  /** 文件里这一项有内容 */
  inFile: boolean;
  /** 本地这一项已经有值 */
  inLocal: boolean;
  bytes: number;
}

export interface BundlePreview {
  exportedAt: string;
  entries: BundleEntry[];
  /** 文件有、本地也有 —— 覆盖模式会替换掉的项数 */
  conflicts: number;
  /** 文件有、本地没有 —— 补齐模式能写进去的项数 */
  fresh: number;
  totalKB: number;
}

/**
 * 解析并检查一个数据文件，**不写任何东西**。
 *
 * 存在的理由：`importBundle` 的覆盖语义很硬 —— 导入一个三天前的备份，
 * 你现在改过的角色就没了，而且过程中看不到任何人问一句。
 * 所以先把「文件里有什么 / 本地有什么」摆出来，让用户看清楚再决定。
 */
export function previewBundle(
  text: string
): { ok: true; preview: BundlePreview } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "不是合法的 JSON" };
  }

  const b = parsed as Partial<DataBundle>;
  if (!b || typeof b !== "object" || typeof b.data !== "object" || b.data === null) {
    return { ok: false, reason: "缺少 data 字段，不像是本应用导出的文件" };
  }

  if (typeof b.format === "number" && b.format > EXPORT_FORMAT) {
    return { ok: false, reason: `文件格式版本 ${b.format} 比当前程序新` };
  }

  const entries: BundleEntry[] = [];
  let conflicts = 0;
  let fresh = 0;
  let total = 0;

  for (const k of DATA_KEYS) {
    const v = b.data[k];
    const inFile = typeof v === "string" && v.length > 0;
    let inLocal = false;
    try {
      const lv = localStorage.getItem(k);
      inLocal = !!lv && lv.length > 0;
    } catch {
      inLocal = false;
    }

    const bytes = inFile ? new Blob([v as string]).size : 0;
    total += bytes;

    if (inFile && inLocal) conflicts++;
    if (inFile && !inLocal) fresh++;

    entries.push({ key: k, label: keyLabel(k), inFile, inLocal, bytes });
  }

  return {
    ok: true,
    preview: {
      exportedAt: b.exportedAt ?? "未知",
      entries,
      conflicts,
      fresh,
      totalKB: Math.round(total / 1024),
    },
  };
}

export type ImportMode = "fill" | "overwrite";

export type ImportResult =
  | { ok: true; keys: number; skipped: string[] }
  | { ok: false; reason: string };

/**
 * 从 JSON 文本导入。写之前应该先 `previewBundle` 让用户确认。
 *
 * `mode`：
 *   "fill"      只写本地还空着的项 —— 不会动任何已有数据
 *   "overwrite" 文件里有的项全部覆盖本地
 *
 * （没有 "replace" —— 那会连本地独有的项一起抹掉，导入一个文件不该
 *   产生这种后果。真要清空请用「全部重置」。）
 */
export function importBundle(text: string, mode: ImportMode = "fill"): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "不是合法的 JSON" };
  }

  const b = parsed as Partial<DataBundle>;
  if (!b || typeof b !== "object" || typeof b.data !== "object" || b.data === null) {
    return { ok: false, reason: "缺少 data 字段，不像是本应用导出的文件" };
  }

  if (typeof b.format === "number" && b.format > EXPORT_FORMAT) {
    return { ok: false, reason: `文件格式版本 ${b.format} 比当前程序新` };
  }

  const skipped: string[] = [];
  let written = 0;

  try {
    for (const [k, v] of Object.entries(b.data)) {
      /* 只认已知 key —— 防止把别的东西塞进来 */
      if (!(DATA_KEYS as readonly string[]).includes(k)) {
        skipped.push(k);
        continue;
      }
      if (typeof v !== "string" || v.length === 0) continue;

      if (mode === "fill") {
        let local: string | null = null;
        try {
          local = localStorage.getItem(k);
        } catch {
          local = null;
        }
        if (local && local.length > 0) {
          skipped.push(k);
          continue;
        }
      }

      localStorage.setItem(k, v);
      written++;
    }
  } catch (e) {
    return { ok: false, reason: `写入失败：${(e as Error).message}` };
  }

  return { ok: true, keys: written, skipped };
}

/* ══════════════ Electron 自动留底 ══════════════ */

export function hasNativePersist(): boolean {
  return typeof window !== "undefined" && typeof window.desktop?.persist === "function";
}

/**
 * Electron 里调一次，主进程会写到 %APPDATA%/Habitat/data/current.json
 * 并每天留一份 backup-YYYY-MM-DD.json。
 */
export async function autosaveNative(): Promise<boolean> {
  if (!hasNativePersist()) return false;
  try {
    const bundle = collectData({ secrets: "encrypted" });
    await window.desktop!.persist(bundle);
    /*
     * 落盘记一条 —— 但要限流。
     *
     * 自动保存很频繁，每条都记会把事件流刷满。
     * 60 秒内只记第一条。
     */
    const now = Date.now();
    if (now - lastPersistLogAt > 60_000) {
      lastPersistLogAt = now;
      log.persist(JSON.stringify(bundle).length);
    }
    return true;
  } catch {
    return false;
  }
}

/* 上次记落盘日志的时间 —— 见 autosaveNative 里的限流 */
let lastPersistLogAt = 0;

/** 读留底最多等这么久 —— IPC 万一卡住，不该让窗口白着。 */
const RESTORE_TIMEOUT_MS = 1500;

/** Electron 里读回上次留底（页面加载时用） */
export async function restoreNative(): Promise<DataBundle | null> {
  if (typeof window === "undefined" || typeof window.desktop?.readPersisted !== "function") {
    return null;
  }
  try {
    const raw = await Promise.race([
      window.desktop.readPersisted(),
      new Promise<null>((r) => setTimeout(() => r(null), RESTORE_TIMEOUT_MS)),
    ]);
    return (raw as DataBundle | null) ?? null;
  } catch {
    return null;
  }
}

/* ══════════════ 启动时把留底补回来 ══════════════ */

export type RestoreSkip = "no-bridge" | "no-file" | "empty-file" | "all-present" | "error";

export interface RestoreOutcome {
  /** 真的从文件补进 localStorage 的 key */
  restored: string[];
  /** localStorage 本来就有值、因此没动的 key */
  kept: string[];
  /** 没补的原因。restored 非空时是 null。 */
  skip: RestoreSkip | null;
  /** 文件里记录的导出时间 */
  exportedAt?: string;
}

let lastRestore: RestoreOutcome | null = null;

/** 上一次 bootstrapRestore 的结果，给启动序列显示用 */
export function readRestoreOutcome(): RestoreOutcome | null {
  return lastRestore;
}

/**
 * 启动时把本地留底补回 localStorage。
 *
 * **必须在 root.render() 之前调用。** 之后所有 store（角色、群聊、对话、
 * 凭据）都在初始化时直接读 localStorage，晚一步就得重渲染全部 store，
 * 既容易漏，也会闪一下空数据。
 *
 * 语义是**补空位**，不是覆盖：
 *   localStorage 空   → 用文件里的
 *   localStorage 有值 → 保留（那是用户刚改的，比文件新）
 *
 * 这个「填空不覆盖」很关键：用户清空对话时写的是空存档 `{"v":1,"threads":{}}`
 * 而不是删 key，所以空存档算「有值」，昨天的备份不会把已清空的对话复活。
 */
export async function bootstrapRestore(): Promise<RestoreOutcome> {
  const out: RestoreOutcome = { restored: [], kept: [], skip: "no-file" };

  if (typeof window === "undefined" || typeof window.desktop?.readPersisted !== "function") {
    out.skip = "no-bridge";
    lastRestore = out;
    return out;
  }

  const bundle = await restoreNative();
  if (!bundle || typeof bundle.data !== "object" || bundle.data === null) {
    out.skip = "no-file";
    lastRestore = out;
    return out;
  }
  out.exportedAt = bundle.exportedAt;

  /* 文件里全是空 —— 之前跑过但没攒下数据，不算「有留底」 */
  const hasAny = DATA_KEYS.some((k) => {
    const v = bundle.data[k];
    return typeof v === "string" && v.length > 0;
  });
  if (!hasAny) {
    out.skip = "empty-file";
    lastRestore = out;
    return out;
  }

  try {
    for (const k of DATA_KEYS) {
      const fromFile = bundle.data[k];
      if (typeof fromFile !== "string" || fromFile.length === 0) continue;

      let local: string | null = null;
      try {
        local = localStorage.getItem(k);
      } catch {
        local = null;
      }

      if (local && local.length > 0) {
        out.kept.push(k);
        continue;
      }

      localStorage.setItem(k, fromFile);
      out.restored.push(k);
    }
  } catch {
    out.skip = "error";
    lastRestore = out;
    return out;
  }

  out.skip = out.restored.length > 0 ? null : "all-present";
  lastRestore = out;
  return out;
}

/** 数据概况，给设置面板显示 */
export function dataStats() {
  const size = (v: string | null) => (v ? new Blob([v]).size : 0);
  const out: Record<string, number> = {};
  let total = 0;
  for (const k of DATA_KEYS) {
    let v: string | null = null;
    try {
      v = localStorage.getItem(k);
    } catch {
      /* ignore */
    }
    const n = size(v);
    out[k] = n;
    total += n;
  }
  return { perKey: out, total, kb: Math.round(total / 1024) };
}
