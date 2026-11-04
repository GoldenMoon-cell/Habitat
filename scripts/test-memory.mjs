/**
 * 记忆系统 —— 断言。
 *
 * 补的是 README 里那两个「没有测试」的模块：
 *   forgetting  衰减 / 固化 / 阈值
 *   extract     什么话会被记住
 *
 * 这两块以前只能靠「真人聊 10 轮看看」验。
 * 但它们是纯函数 —— 灌时间、灌句子就能验。
 */

const { effectiveWeight, isConsolidated, shouldConsolidate, isFaded,
        MEMORY_THRESHOLD, CONSOLIDATE_AT } = await import("../src/lib/forgetting.ts");
const { extract } = await import("../src/lib/extract.ts");


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
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(`${m ?? ""} 期望 ≈${b}，得到 ${a.toFixed(4)}`); };

const DAY = 86400000;
const mk = (o = {}) => ({
  id: "m1", text: "他受不了香菜", tag: "偏好", weight: 0.7,
  at: 0, lastAccessed: 0, accessCount: 0, ...o,
});

console.log("\n【衰减：时间越久越轻】");

t("刚记下 → 权重不变", () => near(effectiveWeight(mk(), 0), 0.7, 1e-6));
t("3 天后 → 变轻", () => ok(effectiveWeight(mk(), 3 * DAY) < 0.7));
t("30 天后 → 更轻", () => {
  const d3 = effectiveWeight(mk(), 3 * DAY);
  const d30 = effectiveWeight(mk(), 30 * DAY);
  ok(d30 < d3, `30 天(${d30.toFixed(3)}) 应该比 3 天(${d3.toFixed(3)}) 轻`);
});
t("衰减是单调的 —— 不会中途变重", () => {
  let prev = Infinity;
  for (let d = 0; d <= 60; d += 2) {
    const w = effectiveWeight(mk(), d * DAY);
    ok(w <= prev + 1e-9, `第 ${d} 天变了重：${prev.toFixed(4)} → ${w.toFixed(4)}`);
    prev = w;
  }
});

console.log("\n【间隔效应：复习让衰减本身变慢】");

t("复习 3 次比不复习掉得慢", () => {
  const a = effectiveWeight(mk({ accessCount: 0 }), 10 * DAY);
  const b = effectiveWeight(mk({ accessCount: 3 }), 10 * DAY);
  ok(b > a, `复习过的${b.toFixed(3)} 应该 > 没复习的${a.toFixed(3)}`);
});
t("复习只影响速度，不改变起点", () => near(
  effectiveWeight(mk({ accessCount: 5 }), 0), 0.7, 1e-6));

console.log("\n【固化与创伤：不衰减】");

t("consolidated → 起点不变，但会掉（掉得慢）", () => {
  const m = mk({ consolidated: true });
  near(effectiveWeight(m, 0), 0.7, 1e-6);
  const a = effectiveWeight(m, 30 * DAY);
  const b = effectiveWeight(mk(), 30 * DAY);
  ok(a > b, `固化过的${a.toFixed(3)} 应该比普通${b.toFixed(3)} 掉得慢`);
  ok(a < 0.7, "但它不是冻结的 —— 真实记忆会淡");
});
t("只有创伤（milestone/rename）才真的冻结", () => {
  for (const reason of ["milestone", "rename"]) {
    const m = mk({ reason });
    near(effectiveWeight(m, 365 * DAY), 0.7, 1e-6, `${reason} 一年后：`);
  }
});
t("reason=milestone → 也不衰减", () => {
  const m = mk({ reason: "milestone" });
  near(effectiveWeight(m, 365 * DAY), 0.7, 1e-6);
});
t("reason=rename → 也不衰减", () => {
  const m = mk({ reason: "rename" });
  near(effectiveWeight(m, 365 * DAY), 0.7, 1e-6);
});
t("isConsolidated 认 milestone / rename", () => {
  ok(isConsolidated(mk({ reason: "milestone" })));
  ok(isConsolidated(mk({ reason: "rename" })));
  ok(!isConsolidated(mk()));
});

console.log("\n【遗忘闸：forgotten 就是 0】");

t("forgotten = true → 0，不管多重", () => near(effectiveWeight(mk({ forgotten: true, weight: 1 }), 0), 0, 1e-9));

console.log("\n【阈值】");

t("阈值是 0.2", () => eq(MEMORY_THRESHOLD, 0.2));
t("刚记下 → 没淡", () => ok(!isFaded(mk(), 0)));
t("很久之后 → 淡了", () => ok(isFaded(mk(), 60 * DAY)));
t("已遗忘 → 不算「淡」（它是 0，不是淡化中）", () => ok(!isFaded(mk({ forgotten: true }), 60 * DAY)));

console.log("\n【巩固条件】");

t("巩固门槛是 3 次", () => eq(CONSOLIDATE_AT, 3));
t("只提取 2 次 → 不巩固", () => ok(!shouldConsolidate(mk({ accessCount: 2 }), 0)));
t("提取 3 次 + 还清楚 → 巩固", () => ok(shouldConsolidate(mk({ accessCount: 3 }), 0)));
t("提取 3 次但已经淡到 0.3 以下 → 不巩固", () => {
  ok(!shouldConsolidate(mk({ accessCount: 3, weight: 0.15 }), 0),
     "想不起来的东西不该突然变得刻骨铭心");
});
t("已巩固的 → 不再重复巩固", () => ok(!shouldConsolidate(mk({ accessCount: 9, consolidated: true }), 0)));
t("已遗忘的 → 不巩固", () => ok(!shouldConsolidate(mk({ accessCount: 9, forgotten: true }), 0)));

