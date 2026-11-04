/**
 * 发送模式 —— 断言。
 *
 * 默认和手机短信一样：按了就发。
 * 「等 6 秒」是功能，不是默认 —— 只有用户明确写了 delayed 才启用。
 */

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ""} 期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m ?? "断言失败"); };

/* ── 用一个假 localStorage 跑，不依赖浏览器 ── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { readSendMode, saveSendMode, sendModeLabel, SEND_DELAY_MS } = await import("../src/lib/sendDelay.ts");

console.log("\n【默认值】");

t("没写过 → 立即发送（和手机短信一样）", () => eq(readSendMode(), "instant"));
t("窗口常量是 6000ms", () => eq(SEND_DELAY_MS, 6000));
t("用户从没改过时，不该被塞一个等待窗口", () => {
  store.clear();
  eq(readSendMode(), "instant", "默认必须是即时：");
});

console.log("\n【记忆】");

t("存 instant → 读回 instant", () => {
  saveSendMode("instant");
  eq(readSendMode(), "instant");
});
t("存 delayed → 读回 delayed（用户主动开了才等）", () => {
  saveSendMode("delayed");
  eq(readSendMode(), "delayed");
});

console.log("\n【坏数据一律回默认】");

t("空字符串 → 即时", () => { store.set("3w:send-mode", ""); eq(readSendMode(), "instant"); });
t("乱码 → 即时", () => { store.set("3w:send-mode", "{{{\"x\":1"); eq(readSendMode(), "instant"); });
t("大小写不对（Delayed）→ 即时", () => { store.set("3w:send-mode", "Delayed"); eq(readSendMode(), "instant"); });
t("相似词（wait）→ 即时", () => { store.set("3w:send-mode", "wait"); eq(readSendMode(), "instant"); });
t("数字 1 → 即时", () => { store.set("3w:send-mode", "1"); eq(readSendMode(), "instant"); });

console.log("\n【localStorage 不可用也不能崩】");

t("getItem 抛错 → 回默认（即时）", () => {
  const bak = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = () => { throw new Error("隐私模式"); };
  try { eq(readSendMode(), "instant"); }
  finally { globalThis.localStorage.getItem = bak; }
});
t("setItem 抛错 → 不冒泡", () => {
  const bak = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error("配额满"); };
  try { saveSendMode("instant"); }
  finally { globalThis.localStorage.setItem = bak; }
});

console.log("\n【文案】");

t("延迟模式的标签提到秒数", () => ok(/6/.test(sendModeLabel("delayed"))));
t("即时模式的标签不提秒数", () => ok(!/秒/.test(sendModeLabel("instant"))));

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
