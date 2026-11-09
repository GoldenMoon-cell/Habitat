/**
 * 星图的边界 —— 断言。
 *
 * 补的是代码审查指出、而原有测试完全没覆盖的几条：
 *
 *   ① 数据隔离：一个角色没记忆时，星图不能拿别人的记忆顶上
 *       （v0.3 加了星图内的角色切换之后，这条从「显示问题」变成「串门」）
 *
 *   ② 反推的边界：时间轴能算的是「lastAccessed 之后」那段；
 *       之前那段它假定记忆一直满着 —— 这条测出来是为了让这个假定
 *       写在测试里，而不是只写在注释里
 *
 *   ④ 散开不落盘 / 按住会落盘：两边的不对称本身是设计选择，
 *       但「哪一边动了存储」必须固定住，否则改一次就悄悄变味
 *
 * 跑：npm run test:starmap
 */

/* starMapData 和 memoryNotes 都走 localStorage。node 里没有，给一个最小的。 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};

const { collectForMap, shouldDissolve } = await import("../src/lib/starMapData.ts");
const { effectiveWeight } = await import("../src/lib/forgetting.ts");
const { promoteMemory } = await import("../src/lib/memoryNotes.ts");
const { makeEpochGate, releaseTyping } = await import("../src/lib/replyGate.ts");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ""} 期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m ?? "断言失败"); };

const DAY = 86400000;
const NOW = 1_700_000_000_000;

const mem = (o) => ({
  id: "x", conv: "jingjing", text: "一句话", source: "她说的",
  weight: 0.7, at: NOW - 10 * DAY, lastAccessed: NOW - DAY, accessCount: 1,
  tag: "偏好", ...o,
});

const seed = (list) => {
  store.clear();
  store.set("3w:memories", JSON.stringify(list));
};

console.log("\n① 数据隔离 —— 没记忆的角色不能拿到别人的\n");

t("角色私聊只返回自己的记忆", () => {
  seed([
    mem({ id: "a1", conv: "jingjing" }),
    mem({ id: "b1", conv: "lanxi" }),
    mem({ id: "b2", conv: "lanxi" }),
  ]);
  const got = collectForMap("jingjing");
  eq(got.length, 1, "条数");
  eq(got[0].id, "a1", "应该只有自己的那条");
});

t("★ 没有记忆的角色返回空，不回退到全部", () => {
  seed([
    mem({ id: "a1", conv: "jingjing" }),
    mem({ id: "b1", conv: "lanxi" }),
  ]);
  /* 这条是审查 ① 的核心：v0.3 之前这里会返回 jingjing 的记忆。
     星图内换角色之后，那等于「切到乙，看到甲对你说的话」。 */
  const got = collectForMap("yetan");
  eq(got.length, 0, "一个陌生角色应该是空海");
});

t("群聊里没有任何会话的记忆时也是空", () => {
  seed([]);
  eq(collectForMap("group").length, 0, "空");
});

t('显式的 "*" 仍然能读全部（这是「查看全部」，不是兜底）', () => {
  seed([
    mem({ id: "a1", conv: "jingjing" }),
    mem({ id: "b1", conv: "lanxi" }),
  ]);
  eq(collectForMap("*").length, 2, "全部");
});

t("坏数据不炸，返回空", () => {
  store.clear();
  store.set("3w:memories", "{ 这不是 json");
  eq(collectForMap("*").length, 0, "解析失败当空");
});

console.log("\n② 反推的边界 —— 它算的是「之后」，之前是假定\n");

t("lastAccessed 之后：越久越轻（这段是准的）", () => {
  const m = mem({ weight: 1, lastAccessed: NOW - 30 * DAY, accessCount: 0 });
  const now = effectiveWeight(m, NOW);
  const later = effectiveWeight(m, NOW + 30 * DAY);
  ok(later < now, `30 天后应更轻：${later.toFixed(3)} vs ${now.toFixed(3)}`);
});

t("★ lastAccessed 之前：一律按满权重算（这就是「反推」的假定）", () => {
  /* 一条今天刚被想起的记忆，回看 30 天前 —— 会显示成满的。
     不是它真的满，是数据里没有更早的信息。这条测住这个假定，
     免得以后有人把它当成「历史回放」来用。 */
  const m = mem({ weight: 0.8, lastAccessed: NOW - DAY, accessCount: 5 });
  const past = effectiveWeight(m, NOW - 30 * DAY);
  const now = effectiveWeight(m, NOW);
  eq(past, 0.8, "回看时取到初始权重 = 满的");
  ok(past > now, "而且比现在更重 —— 反推偏乐观");
});

