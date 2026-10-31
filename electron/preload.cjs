const { contextBridge, ipcRenderer } = require("electron");

/**
 * 只暴露三件事：最小化、最大化切换、关闭。
 * 渲染进程拿不到 require、拿不到 ipcRenderer 本体，只能调这三个通道。
 */
contextBridge.exposeInMainWorld("desktop", {
  minimize: () => ipcRenderer.send("win:minimize"),
  toggleMaximize: () => ipcRenderer.send("win:toggle-maximize"),
  close: () => ipcRenderer.send("win:close"),

  /** 主进程代发 LLM 请求（绕开浏览器 CORS）。整批返回。 */
  llmChat: (req) => ipcRenderer.invoke("llm:chat", req),
  llmModels: (req) => ipcRenderer.invoke("llm:models", req),

  /** 数据留底：写 current.json + 当天 backup */
  persist: (bundle) => ipcRenderer.invoke("data:persist", bundle),
  /** 读回上次留底 */
  readPersisted: () => ipcRenderer.invoke("data:read"),
  /** 数据目录路径 */
  dataDir: () => ipcRenderer.invoke("data:dir"),

  /** 系统指标（CPU / 内存）—— 左栏那块之前是 Math.random() */
  sysStats: () => ipcRenderer.invoke("sys:stats"),

  /**
   * 语音合成。
   *
   * 走 OpenAI `/v1/audio/speech` 格式 —— 用户自己填服务商。
   * 返回 base64 音频，渲染进程造 Blob 来播。
   */
  ttsSpeak: (req) => ipcRenderer.invoke("tts:speak", req),
  /** 在资源管理器里打开数据目录 */
  revealData: () => ipcRenderer.invoke("data:reveal"),

  /** 把一组数据存成 .json 文件（主进程弹保存对话框） */
  exportData: (payload) => ipcRenderer.invoke("data:export", payload),
  /** 选一个 .json 文件读回文本（主进程弹打开对话框） */
  importData: () => ipcRenderer.invoke("data:import"),

  /**
   * 凭据加密（OS 级：Windows DPAPI / macOS Keychain / Linux libsecret）。
   * 只在主进程能调 —— 渲染进程拿到的永远是「已加密的 base64」或 null。
   */
  cryptoAvailable: () => ipcRenderer.invoke("crypto:available"),
  cryptoEncrypt: (plain) => ipcRenderer.invoke("crypto:encrypt", plain),
  cryptoDecrypt: (b64) => ipcRenderer.invoke("crypto:decrypt", b64),

  /**
   * 检查更新。
   *
   * 只查不装 —— 返回最新版本号和 release 页面地址，用户自己去下。
   * 自动下载安装是另一套基建（代码签名 + latest.yml + 差分包）。
   */
  updateCheck: (req) => ipcRenderer.invoke("update:check", req),
  /** 用系统浏览器打开 release 页面 */
  updateOpen: (url) => ipcRenderer.invoke("update:open", url),

  /** 订阅最大化状态；返回取消订阅函数 */
  onState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on("win:state", handler);
    return () => ipcRenderer.off("win:state", handler);
  },
});
