/**
 * 验证 L1 的否定句和程度词处理。
 * 直接打包 personaModifier.ts 在 node 里跑。
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".tmp-mod.cjs");

await build({
  entryPoints: [path.join(ROOT, "src/data/personaModifier.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: OUT,
  logLevel: "error",
});

const { analyzePersonaConfig } = createRequire(import.meta.url)(OUT);

const meta = { label: "测试", source: "local", origin: "/tmp/test.md" };

const CASES = [
  ["撒娇", "纯正向：幽默应该涨"],
  ["不要撒娇，保持专业", "否定：幽默应该降"],
  ["非常黏人", "强程度：共鸣涨得多"],
  ["有点黏人", "弱程度：共鸣涨得少"],
  ["撒娇但要克制，不要太过撒娇", "正负拉扯：净效果接近 0"],
  ["黏人黏人黏人", "重复三次：有折扣，不该线性翻三倍"],
  ["全栈运维，部署和回滚都要管", "工程域：严谨涨"],
  ["不要寒暄，直接给结果", "明确的负向规则"],
];

let fail = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) fail++;
};

for (const [text, note] of CASES) {
  const r = analyzePersonaConfig(text, "jingjing", meta);
  const axes = Object.entries(r.byAxis)
    .map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`)
    .join(" ") || "(无变化)";
  console.log(`\n「${text}」  —— ${note}`);
  console.log(`  ${axes}`);
  if (r.deltas.length > 0) {
    console.log(`  依据: ${r.deltas.map((d) => `${d.reason}(${d.amount})`).join(" / ")}`);
  }
}

/* 关键断言 */
console.log("\n=== 断言 ===");

const neg = analyzePersonaConfig("不要撒娇，保持专业", "jingjing", meta);
check("「不要撒娇」→ 幽默是负的", (neg.byAxis["幽默"] ?? 0) < 0);

const pos = analyzePersonaConfig("撒娇", "jingjing", meta);
check("「撒娇」→ 幽默是正的", (pos.byAxis["幽默"] ?? 0) > 0);

const strong = analyzePersonaConfig("非常黏人", "jingjing", meta);
const weak = analyzePersonaConfig("有点黏人", "jingjing", meta);
check(
  `强程度 > 弱程度（${strong.byAxis["共鸣"]} vs ${weak.byAxis["共鸣"]}）`,
  (strong.byAxis["共鸣"] ?? 0) > (weak.byAxis["共鸣"] ?? 0)
);

const repeat1 = analyzePersonaConfig("黏人", "jingjing", meta);
const repeat3 = analyzePersonaConfig("黏人黏人黏人", "jingjing", meta);
check(
  `重复有折扣（1次=${repeat1.byAxis["共鸣"]} 3次=${repeat3.byAxis["共鸣"]}）`,
  (repeat3.byAxis["共鸣"] ?? 0) <= (repeat1.byAxis["共鸣"] ?? 0) * 2
);

const mixed = analyzePersonaConfig("撒娇但要克制，不要太过撒娇", "jingjing", meta);
check(
  `正负拉扯后接近 0（幽默=${mixed.byAxis["幽默"] ?? 0}）`,
  Math.abs(mixed.byAxis["幽默"] ?? 0) <= 5
);

fs.rmSync(OUT, { force: true });
console.log(`\n${fail === 0 ? "全部通过" : `${fail} 项失败`}`);
process.exit(fail === 0 ? 0 : 1);
