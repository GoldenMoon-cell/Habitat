/**
 * conversation.ts 的行为验证。
 *
 * 不需要测试框架：esbuild（vite 自带）把 TS 打成 mjs，再裸 node 跑断言。
 *
 * 验的是 docs/proactive.md §8 那条验收表里**能纯逻辑验**的部分 ——
 * 剩下的（真的跟模型说话）只能在应用里点。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".tmp-conversation.mjs");

execSync(
  `npx esbuild src/lib/conversation.ts --bundle --format=esm --platform=neutral --outfile="${OUT}"`,
  { cwd: ROOT, stdio: "pipe" },
);

/* localStorage 桩 —— 模块用它存轮次状态和 @ 链 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const C = await import(pathToFileURL(OUT).href);
fs.unlinkSync(OUT);

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n     期望 ${JSON.stringify(want)}\n     实际 ${JSON.stringify(got)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

console.log("\n── 热度 ──");
const base = { round: 0, roundStartAt: Date.now(), lastAiAt: 0 };
eq("第 0 句 → 热度 1.0", C.heatOf(base), 1);
eq("第 4 句 → 热度 0.2", C.heatOf({ ...base, round: 4 }), 0.2);
eq("第 5 句 → 热度夹到 0", C.heatOf({ ...base, round: 5 }), 0);
eq("band(1.0) = open", C.bandOf(1), "open");
eq("band(0.5) = cooling", C.bandOf(0.5), "cooling");
eq("band(0.2) = cold", C.bandOf(0.2), "cold");

console.log("\n── @ 解析 ──");
eq("方括号能解析", C.parseMentions("那你呢 [@澜汐] 你怎么看"), ["澜汐"]);
eq("裸 @ 不算", C.parseMentions("那你呢 @澜汐 你怎么看"), []);
eq("多个 @", C.parseMentions("[@澜汐] [@鲸鲸]"), ["澜汐", "鲸鲸"]);
eq("一个字都没有", C.parseMentions("今天海面很安静"), []);
eq("显示时去括号", C.stripMentionBrackets("[@澜汐] 你怎么看"), "@澜汐 你怎么看");

console.log("\n── 互 @ 死循环 ──");
mem.clear();
ok("第 1 次允许", C.allowMention("a", "b"));
C.recordMention("a", "b");
ok("第 2 次允许", C.allowMention("a", "b"));
C.recordMention("a", "b");
ok("第 3 次拒绝（同一对）", !C.allowMention("a", "b"));
ok("换一对仍然允许", C.allowMention("a", "c"));

console.log("\n── 意愿 ──");
const hot = C.desireOf({
  persona: {}, dynamic: { 心情: 90, 亲近: 90 },
  idleMin: 30, mentioned: false, memoryEcho: false, justSpoke: false,
});
const cold = C.desireOf({
  persona: {}, dynamic: { 心情: 20, 亲近: 15 },
  idleMin: 2, mentioned: false, memoryEcho: false, justSpoke: false,
});
ok(`心情/亲近都高 → 想说（${hot.toFixed(2)} > 0.55）`, hot > C.DESIRE_THRESHOLD);
ok(`心情/亲近都低 → 不想说（${cold.toFixed(2)} < 0.55）`, cold < C.DESIRE_THRESHOLD);

const mentioned = C.desireOf({
  persona: {}, dynamic: { 心情: 50, 亲近: 50 },
  idleMin: 30, mentioned: true, memoryEcho: false, justSpoke: false,
});
ok(`被提到了 → 意愿明显更高（${mentioned.toFixed(2)}）`, mentioned > 0.55);

const neverSpoke = C.desireOf({
  persona: {}, dynamic: { 心情: 85, 亲近: 80 },
  idleMin: Infinity, mentioned: false, memoryEcho: false, justSpoke: false,
});
ok(`从没开过口 → 沉默给满分（${neverSpoke.toFixed(2)} > 0.55）`, neverSpoke > C.DESIRE_THRESHOLD);

const justSpoke = C.desireOf({
  persona: {}, dynamic: { 心情: 90, 亲近: 90 },
  idleMin: 30, mentioned: false, memoryEcho: false, justSpoke: true,
});
ok(`刚说过 → 比没说过低（${justSpoke.toFixed(2)}）`, justSpoke < hot);

console.log("\n── 选人 ──");
mem.clear(); /* 清掉上一段留下的 @ 链，否则会污染「点名」用例 */
const mk = (id, name) => ({ id, name, handle: `@${id}` });

