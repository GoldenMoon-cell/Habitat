/**
 * 发送模式 —— 断言。
 *
 * 这条规则是用户自己选的，不是我们替他决定的。
 * 测的是：默认必须是「等 6 秒」，只有明确写了 instant 才是即时。
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

t("没写过 → 等 6 秒（不是即时）", () => eq(readSendMode(), "delayed"));
t("窗口常量是 6000ms", () => eq(SEND_DELAY_MS, 6000));
t("用户从没改过时，默认不给他「按了就发」", () => {
  store.clear();
  ok(readSendMode() !== "instant", "默认不该是 instant");
});

console.log("\n【记忆】");

t("存 instant → 读回 instant", () => {
  saveSendMode("instant");
  eq(readSendMode(), "instant");
});
t("存 delayed → 读回 delayed", () => {
  saveSendMode("delayed");
  eq(readSendMode(), "delayed");
});

console.log("\n【坏数据一律回默认】");

t("空字符串 → 延迟", () => { store.set("3w:send-mode", ""); eq(readSendMode(), "delayed"); });
t("乱码 → 延迟", () => { store.set("3w:send-mode", "{{{\"x\":1"); eq(readSendMode(), "delayed"); });
t("大小写不对（Instant）→ 延迟", () => { store.set("3w:send-mode", "Instant"); eq(readSendMode(), "delayed"); });
t("相似词（immediate）→ 延迟", () => { store.set("3w:send-mode", "immediate"); eq(readSendMode(), "delayed"); });
t("数字 1 → 延迟", () => { store.set("3w:send-mode", "1"); eq(readSendMode(), "delayed"); });

console.log("\n【localStorage 不可用也不能崩】");

t("getItem 抛错 → 回默认", () => {
  const bak = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = () => { throw new Error("隐私模式"); };
  try { eq(readSendMode(), "delayed"); }
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
