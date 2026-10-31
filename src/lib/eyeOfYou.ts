/**
 * 「她眼里的你」。
 *
 * ── 这个文件解决什么 ──
 *
 * 记忆卡里存的是**你的原话**：
 *
 *   「我不吃香菜，受不了那个味」
 *   「我叫阿野」
 *   「我今天加班到十点，累死了」
 *
 * 那是**你说的话**，摆在界面上叫「对话记录」，不叫「她眼里的你」。
 *
 * 这一栏要的是**她的口吻**：
 *
 *   「他不吃香菜。」
 *   「他叫阿野。」
 *   「他那天加班到十点，说累死了。」
 *
 * ── 为什么不用 LLM 改写 ──
 *
 * 和 `extract.ts` 同一个理由：每次打开 tab 多一次调用，贵且慢。
 *
 * 而且这件事的难点不在"懂意思"，在**措辞**。措辞要靠人定规则，
 * 不是靠模型现场发挥 —— 模型每次给的句式不一样，这一栏就不可靠了。
 *
 * **规则化改写有个好处：你能预测它说什么。** 改坏了能改规则，
 * 而不是"再抽一次看看"。
 *
 * ── 会改坏的地方，认了 ──
 *
 * 代词替换处理不了所有中文：
 *
 *   「我觉得你根本不懂我」→「他觉得你根本不懂他」  ← 通，但意思变了
 *
 * 所以有两道保险：
 *   ① 只用**过了阈值**的记忆（淡去的不进）
 *   ② 太长的截断 —— 长句里代词多，改坏概率高
 */

import type { Memory } from "./memoryNotes";
import { effectiveWeight, MEMORY_THRESHOLD } from "./forgetting";

export interface Impression {
  id: string;
  /** 她的口吻 */
  text: string;
  tag: Memory["tag"];
  /** 当前有效权重，用于排序和显示进度 */
  weight: number;
}

/*
 * ── 改写 ──
 */

/** 这些句子不摘：它们在说"我对你的态度"，不是"你是什么样的人" */
const ABOUT_US = [
  "你根本", "你不懂", "你不该", "你怎么能",
  "我恨", "我讨厌你", "我不理",
];

/**
 * 把「你的原话」改成「她的口吻」。
 *
 * 只做代词替换 + 轻清理。**不重写句子结构** ——
 * 那需要理解语义，规则做不到，硬做会出一堆半通不通的话。
 */
export function toHerVoice(raw: string): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;

  /* 在说"我们之间"，不是"他是什么人" —— 跳过 */
  if (ABOUT_US.some((w) => s.includes(w))) return null;

  /*
   * 「我说过我不吃香菜」→「我不吃香菜」
   *
   * 不剥的话会变成「他说过他 he 不吃香菜」这种。
   */
  s = s.replace(/^我\s*说\s*过\s*/, "");

  /*
   * 代词替换。
   *
   * 顺序不重要 —— 「我的」里的「我」换成「他」正好是「他的」。
   * 「咱们」→「他们」也对。
   */
  s = s.replace(/我/g, "他").replace(/咱/g, "他").replace(/俺/g, "他");

  /* 连出来的「他他」收一个 */
  s = s.replace(/他他/g, "他");

  /*
   * 太长的截断。
   *
   * 长句里代词多，规则改坏的概率高。宁可少说一句，
   * 不要给她安一句她根本不会说的话。
   *
   * 截在最后一个标点，不是硬切。
   */
  const MAX = 34;
  if (s.length > MAX) {
    const cut = s.slice(0, MAX);
    const last = Math.max(
      cut.lastIndexOf("，"),
      cut.lastIndexOf("。"),
      cut.lastIndexOf("、"),
      cut.lastIndexOf("；"),
    );
    s = last >= 8 ? cut.slice(0, last) : cut;
  }

  /* 收尾标点：统一成句号，别留半个逗号 */
  s = s.replace(/[，,、；;：:\s]+$/, "").replace(/[。！？!?]+$/, "");
  if (!s) return null;

  return s.length >= 3 ? s : null;
}

/*
 * ── 挑哪几条 ──
 */

/**
 * tag 的优先级 —— **她是先知道"你是什么人"，才记得"你哪天怎么了"。**
 *
 * 所以长期（他是谁）和偏好（他要什么）排在情绪前面，
 * 哪怕情绪的权重更高。
 */
const TAG_RANK: Record<Memory["tag"], number> = {
  长期: 0,
  偏好: 1,
  情绪: 2,
  短期: 3,
};

/**
 * 从记忆里摘出「她眼里的你」。
 *
 * @param memories 这个会话的全部记忆（含已淡去的 —— 这里自己筛）
 * @param limit    最多几条，默认 4
 */
export function eyeOfYou(memories: Memory[], limit = 4): Impression[] {
  const out: Impression[] = [];
  const seen = new Set<string>();

  for (const m of memories) {
    /* 淡去的不进 —— 她已经想不起来了，不该摆在这儿 */
    const w = effectiveWeight(m);
    if (w < MEMORY_THRESHOLD) continue;

    /* 被忘掉的、被压抑的，不进来 —— 她已经不愿想起了 */
    if (m.forgotten || m.suppressed) continue;

    const text = toHerVoice(m.text);
    if (!text) continue;

    /* 去掉句子太像的（改完之后可能撞） */
    const key = text.slice(0, 8);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ id: m.id, text, tag: m.tag, weight: w });
  }

  /*
   * 排序：先按 tag 优先级，同 tag 内按权重降序。
   *
   * 不纯按权重，是因为一条 0.9 的「他今天很累」会把
   * 一条 0.7 的「他叫阿野」挤掉 —— 那是错的顺序。
   */
  out.sort((a, b) => {
    const r = TAG_RANK[a.tag] - TAG_RANK[b.tag];
    return r !== 0 ? r : b.weight - a.weight;
  });

  return out.slice(0, limit);
}
