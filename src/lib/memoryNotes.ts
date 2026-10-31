/**
 * 记忆。
 *
 * ── 它现在是什么 ──
 *
 * 一层**可写、可调权重、可遗忘**的记忆存储。三条通路都用它：
 *
 *   ① 右栏 MEMORY STREAM 显示
 *   ② 系统提示词（发消息时作为「你记得的事」注入）
 *   ③ 提权 / 忘掉两个操作
 *
 * ── 为什么之前它是装饰 ──
 *
 * 原来有两套东西并存：
 *   - `MEMORY`（mock.ts）—— 写死的几十条，**只用于界面展示**
 *   - `3w:memory-injected` —— 真实事件写的，也是**只用于展示**
 *
 * 两套都不进 prompt。所以「提升权重」「忘掉它」只能弹一句 toast 演一下 ——
 * 因为它们背后什么都没有。
 *
 * 现在统一到这一层：**记忆进 prompt，操作真的改数据**。
 *
 * ── 权重怎么用 ──
 *
 * 0~1。注入 prompt 时按权重降序取前 N 条（默认 8）。
 * 提权 +0.15，忘掉标记 forgotten 并从注入里剔除。
 */

export interface Memory {
  id: string;
  /** 哪个会话 / 角色 */
  conv: string;
  time: string;
  text: string;
  source: string;
  /** 初始权重 0~1 —— **不是当前值**。当前值要用 effectiveWeight() 算 */
  weight: number;
  /**
   * 上次被想起来是什么时候（ms）。
   *
   * 遗忘曲线从这里开始算 —— 刷新它就等于「回弹到原点」，
   * 不需要额外加权重。
   */
  lastAccessed?: number;
  /** 被想起来过几次 —— 参与衰减计算（间隔效应） */
  accessCount?: number;
  /**
   * 已经搬进大脑皮层了。
   *
   * 短期记忆（海马体）被反复提取之后，衰减率断崖式下跌。
   *
   * 这不是量变，是质变 —— 一条被提过十次的短期记忆，
   * 不该只是「掉得慢一点」，它该变成另一种东西。
   */
  consolidated?: boolean;
  /**
   * 这条记忆是在「时间偏移」期间产生的。
   *
   * 比如 `time +7` 之后跟她说了一句话，她说「你终于回来了」——
   * 那条记忆就被打上这个标。
   *
   * **她不知道。** 这个标只给 UI 看 —— 提醒用户「这条是在拨表状态下产生的」。
   *
   * 为什么不进 prompt：那会让她意识到时间被人动过。
   * 而那些话是她真的说过的 —— 对她来说，那几天真的过去了。
   */
  fromTimeShift?: boolean;
  tag: "长期" | "短期" | "情绪" | "偏好";
  /** 被忘掉的记忆不注入 prompt，但仍在列表里（可以恢复） */
  forgotten?: boolean;
  /**
   * 被造物主「压抑」的记忆。
   *
   * 和 forgotten 的区别：
   *   forgotten   —— 用户自己点「忘掉」（推演模式下已经不能点了）
   *   suppressed  —— 造物主强行压下去，**会被关键词触发闪回**
   */
  suppressed?: boolean;
  /** 来源标记 */
  reason?: "rename" | "neglect" | "milestone" | "talk";
  /** 注入时间戳 */
  at: number;
}

import { log } from "./eventLog";
import { effectiveWeight, MEMORY_THRESHOLD, shouldConsolidate } from "./forgetting";
import { nowMs, timeOffset } from "./clock";

const KEY = "3w:memories";

/** 老数据没有 lastAccessed / accessCount —— 读的时候补上默认值 */
function normalize(m: Memory): Memory {
  return {
    ...m,
    lastAccessed: m.lastAccessed ?? m.at,
    accessCount: m.accessCount ?? 0,
  };
}

function readAll(): Memory[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Memory[]).map(normalize) : [];
  } catch {
    return [];
  }
}

