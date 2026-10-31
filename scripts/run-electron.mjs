import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_URL = "http://127.0.0.1:1420";
const isWin = process.platform === "win32";

/**
 * 两种模式：
 *   node scripts/run-electron.mjs         → dev，连 vite（热更新，但慢）
 *   node scripts/run-electron.mjs --prod  → 生产，直接加载 dist/（快，不启 vite）
 */
const prodMode = process.argv.includes("--prod");

async function devServerUp() {
  try {
    const r = await fetch(DEV_URL, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let vite = null;

if (!prodMode) {
  if (!(await devServerUp())) {
    console.log("[desktop] vite 没在跑，先拉起来…");
    vite = spawn(isWin ? "npm.cmd" : "npm", ["run", "dev"], {
      cwd: root,
      stdio: "inherit",
      shell: isWin,
    });

    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (await devServerUp()) {
        ready = true;
        break;
      }
    }
    if (!ready) {
      console.error("[desktop] vite 起不来，先手动 npm run dev 看看报什么错");
      vite.kill();
      process.exit(1);
    }
    console.log("[desktop] vite 就绪");
  }
} else {
  if (!existsSync(join(root, "dist", "index.html"))) {
    console.error("[desktop] dist/ 不存在，先跑一次：npm run build");
    process.exit(1);
  }
}

const electronBin = join(
  root,
  "node_modules",
  "electron",
  "dist",
  isWin ? "electron.exe" : "electron"
);

if (!existsSync(electronBin)) {
  console.error("[desktop] 找不到 electron 二进制，跑一次：");
  console.error("  cd node_modules/electron && node install.js");
  vite?.kill();
  process.exit(1);
}

/**
 * 有些环境（IDE、agent 沙箱、CI）会设 ELECTRON_RUN_AS_NODE=1。
 * 那样 electron.exe 会退化成纯 Node，`require("electron")` 拿到的是包路径
 * 而不是 API，主进程直接崩在 `app.commandLine` 上。必须剔除。
 */
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

if (prodMode) {
  delete childEnv.DESKTOP_DEV_URL;
  console.log("[desktop] 模式    : 生产（加载 dist/，不启 vite）");
} else {
  childEnv.DESKTOP_DEV_URL = DEV_URL;
  console.log(`[desktop] 模式    : 开发（连接 ${DEV_URL}）`);
}

console.log(`[desktop] electron: ${electronBin}`);
console.log("[desktop] 启动中…");

/**
 * 启动前清掉上一次留下的实例。
 *
 * app 里有单实例锁 —— 旧实例还占着锁时，新启动会**静默退出**，
 * 用户看到的现象是「双击了没反应」。开发时更糟：改的代码根本没生效，
 * 因为窗口还是上一次那个。
 *
 * 只杀命令行里带本项目路径的 electron.exe，不碰别的 Electron 应用
 * （比如你开着的其它 Electron 软件）。
 */
async function killPrevious() {
  if (!isWin) return;
  const { execFileSync } = await import("node:child_process");
  const ps = [
    `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`,
    `Where-Object { $_.CommandLine -like '*${root}*' }`,
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join(" | ");

  try {
    execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
    console.log("[desktop] 已清掉上一次的实例");
  } catch {
    /* 杀不掉就算了，单实例锁会兜住，最多是「这次的代码没生效」 */
  }
}

await killPrevious();

/* 等旧实例真正把单实例锁放掉再启动。
   400ms 不够 —— Windows 上进程退出和锁释放之间有间隙，
   新实例会撞锁然后 app.quit()，表现就是「窗口一闪而过」。 */
await sleep(1500);

const child = spawn(electronBin, ["."], {
  cwd: root,
  stdio: "inherit",
  env: childEnv,
});

child.on("error", (err) => {
  console.error("[desktop] spawn 失败:", err);
  vite?.kill();
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (code === 0) {
    console.log("[desktop] 窗口已关闭，正常退出");
  } else {
    console.error(`[desktop] electron 异常退出 code=${code} signal=${signal}`);
  }
  vite?.kill();
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill();
    vite?.kill();
    process.exit(0);
  });
}
