/**
 * 把一条回复拆成几个气泡。
 *
 * ── 为什么需要 ──
 *
 * 整条一次性出现，读起来是「系统吐了一段文本」。
 * 拆成 2–3 个气泡、中间隔一秒，就变成「有人在打字」。
 *
 * **同一句话，观感完全不同。**
 *
 * ── 拆坏的两种方式 ──
 *
 *   ① 拆得太碎：「嗯。」「我在。」「你呢？」三个气泡 —— 像机器人在挤牙膏
 *   ② 拆在句子中间：「我在家收拾阳台那几/盆快被我养死的花」—— 一眼假
 *
 * 所以规则要保守：**宁可少拆，不要拆错。**
 */

/** 太短的整体不值得拆（拆了反而怪） */
const MIN_TOTAL = 42;

/**
 * 单个片段短于这个，就并进邻居。
 *
 * 定在 6：「好的。」（3 字）该并，「你们怎么看？」（6 字）该独立。
 * 真实聊天里，一个短问句单独发出来是很常见的 ——
 * 但一个「嗯。」单独发出来，看起来像两个人。
 */
const MIN_SEGMENT = 6;

/** 最多拆几个 */
const MAX_BUBBLES = 3;

/**
 * 一条回复 → 若干个气泡。
 *
 * 返回长度 1 = 不拆，照原样发。
 */
export function splitBubbles(text: string, max = MAX_BUBBLES): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];

  /*
   * ── 空行是强信号，直接信任 ──
   *
   * 模型主动打了空行，就是它想分段。哪怕整条只有 36 个字，
   * 三个空行分开的段落也该是三个气泡 ——
   * 「等一下」「我觉得不对」「你们怎么看」本来就是三句话。
   *
   * `MIN_TOTAL` 只用来拦**没有空行**的情况（比如靠单换行硬切）。
   */
  const hasBlankLine = /\n\s*\n/.test(t);

  if (!hasBlankLine && t.length < MIN_TOTAL) return [t];

  let parts = hasBlankLine
    ? t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
    : t.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  if (parts.length <= 1) return [t];

  /*
   * 把太短的片段并到前一段。
   *
   * 单独一个「好。」「嗯。」当气泡，看起来像两个人在说话 ——
   * 但那其实是一个人，会让人分不清谁是谁。
   */
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length > 0 && p.length < MIN_SEGMENT) {
      merged[merged.length - 1] += " " + p;
    } else {
      merged.push(p);
    }
  }

  /* 开头的短片段并到后一段 */
  while (merged.length > 1 && merged[0].length < MIN_SEGMENT) {
    merged[1] = merged[0] + " " + merged[1];
    merged.shift();
  }

  /* 超上限：后面的全并进最后一个 —— 宁可少拆 */
  if (merged.length > max) {
    merged.splice(max - 1, merged.length, merged.slice(max - 1).join(" "));
  }

  return merged.filter(Boolean);
}

/**
 * 第 i 个气泡和第 i+1 个之间停多久（毫秒）。
 *
 * 有随机，但**不做等间隔** —— 等间隔听起来像节拍器。
 * 越靠后停得越短一点：人打字是越说越顺的。
 */
export function bubbleDelay(i: number): number {
  const base = 780 + Math.random() * 620;
  return Math.round(base * Math.max(0.55, 1 - i * 0.18));
}
