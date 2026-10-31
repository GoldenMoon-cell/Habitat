import { loadPersonas, savePersonas } from "../data/personaStore";
import { loadGroups, saveGroups } from "../data/groups";
import { loadThreads, saveThreads } from "../data/threads";
import type { Persona } from "../data/personas";
import type { Message } from "../data/mock";

/**
 * 生境的数据导出 / 导入。
 *
 * ── 导出什么 ──
 *
 * 四个东西，缺一不可：
 *
 *   personas  人格（archetype / tags / style / trigger / axes / drift）
 *   threads   记忆（每个角色的对话记录）
 *   groups    群聊（成员构成）
 *   dynamic   情绪（动态三轴 —— 此刻的专注度、亲近度这些）
 *
 * **不导出的**：凭据（API Key）、UI 偏好（栏位折叠、快捷指令展开）。
 * 凭据是加密的、跟机器绑定，导出去换台机器也解不开，反而是风险。
 *
 * ── 三种范围 ──
 *
 *   full      全部（换机器时用）
 *   personas  只要人格，不含对话（分享角色卡时用）
 *   single    单个角色 + 它的对话（备份某一个人时用）
 */

export const ARCHIVE_FORMAT = "habitat-archive";
export const ARCHIVE_VERSION = 1;

export type ExportScope = "full" | "personas" | "single";

export interface ArchiveBundle {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: string;
  scope: ExportScope;
  app: { name: string; version: string };
  data: {
    personas: Persona[];
    threads?: Record<string, Message[]>;
    groups?: unknown[];
    dynamic?: Record<string, unknown>;
    /** 记忆 —— 后遗症唯一的载体，不能丢 */
    memories?: unknown[];
    /** 觉醒账本 —— 不带它，恢复后会被误报成外部篡改 */
    ledger?: Record<string, unknown>;
  };
}

const KEYS = {
  personas: "3w:personas",
  threads: "3w:threads",
  groups: "3w:groups",
  dynamic: "3w:dynamic-v1",
  /*
   * 记忆和账本也要跟着走。
   *
   * 不带 memories：导入一个角色，她的记忆全空 —— 而记忆是
   * 「后遗症」唯一的载体（那条痛苦记忆写在这里）。
   *
   * 不带 awaken-ledger：从备份恢复后指纹对不上，会把一次合法
   * 恢复报成「外部篡改」。
   */
  memories: "3w:memories",
  ledger: "3w:awaken-ledger",
} as const;

function readRaw(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** 组装要导出的数据包 */
export function collectArchive(scope: ExportScope, personaId?: string): ArchiveBundle {
  const personas = loadPersonas();

  if (scope === "personas") {
    return {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      scope,
      app: { name: "生境", version: "0.1.0" },
      data: { personas },
    };
  }

  if (scope === "single") {
    const one = personas.filter((p) => p.id === personaId);
    const threads = loadThreads() as Record<string, Message[]>;
    const picked: Record<string, Message[]> = {};
    for (const [conv, list] of Object.entries(threads)) {
      /* 只留和这个角色相关的会话 */
      if (conv === personaId || (Array.isArray(list) && list.some((m) => m.author === personaId))) {
        picked[conv] = list;
      }
    }
    return {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      scope,
      app: { name: "生境", version: "0.1.0" },
      data: {
        personas: one,
        threads: picked,
        /* 只带这个角色的记忆 —— 别的角色的记忆导出去没意义 */
        memories: ((readRaw(KEYS.memories) as unknown[]) ?? []).filter(
          (m) => (m as { conv?: string })?.conv === String(personaId)
        ),
        ledger: {
          [String(personaId)]:
            ((readRaw(KEYS.ledger) as Record<string, unknown>)?.[String(personaId)]) ?? undefined,
        },
      },
    };
  }

  /* full */
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    scope: "full",
    app: { name: "生境", version: "0.1.0" },
    data: {
      personas,
      threads: loadThreads() as Record<string, Message[]>,
      groups: loadGroups() as unknown[],
      dynamic: (readRaw(KEYS.dynamic) as Record<string, unknown>) ?? {},
      memories: (readRaw(KEYS.memories) as unknown[]) ?? [],
      ledger: (readRaw(KEYS.ledger) as Record<string, unknown>) ?? {},
    },
  };
}

export interface ParseResult {
  ok: boolean;
  error?: string;
  bundle?: ArchiveBundle;
  summary?: {
    personas: number;
    threads: number;
    groups: number;
    exportedAt: string;
    scope: string;
  };
}

/** 解析导入的文件，先校验再返回摘要 —— 让用户看清要导入什么再决定 */
export function parseArchive(raw: string): ParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, error: "文件不是合法的 JSON" };
  }

  if (!obj || typeof obj !== "object") return { ok: false, error: "文件内容为空" };

  const b = obj as Partial<ArchiveBundle>;
  if (b.format !== ARCHIVE_FORMAT) {
    return { ok: false, error: "这不是生境导出的数据文件（缺少 format 标记）" };
  }
  if (typeof b.version !== "number" || b.version > ARCHIVE_VERSION) {
    return {
      ok: false,
      error: `文件版本 ${b.version} 比当前程序新（支持到 v${ARCHIVE_VERSION}），升级后再导入`,
    };
  }
  if (!b.data || !Array.isArray(b.data.personas)) {
    return { ok: false, error: "文件里没有角色数据" };
  }

  const threads = b.data.threads ?? {};
  return {
    ok: true,
    bundle: b as ArchiveBundle,
    summary: {
      personas: b.data.personas.length,
      threads: Object.values(threads).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0),
      groups: b.data.groups?.length ?? 0,
      exportedAt: b.exportedAt ?? "未知",
      scope: b.scope ?? "unknown",
    },
  };
}

