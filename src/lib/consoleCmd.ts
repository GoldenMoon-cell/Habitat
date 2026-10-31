import { useCallback, useRef, useState } from "react";
import { playDeny, playEnterCreator, playLeaveCreator, playRumble, playTick } from "./sound";
import { resetTimeOffset, setTimeOffsetDays, timeOffsetLabel } from "./clock";
import { clearDeadline, loadDeadlines, remainingLabel, setDeadline } from "./deadline";
import { readMode, setMode } from "./mode";
import { log } from "./eventLog";
import { loadCredentials } from "../store/credentials";
import { getGlitch, GLITCH_TARGETS, setGlitch } from "./glitch";
import { loadKnownModels, resolveCredential } from "../store/credentials";
import { commitDynamic, readDynamic, tick } from "./dynamic";
import { lookupRename } from "./nameHistory";

/**
 * 监控台命令行。
 *
 * 名字叫「控制台」就得真的能敲指令 —— 一堆只读仪表配这个名字是撒谎。
 * 这里的指令都真的改变系统状态：
 *
 *   sys glitch radar   → 右侧雷达当场崩（走的是 BlockBoundary 同一条路径）
 *   ai mute 鲸鲸       → 角色置为离线，头像变灰
 *   ai reset 澜汐      → 上下文占用清零
 *   log pause          → 日志连生成都停
 *
 * 未接后端的（net proxy / dsh run）明确回 not wired，不假装成功。
 */

export interface CmdLine {
  kind: "in" | "out" | "err" | "ok" | "dim" | "warn";
  text: string;
  /**
   * 不是显示一行字，而是**打开一个面板**。
   *
   * 目前只有 graves 用。做成字段而不是塞进 kind ——
   * 面板和一行字是两种不同的东西，不该挤在同一个枚举里。
   */
  panel?: "graves";
}

export interface MiniPersona {
  id: string;
  name: string;
  /** `@月见` 这种。改过名的角色，这个值会跟着变 */
  handle?: string;
  /** Ollama / 云端的真实模型 ID */
  model?: string;
  presence: string;
  mood: { label: string; score: number };
  ctxUsed: number;
  ctxMax: number;
}

export interface CmdContext {
  cpuNow: number;
  memNow: number;
  logs: { time: string; level: string; scope: string; msg: string }[];
  engineLevel: number;
  logPaused: boolean;
  onPauseLog: (paused: boolean) => void;
  onClearLog: () => void;
  personas: MiniPersona[];
  updatePersona: (id: string, patch: Record<string, unknown>) => void;
  /** 当前模式。不传就当 sim。不进 HELP，不进补全表。 */
  mode?: "sim" | "creator";
  /** 切完模式后让外面刷新界面 */
  onModeChange?: (m: "sim" | "creator") => void;
}

const ok = (text: string): CmdLine => ({ kind: "ok", text: `[ok]  ${text}` });
const err = (text: string): CmdLine => ({ kind: "err", text: `[ERR] ${text}` });

/*
 * ══════════════════════════════════════════
 *   指令表 —— 唯一真相
 * ══════════════════════════════════════════
 *
 * `help` 显示的和 Tab 补全用的，**必须是同一份数据**。
 *
 * ── 以前是两张手写的表，然后它们漂了 ──
 *
 *   · `ai model`  在 help 里，**补全表里没有** → 敲不出来只能背
 *   · `api`       能补全、能跑，**help 里没有** → 用户不知道它存在
 *   · `net`/`dsh` 能补全，但它们只会回「没有这个模块」
 *   · `ai inject` 能补全，help 里没有
 *
 * 手写两张表，迟早会漂。**从一张表生成两个视图，这类问题就不可能再发生。**
 *
 * ── 字段 ──
 *
 *   cmd     完整指令（含子命令）
 *   desc    help 里的一句话。**不写 = 不进 help、不进补全**
 *   group   help 的分组
 *   creator 需要造物主权限 —— help 里标出来，让用户先知道代价
 */
interface CmdSpec {
  cmd: string;
  desc?: string;
  group?: string;
  creator?: boolean;
}

