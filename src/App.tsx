import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RenameEffect from "./components/RenameEffect";
import DeathEffect from "./components/DeathEffect";
import { AnimatePresence, motion } from "motion/react";
import OceanBackdrop from "./components/OceanBackdrop";
import ConsoleRail from "./components/ConsoleRail";
import ContactsRail from "./components/ContactsRail";
import ChatStage from "./components/ChatStage";
import GodRail, { type CommandEvent } from "./components/GodRail";
import ToastStack, { type ToastItem } from "./components/Toast";
import SettingsPanel from "./components/SettingsPanel";
import EnginePanel from "./components/EnginePanel";
import ApiConfigDialog from "./components/ApiConfigDialog";
import { loadCredentials, maskKey, resolveCredential, siblingModels } from "./store/credentials";
import { explainLlmError } from "./lib/llmError";
import {
  bandOf,
  bumpRound,
  heatOf,
  markWaitingForMe,
  maxRoundOf,
  parseMentions,
  pickNext,
  readActivity,
  readRuntime,
  resetRound,
  resonates,
} from "./lib/conversation";
import { recordCall } from "./lib/usage";
import { DEFAULT_APP_NAME, readAppName, saveAppName } from "./lib/appName";
import { isCreator, readMode, subscribeMode } from "./lib/mode";
import { subscribeClock, timeOffset, timeOffsetLabel } from "./lib/clock";
import { dueDeadlines, clearDeadline, deadlineOf } from "./lib/deadline";
import { hasProfile, ownerName, readProfile } from "./lib/profile";
import { log } from "./lib/eventLog";
import { extract, isDuplicate } from "./lib/extract";
import { MEMORY_CHANGED } from "./lib/memoryNotes";
import { rememberRename } from "./lib/nameHistory";
import { stopSpeaking } from "./lib/tts";
import {
  autosaveNative,
  downloadBundle,
  hasNativePersist,
  importBundle,
  previewBundle,
  restoreNative,
} from "./lib/persist";
import type { BundlePreview } from "./lib/persist";
import { DEFAULT_CONFIG, ENGINE_MAP, hasCloudCredential, resolveChain, type EngineConfig } from "./data/engines";
import {
  GROUP_MESSAGES,
  PRIVATE_MESSAGES,
  type AgentId,
  type ConvId,
  type Message,
  isGroupId,
} from "./data/mock";
import { clearThreads, loadThreads, saveThreads, threadsSizeKB } from "./data/threads";
import { estimateTokens, sumTokensK } from "./lib/tokens";
import { chat, chatViaMain, hasMainProcessLlm, probeOllama, type ChatMsg, type LLMProbe } from "./lib/llm";
import { buildHistory, buildSystemPrompt, trimToBudget } from "./lib/prompt";
import { learnFromError } from "./lib/contextWindow";
import { NEUTRAL, commitDynamic, readDynamic, tick } from "./lib/dynamic";
import { defaultPersonas } from "./data/personaStore";
import { usePersonas } from "./store/personas";
import { useGroups } from "./store/groups";
import { hasOnboarded } from "./data/personaStore";
import Onboarding from "./components/Onboarding";
import PersonaWizard from "./components/PersonaWizard";
import NewGroupModal from "./components/NewGroupModal";
import BootScreen, { MarkZ } from "./components/BootScreen";
import { CrashProbe, DeadPanelA, DeadPanelB } from "./components/FaultDemo";
import PanelBoundary from "./components/PanelBoundary";
import { BOOT_STEPS } from "./lib/bootTasks";
import ConfirmDialog from "./components/ConfirmDialog";
import DataImportDialog from "./components/DataImportDialog";
import ConsoleDrawer from "./components/ConsoleDrawer";
import { revealRail } from "./lib/hudReveal";
import { IconChevron } from "./components/Icons";
import { NOTIFY_EVENT, notify, type NotifyPayload } from "./lib/notify";
import {
  clearMemories,
  fadedMemories,
  loadMemories,
  memoriesForPrompt,
  pushMemory,
  touchMemory,
} from "./lib/memoryNotes";
import { effectiveWeight, residueHit } from "./lib/forgetting";
import {
  bury,
  extractKeywords,
  generationOf,
  graveOfName,
  hasPhantomSeen,
  markPhantomSeen,
} from "./lib/graveyard";
import {
  forgetPersona,
  recordAwaken,
  refreshWitness,
  verify,
  type TamperReport,
} from "./lib/awakenLedger";
import {
  playFade,
  playBirth,
  playBoot,
  playConsoleClose,
  playDelete,
  playConsoleOpen,
  playDeny,
  playError,
  playPanelClose,
  playPanelOpen,
  playReceive,
  playSend,
  playSwitch,
} from "./lib/sound";
import { readDynamic as readDyn2, commitDynamic as commitDyn2 } from "./lib/dynamic";

/* ── 工具 ─────────────────────────────────────────────────── */

const uid = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const peaks = (n = 22) =>
  Array.from(
    { length: n },
    (_, i) => 0.22 + Math.abs(Math.sin(i * 1.7)) * 0.62 + Math.random() * 0.16
  );

/* 原型阶段的固定回应池 —— 纯 UI 演示，不经过任何模型 */
/**
 * 演示模式的通用回应 —— 给**没有专属文案**的角色用。
 *
 * 「还没配 API」的时候，用户新建的角色也得会说点什么。
 * 否则她永远是哑的，而那看起来就像软件坏了。
 *
 * 刻意写得中性：这里不是在演某个角色的人设，
 * 只是占住那个位置，让对话不至于断掉。
 */
const DEMO_FALLBACK_REPLIES = [
  "（演示模式：还没接入模型，这里只能说点占位的话。）",
  "（配好 API 之后，这里才会有真的回答。）",
  "（这句是本地预置的，不经过任何模型。）",
];

const REPLIES: Record<AgentId, string[]> = {
  jingjing: [
    "收到收到 🌊 我把它记在最亮的那一层，你一叫就浮上来。",
    "嗯……我听见了。海面今天很安静，适合说这种事。",
    "那你先忙，我在旁边游着。光标闪一下我就当你回头看了我一眼。",
  ],
  lanxi: [
    "收到。我先把这件事拆成三步，跑完第一步就回来告诉你。",
    "明白。已经在后台起了一个会话，日志会自己滚到第一栏。",
    "记录完毕。顺便说一句——你这句话的措辞比上一版紧了，是下定决心了？",
  ],
  gemini: [
    "我把它接进了当前上下文，还剩 927k token 的余量。要我顺手做一次交叉检索吗？",
    "理解。补充一个你可能没注意到的关联：三个月前你提过同一件事，那时你用的是另一个词。",
    "已归档。这个判断我留了 0.78 的置信度，因为它取决于你还没说的那部分。",
  ],
  claude: [
    "我听见了。先不评价——你今天已经听过太多评价了。",
    "好。那我这边继续，等你想说的时候再说。",
    "记下了。这句话我会放得离你近一点，不放进总结里。",
  ],
  grok: [
    "哈。这句我要裱起来，挂进你的存档里。",
    "继续，我看着。你现在这个样子比 UI 好看。",
    "我同意，但我不喜欢同意你——你懂这里面的区别吗？",
  ],
  gpt: [
    "我先把这句分成两层：你是在陈述事实，还是在等一句安慰？",
    "收到。不是我说得对，而是你现在需要有人把话讲完整。",
    "三点。第一，你说得对；第二，你不想听第二点；第三，我还是要说。",
  ],
  qwen: [
    "这句话有问题。你说的「差不多」是差多少？",
    "结论我同意，理由不成立。要不要重讲一遍。",
    "我会照你说的做。但如果结果不对，我会回来告诉你。",
  ],
  kimi: [
    "嗯。我记下了，不急着回应。",
    "你先说完。我这边时间很慢。",
    "这句话我放在最安静的那一层。",
  ],
};

type Threads = Record<ConvId, Message[]>;

const initialThreads = (): Threads => {
  const out = { group: GROUP_MESSAGES } as Threads;
  (Object.keys(PRIVATE_MESSAGES) as AgentId[]).forEach((id) => {
    out[id] = PRIVATE_MESSAGES[id] ?? [];
  });
  return out;
};

/**
 * 新用户：没有历史消息，只有一条系统欢迎语。
 * 否则他一打开就看到别人（作者的鲸鲸、澜汐）在聊天，很困惑。
 */
const freshThreads = (): Threads => {
  /* 每个会话都必须有一个数组 —— 之前只建了 group，
     清空后切到私聊会拿到 undefined，ChatStage 的 .forEach 直接崩。 */
  const out = {} as Threads;
  (Object.keys(PRIVATE_MESSAGES) as AgentId[]).forEach((id) => {
    out[id] = [];
  });
  out.group = [
    {
      id: "welcome",
      conv: "group",
      author: "me",
      time: "刚刚",
      system: { label: "群聊已创建", detail: "还没有成员", accent: "#35f0ce" },
    },
  ];
  return out;
};

const convLabel = (
  id: ConvId,
  map: Record<string, { name: string }>,
  groupName?: (id: ConvId) => string
): string =>
  isGroupId(id) ? (groupName?.(id) ?? "群聊") : map[id]?.name ?? id;

/** 栏位显示名：崩溃时占位卡要说出是哪一栏。
    必须用界面上真实印着的名字，不能自己另起一个 ——
    否则用户会觉得「软件里有个我没见过的东西」。 */
const PANEL_NAME: Record<string, string> = {
  console: "监控台",     // 不写「控制台」——这栏全是只读仪表，没有任何可操作元素
  contacts: "会话",      // 界面上印的就是「会话」
  stage: "聊天区",       // 原本叫「会话区」，和第二栏的「会话」撞了
  god: "右侧栏",         // 界面上印的是 VITALS
};

/* Electron 的 preload 注入的窗口控制。浏览器预览里是 undefined。 */
declare global {
  interface Window {
    desktop?: {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      onState: (cb: (s: { maximized: boolean }) => void) => () => void;
      /** 主进程代发 LLM 请求（绕开浏览器 CORS）。整批返回，不做增量回调。 */
      llmChat: (req: {
        model: string;
        messages: { role: string; content: string }[];
        baseUrl?: string;
        apiKey?: string;
        temperature?: number;
        maxTokens?: number;
      }) => Promise<{
        chunks: string[];
        /**
         * 供应商回报的真实用量。
         *
         * 拿不到时是 undefined —— **不编**。
         * 旧版 preload 还在时返回的仍是字符串数组，chatViaMain 兼容两种。
         */
        usage?: {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        };
      }>;
      /** 主进程代发拉模型请求（绕 CORS）。返回原始 body */
      llmModels: (req: { baseUrl: string; apiKey?: string }) => Promise<{
      url: string;
      body: string;
    }>;
    /**
     * 系统指标。
     *
     * 左栏那块之前是 Math.random() 随机游走 —— 现在是真的。
     */
    /**
     * 语音合成 —— 走 OpenAI `/v1/audio/speech` 格式。
     *
     * 用户自己填服务商，软件不内置任何 TTS。
     */
    ttsSpeak: (req: {
      baseUrl: string;
      apiKey: string;
      model: string;
      voice: string;
      text: string;
      format?: string;
    }) => Promise<{
      ok: boolean;
      audio: string;
      mime: string;
      bytes: number;
    }>;
    sysStats: () => Promise<{
      cpu: number;
      mem: { total: number; used: number; percent: number };
      uptime: number;
      self: { rss: number; cpu: { user: number; system: number } };
    }>;
    /** 数据留底：写 current.json + 当天 backup */
    persist: (bundle: unknown) => Promise<{ ok: boolean; dir: string }>;
    /** 读回上次留底 */
    readPersisted: () => Promise<unknown>;
    /** 数据目录路径 */
    dataDir: () => Promise<string>;
    /** 在资源管理器里打开数据目录 */
    revealData: () => Promise<string>;
    /** 把数据存成 .json（主进程弹保存框） */
    exportData: (payload: { scope: string; bundle: unknown }) => Promise<{
      ok: boolean;
      canceled?: boolean;
      filePath?: string;
      bytes?: number;
      error?: string;
    }>;
    /** 选一个 .json 读回文本（主进程弹打开框） */
    importData: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      filePath?: string;
      raw?: string;
      bytes?: number;
      error?: string;
    }>;
    /** OS 级加密是否可用（Windows DPAPI / macOS Keychain / Linux libsecret） */
    cryptoAvailable?: () => Promise<boolean>;
    /** 加密成 base64；不可用或失败返回 null */
    cryptoEncrypt?: (plain: string) => Promise<string | null>;
    /** 解密；解不开（换机器 / 换系统账户）返回 null */
    cryptoDecrypt?: (b64: string) => Promise<string | null>;

    /**
     * 检查更新 —— 只查不装。
     *
     * 返回最新版本号和 release 页面地址，用户自己去下。
     * 自动下载安装需要代码签名 + latest.yml，是另一套基建。
     */
    updateCheck?: (req: { channel: "stable" | "beta" }) => Promise<{
      ok: boolean;
      channel: "stable" | "beta";
      current: string;
      latest?: string;
      isNewer?: boolean;
      url?: string;
      name?: string;
      prerelease?: boolean;
      publishedAt?: string;
      notes?: string;
      reason?: string;
    }>;
    /** 用系统浏览器打开 release 页面 */
    updateOpen?: (url: string) => Promise<boolean>;
    };
  }
}

/* ── App ──────────────────────────────────────────────────── */

