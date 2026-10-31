# Tauri / WebView2 调试记录

> **历史存档**：这个项目后来从 Tauri 换到了 Electron（见 `decisions.md` D-013）。
> 本文记录的是 Tauri / WebView2 调试的全过程 —— **结论已不适用，但排查方法还有参考价值**。
> 现在启动 app 用 `npm run desktop:prod` / `npm run pack`，不涉及 Tauri。

**结论先说**：Tauri 代码完整、能编译出 3.1 MB 的 exe，但**本机窗口起不来**（`0x80000003`）。原因是目录完整性标签，见下。现在用 Electron。

---

## 症状

`cargo build` 全部通过，release 产物 3.1 MB，前端已内嵌。双击运行 → **立刻退出，无窗口、无报错、无日志**。

`--enable-logging --v=1` 也写不出任何东西 —— **崩溃发生在 Chromium 的日志系统初始化之前**。

---

## 根因：目录的完整性标签

**`D:\Habitat_App` 曾被标记为 `Low` 完整性级别。** Chromium 的子进程在 Low 标签的目录里读不到运行时文件，于是在初始化的极早期 `__debugbreak()`。

这个标签是 **DSH 的文件沙箱**在写工作目录时留下的（不是用户装的软件，也不是系统损坏）。

### 关键对照实验

| 目标 | 路径完整性标签 | 结果 |
|---|---|---|
| `C:\Temp\ectest\electron.exe` | Medium（无标签） | ✅ `v38.8.6` |
| `D:\...\dist\electron.exe`（改标签前） | Low | ❌ `0x80000003` |
| `D:\...\dist\electron.exe`（文件改 Medium 后） | 文件 Medium / 目录 Low | ✅ `--version` 通过 |
| `D:\...`（整树改 Medium 后） | Medium | ✅ 窗口正常 |

三个点刚好卡在「标签改到哪一层」这个变量上。

### 修复

```powershell
# 管理员 PowerShell
icacls "D:\Habitat_App" /setintegritylevel "(OI)(CI)M" /T /C
```

本机实测：**51907 个文件，0 失败**。

### 如果窗口又打不开

第一件事查这个：

```powershell
icacls "D:\Habitat_App" | findstr "Mandatory Label"
```

出现 `Low Mandatory Level` 就是它，重跑上面那条 `icacls`。

### 另一个相关的坑（2026-10-24）

蓝屏重启后 DSH 以普通用户身份启动，项目目录变成**只读**（`<用户名>:(WO,S)`，只有改所有者权限）。

症状：`vite` 起不来，报 `EPERM: open node_modules/.vite-temp/...`。

**根因不是 `.vite-temp`** —— 是整个项目不可写。而且 `Everyone:(CI)(DENY)(DC)` 这个 DENY 压过了 `Administrators:(F)`（Windows 的规则是拒绝优先于允许）。

修复：

```powershell
takeown /f "D:\Habitat_App" /r /d y
icacls "D:\Habitat_App" /grant "$env:USERNAME:(OI)(CI)F" /t /c
icacls "D:\Habitat_App" /remove:d Everyone /t /c
```

**必须用管理员身份开 DSH**，否则写不了代码。

---

## 曾经排除过的方向

**这些全部不是原因**，记在这里是为了避免下次重新走一遍：

权限（Medium 完整性）、目录不可写、文件损坏（zip SHA256 与官方一致）、GPU、`--no-sandbox`、`--single-process`、`--disable-gpu-sandbox`、MacType 注入（已停用并验证 Code Integrity 日志无拦截）、DLL 注入（`AppInit_DLLs` 为空）、兼容性层、Smart App Control、WDAC 策略、AppContainer 策略、Riot Vanguard（已卸载并重启验证）、`dataDirectory` 显式指定、`WEBVIEW2_USER_DATA_FOLDER`、`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`。

---

## Tauri 的构建状态

| 项 | 状态 |
|---|---|
| `cargo build` | ✅ 343 个 crate，debug 37s / release 1m39s |
| release 产物 | ✅ `src-tauri/target/release/habitat.exe` · 3.1 MB |
| `tauri build`（NSIS 打包） | ⚠️ release 编译通过，打包失败（`os error 5`） |
| 窗口启动 | ❌ `0x80000003` |

**代码完整，换一台 WebView2 正常的机器就能用。**

---

## 本机受限环境的三个坑

这台机器的用户目录和 `%TEMP%` 被 ACL 限权，Rust 只能装进项目内的 `.toolchain`。

- **`npm run tauri dev` 会自动找 cargo** —— `scripts/run-tauri.mjs` 注入 `CARGO_HOME` / `RUSTUP_HOME` / `PATH`。没有 `.toolchain` 的机器原样透传。
- **`dev.ps1`** 是同一套变量的 PowerShell 版本：`.\dev.ps1` / `.\dev.ps1 web` / `.\dev.ps1 build`。
- `.toolchain` / `.tools` / `.tmp` 都在 `.gitignore` 里。

> **Windows 上的一个坑**：环境变量键名是 `Path` 不是 `PATH`。
> 在 Node 里写 `env.PATH = ...` 会造出**第二个键**，spawn 时短的那个生效，
> 结果 `npm` 从 PATH 里消失，报「'npm' 不是内部或外部命令」。

---

## Electron 的状态（当前使用）

| 项 | 状态 |
|---|---|
| `npm run desktop:prod` | ✅ 冷启动 1-2 秒 |
| `npm run desktop` | ✅ 连 vite，有热更新 |
| 包体 | 200 MB（Chromium 静态链接） |
| 系统依赖 | 无 |

窗口 1520×950、无边框、深色底。用 `App.tsx` 里那条 36px 自绘标题栏拖动，右上角 — ▢ ✕ 是真的窗口控制（IPC 到主进程）。

**Electron 的额外好处**：主进程是 Node，**没有 CORS 限制**。远程 API 调用走 `llm:chat` 通道正常。