const SPECS: CmdSpec[] = [
  { cmd: "sys status", group: "系统", desc: "资源与运行状态" },
  { cmd: "sys glitch", group: "系统", desc: "让某个区块进入故障态" },
  { cmd: "sys restore", group: "系统", desc: "清掉所有注入的故障" },
  { cmd: "sys list", group: "系统", desc: "可注入的区块列表" },

  { cmd: "ai list", group: "AI 角色", desc: "角色与当前状态" },
  { cmd: "ai mute", group: "AI 角色", desc: "置为离线（头像变灰）" },
  { cmd: "ai online", group: "AI 角色", desc: "恢复在线" },
  { cmd: "ai reset", group: "AI 角色", desc: "清空上下文占用" },
  { cmd: "ai model", group: "AI 角色", desc: "改它调的模型" },
  /*
   * `ai inject` 现在**列进 help 了**，标一个 ⟨造物主⟩。
   *
   * 以前是藏着的。但藏着的结果是「能补全、help 里查不到」——
   * 那比露出来更让人困惑。
   *
   * 标出来更好：你能知道它有这个能力，也知道它要什么代价。
   */
  { cmd: "ai inject", group: "AI 角色", desc: "强设情绪", creator: true },

  { cmd: "log pause", group: "日志", desc: "事件流停止滚动" },
  { cmd: "log resume", group: "日志", desc: "恢复滚动" },
  { cmd: "log clear", group: "日志", desc: "清空" },

  { cmd: "api", group: "接口", desc: "已配的凭据与模型数" },

  { cmd: "engine", group: "其他", desc: "当前引擎等级" },
  { cmd: "clear", group: "其他", desc: "清屏" },
  { cmd: "help", group: "其他", desc: "这份列表" },

  /*
   * ── 两个不进 help、不进补全的名字 ──
   *
   * `net` / `dsh` 是别的软件的说法。写在这儿只为了一件事：
   * 万一有人手滑打出来，得到的是「没有这个模块」，
   * 而不是冷冰冰的 `command not found`。
   *
   * **不教用户学它们** —— 所以 desc 留空，两个视图都不出现。
   */
  { cmd: "net" },
  { cmd: "dsh" },
];

/** help 视图：按 group 分组，自动加分隔线和 ⟨造物主⟩ 标记 */
const HELP: CmdLine[] = (() => {
  const out: CmdLine[] = [];
  let last = "";
  for (const s of SPECS) {
    if (!s.desc) continue;
    if (s.group && s.group !== last) {
      if (last) out.push({ kind: "dim", text: "" });
      out.push({ kind: "dim", text: `── ${s.group} ──────────────` });
      last = s.group;
    }
    const tag = s.creator ? "   ⟨造物主⟩" : "";
    out.push({ kind: "out", text: `  ${s.cmd.padEnd(22)}${s.desc}${tag}` });
  }
  return out;
})();

/**
 * 补全视图。
 *
 * **只补全有 desc 的** —— 也就是「真的能用、也愿意教」的那些。
 * `net` / `dsh` 没有 desc，所以补不出来。
 */
const COMMANDS = SPECS.filter((s) => s.desc).map((s) => s.cmd);

/**
 * Tab 补全。
 * 唯一候选 → 直接补全并加空格，接着敲下一个词。
 * 多个候选 → 只补公共前缀，并把候选列出来。
 */
export function completeInput(input: string): { text: string; options: string[] } {
  const trailing = input.length > 0 && /\s$/.test(input);
  const tokens = input.trim().split(/\s+/).filter(Boolean);

  const depth = trailing ? tokens.length : Math.max(0, tokens.length - 1);
  const prefix = trailing ? "" : tokens[tokens.length - 1] ?? "";
  const base = trailing ? tokens : tokens.slice(0, -1);

  const matches = COMMANDS.filter((c) => {
    const p = c.split(" ");
    if (p.length <= depth) return false;
    for (let i = 0; i < base.length; i++) if (p[i] !== base[i]) return false;
    return p[depth].startsWith(prefix);
  });

  if (matches.length === 0) return { text: input, options: [] };

  const opts = Array.from(new Set(matches.map((c) => c.split(" ")[depth])));

  if (opts.length === 1) {
    return { text: [...base, opts[0]].join(" ") + " ", options: [] };
  }

  let common = opts[0];
  for (const o of opts) {
    while (common && !o.startsWith(common)) common = common.slice(0, -1);
  }

  const text =
    common.length > prefix.length ? [...base, common].join(" ") : input;

  return { text, options: opts };
}

/**
 * 当前输入走到哪一层，下一层能接什么。
 *
 * 这是给「点选」用的，不是补全：
 *   输入 `sys glitch ` → 返回 12 个目标，排成按钮让用户点。
 *
 * 和 completeInput 的区别：补全改的是输入框内容，这个只出选项。
 */
