/**
 * tauri CLI 包装器
 *
 * 背景：这台机器上的 Rust 装在项目内的 `.toolchain` 里（用户目录和 TEMP 被 ACL
 * 写保护，装不进去），所以 `npm run tauri dev` 默认找不到 `cargo`，会报
 * "failed to run 'cargo metadata': program not found"。
 *
 * 这里在启动 CLI 之前把 CARGO_HOME / RUSTUP_HOME / PATH 指过去。
 * `cargo` 还必须能找到 RUSTUP_HOME，否则它会去 %USERPROFILE%\.rustup 建目录
 * 并被拒绝 —— 这也是为什么只加 PATH 不够。
 *
 * 两个 Windows 上的坑（都踩过）：
 *  1. 环境变量名大小写。Windows 上实际键名是 `Path` 不是 `PATH`，
 *     直接赋值 `env.PATH` 会造出第二个键，spawn 时短的那个生效，
 *     结果 npm / node 全从 PATH 里消失了。必须复用原有键名。
 *  2. 不要覆盖 TEMP。用户自己的 TEMP 是可写的，覆盖只会引入变量。
 *
 * 对其他机器没有副作用：项目里不存在 `.toolchain` 时原样透传。
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
const sep = process.platform === "win32" ? ";" : ":";

/** 找到环境里 PATH 的实际键名（Windows 常为 `Path`），避免造重复键 */
const pickKey = (name) =>
  Object.keys(process.env).find((k) => k.toUpperCase() === name) ?? name;

const PATH_KEY = pickKey("PATH");

const toolchain = join(root, ".toolchain");
if (existsSync(join(toolchain, "cargo"))) {
  env.CARGO_HOME = join(toolchain, "cargo");
  env.RUSTUP_HOME = join(toolchain, "rustup");
  env[PATH_KEY] = [join(toolchain, "cargo", "bin"), env[PATH_KEY] ?? ""].join(sep);
}

/**
 * 项目内有 Fixed Version 运行时的话，指过去。
 *
 * 系统那份 WebView2 在某些环境（比如这台 Win11 26H2 + 155.0.4283.62）
 * 会在 `msedge.dll` 里断言失败，连 profile 都建不出来。
 * Fixed Version 是独立打包的一份，WebView2 会优先用它。
 *
 * 没有 .wv2 目录就原样透传，对别的机器零影响。
 */
const wv2 = join(root, ".wv2");
if (existsSync(wv2)) {
  const found = readdirSync(wv2, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(wv2, d.name))
    .find((p) => existsSync(join(p, "msedgewebview2.exe")));
  if (found) env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = found;
}

const cli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
if (!existsSync(cli)) {
  console.error("找不到 @tauri-apps/cli，请先运行 npm install");
  process.exit(1);
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  cwd: root,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
