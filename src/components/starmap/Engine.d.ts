/**
 * Engine.js 的类型声明。
 *
 * Engine 是从沙盒（D:\Habitat_Visual_Sandbox）原样搬过来的 JS，
 * 不改它的实现，只在这里补接口 —— 改实现会让以后同步上游变难。
 */

import type { StarDef } from "../../lib/starMapData";

export interface SeaStats {
  phase: "outside" | "entering" | "inside" | "leaving";
  transit: number;
  mode: string;
  clarity: number;
  count: number;
  engraved: number;
  awake: number;
  fading: number;
  sunken: number;
  lastTouched: { text: string; ago: number } | null;
  scrollY: number;
}

export interface EngineOptions {
  /**
   * 直接进场景，跳过「进入」闸门和隧道动画。
   * 作为 app 里的面板打开时用 'inside'；独立页面用默认的 'outside'。
   */
  phase?: "outside" | "inside";
  /** 每帧回调：被悬停的星在屏幕上的位置（给浮动标签用） */
  onFrame?: (
    f: { x: number; y: number; alpha: number; i: number; mass: number; cohesion: number; engrave: number } | null
  ) => void;
}

/** 引擎内部的星对象（只暴露外部真会碰的部分） */
export interface EngineStar {
  i: number;
  def: StarDef;
  mass: number;
  depth: number;
  forgetting: boolean;
  rescuable: boolean;
  forgettingT: number;
  /**
   * 星的速度。shader 拿它拖彗尾：
   *   home -= uVel * (0.04 + aRand.y * 0.26)
   *
   * 平时是 0（home 每帧直接 copy，没有速度）。
   * 迁移时把每帧位移写进来，尾迹就出来了。
   */
  vel: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
  /**
   * 时间轴回溯时由外部接管深度（第 4 期）。
   * null = 正常模式，引擎自己按 decayRate 衰减。
   * 设成数字 = 钉在那一刻的 effectiveWeight。
   */
  timelineDepth: number | null;
}

export class Engine {
  constructor(
    container: HTMLElement,
    onStats: (s: SeaStats) => void,
    opts?: EngineOptions
  );

  phase: "outside" | "entering" | "inside" | "leaving";
  mode: string;
  stars: EngineStar[];
  /**
   * 当前被点开的那颗星（idle 时为 null）。
   * 详情面板靠它找到「打开的是哪一条记忆」。
   */
  active: EngineStar | null;
  /** 布局缩放。at[1] 是布局单位，世界坐标要乘它。 */
  sy: number;

  /** 塞数据。会清掉旧的星重建。 */
  loadMemories(defs: StarDef[]): void;

  enter(): void;
  back(): void;
  press(x?: number, y?: number): void;
  release(): void;
  /** 让一条记忆开始散开（5 秒内可救，之后不可挽回） */
  startForgetting(idx: number): void;
  rescueStar(idx: number): boolean;
  setMuted(m: boolean): void;

  /** 画质档位：'high' | 'mid' | 'low'。低档关 bloom、降 pixelRatio。 */
  setQuality?(q: "high" | "mid" | "low"): void;
  /** 暂停/恢复渲染循环（窗口失焦时用，省电） */
  setPaused?(p: boolean): void;

  dispose(): void;
}
