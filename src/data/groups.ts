import type { ConvId } from "./mock";
import type { PersonaId } from "./personas";

/**
 * 群聊数据。
 *
 * 之前「三鲸之家」是把成员写死在代码里的 4 个人。
 * 现在群是用户自己拉的：选几个已有角色 → 起个名 → 生成 `grp-N`。
 *
 * `"group"` 保留为默认群的 id，兼容旧存档和已有的聊天记录。
 */

export interface Group {
  id: ConvId;
  name: string;
  members: PersonaId[];
  /** 创建时间，用于排序 */
  at: number;
  /** 群消息历史的上限（k）。群会话的「上下文」是这个群积累了多少 */
  ctxMax?: number;
}

const KEY = "3w:groups";
const VERSION = 1;

interface Persisted {
  v: number;
  groups: Group[];
}

export function loadGroups(): Group[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as Persisted;
    if (saved?.v !== VERSION || !Array.isArray(saved.groups)) return [];
    return saved.groups;
  } catch {
    return [];
  }
}

export function saveGroups(list: Group[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, groups: list } satisfies Persisted));
  } catch {
    /* ignore */
  }
}

/** 生成一个不会撞车的群 id */
export function nextGroupId(existing: Group[]): string {
  const used = new Set(existing.map((g) => g.id as string));
  let n = 2;
  while (used.has(`grp-${n}`)) n++;
  return `grp-${n}`;
}
