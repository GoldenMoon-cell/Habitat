/**
 * 三鲸空间 · 会话与消息数据
 *
 * 角色档案（人设、六维、关系网）在 `personas.ts` —— 那里是单一来源。
 * 这个文件只管"会话里发生了什么"。
 */

import { ownerName } from "../lib/profile";
import {
  PERSONAS,
  PERSONA_MAP,
  AXIS_ORDER,
  deriveGroupAxes,
  type StaticAxes,
  type Persona,
  type PersonaId,
} from "./personas";

export type { Persona, PersonaId, StaticAxes };

export type AgentId = PersonaId;
export type AuthorId = "me" | AgentId;
/**
 * 会话 id。
 *
 * `"group"` 是默认群（保留下来兼容旧数据），自建的群用 `grp-2`、`grp-3`……
 * 其余都是单聊，id 等于角色 id。
 */
export type ConvId = "group" | `grp-${string}` | AgentId;

/** 这个会话 id 是不是群聊 */
export const isGroupId = (id: string): boolean =>
  id === "group" || id.startsWith("grp-");

export type Presence = Persona["presence"];

/** 角色即档案，避免两处维护同一份字段 */
export type Agent = Persona;

export const AGENTS: Agent[] = PERSONAS;
export const AGENT_MAP: Record<AgentId, Agent> = PERSONA_MAP as Record<AgentId, Agent>;

export interface VoiceClip {
  seconds: number;
  /** 0..1 的振幅数组，用于绘制声波 */
  peaks: number[];
  transcript: string;
}

export interface Attachment {
  name: string;
  meta: string;
  kind: "file" | "image";
}

export interface Reaction {
  emoji: string;
  count: number;
}

export interface Message {
  id: string;
  conv: ConvId;
  author: AuthorId;
  time: string;
  text?: string;
  voice?: VoiceClip;
  attach?: Attachment;
  reactions?: Reaction[];
  replyTo?: string;
  /** 已撤回：内容不再渲染，只留一行占位 */
  recalled?: boolean;
  /** 编辑过的消息，时间后面会标「已编辑」 */
  edited?: boolean;
  /** 正在流式输出（只做视觉，不接后端） */
  streaming?: boolean;
  /** 系统事件条（居中细线），用于快捷命令的可见反馈 */
  system?: {
    label: string;
    detail?: string;
    accent?: string;
  };
}

/* ── 角色：由 personas.ts 提供（单一来源） ──────────────────── */

/**
 * 你自己。
 *
 * name 从 `3w:profile` 读 —— 定过名就是你定的那个，
 * 没定过（老用户 / 迁移期）兜底「主人」。
 *
 * **为什么用 getter 而不是常量**：
 * 定名发生在运行时（新手引导第二步），常量读的时候已经固定了。
 *
 * 兜底「主人」不是因为它是默认值 —— 是因为**老用户的记忆里全是这个词**，
 * 突然断掉会让「主人今天吃了泡面」这条记忆指代不清。
 */
export const OWNER = {
  get name() {
    return ownerName();
  },
  /*
   * 不是 "@creator"。
   *
   * 原来叫 "@creator" —— 但它和隐藏命令 `creator` 撞名了。
   *
   * 于是：用户在推演模式下看到左下角写着 @creator，
   * 会以为自己进了造物主模式。
   *
   * 一个纯装饰性的 handle 制造了一个真实的误判 —— 不值得。
   */
  handle: "@owner",
  companion: "三只鲸鱼",
  /*
   * ── 这里原来有三样东西，都删了 ──
   *
   *   plan: "LOCAL PRO"        没有任何东西叫这个名字
   *   credit: 42.6 / 120       从没被更新过的假余额
   *   context: 158.3 / 512k    同上
   *
   * 左栏那两块表现在显示**今日真实用量**（`lib/usage.ts`）。
   *
   * 余额确实拿不到（各家接口不同，OpenAI 官方的 billing 接口对 API Key 已关），
   * 但那不是留一个假数字的理由 —— **拿不到就不显示**。
   */
};

/* ── 声波（固定数组，避免每次渲染抖动） ───────────────────────── */

