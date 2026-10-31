/**
 * 语音合成。
 *
 * ── 三个档位，从"谁都能用"到"要好听的" ──
 *
 * **① `native`** —— 系统自带（`speechSynthesis`）
 *   零配置、免费、离线。**声音机械，但立刻能听。**
 *   这一档存在的意义：**不配任何东西也能听见她说话。**
 *
 * **② `cloud`** —— OpenAI 兼容的 `/v1/audio/speech`
 *   要一个支持 TTS 的地址 + Key。
 *   来源可以是官方、中转站、或者自己搭的网关。
 *
 * **③ 大厂原生** —— 还没做。要的话一家一套签名。
 *
 * ── 这个软件不内置任何 TTS 服务商 ──
 *
 * 但**它内置系统那个** —— 因为那不是"服务商"，
 * 是操作系统本来就有的东西。
 *
 * ── 和「音效」是两件事 ──
 *
 * `sound.ts` 里 24 个函数是**提示音**（叮、咚、下沉），
 * 没有内容，只有情绪方向。
 *
 * 这里是**说话** —— 有内容。
 * 两个同时响会打架，所以播语音时要压掉 `playReceive`。
 */

const KEY = "3w:tts";

export type TtsMode = "off" | "native" | "cloud";

export interface TtsConfig {
  mode: TtsMode;
  /** cloud 模式用：例 https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  /** cloud 模式用：例 tts-1 */
  model: string;
  /** cloud 模式的默认音色 */
  voice?: string;
  /** native 模式的默认音色（系统音色名的一部分，模糊匹配） */
  nativeVoice?: string;
  /** native 模式的语速 0.1–10，默认 1 */
  rate?: number;
  format?: "mp3" | "wav" | "opus";
}

const EMPTY: TtsConfig = {
  mode: "off",
  baseUrl: "",
  apiKey: "",
  model: "tts-1",
  voice: "alloy",
  nativeVoice: "",
  rate: 1,
  format: "mp3",
};

function read(): TtsConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw);
    /* 老数据只有 `on` 布尔 —— 迁到 mode */
    const mode: TtsMode =
      p.mode === "native" || p.mode === "cloud"
        ? p.mode
        : p.on
          ? "cloud"
          : "off";
    return {
      mode,
      baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : "",
      apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
      model: typeof p.model === "string" && p.model ? p.model : "tts-1",
      voice: typeof p.voice === "string" ? p.voice : "alloy",
      nativeVoice: typeof p.nativeVoice === "string" ? p.nativeVoice : "",
      rate: typeof p.rate === "number" && p.rate > 0 ? p.rate : 1,
      format: p.format === "wav" || p.format === "opus" ? p.format : "mp3",
    };
  } catch {
    return EMPTY;
  }
}

