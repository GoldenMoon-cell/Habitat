/**
 * 导入语义的回归测试。
 *
 *   node scripts/test-import.mjs
 *
 * 为什么不放在浏览器里跑：
 *   这里要验的是「导入一个文件会不会把用户的东西弄丢」。
 *   那是纯逻辑，跟 React、跟 UI 都没关系，用 Node 跑最快也最稳。
 *
 * 做法：把 src/lib/persist.ts 用 esbuild 打成一个 cjs，塞一套假 localStorage
 * 进去，然后对着**真实的数据文件**跑断言。
 *
 * 用真实文件而不是手编的样本：手编样本只会验到「我以为的文件长什么样」。
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".tmp-persist.cjs");

/* ── 挑一个真实的数据文件 ── */
const dataDir = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "three-whales-space",
  "data"
);

function pickDataFile() {
  if (!fs.existsSync(dataDir)) return null;
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => /^(current|backup-\d{4}-\d{2}-\d{2})\.json$/.test(f));
  if (files.length === 0) return null;
  /* 优先 current.json —— 它是最新的那份 */
  const cur = files.find((f) => f === "current.json");
  return path.join(dataDir, cur ?? files[0]);
}

const dataFile = pickDataFile();
if (!dataFile) {
  console.log(`没有找到数据文件（${dataDir}），先启动一次桌面版。`);
  process.exit(0);
}

/* ── 打包 persist.ts ── */
await build({
  entryPoints: [path.join(ROOT, "src/lib/persist.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: OUT,
  logLevel: "error",
});

/* ── 假 localStorage（必须在加载模块之前装好） ── */
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
};

const require = createRequire(import.meta.url);
const P = require(OUT);

/* ── 断言 ── */
let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        期望 ${JSON.stringify(expected)}`);
    console.log(`        实际 ${JSON.stringify(actual)}`);
    failures++;
  }
};

const text = fs.readFileSync(dataFile, "utf8");
const parsed = JSON.parse(text);
const fileKeys = Object.keys(parsed.data).filter((k) => {
  const v = parsed.data[k];
  return typeof v === "string" && v.length > 0;
});

console.log(`\n输入文件: ${path.basename(dataFile)}`);
console.log(`非空 key: ${fileKeys.join(", ")}\n`);

/* ═══ 场景 1：本地全空（换机器 / 清了缓存） ═══ */
store = {};
let r = P.previewBundle(text);
console.log("场景 1 · 本地全空");
check("解析成功", r.ok, true);
check("conflicts = 0", r.preview.conflicts, 0);
check("fresh = 文件里的项数", r.preview.fresh, fileKeys.length);

let w = P.importBundle(text, "fill");
check("fill 写入全部", w.keys, fileKeys.length);
check("threads 已落库", !!store["3w:threads"], true);

/* ═══ 场景 2：本地已有同样内容（正常启动后） ═══ */
console.log("\n场景 2 · 本地已有同样内容");
r = P.previewBundle(text);
check("conflicts = 全部", r.preview.conflicts, fileKeys.length);
check("fresh = 0", r.preview.fresh, 0);

const beforePersonas = store["3w:personas"];
w = P.importBundle(text, "fill");
check("fill 写入 0 项", w.keys, 0);
check("fill 不动已有值", store["3w:personas"] === beforePersonas, true);

/* ═══ 场景 3：本地只缺凭据 ═══ */
console.log("\n场景 3 · 本地只缺凭据");
store = {};
for (const k of fileKeys) store[k] = parsed.data[k];
store["3w:credentials"] = ""; // 空字符串 = 本地没有

const withCred = JSON.parse(text);
withCred.data["3w:credentials"] = JSON.stringify([
  { id: "c1", label: "DeepSeek", baseUrl: "https://api.deepseek.com", apiKey: "sk-x", models: [] },
]);
const textWithCred = JSON.stringify(withCred);

r = P.previewBundle(textWithCred);
const credEntry = r.preview.entries.find((e) => e.key === "3w:credentials");
check("凭据被识别为本地没有", credEntry.inLocal, false);
check("fresh 计数 = 1", r.preview.fresh, 1);

const personasBefore = store["3w:personas"];
w = P.importBundle(textWithCred, "fill");
check("fill 只写 1 项", w.keys, 1);
check("凭据写进去了", JSON.parse(store["3w:credentials"])[0].label, "DeepSeek");
check("角色没被动", store["3w:personas"] === personasBefore, true);

/* ═══ 场景 4：overwrite 确实会替换 ═══ */
console.log("\n场景 4 · overwrite 会替换");
store["3w:personas"] = JSON.stringify({ v: 3, personas: [{ id: "custom-1", name: "我自己建的" }] });
w = P.importBundle(text, "overwrite");
check("overwrite 写入全部", w.keys, fileKeys.length);
check(
  "角色被换成文件里的",
  store["3w:personas"] === parsed.data["3w:personas"],
  true
);

/* ═══ 场景 5：坏文件不写入 ═══ */
console.log("\n场景 5 · 坏文件");
check("非 JSON", P.previewBundle("not json{").ok, false);
check("缺 data 字段", P.previewBundle('{"format":1}').ok, false);
check("版本过新", P.previewBundle('{"format":999,"data":{}}').ok, false);

/* ── 收尾 ── */
fs.rmSync(OUT, { force: true });

console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}\n`);
process.exit(failures === 0 ? 0 : 1);