t("从过去走向现在，权重单调递减（不会突然回光返照）", () => {
  /* 注意方向：d 从 60 递减到 0，也就是时间从「60 天前」走向「现在」。
     越接近现在，权重越小 —— 所以断言是 w <= prev，不是 w >= prev。
     第一版写反了，是测试的错，不是代码的错。 */
  const m = mem({ weight: 0.6, lastAccessed: NOW - 5 * DAY, accessCount: 2 });
  let prev = Infinity;
  for (let d = 60; d >= 0; d -= 10) {
    const w = effectiveWeight(m, NOW - d * DAY);
    ok(w <= prev + 1e-9, `${d} 天前反而变重了：${w} > ${prev}`);
    prev = w;
  }
});

console.log("\n④ 散开 / 按住 —— 只有「按住」动存储\n");

t("★ 按住（promoteMemory）真的写回权重 —— +0.15，封顶 1", () => {
  seed([mem({ id: "keep", conv: "jingjing", weight: 0.4, accessCount: 1 })]);
  promoteMemory("keep");
  const after = JSON.parse(store.get("3w:memories"))[0];
  eq(after.weight, 0.55, "0.4 + 0.15");
});

t("按住不增「被想起次数」—— 它是一次手动提权，不是一次回忆", () => {
  /* 这条容易误解：accessCount 决定**衰减速率**（复习越多次掉得越慢），
     而 promoteMemory 只抬当前权重，不碰它。
     所以「按住」= 把它提亮一次，不等于「她多想起来了一次」。
     文案「按住会让它重一点」说的正是这个，没说成「她会记得更久」。 */
  seed([mem({ id: "keep", conv: "jingjing", weight: 0.4, accessCount: 1 })]);
  promoteMemory("keep");
  const after = JSON.parse(store.get("3w:memories"))[0];
  eq(after.accessCount, 1, "想起次数不该变");
});

t("按住能把已淡去的捞回来（forgotten 清掉）", () => {
  seed([mem({ id: "back", conv: "jingjing", weight: 0, forgotten: true })]);
  promoteMemory("back");
  const after = JSON.parse(store.get("3w:memories"))[0];
  eq(after.forgotten, false, "不再算忘记");
  ok(after.weight > 0, "权重要有值");
});

t("散开不动存储（重开按存档重新生成 —— 这是 v0.3 的现状，写死它）", () => {
  seed([mem({ id: "fade", conv: "jingjing", weight: 0.19, lastAccessed: NOW - 40 * DAY })]);
  const snapshot = store.get("3w:memories");
  /* 星图里的散开是引擎内存状态（s.mass / aLostAt），没有任何写盘路径。
     这里不调用任何东西，就是断言「没有别的函数偷偷改它」。 */
  ok(shouldDissolve(JSON.parse(snapshot)[0], NOW), "这条本来就该散");
  eq(store.get("3w:memories"), snapshot, "存储不该被动过");
});

t("shouldDissolve：权重低但最近还想起过的不该散", () => {
  /* 只看权重会把「还能活几天」的记忆按死。 */
  const fresh = mem({ weight: 0.19, lastAccessed: NOW - DAY, accessCount: 3 });
  ok(!shouldDissolve(fresh, NOW), "刚想起过的别散");
});

t("shouldDissolve：固化 / 里程碑 / 改名的不散", () => {
  const old = NOW - 100 * DAY;
  ok(!shouldDissolve(mem({ weight: 0.05, lastAccessed: old, consolidated: true }), NOW), "固化的不散");
  ok(!shouldDissolve(mem({ weight: 0.05, lastAccessed: old, reason: "milestone" }), NOW), "里程碑不散");
  ok(!shouldDissolve(mem({ weight: 0.05, lastAccessed: old, reason: "rename" }), NOW), "改名不散");
  ok(!shouldDissolve(mem({ weight: 0.05, lastAccessed: old, forgotten: true }), NOW), "已经忘了的不散");
});

console.log("\n③ 回复代次 —— 切走的会话不该再回话\n");

t("开工时开的票，换代之后作废", () => {
  const g = makeEpochGate();
  const ticket = g.ticket();
  ok(!g.stale(ticket), "还没换代，票有效");
  g.bump();
  ok(g.stale(ticket), "换代之后，旧票作废");
});

t("★ 一条卡在 await 里的回复，切走之后回来会被丢掉", () => {
  /* 这是审查指出、而清定时器拦不住的那种：
     定时器清得掉「还没开始的」，清不掉「已经在路上的」。 */
  const g = makeEpochGate();
  const ticket = g.ticket();          // scheduleReply 开工
  // …… await 模型（模拟：期间用户切走了）
  g.bump();                            // 换会话
  // …… 模型回来
  eq(g.stale(ticket), true, "必须判过期，否则会往旧会话写");
});

