import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { generationOf } from "../lib/graveyard";
import { AnimatePresence, motion } from "motion/react";
import { AGENT_MAP, isGroupId, type AgentId, type ConvId, type Message } from "../data/mock";
import { avatarMark } from "../lib/avatar";
import { usePersonas } from "../store/personas";
import { useGroups } from "../store/groups";
import MessageRow from "./MessageRow";
import Composer from "./Composer";
import SessionSettings from "./SessionSettings";
import GroupMembersDialog from "./GroupMembersDialog";
import { sumTokensK } from "../lib/tokens";
import BlockBoundary from "./BlockBoundary";
import { IconPencil, IconSliders, IconTail } from "./Icons";

const PRESENCE_LABEL: Record<string, string> = {
  online: "在线",
  thinking: "思考中",
  idle: "空闲",
  offline: "离线",
};

function CtxRing({ pct, color }: { pct: number; color: string }) {
  const r = 12.5;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-[34px] w-[34px] place-items-center">
      <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, pct / 100))}
          style={{
            filter: `drop-shadow(0 0 3px ${color}99)`,
            transition: "stroke-dashoffset .8s ease",
          }}
        />
      </svg>
      <span className="tabular text-[10px] text-mist/70">{Math.round(pct)}%</span>
    </div>
  );
}

function GroupStack() {
  const { personas } = usePersonas();
  return (
    <div className="relative flex h-[36px] w-[52px] items-center">
      {personas.slice(0, 3).map((a, i) => (
        <div
          key={a.id}
          className="absolute grid place-items-center rounded-full border-2"
          style={{
            left: i * 12,
            width: 26,
            height: 26,
            borderColor: "#061019",
            background: `linear-gradient(150deg, ${a.color}33, rgba(4,12,20,0.95))`,
            color: a.color,
            zIndex: 3 - i,
          }}
        >
          <span className="text-[11px] font-semibold leading-none">
            {["鲸", "汐", "G"][i]}
          </span>
        </div>
      ))}
    </div>
  );
}

/*
 * ══ 为什么外面要套一层 ══
 *
 * 里面那个组件在 hooks 之后做过一次早退：
 *
 *   const { get } = useGroups();   ← 已经用了一个 hook
 *   if (!isGroup && !agent) return <「这个角色已经不在了」/>;
 *   useMemo(...) useRef(...) ...   ← 这些就不执行了
 *
 * 于是当「这个 conv 到底算什么」在两次渲染之间变了，
 * React 会看到 hooks 数量对不上，整个聊天区崩成：
 *
 *   Rendered fewer hooks than expected.
 *
 * 什么时候会变？旧版本存档、手动改过的 localStorage、
 * 导入了 id 不是 `grp-*` 的群 —— 都算。
 *
 * 修法：**把判断挪到一个不带任何 hook 的组件里**。
 * 零 hook 的组件怎么早退，hook 数量都是 0，不会对不上。
 */
export default function ChatStage(props: Parameters<typeof ChatStageInner>[0]) {
  const isGroup = isGroupId(props.conv);
  const agent = isGroup ? null : AGENT_MAP[props.conv as AgentId];

  if (!isGroup && !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="text-[16px] text-mist/46">◌</span>
        <span className="text-[11px] text-mist/45">这个角色已经不在了</span>
        <span className="max-w-full truncate font-mono text-[10px] text-mist/35">
          {props.conv}
        </span>
        <span className="mt-1 text-[10px] text-mist/50">回到群聊，或重新接入一个角色</span>
      </div>
    );
  }

  return <ChatStageInner {...props} />;
}

