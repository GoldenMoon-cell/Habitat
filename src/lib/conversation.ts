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

  /* 沉默加成：5 分钟开始涨，30 分钟到顶 +0.25 */
  const silence = i.idleMin === Infinity ? 0 : Math.min(0.25, Math.max(0, (i.idleMin - 5) * 0.25 / 25));

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
  | { kind: "speak"; persona: Persona; via: "mention" | "desire" }
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
    const hit = i.members.find((m) => m.name === name || m.handle === `@${name}`);
    if (!hit) continue; /* 不在这个群里 → 忽略 */
    if (String(hit.id) === i.lastSpeakerId) continue; /* 不能 @ 自己 */
    if (!allowMention(i.lastSpeakerId, String(hit.id))) continue; /* 互 @ 死循环 */
    return { kind: "speak", persona: hit, via: "mention" };
  }

  /* ── ② 意愿 ── */
  let best: { p: Persona; d: number } | null = null;
  for (const p of i.members) {
    const id = String(p.id);
    if (id === i.lastSpeakerId && i.members.length > 1) continue; /* 别连着说 */

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