function write(c: TtsConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function readTts(): TtsConfig {
  return read();
}

export function saveTts(patch: Partial<TtsConfig>): TtsConfig {
  const next = { ...read(), ...patch };
  write(next);
  return next;
}

/**
 * 能不能念。
 *
 * **`native` 永远能** —— 那不需要任何配置。
 *
 * `cloud` 要 URL + Key。
 */
export function ttsReady(): boolean {
  const c = read();
  if (c.mode === "native") return nativeAvailable();
  if (c.mode === "cloud") return !!c.baseUrl.trim() && !!c.apiKey.trim();
  return false;
}

/* ══════════════════════════════════════════
   ① 系统自带
   ══════════════════════════════════════════ */

function nativeAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

/**
 * 列出系统音色。
 *
 * **要等 `voiceschanged`** —— 第一次调 `getVoices()` 通常是空的，
 * 浏览器要异步加载那份列表。
 */
export function nativeVoices(): SpeechSynthesisVoice[] {
  if (!nativeAvailable()) return [];
  return window.speechSynthesis.getVoices();
}

/** 订阅音色列表就绪 */
export function onNativeVoices(fn: () => void): () => void {
  if (!nativeAvailable()) return () => {};
  const h = () => fn();
  window.speechSynthesis.addEventListener("voiceschanged", h);
  /* 已经加载好了就立刻回调一次 */
  if (window.speechSynthesis.getVoices().length) fn();
  return () => window.speechSynthesis.removeEventListener("voiceschanged", h);
}

/**
 * 把 `Persona.voice` 解析成一个系统音色。
 *
 * 两种模式共用同一个字段，但含义不同：
 *
 *   cloud  → 直接传给服务商（`alloy`）
 *   native → **模糊匹配**系统音色名（`Xiaoxiao` 命中
 *            `Microsoft Xiaoxiao Online (Natural) - Chinese`）
 *
 * 匹配不上就返回 `undefined` —— 那就用系统默认。
 */
export function matchNativeVoice(name?: string): SpeechSynthesisVoice | undefined {
  if (!name?.trim()) return undefined;
  const q = name.trim().toLowerCase();
  const vs = nativeVoices();
  /* 先找完全相等的 */
  const exact = vs.find((v) => v.name.toLowerCase() === q);
  if (exact) return exact;
  /* 再找包含的 —— 取最短的那个，避免"Chinese"命中一堆 */
  const partial = vs
    .filter((v) => v.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.length - b.name.length)[0];
  return partial;
}

/* ══════════════════════════════════════════
   播放
   ══════════════════════════════════════════ */

/*
 * 当前正在播的那个。
 *
 * 换一条时要停掉上一条 —— 否则两条叠在一起念，什么都听不清。
 */
let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let nativeBusy = false;

function stopCurrent() {
  if (current) {
    try {
      current.pause();
    } catch {
      /* ignore */
    }
    current.src = "";
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if (nativeAvailable() && nativeBusy) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    nativeBusy = false;
  }
}

/** 停掉当前语音（切会话、关面板时用） */
export function stopSpeaking() {
  stopCurrent();
}

/**
 * 念一句话。
 *
 * `voice` 是角色自己的音色 —— 两种模式各自解释它。
 *
 * 返回是否真的播了。没配就返回 false，调用方退回提示音。
 */
export async function speak(
  text: string,
  voice?: string,
  onEnd?: () => void
): Promise<boolean> {
  const clean = String(text ?? "").trim();
  if (!clean) return false;

  const c = read();

  /* ── ① 系统自带 ── */
  if (c.mode === "native") {
    if (!nativeAvailable()) return false;
    try {
      stopCurrent();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "zh-CN";
      u.rate = Math.max(0.1, Math.min(10, c.rate ?? 1));
      /* pitch 不暴露 —— 那更容易调出"诡异"的效果 */
      const v = matchNativeVoice(voice || c.nativeVoice);
      if (v) u.voice = v;
      /* 念完把忙标清掉 */
      u.onend = () => {
        nativeBusy = false;
        onEnd?.();
      };
      u.onerror = () => {
        nativeBusy = false;
        onEnd?.();
      };
      nativeBusy = true;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {
      console.warn("[tts:native]", e);
      nativeBusy = false;
      return false;
    }
  }

  /* ── ② 云端 ── */
  if (c.mode !== "cloud") return false;
  if (!c.baseUrl.trim() || !c.apiKey.trim()) return false;

  const api = window.desktop;
  if (!api?.ttsSpeak) return false;

  try {
    const r = await api.ttsSpeak({
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      model: c.model,
      voice: voice?.trim() || c.voice || "alloy",
      text: clean,
      format: c.format,
    });
    if (!r?.ok || !r.audio) return false;

    /* base64 → Blob。不用 atob 直接喂 Audio，那样会得到乱码 */
    const bin = atob(r.audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: r.mime || "audio/mpeg" });

    stopCurrent();
    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    current = audio;

    audio.onended = () => {
      stopCurrent();
      onEnd?.();
    };
    audio.onerror = () => {
      stopCurrent();
      onEnd?.();
    };

    await audio.play();
    return true;
  } catch (e) {
    /* 念不出来不该让消息发不出去 —— 静默退回去 */
    console.warn("[tts:cloud]", e);
    stopCurrent();
    return false;
  }
}

/**
 * 试听。
 *
 * 设置面板里那个按钮用 —— 走和 `speak` 同一条路，
 * 但**不检查开关**：用户可能还没打开就想先听一耳朵。
 */
export async function preview(
  text: string,
  voice?: string
): Promise<{ ok: boolean; error?: string }> {
  const c = read();

  if (c.mode === "native" || c.mode === "off") {
    if (!nativeAvailable()) return { ok: false, error: "这个环境不支持系统语音" };
    try {
      stopCurrent();
      const u = new SpeechSynthesisUtterance(text || "你好，我在。");
      u.lang = "zh-CN";
      u.rate = Math.max(0.1, Math.min(10, c.rate ?? 1));
      const v = matchNativeVoice(voice || c.nativeVoice);
      if (v) u.voice = v;
      nativeBusy = true;
      u.onend = () => {
        nativeBusy = false;
      };
      u.onerror = () => {
        nativeBusy = false;
      };
      window.speechSynthesis.speak(u);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /* cloud */
  if (!c.baseUrl.trim()) return { ok: false, error: "没填 Base URL" };
  if (!c.apiKey.trim()) return { ok: false, error: "没填 API Key" };

  const api = window.desktop;
  if (!api?.ttsSpeak) return { ok: false, error: "这个环境没有主进程" };

  try {
    const r = await api.ttsSpeak({
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      model: c.model,
      voice: voice?.trim() || c.voice || "alloy",
      text: text || "你好，我在。",
      format: c.format,
    });
    if (!r?.ok || !r.audio) return { ok: false, error: "没拿到音频" };

    const bin = atob(r.audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: r.mime || "audio/mpeg" });

    stopCurrent();
    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    current = audio;
    audio.onended = () => stopCurrent();
    await audio.play();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 从回复里摘出「能念的那部分」。
 *
 * 不该念的东西：
 *   · 系统条（`【...】`）
 *   · 括号里的动作描写
 *   · markdown 标记
 *   · 代码块
 *
 * 留着：正文和对话。
 */
export function speakable(raw: string): string {
  let s = String(raw ?? "");

  /* 代码块整段扔掉 */
  s = s.replace(/```[\s\S]*?```/g, "");
  /* 行内代码去掉反引号，留内容 */
  s = s.replace(/`([^`]*)`/g, "$1");
  /* 系统条 */
  s = s.replace(/【[^】]*】/g, "");
  /* 括号里的动作描写：全角半角都算 */
  s = s.replace(/（[^）]*）/g, "");
  s = s.replace(/\([^)]*\)/g, "");
  /* markdown 标记 */
  s = s.replace(/[*_~#>|]/g, "");

  return s.replace(/\s+/g, " ").trim();
}
