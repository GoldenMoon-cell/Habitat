/**
 * 应用显示名。
 *
 * 只改**显示层** —— 页头、窗口标题、导出文件名。
 *
 * 绝对不碰的几个地方：
 *   package.json 的 name / appId
 *   %APPDATA%\three-whales-space\ 这个数据目录
 *
 * 那些是身份，不是名字。改一下，用户的全部数据就"消失"了
 * （其实是换了目录，但对他来说就是消失）。
 */

const KEY = "3w:app-name";

export const DEFAULT_APP_NAME = "生境";

export function readAppName(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.trim() ? v.trim() : DEFAULT_APP_NAME;
  } catch {
    return DEFAULT_APP_NAME;
  }
}

export function saveAppName(name: string) {
  const v = name.trim();
  try {
    if (!v || v === DEFAULT_APP_NAME) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* 存储不可用就只在内存里生效 */
  }
}
