/**
 * Memory → StarDef
 *
 * 星图引擎（src/components/starmap/Engine.js）要的是一种「已经算好」的星定义，
 * 而我们的 Memory 存的是**初始**权重。转换在这里做，别让引擎自己算。
 *
 * 核心原则：**位置和亮度是同一个数（effectiveWeight）的两次使用**。
 * 别把它们当两个独立参数 —— 那样怎么调都不对。
 */

import type { Memory } from "./memoryNotes";
import { loadMemories } from "./memoryNotes";
import { effectiveWeight } from "./forgetting";

export interface StarDef {
  id: string;
  /** 展开后采样成粒子字的那句话 */
  text: string;
  /** 悬停时看到的单字 */
  kernel: string;
  at: [number, number, number];
  /** 还剩多少（0~1）—— 决定「丢了多少粒子」 */
  mass: number;
  /** 粒子结合得多紧 —— 决定散开时散得多快 */
  cohesion: number;
  /** 刻进去的比例 —— 这部分永远不掉 */
  engrave: number;
  /** 光色 [r,g,b] 0~1 */
  tint: [number, number, number];
  /** 记忆深度 0~1 —— 决定展开后字的亮度和清晰度 */
  depth: number;
}

/**
 * 我们的四类 → 星图的光色。
 *
 * 按「有多难忘」从冷到暖排：
 *   长期  冷蓝   像海底的矿石
 *   情绪  暖橙   像还热着的东西
 *   偏好  淡青   像水母
 *   短期  中性灰 快没了
 */
const TAG_TINT: Record<Memory["tag"], [number, number, number]> = {
  /* 加色叠加会把颜色推到白，所以这里的值必须**比肉眼想要的重得多**。
     实测：原来的 [0.40,0.53,0.74] 在 11000 粒子叠加后完全是白的。 */
  长期: [0.04, 0.20, 1.00],   // 深海蓝 —— 比另外三类更暗，让它压得住
  情绪: [1.00, 0.34, 0.10],   // 余烬橙 —— 还热着
  偏好: [0.05, 0.95, 0.72],   // 生物青 —— 水母
  短期: [0.42, 0.52, 0.62],   // 冷灰 —— 快没了
};

/** 取不到 tag 时的兜底（老存档可能没有） */
const FALLBACK_TINT: [number, number, number] = [0.75, 0.80, 0.85];

