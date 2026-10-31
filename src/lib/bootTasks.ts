import { loadGroups } from "../data/groups";
import { loadPersonas } from "../data/personaStore";
import { DEFAULT_CONFIG } from "../data/engines";
import { readRestoreOutcome } from "./persist";
import { loadCredentials } from "../store/credentials";

/**
 * 启动序列要跑的真实任务。
 *
 * 关键原则：**这里没有一个是 sleep()**。
 * 每一项都是真的在做事，真的在计时。所以：
 *
 *   快机器 → 六项加起来可能 200ms，过程一闪而过（这是对的）
 *   慢机器 → 字体要等 1s、本地服务探测超时 → 过程拉长（这也是对的）
 *
 * 假装加载再播放固定时长，就是「双击之后干等 3 秒」——
 * 用户会以为软件很慢，而实际上它 200ms 就准备好了。
 */

export type BootStatus = "ok" | "warn" | "error";

export interface BootStepResult {
  /** 右侧显示的结果描述 */
  text: string;
  /**
   * ok    : 正常
   * warn  : 超时 / 降级，但能继续
   * error : 失败，功能缺失
   */
  status: BootStatus;
}

export interface BootStep {
  label: string;
  /** 关键步骤失败会拦住启动；其余一律带伤继续 */
  critical?: boolean;
  run: () => Promise<BootStepResult>;
}

const ENGINE_KEY = "3w:engine";

/** 等下一次绘制，用来确认「首屏真的画出来了」 */
const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export const BOOT_STEPS: BootStep[] = [
  {
    /* 恢复本身在 main.tsx 里已经做完（必须早于任何 store 读 localStorage）。
       这一步只是把结果报出来 —— 用户有权知道「这次启动有没有用文件兜底」。 */
    label: "核对本地留底",
    async run() {
      const o = readRestoreOutcome();
      /* 首次启动没有可核对的东西 —— 这不是警告，是正常 */
      if (!o) return { text: "首次启动", status: "ok" };

      if (o.restored.length > 0) {
        return { text: `补回 ${o.restored.length} 项`, status: "ok" };
      }

      switch (o.skip) {
        case "no-bridge":
          /* 浏览器预览里没有文件系统，数据只有 localStorage —— 环境限制，不是故障 */
          return { text: "仅本地缓存", status: "ok" };
        case "no-file":
          return { text: "无留底", status: "ok" };
        case "empty-file":
          return { text: "留底为空", status: "ok" };
        case "all-present":
          return { text: "本地已最新", status: "ok" };
        default:
          return { text: "读取失败", status: "warn" };
      }
    },
  },
  {
    label: "挂载角色注册表",
    critical: true,
    async run() {
      try {
        const n = loadPersonas().length;
        return { text: `${n} 个`, status: "ok" };
      } catch {
        return { text: "读取失败", status: "error" };
      }
    },
  },
  {
    label: "恢复群聊数据",
    async run() {
      try {
        const n = loadGroups().length;
        return { text: n > 0 ? `${n} 个` : "默认群", status: "ok" };
      } catch {
        return { text: "回退默认", status: "warn" };
      }
    },
  },
  {
    label: "读取引擎配置",
    async run() {
      let level: number = DEFAULT_CONFIG.active;
      try {
        const raw = localStorage.getItem(ENGINE_KEY);
        if (raw) level = JSON.parse(raw)?.active ?? level;
      } catch {
        return { text: `L${level} · 默认`, status: "warn" };
      }
      return { text: `L${level}`, status: "ok" };
    },
  },
  {
    label: "预加载字体",
    async run() {
      /* 真实等待：字体没下载完，界面文字会跳一下。
         超过 1200ms 就当作超时，不再等 —— 不让一项拖死整个启动。 */
      const t0 = performance.now();
      let timedOut = false;
      try {
        timedOut = await Promise.race([
          document.fonts.ready.then(() => false),
          new Promise<boolean>((r) => setTimeout(() => r(true), 1200)),
        ]);
      } catch {
        /* ignore */
      }
      const ms = Math.round(performance.now() - t0);
      const n = document.fonts?.size ?? 0;

      if (timedOut) {
        return { text: `超时 ${ms}ms`, status: "warn" };
      }
      return { text: n > 0 ? `${n} 族` : "ok", status: "ok" };
    },
  },
  {
    /* 原来这一项只探 Ollama（127.0.0.1:11434）。
       结果：配了云端 API、压根不用本地模型的用户，每次启动都看到一个黄条
       「未安装 262ms」，以为哪里没配好 —— 而且每次白等 262ms 去探一个
       永远不用的东西。一个永远黄的项目等于没有信号。

       现在先看云端，再看本地：任意一条路可用就算 ok。 */
    label: "探测可用后端",
    async run() {
      /* ① 云端凭据 —— 有模型列表才算「能用」（只填了 baseUrl 没拉模型 = 不能用） */
      let usable: { label?: string; models?: unknown[] }[] = [];
      try {
        usable = loadCredentials().filter((c) => (c.models?.length ?? 0) > 0);
      } catch {
        usable = [];
      }

      if (usable.length > 0) {
        const first = usable[0].label || "云端";
        return {
          text: usable.length === 1 ? first : `${usable.length} 套 · ${first}`,
          status: "ok",
        };
      }

      /* ② 没有云端 → 才去探本地 Ollama。
         超时压到 260ms：用户没装就不该在这儿等。 */
      const t0 = performance.now();
      try {
        const r = await fetch("http://127.0.0.1:11434/api/tags", {
          signal: AbortSignal.timeout(260),
        });
        const ms = Math.round(performance.now() - t0);
        return r.ok
          ? { text: `本地 ${ms}ms`, status: "ok" }
          : { text: `本地未响应 ${ms}ms`, status: "warn" };
      } catch {
        /* 中性描述：程序只知道「没检测到」，不知道是没配、配错了还是网络断了。
           说「没配」是在替用户下结论，而且大概率猜错。
           同样地，**标成 warn 也是替用户下结论** —— 没配本地服务完全正常。 */
        return { text: "未检测到本地或云端服务", status: "ok" };
      }
    },
  },
  {
    label: "渲染首屏",
    async run() {
      const t0 = performance.now();
      await nextFrame();
      return { text: `${Math.round(performance.now() - t0)}ms`, status: "ok" };
    },
  },
];
