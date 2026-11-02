/**
 * bubbles.ts —— 拆分规则的行为验证。
 *
 * 这块最容易做坏，而且坏了很难看出来（只是「感觉怪」）。
 * 所以把判断都写成断言。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".tmp-bubbles.mjs");
execSync(
  `npx esbuild src/lib/bubbles.ts --bundle --format=esm --platform=neutral --outfile="${OUT}"`,
  { cwd: ROOT, stdio: "pipe" }
);
const B = await import(pathToFileURL(OUT).href);
fs.unlinkSync(OUT);

let pass = 0, fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}\n     期望 ${JSON.stringify(want)}\n     实际 ${JSON.stringify(got)}`); }
};
const ok = (n, c) => eq(n, !!c, true);

console.log("\n── 不该拆的时候 ──");
eq("空字符串", B.splitBubbles(""), []);
eq("很短的回复不拆", B.splitBubbles("嗯？我在。"), ["嗯？我在。"]);
eq("短但多段的也不拆（< 42 字）", B.splitBubbles("好。\n我在。"), ["好。\n我在。"]);
eq("一整段没有换行 → 不拆",
  B.splitBubbles("我今天基本啥也没干，睡到快中午才爬起来，下午晒了会儿太阳，顺手把窗台那堆杂物清了。"),
  ["我今天基本啥也没干，睡到快中午才爬起来，下午晒了会儿太阳，顺手把窗台那堆杂物清了。"]);

console.log("\n── 该拆的时候 ──");
const two = B.splitBubbles(
  "我在家收拾阳台那几盆快被我养死的花，剪了一地叶子，手都是泥😂\n\n有盆居然冒新芽了，我差点当场给它鼓掌。"
);
eq("空行分段 → 拆成两个", two.length, 2);
ok("第一段完整", two[0].startsWith("我在家收拾阳台"));
ok("第二段完整", two[1].startsWith("有盆居然冒新芽"));

const three = B.splitBubbles(
  "等一下啊，我想想怎么说。\n\n我觉得这事不对，不是你想的那个方向。\n\n你们怎么看？"
);
eq("三段 → 三个", three.length, 3);
eq("最后一句独立", three[2], "你们怎么看？");

console.log("\n── 边界 ──");
const tooMany = B.splitBubbles(
  "第一段内容够长了可以独立存在。\n\n第二段内容也够长了可以独立。\n\n第三段同样够长了。\n\n第四段也够长了呢。\n\n第五段。"
);
ok(`最多 3 个（实际 ${tooMany.length}）`, tooMany.length <= 3);
ok("超出的部分没有丢", tooMany.join(" ").includes("第五段"));

const shortTail = B.splitBubbles(
  "我今天出去走了走，风挺舒服的，回来路上买了点吃的。\n\n好的。"
);
eq("结尾的短句并进上一段", shortTail.length, 1);

const shortHead = B.splitBubbles(
  "嗯。\n\n我今天基本啥也没干，睡到快中午才爬起来，下午晒了会儿太阳。"
);
eq("开头的短句并进下一段", shortHead.length, 1);
ok("短句内容没丢", shortHead[0].includes("睡到快中午"));

console.log("\n── 延迟 ──");
/* 固定随机数 —— 不然「越靠后越短」会被随机抖动打挂 */
const rr3 = Math.random;
Math.random = () => 0.5;
const d0 = B.bubbleDelay(0), d1 = B.bubbleDelay(1), d2 = B.bubbleDelay(2);
Math.random = rr3;
ok(`第 0 个间隔在 780–1400（${d0}）`, d0 >= 780 && d0 <= 1400);
ok(`越靠后越短（${d0} → ${d1} → ${d2}）`, d1 <= d0 && d2 <= d1);
ok("不会短到 0", d2 > 300);

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
