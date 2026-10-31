import { useCallback, useEffect, useState } from "react";

/**
 * 快捷剧本。
 *
 * ── 这是什么 ──
 *
 * **预写的一段话**，点一下就发到群聊 —— 所有成员都会收到。
 *
 * 用途：写剧本 / 出新玩法时，不用每次手打一遍设定。
 *
 * ── 为什么存在本地 ──
 *
 * 出厂给三条，用户可以改。它和「角色的性格」无关，
 * 所以不该进 prompt —— 它是**一条消息**，不是一条规则。
 *
 * ── 为什么只在群聊里有意义 ──
 *
 * 个体对话里也能用，但那只是「省打字」。
 *
 * **群聊里才是「同一个问题扔给所有人」** —— 那是多智能体才有的玩法。
 */

const KEY = "3w:quick-scripts";

export interface Script {
  id: string;
  /** 按钮上的字，2-6 个字 */
  label: string;
  /** 实际发出去的内容 */
  text: string;
  /**
   * 要不要先弹输入框。
   *
   * 「问所有人」这种需要一个变量 —— 弹一次让他填。
   */
  prompt?: string;
}

const BUILTIN: Script[] = [
  {
    id: "ask-all",
    label: "问所有人",
    text: "",
    prompt: "要问她们什么？",
  },
  {
    id: "judge-each",
    label: "互相评价",
    text: "你们几个互相说说 —— 你觉得其他人是什么样的人？说具体的，别客气。",
  },
  {
    id: "rain",
    label: "下雨天",
    text: "外面开始下雨了。你们都在屋里，谁也没有要走的意思。",
  },
];

function read(): Script[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return BUILTIN;
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return BUILTIN;
    return p.filter(
      (s) => s && typeof s.id === "string" && typeof s.label === "string"
    );
  } catch {
    return BUILTIN;
  }
}

function write(list: Script[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function loadScripts(): Script[] {
  return read();
}

export function addScript(s: Omit<Script, "id">): Script[] {
  const list = read();
  const next = [
    ...list,
    { ...s, id: "s" + Date.now().toString(36) },
  ];
  write(next);
  return next;
}

export function removeScript(id: string): Script[] {
  const next = read().filter((s) => s.id !== id);
  write(next);
  return next;
}

export function resetScripts(): Script[] {
  write(BUILTIN);
  return BUILTIN;
}

/** 有没有改过（用过要显示「恢复默认」） */
export function isCustomized(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * 订阅 —— 左栏改完，其他地方跟着刷新。
 *
 * 简单到不值得上 Context，一个事件就够。
 */
const EVT = "3w:scripts-changed";

export function notifyScripts() {
  try {
    window.dispatchEvent(new Event(EVT));
  } catch {
    /* ignore */
  }
}

export function useScripts() {
  const [list, setList] = useState<Script[]>(read);

  const refresh = useCallback(() => setList(read()), []);

  useEffect(() => {
    window.addEventListener(EVT, refresh);
    return () => window.removeEventListener(EVT, refresh);
  }, [refresh]);

  return {
    list,
    add: (s: Omit<Script, "id">) => {
      setList(addScript(s));
      notifyScripts();
    },
    remove: (id: string) => {
      setList(removeScript(id));
      notifyScripts();
    },
    reset: () => {
      setList(resetScripts());
      notifyScripts();
    },
    customized: isCustomized(),
  };
}
