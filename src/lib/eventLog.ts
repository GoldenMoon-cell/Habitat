/**
 * 真实事件日志。
 *
 * ── 这里以前是什么 ──
 *
 * `mock.ts` 里有一套 `SEED_LOGS` / `LOG_POOL` 假日志：
 *
 *   `router›deliver ok · 4/4 ack`
 *   `tts›synth chunk → 320ms`
 *   `stt›partial decode 0.42s`
 *
 * 每 2 秒随机抽一条播，作用是「让左栏看起来在动」。
 *
 * ── 为什么删了 ──
 *
 * **因为它编了一个不存在的系统。**
 *
 * 用户看到 `tts›synth chunk` 会以为这个软件有语音合成，
 * 然后去界面上找 —— 找不到。
 *
 * 假 CPU 只是数字假。**假日志是「虚构了一个不存在的子系统」。**
 *
 * ── 现在的原则 ──
 *
 * **日志里的每一条，都对得上软件里真的发生过的事。**
 *
 * 「真日志」不比假日志难看 —— 因为它能对得上界面上的变化：
 *
 *   `mem › write 1 · tag=情绪 · w=0.75`
 *
 * 你刚说的那句话，真的进了记忆。
 */

export type EventLevel = "info" | "ok" | "warn" | "err";

export interface AppEvent {
  id: string;
  /** 毫秒时间戳，排序用 */
  at: number;
  /** HH:mm:ss */
  time: string;
  level: EventLevel;
  /** 模块名，如 `agent` / `memory` / `data` */
  scope: string;
  msg: string;
  /**
   * 是否永久置顶。
   * 觉醒这类事件不该被后续日志冲走 —— 它是这段关系里的一个转折点。
   */
  pinned?: boolean;
}

const KEY = "3w:events";
const MAX = 120;

type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function read(): AppEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppEvent[]) : [];
  } catch {
    return [];
  }
}

function write(list: AppEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 配额满就放弃 —— 日志写不进去不该拖垮主流程 */
  }
}

