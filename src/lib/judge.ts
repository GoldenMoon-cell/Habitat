/**
 * 判断模型 —— 让一个便宜的小模型来决定「谁说话、说什么方向」。
 *
 * ── 它不做什么 ──
 *
 * **它不做填空题，只做选择题。**
 *
 * 候选人是本地规则先筛出来的（2–3 个），燃料是本地先挑好的（最多 3 条）。
 * 模型只能在这几个里挑，或者都不挑。
 *
 * 放它自己回忆「她想起了什么」，它会编一条记忆库里没有的事 ——
 * 而主模型会当真说出来，用户会发现她记得一件根本没发生过的事。
 *
 * ── 它失败时 ──
 *
 * 连不上 / 超时 / 返回垃圾 / 挑了个不在候选里的 id → **一律返回 null**，
 * 调用方降级回规则版。界面上不报错。
 *
 * 规则是底线，判断模型是增强。这个方向不能反。
 *
 * ── 成本 ──
 *
 * 一次判断 ≈ 560 tokens，一次发言 ≈ 12,000 tokens。
 * 也就是**一次发言 = 21 次判断**。
 * 每 21 次判断里拦掉 1 次不该发的言，就持平。
 */

import type { ChatMsg } from "./llm";

/* ══════════════════════════════════════════
   类型
   ══════════════════════════════════════════ */

export interface JudgeCandidate {
  id: string;
  name: string;
  /** 本地算出来的意愿分，给模型当参考，不是命令 */
  desire: number;
  /** 一两句人设，帮模型判断「她会怎么接」 */
  gist?: string;
}

export interface JudgeFuel {
  id: string;
  text: string;
  tag: string;
}

export interface JudgeInput {
  candidates: JudgeCandidate[];
  /** 最近几条消息，从旧到新 */
  recent: { who: string; text: string }[];
  /** 本地预筛好的燃料候选，模型只能从这里挑 */
  fuels: JudgeFuel[];
  heatBand: "open" | "cooling" | "cold";
  /** 你叫什么 */
  ownerName?: string;
}

export type JudgeIntent = "reply" | "new_topic" | "ask" | "quiet";

export interface JudgeResult {
  speak: boolean;
  who?: string;
  intent?: JudgeIntent;
  fuelId?: string;
  memory?: { text: string; tag: string } | null;
}

/* ══════════════════════════════════════════
   提示词
   ══════════════════════════════════════════ */

const SYSTEM = `你在判断一个多人聊天里「下一句该不该有人说、谁来说」。

只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。

字段：
{
  "speak": true | false,          // 现在该不该有人开口
  "who": "候选人的 id",            // speak 为 true 时必填
  "intent": "reply" | "new_topic" | "ask" | "quiet",
  "fuelId": "燃料的 id" | null,    // 想换个话题时，从候选燃料里挑一条
  "memory": { "text": "...", "tag": "..." } | null
}

intent 的意思：
  reply     接着说这件事
  new_topic 换成别的事
  ask       问一个问题等对方答
  quiet     没什么好说的

判断依据：
· 对话已经说了几句，热度在下降 —— 这时候「没人说话」是正常的，不要硬接
· 只有当某个人的意愿明显高、或者这件事只有他能答，才让他说
· 不要为了「让对话继续」而选人。安静的群是正常的群
· fuelId 只在确实要换话题时才给，而且必须从下面列出的燃料里挑

memory：如果这轮对话里有一件**值得她长期记住的事**，写出来。
  必须是他本人说过的、具体的、以后可能用得上的事。
  没有就给 null。**宁可漏，不要编。**`;

function renderInput(i: JudgeInput): string {
  const lines: string[] = [];

  lines.push(`【热度】${i.heatBand}`);

  lines.push("", "【候选人】（只能从这里选 who）");
  for (const c of i.candidates) {
    lines.push(`· ${c.id}（${c.name}）意愿 ${c.desire.toFixed(2)}${c.gist ? ` —— ${c.gist}` : ""}`);
  }

  if (i.fuels.length > 0) {
    lines.push("", "【燃料候选】（只能从这里选 fuelId）");
    for (const f of i.fuels) lines.push(`· ${f.id} [${f.tag}] ${f.text}`);
  }

  lines.push("", "【最近的对话】（从旧到新）");
  for (const m of i.recent) {
    lines.push(`${m.who}：${m.text.replace(/\s+/g, " ").slice(0, 160)}`);
  }

  if (i.ownerName) lines.push("", `【用户的名字】${i.ownerName}`);

  return lines.join("\n");
}

export function buildJudgeMessages(input: JudgeInput): ChatMsg[] {
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: renderInput(input) },
  ];
}

/* ══════════════════════════════════════════
   校验 —— 这个模块最主要的部分
   ══════════════════════════════════════════ */

/** 从可能带 ```json 围栏的输出里抠出对象 */
function extractJson(raw: string): unknown {
  const s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  /* 模型有时会在前后加话 —— 取第一个 { 到最后一个 } */
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(body.slice(a, b + 1));
  } catch {
    return null;
  }
}

const INTENTS: JudgeIntent[] = ["reply", "new_topic", "ask", "quiet"];

