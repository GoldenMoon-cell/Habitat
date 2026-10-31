/**
 * 凭据匹配的回归测试。
 *
 *   node scripts/test-credential.mjs
 *
 * 验的是「角色的模型名，能不能找到对的那套凭据」。
 * 这一步错了，用户看到的现象是「配了 API 但角色还在说假话」——
 * 最难自查的一类问题。
 *
 * 用真实数据（%APPDATA%\three-whales-space\data\current.json）。
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".tmp-cred.cjs");

const dataFile = path.join(
  process.env.APPDATA || "",
  "three-whales-space",
  "data",
  "current.json"
);

if (!fs.existsSync(dataFile)) {
  console.log(`没有数据文件（${dataFile}），先启动一次桌面版。`);
  process.exit(0);
}

const j = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const credRaw = j.data["3w:credentials"];
const personaRaw = j.data["3w:personas"];

if (!credRaw) {
  console.log("还没配过任何凭据，跳过。");
  process.exit(0);
}

const creds = JSON.parse(credRaw);
const personas = JSON.parse(personaRaw).personas;

await build({
  entryPoints: [path.join(ROOT, "src/store/credentials.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: OUT,
  logLevel: "error",
});

const store = { "3w:credentials": credRaw };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
};

const { resolveCredential } = createRequire(import.meta.url)(OUT);

/* ── 报告每个角色的绑定情况 ── */
console.log(`\n凭据 ${creds.length} 套：`);
for (const c of creds) {
  console.log(`  [${c.label}] ${c.baseUrl} · ${(c.models ?? []).length} 个模型`);
}

console.log(`\n角色 ${personas.length} 个：`);
let ok = 0;
for (const p of personas) {
  const c = resolveCredential(p.model, p.credentialId);
  if (c) ok++;
  console.log(
    `  ${c ? "✅" : "❌"} ${String(p.name).padEnd(9)} ${String(p.model).padEnd(24)} → ${
      c ? c.label : "找不到"
    }`
  );
}
console.log(`\n${ok} / ${personas.length} 个角色能拿到凭据`);

/* ── 归一化 / 前缀匹配的断言 ── */
let fail = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) fail++;
};

console.log("\n归一化与模糊匹配：");

/* 找一个具体存在的模型当基准 */
const anyModel = creds.flatMap((c) => (c.models ?? []).map((m) => m.id))[0];
if (anyModel && anyModel.includes("-")) {
  const dotted = anyModel.replace(/-/g, ".");
  check(`连字符 ↔ 点号（${anyModel} vs ${dotted}）`, !!resolveCredential(dotted));
  check(`大写下划线（${anyModel.toUpperCase().replace(/-/g, "_")}）`, !!resolveCredential(anyModel.toUpperCase().replace(/-/g, "_")));
}

/* 编的模型名绝不能命中 */
check("编造的模型名 → null", resolveCredential("totally-made-up-model-xyz") === null);

/* 前缀匹配：截掉最后一段再查 */
const familyCandidate = creds
  .flatMap((c) => (c.models ?? []).map((m) => m.id))
  .find((id) => /-\d/.test(id));
if (familyCandidate) {
  const shorter = familyCandidate.replace(/-[^-]*$/, "");
  const hit = resolveCredential(shorter);
  console.log(`  前缀探测：${shorter} → ${hit ? hit.label : "null"}`);
}

const { siblingModels } = createRequire(import.meta.url)(OUT);

/* ── 同家族备选：模型挂了的时候换谁 ── */
console.log("\n同家族备选（模型挂了自动换）：");
const claudeCred = creds.find((c) => (c.models ?? []).some((m) => /claude/i.test(m.id)));
if (claudeCred) {
  const alts = siblingModels("claude-sonnet-5-5", claudeCred.id, 3);
  console.log(`  claude-sonnet-5-5 → ${alts.join(" , ") || "(无)"}`);
  check("能给出备选", alts.length > 0);
  check("不会把自己算进去", !alts.includes("claude-sonnet-5-5"));
  check("最接近的排第一（claude-sonnet-5 一类）", /^claude-sonnet-5/.test(alts[0] ?? ""));
}
const dsCred = creds.find((c) => (c.models ?? []).some((m) => /deepseek/i.test(m.id)));
if (dsCred) {
  const alts = siblingModels("deepseek-flash", dsCred.id, 3);
  console.log(`  deepseek-flash → ${alts.join(" , ") || "(无)"}`);
  check("DeepSeek 家族有备选", alts.length > 0);
}
check("完全不存在的家族 → 空数组", siblingModels("totally-unknown-xyz-1").length === 0);

/* ── 错误归类 ── */
const OUT2 = path.join(ROOT, ".tmp-llmerr.cjs");
await build({
  entryPoints: [path.join(ROOT, "src/lib/llmError.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: OUT2,
  logLevel: "error",
});
const { explainLlmError } = createRequire(import.meta.url)(OUT2);

console.log("\n错误归类：");
const errCases = [
  [
    'Error: 503: {"error":{"message":"No available accounts: no available accounts supporting model: claude-sonnet-5-5 (chan)"}}',
    "channel",
    true,
  ],
  ['429 {"error":{"message":"rate limit exceeded"}}', "ratelimit", true],
  ['400 {"error":{"message":"This model\'s maximum context length is 65536 tokens"}}', "context", false],
  ['401 {"error":{"message":"Invalid API key"}}', "auth", false],
  ['404 {"error":{"message":"The model gpt-9 does not exist"}}', "model", true],
  ["TypeError: fetch failed", "network", true],
  ["something completely unexpected", "unknown", false],
];

for (const [raw, wantKind, wantRetry] of errCases) {
  const r = explainLlmError(raw);
  const ok = r.kind === wantKind && r.retryable === wantRetry;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${wantKind.padEnd(10)} retry=${r.retryable}  ${r.brief.slice(0, 40)}`);
  if (!ok) {
    console.log(`        期望 kind=${wantKind} retryable=${wantRetry}，实际 kind=${r.kind} retryable=${r.retryable}`);
    fail++;
  }
}

fs.rmSync(OUT, { force: true });
fs.rmSync(OUT2, { force: true });

console.log(`\n${fail === 0 ? "断言全部通过" : `${fail} 项失败`}\n`);
process.exit(fail === 0 ? 0 : 1);
