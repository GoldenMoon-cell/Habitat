/**
 * 角色头像上的那个标记字。
 *
 * 为什么要单独抽出来：
 *   这张表曾经在四个文件里各写了一份（MessageRow / ChatStage /
 *   ContactsRail / GodRail），而且其中三份对不认识 id 的兜底是 `"?"`。
 *   结果：数据里有 8 个角色，表里只有 4 个，剩下的头像全变成问号。
 *
 *   **加一个角色要改四个地方，漏一个就出问号** —— 这种就该只有一处。
 *
 * 规则：
 *   中文名 → 首字（「鲸鲸」→ 鲸）
 *   英文名 → 前两个字母首字母大写（「ChatGPT」→ Ch，「Claude」→ Cl）
 *
 * 英文为什么取两个字母：
 *   只取首字母的话 Claude / ChatGPT 都是 C，Gemini / Grok 都是 G，
 *   一眼分不清谁在说话。两个字母的辨识成本低得多，30px 的头像也放得下。
 */

const CJK = /[\u3400-\u9fff]/;

/**
 * 只有**还用着默认名字**时才套特例。
 *
 * 之前是「id 命中特例就直接用」，结果是：你把「澜汐」改成「DeepSeek」，
 * 头像还挂着「汐」—— 名字和头像各说各的，看着像没保存成功。
 *
 * 现在：名字变了就按新名字算（DeepSeek → De）。
 */
const SPECIAL_BY_DEFAULT_NAME: Record<string, { when: string; mark: string }> = {
  jingjing: { when: "鲸鲸", mark: "鲸" },
  lanxi: { when: "澜汐", mark: "汐" },
};

/**
 * @param id   角色 id（用于识别「还是不是默认名」）
 * @param name 角色显示名
 */
export function avatarMark(id: string, name?: string): string {
  const n = (name ?? id ?? "").trim();
  if (!n) return "?";

  const sp = SPECIAL_BY_DEFAULT_NAME[id];
  if (sp && n === sp.when) return sp.mark;

  const chars = Array.from(n);
  if (CJK.test(chars[0])) return chars[0];

  /* 英文 / 其他：前两字符，首字母大写 */
  const two = chars.slice(0, 2).join("");
  return two.charAt(0).toUpperCase() + two.slice(1);
}