const P1 = [0.2, 0.45, 0.8, 0.55, 0.32, 0.7, 0.95, 0.6, 0.38, 0.52, 0.78, 0.44, 0.25, 0.6, 0.85, 0.5, 0.35, 0.68, 0.42, 0.3, 0.55, 0.8, 0.5, 0.34];
const P2 = [0.35, 0.62, 0.4, 0.88, 0.7, 0.45, 0.28, 0.55, 0.9, 0.66, 0.4, 0.72, 0.5, 0.3, 0.62, 0.85, 0.48, 0.35, 0.6, 0.42];
const P3 = [0.3, 0.5, 0.75, 0.42, 0.6, 0.9, 0.55, 0.32, 0.48, 0.8, 0.62, 0.38, 0.7, 0.52, 0.28, 0.65, 0.85, 0.45, 0.3, 0.58];

/* ── 群聊：三鲸之家 ─────────────────────────────────────────── */

export const GROUP_MESSAGES: Message[] = [
  /*
   * 出厂无预置群聊记录。
   *
   * 原来这里是一整段「狼人杀」对话 —— 那是给预置角色准备的开场白。
   * 既然出厂不再有角色，这段对话也就没有参与者了。
   */
];

/* ── 私聊 ──────────────────────────────────────────────────── */

export const PRIVATE_MESSAGES: Partial<Record<AgentId, Message[]>> = {
  /* 出厂无预置私聊记录 —— 同上 */
};

/* ── 第四栏：记忆 / 情绪 / 快捷动作 ──────────────────────────── */

export interface MemoryEntry {
  time: string;
  text: string;
  source: string;
  confidence: number;
  tag: "长期" | "短期" | "情绪" | "偏好";
}

export const MEMORY: Partial<Record<ConvId, MemoryEntry[]>> = {
  /*
   * 出厂无预置记忆。
   *
   * 原来这里写着几十条「鲸鲸对『被清空』有强烈的失去焦虑」之类 ——
   * 那些不是示例数据，是**预置角色的设定**。既然出厂不再有预置角色，
   * 这些条目也就没有了主人。
   *
   * 真实的记忆有两个来源：
   *   ① 用户和她聊出来的（还没实现，需要从对话提炼）
   *   ② 真实事件留下的痕迹（3w:memory-injected，已实现）
   */
};

export interface EmotionAxis {
  label: string;
  value: number;
}

/**
 * 六维：不再手写。
 * 单人 → 读 personas.ts 的 axes；
 * 群聊 → 核心成员平均 + 同场摩擦/起哄加成（deriveGroupAxes）。
 */
const toAxes = (a: StaticAxes): EmotionAxis[] =>
  AXIS_ORDER.map((k) => ({ label: k, value: a[k] }));

export const EMOTION: Partial<Record<ConvId, EmotionAxis[]>> = {
  /* 出厂无预置雷达数据 —— 和 MEMORY 同理，那是预置角色的伴生物 */
};

export const QUICK_ACTIONS: Partial<
  Record<ConvId, { label: string; hint: string; icon: string; accent?: string }[]>
> = {
  /*
   * 出厂无预置快捷指令。
   *
   * 原来那三条（发牌开局 / 投喂一轮 / 朗读最近三条）是绑在「狼人杀」
   * 那个场景上的 —— 场景没了，指令也没有意义。
   *
   * 以后可以做成：用户自己定义每个角色的常用指令。
   */
};

/* ── 第一栏：系统监控与日志 ──────────────────────────────────── */

/*
 * ── 这里原来有一整套假日志 ──
 *
 * `LogLine` / `SEED_LOGS` / `LOG_POOL`：
 *
 *   `router›deliver ok · 4/4 ack`
 *   `tts›synth synth chunk → 320ms · voice=jingjing`
 *   `stt›partial decode 0.42s · confidence 0.94`
 *   `memory›conflict merge on {fish.db, clean}`
 *
 * 每 3.2 秒从池子里随机抽一条播出去，让左栏"看起来在运转"。
 *
 * ── 为什么全删了 ──
 *
 * **它编造了一个不存在的系统。**
 *
 * 用户看到 `tts›synth chunk` 会以为这个软件有语音合成，
 * 然后去界面上找 —— 找不到。
 * 看到 `router›isolation guard` 会以为有一个消息路由层 —— 也没有。
 *
 * **假 CPU 只是数字假。假日志是「虚构了一个不存在的子系统」。**
 *
 * ── 现在这条流是什么 ──
 *
 * `src/lib/eventLog.ts` —— 每一条都对得上软件里真的发生过的事。
 * 说一句话、改一次名、拨一下时间，痕迹就出现在那里。
 *
 * 空的时候就是空的：因为确实什么都没发生过。
 */

