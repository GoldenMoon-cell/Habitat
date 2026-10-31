/**
 * 假 Ollama 服务 —— 只用于验证前端链路，不产生真实智能。
 *
 * 为什么需要：
 *   代码写完了但一次没跑过。万一 buildHistory 越界、trimToBudget 死循环、
 *   流解析漏最后一块，等你装好 Ollama 才发现，排查成本高得多。
 *   这里先跑通，装好之后只需把 baseUrl 指过去。
 *
 * 关键：它会把收到的 system prompt 打印出来 —— 你就能亲眼看到
 *      六维 Δ 是怎么变成行为句的，以及历史截断有没有生效。
 *
 * 用法：
 *   node scripts/mock-ollama.mjs
 *   然后应用会探测到 localhost:11434 有服务，自动走真实调用路径
 */

import http from "node:http";

const PORT = 11434;

/** 假模型名，和 Persona.model 对不上就会被 OLLAMA 前缀兜底逻辑接住 */
const MODEL = "mock:8b";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 根据 system prompt 里的关键词，回一句能对上角色的话 —— 不是随机，是可验证 */
function composeReply(systemPrompt, userText) {
  const name = /你是「([^」]+)」/.exec(systemPrompt)?.[1] ?? "某人";
  const group = systemPrompt.includes("【群聊】");
  const intimate = /亲密度：关系很近/.test(systemPrompt);
  const terse = /专注：盯住一件事不放/.test(systemPrompt);

  const openers = {
    鲸鲸: "嗯…",
    澜汐: "收到。",
    Gemini: "补充一个关联：",
    Claude: "我听见了。",
    Grok: "哈。",
    ChatGPT: "先把这句拆成两层：",
    Qwen: "这句话有问题。",
    Kimi: "嗯。",
  };
  const opener = openers[name] ?? "嗯，";

  const body = group
    ? `（群里说的）关于「${userText.slice(0, 12)}」，我的看法是：先别急着定论。`
    : intimate
      ? `你说「${userText.slice(0, 12)}」——这句我收下了。`
      : `你提到「${userText.slice(0, 12)}」，${terse ? "我只回答这一点：" : "我想先确认一下："}是这样吗？`;

  return `${opener}${body}`;
}

const server = http.createServer(async (req, res) => {
  /* CORS：浏览器从 127.0.0.1:1420 发请求 */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  /* ── 健康探测 ── */
  if (req.url === "/api/tags" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: MODEL, size: 5e9 }] }));
    console.log("[mock] GET /api/tags → 1 model");
    return;
  }

  /* ── 对话 ── */
  if (req.url === "/api/chat" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }

    const msgs = body.messages ?? [];
    const sys = msgs.find((m) => m.role === "system")?.content ?? "";
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";

    /* ── 这里是最有价值的部分：把收到的 prompt 打出来 ── */
    console.log("\n" + "═".repeat(70));
    console.log(`[mock] model=${body.model}  消息数=${msgs.length}`);
    console.log("─ system prompt ─".padEnd(70, "─"));
    console.log(sys || "(空)");
    console.log("─ 对话历史 ─".padEnd(70, "─"));
    for (const m of msgs.filter((m) => m.role !== "system")) {
      const tag = m.role === "assistant" ? "我" : "对方";
      console.log(`  ${tag}: ${m.content.slice(0, 60)}`);
    }
    console.log("═".repeat(70) + "\n");

    /* ── 流式返回（NDJSON，和真 Ollama 一样）── */
    const reply = composeReply(sys, lastUser);
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    });

    /* 按字符吐，模拟真实模型的逐字输出 */
    const chars = [...reply];
    for (let i = 0; i < chars.length; i++) {
      if (i === 0) await sleep(300); // 首字延迟，让"正在输入"能显出来
      else await sleep(35);

      res.write(
        JSON.stringify({
          model: body.model,
          message: { role: "assistant", content: chars[i] },
          done: false,
        }) + "\n"
      );
    }

    res.write(JSON.stringify({ model: body.model, done: true }) + "\n");
    res.end();
    console.log(`[mock] 回复 ${chars.length} 字`);
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🦙 假 Ollama 已启动: http://127.0.0.1:${PORT}`);
  console.log(`   模型: ${MODEL}`);
  console.log(`   前端会探到它并走真实调用路径\n`);
  console.log(`   验证方法：给某个角色发一条消息，看这个终端的输出。`);
  console.log(`   如果 system prompt 里能看到「亲密度：关系很近…」，说明六维映射生效了。\n`);
});
