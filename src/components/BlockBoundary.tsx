import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import CrashBlock, { type CrashData, type CrashKind } from "./CrashBlock";
import { getGlitch, subscribeGlitch } from "../lib/glitch";

/**
 * 区块级错误隔离。
 *
 * 层级：
 *   顶层 ErrorBoundary   整棵树炸了才用（几乎不该触发）
 *     └ PanelBoundary    四栏之一崩了 → 整栏占位卡
 *         └ BlockBoundary  栏内某个功能区崩了 → 只有那一小块变成特定的坏法
 *
 * 「kind」决定崩溃形态：雷达塌成一条线、心电图变平直、
 * 角色名被腐蚀、命令被划掉……每种都说出「这块是怎么坏的」。
 *
 * data 传真实用户内容 —— 崩的必须是「他的」数据，不是占位符。
 */

/** 演示用：?crash=<kind> 让对应区块直接进入崩溃态。
    生产环境这个参数不存在，等于零开销。 */
const CRASH_PARAM =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("crash") ?? ""
    : "";

interface Props {
  kind: CrashKind;
  name: string;
  /** 真实数据，用于崩溃态里的内容展示 */
  data?: CrashData;

  children: ReactNode;
}

interface State {
  error: Error | null;
  attempt: number;
}

export default class BlockBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[3W] 「${this.props.name}」区块崩溃:`, error, info.componentStack);
  }

  /* 订阅控制台的 sys glitch / sys restore */
  private unsub?: () => void;

  componentDidMount() {
    this.unsub = subscribeGlitch(() => this.forceUpdate());
  }

  componentWillUnmount() {
    this.unsub?.();
  }

  retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  render() {
    const { error, attempt } = this.state;
    const { kind, name, data, children } = this.props;

    if (!error) {
      /* 三种触发源，渲染的是同一套 CrashBlock：
         1. 真实渲染异常（error state）
         2. 控制台 sys glitch <kind>
         3. 调试参数 ?crash=<kind> */
      if (getGlitch() === kind || (CRASH_PARAM && CRASH_PARAM === kind)) {
        return <CrashBlock kind={kind} name={name} data={data} onRetry={this.retry} />;
      }
      /* 正常时用 Fragment，不产生多余 DOM —— 包裹不能改变原布局 */
      return <Fragment key={attempt}>{children}</Fragment>;
    }

    return (
      <CrashBlock
        kind={kind}
        name={name}
        data={data}
        onRetry={this.retry}
      />
    );
  }
}
