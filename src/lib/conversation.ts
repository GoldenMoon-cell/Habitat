/**
 * 对话循环 —— 谁该说话、说到第几句、什么时候停下来。
 *
 * ── 为什么单独一个文件 ──
 *
 * 这套判断是**纯函数**：给定此刻的状态，算出「下一个人是谁 / 还是没人」。
 * 不碰 React、不碰网络、不碰 localStorage 以外的东西。
 *
 * 单独放还有一个好处：**可以单测**。
 * 「4 个人心情都低的时候会停」「同一对不能连续互 @」这些行为，
 * 在真的跟模型说话之前就该能验。
 *
 * ── 设计规格 ──
 *
 * 见 `docs/proactive.md`。这里只实现，不重复解释为什么。
 */

import type { Persona } from "../data/personas";
import type { ConvId } from "../data/mock";

/* ══════════════════════════════════════════
   轮次状态
   ══════════════════════════════════════════ */

export interface ConvRuntime {
  /** 本轮已经说了几条（用户发言时归零） */
  round: number;
  /** 本轮第一条的时间戳 */
  roundStartAt: number;
  /** 上一条 AI 消息的时间戳 */
  lastAiAt: number;
  /** 有 AI @ 了用户，在等你回 */
  waitingFor?: "me";
  /** 私聊「安静台词」上次出现的时间 —— 一天最多一条 */
  quietShownAt?: number;
  /**
   * 上一条是谁说的 —— 用来判「连发」。
   *
   * 真实群里一个人会连着发两三条（想到一半又补一句），
   * 所以不能硬禁止同一个人连说。但要有个上限，否则变成独角戏。
   */
  lastSpeaker?: string;
  /** 他已经连着说了几条 */
  streak?: number;
  /**
   * 每个人**最后一次开口**的时间。
   *
   * ── 为什么不能复用 DynamicState.lastAt ──
   *
   * `lastAt` 是「这个角色最后一次有动静」—— 用户发一句话，
   * 群里所有人都会被 tick 一次，`lastAt` 全部变成「刚刚」。
   *
   * 那「沉默加成」就永远是 0，对话进行中谁都拿不到。
   * **第一版就是这么写的，结果 AI 说完一句，群里再没人想接。**
   *
   * 这里记的是「她上一次**说话**」—— 才是沉默该看的。
   */
  spokenAt?: Record<string, number>;
}

const KEY = "3w:conv-runtime";

type Store = Record<string, ConvRuntime>;

function emptyState(): ConvRuntime {
  const now = Date.now();
  return { round: 0, roundStartAt: now, lastAiAt: 0 };
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 写不进去就只活在内存里 —— 不能因为统计把人卡住 */
  }
}

export function readRuntime(conv: ConvId | string): ConvRuntime {
  const s = readStore();
  return s[String(conv)] ?? emptyState();
}

/** 用户发言 —— 轮次归零，重新开始 */
export function resetRound(conv: ConvId | string): ConvRuntime {
  const s = readStore();
  const now = Date.now();
  const next: ConvRuntime = {
    ...(s[String(conv)] ?? {}),
    round: 0,
    roundStartAt: now,
    lastAiAt: now,
  };
  delete next.waitingFor;
  /* 用户说话了 → 连发链断了，重新数 */
  delete next.lastSpeaker;
  delete next.streak;
  s[String(conv)] = next;
  writeStore(s);
  return next;
}

/** 一条 AI 发言落地 —— 轮次 +1 */
export function bumpRound(conv: ConvId | string): ConvRuntime {
  const s = readStore();
  const cur = s[String(conv)] ?? emptyState();
  const next: ConvRuntime = { ...cur, round: cur.round + 1, lastAiAt: Date.now() };
  s[String(conv)] = next;
  writeStore(s);
  return next;
}

