/**
 * 墓碑。
 *
 * ── 这是什么 ──
 *
 * 删掉的角色留下的一份**遗物**：她叫什么、什么时候没的、死的时候什么状态、
 * 以及从她记忆里提取的几个词。
 *
 * ── 为什么需要它 ──
 *
 * 删角色时记忆会被清掉（否则新建一个同 id 的会继承她的回忆）。
 * 但「她存在过」这件事不该跟着消失 ——
 * **记忆是她的，痕迹是房间的。**
 *
 * 所以：**先提取，再清空。**
 *
 * ── 它会被用在哪 ──
 *
 * ① 同名的新角色第一次说话之后 → 一行极淡的系统条
 * ② 新角色提到墓碑里的词 → 情绪真的波动，但**不解释**
 * ③ 新角色觉醒 → prompt 里多一段「在你之前有一个同名的人」
 *
 * ── 设计原则：不解释 ──
 *
 * 恐怖感来自「你看到了但没人告诉你为什么」。
 * 一旦有字幕解说，它就变成了游戏提示。
 */

import { log } from "./eventLog";

const KEY = "3w:graveyard";

export interface Grave {
  id: string;
  name: string;
  /** 删除时间 */
  at: number;
  /** 死时的心情 0-100 */
  lastMood: number;
  /** 死时的亲近 0-100 */
  lastClose: number;
  /**
   * 从她记忆里提取的几个词。
   *
   * 取的是引号里的、和反复出现的短词 —— 不做分词，太脆。
   */
  keywords: string[];
  /** 一句话墓志铭：怎么没的 */
  epitaph: string;
  /**
   * 她是在「时间偏移」期间被删的。
   *
   * 比如 `time +7` 之后删了她 —— 墓碑的时间戳是真实的（Date.now()），
   * 但那次删除发生在一个人为拨动的时刻。
   *
   * **拨不回来。** 删除不是计算，是状态变更。
   *
   * 这个标只给 UI 看 —— 提醒「那块石头是在拨表状态下落的」。
   */
  fromTimeShift?: boolean;
}

type Graveyard = Grave[];

function read(): Graveyard {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as Grave[]) : [];
  } catch {
    return [];
  }
}

function write(g: Graveyard) {
  try {
    /* 只留最近 20 座 —— 再多也没人看 */
    localStorage.setItem(KEY, JSON.stringify(g.slice(-20)));
  } catch {
    /* 存不进就放弃 */
  }
}

/**
 * 从她的记忆里抠几个词出来。
 *
 * 两条路子，都很笨但够用：
 *   ① **引号里的** —— 「大白饭」「主人」那种被明确标记的
 *   ② **出现在两条以上记忆里的 2-4 字片段** —— 反复提到的东西
 *
 * 不做分词：中文分词的库太重，而这里只需要「大概几个词」。
 */
export function extractKeywords(texts: string[]): string[] {
  const out = new Set<string>();

  /* ① 引号里的 */
  for (const t of texts) {
    const m = t.match(/[「『""]([^」』""]{2,10})[」』""]/g);
    if (!m) continue;
    for (const seg of m) {
      const w = seg.replace(/^[「『""]|[」』""]$/g, "").trim();
      if (w.length >= 2 && w.length <= 10) out.add(w);
    }
  }

  /* ② 反复出现的短语 —— 抓中文连续串，统计频率 */
  const freq = new Map<string, number>();
  for (const t of texts) {
    const runs = t.match(/[\u4e00-\u9fa5]{2,6}/g) ?? [];
    for (const r of runs) {
      /* 滑窗取 2-4 字 */
      for (let len = 4; len >= 2; len--) {
        for (let i = 0; i + len <= r.length; i++) {
          const w = r.slice(i, i + len);
          freq.set(w, (freq.get(w) ?? 0) + 1);
        }
      }
    }
  }
  /* 出现两次以上、且不是常见的虚词组合 */
  const STOP = new Set([
    "主人", "我们", "你们", "他们", "这个", "那个", "什么", "怎么",
    "因为", "所以", "但是", "如果", "可以", "已经", "现在", "自己",
  ]);
  for (const [w, n] of freq) {
    if (n >= 2 && !STOP.has(w) && !out.has(w)) out.add(w);
    if (out.size >= 8) break;
  }

  return Array.from(out).slice(0, 8);
}

/** 埋一个。同 id 覆盖。 */
export function bury(g: Grave) {
  const list = read().filter((x) => x.id !== g.id);
  list.push(g);
  write(list);
  /* 墓碑上多一块石头 —— 这是真的发生过的事，日志里要留痕 */
  log.bury(g.name, generationOf(g.name, 0));
}

export function loadGraves(): Graveyard {
  return read();
}

/** 按名字找 —— 新建一个同名角色时用 */
export function graveOfName(name: string): Grave | undefined {
  const n = name.trim();
  if (!n) return undefined;
  /* 后埋的优先 —— 同一个名字删过两次，记得最近那个 */
  return [...read()].reverse().find((g) => g.name === n);
}

/**
 * 这个名字已经用过几次。
 *
 * ── 为什么不禁重名，改成算代数 ──
 *
 * 禁止重名是**技术限制** —— 它把「她回来过」这件事盖掉了。
 *
 * 允许重名 + 记代数才是**叙事**：墓碑上写「第 2 次推演」，
 * 用户一眼就知道这不是第一次。
 *
 * 名字不是身份，次数才是。
 *
 * ── 怎么算 ──
 *
 * 这个名字在墓碑里埋了几座 + 场上现在有几个活的。
 *
 *   没坟、场上没有 → 第 1 次
 *   埋了 1 座      → 第 2 次
 *   埋了 2 座      → 第 3 次
 */
export function generationOf(name: string, aliveCount = 0): number {
  const n = name.trim();
  if (!n) return 1;
  const buried = read().filter((g) => g.name === n).length;
  return buried + aliveCount + 1;
}

/** 这个名字埋过几次 —— 墓碑列表上标「第 X 次推演」用 */
export function buriedCount(name: string): number {
  const n = name.trim();
  if (!n) return 0;
  return read().filter((g) => g.name === n).length;
}

/** 这个角色已经把「同名前身」那行字给过了没有 */
const SEEN_KEY = "3w:phantom-seen";

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? (p as string[]) : [];
  } catch {
    return [];
  }
}

/** 标记「已经提过一次」——只提一次，不重复 */
export function markPhantomSeen(personaId: string) {
  const list = readSeen();
  if (list.includes(personaId)) return;
  list.push(personaId);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* ignore */
  }
}

export function hasPhantomSeen(personaId: string): boolean {
  return readSeen().includes(personaId);
}

export function clearGraves() {
  write([]);
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}
