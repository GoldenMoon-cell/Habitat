import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Message } from "../data/mock";
import { stripMentionBrackets } from "../lib/conversation";
import { usePersonas } from "../store/personas";
import { RichText } from "../lib/RichText";
import VoiceBar from "./VoiceBar";
import { IconFile, IconTail, IconUndo } from "./Icons";
import { notify } from "../lib/notify";
import { avatarMark } from "../lib/avatar";
import { speak, speakable, stopSpeaking } from "../lib/tts";
import ContextMenu from "./ContextMenu";

function AgentAvatar({
  id,
  name,
  color,
  size = 30,
  ring,
}: {
  id: string;
  name?: string;
  color: string;
  size?: number;
  ring?: boolean;
}) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, ${color}38 0%, rgba(4,12,20,0.92) 68%)`,
        boxShadow: ring
          ? `0 0 0 1.5px ${color}66, 0 0 14px -4px ${color}cc, inset 0 0 10px ${color}22`
          : `0 0 0 1px ${color}44, inset 0 0 10px ${color}22`,
      }}
      aria-hidden
    >
      <span
        className="font-semibold leading-none"
        style={{ fontSize: size * 0.42, color, textShadow: `0 0 10px ${color}99` }}
      >
        {avatarMark(id, name)}
      </span>
    </div>
  );
}

export default function MessageRow({
  msg,
  isGroup,
  quoted,
  index,
  onQuote,
  highlight,
  onRecall,
  pending,
  onPullBack,
}: {
  msg: Message;
  isGroup: boolean;
  quoted?: Message;
  index: number;
  onQuote?: (m: Message) => void;
  /** 从搜索结果跳过来时高亮这条 */
  highlight?: boolean;
  onRecall?: () => void;
  /** 还在 6 秒待发窗口里 —— 她还没收到 */
  pending?: boolean;
  /**
   * 把这条待发的消息拿回输入框。
   *
   * **只在待发窗口里成立** —— 那时她还没收到，所以「拿回去重写」
   * 不会有任何后果。发出之后就不该再有这个入口。
   */
  onPullBack?: (text: string) => void;
}) {
  /* ── 系统事件条：快捷命令的可见反馈 ── */
  if (msg.system) {
    const c = msg.system.accent ?? "#35f0ce";
    return (
      <motion.div
        initial={{ opacity: 0, scaleX: 0.9 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="flex items-center gap-2.5 py-0.5"
      >
        <span
          className="h-px flex-1"
          style={{ background: `linear-gradient(90deg, transparent, ${c}33)` }}
        />
        <span
          className="flex max-w-full items-center gap-1.5 rounded-full border px-2 py-[2px] text-[10.5px]"
          style={{ borderColor: `${c}30`, background: `${c}0e`, color: `${c}cc` }}
        >
          <IconTail size={9} className="shrink-0 opacity-70" />
          {/* label 不许换行 —— 它是这条消息的主语（哪个模型 / 哪个角色）。
              断成「claude-sonnet-5-5 现在不可 / 用」就完全没法读了 */}
          <span className="shrink-0 whitespace-nowrap">{msg.system.label}</span>
          {msg.system.detail && (
            <span className="tabular min-w-0 break-words opacity-55">· {msg.system.detail}</span>
          )}
        </span>
        <span
          className="h-px flex-1"
          style={{ background: `linear-gradient(270deg, transparent, ${c}33)` }}
        />
      </motion.div>
    );
  }

  const { map: AGENT_MAP } = usePersonas();
  const mine = msg.author === "me";
  const agent = mine ? null : AGENT_MAP[msg.author as string];
  const color = mine ? "#6fd8ff" : agent?.color ?? "#8fa9bd";

  /* 内联编辑：只对自己的消息开放 */
  const [editing, setEditing] = useState(false);
  /* 这条正在念吗 —— 按钮据此显示「停止」 */
  const [speaking, setSpeaking] = useState(false);
  /* 右键菜单的位置 */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState(msg.text ?? "");
  const editRef = useRef<HTMLTextAreaElement>(null);


  const plain = msg.text ?? msg.voice?.transcript ?? "";
  const speaker = mine ? "主人" : agent?.name ?? "对方";

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      notify({
        title: "已复制",
        desc: plain.length > 22 ? `${plain.slice(0, 22)}…` : plain,
        accent: color,
        icon: "log",
      });
    } catch {
      notify({
        title: "复制被拒绝",
        desc: "浏览器没给剪贴板权限",
        accent: "#ff7a6b",
        icon: "log",
      });
    }
  };

  const doQuote = () => {
    if (!onQuote) {
      notify({
        title: "引用不可用",
        desc: "这条消息没有接入引用通道",
        accent: "#ff7a6b",
        icon: "log",
      });
      return;
    }
    onQuote(msg);
  };

  /*
   * 朗读 —— 这是唯一的语音入口。
   *
   * 之前是自动播的，问题在群聊：三个人连着回，三条语音
   * 互相打断，实际只能听到最后一条的前半截。
   *
   * 现在：文字流是主，想听就点这一下。点第二次 = 停。
   */
  const doSpeak = async () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }

    const raw = msg.text ?? msg.voice?.transcript ?? "";
    const toSay = speakable(raw);

    if (!toSay) {
      notify({
        title: "这条念不了",
        desc: "没有可读的正文（可能只有图片或附件）",
        accent: "#ffb454",
        icon: "speaker",
      });
      return;
    }

    const p = AGENT_MAP[String(msg.author)];
    const voice = (p as unknown as { voice?: string })?.voice;

    setSpeaking(true);
    const ok = await speak(toSay, voice, () => setSpeaking(false));

    if (!ok) {
      setSpeaking(false);
      notify({
        title: "没出声",
        desc: "设置 → 语音 里选一个档位（「系统」零配置就能用）",
        accent: "#ffb454",
        icon: "speaker",
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, filter: "blur(5px)" }}
      animate={{ opacity: pending ? 0.55 : 1, y: 0, filter: "blur(0px)" }}
      transition={{
        duration: 0.4,
        delay: Math.min(index * 0.028, 0.16),
        ease: [0.16, 1, 0.3, 1],
      }}
      className={`relative flex w-full gap-2.5 ${mine ? "flex-row-reverse" : "flex-row"}`}
      data-msg-id={msg.id}
      onContextMenu={(e) => {
        /* 系统条没有可操作的东西 —— 别装作有 */
        if (msg.system) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/*
        ── 右键菜单 ──

        和悬停那条小按钮栏做的是同一批事。

        为什么两个都要：悬停按钮**藏在鼠标移动里** —— 你不移上去就不知道有它。
        右键是"我知道这里能点，但我想直接看到全部选项"。

        **不重复实现** —— 菜单项直接调下面那几个函数。
      */}
      <AnimatePresence>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              { label: "复制", onSelect: () => void doCopy() },
              { label: "引用", disabled: !onQuote, onSelect: doQuote },
              {
                label: speaking ? "停止朗读" : "朗读",
                onSelect: () => void doSpeak(),
              },
              /*
               * ── 分隔线以下：只对「还没发出去」的消息开放 ──
               *
               * **已经发出的消息没有撤回。**
               *
               * 撤回的前提是「对方还没看到」——
               * 她回了，就说明她看到了，那就没有可撤回的东西了。
               *
               * 这也是整个 6 秒窗口的意义：**话还没说出口，就还是你的。**
               * 一旦说出口，就是泼出去的水。
               */
              ...(mine && pending && !msg.recalled ? [{ sep: true }] : []),

              /*
               * ── 取回 ──
               *
               * 把这条还没发出去的消息拿回输入框：
               * 消息从对话里消失，文字回到你手上，6 秒计时器作废。
               *
               * 她全程不知道有这条。
               */
              ...(mine && pending && onPullBack
                ? [
                    {
                      label: "取回",
                      hint: "她还没收到",
                      onSelect: () =>
                        onPullBack(msg.text ?? msg.voice?.transcript ?? ""),
                    },
                  ]
                : []),

              /*
               * ── 删除 ──
               *
               * 真的扔掉，连文字都不留。她同样不知道。
               *
               * 和「取回」的区别只有一件事：你还要不要那句话。
               */
              ...(mine && pending && onRecall
                ? [
                    {
                      label: "删除",
                      hint: "当没发过",
                      danger: true,
                      onSelect: () => onRecall(),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </AnimatePresence>
      {/*
        ── 待发窗口 ──

        这条还没发出去 —— 她在 6 秒之后才收到。

        半透明是整个 div 的 opacity（上面那行），
        这里只画一条 6 秒走完的进度条 + 一个小字。

        撤回它 = 直接消失，她从头到尾不知道有这条。
      */}
      {pending && (
        <div className="pointer-events-none absolute -top-[13px] right-0 left-0 flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-wider text-amber/60">
            待发
          </span>
          <span className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-amber/50"
              style={{
                animation: "pending-countdown 6s linear forwards",
                width: "100%",
              }}
            />
          </span>
        </div>
      )}
      {!mine && (
        <div className="pt-[2px]">
          <AgentAvatar
            id={msg.author}
            name={agent?.name}
            color={color}
            size={isGroup ? 29 : 32}
            ring={isGroup}
          />
        </div>
      )}

      <div
        className={`flex min-w-0 max-w-[86%] flex-col gap-[3px] ${
          mine ? "items-end" : "items-start"
        }`}
      >
        {/* 发言人 */}
        {!mine && (
          <div className="flex items-baseline gap-1.5 px-[3px]">
            <span className="text-[11px] font-medium tracking-wide" style={{ color }}>
              {agent?.name}
            </span>
            {isGroup && (
              <span className="font-mono text-[10px] tracking-wider text-mist/48">
                {agent?.engine}
              </span>
            )}
            <span className="tabular text-[10px] text-mist/46">{msg.time}</span>
          </div>
        )}

        {/* 气泡 */}
        <div
          className={`group/bubble relative px-3 py-[7px] transition-colors duration-200 ${
            isGroup && !mine ? "pl-[13px]" : ""
          }`}
          style={{
            borderRadius: mine ? "13px 13px 4px 13px" : "13px 13px 13px 4px",
            background: mine
              ? "linear-gradient(136deg, rgba(78,140,255,0.34) 0%, rgba(53,240,206,0.14) 100%)"
              : `linear-gradient(154deg, ${color}16 0%, rgba(9,22,32,0.78) 58%, rgba(6,16,25,0.72) 100%)`,
            border: `1px solid ${
              highlight ? `${color}aa` : mine ? "rgba(150,220,255,0.22)" : `${color}30`
            }`,
            boxShadow: highlight
              ? `0 0 0 2px ${color}33, 0 0 18px -6px ${color}`
              : mine
                ? "inset 0 1px 0 rgba(200,245,255,0.16), 0 6px 22px -14px rgba(78,140,255,0.9)"
                : `inset 0 1px 0 rgba(200,245,255,0.05), 0 6px 20px -18px ${color}`,
            color: mine ? "#f0fbff" : "#d9e8f2",
            transition: "border-color 320ms ease, box-shadow 320ms ease",
          }}
        >

          {/* 群聊里每条 AI 消息左侧的角色色标尺 */}
          {isGroup && !mine && (
            <span
              className="absolute left-[4px] top-2 bottom-2 w-[2px] rounded-full"
              style={{
                background: `linear-gradient(180deg, ${color}ee, ${color}22)`,
                boxShadow: `0 0 8px -1px ${color}`,
              }}
            />
          )}

          {quoted && (
            <div
              className="mb-1.5 rounded-[5px] border-l-2 px-2 py-1 text-[11px] leading-[1.5]"
              style={{
                borderColor: `${color}66`,
                background: "rgba(255,255,255,0.035)",
                color: "rgba(217,232,242,0.6)",
              }}
            >
              <span className="mr-1 opacity-60">
                {quoted.author === "me"
                  ? "主人"
                  : AGENT_MAP[quoted.author as keyof typeof AGENT_MAP]?.name}
              </span>
              {(quoted.text ?? quoted.voice?.transcript ?? "").slice(0, 46)}
              {(quoted.text ?? "").length > 46 ? "…" : ""}
            </div>
          )}

          {msg.recalled ? (
            /*
             * ── 历史数据 ──
             *
             * 2026-10-28 之后「撤回」这个动作已经不存在了（发出去就不能收回）。
             * 但旧数据里可能还有 recalled: true 的条目 —— 那些要能正常显示。
             *
             * 所以这个分支留着，但**不再有新的入口能写出 recalled**。
             */
            <div className="flex items-center gap-1.5 italic text-[11.5px] leading-[1.6] text-mist/56">
              <IconUndo size={11} className="opacity-60" />
              {mine ? "你撤回了一条消息" : `${speaker} 撤回了一条消息`}
            </div>
          ) : msg.voice ? (
            <VoiceBar clip={msg.voice} color={color} align={mine ? "right" : "left"} />
          ) : msg.text ? (
            <div className={mine ? "text-[13px] leading-[1.7]" : ""}>
              {/*
                显示时去掉 `[@名字]` 的方括号。

                **只在显示层做**：存储里必须留着方括号 ——
                否则下一轮 pickNext 读到的正文就解析不出被点名的是谁。
              */}
              <RichText text={stripMentionBrackets(msg.text)} />
              {msg.streaming && (
                <span className="caret ml-[2px] inline-block h-[11px] w-[5px] translate-y-[1px] bg-current opacity-70" />
              )}
            </div>
          ) : null}

          {msg.attach && (
            <div
              className="mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-200 group-hover/bubble:bg-white/[0.03]"
              style={{
                background: "rgba(0,0,0,0.28)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                className="grid h-6 w-6 place-items-center rounded-[5px]"
                style={{ background: `${color}1f`, color }}
              >
                <IconFile size={12} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11.5px] text-ink/85">{msg.attach.name}</div>
                <div className="font-mono text-[10px] text-mist/56">{msg.attach.meta}</div>
              </div>
            </div>
          )}
        </div>

        {msg.reactions && msg.reactions.length > 0 && (
          <div className={`flex gap-1 ${mine ? "pr-1" : "pl-1"}`}>
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                className="flex items-center gap-[3px] rounded-full border border-white/[0.07] bg-white/[0.035] px-[5px] py-[0.5px] text-[10.5px] text-mist/70 transition-all duration-150 hover:-translate-y-[1px] hover:border-biolum/30 hover:text-biolum"
              >
                <span>{r.emoji}</span>
                <span className="tabular">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {mine && (
          <span className="tabular flex items-center gap-1 pr-1 text-[10px] text-mist/46">
            {msg.edited && <span className="italic text-mist/50">已编辑</span>}
            {msg.time}
          </span>
        )}
      </div>
    </motion.div>
  );
}