/* ── 确定性哈希：同一条记忆每次都在同一个位置 ── */
function hash01(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 从一句话里挑一个「核」字 —— 悬停时看到的那一个。
 *
 * 挑法：跳过标点和高频虚词，取第一个实词字。
 * 挑不出来就取第一个非标点字，再不行取问号。
 */
const STOP = new Set(
  "的了是我你他她它在有不就都和也很还要会能这那一个上下来去说想".split("")
);
const PUNCT = /[，。！？、…~～\s「」『』“”"'（）()：【】\-—]/;

function pickKernel(text: string): string {
  const chars = Array.from(text);
  for (const c of chars) {
    if (PUNCT.test(c)) continue;
    if (STOP.has(c)) continue;
    return c;
  }
  for (const c of chars) {
    if (!PUNCT.test(c)) return c;
  }
  return "记";
}

/**
 * 一条记忆该不该出现在星图上。
 *
 * 出现：没被忘、权重还够、没被压抑
 * 不出现：忘了的（浮上去破了）、压到海底的（suppressed）
 *
 * 注意：**这和「注入 prompt」的过滤条件是两套**。
 * 注入看 MEMORY_THRESHOLD，星图看的是「她还能不能想起来」。
 */
/**
 * 取星图要画的数据。
 *
 * `conv === "*"` 读全部会话。也用于「当前会话一条记忆都没有」的兜底：
 * 新用户刚打开群聊，那里是空的，但私聊里可能已经有记忆了。
 * 空着一张海图，比看到别的会话的记忆更让人困惑。
 */
export function collectForMap(conv: string): Memory[] {
  if (conv === "*") {
    try {
      const raw = localStorage.getItem("3w:memories");
      const all = raw ? (JSON.parse(raw) as Memory[]) : [];
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }
  const own = loadMemories(conv, true);
  return own.length > 0 ? own : collectForMap("*");
}

export function visibleOnMap(m: Memory, now: number): boolean {
  if (m.forgotten || m.suppressed) return false;
  /*
   * 门槛必须**接近 0**，不能用 MEMORY_THRESHOLD(0.2)。
   *
   * 0.2 以下意味着「她已经想不起来了」—— 而那正是星图最该画的东西：
   * 一道快没了的痕。用 0.02 试过，会把 0.0169 这种刚好滤掉。
   *
   * 真正消失只有两种：忘了（forgotten）、被压下去（suppressed）。
   * 权重再低也只是「很淡」，不是「不存在」。
   */
  return effectiveWeight(m, now) > 0.002;
}

/**
 * 转换。
 *
 * @param mems  某个会话的记忆（loadMemories 的结果）
 * @param now   时间基准；不传就用当前时间
 */
export function toStarDefs(mems: Memory[], now = Date.now()): StarDef[] {
  const defs: StarDef[] = [];

  for (const m of mems) {
    if (!visibleOnMap(m, now)) continue;

    const w = effectiveWeight(m, now);       // ← 唯一的真值
    const access = m.accessCount ?? 0;
    const permanent = m.reason === "milestone" || m.reason === "rename";
    const fixed = m.consolidated === true || permanent;

    /*
     * 位置：
     *   x/z 由 id 哈希决定（横向铺开）
     *   y 由权重决定 —— 越重越沉
     *
     * 范围对齐引擎的布局盒：x ±6，y ±3.2，z ±2.5
     */
    const x = (hash01(m.id, 1) - 0.5) * 11.6;
    const z = (hash01(m.id, 2) - 0.5) * 4.8;
    const y = (w - 0.5) * 6.4;

    defs.push({
      id: m.id,
      text: m.text,
      kernel: pickKernel(m.text),
      at: [x, y, z],
      /* 粒子还剩多少 —— 就是权重本身 */
      mass: w,
      /* 结合度：被想起越多越紧 */
      cohesion: Math.min(0.92, 0.42 + access * 0.055 + (fixed ? 0.18 : 0)),
      /* 刻痕：固化过、或者里程碑/改名的，那部分永不掉 */
      engrave: permanent ? 0.55 : fixed ? 0.32 : 0.08,
      tint: TAG_TINT[m.tag] ?? FALLBACK_TINT,
      /* 深度和 mass 同源 —— 引擎用它调展开后的清晰度 */
      depth: w,
    });
  }

  /* 重 → 浅 排序，让引擎的分层剔除先处理沉的那些 */
  defs.sort((a, b) => b.mass - a.mass);
  return defs;
}

/**
 * HUD 统计。
 *
 * 三档口径和引擎的分层对齐：
 *   刻于心里  engrav/固化 —— 沉在深处
 *   随风飘荡  还清醒
 *   沉入海床  快没了
 */
export function summarize(defs: StarDef[]) {
  /*
   * 三档必须**互斥**，否则「刻于心里 4 / 随风飘荡 0 / 沉入海床 1」
   * 加不出总数，看起来像 bug。
   *
   * 之前的写法有两个问题：
   *   ① 只按 engrave 分档 —— 我这边大部分记忆是 consolidated，
   *      于是四条全进「刻于心里」，剩下的一格永远是 0
   *   ② 用 total - engraved - sunken 反推中间那档，减去重叠的部分就成了负数
   *
   * 现在按「还记不记得住」分：
   *   刻于心里  engrave>0.2（固化/里程碑）**而且**现在还记得（mass>=0.3）
   *   沉入海床  mass < 0.2 —— 快没了
   *   随风飘荡  其余 —— 还在，但会掉
   *
   * 判据顺序很重要：沉底优先于刻痕判断 ——
   * 一条固化过的记忆也可能已经淡到 0.1，那时它该算「快没了」而不是「刻于心里」。
   */
  let engraved = 0, drifting = 0, sunken = 0;
  for (const d of defs) {
    if (d.mass < 0.2) sunken++;
    else if (d.engrave > 0.2 && d.mass >= 0.3) engraved++;
    else drifting++;
  }
  return { total: defs.length, engraved, drifting, sunken };
}
