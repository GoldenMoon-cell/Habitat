/**
 * 回复代次闸门。
 *
 * ── 它解决什么 ──
 *
 * 一个会话里排着的回复，在用户切走之后不该再冒出来。
 *
 * 清定时器只能拦住「还没开始的」；
 * **已经在路上的（await 模型那几十秒）拦不住** ——
 * 模型回来之后代码照旧往原来的会话里写。
 * 用户会觉得「它在背后自己说话了」。
 *
 * ── 怎么用 ──
 *
 *   const gate = makeEpochGate();
 *
 *   // 每次换会话
 *   gate.bump();
 *
 *   // 一个回复任务开工时
 *   const ticket = gate.ticket();
 *
 *   // 每一个「准备写回会话」的地方
 *   if (gate.stale(ticket)) return;
 *
 * ── 为什么单独拿出来 ──
 *
 * 这条规则原本是 App.tsx 里的一行 `convEpoch.current !== epoch`。
 * 一行代码写在那儿看不出是规则，改的人容易顺手删掉；
 * 而且它埋在 React 组件里，自动测试够不到 ——
 * 「切走后不该再回话」这件事一条断言都没有。
 *
 * 抽出来之后它是纯函数，可以单独测。
 */
export interface EpochGate {
  /** 开一张票 —— 开工时记下 */
  ticket(): number;
  /** 这张票还算不算数 */
  stale(ticket: number): boolean;
  /** 换代 —— 换会话时调 */
  bump(): void;
  /** 当前代号（调试用） */
  current(): number;
}

export function makeEpochGate(): EpochGate {
  let epoch = 0;
  return {
    ticket: () => epoch,
    stale: (t) => epoch !== t,
    bump: () => { epoch += 1; },
    current: () => epoch,
  };
}

/**
 * 「正在想」这个状态，只在**属于自己**时才清。
 *
 * ── 它解决什么 ──
 *
 * 一个请求过期返回时，原来无条件 `setTyping(null)`。
 * 但如果用户已经切走、新会话正在回话 ——
 * 这一句会把**新会话的「正在想」掐掉**。
 *
 * 而队列出口是个 `[typing]` 依赖的 effect：
 * typing 一变 null，新会话排着队的回复就被提前放出去了。
 * 一个过期的请求，搅乱了另一个会话的节奏。
 *
 * ── 为什么还要带 ticket ──
 *
 * 只比对会话 id 是不够的。这个序列会出错：
 *
 *   A 的旧请求在等
 *   切到 B
 *   切回 A，A 发起新回复      → typing 标成 A
 *   A 的**旧**请求返回        → 看到的 typing 也是 A
 *                             → 误以为是自己的，清掉
 *                             → A 的队列提前放出
 *
 * **id 又对上了，但那是另一代。**
 * 所以 typing 里除了 conv 还要记 ticket，两个都对上才算自己的。
 *
 * ── 用法 ──
 *
 *   setTyping((cur) => clearTypingIf(cur, { conv: target, ticket }));
 */
export interface TypingMark<T> {
  conv: T;
  ticket: number;
  requestId: number;
}

/** Keep the lane busy until every request from the same conversation epoch ends. */
export function releaseTyping<T>(
  current: TypingMark<T> | null,
  finished: TypingMark<T>,
  active: Iterable<TypingMark<T>>,
): TypingMark<T> | null {
  if (!current) return null;
  if (
    current.conv !== finished.conv ||
    current.ticket !== finished.ticket ||
    current.requestId !== finished.requestId
  ) return current;

  for (const mark of active) {
    if (mark.conv === finished.conv && mark.ticket === finished.ticket) return mark;
  }
  return null;
}