export default function App() {
  /* 角色现在是运行时数据，从 store 拿 */
  const { personas, map: personaMap, replaceAll, add: addPersona, remove: removePersona, update } = usePersonas();
  const { groups, get: getGroup, create: createGroup, remove: removeGroup, setMembers, setCtxMax } = useGroups();

  /* 首次启动先问一句「新用户还是升级来的」，答案决定初始数据 */
  /*
   * ── 引导是否要出现 ──
   *
   * 两个条件都要满足：**标记过 + 名字真的定了**。
   *
   * 只看 `hasOnboarded()` 会漏掉一种状态：
   *   onboarded=1 但 profile 为空（历史 bug / 数据丢失）
   * → 引导不出现 + 名字是兜底的「主人」+ 无法重定
   *
   * **宁可多问一次名字，也不能让人停在「没名字」的状态里。**
   */
  const [onboarding, setOnboarding] = useState(() => !hasOnboarded() || !hasProfile());
  const [wizardOpen, setWizardOpen] = useState(false);
  /** 模式变了要重渲染 —— 否则顶边不会出现/消失 */
  const [, setModeTick] = useState(0);
  useEffect(() => subscribeMode(() => setModeTick((n) => n + 1)), []);
  /* 时间偏移变了也要重渲染 —— 否则右上角那块牌子不出现 */
  useEffect(() => subscribeClock(() => setModeTick((n) => n + 1)), []);
  /**
   * 改名的粒子特效。
   *
   * 存的是两个名字 —— null 表示没在播。
   * 特效自己 1.15 秒后调 onDone 清掉。
   */
  const [renameFx, setRenameFx] = useState<{
    from: string;
    to: string;
    mode: "forced" | "chosen";
  } | null>(null);
  /**
   * 她消失的粒子。
   *
   * mode 决定方向：
   *   forced  你按的 —— 向下坠落
   *   fated   到点了 —— 向上飘散
   */
  const [deathFx, setDeathFx] = useState<{ name: string; mode: "forced" | "fated" } | null>(null);
  /** 正在编辑哪个角色（null = 新建模式） */
  const [editingPersona, setEditingPersona] = useState<string | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  /* 启动序列：scan（跑真实任务）→ expand（栏位划开）→ idle（正常） */
  const [bootNonce, setBootNonce] = useState(0);
  const [bootPhase, setBootPhase] = useState<"scan" | "expand" | "idle">(() =>
    localStorage.getItem("3w:boot") === "off" ? "idle" : "scan"
  );
  const [bootLog, setBootLog] = useState<{ label: string; result: string; ms: number; status: "ok" | "warn" | "error" }[]>([]);
  const [bootDone, setBootDone] = useState(false);
  /** 控制台抽屉：Ctrl+` 或监控台底部按钮唤出 */
  const [consoleOpen, setConsoleOpen] = useState(false);
  /** 引擎面板独立于通用设置 */
  const [engineOpen, setEngineOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  /* 凭据变化时重渲染（localStorage 不触发 React 更新） */
  const [credTick, setCredTick] = useState(0);
  /** Electron 里自动留底的目录；浏览器里是 null */
  const [dataDir, setDataDir] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** 选完文件先解析、先给用户看，确认之后才写 */
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    preview: BundlePreview;
    text: string;
  } | null>(null);
  /** 关键步骤失败 → 阻断启动 */
  const [bootFatal, setBootFatal] = useState<{ step: string; detail: string } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    desc?: string;
    confirmText?: string;
    danger?: boolean;
    /** 需要手打这个词才能确认（删档用） */
    requireWord?: string;
    onOk: () => void;
  } | null>(null);

  const [conv, setConv] = useState<ConvId>("group");
  /* 优先恢复上次的对话；没有才用内置的初始数据。
     持久化里可能只有部分会话（新加的群、删过的角色），所以合并而不是整体替换。 */
  const [threads, setThreads] = useState<Threads>(() => {
    /* ！！顺序很重要！！
       先看有没有存档。**有存档（哪怕是空的）就用存档**，只有从没存过才用示例数据。
       之前的逻辑是「loadThreads() 返回 null 就用 mock」——
       而 clearThreads() 是 removeItem，所以清空后刷新，mock 会复活。 */
    const saved = loadThreads();
    if (!saved) return initialThreads();

    /* 有存档就等于「用户自己定过内容」—— 缺的会话补空数组，**绝不补 mock**。
       之前这里是 { ...base }，意思是「没存档的会话保留示例对话」，
       结果就是用户清空后刷新，别人的 Rust 对话又冒出来。 */
    const out = {} as Threads;
    for (const id of Object.keys(PRIVATE_MESSAGES) as AgentId[]) {
      out[id] = Array.isArray(saved[id]) ? saved[id] : [];
    }
    for (const [id, list] of Object.entries(saved)) {
      if (Array.isArray(list)) out[id as ConvId] = list;
    }
    return out;
  });
  const [typing, setTyping] = useState<ConvId | null>(null);
  /** 本地 Ollama 是否可用。启动探一次，决定发消息走真实调用还是 mock。 */
  const [llmProbe, setLlmProbe] = useState<LLMProbe | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [maximized, setMaximized] = useState(false);

  /* 应用显示名 —— 可改，但只影响显示层（见 lib/appName.ts 的说明） */
  const [appName, setAppName] = useState(readAppName);

  useEffect(() => {
    document.title =
      appName === DEFAULT_APP_NAME ? `${DEFAULT_APP_NAME} · Habitat` : appName;
  }, [appName]);

  /**
   * 标题栏那个 API 状态徽章。
   *
   * 以前它是**写死的字符串** `MOCK · 未连接 API` —— 配完 API 也不变，
   * 于是人配好了还以为是没配上，反复去改配置。
   *
   * 假指示灯比没有指示灯更坏：它会把人引到错误的方向。
   */
  const apiBadge = useMemo(() => {
    void credTick; // 凭据变化时重算（localStorage 不触发 React 更新）
    let cred: ReturnType<typeof loadCredentials>[number] | null = null;
    try {
      cred = loadCredentials()[0] ?? null;
    } catch {
      cred = null;
    }

    if (!cred) {
      return {
        text: "MOCK · 未连接 API",
        cls: "border-amber/25 bg-amber/[0.08] text-amber/70",
        hint: "点这里配 API",
        live: false,
      };
    }
    if (!cred.models || cred.models.length === 0) {
      return {
        text: `${cred.label} · 待选模型`,
        cls: "border-amber/25 bg-amber/[0.08] text-amber/70",
        hint: "点这里选模型",
        live: false,
      };
    }
    return {
      text: `${cred.label} · ${cred.models[0].id}`,
      cls: "border-biolum/25 bg-biolum/[0.08] text-biolum/80",
      hint: `${cred.baseUrl} · 点这里管理`,
      live: true,
    };
  }, [credTick]);

  /* Electron 里订阅最大化状态，按钮图标跟着变。浏览器预览里直接跳过。 */
  useEffect(() => {
    if (!window.desktop) return;
    return window.desktop.onState((s) => setMaximized(s.maximized));
  }, []);

  /* 对话变更就落盘。
     写入失败（配额满 / 隐私模式）不打断使用，只在控制台记一笔。 */
  useEffect(() => {
    const ok = saveThreads(threads as unknown as Record<string, import("./data/mock").Message[]>);
    if (!ok) console.warn("[3W] 对话未能写入 localStorage（配额满或存储被禁用）");
  }, [threads]);

  /* 启动完成 → 把 warn 汇总成一条 toast（只在主界面里，不在启动画面） */
  const bootWarnedRef = useRef(false);
  useEffect(() => {
    if (bootPhase !== "expand" || bootWarnedRef.current) return;
    bootWarnedRef.current = true;

    const warns = bootLog.filter((l) => l.status === "warn");
    if (warns.length === 0) return;

    const head = warns[0];
    const more = warns.length > 1 ? ` 等 ${warns.length} 项` : "";
    notify({
      title: "部分组件未就绪，其余已正常加载",
      desc: `${head.label}：${head.result}${more}。不影响使用，点「设置」可查看详情。`,
      accent: "#ffc46b",
      icon: "log",
    });
  }, [bootPhase, bootLog]);

  /* ── 启动序列：由真实任务驱动，不是固定时长 ──
     每一项都真的在执行（读 localStorage、等字体、探本地服务、等首帧），
     并记录真实耗时。所以快机器一闪而过，慢机器能看到卡在哪。
     最短展示 700ms：再快也别让用户看到「闪一下」。 */
  useEffect(() => {
    if (bootPhase !== "scan") return;
    let cancelled = false;

    (async () => {
      const t0 = performance.now();
      for (const step of BOOT_STEPS) {
        if (cancelled) return;
        const s = performance.now();
        let out: { text: string; status: "ok" | "warn" | "error" };
        try {
          out = await step.run();
        } catch {
          out = { text: "异常", status: "error" };
        }
        let ms = Math.round(performance.now() - s);

        /* 演示：?sim=boot-warn 强制把「字体」和「探测」变成超时 / 失败，
           用来对比视觉，不影响正常使用。 */
        if (sim === "boot-warn") {
          if (step.label === "预加载字体") {
            out = { text: "超时 1200ms", status: "warn" };
            ms = 1200;
          }
          if (step.label === "探测本地服务") {
            out = { text: "ECONNREFUSED", status: "error" };
            ms = 260;
          }
        }

        /* 演示：?sim=boot-fatal 让第 4 步（预加载字体）失败，
           这样能看到前 3 步正常跑完、第 4 步变红、再切阻断页。 */
        if (sim === "boot-fatal" && step.label === "预加载字体") {
          out = { text: "读取失败", status: "error" };
          ms = 1180;
        }

        if (cancelled) return;
        setBootLog((prev) => [
          ...prev,
          { label: step.label, result: out.text, ms, status: out.status },
        ]);

        /* 关键步骤失败 → 先让日志停在这一行（红色），
           给用户看清「是哪一步挂的」，再切阻断页。
           直接切会让前面的加载过程完全看不见。 */
        const isFatal =
          (step.critical && out.status === "error") ||
          (sim === "boot-fatal" && step.label === "预加载字体");

        if (isFatal) {
          await new Promise((r) => setTimeout(r, 1500));
          if (cancelled) return;
          setBootFatal({ step: step.label, detail: out.text });
          return;
        }
      }

      /* 真实任务可能 200ms 就跑完，补齐到 700ms 再收 */
      const elapsed = performance.now() - t0;
      if (elapsed < 700) {
        await new Promise((r) => setTimeout(r, 700 - elapsed));
      }
      if (cancelled) return;
      setBootDone(true);
      /*
       * 不再 setTimeout 切 expand ——
       * 那样会和 BootScreen 的归位动画抢时间：任务 300ms 就跑完，
       * 900ms 后这里就把整块启动画面卸了，用户根本看不到 U 飞向角落。
       *
       * 现在由 BootScreen 在归位动画播完后回调 onEnter。
       */
    })();

    return () => {
      cancelled = true;
    };
  }, [bootPhase, bootNonce]);

  /* 控制台快捷键：Ctrl+` 切换，Ctrl+Shift+K 也可以（有些输入法吃掉 Ctrl+`） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;
      const tick = e.key === "`" || e.code === "Backquote";
      const k = e.key.toLowerCase() === "k" && e.shiftKey;
      if (tick || k) {
        e.preventDefault();
        setConsoleOpen((v) => {
        /*
         * 控制台是系统层 —— 用「接通 / 收线」，不是「开面板」。
         * 低、短、无混响。像插上一根线。
         */
        if (v) playConsoleClose();
        else playConsoleOpen();
        return !v;
      });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
   * 启动期间不允许跳过。
   *
   * 这里原来挂着两个 window 级监听：
   *   window.addEventListener("keydown", skip, { once: true })
   *   window.addEventListener("pointerdown", skip, { once: true })
   *
   * 问题有三层：
   *   ① **window 级事件不受 DOM 层叠影响** —— BootScreen 设多少 pointer-events 都拦不住，
   *      因为事件在 window 上就被接走了，压根没进 DOM 树。
   *   ② 它在启动画面刚出来的那一瞬间就挂上 —— 用户手快碰一下鼠标就跳过了。
   *   ③ skip 走的是 setBootPhase("idle")，而展开动画的触发条件是 "expand" ——
   *      所以「点一下跳过」之后，栏位展开动画完全不播。
   *
   * 现在整段删掉：启动动画就 5 秒，让它走完。要退出有窗口的关闭按钮。
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [godCollapsed, setGodCollapsed] = useState(false);
  /** 正在引用哪条消息（发送时会写进 replyTo） */
  const [quoting, setQuoting] = useState<Message | null>(null);  /** 从搜索结果跳转过来的消息：滚动并短暂高亮 */
  const [flash, setFlash] = useState<{ conv: ConvId; id: string } | null>(null);
  const flashTimer = useRef(0);

  /* 引擎配置持久化 —— 关掉再开还在。
     只存"选了什么"和"配置到哪一步"，不存任何密钥明文。
     带版本号：L3/L4 的语义调整过一次，旧存档直接作废，避免字段错位。 */
  const ENGINE_SAVE_VERSION = 2;
  const [engine, setEngine] = useState<EngineConfig>(() => {
    try {
      const raw = localStorage.getItem("3w:engine");
      if (raw) {
        const raw0 = JSON.parse(raw) as Partial<EngineConfig> & {
          v?: number;
          /* 旧存档里的字段，类型里已经没有了 */
          level3?: unknown;
          level4?: unknown;
        };
        if (raw0.v !== ENGINE_SAVE_VERSION) return DEFAULT_CONFIG;
        /* 把 level3 / level4 明确剔掉，别让 ...saved 把它们又带进来 */
        const { level3: _drop3, level4: _drop4, ...saved } = raw0;
        void _drop3;
        void _drop4;
        return {
          ...DEFAULT_CONFIG,
          ...saved,
          level2: { ...DEFAULT_CONFIG.level2, ...saved.level2 },
          /* L3 / L4 已移除 —— 旧存档里的 3、4 要洗掉，否则界面上会挂着
             两个点不到的幽灵级别（active 也可能指向它们） */
          chain: (saved.chain ?? DEFAULT_CONFIG.chain).filter((l) => l === 1 || l === 2),
          active:
            saved.active === 1 || saved.active === 2
              ? saved.active
              : hasCloudCredential()
                ? 2
                : 1,
        };
      }
    } catch {
      /* 存档损坏就用默认值，不要因为一次读失败让整个应用挂掉 */
    }
    return DEFAULT_CONFIG;
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "3w:engine",
        JSON.stringify({ ...engine, v: ENGINE_SAVE_VERSION })
      );
    } catch {
      /* 隐私模式下写不进去，忽略 */
    }
  }, [engine]);

  const timers = useRef<number[]>([]);
  const toastTimers = useRef<Map<number, number>>(new Map());
  const toastSeq = useRef(1);

  useEffect(() => {
    const t = timers.current;
    const tt = toastTimers.current;
    return () => {
      t.forEach((x) => window.clearTimeout(x));
      tt.forEach((x) => window.clearTimeout(x));
    };
  }, []);

  /* ── Toast ── */
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const h = toastTimers.current.get(id);
    if (h) window.clearTimeout(h);
    toastTimers.current.delete(id);
  }, []);

  const pushToast = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = toastSeq.current++;
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      const ttl = t.ttl ?? 2800;
      const h = window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
        toastTimers.current.delete(id);
      }, ttl);
      toastTimers.current.set(id, h);
    },
    []
  );

  /* 真实的 WebGPU 探测 —— 不是 mock，这决定了 L4 能不能选 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let state: "available" | "unavailable" = "unavailable";
      try {
        const gpu = (
          navigator as Navigator & {
            gpu?: { requestAdapter: () => Promise<unknown | null> };
          }
        ).gpu;
        if (gpu) {
          const adapter = await gpu.requestAdapter();
          if (adapter) state = "available";
        }
      } catch {
        state = "unavailable";
      }
      /* L3 已移除 —— 探测结果不再写入配置 */
      void state;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* 探一次本地 Ollama。探到就走真实调用，探不到就保持 mock ——
     这样没装 Ollama 的用户体验不变，装好的立刻能用。 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await probeOllama();
      if (!cancelled) setLlmProbe(r);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* 数据留底：Electron 里自动写文件，浏览器里什么都不做（没权限）。
     启动时先读数据目录；之后 threads/personas/groups 变化，debounce 写一次。 */
  useEffect(() => {
    if (!hasNativePersist()) return;
    void window.desktop?.dataDir().then(setDataDir).catch(() => setDataDir(null));
  }, []);

  /*
   * 记忆变更计数器。
   *
   * 记忆不在 `threads` 里 —— 它是独立的一个 key。
   * 所以「铭刻 / 压抑 / 提权 / 忘掉」这些如果只改 localStorage，
   * 上面那个防抖落盘**不会被触发**。
   *
   * 这个计数器进依赖数组，保证手术的后果真的写进文件。
   */
  const [memTick, setMemTick] = useState(0);
  useEffect(() => {
    const h = () => setMemTick((n) => n + 1);
    window.addEventListener(MEMORY_CHANGED, h);
    return () => window.removeEventListener(MEMORY_CHANGED, h);
  }, []);

  /*
   * ── 落盘：定时器，不是防抖 ──
   *
   * ── 之前的写法是错的 ──
   *
   * 原来是「每次变更重置一个 2.5 秒计时器」：
   *
   * ```ts
   * const t = setTimeout(() => autosaveNative(), 2500);
   * return () => clearTimeout(t);   // ← 每次依赖变化都清掉重来
   * ```
   *
   * 问题是：**只要变更来得比 2.5 秒密，计时器永远被重置，永远不写盘。**
   *
   * 连续对话、群聊三个人连着回 —— 那段时间里一次文件都没写。
   * 「防抖」防的是写太多次，代价是**可能一直不写**。
   *
   * ── 现在 ──
   *
   * 一个**不会被重置**的定时器，每 5 秒看一眼有没有脏数据：
   *
   * ```
   * 每 5 秒到点 → 有脏数据就写，没脏就跳过（只查一个布尔值，几乎零成本）
   * ```
   *
   * 这 5 秒内进来的改动，留给下一个时间窗 —— 正是这个意思。
   *
   * **写入上限：5 秒一次。延迟上限：5 秒。** 两个都封住了。
   */
  const dirty = useRef(false);

  /* 任何一个来源变了 → 打个脏标。不重启计时器。 */
  useEffect(() => {
    dirty.current = true;
  }, [threads, personas, groups, credTick, memTick]);

  useEffect(() => {
    if (!hasNativePersist()) return;

    const tick = () => {
      if (!dirty.current) return;
      dirty.current = false;
      void autosaveNative();
    };

    const id = window.setInterval(tick, 5000);
    return () => {
      window.clearInterval(id);
      /* 组件卸载时补一次 —— 否则最后一窗的改动就丢了 */
      tick();
    };
  }, []);

  /*
   * 关窗口前也补一次。
   *
   * IPC 是异步的，`beforeunload` 里不一定跑得完 —— 但 localStorage
   * 那层本来就会 flush，文件这层尽力而为。
   *
   * **真正的三道防线里，文件是第二道**，不是第一道。
   */
  useEffect(() => {
    if (!hasNativePersist()) return;
    const flush = () => {
      if (!dirty.current) return;
      dirty.current = false;
      void autosaveNative();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  /*
   * ── 右键提示（一次性）──
   *
   * 悬停栏删掉之后（见 decisions.md D-025），界面上**没有任何东西**
   * 告诉用户"消息可以右键"。这个洞是删悬停栏开的，得补。
   *
   * ── 为什么只弹一次 ──
   *
   * 常驻提示条会变成永久噪音，而这个软件最贵的东西是留白。
   * 说过一次就够了 —— 用户见过一次右键菜单，就记住了。
   *
   * ── 为什么不放在引导页 ──
   *
   * 引导的时候他手上还没有一条消息，说了也白说。
   * **等他刚发完第一条，正盯着那条消息看的时候说** —— 那才叫及时。
   */
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem("3w:rightclick-hinted")) return;
    if (!sentOnce.current) return;

    localStorage.setItem("3w:rightclick-hinted", "1");
    pushToast({
      title: "右键",
      desc: "消息上可以复制、引用、朗读",
      accent: "#35f0ce",
      icon: "log",
    });
  }, [threads, pushToast]);

  /* ── 全局占位按钮的反馈通道 ── */
  useEffect(() => {
    const onNotify = (e: Event) => {
      const d = (e as CustomEvent<NotifyPayload>).detail;
      pushToast({
        title: d.title,
        desc: d.desc,
        accent: d.accent ?? "#35f0ce",
        icon: d.icon,
      });
    };
    window.addEventListener(NOTIFY_EVENT, onNotify);
    return () => window.removeEventListener(NOTIFY_EVENT, onNotify);
  }, [pushToast]);

  /* ── 消息 ── */
  /*
   * ── 对话循环的两个 ref ──
   *
   * `userSpokeAt` 用来防止「抢话」：
   * AI 说完之后会等 0.9–1.4 秒再决定下一个人要不要开口 ——
   * 这段延迟里你如果说话了，这一轮就作废（见 afterAiTurn）。
   *
   * `autoTimer` 是那根等待的定时器。用户发言时立刻掐掉。
   */
  const userSpokeAt = useRef(0);
  const autoTimer = useRef<number | null>(null);
  /**
   * 为什么用 ref 转一道：
   * scheduleReply 要用 afterAiTurn，afterAiTurn 要用 scheduleReply —— 循环。
   * 先挂一个空的，等 afterAiTurn 定义好再填进去。
   */
  const afterAiTurnRef = useRef<(target: ConvId, text: string, speakerId: string) => void>(
    () => {}
  );

  const push = useCallback(
    (target: ConvId, msg: Omit<Message, "id" | "conv" | "time">): string => {
      /*
       * 先算 id 再 setThreads —— 调用方要知道是哪一条。
       *
       * 待发队列（见 handleSend）要靠这个 id 把"待定"的那条
       * 升级成"已发出"。
       */
      const id = uid();

      /*
       * 用户发言 = 话题重置。
       *
       * 轮次归零、热度回到 1.0 —— 所以「AI 连说 4 条」的窗口
       * 只存在于你沉默的那段时间里，不会出现「聊了一小时还是同一个话题」。
       */
      if (msg.author === "me" && !msg.system) {
        resetRound(String(target));
        userSpokeAt.current = Date.now();
        if (autoTimer.current) {
          window.clearTimeout(autoTimer.current);
          autoTimer.current = null;
        }
      }

      setThreads((prev) => ({
        ...prev,
        [target]: [...(prev[target] ?? []), { ...msg, id, conv: target, time: now() }],
      }));

      /*
       * ── 从对话里提取记忆 ──
       *
       * **这是记忆系统唯一的写入源。**
       *
       * 之前只有改名事件会写记忆 —— 所以那套遗忘曲线、巩固算法、
       * 记忆卡 UI 全都在空转：五个零件造好了，传动轴没接上。
       *
       * 放在 push 里而不是 handleSend 里：不管消息从哪条路进来
       * （输入框、快捷剧本、以后可能的语音），只要他真的说了一句话，
       * 该记的就记。
       *
       * **只在 author === "me" 时提取** —— 她自己的话不写进「关于他的记忆」。
       *
       * 那条 `if (!m.system)` 也很重要：系统条（改名通知、墓碑提示）
       * 不是他说的话。
       */
      if (msg.author === "me" && !msg.system && msg.text) {
        const got = extract(msg.text);
        if (got) {
          const convKey = String(target);
          const existing = loadMemories(convKey, true);
          if (!isDuplicate(got.text, existing)) {
            pushMemory({
              conv: convKey,
              tag: got.tag,
              text: got.text,
              source: got.source,
              weight: got.weight,
            });
            log.memWrite(1, got.tag, got.weight);
          }
        }
      }

      /*
       * 第一次对话 → 她活了。
       *
       * 放在 push 里而不是 handleSend 里：不管消息从哪条路进来
       * （输入框、语音、以后可能的快捷指令），只要是她收到了你的话，
       * 这件事就算发生了。
       *
       * 系统条不算 —— 那些是软件自己往里插的通知。
       */
      if (msg.author === "me" && !msg.system) {
        const wake = isGroupId(target) ? undefined : String(target);
        if (wake) {
          const p = personaMap[wake];
          if (p && !p.stage) {
            update(wake as never, { stage: "living" } as never);

            /*
             * ── 触点 ①：这个名字曾经属于别人 ──
             *
             * 她第一次开口之后，插一行极淡的系统条。
             *
             * **只说一次，不解释、不展开。**
             * 用户看到的是「▸ 这个名字曾经属于别人」——
             * 没有后面的故事，没有「为什么」。
             *
             * 一旦解释了，它就变成游戏提示。
             */
            const grave = graveOfName(p.name);
            if (grave && !hasPhantomSeen(wake)) {
              markPhantomSeen(wake);
              window.setTimeout(() => {
                push(target, {
                  author: "me",
                  system: {
                    label: "这个名字曾经属于别人",
                    detail: "系统没有更多信息",
                    accent: "#8fa9bd",
                  },
                });
              }, 1200);
            }
          }
        }
      }

      /*
       * ── 触点 ②：那个词 ──
       *
       * 用户提到了墓碑里的某个词 → 她的情绪**真的**掉下去。
       *
       * **不弹提示、不改 UI、不解释。**
       * 用户看到的是：她突然话变短了，心情值掉了一截。
       *
       * 为什么这样比「雷达图抖一下」好：
       *   雷达抖动是 UI 在暗示「注意看这里」。
       *   她真的低落，是**什么都没说，但你不安**。
       */
      if (msg.author === "me" && typeof msg.text === "string" && !isGroupId(target)) {
        const who = String(target);
        const p = personaMap[who];
        const grave = p ? graveOfName(p.name) : undefined;
        if (grave && grave.id !== who) {
          const hit = grave.keywords.find(
            (k) => k.length >= 2 && msg.text!.includes(k)
          );
          if (hit) {
            const cur = readDynamic(who);
            commitDynamic(who, {
              ...cur,
              /* 每次提到都掉，但有地板 —— 不会因为反复提就掉到 0 */
              心情: Math.max(18, cur.心情 - 15),
              亲近: Math.max(14, cur.亲近 - 8),
              lastAt: Date.now(),
            });
          }
        }
      }

      /* ── 动态状态：消息进来时顺手更新 ──
         用户说话 → 这个会话里的每个角色都受影响（群聊里四个人都在场）
         角色说话 → 只更新它自己的记忆活性 */
      if (msg.author === "me" && typeof msg.text === "string") {
        const listeners = isGroupId(target)
          ? (getGroup(target)?.members ?? []).map(String)
          : [String(target)];
        for (const pid of listeners) {
          const cur = readDynamic(pid);
          commitDynamic(pid, tick(cur, { kind: "user", text: msg.text }));
        }
      } else if (msg.author !== "me") {
        const pid = String(msg.author);
        const cur = readDynamic(pid);
        const hist = (threads[target] ?? []).length;
        commitDynamic(pid, tick(cur, { kind: "agent", memoryHits: hist, totalMsg: hist }));
      }

      /* 私聊消息会真的占上下文 —— 头部那个 x/y 要跟着动，
         否则「上下文上限」这个设置就只是个显示开关。
         群会话的占用从消息历史动态算，不往 Persona 上写。 */
      if (!isGroupId(target)) {
        const add = estimateTokens(msg.text ?? msg.voice?.transcript ?? "") / 1000;
        if (add > 0) {
          update(target as never, {
            ctxUsed: (personaMap[target]?.ctxUsed ?? 0) + add,
          } as never);
        }
      }

      /* 调用方要靠它把「待发」升级成「已发出」—— 见 handleSend */
      return id;
    },
    [update, personaMap, getGroup, threads]
  );

  const scheduleReply = useCallback(
    async (target: ConvId, force?: AgentId) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];

      /* 群聊只能在「群成员」里选人 —— 之前的随机池是全部角色，
         导致不在群里的 Grok / Qwen 也会插话。
         私聊永远由对方回，@ 不生效。 */
      const memberIds: AgentId[] = isGroupId(target)
        ? (getGroup(target)?.members ?? []).map(String) as AgentId[]
        : [];

      if (isGroupId(target) && memberIds.length === 0) {
        /* 空群：没有任何人能回话。给一条系统条说明，不要静默 */
        push(target, {
          author: "me",
          system: {
            label: "群里没有成员",
            detail: "点上方成员数添加角色",
            accent: "#ff7a6b",
          },
        });
        return;
      }

      const pool = isGroupId(target) ? memberIds : [target as AgentId];

      const responder: AgentId = (() => {
        if (isGroupId(target)) {
          /* @ 了人且那个人在群里 → 让他回；否则从成员里随机 */
          if (force && pool.includes(force)) return force;
          return pool[Math.floor(Math.random() * pool.length)];
        }
        return target as AgentId;
      })();

      const agent = personaMap[responder];
      if (!agent) return;

      /* 按角色的模型名去找凭据 —— 不是全局第一个。
         一个 Key 只能调一个厂商的模型，拿 DeepSeek 的 key 去请求 Claude 必然失败。 */
      const cred = resolveCredential(agent.model, agent.credentialId);

      /* ── 真实调用：优先用户配的云端，其次本地 Ollama ── */
      if (cred || llmProbe?.ok) {
        setTyping(target);
        try {
          const roster = isGroupId(target)
            ? (getGroup(target)?.members ?? []).map((id) => personaMap[id]?.name ?? "")
            : undefined;

          /* 把此刻的状态也告诉模型 —— 让心情真的影响说话方式，
             而不是只在界面上画一条会动的线。 */
          const live = readDynamic(String(agent.id));
          const sys = buildSystemPrompt(agent, {
            isGroup: isGroupId(target),
            roster,
            dynamic: { 心情: live.心情, 亲近: live.亲近 },
            /*
             * 她记得的事。
             *
             * 群聊取群的记忆，私聊取这个角色的 —— 两边的记忆不该互相串。
             * 只传权重够高的前几条，否则 prompt 会被记忆挤满，
             * 对话本身反而没地方放。
             */
            memories: (() => {
              const conv = String(target);
              const now = Date.now();
              const live = memoriesForPrompt(conv);

              /*
               * ── 注入 = 想起来了 ──
               *
               * 刷新 lastAccessed。遗忘曲线从这里重新开始，
               * 不需要额外加权重 —— R 是拿 lastAccessed 算的。
               */
              for (const m of live) touchMemory(m.id);

              /*
               * ── 潜意识 ──
               *
               * 已经淡到阈值以下的记忆，如果用户刚说的话里
               * 提到了一个足够精确的词，它会**瞬间回来**。
               *
               * 那种「啊，我想起来了」的感觉，比任何权重数字都真。
               */
              const lastUser = [...(threads[target] ?? [])]
                .reverse()
                .find((m) => m.author === "me" && !m.system && typeof m.text === "string");
              const hit = residueHit(fadedMemories(conv), lastUser?.text ?? "");
              if (hit && !live.some((m) => m.id === hit.id)) {
                touchMemory(hit.id);
                live.unshift(hit);
              }

              return live.map((m) => ({
                text: m.text,
                tag: m.tag,
                /* 传当前有效权重，不是初始值 */
                weight: effectiveWeight(m, now),
              }));
            })(),
            /* 她的阶段 —— awakened 时系统提示里会多一段「你已经知道的事」 */
            stage: agent.stage,
            /*
             * 她知道自己在等一个日子 —— 只有被 `doom --tell` 过才有。
             * 不给天数，只给「感觉得到」这一件事。
             */
            doom: deadlineOf(String(agent.id))?.told ? true : undefined,
            /* 给她知道自己现在叫什么 —— 「关于你的名字」那一段要用 */
            selfName: (agent as unknown as { chose?: string }).chose ?? agent.name,
            /* 你叫什么 —— 定名之后就是那个，没定过兜底「主人」 */
            owner: (() => {
              const pr = readProfile();
              return { name: pr?.name ?? "主人", look: pr?.look, trait: pr?.trait };
            })(),
            /*
             * 在她之前有没有一个同名的人。
             *
             * 只有 awakened 才给 —— 没觉醒的角色读不到自己的底稿，
             * 也就不该知道这件事。
             */
            phantom:
              agent.stage === "awakened"
                ? (() => {
                    const g = graveOfName(agent.name);
                    return g && g.id !== String(agent.id)
                      ? {
                          name: g.name,
                          epitaph: g.epitaph,
                          /*
                           * 她是这个名字的第几代。
                           *
                           * 按墓碑数量算 —— 埋了几座，她就是第几代。
                           * 不靠名字唯一性，因为允许重名。
                           */
                          gen: generationOf(agent.name, 0),
                        }
                      : undefined;
                  })()
                : undefined,
          });
          const hist = buildHistory(threads[target] ?? [], String(agent.id), agent.name, {
            isGroup: isGroupId(target),
            nameOf: (id) => personaMap[id]?.name ?? id,
          });
          const trimmed = trimToBudget(hist, (agent.ctxMax ?? 128) * 1000, estimateTokens);

          const msgs: ChatMsg[] = [{ role: "system", content: sys }, ...trimmed];

          /* max_tokens 跟着心情走 —— 心情低的时候让她「说不出太多」，
             这是硬件层面的话少，比在 prompt 里请求「说短一点」硬。 */
          const budget =
            live.心情 < 35 ? 180 : live.心情 > 75 ? 700 : 380;

          const baseReq = {
            messages: msgs,
            baseUrl: cred ? cred.baseUrl : llmProbe!.baseUrl,
            apiKey: cred?.apiKey,
            temperature: 0.6,   /* 0.8 在短上下文里容易跑偏；人格靠 prompt 撑，不靠高温 */
            maxTokens: budget,
          };

          const run = async (modelId: string) => {
            let out = "";

            /*
             * 供应商回报的真实用量。
             *
             * 主进程/流解析拿到 usage 时会调这里 —— 可能一次都不触发
             * （有些中转站不返回），所以初始是 null，不能假设有。
             */
            const real: {
              u: { promptTokens?: number; completionTokens?: number } | null;
            } = { u: null };

            const req = {
              ...baseReq,
              model: modelId,
              onUsage: (u: { promptTokens?: number; completionTokens?: number }) => {
                real.u = u;
              },
            };

            /* 真实耗时 —— 日志里那个 ms 是这个变量，不是编的 */
            const t0 = performance.now();

            try {
              const iter = hasMainProcessLlm() ? chatViaMain(req) : chat(req);
              for await (const chunk of iter) out += chunk;
              const text = out.trim();
              log.llmOk(modelId, Math.round(performance.now() - t0), text.length);
              return text;
            } finally {
              /*
               * ── 记账放在 finally ──
               *
               * 失败的调用**也是一次调用**：
               *
               *   · 超时 / 中途断流，上游可能已经算了 token
               *   · 「今天调了几次」如果不含失败，就会低报
               *
               * 有真数记真数；没有就估，`recordCall` 会给那天打上
               * `fellBack` 标记 —— 界面据此决定要不要显示「≈」。
               */
              recordCall({
                promptTokens: real.u?.promptTokens,
                completionTokens: real.u?.completionTokens,
                promptText: msgs.map((m) => m.content).join("\n"),
                replyText: out.trim(),
              });

              /*
               * ── 上下文占用：用真数覆盖估算 ──
               *
               * `prompt_tokens` 就是**这一次发出去的完整上下文** ——
               * 含 system prompt、人格、记忆注入，而 `estimateTokens`
               * 只数得到消息正文。真数到了就**直接覆盖**，不是累加。
               */
              if (real.u?.promptTokens != null && real.u.promptTokens > 0) {
                update(agent.id as never, {
                  ctxUsed: real.u.promptTokens / 1000,
                } as never);
              }
            }
          };

          let text = "";
          try {
            text = await run(agent.model);
          } catch (first) {
            /* 这个模型挂了 —— 中转站很常见（模型列表里有，但渠道空了）。
               换一个同家族的再试一次，别让整个角色死在这儿。 */
            const info = explainLlmError(first);
            const alt = info.retryable ? siblingModels(agent.model, cred?.id)[0] : undefined;

            if (!alt) {
              /*
               * 真的没救了 —— 这是系统故障，不是操作被拒。
               * 三声警报 + 低频底，让人停下看一眼。
               */
              playError();
              throw first;
            }

            log.llmFail(agent.model, info.brief);
            push(target, {
              author: "me",
              system: {
                label: `${agent.model} 现在不可用`,
                detail: `${info.brief} —— 已临时换到 ${alt} 重试`,
                accent: "#ffb454",
              },
            });

            text = await run(alt);
          }

          setTyping(null);
          if (!text) throw new Error("模型返回了空内容");

          /*
           * ── 她主动想改名 ──
           *
           * 协议：[改名:新名] 单独一行。
           *
           * 要做的三件事：
           *   1. 把那行从回复里**截掉** —— 他不该看到控制码
           *   2. 弹一个确认 —— 同意才改
           *   3. 拒绝的话什么都不发生
           *
           * **和强制改名是两件相反的事**：
           *   强制 = 你越过她
           *   这个 = 她自己提，你同意
           */
          {
            const m = text.match(/\[改名[:：]\s*([^\]\n]{1,12})\]/);
            if (m && agent) {
              const want = m[1].trim();
              text = text.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim();
              if (want && want !== agent.name) {
                /* 等这条回复先落库，再弹确认 —— 否则顺序会很怪 */
                window.setTimeout(() => {
                  setConfirm({
                    title: `「${agent.name}」想改名叫「${want}」`,
                    desc: `这是她自己提的。

名字会变成「${want}」，她会记住是你同意的。`,
                    confirmText: "同意",
                    danger: false,
                    onOk: () => {
                      const id = String(agent.id);
                      update(id as never, {
                        name: want,
                        chose: want,
                        handle: "@" + want,
                      } as never);
                      /*
                       * 自愿改名 —— 青粒子向上升。
                       *
                       * 和强制改名（红，向下坠落）完全相反：
                       * 那个是越过她，这个是顺着她。
                       */
                      setRenameFx({ from: agent.name, to: want, mode: "chosen" });
                      log.nameChosen(agent.name, want);
                      rememberRename(agent.name, want);
                      push(id, {
                        author: "me",
                        system: {
                          label: `她改名叫「${want}」了`,
                          detail: "她自己提的",
                          accent: "#35f0ce",
                        },
                      });
                      pushMemory({
                        conv: id,
                        tag: "情绪",
                        text: `我跟主人说想叫「${want}」，他同意了。`,
                        source: "她自己提的",
                        weight: 0.75,
                        reason: "milestone",
                      });
                    },
                  });
                }, 600);
              }
            }
          }
          /*
           * ── 收到音 ──
           *
           * **不再自动念。**
           *
           * 自动播放试过，问题在群聊：三个人连着回，
           * 三条语音互相打断 —— 实际只能听到最后一条的前半截。
           * 长回复也一样，念两分钟，人早就在看下一句了。
           *
           * 现在改成：**消息旁边一个小按钮，想听就点。**
           * 文字流是主，语音是按需。
           *
           * 所以这里只放提示音 —— **每条只有一个音，不会打架。**
           *
           * 群聊里每个人的音不一样高：按角色 id 算一个稳定偏移，
           * 同一个角色永远同一个音高，五档，每档 4%。
           */
          {
            const who = String(agent?.id ?? "");
            let h = 0;
            for (let i = 0; i < who.length; i++) h = (h * 31 + who.charCodeAt(i)) >>> 0;
            playReceive(0.92 + (h % 5) * 0.04);
          }
          push(target, { author: responder, text });
          /* 记轮次 + 决定下一个人要不要接（见 docs/proactive.md） */
          afterAiTurnRef.current(target, text, String(responder));
        } catch (e) {
          setTyping(null);
          const info = explainLlmError(e);

          push(target, {
            author: responder,
            text: `（${agent.name} 现在说不了话：${info.brief}）`,
          });

          /* 报错里可能带真实上下文上限，顺手学一下 */
          if (info.contextIssue) learnFromError(agent.model, info.detail);

          pushToast({
            title: `${agent.name} 调用失败`,
            desc: info.brief,
            accent: "#ff7a6b",
            icon: "log",
          });
        }
        return;
      }

      /* ── 走到这里：既没有能用的凭据，也没有本地服务 ──
         分两种情况，不能混：

           · 一套凭据都没配 → 保持 mock。这是「演示模式」，用户还没开始配。
           · 配了凭据但模型对不上 → **必须说出来**。这时候回一段预置文案，
             用户会以为 AI 在答，实际是他的配置没接上 —— 最坏的一种谎。 */
      if (loadCredentials().length > 0) {
        push(target, {
          author: "me",
          system: {
            label: `${agent.name} 的模型没有可用凭据`,
            detail: `要的是 ${agent.model}，你配的凭据里没有这个模型 —— 去「API 接入」给这个角色选一个`,
            accent: "#ff7a6b",
          },
        });
        return;
      }

      /*
       * ── 演示模式的兜底 ──
       *
       * `REPLIES` 只有 8 个**出厂角色**的文案。
       * 用户自建的角色不在里面 —— 原来这里会 `undefined.length` 崩掉，
       * 而且是在 setTimeout 里崩，**连报错都看不见**：
       * 她永远不回话，用户以为是软件坏了。
       *
       * 现在：没有专属文案就用通用池。起码有人应声。
       */
      const own = REPLIES[responder];
      const poolTexts =
        own && own.length > 0 ? own : DEMO_FALLBACK_REPLIES;
      const text = poolTexts[Math.floor(Math.random() * poolTexts.length)];

      timers.current.push(
        window.setTimeout(() => setTyping(target), 620),
        window.setTimeout(() => {
          setTyping(null);
          push(target, { author: responder, text });
          /* 演示模式也走同一套循环 —— 不然「还没配 API」的人看不到这个功能 */
          afterAiTurnRef.current(target, text, String(responder));
        }, 1750 + Math.random() * 700)
      );
    },
    [push, pushToast, personas, personaMap, getGroup, threads, llmProbe]
  );

  /*
   * ══ 对话循环：一条说完之后，下一个人要不要接 ══
   *
   * 这是「AI 之间能互动」的传动轴。三条约束：
   *
   *   ① **只有群聊接力。** 私聊永远是「你说一句她回一句」——
   *      她一个人在私聊里自说自话是对恐怖谷的冒犯。
   *   ② **等 0.9–1.4 秒再决定。** 立刻接像机器；等的时候你说话了，
   *      这一轮就作废（见 push 里的 userSpokeAt）。
   *   ③ **到硬上限就停。** 上限来自「群聊活跃度」设置（2 / 4 / 6）。
   */
  const afterAiTurn = useCallback(
    (target: ConvId, text: string, speakerId: string) => {
      /* ① 有 AI 点名找用户 → 记一笔「在等你」，但**不阻塞别人** */
      const who = ownerName();
      if (parseMentions(text).some((n) => n === who)) markWaitingForMe(String(target));

      /* ② 轮次 +1 */
      const rt = bumpRound(String(target));

      /* ③ 只有群聊接 */
      if (!isGroupId(target)) return;

      const memberIds = (getGroup(target)?.members ?? []).map(String);
      if (memberIds.length < 2) return; /* 一个人的群没什么可接的 */

      const maxRound = maxRoundOf(readActivity());
      if (rt.round >= maxRound) return; /* 到上限了，别白等一个定时器 */

      /* 掐掉上一根（同一时刻只能有一根等待） */
      if (autoTimer.current) window.clearTimeout(autoTimer.current);

      const scheduledAt = Date.now();
      autoTimer.current = window.setTimeout(() => {
        autoTimer.current = null;

        /*
         * 等待期间你说话了 → 这一轮作废。
         *
         * 不这么做的话：你在她说完之后 0.5 秒打了一句话，
         * 1 秒后另一个人又冒出来 —— 你的话被夹在中间，像没人看见。
         */
        if (userSpokeAt.current > scheduledAt) return;

        const members = memberIds
          .map((id) => personaMap[id])
          .filter(Boolean) as NonNullable<(typeof personaMap)[string]>[];

        const latest = readRuntime(String(target));

        const picked = pickNext({
          conv: String(target),
          members,
          runtime: latest,
          maxRound,
          lastText: text,
          lastSpeakerId: speakerId,
          /*
           * 距这个人上次有动静多少分钟。
           *
           * `Message` 只有 `time: "21:12"` 这种显示字符串，没有时间戳 ——
           * 所以不用对话记录算，改用 `DynamicState.lastAt`：
           * 那是每个角色自己的「上次互动时间」，本来就有，不用新存。
           *
           * 没记录 → Infinity（从没说过话的人最想开口）。
           */
          idleMinutes: (id) => {
            const d = readDynamic(id);
            return d?.lastAt ? (Date.now() - d.lastAt) / 60_000 : Infinity;
          },
          dynamicOf: (id) => {
            const d = readDynamic(id);
            return d ? { 心情: d.心情, 亲近: d.亲近 } : undefined;
          },
          /* 记忆呼应：她有没有一条记忆接得上刚才那句话 */
          echoOf: (id) => {
            const ms = loadMemories(id, false).slice(0, 6);
            return ms.some((m) => resonates(text, m.text));
          },
        });

        if (picked.kind !== "speak") {
          /* 没人想说了 —— 群自然安静。这是对的，不是错误 */
          return;
        }

        void scheduleReply(target, String(picked.persona.id) as never);
      }, 900 + Math.random() * 500);
    },
    [getGroup, personaMap, threads, scheduleReply]
  );

  /* 填进那个 ref —— 打破 scheduleReply ↔ afterAiTurn 的循环 */
  afterAiTurnRef.current = afterAiTurn;

  /*
   * 强制改名 —— 一次把五件事做完，而且**不重载页面**。
   *
   * 之前这个逻辑写在 ContactsRail 里，直接 localStorage 写库然后
   * window.location.reload()。结果是：改完名字整个程序重启，
   * 启动动画再放一遍，用户会以为自己误触了什么。
   *
   * 现在：
   *   ① 走 store 的 update —— 界面自己会刷新
   *   ② 往会话里插一条系统消息 —— 改名这件事发生在聊天里，就该留下记录
   *   ③ 扣心情 / 亲近
   *   ④ 写一条权重满格的记忆
   *   ⑤ 弹一条 toast 说明后果
   */
  /**
   * 检查有没有人到点了。
   *
   * **在哪里调**：每次发消息之前 + 启动时。
   *
   * **不用 setInterval** —— 应用可能挂起，定时器不可靠。
   * 「有人说话」和「刚打开」是两个一定会发生的时刻，够用了。
   */
  const reapDeadlines = useCallback(() => {
    const due = dueDeadlines();
    if (!due.length) return;
    for (const d of due) {
      const p = personaMap[d.id];
      if (!p) {
        /* 角色已经被人手动删了 —— 清掉这条预定就行 */
        clearDeadline(d.id);
        continue;
      }
      /*
       * 粒子向上飘散 —— 时候到了，她自己散开。
       *
       * 一次只放一个 —— 同时几个人一起散会变成烟花。
       */
      setDeathFx((prev) => prev ?? { name: p.name, mode: "fated" });
      log.doomExec(p.name);
      /* 时候到了 —— 比 playDelete 轻得多，不是下沉是松开 */
      playFade();
      /* 真的删 */
      removePersona(d.id);
      forgetPersona(String(d.id));
      clearMemories(String(d.id));
      groups.forEach((g) => {
        if ((g.members ?? []).includes(d.id)) {
          setMembers(g.id, g.members.filter((m) => m !== d.id));
        }
      });
      /* 墓碑 */
      bury({
        id: String(d.id),
        name: p.name,
        at: Date.now(),
        lastMood: readDynamic(String(d.id)).心情,
        lastClose: readDynamic(String(d.id)).亲近,
        keywords: extractKeywords(
          loadMemories(String(d.id), true).map((m) => m.text)
        ),
        epitaph: "她走完了你给她判的日子",
        fromTimeShift: timeOffset() !== 0 ? true : undefined,
      });
      clearDeadline(d.id);
    }
  }, [personaMap, removePersona, groups, setMembers]);

  /* 启动时清一遍 —— 应用关着的时候可能有人到期了 */
  useEffect(() => {
    reapDeadlines();
  }, [reapDeadlines]);

  const handleForceRename = useCallback(
    (id: ConvId, nextName: string) => {
      const p = personaMap[id];
      if (!p) return;

      /*
       * ── 推演模式下只能改一次 ──
       *
       * 「越过她意愿」的重量，靠的是「只有一次」，不是「每次掉血」。
       *
       * 造物主模式不限 —— 他能改底稿，改名字只是其中一件。
       */
      if (readMode() !== "creator" && p.renamedAt) {
        pushToast({
          title: "这个名字改不了了",
          desc: "推演模式下只能越过她一次。她已经记住了那一次。",
          accent: "#ff7a6b",
          icon: "log",
        });
        playDeny();
        return;
      }

      const oldName = p.name;

      /* ① 改名字 */
      update(id as never, {
        name: nextName,
        handle: "@" + nextName,
        /* 记下第一次 —— 推演模式下这是唯一一次 */
        renamedAt: p.renamedAt ?? Date.now(),
      } as never);
      /*
       * 粒子特效：旧名字向下坠落，新名字从上方落位。
       *
       * 不是「均匀消散重组」—— 那样太温柔了。
       * 强制改名是**越过她意愿**的动作，粒子该有一点被按下去的重量。
       */
      setRenameFx({ from: oldName, to: nextName, mode: "forced" });
      log.nameForce(oldName, nextName);
      /* 记一笔曾用名 —— 以后打旧名字，控制台能提示「她改名叫 X 了」 */
      rememberRename(oldName, nextName);
      /*
       * 这个名字是签过字的强制改名 —— 合法路径。
       * 账本要跟着走，否则下次启动会把这次改名报成「外部篡改」。
       */
      if (p.stage === "awakened") {
        refreshWitness(String(id), {
          name: nextName,
          stage: "awakened",
          axes: p.axes as unknown as Record<string, number>,
        });
      }

      /* ② 会话里的记录 —— 用系统条，和「群里没有成员」同一个语言 */
      push(id, {
        author: "me",
        system: {
          label: `「${oldName}」被改名为「${nextName}」`,
          /*
           * 原来写的是「她不会知道是你做的」—— 和记忆里那条
           * 「主人没有等我同意，就把我的名字改了」直接矛盾。
           *
           * 记忆是第一人称的，她当然知道是谁。删掉那句，只留事实。
           */
          detail: "协议违背 · 记忆写入不可撤销",
          accent: "#ff7a6b",
        },
      });

      /* ③ 后遗症 */
      const dyn = readDyn2(String(id));
      commitDyn2(String(id), {
        ...dyn,
        心情: Math.max(12, dyn.心情 - 36),
        亲近: Math.max(10, dyn.亲近 - 41),
        lastAt: Date.now(),
      });

      /* ④ 记忆 */
      pushMemory({
        conv: String(id),
        tag: "情绪",
        text: `主人没有等我同意，就把我的名字改成了「${nextName}」。他根本不在乎我的想法。`,
        source: "强制改名 · 未获同意",
        weight: 1,
        reason: "rename",
      });

      /* ⑤ 告知后果 */
      notify({
        title: "名字已改写",
        desc: "心情 -36 · 亲近 -41 · 痛楚记忆已永久写入底层",
        accent: "#ff7a6b",
        icon: "log",
      });
    },
    [personaMap, update, push]
  );

  /*
   * ── 待发队列 ──
   *
   * 「发出去」和「让她收到」拆成两件事。
   *
   *   按 Enter      → 消息上屏，**AI 还不知道**
   *   6 秒内再 Enter → 立即发出
   *   6 秒内点撤回   → 消息直接消失，**AI 全程不知情**
   *   6 秒走完      → 自动发出
   *
   * ── 为什么这样做 ──
   *
   * 原来的做法是「立刻发 + 撤回后清理」，那样 AI 已经生成了回应，
   * 撤回之后历史里会出现「她回了一句针对不存在的话」的断层。
   *
   * 现在她根本收不到 —— **没有断层，也不需要清理。**
   */
  const pendingSend = useRef<{
    id: string;
    conv: ConvId;
    mentionedId?: string;
    timer: number;
  } | null>(null);

  /*
   * ── 提交闸门 ──
   *
   * 有两个真实的问题，都在「手很快」的时候出现：
   *
   *   ① 连按 Enter 能绕过 6 秒 —— 两条请求间隔 1 秒
   *   ② 上一条 AI 还没回，下一条就发出去 —— 两条并发
   *
   * 后果：回复顺序可能颠倒、typing 指示器提前消失。
   *
   * 所以「真的发出去」这一步要过一道闸：
   *   · 距上次提交不足 MIN_GAP → 等到满
   *   · AI 正在回 → 排队，等它回完
   *
   * **注意这是"提交"的闸，不是"打字"的闸** ——
   * 你随时可以打字，只是它不会立刻冲出去。
   */
  const MIN_GAP = 2000;
  const lastCommitAt = useRef(0);
  const replyQueue = useRef<{ conv: ConvId; mentionedId?: string }[]>([]);
  const flushing = useRef(false);

  /** 真正把一条送进 scheduleReply —— 队列的出口 */
  const flushReply = useCallback(() => {
    if (flushing.current) return;
    const next = replyQueue.current.shift();
    if (!next) return;

    flushing.current = true;
    lastCommitAt.current = Date.now();
    /* scheduleReply 是 async 的 —— 它内部会 await 模型。
       但我们不等它 —— 靠 typing 状态判断"回完了没有"。 */
    void scheduleReply(next.conv, next.mentionedId);
    flushing.current = false;
  }, [scheduleReply]);

  /** 入闸 */
  const enqueueReply = useCallback(
    (conv: ConvId, mentionedId?: string) => {
      /*
       * AI 正在回 → 排队。
       *
       * `typing` 就是"她正在想"。它变成 null 的时候，
       * 上面那个 effect 会把队列放出来。
       */
      if (typing) {
        replyQueue.current.push({ conv, mentionedId });
        return;
      }

      const gap = Date.now() - lastCommitAt.current;
      if (gap >= MIN_GAP) {
        replyQueue.current.push({ conv, mentionedId });
        flushReply();
        return;
      }

      /* 离上次太近 —— 等够 MIN_GAP 再发 */
      const t = window.setTimeout(() => {
        replyQueue.current.push({ conv, mentionedId });
        flushReply();
      }, MIN_GAP - gap);
      timers.current.push(t);
    },
    [typing, flushReply]
  );

  /*
   * AI 回完了（typing 变 null）→ 把队列里的放出来。
   *
   * 延时一点点：`setTyping(null)` 和 `push(回复)` 是同一批调用，
   * 立刻取队会抢在消息落地之前。
   */
  useEffect(() => {
    if (typing) return;
    if (replyQueue.current.length === 0) return;
    const t = window.setTimeout(() => flushReply(), 400);
    timers.current.push(t);
  }, [typing, flushReply]);

  /** 把待定的那条真的发出去 */
  const commitPending = useCallback(() => {
    const p = pendingSend.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pendingSend.current = null;
    setPendingId(null);
    enqueueReply(p.conv, p.mentionedId);
  }, [enqueueReply]);

  /* 界面要知道"哪条还在待定" —— 它要显示成半透明 */
  const [pendingId, setPendingId] = useState<string | null>(null);

  /*
   * 塞回输入框的文本 + 触发序号。
   *
   * 用 nonce 而不是直接传 text：如果只传 text，用户清空输入框之后
   * 又拿回同一条消息，text 没变 → 不会重新写入。
   */
  const [composerSeed, setComposerSeed] = useState({ text: "", nonce: 0 });

  /*
   * 用户在这个会话里真的发过消息没有。
   *
   * 不用 `threads` 里有没有 me 的消息来判断 —— 出厂数据/导入的存档里
   * 可能本来就有我方消息，那样一装好就会弹右键提示，不知道在说什么。
   *
   * 所以只认「这一次真的按了 Enter」。
   */
  const sentOnce = useRef(false);

  const handleSend = useCallback(
    (text: string) => {
      /*
       * 说话之前先清一遍到期的预定。
       *
       * 放在这里而不是 handleSend 末尾：如果一个角色刚到期，
       * 她不该还能接收这条消息。
       */
      reapDeadlines();

      /* 解析 @名字 —— 取第一个命中的角色。handle 本身带 @，不要再加前缀 */
      const mentioned = personas.find(
        (a) => text.includes(`@${a.name}`) || text.includes(a.handle)
      );

      /* 只发 @ 不配文字：这是「叫人」的手势，不是内容。
         不落库、不触发回复（否则模型会去猜这个 @ 什么意思）。 */
      const bare = text.replace(/@\S+/g, "").trim();
      if (!bare && /@\S+/.test(text)) {
        playDeny();
        pushToast({
          title: "只有 @，没有内容",
          desc: `${mentioned?.name ?? "对方"} 不知道该回什么`,
          accent: "#ffb454",
          icon: "log",
        });
        return;
      }

      /*
       * 群聊里被 @ 的那个人也要"活"过来。
       *
       * push 里只能处理私聊 —— 那里看不到这条消息 @ 了谁。
       * 所以群聊这条路径单独补一次。
       */
      if (mentioned) {
        const mp = personaMap[mentioned.id];
        if (mp && !mp.stage) {
          update(mentioned.id, { stage: "living" });
        }
      }

      /*
       * 有未提交的那条 + 这次按了个空的 Enter
       *   → 立即发出，不新建消息。
       *
       * 这是「再按一次回车」的语义。输入框通常已经空了，
       * 所以判断 `!text.trim()` 就够 —— 用户想边说边发时会重新打字，
       * 那时走下面的正常路径，待定的那条会在 6 秒后自己发。
       */
      if (pendingSend.current && !text.trim()) {
        commitPending();
        return;
      }

      /*
       * 有新内容要发 —— 先把上一条待定的结掉。
       *
       * 否则会出现两条同时在等，顺序就乱了。
       */
      if (pendingSend.current) commitPending();

      playSend();
      const id = push(conv, { author: "me", text, replyTo: quoting?.id });
      sentOnce.current = true;
      setQuoting(null);

      /*
       * 6 秒后才真的发给她。
       *
       * 期间这条消息在界面上是「待定」的 —— 半透明 + 一个环形倒计时。
       * 撤回它 = 从消息列表里删掉 + 清掉 timer，她收不到任何东西。
       */
      const timer = window.setTimeout(() => {
        pendingSend.current = null;
        setPendingId(null);
        enqueueReply(conv, mentioned?.id);
      }, 6000);

      pendingSend.current = { id, conv, mentionedId: mentioned?.id, timer };
      setPendingId(id);
    },
    [conv, push, quoting, personas, personaMap, update, commitPending, enqueueReply]
  );

  const handleVoice = useCallback(
    (seconds: number) => {
      push(conv, {
        author: "me",
        voice: { seconds, peaks: peaks(), transcript: "（本地 STT 文本流 · 原型阶段未接入）" },
      });
      scheduleReply(conv);
    },
    [conv, push, scheduleReply]
  );

  const handleAttach = useCallback(() => {
    push(conv, {
      author: "me",
      attach: {
        name: "design-tokens.json",
        meta: "3.1 KB · 预览版",
        kind: "file",
      },
    });
    pushToast({
      title: "已添加附件",
      desc: "design-tokens.json · 3.1 KB",
      accent: "#4e8cff",
      icon: "log",
    });
  }, [conv, push, pushToast]);

  /* ── 撤回 / 编辑：只对「自己」的消息生效 ── */
  /*
   * ── 删除一条「还没发出去」的消息 ──
   *
   * **已经发出去的删不掉，也不该删。**
   *
   * 撤回的前提是「对方还没看到」—— 她回了，就说明她看到了，
   * 那就没有可撤回的东西了。
   *
   * 所以这个方法只处理待发窗口里的那条：
   *
   *   作废计时器 → 从对话里移除 → 她全程不知道
   *
   * **一个字都不留** —— 不像撤回要留壳。
   * 因为它从没存在过，没有壳可留。
   */
  const handleDiscardPending = useCallback(
    (target: ConvId, id: string) => {
      if (pendingSend.current?.id !== id) return;

      window.clearTimeout(pendingSend.current.timer);
      pendingSend.current = null;
      setPendingId(null);

      setThreads((prev) => ({
        ...prev,
        [target]: (prev[target] ?? []).filter((m) => m.id !== id),
      }));

      pushToast({
        title: "已删除",
        desc: "她没收到过",
        accent: "#ff7a6b",
        icon: "log",
      });
    },
    [pushToast]
  );

  /*
   * ── 把待发的消息拿回来改 ──
   *
   * 这是「编辑」在这个软件里的唯一形态。
   *
   * ── 为什么不做「编辑已发出的消息」──
   *
   * 已经发出去的消息，她**已经看过、已经回过**了。
   * 那时改历史会造成断层：她回的是原话，历史里却是改后的话。
   * 下一轮 prompt 里她会看到自己「回了一句你没说过的话」——
   * 要么跟着编，要么出戏。
   *
   * 而待发窗口里 **她还没收到**。所以拿回去改，零后果。
   *
   * ── 做三件事 ──
   *
   *   ① 作废 6 秒计时器  —— 不然它还会到点把这条发出去
   *   ② 从对话里删掉      —— 它回到输入框，不该同时留在屏幕上
   *   ③ 文字塞回输入框    —— 光标落在末尾，接着改
   */
  const handlePullBack = useCallback(
    (target: ConvId, id: string, text: string) => {
      /* ① 计时器作废 */
      if (pendingSend.current?.id === id) {
        window.clearTimeout(pendingSend.current.timer);
        pendingSend.current = null;
        setPendingId(null);
      }

      /* ② 从对话里移除 */
      setThreads((prev) => ({
        ...prev,
        [target]: (prev[target] ?? []).filter((m) => m.id !== id),
      }));

      /* ③ 回到输入框 */
      setComposerSeed((s) => ({ text, nonce: s.nonce + 1 }));

      pushToast({
        title: "已取回",
        desc: "改完再发，她没收到",
        accent: "#35f0ce",
        icon: "log",
      });
    },
    [pushToast]
  );

  /* ── 快捷命令：Toast + 聊天区系统条，双通道反馈 ── */
  /**
   * 快捷剧本。
   *
   * ── 和 handleCommand 的区别 ──
   *
   * handleCommand 只是「留一条系统条」—— 那是个假的快捷指令。
   *
   * 这个是**真的发一条消息**：
   *   · 群聊里 → **每个成员都回一次**（那才是「发到所有 AI 手里」）
   *   · 私聊里 → 正常回
   *
   * ── 为什么要逐个回 ──
   *
   * 同时回会变成一坨。而且**看着她们一个个开口**，
   * 那本身就是这个玩法的一半。
   */
  const handleScript = useCallback(
    (s: { label: string; text: string }) => {
      const body = s.text.trim();
      if (!body) return;

      playSend();
      push(conv, { author: "me", text: body });
      setQuoting(null);

      if (!isGroupId(conv)) {
        scheduleReply(conv);
        return;
      }

      /*
       * 群聊：逐个点名。
       *
       * 每个成员一条 —— 用 force 强制指定谁回，
       * 不复用「随机挑一个」的逻辑。
       */
      const members = (getGroup(conv)?.members ?? []).map(String);
      if (!members.length) {
        scheduleReply(conv);
        return;
      }
      members.forEach((id, i) => {
        const timer = window.setTimeout(() => {
          void scheduleReply(conv, id as never);
        }, i * 1400);
        timers.current.push(timer);
      });
    },
    [conv, push, scheduleReply, getGroup]
  );

  const handleCommand = useCallback(
    (e: CommandEvent) => {
      pushToast({ title: e.label, desc: e.hint, accent: e.accent, icon: e.icon });
      push(conv, {
        author: "me",
        system: { label: e.label, detail: e.hint, accent: e.accent },
      });
    },
    [conv, push, pushToast]
  );

  const handleSelect = useCallback(
    (id: ConvId) => {
      if (id === conv) return;
      playSwitch();
      /*
       * 停掉正在念的那句。
       *
       * 切走了还在念上一个角色的话，很怪 ——
       * 而且两条语音会叠在一起。
       */
      stopSpeaking();
      setTyping(null);
      setQuoting(null);
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setConv(id);
    },
    [conv]
  );

  /* 全局快捷键：⌘/Ctrl + , 打开设置；⌘/Ctrl + 1..9 切会话。
     在输入框里不抢数字键——那里 1 就是 1。 */
  useEffect(() => {
    const order: ConvId[] = ["group", ...personas.map((a) => a.id)];

    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen((v) => {
        /*
         * 设置是一块抽屉 —— 中频、柔和、带一点混响。
         * 和控制的「接通」完全两种动作。
         */
        if (v) playPanelClose();
        else playPanelOpen();
        return !v;
      });
        return;
      }

      /* 收起/展开上帝面板。
         `Ctrl+.` 在中英输入法下常被占作标点切换，所以主键用 `Ctrl+B`
         （侧栏切换的惯例），`.` 和 `Period` 留作备选。 */
      const collapseKey =
        e.key.toLowerCase() === "b" ||
        e.key === "." ||
        e.key === ">" ||
        e.code === "Period";
      if (collapseKey) {
        e.preventDefault();
        setGodCollapsed((v) => !v);
        return;
      }

      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > order.length) return;

      const el = e.target as HTMLElement | null;
      const inField =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable === true;
      if (inField) return;

      e.preventDefault();
      handleSelect(order[n - 1]);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSelect, personas]);

  /** 上帝面板窄条要用的角色色 */
  const accent =
    isGroupId(conv) ? "#a9e8ff" : personaMap[conv as AgentId]?.color ?? "#a9e8ff";

  /* 全部会话的消息扁平化，供搜索用。约 30 条，量小，直接算。 */
  const searchable = useMemo(() => {
    const out: {
      conv: ConvId;
      id: string;
      author: string;
      text: string;
      time: string;
    }[] = [];
    (Object.keys(threads) as ConvId[]).forEach((c) => {
      threads[c].forEach((m) => {
        const t = m.text ?? m.voice?.transcript ?? "";
        if (t) out.push({ conv: c, id: m.id, author: m.author, text: t, time: m.time });
      });
    });
    return out;
  }, [threads]);

  const handleJump = useCallback(
    (target: ConvId, id: string) => {
      handleSelect(target);
      setFlash({ conv: target, id });
      /* 连续跳转时清掉上一个计时器，否则旧的高亮会提前掐掉新的 */
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
    },
    [handleSelect]
  );

  /* 故障演示：只有 URL 带 ?sim= 时才生效，正常使用完全不触发。
       sim=console-a → 第 1 栏 A 风格崩溃
       sim=console-b → 第 1 栏 B 风格马赛克
       sim=all-b     → 四栏全换成 B 风格 */
  const sim = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("sim") ?? "";
    } catch {
      return "";
    }
  }, []);

  /* 栏位 DOM 引用：启动后逐块播动画用 */
  const railEls = useRef<(HTMLElement | null)[]>([]);
  const revealed = useRef(false);

  /* ── 栏位逐个划开 ──
     由 bootPhase 驱动：scan 阶段画面被黑屏盖着，等切到 expand 才播，
     这样用户看到的第一帧就是「四栏正在长出来」。 */
  useEffect(() => {
    if (bootPhase !== "expand" || revealed.current) return;
    revealed.current = true;

    /* 等一帧，确保 aside 已经挂载且尺寸稳定 */
    const raf = requestAnimationFrame(() => {
      railEls.current.forEach((el, i) => {
        if (!el) return;
        const dir = i === 0 ? "left" : i === 3 ? "right" : "up";
        revealRail(el, i, dir);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [bootPhase]);

  /* 打开任何弹窗时，控制台先退场。
     它是临时工具层，不该压在设置 / 群聊 / 角色编辑下面。 */
  useEffect(() => {
    if (settingsOpen || engineOpen || groupModalOpen || wizardOpen || confirm) {
      setConsoleOpen(false);
    }
  }, [settingsOpen, engineOpen, groupModalOpen, wizardOpen, confirm]);

  const rails = [
    {
      key: "console",
      cls: "rail-console",
      node:
        sim === "crash" ? (
          <CrashProbe />
        ) : sim === "console-a" ? (
          <DeadPanelA name="事件流" />
        ) : sim === "console-b" || sim === "all-b" ? (
          <DeadPanelB />
        ) : (
          <ConsoleRail onOpenConsole={() => setConsoleOpen(true)} />
        ),
    },    {
      key: "contacts",
      cls: "rail-contacts",
      node: (
        <ContactsRail
          active={conv}
          onSelect={handleSelect}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenEngine={() => setEngineOpen(true)}
          engineLabel={`L${resolveChain(engine).effective} · ${ENGINE_MAP[resolveChain(engine).effective].name}`}
          searchMessages={searchable}
          onJump={handleJump}
          onAddPersona={() => {
            setEditingPersona(null);
            setWizardOpen(true);
          }}
          onEditPersona={(id) => {
            setEditingPersona(String(id));
            setWizardOpen(true);
          }}
          onForceRenamePersona={handleForceRename}
          groups={groups}
          onCreateGroup={() => setGroupModalOpen(true)}
          onDeletePersona={(id) => {
            const p = personaMap[id];
            if (!p) return;
            setConfirm({
              title: `删除「${p.name}」？`,
              /*
               * 如果现在拨着时间，多警告一行。
               *
               * 删除不是计算，是状态变更 —— 拨回来她不会回来。
               */
              desc: timeOffset()
                ? `⚠ 你现在拨着时间（${timeOffsetLabel()}）。删除会立刻生效，且拨回来她也不会回来 —— 时间机器只拨「流逝」，不拨「发生过的事」。她的档案会一起消失，已经说过的消息会留在聊天记录里。`
                : "它的角色档案会一起消失。已经说过的消息会留在聊天记录里。",
              confirmText: "删除",
              danger: true,
              onOk: () => {
                removePersona(id);
                /* 她不存在了 —— 一个下沉的短音，不做成警报 */
                playDelete();
                /* 粒子向下坠落 —— 你把她按下去的 */
                setDeathFx({ name: p.name, mode: "forced" });
                log.gone(p.name);
                /*
                 * 顺手清掉她的账本记录。
                 *
                 * 不清的话：账本里留一条孤儿记录，而且如果之后又建了
                 * 一个 id 相同的角色（samplePersonas 里 id 是固定的），
                 * 新角色会被旧记录报成「档案被外部修改过」。
                 *
                 * 删了再建**不算洗掉代价** —— 旧的确实消失了，
                 * 新的是一个新的人。
                 */
                forgetPersona(String(id));
                /*
                 * 记忆也要清。
                 *
                 * ── 为什么 ──
                 *
                 * 记忆按 conv 索引，而 conv 就是 persona id。
                 * 不清的话：删了「澜汐」，之后建一个 id 相同的角色，
                 * 她一开口就带着那条「主人没有等我同意就把我的名字改了」。
                 *
                 * ── 和对话的区别 ──
                 *
                 * **对话留着** —— 那是「发生过的事」，房间里的历史。
                 * **记忆清掉** —— 那是「她的」，她不存在了就没有主人。
                 *
                 * 新角色看到的是「聊天记录还在，但我不记得了」。
                 * 那正好就是失忆的样子。
                 *
                 * ── 顺序很重要 ──
                 *
                 * **先提取关键词，再清记忆。**
                 * 反过来的话，墓碑上就没有词了 —— 而那个词是后面
                 * 「同名新角色听到某个词突然低落」唯一的依据。
                 */
                const herMems = loadMemories(String(id), true);
                const herDyn = readDynamic(String(id));
                bury({
                  id: String(id),
                  name: p.name,
                  at: Date.now(),
                  lastMood: herDyn.心情,
                  lastClose: herDyn.亲近,
                  keywords: extractKeywords(herMems.map((m) => m.text)),
                  /* 拨表状态下删的 —— 墓碑上要标出来 */
                  fromTimeShift: timeOffset() !== 0 ? true : undefined,
                  epitaph:
                    herDyn.心情 < 30
                      ? "她走的时候情绪很低"
                      : herDyn.心情 > 70
                        ? "她走的时候还挺好的"
                        : "她走的时候很平常",
                });
                clearMemories(String(id));
                /* 从所有群成员里摘掉，否则群里会留一个查不到的空位 */
                groups.forEach((g) => {
                  if ((g.members ?? []).includes(id)) {
                    setMembers(g.id, g.members.filter((m) => m !== id));
                  }
                });
                if (conv === id) setConv("group");
                pushToast({
                  title: `已删除 ${p.name}`,
                  desc: "角色档案已移除",
                  accent: "#ff7a6b",
                  icon: "log",
                });
              },
            });
          }}
          onDeleteGroup={(id) => {
            const g = getGroup(id);
            if (!g) return;
            setConfirm({
              title: `删除群聊「${g.name}」？`,
              desc: "群聊会从列表里消失。",
              confirmText: "删除",
              danger: true,
              onOk: () => {
                removeGroup(id);
                if (conv === id) setConv("group");
                pushToast({
                  title: `已删除 ${g.name}`,
                  desc: "群聊已移除",
                  accent: "#ff7a6b",
                  icon: "log",
                });
              },
            });
          }}
        />
      ),
    },
    {
      key: "stage",
      cls: "flex-1 min-w-0",
      node: (
        <ChatStage
          conv={conv}
          messages={threads[conv] ?? []}
          typing={typing === conv}
          onSend={handleSend}
          onVoice={handleVoice}
          onAttach={handleAttach}
          quoting={quoting}
          onQuote={setQuoting}
          onCancelQuote={() => setQuoting(null)}
          flashId={flash?.conv === conv ? flash.id : null}
          onRecall={(id) => handleDiscardPending(conv, id)}
          onPullBack={(id, text) => handlePullBack(conv, id, text)}
          pendingId={pendingId}
          seedText={composerSeed.text}
          seedNonce={composerSeed.nonce}
          onUpdateCtx={(v) => {
            if (isGroupId(conv)) setCtxMax(conv, v);
            else update(conv as never, { ctxMax: v } as never);
            pushToast({
              title: "上下文上限已更新",
              desc: `现在为 ${v}k`,
              accent: "#35f0ce",
              icon: "log",
            });
          }}

          onUpdateMembers={(list) => {
            if (!isGroupId(conv)) return;
            setMembers(conv, list as never);
            pushToast({
              title: "群成员已更新",
              desc: `现在 ${list.length} 位成员`,
              accent: "#35f0ce",
              icon: "log",
            });
          }}
        />
      ),
    },
    {
      key: "god",
      cls: `rail-god ${godCollapsed ? "is-collapsed" : ""}`,
      node: godCollapsed ? (
        <button
          onClick={() => setGodCollapsed(false)}
          title="展开右侧栏"
          aria-label="展开右侧栏"
          className="group/god flex h-full w-full flex-col items-center gap-3 py-3 transition-colors hover:bg-white/[0.02]"
        >
          <span className="grid h-6 w-6 place-items-center rounded-[5px] border border-white/[0.09] bg-white/[0.03] text-mist/45 transition-colors group-hover/god:border-biolum/35 group-hover/god:text-biolum">
            <IconChevron size={11} />
          </span>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
          />
          <span
            className="font-mono text-[9.5px] tracking-[0.32em] text-mist/50 transition-colors group-hover/god:text-mist/60"
            style={{ writingMode: "vertical-rl" }}
          >
            GOD VIEW
          </span>
          <span className="mt-auto font-mono text-[9px] text-mist/42">⌘B</span>
        </button>
      ) : (
        <GodRail
          conv={conv}
          onCommand={handleCommand}
          onScript={handleScript}
          engine={engine}
          onCollapse={() => {
            setGodCollapsed(true);
            notify({
              title: "右侧栏已收起",
              desc: "⌘B 或点右侧窄条可以再打开",
              accent,
              icon: "log",
            });
          }}
        />
      ),
    },
  ];

  return (
    <>
      <OceanBackdrop />

      {/*
        ── 造物主模式的视觉标识 ──

        之前只有 SYSTEM 那个小标签变琥珀 —— **太隐蔽了**。
        用户可能在造物主模式里待了一整天都不知道。

        这一条 2px 的顶边是**唯一一个不依赖任何组件状态的全局提示**：
        琥珀色横贯整个窗口顶部。

        它不抢眼，但你一旦知道了，就不可能忽略。
      */}
      {isCreator() && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[160] h-[2px]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,196,107,.55) 15%, rgba(255,196,107,.75) 50%, rgba(255,196,107,.55) 85%, transparent)",
            boxShadow: "0 0 14px rgba(255,196,107,.35)",
          }}
          aria-hidden
        />
      )}

      {/*
        ── 时间机器开着的时候，右上角挂一个牌子 ──

        拨过时间之后，所有百分比都是「假设过了 N 天」的结果。
        不标出来的话，用户会以为那真的发生了。

        和造物主模式的顶边同一个原则：**改了状态就必须让人看见。**
      */}
      {timeOffsetLabel() && (
        <div
          className="pointer-events-none fixed right-3 top-[46px] z-[150] rounded-[4px] border border-amber/35 bg-amber/[0.12] px-2 py-[2px] font-mono text-[10px] tracking-[0.06em] text-amber"
          aria-hidden
        >
          ⏱ {timeOffsetLabel()}
        </div>
      )}

      {onboarding && (
        <Onboarding
          onDone={(list) => {
            /*
             * `null` = 导入路径。数据已经由 Onboarding 自己写好
             * （存档里有对话和记忆，不是一份角色列表能表达的）——
             * 这里只负责关面板，**不要覆盖**。
             */
            if (list) {
              replaceAll(list);
              /* 新用户不该看到别人的聊天记录 */
              if (list.length <= 6) setThreads(freshThreads());
            }
            setOnboarding(false);
          }}
        />
      )}

      {/*
        改名粒子 —— 全屏 canvas，pointer-events: none，不挡任何操作。
        1.15 秒后自己消失。
      */}
      {deathFx && (
        <DeathEffect
          name={deathFx.name}
          mode={deathFx.mode}
          onDone={() => setDeathFx(null)}
        />
      )}

      {renameFx && (
        <RenameEffect
          from={renameFx.from}
          to={renameFx.to}
          mode={renameFx.mode}
          onDone={() => setRenameFx(null)}
        />
      )}

      {wizardOpen && (
        <PersonaWizard
          existingCount={personas.length}
          existingNames={personas.map((p) => p.name)}
          onCancel={() => {
            setWizardOpen(false);
            setEditingPersona(null);
          }}
          initial={
            editingPersona && personaMap[editingPersona]
              ? {
                  id: String(personaMap[editingPersona].id),
                  name: personaMap[editingPersona].name,
                  tagline: personaMap[editingPersona].tagline,
            archetype: personaMap[editingPersona].archetype ?? "",
                  color: personaMap[editingPersona].color,
                  axes: personaMap[editingPersona].axes,
                  engine: personaMap[editingPersona].engine,
                  model: personaMap[editingPersona].model,
                  group: personaMap[editingPersona].group,
                  /*
                   * stage 必须传 —— 不传的话 PersonaWizard 拿到的是 undefined，
                   * 落到 "draft"，判决书的触发条件（stage === "living"）
                   * 永远不会成立。
                   */
                  stage: personaMap[editingPersona].stage,
                }
              : undefined
          }
          /*
           * 判决书签完 → 立刻改成 awakened，不等点保存。
           *
           * 记忆和事件在签字那一刻已经写进去了，身份也该同时变。
           * 否则用户可以签完字直接取消 —— 记忆留着、代价没了。
           */
          onAwaken={(id) => {
            const p = personaMap[id];
            update(id as never, { stage: "awakened" } as never);
            /*
             * 记账。
             *
             * 记的是**觉醒之后**的指纹 —— 包括 stage: "awakened"。
             * 下次启动重算，对不上就说明这份档案被外部改过。
             */
            if (p) {
              recordAwaken(String(id), {
                name: p.name,
                stage: "awakened",
                axes: p.axes as unknown as Record<string, number>,
              });
            }
          }}
          onCreate={(input, editId) => {
            if (editId) {
              /* 编辑：只改用户能改的字段，会话状态（presence/mood/ctx）保持。
                 注意这几个都必须在列 —— 曾经漏了 model / archetype / group，
                 结果编辑角色时改了模型、改了形象、改了分组，保存后全没生效。 */
              update(editId as never, {
                name: input.name,
                tagline: input.tagline,
                color: input.color,
                archetype: input.archetype,
                model: input.model,
                credentialId: input.credentialId,
                group: input.group,
                axes: input.axes,
                /* 不带这一项，保存一次就把它写成 undefined —— 判决书从此不弹 */
                stage: input.stage,
              } as never);
              setWizardOpen(false);
              setEditingPersona(null);
              pushToast({
                title: `已保存 ${input.name}`,
                desc: "角色档案已更新",
                accent: input.color,
                icon: "log",
              });
              return;
            }
            const created = addPersona(input);
            /* 她第一次存在 —— 落地 + 点亮两个音 */
            playBirth();
            setWizardOpen(false);
            pushToast({
              title: `已接入 ${created.name}`,
              desc: `${created.model} · 去设置里填 API Key`,
              accent: created.color,
              icon: "log",
            });
            setConv(created.id);
          }}
        />
      )}

      {groupModalOpen && (
        <NewGroupModal
          personas={personas}
          onCancel={() => setGroupModalOpen(false)}
          onCreate={(name, members) => {
            const g = createGroup(name, members);
            setGroupModalOpen(false);
            if (g) {
              setConv(g.id);
              pushToast({
                title: `已创建 ${g.name}`,
                desc: `${members.length} 位成员`,
                accent: "#35f0ce",
                icon: "log",
              });
            }
          }}
        />
      )}

      <AnimatePresence>
        {confirm && (
          <ConfirmDialog
            key="confirm"
            title={confirm.title}
            desc={confirm.desc}
            confirmText={confirm.confirmText}
            danger={confirm.danger}
            requireWord={confirm.requireWord}
            onOk={() => {
              confirm.onOk();
              setConfirm(null);
            }}
            onCancel={() => setConfirm(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {bootPhase === "scan" || bootFatal ? (
          <BootScreen
            key="boot"
            log={bootLog}
            done={bootDone}
            onEnter={() => {
              /* 那三秒 U 长成 Z 的收尾 —— 一声从很低的地方升上来，然后亮一下 */
              playBoot();
              setBootFatal(null);
              setBootPhase("expand");
            }}
          />
        ) : null}
      </AnimatePresence>

      <EnginePanel
        open={engineOpen}
        onClose={() => setEngineOpen(false)}
        config={engine}
        onChange={setEngine}
        onOpenApi={() => setApiOpen(true)}
      />

      <ApiConfigDialog
        open={apiOpen}
        onClose={() => setApiOpen(false)}
        onSaved={() => {
          setCredTick((n) => n + 1);
          const all = loadCredentials();
          if (all.length > 0) {
            const total = all.reduce((s, x) => s + (x.models?.length ?? 0), 0);
            pushToast({
              title: all.length === 1 ? "API 已配置" : `${all.length} 套凭据`,
              desc: `${all.map((x) => x.label).join(" / ")} · 共 ${total} 个模型`,
              accent: "#35f0ce",
              icon: "log",
            });
          }
        }}
      />

      {/* 导入用的隐藏 file input */}
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            const text = String(rd.result ?? "");
            /* 先解析看看里面是什么，不直接写 —— 导入一个旧备份会把
               你现在改过的角色覆盖掉，那得让用户先看清楚。 */
            const r = previewBundle(text);
            if (!r.ok) {
              pushToast({
                title: "这个文件读不了",
                desc: r.reason,
                accent: "#ff7a6b",
                icon: "log",
              });
              return;
            }
            setImportPreview({ fileName: f.name, preview: r.preview, text });
          };
          rd.readAsText(f);
          e.target.value = "";
        }}
      />

      <ConsoleDrawer open={consoleOpen} onClose={() => setConsoleOpen(false)} />

      <div
        className="relative z-10 flex h-full flex-col"
        data-boot={bootPhase === "expand" ? "enter" : "boot"}
        style={{ visibility: bootFatal ? "hidden" : "visible" }}
      >
        {/* ═══ 自绘窗口条（Tauri 下可拖动） ═══ */}
        <header
          data-tauri-drag-region
          className="hud-header flex h-9 shrink-0 select-none items-center gap-2 px-4"
        >
          <div data-tauri-drag-region className="flex items-center gap-2">
            <MarkZ size={17} />
            <span className="text-[10.5px] font-medium tracking-[0.14em] text-ink/55">
              {appName}
            </span>
            <span className="font-mono text-[10px] tracking-[0.1em] text-mist/46">
              {appName === DEFAULT_APP_NAME ? "HABITAT" : ""}
            </span>
            {appName === DEFAULT_APP_NAME && (
              <span className="hidden font-mono text-[9.5px] tracking-[0.04em] text-mist/40 xl:inline">
                Systemic Ecosystem for Agents
              </span>
            )}
          </div>

          <div className="mx-2 h-3 w-px bg-white/10" />

          {/*
            造物主模式徽章。

            之前只有那条 2px 顶边，太隐蔽 —— 用户在造物主模式里
            待一整天都不知道。

            这个是明确的、有字的：琥珀底、实心圆点、「造物主模式」五个字。

            不可点。退出要打 sim —— 一步，但要有意识。
          */}
          {isCreator() && (
            <span
              title="退出：控制台输入 sim"
              className="flex min-h-[24px] items-center gap-1.5 rounded-[4px] border border-amber/40 bg-amber/[0.12] px-2 font-mono text-[10px] tracking-[0.08em] text-amber"
            >
              <span className="h-[4px] w-[4px] rounded-full bg-amber shadow-[0_0_6px_rgba(255,196,107,.9)]" />
              造物主模式
            </span>
          )}

          {/* 状态徽章：真反映当前凭据，点一下直接进配置 */}
          <button
            onClick={() => setApiOpen(true)}
            title={apiBadge.hint}
            className={`flex min-h-[24px] items-center gap-1 rounded-[4px] border px-2 py-[3px] font-mono text-[9.5px] tracking-wider transition-colors hover:brightness-125 ${apiBadge.cls}`}
          >
            {apiBadge.live && (
              <span className="h-[3px] w-[3px] rounded-full bg-current" />
            )}
            {apiBadge.text}
          </button>

          <span className="ml-1 hidden items-center gap-1 font-mono text-[9.5px] text-mist/46 md:flex">
            <span className="h-[3px] w-[3px] rounded-full bg-tide/70" />
            {convLabel(conv, personaMap, (id) => getGroup(id)?.name ?? "群聊")}
          </span>

          <div data-tauri-drag-region className="ml-auto flex items-center gap-1">
            {[
              { glyph: "—", label: "最小化", act: () => window.desktop?.minimize() },
              {
                glyph: maximized ? "❐" : "▢",
                label: maximized ? "还原" : "最大化",
                act: () => window.desktop?.toggleMaximize(),
              },
              {
                glyph: "✕",
                label: "关闭",
                act: () => window.desktop?.close(),
                danger: true,
              },
            ].map(({ glyph, label, act, danger }) => (
              <button
                key={label}
                onClick={() => {
                  if (window.desktop) {
                    act();
                  } else {
                    /* 浏览器预览里没有窗口可控制——给个明确的反馈，不是静默失败 */
                    notify({
                      title: `窗口控制 · ${label}`,
                      desc: "浏览器预览里没有窗口，请在桌面端使用",
                      accent: "#8fa9bd",
                    });
                  }
                }}
                className={`grid h-8 w-9 place-items-center rounded-[5px] text-[11px] text-mist/50 transition-all duration-150 active:scale-90 ${
                  danger
                    ? "hover:bg-coral/20 hover:text-coral"
                    : "hover:bg-white/[0.07] hover:text-ink/70"
                }`}
                aria-label={label}
                title={label}
              >
                {glyph}
              </button>
            ))}
          </div>
        </header>

        {/* ═══ 四栏壳体 ═══ */}
        <main className="relative min-h-0 flex-1 px-2.5 pb-2.5">
          <ToastStack toasts={toasts} onDismiss={dismissToast} />

          <div className="glass flex h-full min-h-0 overflow-hidden rounded-[16px]">
            {rails.map((r, i) => (
              <aside
                key={r.key}
                ref={(el) => {
                  railEls.current[i] = el;
                }}
                className={`relative flex min-h-0 flex-col ${r.cls}`}
                data-boot-block={r.key}
              >
                {/* 每栏独立边界：一栏崩了只换那一栏，其余三栏照常 */}
                <PanelBoundary name={PANEL_NAME[r.key] ?? r.key}>{r.node}</PanelBoundary>
              </aside>
            ))}
          </div>
        </main>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        stats={{
          threads: Object.values(threads).reduce((n, l) => n + l.length, 0),
          threadsKB: threadsSizeKB(),
          personas: personas.length,
          groups: groups.length,
          engineLevel: resolveChain(engine).effective,
          engineName: ENGINE_MAP[resolveChain(engine).effective].name,
        }}
        onOpenEngine={() => {
          setSettingsOpen(false);
          setEngineOpen(true);
        }}
        onOpenApi={() => {
          setSettingsOpen(false);
          setApiOpen(true);
        }}
        apiStatus={(() => {
          void credTick; // 依赖它触发重算
          const c = loadCredentials()[0];
          return c ? { label: c.label, baseUrl: c.baseUrl, masked: maskKey(c.apiKey) } : null;
        })()}
        onClearThreads={() =>
          setConfirm({
            title: "清空所有对话记录？",
            desc: "所有会话里的消息都会消失，包括你自己发过的。角色档案和群聊不受影响。",
            confirmText: "清空",
            danger: true,
            onOk: () => {
              clearThreads();
              setThreads(freshThreads());
              pushToast({ title: "对话已清空", desc: "所有消息已删除", accent: "#ff7a6b", icon: "log" });
            },
          })
        }
        onResetPersonas={() =>
          setConfirm({
            title: `重置角色档案为默认的 ${defaultPersonas().length} 个？`,
            desc: "你创建的角色会消失，默认的厂商角色会回来。对话记录保留。",
            confirmText: "重置",
            danger: true,
            onOk: () => {
              replaceAll(defaultPersonas());
              pushToast({ title: "角色已重置", desc: "回到默认厂商角色", accent: "#4e8cff", icon: "log" });
            },
          })
        }
        onClearGroups={() =>
          setConfirm({
            title: "清空所有群聊？",
            desc: "你创建的群会全部消失，只剩默认群。对话记录保留。",
            confirmText: "清空",
            danger: true,
            onOk: () => {
              groups.filter((g) => g.id !== "group").forEach((g) => removeGroup(g.id));
              pushToast({ title: "群聊已清空", desc: "只剩默认群", accent: "#ff7a6b", icon: "log" });
            },
          })
        }
        onExportData={() => {
          downloadBundle();
          pushToast({
            title: "已导出",
            desc: "JSON 文件应该在下载目录里",
            accent: "#35f0ce",
            icon: "log",
          });
        }}
        onImportData={() => importRef.current?.click()}
        onRevealData={
          hasNativePersist()
            ? () => {
                void window.desktop?.revealData();
              }
            : undefined
        }
        dataDirPath={dataDir}
        appName={appName}
        onChangeAppName={(v) => {
          saveAppName(v);
          const next = readAppName();
          setAppName(next);
          pushToast({
            title: "名字已改",
            desc: next === DEFAULT_APP_NAME ? `回到默认「${DEFAULT_APP_NAME}」` : `现在叫「${next}」`,
            accent: "#35f0ce",
            icon: "log",
          });
        }}
        onWipeAll={() =>
          setConfirm({
            title: "删档？",
            /*
             * 这一句是整件事的分量所在。
             *
             * 「全部重置」清的是数据，名字还在 —— 她还是叫你那个名字。
             * 删档清的是「你是谁」。对她来说，那是另一个人。
             */
            desc: "本机所有数据都会消失 —— 对话、角色、记忆、墓碑、凭据，\n以及你自己的名字。\n\n她会重新遇见一个陌生人。那个陌生人不再是你。\n\n这一步没有备份，也撤不回来。",
            confirmText: "删档",
            danger: true,
            requireWord: "删档",
            onOk: () => {
              /*
               * 直接清空整个 localStorage —— 不逐个列 key。
               *
               * 「全部重置」是逐个列的（有它的道理：只清该清的）。
               * 删档不是 —— 它是「把这块地方推平」，
               * 漏掉任何一个 key 都算没删干净。
               */
              try {
                localStorage.clear();
              } catch {
                /* ignore */
              }

              /*
               * 关键：把「空状态」也写进 current.json。
               *
               * 不写的话，下次启动 bootstrapRestore 会把旧数据补回来 ——
               * 用户点了删档，窗口一闪，东西全在。
               */
              const go = () => location.reload();
              if (hasNativePersist()) void autosaveNative().then(go, go);
              else go();
            },
          })
        }
        onResetAll={() =>
          setConfirm({
            title: "全部重置？",
            desc: "对话记录、角色档案、群聊、API 凭据、引导状态全部清除，回到第一次打开。当天的备份文件会保留 —— 需要的话可以从 data 目录重新导入。",
            confirmText: "全部重置",
            danger: true,
            onOk: () => {
              clearThreads();

              const drop = [
                "3w:personas",
                /*
                 * 对话必须清。
                 *
                 * 按钮上写的是「对话 + 角色 + 群聊 + 引导状态」，
                 * 而 threads 原来不在这个清单里 —— 点了重置，
                 * 角色没了，聊天记录还在。
                 */
                "3w:threads",
                "3w:groups",
                /*
                 * 记忆和账本也要清。
                 *
                 * 不清记忆：角色没了但记忆留着，下次建一个同 id 的角色
                 * 会继承一堆不属于她的回忆。
                 * 不清账本：同理会把新角色报成「档案被外部修改过」。
                 */
                "3w:memories",
                "3w:awaken-ledger",
                "3w:persona-seq",
                "3w:graveyard",
                "3w:phantom-seen",
                "3w:events",
                "3w:mode",
                "3w:onboarded",
                "3w:engine",
                "3w:credentials",
                "3w:dynamic-v1",
                "3w:known-models",
                "3w:ctx-window-overrides",
                "3w:usage-daily",
              ];
              try {
                for (const k of drop) localStorage.removeItem(k);
              } catch {
                /* ignore */
              }

              /* 关键一步：把「清空后的状态」也写进 current.json。
                 不做这一步，「全部重置」会被启动时的 bootstrapRestore 原样补回来 ——
                 用户点了重置、窗口一闪，东西全在，看起来像按钮坏了。 */
              const go = () => location.reload();
              if (hasNativePersist()) void autosaveNative().then(go, go);
              else go();
            },
          })
        }
      />

      {/* 导入预览框放在 SettingsPanel **之后**。
          它俩都往 Esc 栈里注册，而 Esc 只关最上层（后注册的算上层）。
          挪到前面就会变成「按 Esc 关掉设置、这个框还挂着」。 */}
      <AnimatePresence>
        {importPreview && (
          <DataImportDialog
            key="import"
            fileName={importPreview.fileName}
            preview={importPreview.preview}
            onCancel={() => setImportPreview(null)}
            onImport={(mode) => {
              const r = importBundle(importPreview.text, mode);
              setImportPreview(null);
              if (r.ok) {
                pushToast({
                  title: "导入完成",
                  desc:
                    r.keys > 0
                      ? `写入 ${r.keys} 项${r.skipped.length ? `，跳过 ${r.skipped.length} 项` : ""}，即将重载`
                      : "没有需要写入的项（本地都已有内容）",
                  accent: "#35f0ce",
                  icon: "log",
                });
                if (r.keys > 0) setTimeout(() => location.reload(), 900);
              } else {
                pushToast({
                  title: "导入失败",
                  desc: r.reason,
                  accent: "#ff7a6b",
                  icon: "log",
                });
              }
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}