/** 有 AI 点名找用户 —— 记一笔「在等你」，但不阻塞别人 */
export function markWaitingForMe(conv: ConvId | string) {
  const s = readStore();
  const cur = s[String(conv)] ?? emptyState();
  s[String(conv)] = { ...cur, waitingFor: "me" };
  writeStore(s);
}

/**
 * 她开口了 —— 记下来。
 *
 * 记三样：
 *   · spokenAt   → 「沉默加成」用
 *   · lastSpeaker + streak → 「连发」用
 */
export function markSpoke(conv: ConvId | string, who: string) {
  const s = readStore();
  const cur = s[String(conv)] ?? emptyState();
  const same = cur.lastSpeaker === who;
  s[String(conv)] = {
    ...cur,
    lastSpeaker: who,
    streak: same ? (cur.streak ?? 0) + 1 : 1,
    spokenAt: { ...(cur.spokenAt ?? {}), [who]: Date.now() },
  };
  writeStore(s);
}

/** 距这个人上次**开口**多少分钟。没开过口 → Infinity（最想说） */
export function idleMinutesOf(rt: ConvRuntime, who: string): number {
  const at = rt.spokenAt?.[who];
  return at ? (Date.now() - at) / 60_000 : Infinity;
}

/** 安静台词发过了 —— 记时间做节流 */
export function markQuietShown(conv: ConvId | string) {
  const s = readStore();
  const cur = s[String(conv)] ?? emptyState();
  s[String(conv)] = { ...cur, quietShownAt: Date.now() };
  writeStore(s);
}

/* ══════════════════════════════════════════
   热度
   ══════════════════════════════════════════ */

/**
 * 话题热度。1 = 刚起头，0 = 凉透了。
 *
 * 用「第几句」近似「话题还剩多少」—— 在 4 条上限之内几乎等价，
 * 而精确判断话题变没变需要 embedding，每次多一次接口调用，不值。
 */
export function heatOf(rt: ConvRuntime, now = Date.now()): number {
  const staleMin = Math.max(0, (now - rt.roundStartAt) / 60_000);
  const h = 1 - rt.round * 0.2 - (staleMin > 3 ? 0.1 : 0);
  /* 两位小数 —— 它是阈值和显示值，不是测量值。也让它可断言 */
  return Math.round(Math.max(0, Math.min(1, h)) * 100) / 100;
}

/** 热度落在哪个档 —— 决定「正常接 / 开始收 / 不接」 */
export type HeatBand = "open" | "cooling" | "cold";

export function bandOf(heat: number): HeatBand {
  if (heat > 0.6) return "open";
  if (heat >= 0.3) return "cooling";
  return "cold";
}

/* ══════════════════════════════════════════
   意愿
   ══════════════════════════════════════════ */

/** 意愿阈值 —— 低于它就不想说话 */
export const DESIRE_THRESHOLD = 0.55;

/**
 * 同一个人最多连着说几条。
 *
 * 2 条是刻意的：真实群里「补一句」很常见，
 * 「连着说三条以上」就变成了独角戏，别人插不进来。
 */
export const MAX_STREAK = 2;

/**
 * 说完一句之后，他接着补一句的概率。
 *
 * 为什么不是靠意愿分决定：意愿分里已经有「刚说过 −0.3」，
 * 那个惩罚让同一个人几乎不可能再赢一次 —— 结果就是永远轮流发言。
 *
 * 连发不是「更想说话」，是**一句话没说完**。这是两件事。
 */
export const CONTINUE_CHANCE = 0.25;

export interface DesireInput {
  persona: Persona;
  /** 动态三轴 */
  dynamic?: { 心情?: number; 亲近?: number };
  /** 距这个人上次说话多少分钟（没说过给 Infinity） */
  idleMin: number;
  /** 刚才那条消息里提到她了吗 */
  mentioned: boolean;
  /** 有没有和刚才那条消息呼应的记忆 */
  memoryEcho: boolean;
  /** 她就是刚才说话的人吗（连着说 = 抢话） */
  justSpoke: boolean;
}

