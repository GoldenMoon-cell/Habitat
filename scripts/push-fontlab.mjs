/**
 * 把合并后的轮廓推给 FontLab
 *
 * 和 build-font.mjs 的区别：那个从折线现算轮廓（会产生 664 条重叠矩形，
 * 把 FontLab 搞崩过）；这个**只读 .font-clean.json**（pathops 合并过的），
 * 推的是干净轮廓。
 *
 * 用法：
 *   node scripts/push-fontlab.mjs            # 推全部
 *   node scripts/push-fontlab.mjs A B C      # 只推指定的几个字形
 *   node scripts/push-fontlab.mjs --check    # 只检查 FontLab 活着没
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const EXE = "D:\\Program Files\\Fontlab\\FontLab 9\\fontlab-mcp.exe";
const CLEAN = ".font-clean.json";
const FAMILY = "Habitat";

function mcp(requests, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(EXE, [], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = [];
    let buf = "", err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP 超时 —— FontLab 开着吗？Aidus 勾了吗？"));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!l) continue;
        try { lines.push(JSON.parse(l)); } catch {}
      }
    });
    child.stderr.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      if (!lines.length) return reject(new Error("无返回。" + err.slice(0, 300)));
      resolve(lines);
    });
    const init = {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "habitat-push", version: "1" } },
    };
    for (const r of [init, ...requests]) child.stdin.write(JSON.stringify(r) + "\n");
    child.stdin.end();
  });
}

const pick = (ls) => ls.filter((l) => l.id !== 1).pop();
function unwrap(res) {
  if (res.error) throw new Error(res.error.message);
  const txt = (res.result?.content ?? []).map((p) => p.text ?? "").join("");
  try { return JSON.parse(txt); } catch { return txt; }
}

const args = process.argv.slice(2);

/* ── 只检查 ── */
if (args.includes("--check")) {
  const r = pick(await mcp([{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_fonts", arguments: {} } }]));
  console.log(JSON.stringify(unwrap(r), null, 2));
  process.exit(0);
}

if (!existsSync(CLEAN)) {
  console.error(`✗ 找不到 ${CLEAN} —— 先跑: python scripts/merge-outlines.py`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(CLEAN, "utf8"));
const all = Object.keys(data).filter((c) => data[c].contours.length > 0);
const targets = args.length ? args.filter((a) => data[a]) : all;

/* 字形名（post 表只吃 Latin-1） */
function gname(ch) {
  if (/^[A-Za-z0-9]$/.test(ch)) return ch;
  const known = { ".": "period", ",": "comma", ":": "colon", ";": "semicolon", "-": "hyphen",
    "_": "underscore", "(": "parenleft", ")": "parenright", "[": "bracketleft",
    "]": "bracketright", "/": "slash", "\\": "backslash", "+": "plus", "=": "equal",
    "<": "less", ">": "greater", "*": "asterisk", "#": "numbersign", "@": "at",
    "&": "ampersand", "%": "percent", "!": "exclam", "?": "question",
    "'": "quotesingle", '"': "quotedbl" };
  return known[ch] || "uni" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
}

/* ── 找或建字体 ── */
const fr = pick(await mcp([{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_fonts", arguments: {} } }]));
const fonts = unwrap(fr);
let fontId = fonts?.fonts?.[0]?.id;
if (!fontId) {
  const nr = pick(await mcp([{ jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "new_font", arguments: { family_name: FAMILY, style_name: "Regular", encoding: "Unicode" } } }]));
  fontId = unwrap(nr)?.font?.id;
  console.log("  新建字体 id =", fontId);
} else {
  console.log("  已有字体 id =", fontId);
}

/* ★ FontLab 没起来的时候 new_font 会静默失败，返回 id=undefined。
   这时如果继续推，就是往一个不存在的字体里灌数据 ——
   上一次它把 FontLab 直接搞崩了。所以这里必须硬性拦住。 */
if (fontId === undefined || fontId === null) {
  console.error("  ✗ 拿不到 font_id，中止。");
  console.error("    先确认：FontLab 主窗口开着吗？（不是崩溃报告窗口）");
  console.error("    检查：node scripts/push-fontlab.mjs --check");
  process.exit(1);
}

console.log(`  推 ${targets.length} 个字形（合并后的轮廓）…`);

let ok = 0, failed = [];
const BATCH = 6;
for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH);
  const calls = batch.map((ch, k) => ({
    jsonrpc: "2.0", id: 100 + i + k, method: "tools/call",
    params: {
      name: "set_glyph",
      arguments: {
        glyph_name: gname(ch),
        font_id: fontId,
        create: true,
        glyph_data: {
          layers: [{
            name: "Regular",
            advanceWidth: data[ch].advance,
            elements: [{
              elementData: {
                contours: data[ch].contours.map((c) => ({
                  nodes_list: c.map(([x, y]) => ({ x, y, type: "line" })),
                })),
              },
            }],
          }],
        },
      },
    },
  }));
  try {
    const res = await mcp(calls);
    for (const r of res) {
      if (r.id === 1) continue;
      if (r.error) { failed.push(r.error.message.slice(0, 80)); continue; }
      const body = unwrap(r);
      if (body?.status === "error" || r.result?.isError) failed.push(JSON.stringify(body).slice(0, 80));
      else ok++;
    }
  } catch (e) {
    console.log(`\n  ✗ 第 ${i} 批断掉: ${e.message}`);
    console.log("  → FontLab 可能又崩了。检查：node scripts/push-fontlab.mjs --check");
    process.exit(1);
  }
  process.stdout.write(`\r  已推 ${Math.min(i + BATCH, targets.length)} / ${targets.length}`);
}
console.log(`\n  ✓ 成功 ${ok}` + (failed.length ? `，失败 ${failed.length}` : ""));
failed.slice(0, 4).forEach((f) => console.log("    ✗ " + f));