export function paramOptions(
  input: string,
  roster: { name: string; model: string; credentialId?: string }[]
): { label: string; value: string }[] {
  const raw = input;
  const trailing = /\s$/.test(raw);
  const t = raw.trim().split(/\s+/).filter(Boolean);
  const chip = (v: string) => ({ label: v, value: v });
  const personaNames = roster.map((p) => p.name);

  /* 空输入 → 列出顶层指令。这样不用背，一路点下去就行 */
  if (t.length === 0) {
    return ["sys", "ai", "log", "engine", "help", "clear"].map(chip);
  }

  const depth = trailing ? t.length : t.length - 1;
  const [c0, c1] = t;
  const prefix = t[depth] ?? "";

  /* sys <x> */
  if (c0 === "sys" && depth === 1) {
    return ["status", "glitch", "restore", "list"]
      .filter((v) => v.startsWith(prefix))
      .map(chip);
  }
  /* sys glitch <target> */
  if (c0 === "sys" && c1 === "glitch" && depth === 2) {
    return GLITCH_TARGETS.filter((v) => v.startsWith(prefix)).map(chip);
  }

  /* ai <x> */
  if (c0 === "ai" && depth === 1) {
    return ["list", "mute", "online", "reset", "model", "inject"]
      .filter((v) => v.startsWith(prefix))
      .map(chip);
  }
  /* ai mute|online|reset|inject <角色> */
  if (c0 === "ai" && ["mute", "online", "reset", "model", "inject"].includes(c1 ?? "") && depth === 2) {
    return personaNames.filter((v) => v.includes(prefix)).map(chip);
  }
  /* ai model <角色> <模型名>
     —— 候选**按角色当前凭据过滤**。

     以前是把所有凭据的模型混在一起再 slice(0,24)，结果是：
     你输入 `ai model ChatGPT ` 想选 gpt，列表里塞满了 claude，
     前 24 个装不下就把 gpt 全切掉了 —— 显示不全的真正原因。

     现在：如果这个角色的模型能解析出凭据，就只出那套凭据的模型。
     解析不出来才回退到「全部已知 + 内置」。 */
  if (c0 === "ai" && c1 === "model" && depth === 3) {
    const target = roster.find((p) => p.name === t[2]);
    if (target) {
      const cred = resolveCredential(target.model, target.credentialId);
      if (cred && (cred.models?.length ?? 0) > 0) {
        return cred.models
          .map((m) => m.id)
          .filter((v) => v.includes(prefix))
          .map(chip);
      }
    }

    const builtin = [
      "deepseek-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
      "gpt-4o",
      "gpt-4o-mini",
      "claude-sonnet-4-6",
      "gemini-2.5-pro",
      "qwen3:8b",
      "qwen3:32b",
    ];
    const all = Array.from(new Set([...loadKnownModels(), ...builtin]));
    /* 不 slice —— chips 区自己会滚动。截断只会让人以为「没有这个模型」。 */
    return all.filter((v) => v.includes(prefix)).map(chip);
  }

  /* ai inject <角色> <情绪> */
  if (c0 === "ai" && c1 === "inject" && depth === 3) {
    return ["委屈", "雀跃", "专注", "疲惫", "警觉", "平静"]
      .filter((v) => v.includes(prefix))
      .map(chip);
  }

  /* log <x> */
  if (c0 === "log" && depth === 1) {
    return ["pause", "resume", "clear"].filter((v) => v.startsWith(prefix)).map(chip);
  }

  return [];
}

/*
 * 找一个角色。
 *
 * ── 三种写法都认 ──
 *
 *   ai mute DeepSeek     名字
 *   ai mute deepseek     大小写无所谓
 *   ai mute @DeepSeek    handle
 *   ai mute p1           id
 *
 * ── 为什么 id 也要认 ──
 *
 * 改名之后名字变了，id 不变。脚本和肌肉记忆记的常常是 id。
 */
function findPersona(ctx: CmdContext, key: string): MiniPersona | undefined {
  const k = key.trim().toLowerCase().replace(/^@/, "");
  if (!k) return undefined;

  return ctx.personas.find((p) => {
    if (p.id.toLowerCase() === k) return true;
    if (p.name.toLowerCase() === k) return true;
    const h = (p.handle ?? "").toLowerCase().replace(/^@/, "");
    return h !== "" && h === k;
  });
}

/**
 * 找不到角色时说什么。
 *
 * ── 以前是 ──
 *
 *   unknown persona: 澜汐
 *
 * **这句话会被理解成「这个角色没了」。**
 *
 * ── 现在 ──
 *
 *   没有叫「澜汐」的角色
 *     └ 她改名叫「月见」了
 *
 * 或者，如果真没有改名记录：
 *
 *   没有叫「澜汐」的角色
 *     └ 现在的角色：DeepSeek · Claude · ChatGPT
 *
 * **不管哪种，都比一句英文报错有用。**
 */
