/**
 * 持久化数据的容错。
 *
 * ── 为什么需要 ──
 *
 * `localStorage` 里的东西**不是我们写的**。它可能是：
 *
 *   · 上一个版本写的（字段少了 / 多了 / 改名了）
 *   · 用户手动改过的（调试、迁移、手贱）
 *   · 写到一半断电的（JSON 截断）
 *   · 别人发给他的存档（更野）
 *
 * 而 UI 会假设字段存在。**一个缺字段的群就能让整个聊天区渲染崩掉。**
 *
 * 所以：读进来先过一遍这里。**能修的修，修不了的丢掉** ——
 * 丢一条脏数据，比白屏强。
 *
 * 原则：**这里只做结构性修补，不改业务判断。**
 */

import type { Group } from "../data/groups";
import type { Persona } from "../data/personas";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 修一个群。
 *
 * 返回 null = 这条救不回来（连 id 和 name 都没有），调用方直接丢掉。
 */
export function sanitizeGroup(raw: unknown): Group | null {
  if (!isObj(raw)) return null;

  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null; /* 没有 id 的群没法被选中，留着只会制造幽灵 */

  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : "未命名群";

  /*
   * members 是崩溃高发区。
   *
   * 它可能不是数组（写成字符串的）、可能含 null、
   * 可能引用了已经不存在的角色 —— 后面那种由 UI 过滤，这里只管类型。
   */
  const members = Array.isArray(raw.members)
    ? raw.members.filter((m): m is string => typeof m === "string" && m.length > 0)
    : [];

  return {
    id: id as Group["id"],
    name,
    members: members as Group["members"],
    at: typeof raw.at === "number" ? raw.at : Date.now(),
    ...(typeof raw.ctxMax === "number" ? { ctxMax: raw.ctxMax } : {}),
  };
}

export function sanitizeGroups(list: unknown): Group[] {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeGroup).filter((g): g is Group => g !== null);
}

/**
 * 修一个角色。
 *
 * 比群更宽松 —— 角色的字段多，缺一两个不该丢整个人；
 * 但那几个**被 UI 直接取属性的**必须有。
 */
export function sanitizePersona(raw: unknown): Persona | null {
  if (!isObj(raw)) return null;

  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!id || !name) return null; /* 没名没 id 的角色在界面上是一块空白 */

  const P = raw as Partial<Persona>;

  return {
    ...P,
    id: id as Persona["id"],
    name,
    handle: typeof P.handle === "string" ? P.handle : `@${id}`,
    engine: typeof P.engine === "string" ? P.engine : "本地",
    model: typeof P.model === "string" ? P.model : "",
    color: typeof P.color === "string" ? P.color : "#35f0ce",
    tier: P.tier === "core" ? "core" : "guest",
    archetype: typeof P.archetype === "string" ? P.archetype : "刚接入的成员",
    /* tags 是数组 —— `tags.map` 崩过不止一次 */
    tags: Array.isArray(P.tags) ? P.tags.filter((t): t is string => typeof t === "string") : [],
    style: typeof P.style === "string" ? P.style : "",
    social: typeof P.social === "string" ? P.social : "",
    trigger: typeof P.trigger === "string" ? P.trigger : "",
    axisNote: typeof P.axisNote === "string" ? P.axisNote : "",
    evidence: isObj(P.evidence)
      ? {
          focus: typeof P.evidence.focus === "string" ? P.evidence.focus : "待补",
          trust: typeof P.evidence.trust === "string" ? P.evidence.trust : "待补",
        }
      : { focus: "待补", trust: "待补" },
    axes: isObj(P.axes)
      ? {
          共鸣: typeof P.axes.共鸣 === "number" ? P.axes.共鸣 : 50,
          锐度: typeof P.axes.锐度 === "number" ? P.axes.锐度 : 50,
          幽默: typeof P.axes.幽默 === "number" ? P.axes.幽默 : 50,
          严谨: typeof P.axes.严谨 === "number" ? P.axes.严谨 : 50,
        }
      : { 共鸣: 50, 锐度: 50, 幽默: 50, 严谨: 50 },
    presence: P.presence === "online" ? "online" : "idle",
    mood: isObj(P.mood)
      ? {
          label: typeof P.mood.label === "string" ? P.mood.label : "平静",
          score: typeof P.mood.score === "number" ? P.mood.score : 50,
        }
      : { label: "平静", score: 50 },
    tagline: typeof P.tagline === "string" ? P.tagline : "",
    ctxUsed: typeof P.ctxUsed === "number" ? P.ctxUsed : 0,
    ctxMax: typeof P.ctxMax === "number" && P.ctxMax > 0 ? P.ctxMax : 128,
    unread: typeof P.unread === "number" ? P.unread : 0,
  } as Persona;
}

export function sanitizePersonas(list: unknown): Persona[] {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizePersona).filter((p): p is Persona => p !== null);
}
