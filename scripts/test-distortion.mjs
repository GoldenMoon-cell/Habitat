/**
 * 记忆的扭曲 —— 断言。
 *
 * 测的不是「话好不好听」，是那条**不能越的线**：
 *   分档要跟权重走；讲法只改口气；内容一个字不被动。
 */

import { fuzzBand, groupByBand, BAND_TITLE, BAND_HINT, NEVER_FABRICATE, BAND_CLEAR_AT, BAND_HAZY_AT } from "../src/lib/distortion.ts";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? ""} 期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg ?? "断言失败"); };

console.log("\n【分档】");

t("权重 1.0 → 清楚", () => eq(fuzzBand(1.0), "clear"));
t("权重刚好等于清楚阈值 → 清楚", () => eq(fuzzBand(BAND_CLEAR_AT), "clear"));
t("权重刚低于清楚阈值 → 大概", () => eq(fuzzBand(BAND_CLEAR_AT - 0.001), "hazy"));
t("权重刚好等于大致阈值 → 大概", () => eq(fuzzBand(BAND_HAZY_AT), "hazy"));
t("权重刚低于大致阈值 → 模糊", () => eq(fuzzBand(BAND_HAZY_AT - 0.001), "blur"));
t("权重 0.2（遗忘阈值）→ 模糊", () => eq(fuzzBand(0.2), "blur"));
t("权重 0 → 模糊", () => eq(fuzzBand(0), "blur"));
t("权重 NaN → 模糊（不崩）", () => eq(fuzzBand(NaN), "blur"));
t("权重 Infinity → 清楚（当作还活着）", () => eq(fuzzBand(Infinity), "clear"));

console.log("\n【分组】");

const items = [
  { text: "他受不了香菜", weight: 0.9 },
  { text: "那首歌", weight: 0.45 },
  { text: "明天要开会", weight: 0.24 },
  { text: "下雨那天", weight: 0.62 },
  { text: "他叫什么", weight: 0.2 },
];
const g = groupByBand(items);

t("清楚组收到 2 条", () => eq(g.clear.length, 2));
t("大概组收到 1 条", () => eq(g.hazy.length, 1));
t("模糊组收到 2 条", () => eq(g.blur.length, 2));
t("三条加起来不丢不重", () => eq(g.clear.length + g.hazy.length + g.blur.length, items.length));
t("清楚组里是那条 0.9", () => eq(g.clear[0].text, "他受不了香菜"));
t("模糊组里有 0.2 那条", () => ok(g.blur.some((m) => m.text === "他叫什么")));
t("**内容一个字没被改**", () => {
  const all = [...g.clear, ...g.hazy, ...g.blur].map((m) => m.text).sort();
  const src = items.map((m) => m.text).sort();
  eq(JSON.stringify(all), JSON.stringify(src), "分组不得改动 text：");
});

console.log("\n【讲法只改口气，不加事实】");

t("清楚组没有附加提示（不啰嗦）", () => eq(BAND_HINT.clear, null));
t("大概组的提示提到「记不太准」这类余地", () => ok(/好像|记不太准|留余地/.test(BAND_HINT.hazy)));
t("模糊组明确要求「不要编」", () => ok(/不要编|不要补/.test(BAND_HINT.blur)));
t("模糊组允许说「记不清」", () => ok(/记不清/.test(BAND_HINT.blur)));

t("三条提示都不包含具体事实/名词", () => {
  const all = [BAND_HINT.hazy, BAND_HINT.blur, NEVER_FABRICATE].join("");
  const banned = ["香菜", "炒饭", "下雨", "开会", "那首歌"];
  for (const b of banned) ok(!all.includes(b), `提示里出现了具体名词「${b}」—— 那是在替她编`);
});

t("底线句阻止「补细节」", () => ok(/不要.*补一个细节|不要为了把话说圆/.test(NEVER_FABRICATE)));

console.log("\n【标题不暴露机制】");

t("三个组标题都是第一人称口吻", () => {
  for (const b of ["clear", "hazy", "blur"]) {
    ok(/^【你.*】$/.test(BAND_TITLE[b]), `标题应形如「【你…】」，得到 ${BAND_TITLE[b]}`);
  }
});
t("标题里不出现「权重」「阈值」「band」", () => {
  const all = Object.values(BAND_TITLE).join("");
  for (const w of ["权重", "阈值", "band", "weight"]) ok(!all.includes(w));
});

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} —— ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
