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

/* ══ 话题燃料 ══ */
console.log("\n── 换话题的燃料 ──");
const DAY = 86400000;
const now = Date.now();
const mkMem = (id, text, o = {}) => ({
  id, text, tag: "长期", weight: 0.6,
  accessCount: 1, lastAccessed: now - 10 * DAY,
  ...o,
});

eq("池子空了 → null（不硬凑）", C.pickFuel([], "随便聊聊"), null);
eq("全都刚想起过 → null", C.pickFuel([mkMem("a", "x", { lastAccessed: now - DAY })], "聊天"), null);
eq("accessCount 太高 → 排除", C.pickFuel([mkMem("a", "x", { accessCount: 9 })], "聊天"), null);
eq("被忘掉了 → 排除", C.pickFuel([mkMem("a", "x", { forgotten: true })], "聊天"), null);

const cands = [
  mkMem("old", "他不吃香菜", { lastAccessed: now - 60 * DAY }),
  mkMem("echo", "他说以后一定先跟我说一声", { lastAccessed: now - 5 * DAY }),
  mkMem("mid", "今天海面很安静", { lastAccessed: now - 20 * DAY }),
];
const withEcho = C.pickFuel(cands, "他说以后一定会先跟我说一声的");
eq("有呼应 → 优先呼应那条（哪怕没那么久）", withEcho && withEcho.id, "echo");

const noEcho = C.pickFuel(cands, "完全不相关的一句话");
eq("没呼应 → 越久越优先", noEcho && noEcho.id, "old");

/* ══ 重名 @ + 安静台词 ══ */
console.log("\\n── 重名与安静台词 ──");
mem.clear();
const dup = { conv: "g", members: [mk("a", "阿野"), mk("b", "阿野"), mk("c", "别人")], runtime: { round: 0, roundStartAt: Date.now(), lastAiAt: 0 },
  maxRound: 4, lastSpeakerId: "c", idleMinutes: () => 30, dynamicOf: () => ({ 心情: 90, 亲近: 90 }), echoOf: () => false };

const ambiguous = C.pickNext({ ...dup, lastText: "[@阿野] 你说呢" });
ok("重名时 @ 不瞎猜（退化成意愿）", ambiguous.kind === "speak" && ambiguous.via === "desire");

const selfOnly = C.pickNext({ ...dup, lastSpeakerId: "a", lastText: "[@阿野] 喂" });
ok("重名但只排除自己后剩一个 → 点名成立", selfOnly.kind === "speak" && selfOnly.via === "mention");

ok("刚聊完不发安静台词", C.shouldShowQuiet({ round: 0, roundStartAt: 0, lastAiAt: 0 }, Date.now() - 3600000) === false);
ok("隔 8 小时 + 今天没发过 → 发", C.shouldShowQuiet({ round: 0, roundStartAt: 0, lastAiAt: 0 }, Date.now() - 8 * 3600000) === true);
ok("今天已经发过 → 不发", C.shouldShowQuiet({ round: 0, roundStartAt: 0, lastAiAt: 0, quietShownAt: Date.now() }, Date.now() - 8 * 3600000) === false);
ok("文案池非空且都是动作描述", C.QUIET_LINES.length > 0 && C.QUIET_LINES.every((l) => l.startsWith("【")));

/* ══ 潜意识闪回：必须不是「存档回溯」 ══ */
console.log("\n── 潜意识闪回 ──");
const F = await (async () => {
  const OUT3 = path.join(ROOT, ".tmp-forgetting.mjs");
  execSync(`npx esbuild src/lib/forgetting.ts --bundle --format=esm --platform=neutral --outfile="${OUT3}"`, { cwd: ROOT, stdio: "pipe" });
  const m = await import(pathToFileURL(OUT3).href);
  fs.unlinkSync(OUT3);
  return m;
})();

const T0 = Date.now();
const AGE = 400; // 天
const mkM = (id, weight) => ({
  id, conv: "c", time: "", text: "「流浪猫」在我们楼下", source: "对话", weight,
  lastAccessed: T0 - AGE * 86400000, accessCount: 1, tag: "长期",
  at: T0 - AGE * 86400000,
});

/*
 * 用实测反推初始权重 —— 不猜衰减曲线。
 * 阈值 0.2 之上的会被夹到 p=1（那就不叫「已淡」了），所以必须落到下面。
 */
const probe = F.effectiveWeight(mkM("probe", 0.6), T0);
const factor = probe / 0.6;
const wDeep = 0.13 / factor;  // 目标 ≈ 0.13
const wNear = 0.197 / factor; // 目标 ≈ 0.197（贴着阈值）
const deep = mkM("a", wDeep);
const near = mkM("b", wNear);
const wd = F.effectiveWeight(deep, T0);
const wn = F.effectiveWeight(near, T0);

ok(`造的数据确实「已淡」：埋深 ${wd.toFixed(3)} · 贴阈值 ${wn.toFixed(3)} · 阈值 ${F.MEMORY_THRESHOLD}`,
   wd < F.MEMORY_THRESHOLD && wn < F.MEMORY_THRESHOLD);

const realRandom = Math.random;
const ASK = "楼下那只流浪猫还在吗";

// ① 词没命中 → 掷不掷都不该醒
Math.random = () => 0;
eq("词没命中 → undefined", F.residueHit([deep], "今天天气不错", T0), undefined);

// ② 命中 + 骰子给最小值 → 应该醒（证明门槛是 random < p）
eq("命中 + random=0 → 醒", F.residueHit([deep], ASK, T0)?.id, "a");

// ③ 命中 + 骰子给最大值 → **不该醒**（关键：不再是必中）
Math.random = () => 0.9999999;
eq("命中 + random≈1 → 不醒（不是存档回溯）", F.residueHit([deep], ASK, T0), undefined);

// ④ 真实随机跑 400 次 —— 必须既有醒的也有没醒的
Math.random = realRandom;
let hits = 0;
for (let i = 0; i < 400; i++) if (F.residueHit([deep], ASK, T0)) hits++;
ok(`真实随机 400 次：醒 ${hits} 次 —— 既不是 0 也不是 400`, hits > 0 && hits < 400);

// ⑤ 同一颗骰子：贴阈值的会醒，埋深的不会
Math.random = () => 0.5;
const nearAwake = !!F.residueHit([near], ASK, T0);
const deepAwake = !!F.residueHit([deep], ASK, T0);
ok(`random=0.5：贴阈值会醒（${nearAwake}）· 埋深不醒（${deepAwake}）`, nearAwake && !deepAwake);
Math.random = realRandom;

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