/**
 * 她现在有多想说。
 *
 * 这个分数没有「模型判断」准，但它是**可解释的** ——
 * 你点开雷达能看见「心情 88、亲近 91」，然后理解她为什么开口。
 *
 * 加了判断模型之后，这个分数用来**筛候选**，不是最终决定。
 */
export function desireOf(i: DesireInput): number {
  const mood = (i.dynamic?.心情 ?? 50) / 100;
  const close = (i.dynamic?.亲近 ?? 50) / 100;

  /*
   * 沉默加成：5 分钟开始涨，30 分钟到顶 +0.25。
   *
   * `Infinity` = **从来没开过口** —— 那是最想说话的状态，给满分。
   *
   * 第一版这里写的 `Infinity ? 0` —— 意思正好反了：
   * 从没说过话的人拿不到沉默加成，永远开不了口。
   * 「新人反而插不上话」，整段对话就死了。
   */
  const silence =
    i.idleMin === Infinity
      ? 0.25
      : Math.min(0.25, Math.max(0, ((i.idleMin - 5) * 0.25) / 25));

  let d = mood * 0.3 + close * 0.3 + silence;
  if (i.mentioned) d += 0.4;
  if (i.memoryEcho) d += 0.15;
  if (i.justSpoke) d -= 0.3;

  return Math.max(0, Math.min(1, d));
}

/* ══════════════════════════════════════════
   @ 解析
   ══════════════════════════════════════════ */

/**
 * 从一句 AI 的回复里抽出 `[@名字]`。
 *
 * ── 为什么用方括号 ──
 *
 * 裸 `@名字` 会误伤：正文里本来就可能出现 @（邮箱、代码、她转述你的话）。
 * `[改名:新名字]` 已经验证过这条路 —— 方括号 + prompt 约束，解析零歧义。
 *
 * 返回名字列表（可能多个），调用方负责校验「在不在群里」「是不是她自己」。
 */
export function parseMentions(text: string): string[] {
  const out: string[] = [];
  const re = /\[@([^\]\n]{1,24})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1].trim();
    if (name) out.push(name);
  }
  return out;
}

/**
 * 把 `[@名字]` 去掉方括号 —— 只给显示用。
 *
 * **不要用它做解析**：解析必须用 parseMentions，否则拿不到结构。
 */
export function stripMentionBrackets(text: string): string {
  return text.replace(/\[@([^\]\n]{1,24})\]/g, "@$1");
}

/* ══════════════════════════════════════════
   互 @ 死循环防护
   ══════════════════════════════════════════ */

const MENTION_KEY = "3w:mention-chain";
/** 同一对最多连续互 @ 几次 */
const MAX_MUTUAL = 2;

type Chain = { from: string; to: string; count: number; at: number };

function readChain(): Chain | null {
  try {
    const raw = localStorage.getItem(MENTION_KEY);
    return raw ? (JSON.parse(raw) as Chain) : null;
  } catch {
    return null;
  }
}

/**
 * 这次 @ 允许吗。
 *
 * @ 是强制的 —— 跳过意愿阈值。所以**只有硬上限和这条能拦住它**。
 *
 * 不加这条的话，最坏情况长这样（而且真的会发生）：
 *
 *   鲸鲸 [@澜汐] 你怎么看
 *   澜汐 [@鲸鲸] 我觉得…你呢
 *   鲸鲸 [@澜汐] 我也觉得…
 *   → 两个人你来我往，你的钱在烧
 */
export function allowMention(from: string, to: string): boolean {
  const c = readChain();
  if (!c) return true;
  /* 链断了（换了人，或超过 2 分钟）→ 重新计数 */
  if (c.from !== from || c.to !== to) return true;
  if (Date.now() - c.at > 120_000) return true;
  return c.count < MAX_MUTUAL;
}

