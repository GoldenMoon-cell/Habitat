const { app, BrowserWindow, ipcMain, shell, net, protocol, safeStorage, dialog } = require("electron");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");

/**
 * 启动日志。
 *
 * 打包版是 GUI 程序，没有 stdout —— 启动失败的现场只能落文件。
 * 排查完可以删掉这段（或者保留，反正只在 %TEMP% 里写几行）。
 */
const BOOT_LOG = path.join(require("node:os").tmpdir(), "habitat-boot.log");
function boot(msg) {
  try {
    fs.appendFileSync(BOOT_LOG, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
  } catch {
    /* 写不了就算了，不能因为日志把应用搞挂 */
  }
}
try {
  fs.writeFileSync(BOOT_LOG, "");
} catch {}
boot("start pid=" + process.pid + " packaged=" + app.isPackaged);
process.on("uncaughtException", (e) => boot("UNCAUGHT: " + (e && e.stack ? e.stack : e)));
process.on("unhandledRejection", (e) => boot("UNHANDLED: " + (e && e.stack ? e.stack : e)));
boot("resourcesPath=" + process.resourcesPath + " userData=" + app.getPath("userData"));

/** 开发时由 scripts/run-electron.mjs 注入；打包后为空，走 dist/ */
const devUrl = process.env.DESKTOP_DEV_URL || "";

/**
 * 灰阶抗锯齿 —— 等价于 WebView2 的 `--disable-lcd-text`。
 *
 * Windows 默认的 ClearType 是 RGB 子像素渲染，字边缘有红蓝彩边，
 * 在深色背景 + 小字号下最刺眼。灰阶渲染只算亮度，边缘干净。
 */
app.commandLine.appendSwitch("disable-lcd-text");
/*
 * 允许音频在没有任何用户手势时播放。
 *
 * 启动动画一开始就要出声（根系生长的声音），而那时候用户只双击了 exe，
 * 页面里还没有任何点击 —— Chromium 默认会挂起 AudioContext。
 * 这个开关把它放开。
 */
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

/**
 * 需要连 CDP 排查界面时用：设 `DESKTOP_DEBUG_PORT=9222` 再启动。
 *
 * 平时不开 —— 开着等于把整个页面对本机任何进程敞开。
 */
if (process.env.DESKTOP_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.DESKTOP_DEBUG_PORT);
  console.log(`[electron] 调试端口: ${process.env.DESKTOP_DEBUG_PORT}`);
}

/**
 * 生产模式的自定义协议。
 *
 * 为什么要在本地 HTTP 服务之外再加这一层：
 *
 *   之前生产模式起 127.0.0.1:1420 的静态服务，端口被占就退到 1421。
 *   **端口一换，origin 就换了，localStorage 就是另一份** —— 同一台机器上
 *   出现两套数据，而且两边都往同一个 current.json 里写，互相覆盖。
 *   用户看到的现象是「我的角色怎么没了」，其实是被分到另一个 origin 里了。
 *
 *   app://habitat 这个 origin 跟端口、跟 dist 目录、跟打包路径全都无关，
 *   永远不会变。
 *
 * registerSchemesAsPrivileged 必须在 app ready **之前**调用。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true, // 有正常 origin（app://habitat），不是 opaque
      secure: true, // 视为安全上下文：crypto / clipboard / fetch 正常
      supportFetchAPI: true,
      stream: true,
      codeCache: true, // V8 code cache，二次启动快一点
    },
  },
]);

let win = null;

/** app:// 是否注册成功。失败时 createWindow 退到静态服务。 */
let appProtocolReady = false;

/* ═══════════════ 生产模式的本地静态服务 ═══════════════ */

/**
 * 为什么不用 loadFile：
 *
 *   file:// 的 origin 是 "null"，localStorage 的行为各家不一致；
 *   而且 origin 里带了完整路径 —— 换个目录打包就是另一份数据。
 *   用户重新构建一次，角色和对话全丢，看起来像 bug。
 *
 *   起本地 HTTP 服务后 origin 固定成 http://127.0.0.1:PORT，
 *   和 dev server 那边一样稳定。
 */

