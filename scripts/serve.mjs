import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 极简静态服务器。只用 Node 内置模块，不引入任何依赖。
 *
 * 为什么不用 `vite preview`：那个会占着终端、多一层进程。
 * 这个脚本启动即用，Ctrl+C 就停。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT ?? 1420);
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

/** 防目录穿越：把 URL 路径限制在 ROOT 内 */
function safeJoin(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const full = join(ROOT, clean);
  return full.startsWith(ROOT) ? full : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";

  let file = safeJoin(pathname);
  if (!file) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  } catch {
    /* 不存在就走下面的 404 */
  }

  try {
    const buf = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      // 开发期禁用缓存，改完刷新就生效
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  } catch {
    // 单页应用：找不到的路径一律回 index.html
    try {
      const buf = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
      res.end(buf);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("dist/ 里没有 index.html —— 先跑一次 npm run build");
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`三鲸空间  ·  http://${HOST}:${PORT}/`);
  console.log("浏览器里点地址栏右侧的「安装」图标，可以装成独立窗口");
  console.log("Ctrl+C 停止");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。可能是之前的实例还在跑。`);
    console.error(`换一个端口：$env:PORT=1421; node scripts/serve.mjs`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