/**
 * 把模型的输出变成**可信的**结果。
 *
 * 返回 null = 这次判断作废，调用方降级。
 *
 * 这里每一条校验都对应一种「模型会干但你不能接受」的事：
 *   · 选了个不在候选里的人  → 那她可能根本不在这个群
 *   · 挑了个不在候选里的燃料 → 那是它编的记忆
 *   · speak=true 却没说 who → 不知道让谁说
 */
export function validateJudge(raw: unknown, input: JudgeInput): JudgeResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const speak = r.speak === true;

  /* 不开口 —— 这是合法结果，而且很常见 */
  if (!speak) {
    return { speak: false, intent: "quiet", memory: null };
  }

  const ids = new Set(input.candidates.map((c) => c.id));
  const who = typeof r.who === "string" ? r.who : "";
  if (!ids.has(who)) return null; /* 点了不在候选里的人 —— 不能信 */

  const intent =
    typeof r.intent === "string" && (INTENTS as string[]).includes(r.intent)
      ? (r.intent as JudgeIntent)
      : "reply";

  /* 燃料只能从本地给的那几条里挑 */
  let fuelId: string | undefined;
  if (typeof r.fuelId === "string") {
    const fuelIds = new Set(input.fuels.map((f) => f.id));
    if (fuelIds.has(r.fuelId)) fuelId = r.fuelId;
    /* 挑了不存在的燃料 → 丢掉，但整次判断不算失败 */
  }

  return { speak: true, who, intent, fuelId, memory: reviewMemory(r.memory) };
}

/* ══════════════════════════════════════════
   记忆：规则当审核者
   ══════════════════════════════════════════ */

/** 长期 / 偏好类的记忆可以短一点，别的要说清楚 */
const SHORT_TAGS = new Set(["长期", "偏好"]);

/**
 * 判断模型给的那条记忆，能不能入库。
 *
 * ── 规则从这里开始只当审核者 ──
 *
 * 生产交给模型（它读得懂语义，比她写的那套关键词规则准），
 * 但**入库前还要过这一道**。错了会变成她记得一件没发生的事，
 * 那比漏记严重得多。
 *
 * 「宁可漏，不要编。」
 */
export function reviewMemory(raw: unknown): { text: string; tag: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;

  const text = typeof m.text === "string" ? m.text.trim() : "";
  if (!text) return null;

  const tag = typeof m.tag === "string" && m.tag.trim() ? m.tag.trim() : "长期";
  const minLen = SHORT_TAGS.has(tag) ? 4 : 8;
  if (text.length < minLen) return null;

  /* 第一人称 —— 「他不吃香菜」是资料，「他说他受不了香菜味」才是记忆 */
  if (!/我|他|她|你/.test(text)) return null;

  /* 在问他 / 在问她 —— 那是问句，不是事实 */
  if (/[?？]\s*$/.test(text)) return null;
  if (/^(你|他|她)(觉得|认为|是不是|会不会|要不要)/.test(text)) return null;

  return { text: text.slice(0, 120), tag };
}

/* ══════════════════════════════════════════
   调用
   ══════════════════════════════════════════ */

export interface JudgeOptions {
  /** 真正发请求。测试时替换掉这个就能验全部逻辑 */
  call: (msgs: ChatMsg[]) => Promise<string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 8000;

/**
 * 跑一次判断。
 *
 * **任何失败都返回 null** —— 连不上、超时、返回垃圾、选了不在候选里的人。
 * 调用方拿到 null 就降级回规则版，界面不报错。
 */
export async function judge(
  input: JudgeInput,
  opts: JudgeOptions
): Promise<JudgeResult | null> {
  /* 没有候选就不必问了 */
  if (input.candidates.length === 0) return null;

  const msgs = buildJudgeMessages(input);
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  try {
    const raw = await Promise.race([
      opts.call(msgs),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("judge timeout")), timeout)
      ),
    ]);
    return validateJudge(extractJson(raw), input);
  } catch {
    /* 超时 / 网络 / 解析 —— 全都降级，不往上抛 */
    return null;
  }
}

/* ══════════════════════════════════════════
   配置
   ══════════════════════════════════════════ */

const CONFIG_KEY = "3w:judge-model";

export interface JudgeConfig {
  enabled: boolean;
  /** 用哪套凭据。空 = 用角色自己的 */
  credentialId?: string;
  /** 用哪个模型。空 = 用凭据里第一个 */
  model?: string;
}

export const JUDGE_DEFAULT: JudgeConfig = { enabled: false };

/**
 * **默认关闭。**
 *
 * 打开之后每轮多一次调用；关着的时候走规则版，
 * 判得粗一点，但永远是活的。
 */
export function readJudgeConfig(): JudgeConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return JUDGE_DEFAULT;
    const p = JSON.parse(raw);
    return {
      enabled: p?.enabled === true,
      ...(typeof p?.credentialId === "string" ? { credentialId: p.credentialId } : {}),
      ...(typeof p?.model === "string" ? { model: p.model } : {}),
    };
  } catch {
    return JUDGE_DEFAULT;
  }
}

export function saveJudgeConfig(c: JudgeConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/**
 * 从判断结果里挑出燃料正文。
 *
 * 拿不到就返回 null —— **不要退回去用第一条**，那等于绕过候选机制。
 */
export function fuelOf(
  r: JudgeResult | null,
  fuels: JudgeFuel[]
): JudgeFuel | null {
  if (!r || !r.fuelId) return null;
  return fuels.find((f) => f.id === r.fuelId) ?? null;
}
