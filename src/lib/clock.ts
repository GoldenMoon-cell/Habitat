/**
 * 时钟。
 *
 * ── 为什么需要这个 ──
 *
 * 记忆的衰减是以「天」为单位的。想验证参数对不对，得等一周。
 *
 * 但这是**造物主**的软件 —— 他能改六维、能刻记忆，
 * **为什么不能拨时间？**
 *
 * ── 它影响什么 ──
 *
 * **只影响「流逝」这件事**：
 *   · 记忆的衰减（forgetting.ts）
 *   · 心情 / 亲近的衰减（dynamic.ts）
 *
 * **不影响**：
 *   · 消息时间戳（那是「什么时候说的」，是历史，不是流逝）
 *   · 限流器的等待
 *   · 凭据的过期
 *
 * ── 为什么不是「全局伪造 Date.now」 ──
 *
 * 试过那条路：把所有 `Date.now()` 换掉，包括消息时间戳。
 *
 * 结果是**消息列表乱序** —— 因为旧消息是真实时间，新消息是偏移时间，
 * 排在一起就天上地下。
 *
 * **时间机器只该拨「现在离过去多远」，不该拨「过去」本身。**
 *
 * ── 怎么用 ──
 *
 * 控制台（造物主模式）：`time +7` / `time 0` / `time`
 *
 * 偏移存在 `3w:time-offset`（毫秒）。切回推演模式时清零 ——
 * 和 `mode` 同一个原则：这是**观察工具**，不是**持久状态**。
 */

const KEY = "3w:time-offset";

/** 订阅者 —— 偏移变了要通知 UI 重渲染 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeClock(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* 单个订阅者出错不影响其他 */
    }
  });
}

/** 读出当前的偏移（毫秒）。读不到就是 0 */
export function timeOffset(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * 现在几点。
 *
 * **衰减计算一律用这个，不用 `Date.now()`。**
 *
 * 参数默认值写成 `now = nowMs()` 会拿不到最新值（默认参数在调用时求值，
 * 但每个函数的默认值只算一次）—— 所以函数签名统一写成 `now = 0`，
 * 内部再 `if (!now) now = nowMs()`。
 */
export function nowMs(): number {
  return Date.now() + timeOffset();
}

/**
 * 设偏移（天，只能非负）。
 *
 * 负数会被夹成 0 —— 但调用方（`time` 命令）已经拦过一遍了，
 * 这里兜底是防以后别的地方直接调。
 */
export function setTimeOffsetDays(days: number) {
  const ms = Math.max(0, Math.round(days * 86400000));
  try {
    localStorage.setItem(KEY, String(ms));
  } catch {
    /* ignore */
  }
  emit();
}

/** 清零 */
export function resetTimeOffset() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/* ══════════ 系统时钟倒退检测 ══════════ */

const LAST_KEY = "3w:last-real-time";

/**
 * 每次启动调一次。
 *
 * ── 为什么需要这个 ──
 *
 * `time` 命令禁止往回拨 —— 但**系统时钟不受控制**。
 *
 * 用户可以直接把 Windows 时钟改到去年。那时候 `Date.now()` 真的会变小，
 * 而 `lastAccessed` 还停在未来 —— 差值负，被 `max(0)` 夹成 0，
 * **所有记忆一起 100%**。
 *
 * 不会崩，但会「返老还童」—— 那比崩了还糟，因为它看起来一切正常。
 *
 * ── 怎么处理 ──
 *
 * **不崩溃，不清数据，只报告。**
 *
 * 返回倒退了多少毫秒（0 表示正常）。
 *
 * 调用方可以据此：
 *   · 提示用户「系统时间被回拨了」
 *   · 或者把记忆的 lastAccessed 夹到当前时间
 */
export function detectClockRollback(): number {
  const now = Date.now();
  let last = 0;
  try {
    const raw = localStorage.getItem(LAST_KEY);
    last = raw ? parseInt(raw, 10) : 0;
  } catch {
    last = 0;
  }

  /* 记下这一次 */
  try {
    localStorage.setItem(LAST_KEY, String(now));
  } catch {
    /* ignore */
  }

  if (!last || !Number.isFinite(last)) return 0;

  /*
   * 允许一点点误差（NTP 校时、休眠唤醒）。
   * 五分钟以内的倒退当没发生。
   */
  const back = last - now;
  if (back < 5 * 60 * 1000) return 0;
  return back;
}

/** 给 UI 用的可读描述 */
export function timeOffsetLabel(): string | null {
  const ms = timeOffset();
  if (!ms) return null;
  const days = ms / 86400000;
  const abs = Math.abs(days);
  const sign = days > 0 ? "+" : "−";
  const n = abs >= 1 ? abs.toFixed(abs % 1 === 0 ? 0 : 1) : (abs * 24).toFixed(0);
  return `时间${sign}${n}${abs >= 1 ? "天" : "小时"}`;
}