const DIST = path.join(__dirname, "..", "dist");

/**
 * 端口顺序。
 *
 * 1420 排第一 —— 那是 dev server 的端口。**用同一个端口意味着同一个 origin，
 * 也就是同一份 localStorage**：你在网页里配的 API、改的角色，桌面版能直接看到。
 *
 * 如果 dev server 正开着，会退到 1421（数据独立）—— 那种情况你本来就在开发，
 * 不需要两边共享。
 */
const PREFERRED_PORTS = [1420, 1421, 1422, 1423, 1424];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
};

let staticServer = null;

function serveDist() {
  return http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel === "/") rel = "/index.html";

    const full = path.join(DIST, rel);
    /* 防目录穿越 */
    if (!full.startsWith(DIST)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    fs.readFile(full, (err, data) => {
      if (err) {
        /* SPA fallback：任何未知路径都回 index.html，交给前端路由 */
        fs.readFile(path.join(DIST, "index.html"), (e2, html) => {
          if (e2) {
            res.writeHead(404).end("dist/ 里没有 index.html，先跑 npm run build");
            return;
          }
          res.writeHead(200, { "Content-Type": MIME[".html"] }).end(html);
        });
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" }).end(data);
    });
  });
}

/**
 * 生产模式：app://habitat/ 直接读 dist/。
 *
 * 只在 app ready 之后调用。注册失败由调用方负责回退到静态服务，
 * 这里不做兜底 —— 兜底逻辑散在两处最容易出现「以为有兜底其实没有」。
 */
function handleAppProtocol() {
  protocol.handle("app", async (req) => {
    const { pathname } = new URL(req.url);
    let rel = decodeURIComponent(pathname);
    if (rel === "/" || rel === "") rel = "/index.html";

    const full = path.join(DIST, rel);
    /* 防目录穿越 */
    if (!full.startsWith(DIST)) {
      return new Response("forbidden", { status: 403 });
    }

    try {
      const data = await fs.promises.readFile(full);
      const ext = path.extname(full).toLowerCase();
      return new Response(data, {
        headers: { "content-type": MIME[ext] || "application/octet-stream" },
      });
    } catch {
      /* SPA fallback：任何未知路径都回 index.html，交给前端路由 */
      try {
        const html = await fs.promises.readFile(path.join(DIST, "index.html"));
        return new Response(html, { headers: { "content-type": MIME[".html"] } });
      } catch {
        return new Response("dist/ 里没有 index.html，先跑 npm run build", { status: 404 });
      }
    }
  });

  console.log("[electron] 生产模式协议: app://habitat/");
  console.log(`[electron] dist = ${DIST}`);
}