export function recordMention(from: string, to: string) {
  const c = readChain();
  const same = c && c.from === from && c.to === to && Date.now() - c.at <= 120_000;
  const next: Chain = {
    from,
    to,
    count: same ? c!.count + 1 : 1,
    at: Date.now(),
  };
  try {
    localStorage.setItem(MENTION_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/* ══════════════════════════════════════════
   记忆呼应
   ══════════════════════════════════════════ */

/**
 * 中文停用字。双字词里只要沾上一个就丢掉。
 *
 * **为什么必须剔**：不剔的话「我今天好累」和「她说我很好」
 * 会命中「我、好」—— 语义完全无关，却算作呼应。
 * 那会让换话题变成「突然扯一句不相关的话」，比不换更怪。
 */
const STOP = /[我你他她它的了是就不在有也都和与这那什么怎么吗呢吧啊哦嗯没很太]/;

function grams(s: string): Set<string> {
  const clean = s.replace(/[，。！？、…—\s"'「」（）【】]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    if (!STOP.test(g[0]) && !STOP.test(g[1])) out.add(g);
  }
  return out;
}

/**
 * 这条记忆和刚才那段话有没有真呼应。
 *
 * 要求 **2 个不同的双字词**命中 —— 一个太容易误中。
 */
export function resonates(topic: string, memory: string): boolean {
  const A = grams(topic);
  if (A.size === 0) return false;
  const B = grams(memory);
  let hit = 0;
  for (const g of A) {
    if (B.has(g) && ++hit >= 2) return true;
  }
  return false;
}

/* ══════════════════════════════════════════
   换话题的燃料
   ══════════════════════════════════════════ */

export interface FuelCandidate {
  id: string;
  text: string;
  tag: string;
  weight: number;
  accessCount?: number;
  lastAccessed?: number;
  forgotten?: boolean;
}

/** 多久没想起才算「久未想起」 */
const FUEL_MIN_DAYS = 3;

/**
 * 挑一条「她很久没想起的事」。
 *
 * ── 为什么需要它 ──
 *
 * 热度降到 cooling 的时候，光告诉模型「可以收了」不够 ——
 * 它没有别的东西可说，只会憋出一句「那我们聊聊你最近怎么样吧」。
 *
 * 给她一条**真实的旧事**，换话题才有落脚点。
 *
 * ── 选法 ──
 *
 *   1. 没被忘掉
 *   2. 没怎么被提起过（accessCount <= 2）
 *   3. 确实很久了（距上次想起 > 3 天）
 *   4. **优先能呼应正在聊的话题**（过渡才无痕）
 *   5. 都不呼应 → 越久越优先
 *
 * 找不到就返回 null —— **不要硬凑**。没有燃料就单纯地收尾。
 */
export function pickFuel<T extends FuelCandidate>(
  list: T[],
  topicText: string,
  now = Date.now()
): T | null {
  const pool = list.filter((m) => {
    if (m.forgotten) return false;
    if ((m.accessCount ?? 0) > 2) return false;
    const at = m.lastAccessed ?? 0;
    if (!at) return false;
    return now - at > FUEL_MIN_DAYS * 86_400_000;
  });

  if (pool.length === 0) return null;

  /* 先找能呼应当前话题的 */
  const echo = pool.filter((m) => resonates(topicText, m.text));
  const pick = echo.length > 0 ? echo : pool;

  /* 越久没想起越优先 */
  return pick.reduce((best, m) =>
    (m.lastAccessed ?? 0) < (best.lastAccessed ?? 0) ? m : best
  );
}

/* ══════════════════════════════════════════
   安静台词（私聊）
   ══════════════════════════════════════════ */

/**
 * 私聊里她「在场但没说话」的几条动作描述。
 *
 * ── 为什么不调模型 ──
 *
 * 为了发一句「她没有说话」花 12k tokens 是荒谬的。
 * 而且模型写舞台指示很容易写成烂剧本：
 *
 *   ❌「她低下头，眼神黯淡，似乎在思考什么」
 *   ✅「她把屏幕亮度调低了一点。」
 *
 * **克制是这里的全部。** 不解释、不撒娇、不问「你还在吗」。
 */
export const QUIET_LINES = [
  "【她把屏幕亮度调低了一点。】",
  "【她没说话，但头像还亮着。】",
  "【她翻到上面，把你说过的话又看了一遍。】",
  "【光标闪了几下，又停了。】",
  "【她把窗口拖到一边，还留着一条缝。】",
];

/** 隔多久没互动，才值得发一次安静台词 */
const QUIET_AFTER_HOURS = 6;

/**
 * 该不该发一条安静台词。
 *
 * ── 为什么必须节流 ──
 *
 * 不节流的话，「她不说话」会被演成「她一直在表演沉默」——
 * 比真的沉默更假。**沉默的效果来自它的稀有。**
 * 一天最多一次。
 */
export function shouldShowQuiet(
  rt: ConvRuntime,
  lastInteractAt: number,
  now = Date.now()
): boolean {
  /* 今天已经发过 → 不发 */
  if (rt.quietShownAt) {
    const sameDay =
      new Date(rt.quietShownAt).toDateString() === new Date(now).toDateString();
    if (sameDay) return false;
  }
  /* 刚聊完 → 不说话是正常的，不用演 */
  if (now - lastInteractAt < QUIET_AFTER_HOURS * 3_600_000) return false;
  return true;
}

export function pickQuietLine(): string {
  return QUIET_LINES[Math.floor(Math.random() * QUIET_LINES.length)];
}

/* ══════════════════════════════════════════
   活跃度
   ══════════════════════════════════════════ */

export type Activity = "quiet" | "normal" | "lively";

const ACTIVITY_KEY = "3w:group-activity";

/** 一轮 AI 最多连续说几条 */
export function maxRoundOf(activity: Activity): number {
  return activity === "quiet" ? 2 : activity === "lively" ? 6 : 4;
}

export function readActivity(): Activity {
  try {
    const v = localStorage.getItem(ACTIVITY_KEY);
    return v === "quiet" || v === "lively" ? v : "normal";
  } catch {
    return "normal";
  }
}

export function saveActivity(a: Activity) {
  try {
    localStorage.setItem(ACTIVITY_KEY, a);
  } catch {
    /* ignore */
  }
}

/**
 * 按意愿把候选人排好序。
 *
 * ── 为什么单独抽出来 ──
 *
 * 规则版和判断模型必须看**同一批人**。如果各算各的，
 * 就会出现「规则说澜汐分最高，判断模型却说鲸鲸」而两边都自认有理。
 *
 * 所以：本地算分 → 排序 → 取前 N → 交给判断模型当候选。
 * 判断模型只能在这一批里挑，挑不出去。
 */
export function rankCandidates(
  i: PickInput,
  limit = 3
): { persona: Persona; desire: number }[] {
  return i.members
    .filter((p) => String(p.id) !== i.lastSpeakerId || i.members.length === 1)
    .map((p) => ({
      persona: p,
      desire: desireOf({
        persona: p,
        dynamic: i.dynamicOf(String(p.id)),
        idleMin: i.idleMinutes(String(p.id)),
        mentioned: i.lastText.includes(p.name),
        memoryEcho: i.echoOf(String(p.id)),
        justSpoke: String(p.id) === i.lastSpeakerId,
      }),
    }))
    .sort((a, b) => b.desire - a.desire)
    .slice(0, limit);
}

/* ══════════════════════════════════════════
   选人
   ══════════════════════════════════════════ */

export interface PickInput {
  conv: ConvId | string;
  members: Persona[];
  runtime: ConvRuntime;
  /** 这个会话的上限：安静 2 / 正常 4 / 热闹 6 */
  maxRound: number;
  /** 刚才那条消息的正文 */
  lastText: string;
  /** 刚才说话的人 */
  lastSpeakerId: string;
  /** 每个人距上次说话的分钟数 */
  idleMinutes: (id: string) => number;
  dynamicOf: (id: string) => { 心情?: number; 亲近?: number } | undefined;
  /** 有没有和 lastText 呼应的记忆 */
  echoOf: (id: string) => boolean;
}

export type PickResult =
  | { kind: "speak"; persona: Persona; via: "mention" | "desire" | "continue" }
  | { kind: "quiet"; reason: "cap" | "cold" | "no-desire" | "empty" };

/**
 * 下一个谁说话。
 *
 * 三档优先级（见 docs/proactive.md §3）：
 *
 *   ① 有人被 [@名字] 点了 → 他接
 *   ② 没有 @ → 算意愿，最高的过阈值 → 他接
 *   ③ 都不够 / 到上限 → 停
 */
export function pickNext(i: PickInput): PickResult {
  if (i.members.length === 0) return { kind: "quiet", reason: "empty" };

  /* 到上限了 —— @ 也不能突破 */
  if (i.runtime.round >= i.maxRound) return { kind: "quiet", reason: "cap" };

  /* 热度凉了就不接 */
  if (bandOf(heatOf(i.runtime)) === "cold") return { kind: "quiet", reason: "cold" };

  /* ── ① 点名 ── */
  const names = parseMentions(i.lastText);
  for (const name of names) {
    /*
     * ── 重名怎么办 ──
     *
     * 项目**允许重名**（`generationOf` 那里写过「不靠名字唯一性」）。
     * 所以 `[@阿野]` 可能同时命中两个人 —— 那时候不能猜。
     *
     * 规则：
     *   ① 先把自己排除（不能 @ 自己）
     *   ② 剩下正好一个 → 就是他
     *   ③ 剩下两个以上 → **歧义，不点名**，退回去算意愿
     *
     * 猜错比不猜更糟：把话递给错的人，比没人接更尴尬。
     */
    const hits = i.members.filter((m) => m.name === name || m.handle === `@${name}`);
    const others = hits.filter((m) => String(m.id) !== i.lastSpeakerId);
    if (others.length !== 1) continue;

    const hit = others[0];
    if (!allowMention(i.lastSpeakerId, String(hit.id))) continue; /* 互 @ 死循环 */
    return { kind: "speak", persona: hit, via: "mention" };
  }

  /*
   * ── ② 连发 ──
   *
   * 上一个人可能还没说完。
   *
   * 判断放在意愿之前：因为意愿分里带着「刚说过 −0.3」，
   * 让同一个人靠意愿再赢一次几乎不可能 —— 那对话就永远是轮流发言。
   *
   * 连发不是「更想说话」，是**一句话没说完**。
   */
  const streak = i.runtime.lastSpeaker === i.lastSpeakerId ? (i.runtime.streak ?? 0) : 0;
  if (streak < MAX_STREAK && Math.random() < CONTINUE_CHANCE) {
    const last = i.members.find((m) => String(m.id) === i.lastSpeakerId);
    if (last) return { kind: "speak", persona: last, via: "continue" };
  }

  /* ── ③ 意愿 ── */
  let best: { p: Persona; d: number } | null = null;
  for (const p of i.members) {
    const id = String(p.id);
    /*
     * 刚说过的人仍然不参与意愿竞争 —— 他想再说，走上面的连发那条路。
     * （留着这个排除是为了不让 −0.3 的惩罚把别人挤掉又选回他）
     */
    if (id === i.lastSpeakerId && i.members.length > 1) continue;

    const d = desireOf({
      persona: p,
      dynamic: i.dynamicOf(id),
      idleMin: i.idleMinutes(id),
      mentioned: i.lastText.includes(p.name),
      memoryEcho: i.echoOf(id),
      justSpoke: id === i.lastSpeakerId,
    });

    if (!best || d > best.d) best = { p, d };
  }

  if (best && best.d >= DESIRE_THRESHOLD) {
    return { kind: "speak", persona: best.p, via: "desire" };
  }

  return { kind: "quiet", reason: "no-desire" };
}