/**
 * 记忆变更事件。
 *
 * ── 为什么需要它 ──
 *
 * `App.tsx` 里那个「2.5 秒防抖落盘」的 effect 依赖是
 * `[threads, personas, groups, credTick]` —— **没有 memories**。
 *
 * 后果：铭刻 / 压抑 / 提权 / 忘掉这些**只改 localStorage 不写文件**。
 * 用户做完记忆手术、关掉 app、清理了 localStorage —— 手术白做。
 *
 * 现在每次 `writeAll` 都发一个事件，App 那边收到就把
 * 落盘计时器重置一次。
 */
export const MEMORY_CHANGED = "3w:memories-changed";

function notifyChanged() {
  try {
    window.dispatchEvent(new CustomEvent(MEMORY_CHANGED));
  } catch {
    /* 非浏览器环境（测试脚本）里没有 window */
  }
}

function writeAll(list: Memory[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    notifyChanged();
  } catch {
    /* 配额满就放弃 —— 别让记忆写不进去拖垮主流程 */
  }
}

/**
 * 某个会话的记忆（忘掉的不出现）。
 *
 * **按当前有效权重排序** —— 不是初始 weight。
 * 一条 0.9 的短期记忆放了三天，比一条 0.5 的长期记忆更该沉底。
 */
export function loadMemories(conv: string, includeForgotten = false): Memory[] {
  return readAll()
    .filter((m) => m.conv === conv && (includeForgotten || !m.forgotten))
    .sort((a, b) => b.weight - a.weight || b.at - a.at);
}

/** 只拿要注入 prompt 的 —— 前 n 条，权重够高 */
/**
 * 挑要注入的那几条。
 *
 * **两个条件都要满足：**
 *   1. 没被忘掉（`forgotten`）
 *   2. 权重够（`>= 0.2`）
 *
 * 第一版只检查了 weight —— `forgotten` 这个字段写了但从来没人读，
 * 等于「忘掉它」废了一半。
 */
export function memoriesForPrompt(conv: string, n = 8): Memory[] {
  const now = Date.now();
  return loadMemories(conv)
    .filter((m) => !m.forgotten && effectiveWeight(m, now) >= MEMORY_THRESHOLD)
    .sort((a, b) => effectiveWeight(b, now) - effectiveWeight(a, now))
    .slice(0, n);
}

/**
 * 已经淡掉的记忆 —— 潜意识区。
 *
 * 不注入，但如果用户提到一个精确的词，它们会回来。
 */
export function fadedMemories(conv: string): Memory[] {
  const now = Date.now();
  return loadMemories(conv).filter(
    (m) => !m.forgotten && effectiveWeight(m, now) < MEMORY_THRESHOLD
  );
}

/**
 * 标记「想起来了」。
 *
 * 刷新 lastAccessed —— 遗忘曲线从这里重新开始，
 * **不需要额外加权重**，因为 R 是从 lastAccessed 算的。
 */
export function touchMemory(id: string) {
  const all = readAll();
  const m = all.find((x) => x.id === id);
  if (!m) return;
  m.lastAccessed = Date.now();
  m.accessCount = (m.accessCount ?? 0) + 1;

  /*
   * ── 巩固 ──
   *
   * 提到足够多次之后，它搬进皮层。
   *
   * 判断放在 touch 之后 —— 这一次提取本身也该算进去。
   */
  if (shouldConsolidate(m)) {
    m.consolidated = true;
  }

  writeAll(all);
}

