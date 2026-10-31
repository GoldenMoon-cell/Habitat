import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 捕获渲染期异常，把错误显示出来而不是留一片黑屏。
 *
 * 开发阶段这比什么都重要 —— 黑屏只能猜，错误信息能直接指到文件行号。
 * 生产环境保留它也无害：至少用户能截图给你。
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; info: ErrorInfo | null }
> {
  state: { error: Error | null; info: ErrorInfo | null } = {
    error: null,
    info: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    /* 控制台也留一份，方便复制 */
    console.error("[3W] 渲染崩溃:", error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const stack = (error.stack ?? "").split("\n").slice(0, 8).join("\n");
    const componentStack = (info?.componentStack ?? "").split("\n").slice(0, 10).join("\n");

    return (
      <div className="flex h-full w-full items-start justify-center overflow-auto bg-abyss p-8">
        <div className="w-[760px] max-w-full">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-coral" />
            <span className="text-[13px] text-coral">渲染崩溃了</span>
          </div>

          <pre className="thin-scroll mb-3 overflow-auto rounded-[8px] border border-coral/25 bg-black/40 p-3 text-[11px] leading-[1.7] text-coral/90">
            {error.name}: {error.message}
          </pre>

          {stack && (
            <pre className="thin-scroll mb-3 max-h-[220px] overflow-auto rounded-[8px] border border-white/[0.07] bg-black/30 p-3 font-mono text-[10px] leading-[1.6] text-mist/55">
              {stack}
            </pre>
          )}

          {componentStack && (
            <details className="mb-3">
              <summary className="cursor-pointer text-[10.5px] text-mist/45">
                组件栈
              </summary>
              <pre className="thin-scroll mt-1.5 max-h-[200px] overflow-auto rounded-[8px] border border-white/[0.07] bg-black/30 p-3 font-mono text-[10px] leading-[1.6] text-mist/58">
                {componentStack}
              </pre>
            </details>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => location.reload()}
              className="rounded-[7px] bg-biolum/15 px-3 py-[5px] text-[11px] text-biolum"
            >
              刷新
            </button>
            <button
              onClick={() => {
                localStorage.removeItem("3w:personas");
                localStorage.removeItem("3w:groups");
                localStorage.removeItem("3w:onboarded");
                location.reload();
              }}
              className="rounded-[7px] bg-white/[0.06] px-3 py-[5px] text-[11px] text-mist/60"
            >
              清空本地数据并刷新
            </button>
          </div>

          <p className="mt-3 text-[10px] leading-[1.7] text-mist/50">
            如果「清空本地数据」之后恢复正常，说明是 localStorage 里的旧数据结构和新版本对不上。
          </p>
        </div>
      </div>
    );
  }
}