t("没切走的话不会误杀自己的回复", () => {
  const g = makeEpochGate();
  const ticket = g.ticket();
  for (let i = 0; i < 5; i++) void 0;  // 期间没有任何换代
  eq(g.stale(ticket), false, "同一代内不该丢");
});

t("切走再切回来 —— 之前那张票仍然是废的", () => {
  /* 不能靠「又回到了同一个会话」来判定有效：
     那条回复是上一次进去时的上下文，回来已经不该再冒出来。 */
  const g = makeEpochGate();
  const ticket = g.ticket();
  g.bump();  // 切到 B
  g.bump();  // 切回 A
  eq(g.stale(ticket), true, "两次换代之后旧票仍作废");
});

t("每次换代只作废旧票，新票有效", () => {
  const g = makeEpochGate();
  g.bump();
  const fresh = g.ticket();
  eq(g.stale(fresh), false, "新开的是有效的");
});

t("多张并发票：换代一起作废", () => {
  const g = makeEpochGate();
  const a = g.ticket(), b = g.ticket(), c = g.ticket();
  g.bump();
  ok(g.stale(a) && g.stale(b) && g.stale(c), "三张都作废");
});

t("★ 接力在判断模型等待期间切走 → 不发起下一轮", () => {
  /* autoTimer 里有个 await judge(...)，几秒。
     期间切走的话，「发起 reply」这一步必须被挡住 ——
     否则 scheduleReply 会在新一代里开一张有效票，旧群照样回话。
     所以票要在那段开头就开，judge 回来之后验。 */
  const g = makeEpochGate();
  const autoTicket = g.ticket();      // autoTimer 开头
  g.bump();                            // await judge 期间用户切走
  eq(g.stale(autoTicket), true, "judge 回来后不该发起 scheduleReply");
});

t("没切走的话，judge 回来照常发起下一轮", () => {
  const g = makeEpochGate();
  const autoTicket = g.ticket();
  eq(g.stale(autoTicket), false, "不该误拦");
});

t("★ 过期请求只清自己的 typing，不动新会话的", () => {
  /* 无条件 setTyping(null) 会把新会话的「正在想」掐掉，
     而队列出口靠 typing 调度 —— 于是一个过期请求
     把另一个会话的节奏打乱了。 */
  const mine = { conv: "甲", ticket: 3, requestId: 7 };
  eq(releaseTyping(mine, mine, []), null, "自己的 → 清");
  const other = releaseTyping(
    { conv: "乙", ticket: 1, requestId: 4 },
    mine,
    [],
  );
  eq(other?.conv, "乙", "别人的 → 会话不该变");
  eq(other?.ticket, 1, "别人的 → 票不该变");
  eq(other?.requestId, 4, "别人的 → 请求不该变");
  eq(releaseTyping(null, mine, []), null, "本来就空 → 还是空");
});

t("★ 切走再切回同一会话：id 对上了，但不是同一代 —— 不能清", () => {
  /* 这是最容易漏的一种：
       A 的旧请求在等 → 切到 B → 切回 A → A 发起新回复（typing 标成 A，ticket=5）
       → A 的旧请求（ticket=2）返回
     id 一样，但票不同。只比 id 的话，旧请求会把新请求的状态清掉，
     然后 A 的队列提前放出去。 */
  const cur = { conv: "A", ticket: 5, requestId: 12 };      // 新请求占着
  const oldReq = { conv: "A", ticket: 2, requestId: 8 };    // 旧请求回来了
  eq(releaseTyping(cur, oldReq, []), cur, "旧票不许清新票");
});

t("同一张票、同一个会话才清得掉", () => {
  const cur = { conv: "A", ticket: 5, requestId: 12 };
  eq(releaseTyping(cur, cur, []), null, "对上了 → 清");
  eq(releaseTyping(cur, { conv: "A", ticket: 5, requestId: 13 }, []), cur, "请求不对 → 不动");
  eq(releaseTyping(cur, { conv: "A", ticket: 6, requestId: 12 }, []), cur, "票不对 → 不动");
  eq(releaseTyping(cur, { conv: "B", ticket: 5, requestId: 12 }, []), cur, "会话不对 → 不动");
});

t("同一会话同一代有并发请求时，结束一条仍保留另一条的 typing", () => {
  const first = { conv: "群", ticket: 9, requestId: 21 };
  const second = { conv: "群", ticket: 9, requestId: 22 };
  eq(releaseTyping(first, first, [second]), second, "第二条仍运行，typing 不能清");
  eq(releaseTyping(second, first, [second]), second, "非当前请求结束不改变当前标记");
  eq(releaseTyping(second, second, []), null, "最后一条结束后才能清");
});

console.log(`\n${fail === 0 ? "通过" : "失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