const pick = (over) =>
  C.pickNext({
    conv: "g1",
    members: [mk("a", "鲸鲸"), mk("b", "澜汐")],
    runtime: { round: 0, roundStartAt: Date.now(), lastAiAt: 0 },
    maxRound: 4,
    lastText: "",
    lastSpeakerId: "a",
    idleMinutes: () => 30,
    dynamicOf: () => ({ 心情: 90, 亲近: 90 }),
    echoOf: () => false,
    ...over,
  });

eq("到上限 → 停", pick({ runtime: { round: 4, roundStartAt: Date.now(), lastAiAt: 0 } }), { kind: "quiet", reason: "cap" });
/* 热度冷 + 上限放宽到 6 —— 否则先撞上限，测不到 cold 这一档 */
eq("热度凉了 → 停（round 4 / 上限 6）", pick({ maxRound: 6, runtime: { round: 4, roundStartAt: Date.now(), lastAiAt: 0 } }), { kind: "quiet", reason: "cold" });
ok("上限 4 时先撞上限，不是 cold", pick({ maxRound: 4, runtime: { round: 4, roundStartAt: Date.now(), lastAiAt: 0 } }).reason === "cap");

const byMention = pick({ lastText: "[@澜汐] 你说呢" });
eq("被点名 → 点名的人接", byMention.kind === "speak" && byMention.persona.id, "b");
eq("被点名 → via=mention", byMention.kind === "speak" && byMention.via, "mention");

const selfMention = pick({ lastText: "[@鲸鲸] 我自己说" });
eq("不能 @ 自己 → 退化成意愿", selfMention.kind === "speak" && selfMention.via, "desire");

const outsider = pick({ lastText: "[@不存在的人] 喂" });
ok("@ 不在群里的人 → 忽略，不报错", outsider.kind === "speak" && outsider.via === "desire");

eq("没人有话说 → 停", pick({ dynamicOf: () => ({ 心情: 10, 亲近: 10 }), idleMinutes: () => 1 }),
  { kind: "quiet", reason: "no-desire" });

eq("空群 → 停", pick({ members: [] }), { kind: "quiet", reason: "empty" });

/* ══ sanitize：脏数据不能把 UI 搞崩 ══ */
console.log("\n── 数据容错 ──");
const S = await (async () => {
  const OUT2 = path.join(ROOT, ".tmp-sanitize.mjs");
  execSync(`npx esbuild src/lib/sanitize.ts --bundle --format=esm --platform=neutral --outfile="${OUT2}"`, { cwd: ROOT, stdio: "pipe" });
  const m = await import(pathToFileURL(OUT2).href);
  fs.unlinkSync(OUT2);
  return m;
})();

eq("群：缺 id → 丢掉", S.sanitizeGroups([{ name: "x" }]), []);
eq("群：缺 name → 补默认名", S.sanitizeGroups([{ id: "g", members: [] }])[0].name, "未命名群");
eq("群：members 不是数组 → 空数组", S.sanitizeGroups([{ id: "g", name: "n", members: "oops" }])[0].members, []);
eq("群：members 含 null → 过滤", S.sanitizeGroups([{ id: "g", name: "n", members: ["a", null, "b"] }])[0].members, ["a", "b"]);
eq("群：整条不是对象 → 丢掉", S.sanitizeGroups([null, 42, "x"]), []);
eq("群：缺 at → 补当前时间", typeof S.sanitizeGroups([{ id: "g", name: "n", members: [] }])[0].at, "number");

const dirty = S.sanitizePersona({ id: "p", name: "甲" });
ok("角色：缺 tags → 补空数组（tags.map 崩过）", Array.isArray(dirty.tags) && dirty.tags.length === 0);
ok("角色：缺 axes → 四轴都在", dirty.axes && typeof dirty.axes.共鸣 === "number");
ok("角色：缺 evidence → 待补", dirty.evidence.focus === "待补");
eq("角色：缺 id 或 name → 丢掉", S.sanitizePersonas([{ id: "p" }, { name: "n" }, {}]), []);

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