function ChatStageInner({
  conv,
  messages,
  typing,
  onSend,
  onVoice,
  onAttach,
  quoting,
  onQuote,
  onCancelQuote,
  flashId,
  onRecall,
  pendingId,
  onPullBack,
  seedText,
  seedNonce,
  onUpdateCtx,
  onUpdateMembers,
}: {
  conv: ConvId;
  messages: Message[];
  typing: boolean;
  onSend: (text: string) => void;
  onVoice: (secs: number) => void;
  onAttach: () => void;
  quoting: Message | null;
  onQuote: (m: Message) => void;
  onCancelQuote: () => void;
  /** 搜索跳转过来时要高亮的那条消息 */
  flashId?: string | null;
  onRecall: (id: string) => void;
  /** 还在 6 秒待发窗口里 —— 她还没收到 */
  pendingId?: string | null;
  /** 把待发的消息拿回输入框（只有待发中的才有这个入口） */
  onPullBack?: (id: string, text: string) => void;
  /** 塞进输入框的文本 + 触发序号 */
  seedText?: string;
  seedNonce?: number;
  /** 改上下文上限（写回角色档案的 ctxMax） */
  onUpdateCtx: (ctxMax: number) => void;
  /** 改群成员 */
  onUpdateMembers: (members: string[]) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  /**
   * 「会话设置」从哪儿弹出的位置。
   *
   * 记下触发按钮的矩形，面板就长在它旁边 —— 这样用户不用在
   * 「我刚才点的是哪个」和「现在这块面板是哪个东西的设置」之间来回确认。
   */
  const [sessionAnchor, setSessionAnchor] = useState<DOMRect | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  /** 「群设置」从哪儿弹出的位置 */
  const [membersAnchor, setMembersAnchor] = useState<DOMRect | null>(null);
  const { personas: AGENTS, map: AGENT_MAP } = usePersonas();
  const { get: getGroup, rename: renameGroup } = useGroups();
  const isGroup = isGroupId(conv);
  const agent = isGroup ? null : AGENT_MAP[conv as AgentId];
  const accent = agent?.color ?? "#a9e8ff";
  /* 防御：调用方可能传 undefined（切换到一个还没有任何消息的会话） */
  const safeMessages = messages ?? [];

  /* 角色可能已经不在了（重置档案 / 导入旧数据 / 删了但 conv 没切走）。
     这里必须早退，否则下面 10 处 agent! 会逐条崩。 */
  if (!isGroup && !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6">
        <span className="text-[16px] text-mist/46">◌</span>
        <span className="text-[11px] text-mist/45">这个角色已经不在了</span>
        <span className="max-w-full truncate font-mono text-[10px] text-mist/44">{String(conv)}</span>
        <span className="mt-1 text-[10px] text-mist/50">回到群聊，或重新接入一个角色</span>
      </div>
    );
  }
  const group = isGroup ? getGroup(conv) : null;

  /* 群会话的上下文 = 这个群积累了多少；角色会话的 = 我跟这个人聊了多少。
     群的在算，角色的在存（这样 ai reset 才能真的清零）。 */
  const ctxMax = isGroup ? (group?.ctxMax ?? 128) : (agent?.ctxMax ?? 128);
  const ctxUsed = isGroup
    ? sumTokensK(safeMessages.map((m) => m.text ?? m.voice?.transcript))
    : (agent?.ctxUsed ?? 0);

  /* 群成员来自群数据，不再假设「core 就是群成员」 */
  const groupMembers = useMemo(() => {
    if (!isGroup) return [];
    const g = getGroup(conv);
    const ids = g?.members ?? [];
    return ids.map((id) => AGENT_MAP[id]).filter(Boolean);
  }, [isGroup, conv, getGroup, AGENT_MAP]);



  const byId = useMemo(() => {
    const m = new Map<string, Message>();
    safeMessages.forEach((x) => m.set(x.id, x));
    return m;
  }, [safeMessages]);

  /* 切会话立即贴底（无滑动感），新消息才用平滑滚动 */
  const prevConv = useRef<ConvId | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const instant = prevConv.current !== conv;
    prevConv.current = conv;
    const raf = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [conv, safeMessages.length, typing]);

  /* 从搜索结果跳过来：滚到那条消息，而不是贴底 */
  useLayoutEffect(() => {
    if (!flashId) return;
    const el = scroller.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const node = el.querySelector<HTMLElement>(`[data-msg-id="${flashId}"]`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [flashId, conv]);

  const ctxPct = Math.min(100, (ctxUsed / Math.max(1, ctxMax)) * 100);

  return (
    <div
      className="hud-blocks rail-sep relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {/* 每个会话自己的氛围色，切换时柔和过渡 */}
      <motion.div
        key={`aura-${conv}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.75, ease: "easeOut" }}
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: `radial-gradient(78% 46% at 50% 108%, ${accent}16, transparent 70%)`,
        }}
      />

      {/* ═══ 头部 ═══ */}
      <BlockBoundary kind="void" name="会话头">
      <motion.header
        key={`head-${conv}`}
        initial={{ opacity: 0, y: -7 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 shrink-0 px-4 pb-3 pt-3.5"
      >
        <div className="flex items-center gap-3">
          {isGroup ? (
            <GroupStack />
          ) : (
            <div
              className="grid h-[38px] w-[38px] place-items-center rounded-full"
              style={{
                background: `linear-gradient(150deg, ${accent}33, rgba(4,12,20,0.92))`,
                boxShadow: `0 0 0 1px ${accent}4d, 0 0 20px -6px ${accent}`,
              }}
            >
              <span
                className="text-[15px] font-semibold leading-none"
                style={{ color: accent, textShadow: `0 0 12px ${accent}` }}
              >
                {avatarMark(String(conv), agent?.name)}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[14.5px] font-semibold tracking-[0.01em] text-white">
                {isGroup ? (group?.name ?? "群聊") : agent!.name}
              </h1>
              {!isGroup && agent!.archetype && (
                <span className="shrink-0 text-[10px] font-normal text-mist/56">
                  {agent!.archetype}
                </span>
              )}
              {isGroup ? (
                <span className="rounded-[4px] border border-white/10 bg-white/[0.05] px-1.5 py-[0.5px] font-mono text-[10px] tracking-wider text-mist/60">
                  GROUP · 广播
                </span>
              ) : (
                <span
                  className="flex items-center gap-1 rounded-full px-1.5 py-[0.5px] text-[10px]"
                  style={{
                    background: `${accent}14`,
                    border: `1px solid ${accent}33`,
                    color: accent,
                  }}
                >
                  <span className="h-[4px] w-[4px] rounded-full bg-current" />
                  {PRESENCE_LABEL[agent!.presence]}
                </span>
              )}
            </div>

            <div className="mt-[2px] flex items-center gap-1.5 text-[10.5px] text-mist/55">
              {isGroup ? (
                <>
                  <button
                    onClick={() => setMembersOpen(true)}
                    className="-my-[3px] inline-flex min-h-[24px] items-center rounded-[4px] px-1 transition-colors hover:bg-white/[0.05] hover:text-biolum/85"
                    title="管理群成员"
                  >
                    {group?.members.length ?? 0} 位成员
                  </button>
                  <span className="text-mist/42">/</span>
                  <span className="text-biolum/60">上下文隔离已开启</span>
                </>
              ) : (
                <>
                  <span className="font-mono text-[10.5px]">{agent!.model}</span>
                  <span className="text-mist/42">/</span>
                  <span>
                    情绪 <span style={{ color: accent }}>{agent!.mood.label}</span>{" "}
                    <span className="tabular opacity-60">{agent!.mood.score}</span>
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/*
              * CONTEXT 环**自己就是按钮**。
              *
              * 它显示的是「这个会话用了多少上下文」，点它自然就该能改上限 ——
              * 不需要在旁边再放一个滑块图标让人去猜。
              */}
            <button
              onClick={(e) => {
                /* 两个面板互斥 —— 同时开会互相盖住，谁也看不清 */
                setMembersOpen(false);
                setSessionAnchor(e.currentTarget.getBoundingClientRect());
                setSessionOpen(true);
              }}
              title="会话设置 · 上下文上限"
              aria-label="会话设置"
              className="hidden items-center gap-1.5 rounded-lg border border-white/[0.06] bg-black/20 px-1.5 py-[3px] transition-colors hover:border-white/[0.12] sm:flex">
              <CtxRing pct={ctxPct} color={accent} />
              <div className="pr-1">
                <div className="label text-[9.5px] leading-none">context</div>
                <div className="tabular mt-[3px] text-[10px] leading-none text-ink/70">
                  {ctxUsed.toFixed(1)}/{ctxMax}k
                </div>
              </div>
            </button>
            {/* 滑块 → 群设置抽屉。原来它开的是会话设置，和 CONTEXT 环重复了 */}
            <button
              onClick={(e) => {
                setSessionOpen(false);
                setMembersAnchor(e.currentTarget.getBoundingClientRect());
                setMembersOpen(true);
              }}
              title="群设置 · 成员与群名"
              aria-label="群设置"
              className="grid h-7 w-7 place-items-center rounded-md text-mist/58 transition-colors hover:bg-white/[0.06] hover:text-ink/80"
            >
              <IconSliders size={15} />
            </button>
          </div>
        </div>
      </motion.header>
      </BlockBoundary>

      <div className="relative z-10 mx-4 h-px shrink-0 bg-gradient-to-r from-transparent via-white/[0.09] to-transparent" />

      {/* ═══ 消息区 ═══ */}
      <BlockBoundary kind="tear" name="消息流" data={{ messages: safeMessages.map((m) => m.text ?? m.voice?.transcript ?? "").filter(Boolean).slice(0, 2) }}>
      <div
        ref={scroller}
        className="thin-scroll relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-clip px-4 pb-4 pt-6"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={conv}
            initial={{ opacity: 0, y: 14, scale: 0.994 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto flex max-w-[820px] flex-col gap-3.5"
          >
            <div className="flex items-center gap-2.5 py-1">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/[0.08]" />
              <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-mist/52">
                <IconTail size={11} className="opacity-60" />
                {isGroup
                  ? "群聊上下文 · 与私聊完全隔离"
                  : `${agent!.engine} 专属会话 · 独立记忆`}
                {/*
                  第几代。

                  只在「这个名字埋过人」时才显示 —— 第一次是默认状态，
                  写出来是噪音。

                  放在这一行的末尾，比其他地方都轻：
                  不打断阅读，但每一屏都在。
                */}
                {!isGroup && agent && (() => {
                  const gen = generationOf(agent.name, 0);
                  if (gen <= 1) return null;
                  return (
                    <span
                      className="ml-1.5 rounded-[3px] px-1 py-[0.5px]"
                      style={{
                        background: "rgba(255,122,107,.1)",
                        color: "rgba(255,122,107,.68)",
                      }}
                    >
                      GEN {gen} · 第 {gen} 次推演
                    </span>
                  );
                })()}
              </span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/[0.08]" />
            </div>

            {safeMessages.map((m, i) => (
              <MessageRow
                key={m.id}
                msg={m}
                index={i}
                isGroup={isGroup}
                quoted={m.replyTo ? byId.get(m.replyTo) : undefined}
                onQuote={onQuote}
                highlight={flashId === m.id}
                onRecall={() => onRecall(m.id)}
                pending={pendingId === m.id}
                onPullBack={
                  onPullBack ? (text) => onPullBack(m.id, text) : undefined
                }
              />
            ))}

            <AnimatePresence>
              {typing && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 pl-1"
                >
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-[5px] w-[5px] rounded-full"
                        style={{
                          background: accent,
                          animation: `wave-bar 1.1s ease-in-out ${i * 0.14}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-mist/58">
                    {isGroup ? "有人在组织语言…" : `${agent!.name} 正在输入`}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>
      </BlockBoundary>

      <div className="pointer-events-none relative z-[15] -mt-8 h-8 bg-gradient-to-t from-[#050e16] to-transparent" />

      <div className="relative z-20">
        <BlockBoundary kind="inputlock" name="输入区">
        <Composer
          accent={accent}
          isGroup={isGroup}
          targetLabel={isGroup ? (group?.name ?? "群聊") : agent!.name}
          onSend={onSend}
          onVoice={onVoice}
          onAttach={onAttach}
          seedText={seedText}
          seedNonce={seedNonce}
          quoting={
            quoting
              ? {
                  name:
                    quoting.author === "me"
                      ? "主人"
                      : AGENT_MAP[quoting.author as AgentId]?.name ?? "对方",
                  text: quoting.text ?? quoting.voice?.transcript ?? "",
                }
              : null
          }
          onCancelQuote={onCancelQuote}
          members={
            isGroup
              ? groupMembers.map((a) => ({
                  name: a.name,
                  color: a.color,
                }))
              : []
          }
        />
        </BlockBoundary>
      </div>

      {/*
         * AnimatePresence 是退出动画的前提 ——
         * 没有它，条件为 false 时 React 直接卸载 DOM，motion 的 exit 根本没机会播。
         */}
      <AnimatePresence>
      {membersOpen && isGroup && group && (
        <GroupMembersDialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          groupName={group.name}
          groupId={conv}
          personas={AGENTS}
          members={group.members}
          onSave={(_id, list) => onUpdateMembers(list.map(String))}
          onRename={(id, name) => renameGroup(id, name)}
          anchor={membersAnchor}
        />
      )}
      </AnimatePresence>

      {/* 会话设置：只放真能改的（上下文上限直接写回角色档案） */}
      <AnimatePresence>
      {sessionOpen && (
        <SessionSettings
          open={sessionOpen}
          anchor={sessionAnchor}
          onClose={() => setSessionOpen(false)}
          subject={
            agent
              ? `${agent.name} · ${agent.model}`
              : `${group?.name ?? "群聊"} · ${group?.members.length ?? 0} 位成员`
          }
          modelName={agent?.model ?? "group"}
          ctxUsed={ctxUsed}
          ctxMax={ctxMax}
          onSave={(v) => onUpdateCtx(v)}
        />
      )}
      </AnimatePresence>
    </div>
  );
}