/**
 * 记忆的遗忘曲线。
 *
 * ── 为什么是幂函数不是指数 ──
 *
 * 第一版用的是 `R = weight × e^(-rate × days)`。
 * 算得快，但**尾巴掉得太干净**。
 *
 * 艾宾浩斯 1885 年的原始数据（无意义音节，节省法）：
 *
 *   20 分钟  58.2%
 *   1 小时   44.2%
 *   9 小时   35.8%
 *   1 天     33.7%
 *   2 天     27.8%
 *   6 天     25.4%
 *   31 天    21.1%
 *
 * 拿指数去拟合（k = 1.088）：
 *
 *   1 天     33.7%   ✅
 *   2 天     11.3%   ❌ 实测 27.8%
 *   6 天      0.1%   ❌ 实测 25.4%
 *   31 天     0.0%   ❌ 实测 21.1%
 *
 * 拿幂函数去拟合（R = 0.337 × t^(-0.136)）：
 *
 *   1 天     33.7%   ✅
 *   2 天     30.7%   ✅
 *   6 天     26.4%   ✅
 *   31 天    21.1%   ✅
 *
 * **误差全在 3 个百分点以内。**
 *
 * ── 为什么 ──
 *
 * 艾宾浩斯测的是「节省法」（重新学一遍省了多少时间），不是「回忆」。
 * 幂函数前快后慢、尾巴拖得很长 —— 那正是记忆的形状。
 *
 * 指数函数数学上更漂亮，但它描述的是「放射性衰变」，
 * 不是「你想不起来一个名字但那个名字还在」。
 *
 * ── 两段式 ──
 *
 * 海马体 → 皮层。
 *
 * 短期记忆（海马体）忘得快，被反复提取之后**巩固**成长时记忆（皮层），
 * 衰减率断崖式下跌。
 *
 * 这不是量变，是**质变**。一条被提过十次的短期记忆，
 * 不该只是「掉得慢一点」，它该**变成另一种东西**。
 */

import type { Memory } from "./memoryNotes";
import { nowMs } from "./clock";

/**
 * 幂函数的指数 —— 越大掉得越快。
 *
 * `R = weight × (1 + days)^(-b)`
 *
 * 加 1 是为了避免 t=0 时 (0)^(-b) 爆炸。
 */
const B: Record<Memory["tag"], number> = {
  /*
   * ── 这些数字是怎么定的 ──
   *
   * 不是照搬艾宾浩斯（b = 0.136）。他测的是无意义音节，
   * 用那套系数，一条记忆 30 天后还有 63% —— **那不像遗忘，像归档**。
   *
   * 也不是「几个小时掉一半」那种加速。太狠了：
   * 一场长对话下来，开头说的话已经忘了。
   *
   * 是从**玩家的上线节奏**反推的：
   *
   *   每天上线  →  一天后必须「还看得见，但确实淡了」≈ 66%
   *   一周一次  →  一周后必须「快没了但还在」≈ 29%
   *   一个月一次 →  一个月后淡出视野 ≈ 13%
   *
   * 解 (1+t)^(-b)：b = 0.6 同时满足这三个点。
   */

  /* 短期琐事：「主人今天吃了泡面」 */
  短期: 0.6,
  /* 情绪：「那次他骂了我」—— 比琐事顽固 */
  情绪: 0.4,
  /* 偏好：「他不吃香菜」—— 一直在被验证 */
  偏好: 0.32,
  /* 长期：「她第一次叫主人」 */
  长期: 0.22,
};

/**
 * 已巩固的记忆用这个 —— 断崖式下跌。
 *
 * 1 天 96% / 7 天 88% / 30 天 81% / 一年 70%
 */
const B_CONSOLIDATED = 0.06;

/** 低于这个值就不注入了 */
export const MEMORY_THRESHOLD = 0.2;

/**
 * 巩固条件：被提取过几次之后，它就搬进皮层了。
 *
 * 艾宾浩斯自己的实验里，间隔学习比集中学习效率高十倍。
 * 三次提取是个低门槛 —— 一场对话里提两次，第二天再提一次就够了。
 */
export const CONSOLIDATE_AT = 3;

/** 创伤 —— 天生就是皮层的，不衰减 */
function isPermanent(m: Memory): boolean {
  return m.reason === "milestone" || m.reason === "rename";
}