/** 依次试端口，返回第一个能监听的 */
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= PREFERRED_PORTS.length) {
        reject(new Error("1421-1424 都被占用"));
        return;
      }
      const port = PREFERRED_PORTS[i];
      const srv = serveDist();

      srv.once("error", (e) => {
        if (e.code === "EADDRINUSE") tryPort(i + 1);
        else reject(e);
      });

      srv.listen(port, "127.0.0.1", () => {
        staticServer = srv;
        const url = `http://127.0.0.1:${port}/`;
        console.log(`[electron] 生产模式静态服务: ${url}`);
        console.log(`[electron] dist = ${DIST}`);
        resolve(url);
      });
    };
    tryPort(0);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1520,
    height: 950,
    minWidth: 1120,
    minHeight: 720,
    center: true,
    // 无边框：系统标题栏不画，只用 App.tsx 里那 36px 自绘窗口条
    frame: false,
    // 首帧底色，避免加载瞬间白闪
    backgroundColor: "#03070d",
    show: false,
    title: "生境 · Habitat",
    icon: path.join(__dirname, "..", "src-tauri", "icons", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (devUrl) {
    win.loadURL(devUrl);
  } else if (appProtocolReady) {
    /* 生产模式：origin 恒为 app://habitat —— 跟端口、跟目录都无关。
       不会因为 1420 被占就换个 origin，把数据分到另一份 localStorage 里。 */
    win.loadURL("app://habitat/");
  } else {
    /* app:// 没注册上时的退路。这个 origin 会随端口变，只在必要的时候走。 */
    startStaticServer()
      .then((url) => win.loadURL(url))
      .catch((e) => {
        console.error("[electron] 静态服务起不来：", e);
        win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
      });
  }

  /* 最大化状态要推给渲染进程，按钮图标才能跟着变 */
  const pushState = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("win:state", { maximized: win.isMaximized() });
    }
  };
  win.on("maximize", pushState);
  win.on("unmaximize", pushState);

  /* 外链交给系统浏览器，不在应用里开新窗口 */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  /* 页面加载失败时把原因打出来 —— 否则只能看到一个黑窗口 */
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[electron] 页面加载失败 code=${code} (${desc})`);
    console.error(`[electron] url=${url}`);
    if (!devUrl) {
      console.error("[electron] 生产模式请确认 dist/ 已构建，且 vite.config.ts 里 base 是 './'");
    }
  });

  /* 首帧加载完打一行 origin —— 排查「数据怎么没了」时第一眼看的就是它。
     不同 origin 的 localStorage 是完全独立的，origin 一换数据就「消失」。

     注意：必须在渲染进程里问 location.origin。
     Node 的 new URL("app://...").origin 会返回 "null"，因为 Node 只把
     http/https/ws/wss/ftp/file 当特殊 scheme —— 那是 Node 的限制，
     跟 Chromium 里实际生效的 origin 无关，照它排错会被带偏。 */
  win.webContents.on("did-finish-load", async () => {
    const url = win.webContents.getURL();
    let origin = "?";
    let store = "?";
    try {
      origin = await win.webContents.executeJavaScript("location.origin");
    } catch (e) {
      origin = `读取失败 ${e.message}`;
    }
    try {
      store = await win.webContents.executeJavaScript(
        "(() => { try { localStorage.setItem('__p','1'); const v = localStorage.getItem('__p'); localStorage.removeItem('__p'); return v === '1' ? 'ok' : '异常'; } catch (e) { return 'ERR ' + e.name; } })()"
      );
    } catch (e) {
      store = `探测失败 ${e.message}`;
    }
    console.log(`[electron] url = ${url}`);
    console.log(`[electron] origin = ${origin}`);
    console.log(`[electron] localStorage = ${store}`);
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[electron] 渲染进程崩溃:", details.reason, details.exitCode);
  });

  win.on("closed", () => {
    win = null;
  });
}

/**
 * 单实例锁。
 *
 * 两个窗口各自在内存里持有一份完整状态，又都往同一个 current.json 里写 ——
 * 后保存的会盖掉前一个。用户看到的现象是「我刚改的角色自己变回去了」，
 * 而且极难复现（取决于两个窗口谁最后保存）。
 *
 * 双击两次图标就会触发。所以第二个实例直接退掉，把已有窗口叫到前面。
 */
const gotSingleLock = app.requestSingleInstanceLock();
boot("singleLock=" + gotSingleLock);

if (!gotSingleLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  boot("whenReady fired");
  /* 没抢到锁说明已在退出流程里，不要再开窗口 */
  if (!gotSingleLock) {
    boot("no lock, return");
    return;
  }

  /* 生产模式先注册 app:// 协议，再开窗口 */
  if (!devUrl) {
    try {
      handleAppProtocol();
      appProtocolReady = true;
    } catch (e) {
      boot("app:// register failed: " + (e && e.message));
      console.error("[electron] app:// 注册失败，回退本地静态服务：", e);
      appProtocolReady = false;
    }
  }

  boot("calling createWindow");
  createWindow();
  boot("createWindow returned, windows=" + BrowserWindow.getAllWindows().length);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  boot("window-all-closed");
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
  if (process.platform !== "darwin") app.quit();
});

/* ── 窗口控制 ── */
ipcMain.on("win:minimize", (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.on("win:toggle-maximize", (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});

ipcMain.on("win:close", (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

/* ─────────────── LLM 代理 ─────────────── */

/**
 * 主进程代发 LLM 请求。
 *
 * 为什么不能在前端直接发：
 *   渲染进程是浏览器环境，跨域请求要过 CORS preflight。
 *   OpenAI / Anthropic 这些服务不回 CORS 头，直接从 127.0.0.1:1420 发必被拦。
 *   主进程是 Node，没有同源策略。
 *
 * 整批返回（不在这里做流式回传）：
 *   逐块 IPC 回传要处理消息序号、取消、窗口销毁等一堆边界；
 *   先做能用的，流式等这条链路验证稳定之后再上。
 */
ipcMain.handle("llm:chat", async (_e, req) => {
  const { baseUrl, apiKey, model, messages, temperature, maxTokens } = req || {};
  if (!baseUrl) throw new Error("没有 Base URL");
  if (!model) throw new Error("没有指定模型");

  const base = String(baseUrl).replace(/\/+$/, "");
  const isOllama = /11434/.test(base) || /ollama/i.test(base) || /\/api\/chat$/.test(base);

  /**
   * Anthropic Messages API。
   *
   * 和 OpenAI Chat Completions 差三处：
   *   ① 路径 /v1/messages，不是 /chat/completions
   *   ② 鉴权 x-api-key + anthropic-version，不是 Authorization: Bearer
   *   ③ system 是**顶层字段**，不能放在 messages 里
   *
   * 中转站如果转成 OpenAI 格式也能用；只有直连官方才走这条分支。
   */
  const isAnthropic =
    /anthropic\.com/.test(base) || /\/v1\/messages$/.test(base) || /\/messages$/.test(base);

  const anthropicUrl = /\/messages$/.test(base)
    ? base
    : /\/v1$/.test(base)
      ? `${base}/messages`
      : `${base}/v1/messages`;

  const url = isOllama
    ? /\/api\/chat$/.test(base)
      ? base
      : `${base}/api/chat`
    : isAnthropic
      ? anthropicUrl
      : /\/chat\/completions$/.test(base)
        ? base
        : `${base}/chat/completions`;

  let body;
  let headers;

  if (isOllama) {
    body = { model, messages, stream: false, options: { temperature: temperature ?? 0.8 } };
    headers = { "Content-Type": "application/json" };
  } else if (isAnthropic) {
    /* system 拆出去，剩下的按 user/assistant 交替 */
    const sys = (messages || [])
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const msgs = (messages || []).filter((m) => m.role !== "system");
    body = {
      model,
      max_tokens: maxTokens || 4096,
      temperature: temperature ?? 0.8,
      messages: msgs,
      ...(sys ? { system: sys } : {}),
    };
    headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
    if (apiKey) headers["x-api-key"] = apiKey;
  } else {
    body = { model, messages, stream: false, temperature: temperature ?? 0.8, ...(maxTokens ? { max_tokens: maxTokens } : {}) };
    headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      /* 400 的正文里通常有真实上限，原样带回渲染进程 */
      throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
    }

    const json = await res.json();

    /* Anthropic 的正文是 content 数组，只有 type=text 的块才算 */
    const text = isOllama
      ? (json?.message?.content ?? "")
      : isAnthropic
        ? (json?.content ?? [])
            .filter((b) => b && b.type === "text")
            .map((b) => b.text)
            .join("")
        : (json?.choices?.[0]?.message?.content ?? "");

    /*
     * ── 真实用量 ──
     *
     * 三种协议的字段名不一样，统一成一套：
     *
     *   OpenAI    usage.prompt_tokens / completion_tokens / total_tokens
     *   Anthropic usage.input_tokens  / output_tokens
     *   Ollama    prompt_eval_count   / eval_count
     *
     * 拿不到就返回 undefined —— **不编**。
     */
    let usage;
    if (isOllama) {
      if (typeof json?.prompt_eval_count === "number") {
        usage = {
          promptTokens: json.prompt_eval_count,
          completionTokens: json.eval_count ?? 0,
          totalTokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
        };
      }
    } else if (isAnthropic) {
      if (typeof json?.usage?.input_tokens === "number") {
        usage = {
          promptTokens: json.usage.input_tokens,
          completionTokens: json.usage.output_tokens ?? 0,
          totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
        };
      }
    } else if (typeof json?.usage?.prompt_tokens === "number") {
      usage = {
        promptTokens: json.usage.prompt_tokens,
        completionTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0,
      };
    }

    return { chunks: [String(text)], usage };
  } finally {
    clearTimeout(timer);
  }
});

/* 主进程代发「拉模型列表」 —— 理由同 llm:chat：渲染进程跨域会被拦 */
ipcMain.handle("llm:models", async (_e, req) => {
  const { baseUrl, apiKey } = req || {};
  if (!baseUrl) throw new Error("没有 Base URL");

  const raw = String(baseUrl).trim().replace(/\/+$/, "");
  /* 有人会把完整端点当 baseUrl 填进来 —— 把尾巴削掉再拼 */
  const base = raw.replace(/\/(chat\/)?completions$/, "") || raw;
  const isOllama = /11434/.test(base) || /ollama/i.test(base);
  const isAnthropic = /anthropic\.com/.test(base);

  /**
   * 候选路径。
   *
   * OneAPI / NewAPI / OpenAI / DeepSeek 这些，路径是统一的 `{base}/models`。
   * 所以这里不「猜」—— 只处理用户填的 base 是哪一种：
   *
   *   带 /models          → 原样打（用户填的就是完整端点）
   *   Ollama              → /api/tags
   *   带版本段（/v1 等）  → 拼 /models，**不要再拼一层 /v1**
   *   裸域名              → /v1/models，再兜一个 /models（有些站两个都通）
   *
   * 以前还会试 /api/v1/models、/v1/v1/models 这类，实测全是 404，
   * 而那个 404 会盖掉真实的 401 —— 纯属给自己找麻烦。
   */
  const candidates = isOllama
    ? [`${base}/api/tags`]
    : isAnthropic
      ? /* Anthropic 的模型列表在 /v1/models，鉴权方式也不同 */
        [`${base}/v1/models`]
      : /\/models$/.test(base)
        ? [base]
        : /\/v\d+[a-z0-9]*$/i.test(base)
          ? [`${base}/models`]
          : [`${base}/v1/models`, `${base}/models`];

  const headers = {};
  if (isAnthropic) {
    if (apiKey) headers["x-api-key"] = String(apiKey).trim();
    headers["anthropic-version"] = "2023-06-01";
  } else if (!isOllama && apiKey) {
    headers.Authorization = `Bearer ${String(apiKey).trim()}`;
  }

  const tried = [];
  /** 认证失败要单独记 —— 它比 404 有信息量得多，不能被后面的错误盖掉 */
  let authErr = null;

  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      const text = await res.text();
      tried.push(`${url} → ${res.status}`);

      /* 401 / 403 说明「路径是通的，Key 不对」。
         记下来继续试别的路径（万一这个站只认另一个），
         但最后报错时优先用它。 */
      if (res.status === 401 || res.status === 403) {
        authErr = `${res.status} ${text.slice(0, 200).trim()}`;
        continue;
      }

      if (!res.ok) continue;
      return { url, body: text };
    } catch (e) {
      tried.push(`${url} → ${e && e.message ? e.message : e}`);
    } finally {
      clearTimeout(timer);
    }
  }

  if (authErr) throw new Error(`Key 被拒绝：${authErr}`);
  throw new Error(`都没连上：${tried.join("；")}`);
});

/* ═══════════════ 数据留底 ═══════════════ */

/**
 * 为什么要有这个：
 *
 *   localStorage 会消失 —— 换入口、清缓存、file:// 换 http://、配额满。
 *   用户的角色档案和对话是花时间弄出来的，不能只活在内存/浏览器里。
 *
 *   这里做两件事：
 *     current.json          每次改动后覆盖写（最新状态）
 *     backup-YYYY-MM-DD.json 每天一份（历史留档）
 */
const DATA_DIR = path.join(app.getPath("userData"), "data");
const BACKUP_KEEP_DAYS = 14;

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("[persist] 建目录失败:", e);
  }
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 删掉太旧的备份 */
function pruneBackups() {
  try {
    const files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while (files.length > BACKUP_KEEP_DAYS) {
      const old = files.shift();
      fs.unlinkSync(path.join(DATA_DIR, old));
    }
  } catch (e) {
    console.error("[persist] 清理备份失败:", e);
  }
}

ipcMain.handle("data:persist", async (_e, bundle) => {
  ensureDataDir();
  const text = JSON.stringify(bundle, null, 2);

  /* current.json 每次覆盖 */
  fs.writeFileSync(path.join(DATA_DIR, "current.json"), text, "utf8");

  /* 当天的备份不存在才写 —— 同一天多次保存只保留早上那份，避免越写越多 */
  const bp = path.join(DATA_DIR, `backup-${today()}.json`);
  if (!fs.existsSync(bp)) {
    fs.writeFileSync(bp, text, "utf8");
    pruneBackups();
  }

  return { ok: true, dir: DATA_DIR };
});

ipcMain.handle("data:read", async () => {
  ensureDataDir();
  const cur = path.join(DATA_DIR, "current.json");
  if (!fs.existsSync(cur)) return null;
  try {
    return JSON.parse(fs.readFileSync(cur, "utf8"));
  } catch {
    return null;
  }
});

ipcMain.handle("data:dir", async () => {
  ensureDataDir();
  return DATA_DIR;
});

/** 打开数据目录（给用户看文件在哪） */
ipcMain.handle("data:reveal", async () => {
  ensureDataDir();
  shell.openPath(DATA_DIR);
  return DATA_DIR;
});

/* ═══════════════ 语音合成 ═══════════════ */

/**
 * 走 OpenAI 的 `/v1/audio/speech` 协议。
 *
 * ── 为什么不给每家单独写适配 ──
 *
 * 那个格式是事实标准 —— 官方、中转站、自建网关几乎都兼容。
 * 用户填个 Base URL 就能用自己想用的服务商。
 *
 * **软件不内置任何 TTS 服务商。** 只提供这个插口。
 *
 * ── 为什么在主进程 ──
 *
 * CORS。渲染进程直接 POST 会被浏览器拦。
 * 和 `llm:chat` 同一个理由。
 *
 * ── 返回什么 ──
 *
 * base64 的音频字节。渲染进程自己造 Blob 来播 ——
 * 不走临时文件，免得留垃圾。
 */
ipcMain.handle("tts:speak", async (_e, req) => {
  const { baseUrl, apiKey, model, voice, text, format } = req || {};
  if (!baseUrl) throw new Error("没有 Base URL");
  if (!apiKey) throw new Error("没有 API Key");
  if (!text || !String(text).trim()) throw new Error("没有要念的内容");

  const base = String(baseUrl).replace(/\/+$/, "");
  /* 允许用户直接把完整路径填进 Base URL */
  const url = /\/audio\/speech$/.test(base)
    ? base
    : `${base}/audio/speech`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "tts-1",
      voice: voice || "alloy",
      input: String(text).slice(0, 4000),
      response_format: format || "mp3",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `TTS ${res.status} ${res.statusText}${body ? " — " + body.slice(0, 200) : ""}`
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    ok: true,
    /* base64 是一层膨胀（+33%），但省掉了临时文件和清理逻辑 */
    audio: buf.toString("base64"),
    mime: format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : "audio/mpeg",
    bytes: buf.length,
  };
});

/* ═══════════════ 系统指标 ═══════════════ */

/**
 * CPU 占比。
 *
 * `os.loadavg()` 在 Windows 上恒为 0，不能用。
 * 只能算两次 `os.cpus()` 的 times 差分 —— 所以要有上一次的样本。
 */
let prevTimes = os.cpus().map((c) => ({ ...c.times }));

function cpuPercent() {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < now.length; i++) {
    const t = now[i].times;
    const p = prevTimes[i] || t;
    const di = t.idle - p.idle;
    const dt =
      t.user + t.nice + t.sys + t.idle + t.irq -
      (p.user + p.nice + p.sys + p.idle + p.irq);
    idle += di;
    total += dt;
  }
  prevTimes = now.map((c) => ({ ...c.times }));
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
}

/**
 * 系统指标。
 *
 * **每秒被问一次** —— 渲染进程自己 setInterval，主进程不推送。
 *
 * 为什么不做成主进程主动推：那要管订阅/退订/窗口销毁，
 * 而这里只在一个地方用，轮询一次的成本可以忽略。
 */
ipcMain.handle("sys:stats", async () => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    cpu: cpuPercent(),
    /* 位 / 字节 —— 用 GB 让调用方自己算，别在这里格式化 */
    mem: {
      total,
      used,
      percent: total > 0 ? Math.round((used / total) * 100) : 0,
    },
    uptime: os.uptime(),
    /*
     * 这个进程自己占多少 —— 用户真正想知道的可能是这个，
     * 而不是整机的。两个都给。
     */
    self: {
      rss: process.memoryUsage().rss,
      cpu: process.cpuUsage(),
    },
  };
});

/* ═══════════════ 凭据加密 ═══════════════ */

/**
 * 用操作系统的密钥设施加密 API Key。
 *
 * 各平台底层：
 *   Windows  DPAPI（CryptProtectData，从当前用户登录凭据派生密钥）
 *   macOS    Keychain（独立加密存储，T2/Apple Silicon 走 Secure Enclave）
 *   Linux    libsecret（gnome-keyring / KWallet）
 *
 * **它能防什么**：文件被拷走、备份传到网上、别的系统账户登录后翻 —— 都是乱码。
 * **它防不了什么**：同一用户下的其他程序（DPAPI 解密不要额外凭据），
 *                  以及能远程控制你桌面的人。这是所有「免密加密」的共同边界。
 *
 * 换机器 / 重装系统后解不开 —— 这是设计使然，不是 bug。
 * 所以导出备份时要**先解密**，否则那份 JSON 换台电脑就是废的。
 */
/* ═══════════════ 检查更新 ═══════════════ */

/*
 * ── 只查，不自动装 ──
 *
 * 自动更新（electron-updater）需要：代码签名证书、latest.yml、
 * 差分包、后台静默下载 —— 那是一整套基建。
 *
 * 这个软件现在要的是**"有新版本了吗"**，不是"替我装好"。
 * 所以：查 GitHub Releases → 告诉你版本号 → 你自己点链接去下。
 *
 * ── 两个通道 ──
 *
 * stable  /releases/latest   GitHub 自动排除 prerelease
 * beta    /releases          取第一个（含 prerelease）
 *
 * 仓库还没建好之前，这里会失败 —— 失败也要说人话，不能是一串 HTTP 报错。
 */

/** ←←← 发布前把这里改成你的仓库（owner/repo） */
const UPDATE_REPO = "GoldenMoon-cell/Habitat";

/** 版本号比较：支持 1.2.3 / v1.2.3 / 1.2.3-beta.1 */
function cmpVersion(a, b) {
  const norm = (s) =>
    String(s || "")
      .trim()
      .replace(/^v/i, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
  const A = norm(a);
  const B = norm(b);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const x = A[i] ?? 0;
    const y = B[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

ipcMain.handle("update:check", async (_e, req) => {
  const channel = req && req.channel === "beta" ? "beta" : "stable";
  const current = app.getVersion();

  const fail = (why) => ({
    ok: false,
    channel,
    current,
    reason: why,
  });

  if (!UPDATE_REPO || UPDATE_REPO.includes("REPLACE_ME")) {
    return fail("还没配置仓库地址（electron/main.cjs 里的 UPDATE_REPO）");
  }

  const url =
    channel === "beta"
      ? `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=5`
      : `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

  /*
   * ── 为什么用 net.fetch 而不是全局 fetch ──
   *
   * Node 自带的 fetch 用 Node 的 CA 包。在装了企业代理 / 安全软件的机器上，
   * TLS 会被中间人替换证书 → Node 报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，
   * 而系统里其他程序（浏览器、PowerShell）都正常。
   *
   * Electron 的 `net` 走 Chromium 网络栈 —— **用操作系统的证书库**，
   * 还顺带支持系统代理设置。这才是桌面应用该用的。
   */
  let data;
  try {
    const doFetch = net && typeof net.fetch === "function" ? net.fetch : fetch;
    const res = await doFetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Habitat-Updater",
      },
    });

    if (res.status === 404) return fail("仓库还没有发布任何版本");
    if (res.status === 403) return fail("GitHub 限流了，过一会儿再试");
    if (!res.ok) return fail(`GitHub 返回 ${res.status}`);

    data = await res.json();
  } catch (err) {
    /* 断网、DNS、证书 —— 对用户都是"连不上"，不必区分 */
    return fail(`连不上 GitHub（${String(err && err.message).slice(0, 60)}）`);
  }

  const rel = Array.isArray(data) ? data[0] : data;
  if (!rel || !rel.tag_name) return fail("没有找到可用的版本");

  return {
    ok: true,
    channel,
    current,
    latest: String(rel.tag_name).replace(/^v/i, ""),
    isNewer: cmpVersion(rel.tag_name, current) > 0,
    url: rel.html_url || "",
    name: rel.name || rel.tag_name || "",
    prerelease: !!rel.prerelease,
    publishedAt: rel.published_at || "",
    notes: String(rel.body || "").slice(0, 800),
  };
});