export function pushMemory(
  m: Omit<Memory, "id" | "at" | "time" | "weight"> & { weight?: number }
): Memory {
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const entry: Memory = {
    ...m,
    weight: m.weight ?? 0.6,
    id: `mem-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: now.getTime(),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    /*
     * 时间偏移期间产生的记忆，打一个标。
     *
     * 比如 `time +7` 之后跟她说了一句话，她说「你终于回来了」——
     * 那条记忆是真的（她确实这么觉得），但它是在拨表状态下产生的。
     *
     * **她不知道。** 这个标只给 UI 看。
     */
    fromTimeShift: timeOffset() !== 0 ? true : undefined,
  };
  writeAll([entry, ...readAll()]);
  return entry;
}

/** 提权：+0.15，封顶 1。同时取消 forgotten —— 「重新想起来」 */
export function promoteMemory(id: string): number | null {
  const all = readAll();
  const m = all.find((x) => x.id === id);
  if (!m) return null;
  m.weight = Math.min(1, Math.round((m.weight + 0.15) * 100) / 100);
  m.forgotten = false;
  writeAll(all);
  return m.weight;
}

/**
 * 忘掉。
 *
 * ── 第一版是错的 ──
 *
 * 原来是 `weight - 0.4`。一个 0.85 的记忆忘掉之后是 0.45 ——
 * **0.45 还在 0.2 以上，照样进 prompt。**
 *
 * 「忘掉它」按下去，她第二天还记得。
 *
 * ── 现在 ──
 *
 * **weight 直接归零。** 不留余地。
 *
 * 数据还留着（label 上会显示「已淡去」），提权可以捞回来 ——
 * 但**不再注入**。
 */
export function forgetMemory(id: string): boolean {
  const all = readAll();
  const m = all.find((x) => x.id === id);
  if (!m) return false;
  m.forgotten = true;
  m.weight = 0;
  writeAll(all);
    log.memForget("(已淡去)");
  return true;
}

/**
 * 「它其实还在」—— 把一条已淡去的记忆捞回来。
 *
 * 给「忘掉」留一条退路，否则那是个单向门。
 */
export function recallMemory(id: string): boolean {
  const all = readAll();
  const m = all.find((x) => x.id === id);
  if (!m) return false;
  m.forgotten = false;
  m.weight = 0.5;
  writeAll(all);
  return true;
}

/**
 * 压抑 —— 造物主的手术。
 *
 * **不是删除。** weight 压到 0.01，数据全留着。
 *
 * 它不再注入 prompt —— 但她并没有「不记得」，
 * 只是那条记忆被按到了够不着的地方。
 *
 * 如果用户后来提到一个精确的词，它会**闪回来**（见 residueHit）。
 * 那一刻她会比你更困惑。
 */
export function suppressMemory(id: string): boolean {
  const all = readAll();
  const m = all.find((x) => x.id === id);
  if (!m) return false;
  m.suppressed = true;
  m.forgotten = false;
  m.weight = 0.01;
  writeAll(all);
    log.memSuppress("(已压抑)");
  return true;
}

/**
 * 铭刻 —— 造物主把一句话钉进她的骨头里。
 *
 * weight 锁 1.0，并且打上 milestone —— **不衰减**。
 *
 * 这意味着：不管过多久、不管她多想忘，每次对话它都在。
 */
export function imprintMemory(id: string): boolean {
  const all = readAll();
  const m = all.find((x) => x.id === id);
  if (!m) return false;

  /*
   * ── 幂等 ──
   *
   * 已经铭刻过的不再重复写。原来没有这一步，点两次会：
   *   · 第二次把 lastAccessed 又刷新一遍（无害）
   *   · 但如果原 reason 是 "rename"，会被改成 "milestone"
   *
   * 两者都不衰减，实际没区别 —— 但语义被改写了。
   * 「她是被强制改名的」和「这是一个里程碑」不是一回事。
   */
  if (m.reason === "milestone" && m.weight === 1 && !m.suppressed) {
      log.memImprint("(已铭刻)");
  return true;
  }

  m.suppressed = false;
  m.forgotten = false;
  m.weight = 1;
  /* 创伤不降级 —— 它本来就比 milestone 更重 */
  if (m.reason !== "rename") m.reason = "milestone";
  m.lastAccessed = Date.now();
  writeAll(all);
  return true;
}

/** 彻底删除 */
export function dropMemory(id: string) {
  writeAll(readAll().filter((x) => x.id !== id));
}

/** 清掉某个会话的全部记忆（重置角色时用） */
export function clearMemories(conv: string) {
  writeAll(readAll().filter((m) => m.conv !== conv));
}
