/**
 * Node ESM 解析钩子：给无扩展名的相对 import 补 .ts
 *
 * 为什么需要：
 *   Vite 能解析 `./clock`，Node 不行。
 *   forgetting.ts 里有运行时 import（不是 import type），
 *   所以直接 node 跑测试会报 ERR_MODULE_NOT_FOUND。
 *
 * 只影响测试，不影响构建 —— 应用仍然走 Vite。
 */
export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-z]+$/i.test(specifier)
  ) {
    try {
      return await next(specifier + ".ts", context);
    } catch {
      /* 补 .ts 也不行，走原路径让 Node 自己报错 */
    }
  }
  return next(specifier, context);
}
