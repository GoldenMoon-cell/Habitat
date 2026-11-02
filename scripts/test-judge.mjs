/**
 * judge.ts 的行为验证。
 *
 * 重点**不是**「模型答得好不好」—— 那个只有接真 Key 才知道。
 * 重点是：**模型答得离谱时，这套校验能不能挡住。**
 *
 * 所以这里全程用假的 `call`，想让它返回什么就返回什么。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".tmp-judge.mjs");

execSync(
  `npx esbuild src/lib/judge.ts --bundle --format=esm --platform=neutral --outfile="${OUT}"`,
  { cwd: ROOT, stdio: "pipe" }
);

const J = await import(pathToFileURL(OUT).href);
fs.unlinkSync(OUT);

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n     期望 ${JSON.stringify(want)}\n     实际 ${JSON.stringify(got)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/* ── 一份标准输入 ── */
const INPUT = {
  candidates: [
    { id: "jingjing", name: "鲸鲸", desire: 0.79 },
    { id: "lanxi", name: "澜汐", desire: 0.41 },
  ],
  recent: [
    { who: "我", text: "你们今天都在干嘛" },
    { who: "鲸鲸", text: "在翻以前的东西" },
  ],
  fuels: [{ id: "m1", text: "他说以后一定先跟我说一声", tag: "长期" }],
  heatBand: "cooling",
  ownerName: "阿野",
};

const fake = (reply) => async () => reply;
const input = (over = {}) => ({ ...INPUT, ...over });

console.log("\n── 合法输出 ──");
eq("不开口 → 合法结果",
  await J.judge(input(), { call: fake('{"speak":false}') }),
  { speak: false, intent: "quiet", memory: null });

const spoke = await J.judge(input(), { call: fake('{"speak":true,"who":"jingjing","intent":"reply"}') });
eq("点名候选人 → 通过", spoke && spoke.who, "jingjing");
eq("intent 保留", spoke && spoke.intent, "reply");

const withFuel = await J.judge(input(), {
  call: fake('{"speak":true,"who":"lanxi","intent":"new_topic","fuelId":"m1"}'),
});
eq("燃料在候选里 → 保留", withFuel && withFuel.fuelId, "m1");

console.log("\n── 模型胡说八道的时候 ──");
eq("点了不在候选里的人 → 作废",
  await J.judge(input(), { call: fake('{"speak":true,"who":"不存在的人"}') }), null);

eq("燃料不在候选里 → 丢掉燃料，但判断仍有效",
  (await J.judge(input(), { call: fake('{"speak":true,"who":"jingjing","fuelId":"编的"}') }))?.fuelId,
  undefined);

eq("speak=true 但没有 who → 作废",
  await J.judge(input(), { call: fake('{"speak":true}') }), null);

eq("不是 JSON → 作废", await J.judge(input(), { call: fake("我觉得鲸鲸应该说") }), null);
eq("空字符串 → 作废", await J.judge(input(), { call: fake("") }), null);

const fenced = await J.judge(input(), {
  call: fake('好的，这是结果：\n```json\n{"speak":true,"who":"lanxi"}\n```\n以上。'),
});
eq("带围栏和前后废话 → 也能抠出来", fenced && fenced.who, "lanxi");

console.log("\n── 失败必须降级，不能往上抛 ──");
eq("call 抛异常 → null",
  await J.judge(input(), { call: async () => { throw new Error("网络挂了"); } }), null);

eq("超时 → null",
  await J.judge(input(), {
    call: () => new Promise((r) => setTimeout(() => r('{"speak":true,"who":"jingjing"}'), 5000)),
    timeoutMs: 60,
  }), null);

eq("没有候选人 → 干脆不问", await J.judge(input({ candidates: [] }), { call: fake("{}") }), null);

console.log("\n── 记忆审核（规则当审核者）──");
eq("太短（2 字）→ 不收", J.reviewMemory({ text: "他辣" }), null);
eq("偏好类 4 字 → 收（这是有用的事实）",
  J.reviewMemory({ text: "他不吃辣", tag: "偏好" })?.text, "他不吃辣");
eq("非短期类要 8 字：6 字 → 不收",
  J.reviewMemory({ text: "他说他要走了", tag: "短期" }), null);
eq("短期类 8 字以上 → 收",
  J.reviewMemory({ text: "他说他下周三要去一趟杭州", tag: "短期" })?.tag, "短期");
eq("没有第一人称 → 不收",
  J.reviewMemory({ text: "香菜是一种很常见的调味蔬菜" }), null);
eq("是问句 → 不收",
  J.reviewMemory({ text: "他说他明天会不会来？" }), null);
eq("在问他 → 不收",
  J.reviewMemory({ text: "你觉得他这个人到底怎么样呢" }), null);
eq("不是对象 → 不收", J.reviewMemory("他说他不吃香菜"), null);

eq("tag 不在四个值里 → 收敛到「短期」",
  J.reviewMemory({ text: "他说他下周三要去一趟杭州", tag: "工作" })?.tag, "短期");
eq("tag 缺省 → 短期",
  J.reviewMemory({ text: "他说他下周三要去一趟杭州" })?.tag, "短期");
eq("四个合法值都保留",
  ["长期","短期","情绪","偏好"].map((t) => J.reviewMemory({ text: "他说他下周三要去一趟杭州", tag: t })?.tag),
  ["长期","短期","情绪","偏好"]);

const good = J.reviewMemory({ text: "他说他受不了香菜的味道", tag: "偏好" });
eq("具体、第一人称、不是问句 → 收", good && good.tag, "偏好");
ok("超长会截断到 120 字",
  J.reviewMemory({ text: "他说".concat("很长的内容".repeat(60)) }).text.length <= 120);

console.log("\n── 提示词里只有本地给的东西 ──");
const msgs = J.buildJudgeMessages(INPUT);
const body = msgs.map((m) => m.content).join("\n");
ok("候选人 id 在里面", body.includes("jingjing"));
ok("燃料 id 在里面", body.includes("m1"));
ok("最近的对话在里面", body.includes("在翻以前的东西"));
ok("写死了「只能从这里选」", body.includes("只能从这里选"));
ok("写死了「宁可漏，不要编」", body.includes("宁可漏，不要编"));

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
