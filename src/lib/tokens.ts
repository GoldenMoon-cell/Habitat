/**
 * 上下文占用的粗略估算。
 *
 * 没有真实 tokenizer（不加载模型就不能算准），这里按字符类型加权：
 *   中文 1 字 ≈ 1.5 token
 *   英文 1 词 ≈ 1.3 token
 *   其余（标点 / 空格 / 数字）≈ 0.25 token
 *
 * 误差在 ±20% 左右，对「进度条大概到哪了」足够。
 * 真要精确，得接模型的 tokenizer —— 那是第二阶段的事。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
const WORD = /[a-zA-Z]+/g;

/** 单条文本的 token 估算 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK) ?? []).length;
  const words = (text.match(WORD) ?? []).length;
  const rest = Math.max(0, text.length - cjk - words);
  return Math.ceil(cjk * 1.5 + words * 1.3 + rest * 0.25);
}

/** 一批消息的 token 合计（单位 k） */
export function sumTokensK(texts: (string | undefined)[]): number {
  let n = 0;
  for (const t of texts) if (t) n += estimateTokens(t);
  return n / 1000;
}
