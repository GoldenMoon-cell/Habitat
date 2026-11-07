/**
 * 折线 → 字体轮廓 → 推给 FontLab
 *
 * 我的字形数据是「折线 + 描边宽 84」。字体要的是**闭合轮廓**。
 *
 * 转换办法（不引入任何几何库）：
 *   每段折线 → 一个矩形轮廓
 *   每个拐角 → 一个方块轮廓
 *
 * 这些矩形/方块**允许互相重叠** —— 字体的非零环绕规则会把它们
 * 合成一个连通的形状。这是描边转轮廓最省事的做法，
 * 代价是轮廓不"干净"（多个重叠子路径），但渲染结果是对的。
 *
 * 用法：
 *   node scripts/build-font.mjs            # 推到 FontLab 里
 *   node scripts/build-font.mjs --save     # 推完再存成 OTF
 *   node scripts/build-font.mjs --dry A    # 只看某个字形的轮廓，不推
 */

import { spawn } from "node:child_process";
import { GLYPHS, PUNCT, STROKE, ADV, GRID, UPM } from "./font-design.mjs";

const EXE = "D:\\Program Files\\Fontlab\\FontLab 9\\fontlab-mcp.exe";
const H = STROKE / 2;              // 半笔宽（42）
const S = GRID;                    // 网格单位 → 字体单位

/* ── 折线 → 轮廓 ───────────────────────────────────────── */

/** 一段线 → 矩形（四个点，逆时针） */
function segRect(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * H, ny = (dx / len) * H;   // 法向
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
}

/** 一个拐角 → 方块（盖住接头） */
function jointSquare(p) {
  return [
    [p[0] - H, p[1] - H],
    [p[0] + H, p[1] - H],
    [p[0] + H, p[1] + H],
    [p[0] - H, p[1] + H],
  ];
}

/** 多点折线（≥3 点）的拐角方块要跟着笔画的走向裁一下 —— 见 below */
function joinSquareFor(prev, p, next) {
  /* 90° 直角：直接用方块，正好填满
     其他角度：也用方块，斜接处稍微外凸一点，视觉上和 miter 一致 */
  return jointSquare(p);
}

/**
 * 折线数组 → 轮廓列表（字体单位）
 *
 * ★ 顺序很重要：**先放大到字体单位，再做描边扩展。**
 *
 * 我第一版反了 —— 在网格单位上算半笔宽 42，然后整体 ×100，
 * 于是 42 变成了 4200，坐标飞出几万。
 * 干跑时一眼看出：A 的路径点是 -3860,1654。
 */
export function strokesToContours(strokes) {
  const out = [];
  /* 先放大 */
  const polys = strokes.map((poly) => poly.map(([x, y]) => [x * S, y * S]));

  for (const poly of polys) {
    if (poly.length < 2) {
      if (poly.length === 1) out.push(jointSquare(poly[0]));
      continue;
    }
    /* 每段一个矩形 */
    for (let i = 0; i < poly.length - 1; i++) {
      out.push(segRect(poly[i], poly[i + 1]));
    }
    /* 中间每个顶点一个方块（盖住接头） */
    for (let i = 1; i < poly.length - 1; i++) {
      out.push(joinSquareFor(poly[i - 1], poly[i], poly[i + 1]));
    }
  }
  /* 取整 */
  return out.map((c) => c.map(([x, y]) => [Math.round(x), Math.round(y)]));
}

/* ── 转成 FontLab 的 glyph_data ─────────────────────────── */
export function glyphData(strokes, advance = ADV) {
  const contours = strokesToContours(strokes);
  return {
    layers: [{
      name: "Regular",
      advanceWidth: advance,
      elements: [{
        elementData: {
          contours: contours.map((c) => ({
            /* FontLab 用 nodes_list；首点重复一次闭合成环，由它自己处理 */
            nodes_list: c.map(([x, y]) => ({ x, y, type: "line" })),
          })),
        },
      }],
    }],
  };
}

/* ── MCP 客户端 ─────────────────────────────────────────── */
function mcp(requests, timeoutMs = 40000) {
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
      if (!lines.length) return reject(new Error("无返回。" + err.slice(0, 400)));
      resolve(lines);
    });
    const init = {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "habitat-build", version: "1" } },
    };
    for (const r of [init, ...requests]) child.stdin.write(JSON.stringify(r) + "\n");
    child.stdin.end();
  });
}

