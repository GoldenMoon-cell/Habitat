/**
 * 动态三轴的实时计算。
 *
 * 三个轴：
 *   心情      —— 被夸会涨，被怼会掉，放着不管也会慢慢落
 *   亲近      —— 聊得多会涨，冷落会掉（掉得比心情快）
 *   记忆活性  —— 每次回复检索了多少历史，亮一下然后回落
 *
 * 为什么用规则不用 LLM：
 *   每次对话后再调一次模型算情绪，成本翻倍、延迟翻倍，
 *   而且用户根本感知不到「这次心情是模型算的还是规则算的」。
 *   规则够用，而且即时、免费、可解释。
 *
 * 关键设计：**所有衰减都在读取时补算**。
 *   不是「定时器每 10 分钟跑一次」（关掉页面就停），
 *   而是「打开时按上次互动时间戳算差值」。这样关一个月再打开，她也记得你走了。
 */

export const DYNAMIC_KEY = "3w:dynamic-v1";

import { nowMs } from "./clock";

export interface DynamicState {
  心情: number;
  亲近: number;
  记忆活性: number;
  /** 上次回复检索了多少条历史 —— 界面上直接显示这个数字，比「活性 33」实在 */
  lastHits?: number;
  /** 上次互动时间戳（ms） */
  lastAt: number;
}

/** 冷落多少小时之后开始掉 */
const GRACE_HOURS = 6;
/** 每小时亲近掉多少 */
const DECAY_CLOSE = 1.2;
/** 每小时心情掉多少 */
const DECAY_MOOD = 0.6;
/** 衰减的地板 —— 不会掉到 0，那太惨了 */
const FLOOR = 18;

export const NEUTRAL: DynamicState = {
  心情: 62,
  亲近: 55,
  记忆活性: 50,
  lastAt: Date.now(),
};

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

/* ───────────────── 持久化 ───────────────── */

type Store = Record<string, DynamicState>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(DYNAMIC_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(s: Store) {
  try {
    localStorage.setItem(DYNAMIC_KEY, JSON.stringify(s));
  } catch {
    /* 配额满就只在内存里生效 */
  }
}

/**
 * 读某个角色此刻的状态 —— **顺手把冷落衰减补上**。
 *
 * 这一步是「关掉页面一个月再打开，她还在生气」的实现。
 */
export function readDynamic(id: string): DynamicState {
  const saved = readStore()[id];
  if (!saved) return { ...NEUTRAL, lastAt: Date.now() };
  return decay(saved);
}

/** 按 lastAt 到现在的小时数补算衰减 */
function decay(s: DynamicState, now = 0): DynamicState {
  if (!now) now = nowMs();
  const hours = Math.max(0, (now - s.lastAt) / 3.6e6);
  const cold = Math.max(0, hours - GRACE_HOURS);
  if (cold <= 0) return s;

  return {
    ...s,
    亲近: clamp(s.亲近 - cold * DECAY_CLOSE, FLOOR),
    心情: clamp(s.心情 - cold * DECAY_MOOD, FLOOR),
    /* 记忆活性是「这次检索亮多少」，闲着就是常温 */
    记忆活性: clamp(s.记忆活性 * 0.5 + 50 * 0.5),
    lastAt: s.lastAt,
  };
}

/* ───────────────── 事件 ───────────────── */

export type DynamicEvent =
  | { kind: "user"; text: string }
  | { kind: "agent"; memoryHits: number; totalMsg: number }
  | { kind: "inject"; mood: string };

/** 情绪词表 —— 简单但够用，比调模型快三个数量级 */
const WARM = /谢谢|喜欢|想你|辛苦|好棒|厉害|爱|开心|哈哈|太好了|不错/;
const COLD = /烦|累|滚|闭嘴|别烦|讨厌|垃圾|废物|无聊|算了/;
const DEEP = /为什么|怎么想|你觉得|我们|以前|还记得|那时候/;

/**
 * 跑一次状态更新。
 *
 * 返回新状态，调用方负责落到 store（这样能批量做，不用每条消息写一次 localStorage）。
 */
export function tick(prev: DynamicState, ev: DynamicEvent, now = 0): DynamicState {
  if (!now) now = nowMs();
  const base = decay(prev, now);

  if (ev.kind === "user") {
    const text = ev.text ?? "";
    const len = text.replace(/@\S+/g, "").trim().length;

    /* 投入度：长消息 = 认真在聊 */
    const effort = Math.min(4, len / 40);
    /* 情绪 */
    const up = WARM.test(text) ? 5 : 0;
    const down = COLD.test(text) ? 8 : 0;
    /* 深聊：问「为什么」「你觉得」这类，会让她更投入 */
    const deep = DEEP.test(text) ? 2 : 0;

    return {
      心情: clamp(base.心情 + up - down),
      亲近: clamp(base.亲近 + effort + deep),
      记忆活性: clamp(Math.max(base.记忆活性, 35)), // 有新输入就至少亮到 35
      lastAt: now,
    };
  }

  if (ev.kind === "agent") {
    /* 记忆活性 = 这次回复检索了多少历史。用了 20 条以上算「全开」 */
    const hits = Math.max(0, ev.memoryHits);
    const activity = Math.min(100, 30 + hits * 3.5 + ev.totalMsg * 0.4);

    return {
      ...base,
      记忆活性: clamp(activity),
      lastHits: hits,
      lastAt: now,
    };
  }

  /* inject：控制台强行注入情绪，只改心情 */
  if (ev.kind === "inject") {
    const map: Record<string, number> = {
      雀跃: 88,
      开心: 80,
      平静: 60,
      无聊: 40,
      低落: 28,
      委屈: 22,
      生气: 18,
    };
    const v = map[ev.mood];
    return v === undefined ? base : { ...base, 心情: clamp(v), lastAt: now };
  }

  return base;
}

/* ───────────────── 批量落盘 ───────────────── */

/** 写一个角色的状态（内部用，App 层用 commitDynamic） */
export function commitDynamic(id: string, state: DynamicState) {
  const store = readStore();
  store[id] = state;
  writeStore(store);
}

/** 一次写多个（群聊里所有人都要更新） */
export function commitMany(entries: [string, DynamicState][]) {
  const store = readStore();
  for (const [id, s] of entries) store[id] = s;
  writeStore(store);
}

/** 清掉某个角色的动态（重置用） */
export function resetDynamic(id?: string) {
  if (id) {
    const store = readStore();
    delete store[id];
    writeStore(store);
  } else {
    try {
      localStorage.removeItem(DYNAMIC_KEY);
    } catch {
      /* ignore */
    }
  }
}
