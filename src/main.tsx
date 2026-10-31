import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { PersonaProvider } from "./store/personas";
import { GroupProvider } from "./store/groups";
import { bootstrapRestore } from "./lib/persist";
import { resetModeOnBoot } from "./lib/mode";
import { log } from "./lib/eventLog";
import { detectClockRollback, resetTimeOffset } from "./lib/clock";
import { hydrateCredentials } from "./store/credentials";
import "./styles.css";
import "./styles-crash.css";

/**
 * 先把本地留底补回 localStorage，再挂载 React。
 *
 * 顺序不能反：角色、群聊、对话、凭据的 store 全都在首次渲染时直接读
 * localStorage。先渲染再恢复，就得把每个 store 重挂一遍，既容易漏，
 * 也会让用户看到「空一下再冒出来」。
 *
 * bootstrapRestore 内部自己兜住了所有异常；这里再包一层，是防它意外抛
 * 出导致整个窗口白屏 —— 宁可这次不恢复，也不能打不开。
 *
 * hydrateCredentials 必须在它之后：先让 localStorage 有数据（可能是从
 * 文件恢复的密文），再去解密进内存缓存。
 */
async function boot() {
  /*
   * 启动 —— 第一件真事。
   *
   * 这条会出现在左栏的 EVENT STREAM 里。它是整个流的第一条，
   * 因为在你做任何事之前，确实只发生了「程序启动了」。
   */
  log.boot("0.1.0");

  try {
    await bootstrapRestore();
    /*
     * 恢复回来几个 key —— 真的数了。
     *
     * 原来还想报「恢复了多少字节」，用 localStorage 的长度差算 ——
     * 但 bootstrapRestore 是**合并**不是替换，localStorage 里本来就有值，
     * 差值恒为 0。那个 0B 看着像坏了。
     *
     * 只报 key 数。那是真的，也够用。
     */
    log.restore(Object.keys(localStorage).length, 0);
  } catch {
    /* 恢复失败不影响启动，文件还在，下次再说 */
  }

  /*
   * 系统时钟倒退检测。
   *
   * 只报告，不改数据 —— 记忆那边靠 Math.max(0) 兜住，
   * 最多是「一起返老还童」，不会崩。
   *
   * 但用户该知道：他改了系统时间。
   */
  const rolled = detectClockRollback();
  if (rolled > 0) {
    const hours = Math.round(rolled / 3600000);
    console.warn(
      `[clock] 系统时间比上次记录倒退了约 ${hours} 小时。记忆的衰减会按「刚写过」算，不会崩。`
    );
  }

  /*
   * 启动强制推演 + 关掉时间机器。
   *
   * **必须在 bootstrapRestore 之后** —— 否则会被恢复出来的旧值覆盖。
   *
   * 理由见 mode.ts 里 resetModeOnBoot 的注释：
   * 用户不该在不知情的时候，让她一直待在「说的不算数」的底色里。
   *
   * ── 时间偏移也必须清 ──
   *
   * 第一版只清了 mode。结果：关掉重开，界面是推演模式（没有徽章），
   * 但右上角还挂着「⏱ 时间+7天」—— 因为 3w:time-offset 跨会话留着。
   *
   * 那和「时间机器是观察工具，不是持久状态」自相矛盾。
   * sim 命令里清了，启动却没清 —— 同一件事漏了一半。
   */
  resetModeOnBoot();
  resetTimeOffset();

  try {
    const r = await hydrateCredentials();
    if (r.failed > 0) {
      console.warn(
        `[cred] ${r.failed} 套凭据解不开（换机器或换系统账户会导致这样），需要在设置里重填`
      );
    }
  } catch {
    /* 解密层出问题不该拦住启动 —— 最坏情况是 key 为空，用户重填一次 */
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <PersonaProvider>
          <GroupProvider>
            <App />
          </GroupProvider>
        </PersonaProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}

void boot();