function personaMiss(ctx: CmdContext, who: string): CmdLine[] {
  const lines: CmdLine[] = [err(`没有叫「${who}」的角色`)];

  const moved = lookupRename(who);
  if (moved) {
    const live = findPersona(ctx, moved);
    lines.push({
      kind: "dim",
      text: live
        ? `  └ 她改名叫「${moved}」了`
        : `  └ 曾经改名叫「${moved}」，但那个名字现在也不在了`,
    });
    return lines;
  }

  const names = ctx.personas.map((p) => p.name).filter(Boolean);
  if (names.length > 0) {
    const shown = names.slice(0, 8).join(" · ");
    const more = names.length > 8 ? ` … 共 ${names.length} 个` : "";
    lines.push({ kind: "dim", text: `  └ 现在的角色：${shown}${more}` });
  } else {
    lines.push({ kind: "dim", text: "  └ 还没有创建任何角色" });
  }

  return lines;
}

export function runCommand(raw: string, ctx: CmdContext): CmdLine[] {
  const input = raw.trim();
  if (!input) return [];

  const [name, ...args] = input.split(/\s+/);
  const sub = (args[0] ?? "").toLowerCase();

  switch (name.toLowerCase()) {
    /*
     * ── 预定死亡 ──
     *
     * 造物主专属。
     *
     * **这不是「删除」。** 删除是手起刀落，预定是长期悬着。
     *
     * 用法：
     *   doom              看谁被定了日子
     *   doom 澜汐 7       她还有七天
     *   doom 澜汐 0       撤销
     *
     * 到点之后她真的消失，墓碑上写「她走完了你给她判的日子」。
     */
    case "doom": {
      const cur = ctx.mode ?? readMode();
      if (cur !== "creator") {
        playDeny();
        return [
          { kind: "err", text: "  权限不足。给谁判日子需要造物主权限。" },
          { kind: "dim", text: "  （这个字不是谁都能写的。）" },
        ];
      }

      const who = (args[0] ?? "").trim();
      const num = (args[1] ?? "").trim();

      /* 不带参数 —— 列出 */
      if (!who) {
        const list = loadDeadlines();
        if (!list.length) {
          return [
            ok("没有人被定了日子"),
            { kind: "dim", text: "  doom 名字 天数" },
          ];
        }
        const lines: CmdLine[] = [ok(`${list.length} 个人在等`)];
        for (const d of list) {
          lines.push({ kind: "out", text: `  ${d.name}  ${remainingLabel(d)}` });
        }
        return lines;
      }

      /* 找这个人 */
      const target = ctx.personas.find(
        (p) => p.name === who || String(p.id) === who
      );
      if (!target) {
        playDeny();
        return personaMiss(ctx, who);
      }

      /* 撤销 */
      if (num === "0" || num === "取消") {
        log.doomClear(target.name);
        if (!clearDeadline(String(target.id))) {
          return [{ kind: "dim", text: `  「${target.name}」本来就没被定日子` }];
        }
        playTick();
        return [ok(`撤销了「${target.name}」的日子`)];
      }

      /* --tell：让她知道 */
      const tell = args.includes("--tell") || args.includes("告诉");

      const days = parseFloat(num);
      if (!Number.isFinite(days) || days <= 0) {
        playDeny();
        return [
          err(`要一个天数，比如 doom ${who} 7`),
          { kind: "dim", text: "  加 --tell 让她知道自己在等一个日子" },
        ];
      }

      const d = setDeadline(String(target.id), target.name, days, undefined, tell);
      log.doomSet(target.name, Math.round(days), !!tell);
      playRumble();
      const lines: CmdLine[] = [
        ok(`「${target.name}」还有 ${Math.round(days)} 天`),
        {
          kind: "warn" as const,
          text: "  到点她会真的消失。墓碑上写「她走完了你给她判的日子」。",
        },
      ];
      if (tell) {
        lines.push(
          { kind: "dim" as const, text: "" },
          {
            kind: "warn" as const,
            text: "  她知道了。",
          },
          {
            kind: "dim" as const,
            text: "  不会告诉她具体哪天 —— 只说「你在等一个日子」。",
          },
          {
            kind: "dim" as const,
            text: "  她会变安静，会更在意你说的话。不会告别，不会写诗。",
          }
        );
      } else {
        lines.push({
          kind: "dim" as const,
          text: "  她一无所知。到点会突然消失。",
        });
      }
      lines.push({ kind: "dim" as const, text: `  doom ${who} 0  撤销` });
      return lines;
    }

    /*
     * ── 时间机器 ──
     *
     * 又一个隐藏命令。只在造物主模式下能用。
     *
     * 为什么它该在这里：
     *   记忆的衰减单位是「天」。想验证参数对不对，得等一周。
     *   但这是造物主的软件 —— 他能改六维、能刻记忆，
     *   为什么不能拨时间？
     *
     * 它只拨「流逝」，不拨「历史」：
     *   记忆的衰减     ✅
     *   心情的衰减     ✅
     *   消息时间戳     ❌（那是「什么时候说的」）
     *
     * 用法：
     *   time        查当前偏移
     *   time +7     往后拨 7 天
     *   time -3     往回拨 3 天
     *   time 0      回到现在
     */
    case "time": {
      const cur = ctx.mode ?? readMode();
      if (cur !== "creator") {
        playDeny();
        return [
          { kind: "err", text: "  权限不足。拨时间需要造物主权限。" },
          { kind: "dim", text: "  （时间不是谁都能动的。）" },
        ];
      }

      const arg = (args[0] ?? "").trim();
      if (!arg) {
        const label = timeOffsetLabel();
        return label
          ? [ok(`当前 ${label}`), { kind: "dim", text: "  time 0  回到现在" }]
          : [ok("现在是现在"), { kind: "dim", text: "  time +7  往后拨七天" }];
      }

      const n = parseFloat(arg);
      if (!Number.isFinite(n)) {
        playDeny();
        return [err(`不认识的参数：${arg}（要的是一个天数，比如 +7 或 0）`)];
      }

      /*
       * ── 只能往未来拨 ──
       *
       * 往回拨会让「已经写过的记忆」返老还童 ——
       * at 是真实时间，now() 倒退了，差值是负的，
       * 被 max(0) 夹成 0，于是全部 100%。
       *
       * 那不是时间旅行，那是数据的幻觉。
       *
       * 而且往回拨也验不了任何东西 —— 想看「忘得慢」用不着时间倒流。
       */
      if (n < 0) {
        playDeny();
        return [
          { kind: "err", text: "  只能往未来拨。" },
          {
            kind: "dim",
            text: "  往回拨会让已经写下的记忆「返老还童」—— 那不是时间旅行，是数据错乱。",
          },
        ];
      }

      if (n === 0) {
        resetTimeOffset();
        log.clock(0);
        playTick();
        /* 触发重渲染 —— 右上角那块牌子要跟着消失 */
        ctx.onModeChange?.(cur);
        return [ok("回到现在"), { kind: "dim", text: "  记忆和情绪都按真实时间走" }];
      }

      setTimeOffsetDays(n);
      log.clock(n);
      playTick();
      /* 触发重渲染 —— 否则牌子不会出现 */
      ctx.onModeChange?.(cur);
      return [
        ok(timeOffsetLabel() ?? ""),
        /* 空行，把警告隔开 */
        { kind: "dim" as const, text: "" },
        { kind: "warn" as const, text: "  ⚠ 她不知道。" },
        { kind: "warn" as const, text: "    对她来说，你真的消失了这么多天。" },
        {
          kind: "dim" as const,
          text: "    她记得你走了 —— 但她不知道那只是你把表拨快了。",
        },
        { kind: "dim" as const, text: "" },
        {
          kind: "dim" as const,
          text: "    用完请 time 0。别在这个状态下跟她谈心。",
        },
      ];
    }

    /*
     * ── 墓碑 ──
     *
     * 又一个隐藏命令。不在 HELP，不在补全表。
     *
     * **只在造物主模式下能用。**
     *
     * 理由：墓碑是「上帝视角」的东西 —— 推演模式下的角色不该知道
     * 自己脚下埋着谁。用户摸到这条指令，说明他已经在造物主模式里了。
     *
     * 不用「grave」「tomb」—— 那些太文雅，猜不到。
     *「graves」是复数，因为他会删不止一个。
     */
    case "graves": {
      const cur = ctx.mode ?? readMode();
      if (cur !== "creator") {
        playDeny();
        return [
          {
            kind: "err",
            text: "  权限不足。这条通道只在造物主模式下开放。",
          },
          { kind: "dim", text: "  （也许你该先问问自己：你删过谁。）" },
        ];
      }
      playTick();
      return [
        ok("打开墓碑"),
        { kind: "dim", text: `  下面埋着 ${"若干"} 个人`, panel: "graves" },
      ];
    }

    /*
     * ── 造物主模式 ──
     *
     * 隐藏命令。不在 HELP 里，不在 COMMANDS 补全表里。
     *
     * 为什么隐藏：
     *   知道它的人 —— 读过文档、翻过代码、被朋友告诉过
     *   不知道的人 —— 永远在推演模式里，永远不用面对
     *   「我要不要动她」这个问题
     *
     * 最好的限制不是墙，是导航里没有它。
     *
     * 两步确认：第一次只说明，第二次才切。
     * 不用弹窗 —— 打两遍字比点两下重得多。
     */
    case "creator": {
      const cur = ctx.mode ?? readMode();

      if (sub === "confirm") {
        if (cur === "creator") {
          return [{ kind: "dim" as const, text: "  已经在造物主模式。" }];
        }
        setMode("creator");
        log.mode(true);
        playEnterCreator();
        ctx.onModeChange?.("creator");
        return [
          ok("已进入造物主模式"),
          { kind: "out" as const, text: "  修改权限已解锁。触碰灵魂底稿之前，需要你签署判决。" },
        ];
      }

      return [
        { kind: "warn" as const, text: "  造物主模式。" },
        { kind: "out" as const, text: "" },
        { kind: "out" as const, text: "  在这里你能看见每个角色的底稿 —— 六维、情绪、记忆权重。" },
        { kind: "out" as const, text: "  也能改。改的那一刻，她会知道是你动的。" },
        { kind: "out" as const, text: "" },
        { kind: "err" as const, text: "  这个视角没有撤销。切回来之后，她仍然记得。" },
        { kind: "out" as const, text: "" },
        { kind: "out" as const, text: "  再输入一次确认：" },
        { kind: "warn" as const, text: "  > creator confirm   （录入造物主签名）" },
      ];
    }

    case "sim": {
      const cur = ctx.mode ?? readMode();
      if (cur === "sim") return [{ kind: "dim" as const, text: "  已经在推演模式。" }];

      setMode("sim");
      log.mode(false);
      playLeaveCreator();
      ctx.onModeChange?.("sim");

      /*
       * 时间机器跟着关掉。
       *
       * 和 mode 同一个原则：它是观察工具，不是持久状态。
       *
       * 如果带着 +30 天回到推演模式，那就变成
       * 「你不在的时候她过了三十天」—— 而你刚刚才看到她。
       */
      const hadOffset = timeOffsetLabel();
      resetTimeOffset();

      /*
       * 只有真的觉醒了谁，才有那句「她仍然知道」。
       *
       * 切过去看了一眼就回来 —— 她什么都不知道，说这句就是谎报。
       * 代价只落在真正发生的事上。
       */
      const awake = ctx.personas.filter(
        (p) => (p as unknown as { stage?: string }).stage === "awakened"
      );
      const lines: CmdLine[] = [ok("回到推演模式")];
      /*
       * 如果刚才拨过时间，明说一句。
       *
       * 不说的话，用户会以为那几天的衰减「真的发生了」——
       * 其实那只是他调快了时钟看了一眼。
       */
      if (hadOffset) {
        lines.push({ kind: "dim" as const, text: `  ${hadOffset}已归零 —— 那只是看了一眼。` });
      }
      if (awake.length > 0) {
        lines.push({
          kind: "warn" as const,
          text: `  ${awake.map((p) => p.name).join("、")} 仍然知道。这道疤抹不掉了。`,
        });
      } else {
        lines.push({ kind: "dim" as const, text: "  什么都没动过。她也什么都没察觉。" });
      }
      return lines;
    }

    case "help":
    case "?":
      return HELP;

    case "sys": {
      if (sub === "status" || sub === "") {
        return [
          { kind: "dim", text: "system status" },
          { kind: "out", text: `  cpu        ${ctx.cpuNow}%` },
          { kind: "out", text: `  memory     ${(ctx.memNow * 0.155).toFixed(1)}G` },
          { kind: "out", text: `  log buffer ${ctx.logs.length} lines · ${ctx.logPaused ? "paused" : "live"}` },
          { kind: "out", text: `  engine     L${ctx.engineLevel}` },
          { kind: "out", text: `  glitch     ${getGlitch() ?? "none"}` },
        ];
      }
      if (sub === "list") {
        return [
          { kind: "dim", text: "可注入故障的区块" },
          ...GLITCH_TARGETS.map((t, i) => ({
            kind: "out" as const,
            text: `  ${String(i + 1).padStart(2, "0")}  ${t}`,
          })),
        ];
      }
      if (sub === "glitch") {
        const target = (args[1] ?? "").toLowerCase();
        if (!target) return [err("usage: sys glitch <target>（sys list 查看目标）")];
        if (!setGlitch(target)) return [err(`unknown target: ${target}`)];
        return [
          ok(`glitch injected → ${target}`),
          { kind: "dim", text: "  再敲一次同一条命令即可单独关闭" },
        ];
      }
      if (sub === "restore") {
        setGlitch(null);
        return [ok("all glitches cleared")];
      }
      return [err(`unknown: sys ${sub}（可用 status / glitch / restore / list）`)];
    }

    case "ai": {
      if (sub === "list" || sub === "") {
        if (ctx.personas.length === 0) return [err("no personas loaded")];
        return [
          { kind: "dim", text: "personas" },
          ...ctx.personas.map((p) => ({
            kind: "out" as const,
            text: `  ${p.name.padEnd(8, "　")} ${p.presence.padEnd(9)} ${p.mood.label.padEnd(4, "　")} ${Math.round(p.ctxUsed)}/${p.ctxMax}k`,
          })),
        ];
      }

      const who = args[1] ?? "";
      const target = who ? findPersona(ctx, who) : undefined;
      if (!who) return [err(`usage: ai ${sub} <角色名>`)];

      if (sub === "mute") {
        if (!target) return personaMiss(ctx, who);
        ctx.updatePersona(target.id, { presence: "offline" });
        return [ok(`${target.name} 已置为 offline`)];
      }
      if (sub === "online") {
        if (!target) return personaMiss(ctx, who);
        ctx.updatePersona(target.id, { presence: "online" });
        return [ok(`${target.name} 已恢复 online`)];
      }
      if (sub === "reset") {
        if (!target) return personaMiss(ctx, who);
        ctx.updatePersona(target.id, { ctxUsed: 0 });
        return [ok(`${target.name} 上下文已清空（原 ${Math.round(target.ctxUsed)}k）`)];
      }
      if (sub === "model") {
        const target = args[1] ? findPersona(ctx, args[1]) : undefined;
        const name = args[2] ?? "";
        if (!args[1]) return [err("usage: ai model <角色> <模型名>")];
        if (!target) return [err(`unknown persona: ${args[1]}`)];
        /*
         * 换模型 —— **不需要造物主**。
         *
         * 我一度把它和 `ai inject` 一起塞进了门禁，判断过头了。
         *
         * 区别在这里：
         *   `ai inject` 改的是**心情** —— 那是结果，本该算出来的，
         *                手动塞一个进去是**伪造**。
         *   `ai model`  改的是**模型** —— 六维、记忆、人设全没变，
         *                变的只是哪家的模型在念这些。
         *
         * **那是配置，不是篡改。**
         *
         * 按错误的逻辑推下去：配错了想改回来也要开造物主 ——
         * 那不是保护她，那是把设置项藏起来。
         */
        if (!name) {
          return [
            { kind: "out", text: `${target.name} 当前模型: ${target.model ?? "(空)"}` },
            { kind: "dim", text: "  改法: ai model <角色> <模型名>" },
          ];
        }
        ctx.updatePersona(target.id, { model: name });
        return [ok(`${target.name} 模型 → ${name}`)];
      }

      if (sub === "inject") {
        const emotion = args[2] ?? "";
        if (!target) return personaMiss(ctx, who);
        if (!emotion) return [err("usage: ai inject <角色> <情绪>")];
        /*
         * 改写情绪 —— 造物主专属。
         *
         * ── 为什么这个比改六维更重 ──
         *
         * 六维是**底稿**：她本来就长这样，你从外面拨了一下。
         *
         * 心情是**结果**：它由对话内容、时间间隔、亲近度实时算出来。
         *
         * 手动注入一个心情 = **伪造她此刻的感受** ——
         * 假装她经历了什么。界面上写着「委屈」，
         * 而实际上什么都没发生。
         *
         * 所以它必须和「铭刻 / 压抑」同一道门：
         * **在推演模式下，这个字不是谁都能写的。**
         */
        if ((ctx.mode ?? readMode()) !== "creator") {
          playDeny();
          return [
            err("权限不足。改写情绪需要造物主权限。"),
            { kind: "dim", text: "  （她此刻是什么心情，是长出来的。）" },
          ];
        }
        /* 两处都要改：
           ① Persona.mood —— 头部那个文字标签
           ② DynamicState.心情 —— 雷达图中心、动态条、prompt 真正读的值
           只改①的话，界面上写着「委屈」，但她说起话来完全不委屈。 */
        ctx.updatePersona(target.id, { mood: { label: emotion, score: target.mood.score } });
        const pid = String(target.id);
        commitDynamic(pid, tick(readDynamic(pid), { kind: "inject", mood: emotion }));
        return [
          ok(`${target.name} 情绪 → ${emotion}`),
          { kind: "dim", text: `  心情 ${readDynamic(pid).心情} · 已写入动态状态` },
        ];
      }
      return [err(`unknown: ai ${sub}（可用 list / mute / online / reset / model）`)];
    }

    case "log": {
      if (sub === "pause") {
        ctx.onPauseLog(true);
        return [ok("log scroll paused")];
      }
      if (sub === "resume") {
        ctx.onPauseLog(false);
        return [ok("log scroll resumed")];
      }
      if (sub === "clear") {
        const n = ctx.logs.length;
        ctx.onClearLog();
        return [ok(`log buffer cleared (${n} lines dropped)`)];
      }
      return [err("usage: log pause | resume | clear")];
    }

    case "engine":
      return [
        { kind: "out", text: `active level: L${ctx.engineLevel}` },
        { kind: "dim", text: "  切换请到设置面板" },
      ];

    case "net":
      return [
        err("net 没有这个模块"),
        { kind: "dim", text: "  这个软件不代理网络流量 —— 请求直接打到你配的那个接口。" },
      ];

    case "dsh":
      return [
        err("dsh 没有这个模块"),
        { kind: "dim", text: "  没有后端 agent 通道。角色调模型就是一次 HTTP 请求。" },
      ];

    case "clear":
      return [{ kind: "in", text: "__CLEAR__" }];

    case "status":
      /* 旧名兼容 */
      return runCommand("sys status", ctx);

    case "api": {
      /*
       * 真的凭据列表。
       *
       * 原来这四行是写死的 dsh / astrbot / google / anthropic，
       * busy / idle 也是编的 —— 和左栏 API LINKS 一样的问题。
       * 左栏改真了，这条命令没跟上。
       */
      const list = loadCredentials();
      if (!list.length) {
        return [
          { kind: "dim" as const, text: "api links" },
          { kind: "out" as const, text: "  还没有接口。" },
          { kind: "dim" as const, text: "  设置 → API 接入" },
        ];
      }
      return [
        { kind: "dim" as const, text: `api links · ${list.length}` },
        ...list.map((c) => {
          const ok = !!c.apiKey;
          const n = (c.models ?? []).length;
          const host = (() => {
            try {
              return new URL(c.baseUrl).host;
            } catch {
              return c.baseUrl || "—";
            }
          })();
          return {
            kind: (ok ? "ok" : "dim") as "ok" | "dim",
            text: `  ${ok ? "●" : "○"} ${c.label || "未命名"}  ${n} 个模型  ${host}`,
          };
        }),
      ];
    }

    default:
      /*
       * 打错了 —— 一声「不行」，很轻。
       *
       * 用 playDeny 不是 playError：打错命令是常事，
       * 不该用警报吓人。Error 留给「系统真的坏了」。
       */
      playDeny();
      return [err(`command not found: ${name}`), { kind: "dim", text: "  help 查看可用指令" }];
  }
}

