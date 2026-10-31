/**
 * 检查更新。
 *
 * ── 只查，不自动装 ──
 *
 * 自动更新（`electron-updater`）需要一整套基建：代码签名证书、
 * `latest.yml`、差分包、后台静默下载、失败回滚。
 *
 * **这个软件现在要的是「有新版本了吗」，不是「替我装好」。**
 *
 * 所以：查 GitHub Releases → 告诉你版本号 → 你点一下，用系统浏览器去下。
 *
 * ── 两个通道 ──
 *
 * ```
 * stable  正式版    /releases/latest   GitHub 自动排除 prerelease
 * beta    测试版    /releases          取第一个（含 prerelease）
 * ```
 *
 * ── 为什么分两个 ──
 *
 * 发布早期版本会跳得快 —— 想让愿意尝鲜的人拿到新的，
 * 又不想让只想稳定用的人被半成品打扰。
 *
 * **这是用户选的，不是我们替他决定。**
 */

export type Channel = "stable" | "beta";

export interface UpdateResult {
  ok: boolean;
  channel: Channel;
  /** 当前装的版本 */
  current: string;
  /** 远端最新版本（去掉 v 前缀） */
  latest?: string;
  /** 远端比当前新 */
  isNewer?: boolean;
  /** release 页面地址 */
  url?: string;
  /** release 标题 */
  name?: string;
  /** 是不是预发布 */
  prerelease?: boolean;
  publishedAt?: string;
  /** release 说明（截断到 800 字） */
  notes?: string;
  /** 失败原因 —— 说人话，不是 HTTP 状态码 */
  reason?: string;
}

const KEY = "3w:update-channel";

/** 读通道。默认正式版 —— 大多数人只想要稳定的那个。 */
export function readChannel(): Channel {
  try {
    const v = localStorage.getItem(KEY);
    return v === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}

export function saveChannel(c: Channel) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* 写不进去就用默认值，不影响检查 */
  }
}

/**
 * 查一次。
 *
 * 浏览器预览里没有主进程 —— 直接返回一个说得清的原因，
 * 而不是抛异常让 UI 白屏。
 */
export async function checkUpdate(channel: Channel): Promise<UpdateResult> {
  const api = typeof window !== "undefined" ? window.desktop : undefined;

  if (!api?.updateCheck) {
    return {
      ok: false,
      channel,
      current: "—",
      reason: "浏览器预览里没有主进程，检查不了更新（用桌面版）",
    };
  }

  try {
    return await api.updateCheck({ channel });
  } catch (err) {
    return {
      ok: false,
      channel,
      current: "—",
      reason: `检查失败：${String((err as Error)?.message ?? err).slice(0, 80)}`,
    };
  }
}

/** 用系统浏览器打开 release 页面 */
export async function openRelease(url: string): Promise<boolean> {
  const api = typeof window !== "undefined" ? window.desktop : undefined;
  if (!api?.updateOpen || !url) return false;
  try {
    return await api.updateOpen(url);
  } catch {
    return false;
  }
}

/**
 * 通道的中文名和一句话说明。
 *
 * 放在这里而不是 UI 里：以后要加第三个通道（比如 nightly），
 * 只改这一处。
 */
export const CHANNELS: {
  key: Channel;
  label: string;
  hint: string;
}[] = [
  {
    key: "stable",
    label: "正式版",
    hint: "只收经过验证的版本",
  },
  {
    key: "beta",
    label: "测试版",
    hint: "更早拿到新东西，也可能碰到没修完的地方",
  },
];