/** 用系统浏览器打开 release 页面 —— 不在应用内嵌一个浏览器 */
ipcMain.handle("update:open", async (_e, target) => {
  const u = String(target || "");
  if (!/^https:\/\/github\.com\//.test(u)) return false;
  await shell.openExternal(u);
  return true;
});

/* ── 数据导出 / 导入 ──
 *
 * 渲染进程只负责「组装/解析 JSON」，真正的落盘和选路径在这里做 ——
 * 因为浏览器沙箱里拿不到任意路径的写权限。
 */
ipcMain.handle("data:export", async (_e, payload) => {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "导出生境数据",
      defaultPath: `habitat-${payload?.scope ?? "data"}-${stamp}.json`,
      filters: [{ name: "生境数据", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const json = JSON.stringify(payload.bundle, null, 2);
    fs.writeFileSync(filePath, json, "utf8");
    return { ok: true, filePath, bytes: Buffer.byteLength(json, "utf8") };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});

ipcMain.handle("data:import", async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "导入生境数据",
      properties: ["openFile"],
      filters: [{ name: "生境数据", extensions: ["json"] }],
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };

    const raw = fs.readFileSync(filePaths[0], "utf8");
    return { ok: true, filePath: filePaths[0], raw, bytes: Buffer.byteLength(raw, "utf8") };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});

ipcMain.handle("crypto:available", () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
});

ipcMain.handle("crypto:encrypt", (_e, plain) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const s = String(plain ?? "");
    if (!s) return null;
    return safeStorage.encryptString(s).toString("base64");
  } catch (e) {
    console.error("[crypto] 加密失败:", e?.message ?? e);
    return null;
  }
});

ipcMain.handle("crypto:decrypt", (_e, b64) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = Buffer.from(String(b64 ?? ""), "base64");
    if (buf.length === 0) return null;
    return safeStorage.decryptString(buf);
  } catch (e) {
    /* 换机器、换系统账户、密钥被系统重置 —— 都会走到这里 */
    console.error("[crypto] 解密失败:", e?.message ?? e);
    return null;
  }
});