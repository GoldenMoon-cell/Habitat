#!/usr/bin/env node
/**
 * FontLab 9 MCP 调用器
 *
 * fontlab-mcp.exe 是个 stdio MCP 服务器（46 KB 的桥），
 * 它连的是**正在运行的 FontLab 9**。所以：
 *   · FontLab 必须开着，且 Preferences > Aidus 勾了外部 MCP
 *   · 状态存在 FontLab 里，每次起一个新进程照样能接上
 *
 * 用法：
 *   node scripts/mcp-fontlab.mjs tools
 *   node scripts/mcp-fontlab.mjs call get_active_font
 *   node scripts/mcp-fontlab.mjs call get_vfj_schema '{"kind":"glyph"}'
 *   node scripts/mcp-fontlab.mjs call build_glyph @args.json
 *   node scripts/mcp-fontlab.mjs raw '{"jsonrpc":"2.0","id":9,"method":"ping"}'
 *
 * 退出码：0 成功，1 出错（错误信息打到 stderr）
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const EXE = "D:\\Program Files\\Fontlab\\FontLab 9\\fontlab-mcp.exe";

const [, , cmd, ...rest] = process.argv;

if (!cmd) {
  console.error("用法: node scripts/mcp-fontlab.mjs <tools|call|raw> ...");
  process.exit(1);
}

/** 起一次会话：initialize + 一条请求，收集 stdout 里的 JSON 行 */
function run(requests, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const child = spawn(EXE, [], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = [];
    let buf = "";
    let err = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`超时 ${timeoutMs}ms —— FontLab 开着吗？Aidus 里勾了外部 MCP 吗？`));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { lines.push(JSON.parse(line)); } catch { /* 非 JSON 行忽略 */ }
      }
    });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });

    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      if (lines.length === 0) {
        reject(new Error(`没有返回任何 JSON。stderr:\n${err.slice(0, 800)}`));
      } else {
        resolve(lines);
      }
    });

    /* MCP 要求先 initialize，再发正式请求 */
    const init = {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2024-11-05", capabilities: {},
        clientInfo: { name: "habitat-agent", version: "1.0" },
      },
    };
    for (const r of [init, ...requests]) child.stdin.write(JSON.stringify(r) + "\n");
    child.stdin.end();
  });
}

/** 从返回里挑最后一条「非 initialize」的结果 */
function pick(lines) {
  return lines.filter((l) => l.id !== 1).pop() ?? lines.pop();
}

try {
  if (cmd === "tools") {
    const out = await run([{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }]);
    const r = pick(out);
    if (r.error) throw new Error(r.error.message);
    for (const t of r.result.tools) {
      console.log(`${t.name.padEnd(28)} ${(t.description ?? "").split("\n")[0].slice(0, 72)}`);
    }
    console.log(`\n共 ${r.result.tools.length} 个`);

  } else if (cmd === "call") {
    const name = rest[0];
    if (!name) throw new Error("缺工具名");
    let args = {};
    if (rest[1]) {
      args = rest[1].startsWith("@")
        ? JSON.parse(readFileSync(rest[1].slice(1), "utf8"))
        : JSON.parse(rest[1]);
    }
    const out = await run([{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }]);
    const r = pick(out);
    if (r.error) throw new Error(r.error.message);
    /* MCP 的 content 是 [{type:"text", text:"..."}]，text 里通常还是 JSON */
    const c = r.result?.content ?? [];
    for (const part of c) {
      const t = part.text ?? "";
      try {
        console.log(JSON.stringify(JSON.parse(t), null, 2));
      } catch {
        console.log(t);
      }
    }
    if (r.result?.isError) process.exitCode = 1;

  } else if (cmd === "raw") {
    const req = JSON.parse(rest[0]);
    const out = await run([req]);
    console.log(JSON.stringify(pick(out), null, 2));

  } else {
    throw new Error(`未知命令: ${cmd}`);
  }
} catch (e) {
  console.error("✗ " + e.message);
  process.exit(1);
}
