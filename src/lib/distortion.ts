/**
 * 记忆的扭曲。
 *
 * 这是全项目最重要的一条边界：
 *
 *   ❌ 编造事实   「那天吃的是炒饭」      ← 她说了没发生过的事 → bug
 *   ✅ 承认模糊   「吃了什么我记不清了」   ← 她记得自己忘了    → 剧情
 *
 * 所以这里做的**只有一件事**：按权重给出「讲法」，
 * 不改内容、不加细节、不替换词。
 *
 * 三种讲法：
 *   clear   清楚记得 —— 正常说
 *   hazy    大致记得 —— 说出来时留余地（「好像是」「记得是」）
 *   blur    只剩个印象 —— 允许说「我记不太清了」，宁可不说也不要编
 */

export type FuzzBand = "clear" | "hazy" | "blur";

/** 分档阈值。和 forgetting.MEMORY_THRESHOLD (0.2) 对齐 —— 低于它就不该出现在这里 */
export const BAND_CLEAR_AT = 0.55;
export const BAND_HAZY_AT = 0.32;

export function fuzzBand(weight: number): FuzzBand {
  // NaN = 真的没法判断 → 按最保守处理（不让她把不确定的说成确定）
  if (Number.isNaN(weight)) return "blur";
  if (weight >= BAND_CLEAR_AT) return "clear";
  if (weight >= BAND_HAZY_AT) return "hazy";
  return "blur";
}

/** 分组标题 */
export const BAND_TITLE: Record<FuzzBand, string> = {
  clear: "【你记得很清楚的事】",
  hazy: "【你只记得个大概的事】",
  blur: "【你只剩下一点影子的事】",
};

/** 每组后面跟的那句话 —— 只讲「怎么说」，不讲「说什么」 */
export const BAND_HINT: Record<FuzzBand, string | null> = {
  clear: null,
  hazy:
    "（能提，但别说得像确定无疑 —— 可以带「好像是」「记不太准」这类口气。）",
  blur:
    "（只有个模糊的影子。可以说出来，但必须承认记不清；**想不起细节就不要补**，" +
    "宁可说「我记不太清了」，也不要编一个听起来合理的东西填上。）",
};

/** 按讲法分好的三组，顺序固定：清楚 → 大概 → 模糊 */
export function groupByBand<T extends { weight: number }>(
  items: T[]
): Record<FuzzBand, T[]> {
  const out: Record<FuzzBand, T[]> = { clear: [], hazy: [], blur: [] };
  for (const it of items) out[fuzzBand(it.weight)].push(it);
  return out;
}

/**
 * 全片底线，永远附在记忆段末尾。
 *
 * 为什么单独写一条：模型很容易把「模糊记忆」理解成「可以补全」，
 * 那就从「她记得自己忘了」滑成「她在编」。
 */
export const NEVER_FABRICATE =
  "以上都是印象，不是档案。**记不清的地方就说记不清，" +
  "不要为了把话说圆而补一个细节。**";
