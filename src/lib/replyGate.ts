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
