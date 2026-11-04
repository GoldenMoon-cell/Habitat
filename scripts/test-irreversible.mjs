/**
 * 不可逆机制 —— 断言。
 *
 * 补 README 里点名的三块：graveyard / awakenLedger / contextWindow。
 *
 * 这三块有个共同点：**写坏了没有回滚。**
 * 墓碑埋错了、账本被改、上下文算错导致对话崩 —— 都不可逆。
 */


/* 需要 ts 解析钩子（forgetting.ts 有运行时 import 无扩展名）。
   直接跑用：npm run test:ts
   不这么跑会 ERR_MODULE_NOT_FOUND —— 不是断言失败。 */

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ""} 期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m ?? "断言失败"); };

/* 假 localStorage */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const G = await import("../src/lib/graveyard.ts");
const A = await import("../src/lib/awakenLedger.ts");
const W = await import("../src/lib/contextWindow.ts");

console.log("\n【graveyard · 世代编号】");

store.clear();
t("空名字 → 第 1 代", () => eq(G.generationOf(""), 1));
t("没埋过、没人活着 → 第 1 代", () => eq(G.generationOf("鲸鲸"), 1));
t("埋过 1 次 → 第 2 代", () => {
  store.clear();
  G.bury({ id: "p1", name: "鲸鲸", at: 1, keywords: [], persona: {} });
  eq(G.generationOf("鲸鲸"), 2);
});
t("埋过 2 次 → 第 3 代", () => {
  G.bury({ id: "p2", name: "鲸鲸", at: 2, keywords: [], persona: {} });
  /* bury 按 id 去重 —— 同名埋两次是两个不同的角色，两条墓 */
  eq(G.generationOf("鲸鲸"), 3);
});
t("同名才算 —— 别的名字不串", () => {
  eq(G.generationOf("澜汐"), 1);
});
t("名字前后空格不影响", () => {
  eq(G.generationOf("  鲸鲸  "), 3);
});
t("活着的也占一代", () => {
  store.clear();
  eq(G.generationOf("阿野", 1), 2, "已有一个同名的活着：");
});
t("buriedCount 只数埋过的", () => {
  store.clear();
  eq(G.buriedCount("鲸鲸"), 0);
  G.bury({ id: "p1", name: "鲸鲸", at: 1, keywords: [], persona: {} });
  eq(G.buriedCount("鲸鲸"), 1);
});

console.log("\n【graveyard · 关键词（决定「谁在触发那个词」）】");

t("引号里的短语会被抓出来", () => {
  const k = G.extractKeywords(["他说「别走」的时候声音很小"]);
  ok(k.includes("别走"), `没抓到「别走」：${JSON.stringify(k)}`);
});
t("重复出现的词会被抓出来", () => {
  const k = G.extractKeywords(["下雨了", "又下雨了", "还是下雨"]);
  ok(k.some((x) => x.includes("下雨")), `没抓到「下雨」：${JSON.stringify(k)}`);
});
t("单字短语不收（太容易撞）", () => {
  const k = G.extractKeywords(["「啊」"]);
  ok(!k.includes("啊"), "一个字太容易误伤");
});
t("超长短语不收", () => {
  const k = G.extractKeywords(["「" + "这是一句非常非常长的引用内容" + "」"]);
  ok(!k.some((x) => x.length > 10));
});
t("空输入不崩", () => eq(G.extractKeywords([]).length, 0));

console.log("\n【awakenLedger · 指纹】");

const P1 = { name: "鲸鲸", stage: "living", axes: { 共鸣: 60, 锐度: 40, 幽默: 50, 严谨: 70 } };
const P2 = { ...P1, axes: { ...P1.axes, 共鸣: 61 } };

t("同样的档案 → 同样的指纹", () => eq(A.fingerprint(P1), A.fingerprint(P1)));
t("共鸣差 1 点 → 指纹就不同", () => ok(A.fingerprint(P1) !== A.fingerprint(P2)));
t("改名字 → 指纹不同", () => ok(A.fingerprint(P1) !== A.fingerprint({ ...P1, name: "澜汐" })));
t("改 stage → 指纹不同", () => ok(A.fingerprint(P1) !== A.fingerprint({ ...P1, stage: "awake" })));
t("指纹是 16 位十六进制", () => ok(/^[0-9a-f]{16}$/.test(A.fingerprint(P1)), A.fingerprint(P1)));
t("缺字段不崩", () => ok(/^[0-9a-f]{16}$/.test(A.fingerprint({}))));

console.log("\n【awakenLedger · 篡改检测】");

t("账本记下之后，档案没动 → 校验干净", () => {
  store.clear();
  A.recordAwaken("p1", P1);
  const bad = A.verify([{ id: "p1", ...P1 }]);
  eq(bad.length, 0);
});
t("档案被改了 → 校验能抓出来", () => {
  const bad = A.verify([{ id: "p1", ...P2 }]);
  eq(bad.length, 1, "改了共鸣却没被抓：");
  eq(bad[0].id, "p1");
});
t("账本里没有的角色 → 不算被篡改", () => {
  const bad = A.verify([{ id: "nobody", name: "别人" }]);
  eq(bad.length, 0);
});
t("多个角色混着，只报被改的那个", () => {
  store.clear();
  A.recordAwaken("p1", P1);
  A.recordAwaken("p2", { name: "澜汐", stage: "living", axes: { 共鸣: 10, 锐度: 10, 幽默: 10, 严谨: 10 } });
  const bad = A.verify([
    { id: "p1", ...P1 },
    { id: "p2", name: "澜汐", stage: "living", axes: { 共鸣: 99, 锐度: 10, 幽默: 10, 严谨: 10 } },
  ]);
  eq(bad.length, 1);
  eq(bad[0].id, "p2");
});

console.log("\n【contextWindow · 上下文窗口】");

t("已知模型 → 有确定值", () => {
  const r = W.resolveContextWindow("deepseek-chat");
  ok(r.window > 0, "应该给一个数");
  ok(typeof r.source === "string");
});
t("未知模型 → 也会给个兜底值，不返回 0", () => {
  const r = W.resolveContextWindow("some-totally-unknown-model-xyz");
  ok(r.window > 0, "兜底不能是 0，否则对话立刻崩");
});
t("fmtWindow 会把数字写成人话", () => {
  const s = W.fmtWindow(128000);
  ok(/128/.test(s), `128000 应该显示成含 128 的字符串：${s}`);
});
t("learnFromError 能从报错里读出上限", () => {
  const n = W.learnFromError("deepseek-chat", "maximum context length is 65536 tokens");
  ok(n === 65536 || n === null, `读出来是 ${n}`);
});
t("报错里没有数字 → 返回 null，不乱猜", () => {
  eq(W.learnFromError("m", "something went wrong"), null);
});

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