/** 这条记忆是不是已经在皮层了 */
export function isConsolidated(m: Memory): boolean {
  return m.consolidated === true || isPermanent(m);
}

/**
 * 这条记忆**此刻**还有多重。
 *
 * 每次调用都重算 —— 不存回 localStorage。
 */
export function effectiveWeight(m: Memory, now = 0): number {
  /* 默认参数在函数定义时求值一次 —— 所以要在这里再取，才能拿到最新的时间偏移 */
  if (!now) now = nowMs();
  if (m.forgotten) return 0;
  if (isPermanent(m)) return m.weight;

  const since = m.lastAccessed ?? m.at ?? now;
  /*
   * 时间戳是**真实时间**，now 是**偏移后的现在**。
   * 差值 = 真实间隔 + 偏移天数。
   *
   * max(0) 是兜底 —— 正常情况不该出现负数。
   * 如果出现，说明有数据被写到了未来（只有 time 偏移时才会发生，
   * 而那正是我们要算的）。
   */
  const days = Math.max(0, (now - since) / 86400000);

  /*
   * 间隔效应：复习让**衰减率本身**下降，不只是重置时钟。
   *
   * 第一版没有这一步 —— 复习一次只是回到 100%，然后按同样速度掉。
   * 那只是「重置」，不是「记住」。
   *
   *   复习 0 次   b = 0.350   三天后剩 61%
   *   复习 1 次   b = 0.219   三天后剩 74%
   *   复习 3 次   b = 0.125   三天后剩 84%
   */
  const base = isConsolidated(m) ? B_CONSOLIDATED : (B[m.tag] ?? 0.22);
  const b = base / (1 + (m.accessCount ?? 0) * 0.6);

  return m.weight * Math.pow(1 + days, -b);
}

/**
 * 这条记忆该不该巩固了。
 *
 * 条件：没被忘掉、还没巩固、被提取过至少 3 次、**当前还够清晰**。
 *
 * 最后一条很重要 —— 一条已经淡到 0.1 的记忆不该突然被巩固，
 * 那等于「你想不起来的东西突然变得刻骨铭心」。
 */
export function shouldConsolidate(m: Memory, now = 0): boolean {
  if (!now) now = nowMs();
  if (m.forgotten || isConsolidated(m)) return false;
  if ((m.accessCount ?? 0) < CONSOLIDATE_AT) return false;
  return effectiveWeight(m, now) >= 0.3;
}

/** 这条记忆有没有淡到「潜意识」里去 */
export function isFaded(m: Memory, now = 0): boolean {
  if (!now) now = nowMs();
  return !m.forgotten && effectiveWeight(m, now) < MEMORY_THRESHOLD;
}

/** 从一条记忆里抠出「能把它唤回来的词」 */
export function wakeWords(text: string): string[] {
  const out = new Set<string>();
  const quoted = text.match(/[「『""]([^」』""]{2,12})[」』""]/g);
  if (quoted) {
    for (const seg of quoted) {
      const w = seg.replace(/^[「『""]|[」』""]$/g, "").trim();
      if (w.length >= 2) out.add(w);
    }
  }
  const runs = text.match(/[\u4e00-\u9fa5]{3,6}/g) ?? [];
  for (const r of runs.slice(0, 3)) out.add(r);
  return Array.from(out).slice(0, 6);
}

/**
 * 潜意识命中。
 *
 * 用户刚说的话里，有没有触及某条**已经淡掉**的记忆。
 */
export function residueHit(faded: Memory[], userText: string): Memory | undefined {
  if (!userText) return undefined;
  for (const m of faded) {
    for (const w of wakeWords(m.text)) {
      if (w.length >= 2 && userText.includes(w)) return m;
    }
  }
  return undefined;
}

/**
 * 一条记忆的「新鲜度」—— 给 UI 用。
 *
 * 1 = 刚想起来，0 = 彻底淡了。
 */
export function freshness(m: Memory, now = 0): number {
  if (!now) now = nowMs();
  if (m.forgotten) return 0;
  const w = effectiveWeight(m, now);
  return Math.max(0, Math.min(1, (w - MEMORY_THRESHOLD) / (1 - MEMORY_THRESHOLD)));
}