const pick = (ls) => ls.filter((l) => l.id !== 1).pop();

function unwrap(res) {
  if (res.error) throw new Error(res.error.message);
  const parts = res.result?.content ?? [];
  const txt = parts.map((p) => p.text ?? "").join("");
  try { return JSON.parse(txt); } catch { return txt; }
}

/* ── 主流程 ─────────────────────────────────────────────── */
const args = process.argv.slice(2);
const dry = args.includes("--dry") ? (args[args.indexOf("--dry") + 1] || "A") : null;
const doSave = args.includes("--save");

if (dry) {
  const g = GLYPHS[dry] || PUNCT[dry];
  if (!g) { console.error("没有这个字形: " + dry); process.exit(1); }
  const d = glyphData(g);
  const cs = d.layers[0].elements[0].elementData.contours;
  console.log(`字形 ${dry}: ${cs.length} 个子路径`);
  cs.slice(0, 4).forEach((c, i) => {
    console.log(`  路径 ${i}: ${c.nodes_list.map((n) => `${n.x},${n.y}`).join(" → ")}`);
  });
  process.exit(0);
}

/* 被 import（比如导出轮廓 JSON）时不要跑主流程 */
const isMain = process.argv[1] && process.argv[1].endsWith("build-font.mjs");
if (!isMain) {
  /* 只提供导出函数，不推送 */
} else {

const chars = Object.keys({ ...GLYPHS, ...PUNCT });

console.log(`准备推送 ${chars.length} 个字形…`);

/* 一次会话里把能推的全推完 —— MCP 每次起进程有开销 */
const reqs = [];
let id = 10;

/* 先确认有字体 */
const fontsRes = pick(await mcp([{ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: "list_fonts", arguments: {} } }]));
const fonts = unwrap(fontsRes);
let fontId = fonts?.fonts?.[0]?.id;
if (!fontId) {
  const nr = pick(await mcp([{ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: "new_font", arguments: { family_name: "Habitat", style_name: "Regular", encoding: "Unicode" } } }]));
  fontId = unwrap(nr)?.font?.id;
  console.log("  新建字体 id =", fontId);
} else {
  console.log("  用已有字体 id =", fontId);
}

/* 分批推，每批一个 MCP 会话 */
const BATCH = 8;
let ok = 0, failed = [];
for (let i = 0; i < chars.length; i += BATCH) {
  const batch = chars.slice(i, i + BATCH);
  const calls = batch.map((ch) => {
    const uni = ch.codePointAt(0);
    const name = /[A-Za-z]/.test(ch)
      ? ch
      : "uni" + uni.toString(16).toUpperCase().padStart(4, "0");
    return {
      jsonrpc: "2.0", id: id++, method: "tools/call",
      params: {
        name: "set_glyph",
        arguments: {
          glyph_name: name,
          glyph_data: glyphData(GLYPHS[ch] ?? PUNCT[ch]),
          font_id: fontId,
          create: true,
        },
      },
    };
  });
  const res = await mcp(calls);
  for (const r of res) {
    if (r.id === 1) continue;
    if (r.error) { failed.push(r.error.message); continue; }
    const body = unwrap(r);
    if (body?.status === "error" || r.result?.isError) failed.push(JSON.stringify(body).slice(0, 120));
    else ok++;
  }
  process.stdout.write(`\r  已推送 ${Math.min(i + BATCH, chars.length)} / ${chars.length}`);
}
console.log(`\n  ✓ 成功 ${ok} 个` + (failed.length ? `，失败 ${failed.length} 个` : ""));
failed.slice(0, 5).forEach((f) => console.log("    ✗ " + f));

if (doSave) {
  console.log("存入 OTF…");
  const out = `${process.env.USERPROFILE}\\Desktop\\Habitat-Regular.otf`;
  const r = pick(await mcp([{
    jsonrpc: "2.0", id: 900, method: "tools/call",
    params: { name: "save_font", arguments: { font_id: fontId, path: out, format: "otf", overwrite: true } },
  }]));
  console.log("  " + JSON.stringify(unwrap(r)).slice(0, 300));
  console.log("  → " + out);
}
}