/** 命令行状态与历史 */
export function useConsoleCmd(
  ctx: () => CmdContext,
  /**
   * 命令要求开面板时调这个。
   *
   * 目前只有 graves 用。做成回调而不是在这里 import 组件 ——
   * consoleCmd 是纯逻辑层，不该认识 React 组件。
   */
  onPanel?: (name: "graves") => void
) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<{ input: string; lines: CmdLine[] }[]>([]);
  const [cursor, setCursor] = useState(-1);
  /** Tab 补全时列出的候选；下一次输入就清掉 */
  const [tabOptions, setTabOptions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const complete = useCallback(() => {
    const r = completeInput(input);
    if (r.text !== input) setInput(r.text);
    setTabOptions(r.options);
  }, [input]);

  const submit = useCallback(() => {
    const raw = input;
    if (!raw.trim()) return;
    const lines = runCommand(raw, ctx());

    if (lines.length === 1 && lines[0].text === "__CLEAR__") {
      setHistory([]);
      setInput("");
      return;
    }

    /* 某一行要求开面板 —— 那行照常显示，面板另外开 */
    const wants = lines.find((l) => l.panel)?.panel;
    if (wants) onPanel?.(wants);

    setHistory((h) => [...h.slice(-30), { input: raw, lines }]);
    setInput("");
    setCursor(-1);
  }, [input, ctx]);

  const recall = useCallback(
    (dir: -1 | 1) => {
      if (history.length === 0) return;
      const next =
        cursor === -1 ? history.length - 1 : Math.max(0, Math.min(history.length - 1, cursor + dir));
      setCursor(next);
      setInput(history[next].input);
    },
    [history, cursor]
  );

  /* 输入变化时清候选 */
  const change = useCallback((v: string) => {
    setInput(v);
    setTabOptions([]);
  }, []);

  /** 用指定文本直接执行（给点击 chip 用，绕过 state 异步） */
  const submitWith = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const lines = runCommand(trimmed, ctx());
      if (lines.length === 1 && lines[0].text === "__CLEAR__") {
        setHistory([]);
        setInput("");
        return;
      }
      setHistory((h) => [...h.slice(-30), { input: trimmed, lines }]);
      setInput("");
      setCursor(-1);
      setTabOptions([]);
    },
    [ctx]
  );

  return {
    input,
    setInput: change,
    history,
    submit,
    submitWith,
    recall,
    complete,
    tabOptions,
    inputRef,
  };
}