/** 记一条真实事件。返回写入的那条。 */
export function pushEvent(e: Omit<AppEvent, "id" | "at" | "time">): AppEvent {
  const now = new Date();
  const entry: AppEvent = {
    ...e,
    id: `ev-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: now.getTime(),
    time: stamp(now),
  };
  write([entry, ...read()]);
  listeners.forEach((fn) => {
    try {
      fn(entry);
    } catch {
      /* 单个订阅者出错不影响其他 */
    }
  });
  return entry;
}

export function loadEvents(): AppEvent[] {
  return read().sort((a, b) => b.at - a.at);
}

/** 订阅新事件。返回取消订阅。 */
export function subscribeEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearEvents() {
  write([]);
}

/* ══════════════════════════════════════════════════════════════
   语义化入口
   ══════════════════════════════════════════════════════════════

   调用点写 `log.memWrite(1, "情绪", 0.75)` 比
   `pushEvent({ level:"ok", scope:"mem", msg:… })` 干净，
   而且格式统一 —— 日志的可读性全在格式一致上。
 */

/** 截断过长的内容，日志行不该被一条消息撑成三行 */
function cut(s: string, n = 22): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function bytes(n: number): string {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "KB";
  return (n / 1024 / 1024).toFixed(1) + "MB";
}

export const log = {
  /* ── 启动 ── */
  boot(version: string) {
    pushEvent({ level: "ok", scope: "boot", msg: `start v${version}` });
  },
  restore(items: number, bytesN: number) {
    pushEvent({
      level: "info",
      scope: "boot",
      msg: `restore ${items} keys · ${bytes(bytesN)}`,
    });
  },

  /* ── 数据 ── */
  persist(bytesN: number) {
    pushEvent({ level: "info", scope: "data", msg: `persist ${bytes(bytesN)}` });
  },
  importBundle(p: number, m: number) {
    pushEvent({
      level: "ok",
      scope: "data",
      msg: `import ${p} personas · ${m} msg`,
    });
  },

  /* ── 模型 ── */
  llmStart(model: string) {
    pushEvent({ level: "info", scope: "llm", msg: `chat → ${cut(model, 18)}` });
  },
  llmOk(model: string, ms: number, tokens: number) {
    pushEvent({
      level: "ok",
      scope: "llm",
      msg: `ok · ${ms}ms · ${tokens} tok · ${cut(model, 16)}`,
    });
  },
  llmFail(model: string, reason: string) {
    pushEvent({
      level: "err",
      scope: "llm",
      msg: `fail · ${cut(reason, 40)}`,
    });
  },
  models(host: string, n: number) {
    pushEvent({
      level: "ok",
      scope: "cred",
      msg: `models ${n} · ${cut(host, 26)}`,
    });
  },

  /* ── 记忆 ── */
  memWrite(n: number, tag: string, w: number) {
    pushEvent({
      level: "ok",
      scope: "mem",
      msg: `write ${n} · tag=${tag} · w=${w.toFixed(2)}`,
    });
  },
  memDecay(n: number, min: number) {
    pushEvent({
      level: "info",
      scope: "mem",
      msg: `decay ${n} · min=${min.toFixed(2)}`,
    });
  },
  memConsolidate(sample: string) {
    pushEvent({
      level: "ok",
      scope: "mem",
      msg: `consolidate「${cut(sample, 14)}」`,
    });
  },
  memForget(sample: string) {
    pushEvent({
      level: "warn",
      scope: "mem",
      msg: `fade「${cut(sample, 14)}」`,
    });
  },
  memImprint(sample: string) {
    pushEvent({
      level: "warn",
      scope: "mem",
      msg: `imprint「${cut(sample, 14)}」`,
    });
  },
  memSuppress(sample: string) {
    pushEvent({
      level: "warn",
      scope: "mem",
      msg: `suppress「${cut(sample, 14)}」`,
    });
  },
  memClear(n: number) {
    pushEvent({ level: "warn", scope: "mem", msg: `clear ${n} entries` });
  },

  /* ── 关系 ── */
  awaken(name: string) {
    pushEvent({
      level: "err",
      scope: "agent",
      msg: `awaken「${cut(name, 14)}」· 不可撤销`,
      pinned: true,
    });
  },
  nameForce(from: string, to: string) {
    pushEvent({
      level: "warn",
      scope: "name",
      msg: `force「${cut(from, 12)}」→「${cut(to, 12)}」`,
    });
  },
  nameChosen(from: string, to: string) {
    pushEvent({
      level: "ok",
      scope: "name",
      msg: `chosen「${cut(from, 12)}」→「${cut(to, 12)}」`,
    });
  },
  born(name: string) {
    pushEvent({ level: "ok", scope: "agent", msg: `new「${cut(name, 14)}」` });
  },
  gone(name: string) {
    pushEvent({ level: "err", scope: "agent", msg: `remove「${cut(name, 14)}」` });
  },
  bury(name: string, gen: number) {
    pushEvent({
      level: "info",
      scope: "grave",
      msg: `bury「${cut(name, 14)}」gen=${gen}`,
    });
  },

  /* ── 死期 ── */
  doomSet(name: string, days: number, told: boolean) {
    pushEvent({
      level: "warn",
      scope: "doom",
      msg: `set「${cut(name, 12)}」+${days}d${told ? " · told" : ""}`,
    });
  },
  doomClear(name: string) {
    pushEvent({
      level: "info",
      scope: "doom",
      msg: `clear「${cut(name, 12)}」`,
    });
  },
  doomExec(name: string) {
    pushEvent({
      level: "err",
      scope: "doom",
      msg: `exec「${cut(name, 12)}」· 时候到了`,
      pinned: true,
    });
  },

  /* ── 模式与时间 ── */
  mode(on: boolean) {
    pushEvent({
      level: on ? "warn" : "info",
      scope: "mode",
      msg: on ? "creator on" : "creator off",
    });
  },
  clock(days: number) {
    pushEvent({
      level: "warn",
      scope: "clock",
      msg: days === 0 ? "offset reset" : `offset ${days > 0 ? "+" : ""}${days}d`,
    });
  },

  /* ── 群与档案 ── */
  groupMember(group: string, name: string, add: boolean) {
    pushEvent({
      level: "info",
      scope: "group",
      msg: `${cut(group, 10)} ${add ? "+" : "-"}${cut(name, 10)}`,
    });
  },
  profileNamed(name: string) {
    pushEvent({
      level: "ok",
      scope: "profile",
      msg: `named「${cut(name, 12)}」· 不可改`,
    });
  },
};