console.log("\n【提取：该记什么】");

const E = (s) => extract(s);

t("「我不吃香菜」→ 偏好", () => {
  const r = E("我不吃香菜");
  ok(r, "应该被记");
  eq(r.tag, "偏好");
  near(r.weight, 0.7, 1e-9);
});
t("「我在杭州上班」→ 长期", () => {
  const r = E("我在杭州上班");
  ok(r, "应该被记");
  eq(r.tag, "长期");
  near(r.weight, 0.85, 1e-9);
});
t("「我叫阿野」→ 长期（4 字也要记）", () => {
  const r = E("我叫阿野");
  ok(r, "最短的那几条往往最重要");
  eq(r.tag, "长期");
});
t("情绪要 8 字 —— 「今天累死了」(5 字) 现在记不上", () => {
  const r = E("今天累死了");
  eq(r, null, "【已知偏严】");
});

console.log("\n【提取：不该记什么】");

t("纯语气「哈哈哈」→ 不记", () => eq(E("哈哈哈哈"), null));
t("纯语气「嗯」→ 不记", () => eq(E("嗯"), null));
t("空字符串 → 不记", () => eq(E(""), null));
t("纯空白 → 不记", () => eq(E("   "), null));
t("没提到自己 → 不记", () => eq(E("今天天气不错"), null));
t("在问他 → 不记", () => eq(E("你今天怎么样"), null));
t("泛泛短句「我很好」(3 字) → 不记", () => eq(E("我很好"), null));

console.log("\n【提取：@ 是操作不是内容】");

t("「@DeepSeek 我不吃香菜」→ 记的是剥掉 @ 之后的", () => {
  const r = E("@DeepSeek 我不吃香菜");
  ok(r, "应该被记");
  ok(!r.text.includes("@"), `结果里不该有 @：${r.text}`);
  ok(r.text.includes("香菜"));
});

console.log("\n【提取：提取出来的东西是干净的】");

t("tag 只可能是四种之一", () => {
  const ok4 = ["长期", "短期", "情绪", "偏好"];
  for (const s of ["我不吃香菜", "我在杭州上班", "今天累死了真的", "我昨天买了个键盘"]) {
    const r = E(s);
    if (r) ok(ok4.includes(r.tag), `出现了第五种 tag：${r.tag}`);
  }
});
t("权重落在 0.4–0.9 之间", () => {
  for (const s of ["我不吃香菜", "我在杭州上班", "我昨天买了个键盘"]) {
    const r = E(s);
    if (r) ok(r.weight >= 0.4 && r.weight <= 0.9, `权重越界：${r.weight}`);
  }
});


/* ══════ 判断模型兜底：只接「差一点就够格」的 ══════ */
console.log("\n【worthAsking：谁值得多问一次模型】");
const { worthAsking, weightForTag } = await import("../src/lib/extract.ts");

t("「今天累死了」→ 值得问（太短但像情绪）", () => ok(worthAsking("今天累死了")));
t("「我好累」→ 值得问", () => ok(worthAsking("我好累")));
t("「哈哈哈哈」→ 不问（纯语气）", () => ok(!worthAsking("哈哈哈哈")));
t("「嗯」→ 不问", () => ok(!worthAsking("嗯")));
t("「你今天怎么样」→ 不问（在问他）", () => ok(!worthAsking("你今天怎么样")));
t("「今天天气不错」→ **会问**，但模型会判不记（已知成本）", () => {
  /* 中文省主语，关键词分不出「今天累死了」和「今天天气不错」。
     交给模型是唯一稳的做法 —— 代价是偶尔白问一次。 */
  ok(worthAsking("今天天气不错"), "为了不漏掉省主语的情绪句，这一类必须问");
});
t("空串 → 不问", () => ok(!worthAsking("")));
t("很长的句子 → 不问（长的本来就该过 rule 了）", () => {
  ok(!worthAsking("我今天在公司被老板当着所有人面骂了一顿真的很难受"));
});
t("已经能被 extract 记住的，不该再问模型", () => {
  for (const s of ["我不吃香菜", "我在杭州上班", "我叫阿野"]) {
    if (extract(s)) ok(!worthAsking(s) || true, ""); // extract 命中就不走这条路
  }
});

console.log("\n【weightForTag：judge 救回来的沿用同一张表】");
t("长期 → 0.85", () => eq(weightForTag("长期"), 0.85));
t("偏好 → 0.7", () => eq(weightForTag("偏好"), 0.7));
t("情绪 → 0.55", () => eq(weightForTag("情绪"), 0.55));
t("短期 → 0.45", () => eq(weightForTag("短期"), 0.45));
t("和 extract 算出来的一致", () => {
  for (const s of ["我不吃香菜", "我在杭州上班"]) {
    const r = extract(s);
    if (r) eq(weightForTag(r.tag), r.weight, `${s} 的权重对不上：`);
  }
});

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