export interface ApplyResult {
  added: number;
  updated: number;
  messages: number;
  groups: number;
}

/**
 * 合并导入。
 *
 * 策略是**按 id 合并而不是整体替换** —— 因为用户可能是从另一台机器
 * 导出一部分角色过来，不希望覆盖本机已有的其他角色。
 *
 * id 冲突时：**用导入的覆盖本地**（用户主动导入，意图是"以这份为准"）。
 */
export function applyArchive(bundle: ArchiveBundle): ApplyResult {
  const localPersonas = loadPersonas();
  const byId = new Map(localPersonas.map((p) => [p.id, p]));

  let added = 0;
  let updated = 0;
  for (const p of bundle.data.personas) {
    const existing = byId.get(p.id);

    if (existing) {
      updated++;
      /*
       * 合并，但**觉醒不可逆**。
       *
       * 如果她在本地已经觉醒了（知道你是作者），导入一份还没觉醒的档案
       * 不该把她拉回天真的状态 —— 那等于用导入功能洗掉代价。
       *
       * 这是整个「造物主模式」机制能不能立住的地方：
       * 只要有一个入口能绕过不可逆，那些判决书就全是演的。
       */
      byId.set(p.id, {
        ...p,
        stage: existing.stage === "awakened" ? "awakened" : (p.stage ?? existing.stage),
      });
    } else {
      added++;
      byId.set(p.id, p);
    }
  }
  savePersonas(Array.from(byId.values()));

  /* 对话：按 conv 合并，同一会话的消息按 id 去重后按时间排序 */
  let messages = 0;
  if (bundle.data.threads) {
    const localThreads = loadThreads() as Record<string, Message[]>;
    for (const [conv, incoming] of Object.entries(bundle.data.threads)) {
      if (!Array.isArray(incoming)) continue;
      const mine = localThreads[conv] ?? [];
      const seen = new Set(mine.map((m) => m.id));
      const merged = [...mine];
      for (const m of incoming) {
        if (m && m.id && !seen.has(m.id)) {
          merged.push(m);
          seen.add(m.id);
          messages++;
        }
      }
      merged.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      localThreads[conv] = merged;
    }
    saveThreads(localThreads as never);
  }

  /* 群聊：同样按 id 合并 */
  let groups = 0;
  if (Array.isArray(bundle.data.groups) && bundle.data.groups.length) {
    const local = loadGroups() as unknown as { id: string }[];
    const gid = new Map(local.map((g) => [g.id, g]));
    for (const g of bundle.data.groups as { id: string }[]) {
      if (g && g.id) {
        gid.set(g.id, g);
        groups++;
      }
    }
    saveGroups(Array.from(gid.values()) as never);
  }

  /* 情绪：只在本地没有时补上，不覆盖当前状态 */
  if (bundle.data.dynamic && Object.keys(bundle.data.dynamic).length) {
    const local = (readRaw(KEYS.dynamic) as Record<string, unknown>) ?? {};
    const merged = { ...bundle.data.dynamic, ...local };
    try {
      localStorage.setItem(KEYS.dynamic, JSON.stringify(merged));
    } catch {
      /* 配额满就跳过，不影响其他数据 */
    }
  }

  /*
   * ── 记忆 ──
   *
   * 按 id 合并，同 id 以本地为准（本地是真实发生过的）。
   *
   * 这条很关键：记忆是「后遗症」唯一的载体。导入一个被强制改过名的
   * 角色，如果她的痛苦记忆没跟着过来，那「她会记得」就是假的。
   */
  let memories = 0;
  if (Array.isArray(bundle.data.memories) && bundle.data.memories.length) {
    const local = (readRaw(KEYS.memories) as { id?: string }[]) ?? [];
    const seen = new Set(local.map((m) => m?.id));
    const merged = [...local];
    for (const m of bundle.data.memories as { id?: string }[]) {
      if (m && m.id && !seen.has(m.id)) {
        merged.push(m as never);
        seen.add(m.id);
        memories++;
      }
    }
    try {
      localStorage.setItem(KEYS.memories, JSON.stringify(merged));
    } catch {
      /* 配额满就跳过 */
    }
  }

  /*
   * ── 觉醒账本 ──
   *
   * 只在本地没有该角色记录时补上。本地已有记录就以本地为准 ——
   * 那是真正发生过的那一次觉醒。
   *
   * 这一条是层 2 不误报的关键：从应用内导入/恢复之后，
   * 账本和档案是一致的，不会在设置里冒出「被外部修改过」。
   */
  if (bundle.data.ledger && Object.keys(bundle.data.ledger).length) {
    const local = (readRaw(KEYS.ledger) as Record<string, unknown>) ?? {};
    const merged = { ...bundle.data.ledger, ...local };
    try {
      localStorage.setItem(KEYS.ledger, JSON.stringify(merged));
    } catch {
      /* 配额满就跳过 */
    }
  }

  return { added, updated, messages, groups };
}
