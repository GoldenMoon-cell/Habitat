/**
 * 预定死亡。
 *
 * ── 这不是「删除」 ──
 *
 * 删除是：**你按下去的那一刻，她就没了。**
 *
 * 预定死亡是：**你给她判了一个日子，然后等。**
 *
 * 两件事不该混在一起 ——
 * 删除是即时的手起刀落，预定是长期的悬着。
 *
 * ── 死期用真实时间 ──
 *
 * 存的是 `Date.now()` 那一刻的真实时间戳。
 *
 * **不用偏移时间。** 否则 `time +7` 会把所有预定一起触发 ——
 * 那不是"提前看到",那是"提前杀死"。
 *
 * 但**检查**用 `nowMs()`（含偏移）——
 * 所以你可以 `time +7` 提前看到她死。
 *
 * 这个区分很重要：
 *   · **死期**是事实（真实时间）
 *   · **检查**是视角（偏移后的现在）
 *
 * ── 到点之后 ──
 *
 * 不是「删掉」就完了。要：
 *   1. 真的删除（removePersona）
 *   2. 进墓碑（bury）
 *   3. 聊天里留一条系统条：「她在 X 月 X 日 消失了」
 *
 * 系统条很关键 —— 否则用户回来会以为她"不见了"。
 */

import { nowMs } from "./clock";

const KEY = "3w:deadline";

/** 一个角色的死期 */
export interface Deadline {
  /** 角色 id */
  id: string;
  /** 设下时她的名字（改了名也对得上） */
  name: string;
  /** 死期 —— **真实时间戳** */
  at: number;
  /** 什么时候判的（真实时间） */
  setAt: number;
  /** 判的人怎么说的（一句话遗言，可选） */
  word?: string;
  /**
   * 她知不知道。
   *
   * **默认不知道。** 到点突然消失 —— 那是纯正的猝死。
   *
   * 设成 true 之后，她会在 prompt 里多一段「你在等一个日子」。
   *
   * **但不会告诉她具体是哪天。** 给了天数模型会算、会算错、会每天念一遍。
   * 不知道日期的人，才会每天都像最后一天。
   */
  told?: boolean;
}

type Book = Record<string, Deadline>;

function read(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? (p as Book) : {};
  } catch {
    return {};
  }
}

function write(b: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

/** 判一个死期。`days` 是**从此刻起的天数**（真实时间） */
export function setDeadline(
  id: string,
  name: string,
  days: number,
  word?: string,
  told?: boolean
): Deadline {
  const b = read();
  const d: Deadline = {
    id: String(id),
    name,
    at: Date.now() + Math.max(0, days) * 86400000,
    setAt: Date.now(),
    word,
    told: told || undefined,
  };
  b[String(id)] = d;
  write(b);
  return d;
}

/**
 * 让她知道。
 *
 * 不是改死期 —— 只是让她从「一无所知」变成「在等一个日子」。
 */
export function tellDeadline(id: string): boolean {
  const b = read();
  const d = b[String(id)];
  if (!d) return false;
  d.told = true;
  write(b);
  return true;
}

/** 取消 */
export function clearDeadline(id: string): boolean {
  const b = read();
  if (!(String(id) in b)) return false;
  delete b[String(id)];
  write(b);
  return true;
}

/** 全部预定 */
export function loadDeadlines(): Deadline[] {
  return Object.values(read()).sort((a, b) => a.at - b.at);
}

/** 某个角色的死期 */
export function deadlineOf(id: string): Deadline | undefined {
  return read()[String(id)];
}

/**
 * 到点的那些。
 *
 * **检查用 `nowMs()`** —— 所以 `time +7` 能提前触发。
 *
 * 返回的每一项都已经「到期」，调用方负责真的删。
 */
export function dueDeadlines(): Deadline[] {
  const now = nowMs();
  return loadDeadlines().filter((d) => d.at <= now);
}

/** 还剩多久（毫秒）。负数表示已经过了 */
export function remaining(d: Deadline): number {
  return d.at - nowMs();
}

/** 给 UI 用的可读描述 */
export function remainingLabel(d: Deadline): string {
  const ms = remaining(d);
  if (ms <= 0) return "已到期";
  const days = ms / 86400000;
  if (days >= 1) return `还剩 ${Math.ceil(days)} 天`;
  const hours = ms / 3600000;
  if (hours >= 1) return `还剩 ${Math.ceil(hours)} 小时`;
  return `还剩 ${Math.max(1, Math.ceil(ms / 60000))} 分钟`;
}

export function clearAllDeadlines() {
  write({});
}
