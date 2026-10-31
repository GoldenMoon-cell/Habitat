/**
 * 遥测数据桥（模块级）。
 *
 * 为什么不用 Context：
 *   数据源在 ConsoleRail 内部，消费者 ConsoleDrawer 在 App 里并列渲染。
 *   Context 只能自上下传，两者同级拿不到。用模块级 store 最省事。
 *
 * ConsoleRail 常驻挂载，启动后就开始上报。
 */

export interface Telemetry {
  cpuNow: number;
  memNow: number;
  logCount: number;
  logPaused: boolean;
  /** 由 ConsoleRail 注册，供控制台调用 */
  setLogPaused: (paused: boolean) => void;
  clearLogs: () => void;
}

const state: Telemetry = {
  cpuNow: 0,
  memNow: 0,
  logCount: 0,
  logPaused: false,
  setLogPaused: () => {},
  clearLogs: () => {},
};

/** ConsoleRail 用来上报只读数据 */
export function reportTelemetry(patch: Partial<Omit<Telemetry, "setLogPaused" | "clearLogs">>) {
  Object.assign(state, patch);
}

/** ConsoleRail 用来注册可调用的动作 */
export function registerTelemetryActions(
  actions: Pick<Telemetry, "setLogPaused" | "clearLogs">
) {
  Object.assign(state, actions);
}

/** 控制台读取当前快照 */
export function readTelemetry(): Telemetry {
  return state;
}
