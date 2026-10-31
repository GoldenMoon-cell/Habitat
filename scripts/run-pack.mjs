#!/usr/bin/env node
/**
 * 打包。
 *
 * 把「卡住」的三个坑一次性填掉：
 *
 *   ① Electron 二进制下载失败（证书/网络）
 *      → 先查本地缓存，有就直接解压，不联网
 *   ② app-builder-bin 缺失（它是 electron-builder 的二进制核心，189 MB）
 *      → 自动补装
 *   ③ winCodeSign / Electron 从 GitHub 下不动
 *      → 走 npmmirror 镜像。实测从「卡 8 分钟」变成「75 秒」
 *
 * 用法：npm run pack
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
process.chdir(ROOT);

const isWin = process.platform === "win32";
const NPM = isWin ? "npm.cmd" : "npm";
const NPX = isWin ? "npx.cmd" : "npx";

const log = (s) => console.log(`\n▸ ${s}`);
const ok = (s) => console.log(`  ✓ ${s}`);
const warn = (s) => console.log(`  ! ${s}`);

/* ─────────────── 工具 ─────────────── */

function findFile(dir, name, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) {
      const r = findFile(p, name, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (isWin) {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`unzip -o "${zip}" -d "${dest}"`, { stdio: "inherit" });
  }
}

/* ─────────────── ① Electron 二进制 ─────────────── */

function ensureElectron(env) {
  const bin = path.join(ROOT, "node_modules", "electron", "dist", isWin ? "electron.exe" : "electron");
  if (fs.existsSync(bin)) {
    ok("Electron 二进制就位");
    return;
  }

  warn("Electron 二进制缺失");

  const pkgPath = path.join(ROOT, "node_modules", "electron", "package.json");
  if (!fs.existsSync(pkgPath)) {
    warn("electron 包本身没装，先补依赖");
    execSync(`${NPM} install --no-audit --no-fund`, { stdio: "inherit", env });
  }

  const ver = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  const want = `electron-v${ver}-win32-x64.zip`;
  const cacheRoot = path.join(os.homedir(), "AppData", "Local", "electron", "Cache");

  const hit = findFile(cacheRoot, want);
  if (!hit) {
    throw new Error(
      `本地缓存里找不到 ${want}\n\n` +
        `  缓存目录: ${cacheRoot}\n\n` +
        `  两条路：\n` +
        `   · 手动把该 zip 放进上面的缓存目录，再跑一次\n` +
        `    · 或者临时去掉 ELECTRON_SKIP_BINARY_DOWNLOAD，让 npm 自己下（需要能访问外网）`
    );
  }

  ok(`缓存命中 ${path.basename(hit)} (${(fs.statSync(hit).size / 1024 / 1024).toFixed(0)} MB)`);
  unzip(hit, path.join(ROOT, "node_modules", "electron", "dist"));
  fs.writeFileSync(path.join(ROOT, "node_modules", "electron", "path.txt"), "electron.exe");
  ok("已解压到 node_modules/electron/dist");
}

/* ─────────────── ② app-builder-bin ─────────────── */

function ensureAppBuilder(env) {
  const p = path.join(ROOT, "node_modules", "app-builder-bin");
  const looksOk = fs.existsSync(p) && fs.readdirSync(p).length > 3;

  if (looksOk) {
    ok("app-builder-bin 就位");
    return;
  }

  warn("app-builder-bin 缺失（electron-builder 的二进制核心，约 189 MB）");
  execSync(`${NPM} install app-builder-bin --no-save --no-audit --no-fund`, { stdio: "inherit", env });
  ok("已补装");
}

/* ─────────────── 主流程 ─────────────── */

const env = {
  ...process.env,
  /* 别让 npm 阶段去下 Electron 二进制 —— 我们要么已有、要么自己从缓存解压 */
  ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
  /* 国内镜像。GitHub 那条路在这台机器上会卡十分钟以上。 */
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??
    "https://npmmirror.com/mirrors/electron-builder-binaries/",
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? "https://npmmirror.com/mirrors/electron/",
};

console.log("=== Habitat 打包 ===\n");
console.log(`  镜像: ${env.ELECTRON_BUILDER_BINARIES_MIRROR}`);

log("环境自检");
ensureElectron(env);
ensureAppBuilder(env);

log("编译（tsc + vite）");
execSync(`${NPM} run build`, { stdio: "inherit", env });

log("打包（electron-builder）");
execSync(`${NPX} electron-builder --win`, { stdio: "inherit", env });

log("产物");

/* ── 重命名：绕开 Windows 图标缓存 ──
 *
 * Windows 按「完整路径」缓存文件图标。打包若总是写同一个路径，
 * 换了图标资源管理器也不刷新 —— 表现为「挪到桌面是新图标，挪回来是旧图标」。
 *
 * 给产物加时间戳后缀，路径每次都不同，缓存就不会命中。
 * 旧文件（同版本号、无时间戳的）顺手删掉，免得你分不清哪个是最新的。
 */
const relDir = path.join(ROOT, "release");
if (fs.existsSync(relDir)) {
  const stamp = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  })();

  for (const name of fs.readdirSync(relDir)) {
    const abs = path.join(relDir, name);
    if (!fs.statSync(abs).isFile()) continue;
    if (!name.endsWith(".exe")) continue;
    if (name.includes("-p")) continue; /* 已经加过后缀的跳过 */

    const base = name.replace(/\.exe$/i, "");
    const next = `${base}-p${stamp}.exe`;

    /* 同版本号的旧产物（无后缀）直接删，避免混淆 */
    fs.renameSync(abs, path.join(relDir, next));
    console.log(`  ✓ ${name} → ${next}`);
  }
}

const rel = path.join(ROOT, "release");
if (fs.existsSync(rel)) {
  let any = false;
  for (const f of fs.readdirSync(rel)) {
    const p = path.join(rel, f);
    if (fs.statSync(p).isFile() && f.endsWith(".exe")) {
      console.log(`  ${f}  ${(fs.statSync(p).size / 1024 / 1024).toFixed(1)} MB`);
      any = true;
    }
  }
  if (!any) console.log("  （release 里没有 exe，看上面日志）");
} else {
  console.log("  release/ 不存在");
}

console.log("\n=== 完成 ===");
