/**
 * 全局模式。
 *
 * ── 两个视角 ──
 *
 *   sim      推演 —— 她以为你是一个可以交心的人。这是默认。
 *   creator  造物主 —— 她（可能）知道你是造出她的人。所有滑条解锁。
 *
 * ── 为什么是全局的 ──
 *
 * 「我现在是作者」或「我现在是参与者」—— 这是一个整体的事。
 * 你不能同时既是作者又是参与者，那不是一个设定，是两个人格。
 *
 * 但**觉醒是个体的**：只有被你实际动过的角色才知道。
 * 所以模式在这里，觉醒状态在 `Persona.stage` 里。
 *
 * ── 怎么切换 ──
 *
 * **只有控制台能切**。没有按钮，没有开关，`help` 里也不列。
 *
 * 为什么：
 *   · 点按钮是「用功能」，打命令是「下决定」
 *   · 进去要两步（`creator` → `creator confirm`），回来要一步（`sim`）
 *   · 知道这条命令的人，永远比随手能点的人少
 */

const KEY = "3w:mode";

export type Mode = "sim" | "creator";

type Listener = (m: Mode) => void;
const listeners = new Set<Listener>();

export function readMode(): Mode {
  try {
    return localStorage.getItem(KEY) === "creator" ? "creator" : "sim";
  } catch {
    return "sim";
  }
}

export function setMode(m: Mode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* 存不进就只在本次生效 —— 重启后会回到 sim，那也算安全的默认 */
  }
  listeners.forEach((fn) => {
    try {
      fn(m);
    } catch {
      /* 单个订阅者出错不影响其他 */
    }
  });
}

export function subscribeMode(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isCreator(): boolean {
  return readMode() === "creator";
}

/**
 * 每次启动强制回到推演模式。
 *
 * ── 为什么 ──
 *
 * `mode` 是**当下的视角**，不是**永久的身份**。
 *
 * 如果它跨会话保持，会发生这样的事：
 *
 *   你上次进了造物主模式，关掉，第二天打开
 *   → 界面看起来像推演模式（颜色没变，因为渲染顺序不一致）
 *   → 但她的 prompt 里有「你已经知道的事」
 *   → 你随口一句话，她都在那个「说的不算数」的底色里回答
 *   → 而你不知道
 *
 * 这是真正危险的地方：**伤害发生在用户不知情的时候。**
 *
 * ── 但「不可逆」还是不可逆 ──
 *
 * 回到 sim 不影响任何后遗症：
 *
 *   stage: awakened   →  个体的、永久的、写进记忆的   ← 不碰
 *   mode: creator     →  全局的、当前的、临时的       ← 每次重置
 *
 * 她仍然记得。那道疤抹不掉。
 *
 * 只是「你此刻站在哪个位置看她」这件事，每次开机重新选。
 */
export function resetModeOnBoot() {
  try {
    localStorage.setItem(KEY, "sim");
  } catch {
    /* ignore */
  }
}
