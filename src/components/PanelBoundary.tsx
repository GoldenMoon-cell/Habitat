import { Component, type ErrorInfo, type ReactNode } from "react";
import { DeadPanelA } from "./FaultDemo";

/**
 * 单栏错误隔离。
 *
 * 之前整个应用只有一个顶层 ErrorBoundary —— 任何一栏崩了都会把四栏一起带走，
 * 用户只能刷新。加上这个之后，异常被限制在最近的边界内：
 * 崩掉的那一栏变成占位卡，其余三栏的 state 和渲染完全不受影响。
 *
 * 重试用「重置 error state」而不是「刷新页面」—— 保住其他栏的状态。
 */

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** 每次重试 +1，用作 children 的 key，强制重新挂载子树 */
  attempt: number;
}

export default class PanelBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* 控制台留全量，方便定位。UI 上只显示第一行。 */
    console.error(`[3W] 「${this.props.name}」渲染崩溃:`, error, info.componentStack);
  }

  retry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    const { error, attempt } = this.state;

    if (error) {
      return (
        <DeadPanelA
          name={this.props.name}
          error={`${error.name}: ${error.message}`}
          onRetry={this.retry}
        />
      );
    }

    /* key 变化会让子树彻底重新挂载，相当于把这一栏重启一次 */
    return <div key={attempt} className="contents">{this.props.children}</div>;
  }
}
