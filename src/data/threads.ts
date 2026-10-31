import type { ConvId, Message } from "./mock";

/**
 * 对话持久化。
 *
 * 之前 `threads` 是纯内存 state —— 刷新一次全没了。
 * 这对「本地优先」的软件是致命的：你敲的东西必须留下来。
 *
 * 三条约束：
 *   1. 每会话最多保留 MAX_PER_CONV 条（防止 localStorage 5MB 被我撑爆）
 *   2. 空会话不写（省空间，也避免一堆空数组）
 *   3. 写入失败（配额满 / 隐私模式）返回 false，由调用方决定要不要提示
 */

const KEY = "3w:threads";
const VERSION = 1;
const MAX_PER_CONV = 200;

/** 读出来可能只包含部分会话 —— 用 Partial，调用方合并 */
type StoredThreads = Partial<Record<ConvId, Message[]>>;

interface Stored {
  v: number;
  threads: Record<string, Message[]>;
}

/** 读一次；没有数据或格式不对返回 null（由调用方决定用哪种初始数据） */
export function loadThreads(): StoredThreads | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || parsed.v !== VERSION || typeof parsed.threads !== "object") {
      return null;
    }

    const out: StoredThreads = {};
    for (const [id, list] of Object.entries(parsed.threads)) {
      if (Array.isArray(list)) out[id as ConvId] = list;
    }
    return out;
  } catch {
    return null;
  }
}

/** 写回；成功 true，失败 false */
export function saveThreads(threads: Record<string, Message[]>): boolean {
  try {
    const trimmed: Record<string, Message[]> = {};

    for (const [id, list] of Object.entries(threads)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      /* 只留最近的一批，旧的丢掉 */
      trimmed[id] = list.slice(-MAX_PER_CONV);
    }

    const payload: Stored = { v: VERSION, threads: trimmed };
    localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** 清掉持久化的对话（设置里的「清空对话记录」用） */
/**
 * 清空对话记录。
 *
 * **不是 removeItem** —— 那样下次 loadThreads() 返回 null，
 * 调用方会以为「从没存过」然后加载示例数据，用户看到别人的对话复活。
 *
 * 改成写入一个空存档：明确表示「用户清过，这不是没存过」。
 */
export function clearThreads() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, threads: {} }));
  } catch {
    /* ignore */
  }
}

/** 估算当前占用（给设置面板显示） */
export function threadsSizeKB(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return 0;
    /* localStorage 里是 UTF-16，但浏览器配额按字节算更接近 raw.length * 2 */
    return Math.round((raw.length * 2) / 1024);
  } catch {
    return 0;
  }
}
