import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import ForceRenameDialog from "./ForceRenameDialog";
import { loadThreads } from "../data/threads";
import { loadPersonas, savePersonas } from "../data/personaStore";
import { collectArchive } from "../lib/archive";
import { generationOf } from "../lib/graveyard";
import { deadlineOf, remaining, remainingLabel } from "../lib/deadline";
import { pushMemory } from "../lib/memoryNotes";
import { commitDynamic, readDynamic } from "../lib/dynamic";
import { notify } from "../lib/notify";
import { OWNER, type Agent, type ConvId } from "../data/mock";
import { fmtTokens, peakTokens, usageToday } from "../lib/usage";
import { usePersonas } from "../store/personas";
import {
  IconChevron,
  IconPin,
  IconPlus,
  IconSearch,
  IconSliders,
  IconSpark,
  IconSessions,
  IconTail,
  IconTrash,
} from "./Icons";
import BlockBoundary from "./BlockBoundary";
import { avatarMark } from "../lib/avatar";
import { resolveCredential } from "../store/credentials";

/** 分组标题栏，点一下折叠/展开 */
function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
  hint,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  hint?: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={hint}
      className="group/hd mb-1 mt-3 flex w-full items-center gap-1 px-2 text-left transition-opacity hover:opacity-80"
    >
      {/* IconChevron 本身指向右：展开时转 90° 朝下 */}
      <IconChevron
        size={9}
        className={`shrink-0 text-mist/50 transition-transform duration-200 ${
          collapsed ? "" : "rotate-90"
        }`}
      />
      <span className="label text-[9.5px]">{label}</span>
      <span className="ml-auto font-mono text-[9.5px] text-mist/48">{count}</span>
    </button>
  );
}

function Avatar({
  color,
  id,
  name,
  size = 34,
  active,
}: {
  color: string;
  id: string;
  name?: string;
  size?: number;
  active?: boolean;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <div
        className="absolute inset-0 rounded-full transition-all duration-300"
        style={{
          background: `radial-gradient(circle at 30% 25%, ${color}30, transparent 68%)`,
          boxShadow: active
            ? `0 0 0 1px ${color}66, 0 0 16px -5px ${color}88`
            : `0 0 0 1px ${color}2e`,
        }}
      />
      <div
        className="absolute inset-[1.5px] grid place-items-center rounded-full border"
        style={{
          borderColor: `${color}3a`,
          background: `linear-gradient(150deg, ${color}1f 0%, rgba(4,12,20,0.92) 62%)`,
          color,
        }}
      >
        <span
          className="font-semibold leading-none"
          style={{ fontSize: size * 0.4, textShadow: `0 0 12px ${color}aa` }}
        >
          {avatarMark(id, name)}
        </span>
      </div>
    </div>
  );
}

function ConvRow({
  active,
  onClick,
  color,
  children,
  badge,
  meta,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  children: React.ReactNode;
  badge?: number;
  meta?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className="group relative flex w-full items-center gap-2.5 rounded-[10px] px-2 py-[7px] text-left transition-colors duration-200"
      style={{
        background: active
          ? `linear-gradient(96deg, ${color}1c 0%, ${color}07 42%, transparent 100%)`
          : undefined,
      }}
    >
      {active && (
        <motion.span
          layoutId="conv-marker"
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="absolute left-0 top-1/2 h-[22px] w-[2px] -translate-y-1/2 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px ${color}` }}
        />
      )}
      <span
        className="absolute inset-0 rounded-[10px] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: "rgba(255,255,255,0.028)" }}
      />
      {children}
      <div className="relative ml-auto flex shrink-0 flex-col items-end gap-1">
        {meta && (
          <span className="tabular text-[10px] text-mist/52 group-hover:text-mist/55">{meta}</span>
        )}
        {typeof badge === "number" && badge > 0 && (
          <span className="grid h-[15px] min-w-[15px] place-items-center rounded-full bg-biolum px-[4px] text-[10px] font-bold leading-none text-abyss">
            {badge}
          </span>
        )}
      </div>
    </motion.button>
  );
}

/** 一行角色 */
function AgentRow({
  a,
  active,
  onSelect,
  onDelete,
  onEdit,
  onForceRename,
  peerNames,
}: {
  a: Agent;
  active: ConvId;
  onSelect: (id: ConvId) => void;
  onDelete?: () => void;
  onEdit?: () => void;
  /** 强制改名 —— 交给上层处理（改库 + 插系统消息 + 后遗症） */
  onForceRename?: (nextName: string) => void;
  /** 其他角色的名字 —— 改名不能撞上它们 */
  peerNames?: string[];
}) {
  /*
   * 置顶 / 归档 —— 直接改 store。
   *
   * 不从上层传 prop：这两个动作只动自己身上两个布尔值，
   * 穿过三层 props 传下来没有意义，还容易漏传。
   */
  const { update } = usePersonas();
  const patch = (p: { pinned?: boolean; archived?: boolean }) =>
    update(String(a.id) as never, p as never);

  /*
   * 右键菜单。
   *
   * 之前这行角色卡上只有「悬停才出现的编辑/删除」两个小图标 ——
   * 而「导出这个角色」「复制名字」这类操作**根本没有入口**。
   *
   * 右键是放这类次要动作最自然的地方。
   */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** 强制改名弹窗 */
  const [forceRename, setForceRename] = useState(false);

  const menuItems: MenuItem[] = [
    {
      label: "导出这个角色",
      hint: "含对话",
      onSelect: async () => {
        const bundle = collectArchive("single", a.id);
        const r = await window.desktop?.exportData({ scope: "single", bundle });
        if (r?.ok) {
          notify({
            title: `已导出 ${a.name}`,
            desc: `${bundle.data.personas.length} 个角色 · ${((r.bytes ?? 0) / 1024).toFixed(0)} KB`,
            accent: "#35f0ce",
            icon: "log",
          });
        } else if (r && !r.canceled) {
          notify({ title: "导出失败", desc: r.error, accent: "#ff7a6b" });
        }
      },
    },
    {
      label: "只导人格",
      hint: "无对话",
      onSelect: async () => {
        const one = collectArchive("single", a.id);
        const bundle = { ...one, data: { ...one.data, threads: undefined } };
        const r = await window.desktop?.exportData({ scope: "persona-card", bundle });
        if (r?.ok) {
          notify({
            title: `已导出 ${a.name} 的角色卡`,
            desc: "不含对话记录，可以直接分享",
            accent: "#35f0ce",
            icon: "log",
          });
        }
      },
    },
    { sep: true, label: "" },
    {
      label: "复制名字",
      hint: "⌘C",
      onSelect: async () => {
        try {
          await navigator.clipboard.writeText(a.name);
          notify({ title: "已复制", desc: a.name, accent: "#35f0ce", icon: "log" });
        } catch {
          notify({ title: "复制失败", desc: "剪贴板不可用", accent: "#ff7a6b" });
        }
      },
    },
    { sep: true, label: "" },
    { label: "编辑角色", onSelect: () => onEdit?.() },
    /*
     * 置顶 / 归档 —— 放在编辑下面、危险操作上面。
     *
     * 这两个都**可逆**，所以不是红色；但它们改的是"看得见看不见"，
     * 所以也不能混在编辑里。
     */
    {
      label: a.pinned ? "取消置顶" : "置顶",
      onSelect: () => patch({ pinned: !a.pinned }),
    },
    {
      label: a.archived ? "取消归档" : "归档",
      hint: a.archived ? "回到列表" : "从列表收起",
      onSelect: () => patch({ archived: !a.archived }),
    },
    {
      /*
       * 强制改名 —— 放在编辑下面，和它分开。
       *
       * 这不是「编辑」的一种，是一次越权。所以它单独一行、红字，
       * 点开还要再过一道带警告的确认。
       */
      label: "强制改名…",
      danger: true,
      onSelect: () => setForceRename(true),
    },
    { label: "删除角色", danger: true, onSelect: () => onDelete?.() },
  ];

  return (
    <div
      className="group/row relative"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <ForceRenameDialog
        open={forceRename}
        currentName={a.name}
        archetype={a.archetype}
        /* 场上唯一：改名不能撞上其他活着的角色 */
        existingNames={peerNames}
        rounds={
          (() => {
            const th = loadThreads() as Record<string, unknown[]>;
            const mine = th[String(a.id)];
            return Array.isArray(mine) ? mine.length : 0;
          })()
        }
        onCancel={() => setForceRename(false)}
        onConfirm={(nextName) => {
          setForceRename(false);
          onForceRename?.(nextName);
        }}
      />
      <AnimatePresence>
        {menu && (
          <ContextMenu
            key="ctx"
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>
      <ConvRow
        active={active === a.id}
        onClick={() => onSelect(a.id)}
        color={a.color}
        badge={a.unread}
        meta={a.presence === "thinking" ? "…" : ""}
      >
        <Avatar color={a.color} id={a.id} name={a.name} active={active === a.id} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate text-[12.5px] ${
                active === a.id ? "font-medium text-white" : "text-ink/86"
              }`}
            >
              {a.name}
            </span>
            {/*
              第几次。

              只在「这个名字埋过人」时才显示 —— 第一次不标，
              因为「第 1 次」是默认状态，写出来是噪音。

              从第 2 次开始，每一个同名角色都带着一个数字：
              **名字不是身份，次数才是。**
            */}
            {(() => {
              const gen = generationOf(a.name, 0);
              if (gen <= 1) return null;
              return (
                <span
                  className="shrink-0 rounded-[3px] px-1 py-[0.5px] font-mono text-[9.5px]"
                  style={{
                    background: "rgba(255,122,107,.09)",
                    color: "rgba(255,122,107,.62)",
                  }}
                >
                  {gen}
                </span>
              );
            })()}
            {/*
              ── 倒计时 ──

              只有被 `doom` 过的角色才有。

              **一天变一次，不跳秒。** 秒表是游戏 UI，
              这个软件里不该有那种东西。

              琥珀色 —— 和造物主模式同一个警告色。
            */}
            {(() => {
              const d = deadlineOf(String(a.id));
              if (!d) return null;
              const ms = remaining(d);
              const days = Math.ceil(ms / 86400000);
              return (
                <span
                  title={remainingLabel(d)}
                  className="shrink-0 rounded-[3px] px-1 py-[0.5px] font-mono text-[8.5px]"
                  style={{
                    background: "rgba(255,196,107,.1)",
                    color: "rgba(255,196,107,.8)",
                  }}
                >
                  {days > 0 ? `${days}d` : "·"}
                </span>
              );
            })()}
            {a.presence === "thinking" && (
              <span className="relative flex h-[5px] w-[5px]">
                <span
                  className="sonar-ring absolute inset-0 rounded-full"
                  style={{ background: a.color }}
                />
                <span
                  className="relative h-full w-full rounded-full"
                  style={{ background: a.color }}
                />
              </span>
            )}
          </div>
          <div className="truncate text-[10.5px] text-mist/52">{a.tagline}</div>
        </div>
      </ConvRow>

    </div>
  );
}

/** 左下角的一条指标：标签 / 数值 / 进度 / 说明 */
function Meter({
  label,
  value,
  pct,
  hint,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  hint?: string;
  color: string;
}) {
  return (
    <div className="group/m">
      <div className="flex items-baseline justify-between">
        <span className="label text-[9.5px] tracking-[0.18em]">{label}</span>
        <span className="tabular text-[10px] text-ink/70 transition-colors group-hover/m:text-ink/95">
          {value}
        </span>
      </div>
      <div className="relative mt-[4px] h-[3px] w-full overflow-hidden rounded-full bg-white/[0.055]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
          className="h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: `0 0 8px -1px ${color}99`,
          }}
        />
      </div>
      {hint && <div className="mt-[3px] text-[9.5px] tracking-wide text-mist/46">{hint}</div>}
    </div>
  );
}

export default function ContactsRail({
  active,
  onSelect,
  onEditPersona,
  onOpenSettings,
  onOpenEngine,
  engineLabel,
  searchMessages,
  onJump,
  onAddPersona,
  onCreateGroup,
  groups,
  onDeletePersona,
  onDeleteGroup,
  onForceRenamePersona,
}: {
  active: ConvId;
  onSelect: (id: ConvId) => void;
  /** 编辑某个角色的档案 */
  onEditPersona?: (id: ConvId) => void;
  onOpenSettings: () => void;
  /** 直接跳到设置里的「引擎」分区 */
  onOpenEngine: () => void;
  engineLabel: string;
  /** 打开创建角色向导 */
  onAddPersona?: () => void;
  /** 打开新建群聊 */
  onCreateGroup?: () => void;
  /** 群列表 */
  groups: { id: ConvId; name: string; members: string[] }[];
  /** 删除角色 */
  onDeletePersona?: (id: ConvId) => void;
  /** 强制改名：改库、插系统消息、扣数值、写记忆 —— 全部交给 App */
  onForceRenamePersona?: (id: ConvId, nextName: string) => void;
  /** 删除群聊 */
  onDeleteGroup?: (id: ConvId) => void;
  /** 全部会话里的消息，供搜索 */
  searchMessages?: {
    conv: ConvId;
    id: string;
    author: string;
    text: string;
    time: string;
  }[];
  /** 点搜索结果 → 跳到那条消息 */
  onJump?: (conv: ConvId, id: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");

  /**
   * 分组的折叠状态。
   *
   * 存本地：分组收起来是「我的习惯」，不是临时状态 ——
   * 每次重开都要重新折一遍会很烦。
   */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("3w:rail-collapsed");
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("3w:rail-collapsed", JSON.stringify(next));
      } catch {
        /* 存储不可用就只在本次会话生效 */
      }
      return next;
    });

  /* ⌘K / Ctrl+K 聚焦搜索 —— 键盘也该有反馈 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ql = q.trim().toLowerCase();
  const searching = ql.length > 0;

  const { personas: AGENTS, map: AGENT_MAP, update } = usePersonas();

  /*
   * 归档区开不开。
   *
   * 默认关着 —— 归档的意义就是「别让我看见」。
   * 但只要有一个归档的角色，底部就挂一个小入口，
   * **不让人再也找不着它**。
   */
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = AGENTS.filter((a) => a.archived).length;

  const filtered = AGENTS.filter((a) => {
    /* 归档的只在「显示归档」时出现 */
    if (a.archived && !showArchived) return false;
    if (!searching) return true;
    return (
      a.name.toLowerCase().includes(ql) ||
      a.engine.toLowerCase().includes(ql) ||
      a.tagline.toLowerCase().includes(ql)
    );
  });

  /*
   * 置顶的单独一栏。
   *
   * 注意下面 `autoPool` 和 `customGroups` 都把它排掉了 ——
   * 否则同一个角色会出两个地方，那是 bug 不是功能。
   */
  const pinnedList = filtered.filter((a) => a.pinned);

  /**
   * 分组依据：**能不能真的说话**，不是出厂的 tier。
   *
   * `core` / `extended` 是「作者人格 / 厂商角色」这种按来源分的类，
   * 对用户没意义 —— 他关心的是「我配的 key 够不够让这个角色活」。
   *
   * 一个角色能说话 = 它的模型能在你配的凭据里找到。
   *
   * 但用户自己贴过分组标签的，归他自己的分组，不参与自动分类 ——
   * 他既然动手分了，就说明「工作用的」「闲聊的」比「能不能连上」更贴近他的脑子。
   */
  const autoPool = filtered.filter((a) => !a.group?.trim() && !a.pinned);
  const connected = autoPool.filter((a) => !!resolveCredential(a.model, a.credentialId));
  const disconnected = autoPool.filter((a) => !resolveCredential(a.model, a.credentialId));

  /** 自定义分组：按名字排序，组内保持原顺序 */
  const customGroups: { name: string; list: typeof filtered }[] = (() => {
    const m = new Map<string, typeof filtered>();
    for (const a of filtered) {
      if (a.pinned) continue;
      const k = a.group?.trim();
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return [...m.entries()]
      .sort((x, y) => x[0].localeCompare(y[0], "zh"))
      .map(([name, list]) => ({ name, list }));
  })();

  /** 群聊也算一个可搜索的「会话」 */
  const groupHit = searching && (groups[0]?.name ?? "").toLowerCase().includes(ql);

  /** 消息命中：只取前 6 条，按时间倒序 */
  const msgHits = searching
    ? (searchMessages ?? []).filter((m) => m.text.toLowerCase().includes(ql)).slice(0, 6)
    : [];

  const noHit = searching && filtered.length === 0 && msgHits.length === 0 && !groupHit;

  /*
   * 今日用量。
   *
   * 原来这里有 `creditPct` / `ctxPct` —— 分母来自 `mock.ts` 里写死的
   * `credit.total = 120` 和 `context.max = 512`，**从没被更新过**。
   *
   * 现在只留我们真的算得出来的东西：
   *   · 调用次数  —— 请求是自己发的，一定准
   *   · token     —— 供应商报了 usage 就准，没报就估（界面带「≈」）
   */
  const today = usageToday();
  const todayTokens = today.prompt + today.completion;
  const peak = peakTokens();

  return (
    <div className="hud-blocks rail-sep grain relative flex min-h-0 flex-1 flex-col">
      {/* ── 标题 + 搜索 ── */}
      <div className="px-3.5 pb-2 pt-4">
        <div className="flex items-center gap-1.5">
          <IconSessions size={13} className="text-biolum/60" />
          <span className="text-[10px] font-medium tracking-[0.16em] text-ink/70">会话</span>
          <span className="tabular ml-1 text-[9.5px] text-mist/48">{AGENTS.length + 1}</span>
          {/* 点 + 直接进接入向导。
              原来这里只弹一条「角色接入向导 · 第二阶段」的通知 ——
              用户点了一下、什么也没发生、还得自己去找入口。等于白点。
              现在直接调 onAddPersona，和下面那个大按钮同一个去处。 */}
          <button
            onClick={() => {
              if (onAddPersona) return onAddPersona();
              notify({
                title: "接入新的角色",
                desc: "AstrBot / DSH / Gemini / Claude",
                accent: "#8b6bff",
                icon: "log",
              });
            }}
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-mist/45 transition-colors hover:bg-white/[0.06] hover:text-ink/80"
            aria-label="接入新的角色"
            title="接入新的角色"
          >
            <IconPlus size={14} />
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-black/25 px-2 py-[5px] transition-colors focus-within:border-biolum/30 focus-within:bg-black/35">
          <IconSearch size={12} className="shrink-0 text-mist/58" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索会话或角色"
            className="w-full min-w-0 bg-transparent text-[11px] text-ink/85 placeholder:text-mist/52 focus:outline-none"
          />
          <kbd className="shrink-0 rounded-[3px] border border-white/10 px-[3px] font-mono text-[9.5px] text-mist/50">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* ── 会话列表 ── */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-1">
        <BlockBoundary kind="tomb" name="置顶" data={{ groupName: groups[0]?.name }}>
        <div className="mb-1 flex items-center gap-1.5 px-2 pt-1">
          <IconPin size={10} className="text-mist/58" />
          <span className="label text-[9.5px]">pinned</span>
          <button
            onClick={() => toggleGroup("pinned")}
            title={collapsed.pinned ? "展开群聊" : "收起群聊"}
            className="ml-auto text-mist/46 transition-colors hover:text-mist/60"
          >
            <IconChevron
              size={9}
              className={`transition-transform duration-200 ${collapsed.pinned ? "" : "rotate-90"}`}
            />
          </button>
        </div>

        {!collapsed.pinned &&
          groups.map((g) => {
          const members = (g.members ?? [])
            .map((id) => AGENT_MAP[id])
            .filter(Boolean)
            .slice(0, 3);
          return (
            <div key={g.id} className="group/row relative">
            <ConvRow
              active={active === g.id}
              onClick={() => onSelect(g.id)}
              color="#a9e8ff"
              meta=""
            >
              {/* 成员色点堆叠：最多三个，用真实角色色而不是写死的三色 */}
              <div className="relative grid h-[34px] w-[34px] shrink-0 place-items-center">
                {members.map((m, i) => (
                  <div
                    key={m.id}
                    className="absolute rounded-full border border-trench"
                    style={{
                      width: 22 - i * 3,
                      height: 22 - i * 3,
                      left: i === 0 ? 0 : i === 1 ? undefined : 7,
                      right: i === 1 ? 0 : undefined,
                      top: i === 0 ? 3 : i === 1 ? 10 : undefined,
                      bottom: i === 2 ? 0 : undefined,
                      background: `${m.color}22`,
                      boxShadow: `inset 0 0 0 1px ${m.color}66`,
                    }}
                  />
                ))}
                {members.length === 0 && (
                  <div className="h-[22px] w-[22px] rounded-full border border-dashed border-white/15" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`truncate text-[12.5px] ${
                      active === g.id ? "font-medium text-white" : "text-ink/88"
                    }`}
                  >
                    {g.name}
                  </span>
                  {active === g.id && (
                    <span className="rounded-[3px] bg-white/10 px-[4px] py-[0.5px] font-mono text-[9.5px] text-mist/70">
                      群
                    </span>
                  )}
                </div>
                <div className="truncate text-[10.5px] text-mist/55">
                  {(g.members ?? []).length > 0
                    ? `${(g.members ?? []).length} 位成员 · ${members.map((m) => m.name).join("、")}`
                    : "还没有成员"}
                </div>
              </div>
            </ConvRow>

            {/* 默认群不给删：删光了用户就没有任何会话入口了 */}
            {onDeleteGroup && g.id !== "group" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteGroup(g.id);
                }}
                title={`删除 ${g.name}`}
                aria-label={`删除 ${g.name}`}
                className="absolute right-1.5 top-1/2 z-10 grid h-[19px] w-[19px] -translate-y-1/2 place-items-center rounded-[5px] bg-[rgba(6,16,25,0.9)] text-mist/55 opacity-0 transition-all duration-150 hover:bg-coral/20 hover:text-coral group-hover/row:opacity-100"
              >
                <IconTrash size={10} />
              </button>
            )}
            </div>
          );
        })}

        <button
          onClick={() => onCreateGroup?.()}
          className="mt-1 flex min-h-[32px] w-full items-center gap-2 rounded-[9px] px-2.5 py-[7px] text-mist/52 transition-colors hover:text-biolum/70"
        >
          <IconPlus size={11} />
          <span className="text-[10.5px]">新建群聊</span>
        </button>
        </BlockBoundary>

        {/* 自定义分组：用户自己贴的标签，排在自动分类前面 */}
        {customGroups.map((cg) => {
          const key = `g:${cg.name}`;
          const isCollapsed = !!collapsed[key];
          return (
            <div key={key}>
              <GroupHeader
                label={cg.name}
                count={cg.list.length}
                collapsed={isCollapsed}
                onToggle={() => toggleGroup(key)}
                hint="你自己分的组"
              />
              {!isCollapsed && (
                <div className="space-y-[2px]">
                  {cg.list.map((a) => (
                    <AgentRow
                      key={a.id}
                      a={a}
                      active={active}
                      onSelect={onSelect}
                      onDelete={onDeletePersona ? () => onDeletePersona(a.id) : undefined}
                      onEdit={onEditPersona ? () => onEditPersona(a.id) : undefined}
                      onForceRename={
                        onForceRenamePersona
                          ? (n: string) => onForceRenamePersona(String(a.id), n)
                          : undefined
                      }
                      peerNames={AGENTS.filter((x) => String(x.id) !== String(a.id)).map((x) => x.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/*
          ── 置顶 ──

          右键角色 → 置顶，它就到这儿来。

          **从下面几个分组里排掉了**（autoPool / customGroups 都滤了 pinned），
          所以不会同一个角色出两次。

          置顶是"我常找它"，不是"它更重要"——
          所以外观上不加星标、不变颜色，只是位置靠前。
        */}
        {pinnedList.length > 0 && (
          <>
            <GroupHeader
              label="置顶"
              count={pinnedList.length}
              collapsed={!!collapsed.pinnedAgents}
              onToggle={() => toggleGroup("pinnedAgents")}
              hint="右键可以取消"
            />
            {!collapsed.pinnedAgents && (
              <div className="space-y-[2px]">
                {pinnedList.map((a) => (
                  <AgentRow
                    key={`pin-${a.id}`}
                    a={a}
                    active={active}
                    onSelect={onSelect}
                    onDelete={onDeletePersona ? () => onDeletePersona(a.id) : undefined}
                    onEdit={onEditPersona ? () => onEditPersona(a.id) : undefined}
                    onForceRename={
                      onForceRenamePersona
                        ? (n: string) => onForceRenamePersona(String(a.id), n)
                        : undefined
                    }
                    peerNames={AGENTS.filter((x) => String(x.id) !== String(a.id)).map(
                      (x) => x.name
                    )}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <BlockBoundary kind="lost" name="已接入" data={{ names: connected.map((a) => a.name) }}>
        <GroupHeader
          label={searching ? "角色" : "已接入"}
          count={connected.length}
          collapsed={!!collapsed.connected}
          onToggle={() => toggleGroup("connected")}
          hint="模型在你配的凭据里能找到"
        />

        {!collapsed.connected && (
          <div className="space-y-[2px]">
            {connected.map((a) => (
              <AgentRow
                key={a.id}
                a={a}
                active={active}
                onSelect={onSelect}
                onDelete={onDeletePersona ? () => onDeletePersona(a.id) : undefined}
                onEdit={onEditPersona ? () => onEditPersona(a.id) : undefined}
                onForceRename={
                  onForceRenamePersona
                    ? (n: string) => onForceRenamePersona(String(a.id), n)
                    : undefined
                }
                peerNames={AGENTS.filter((x) => String(x.id) !== String(a.id)).map((x) => x.name)}
              />
            ))}
            {connected.length === 0 && (
              <div className="px-2 py-2 text-[10.5px] leading-[1.6] text-mist/48">
                {searching ? "没有匹配" : "还没有角色能说话 —— 去「API 接入」配一套凭据"}
              </div>
            )}
          </div>
        )}

        {disconnected.length > 0 && (
          <>
            <GroupHeader
              label="未接入"
              count={disconnected.length}
              collapsed={!!collapsed.disconnected}
              onToggle={() => toggleGroup("disconnected")}
              hint="这些角色绑的模型，你配的凭据里没有"
            />
            {!collapsed.disconnected && (
              <div className="space-y-[2px]">
                {disconnected.map((a) => (
                  <AgentRow
                    key={a.id}
                    a={a}
                    active={active}
                    onSelect={onSelect}
                    onDelete={onDeletePersona ? () => onDeletePersona(a.id) : undefined}
                    onEdit={onEditPersona ? () => onEditPersona(a.id) : undefined}
                    onForceRename={
                      onForceRenamePersona
                        ? (n: string) => onForceRenamePersona(String(a.id), n)
                        : undefined
                    }
                    peerNames={AGENTS.filter((x) => String(x.id) !== String(a.id)).map((x) => x.name)}
                  />
                ))}
              </div>
            )}
          </>
        )}
        </BlockBoundary>

        {/*
          ── 归档开关 ──

          只有存在归档角色时才出现。

          **归档的角色默认不显示** —— 归档的意义就是"别让我看见"。
          但这个入口必须留着，否则用户会以为自己删掉了什么。

          点开之后，归档的角色回到它们原来的分组里，
          **顺序、颜色、状态全都不变** —— 只是又能看见了。
        */}
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="mt-2 flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
            title={showArchived ? "收起已归档的角色" : "显示已归档的角色"}
          >
            <span className="font-mono text-[9.5px] text-mist/40">
              {showArchived ? "▾" : "▸"}
            </span>
            <span className="text-[10px] text-mist/48">
              {showArchived ? "收起归档" : "已归档"}
            </span>
            <span className="ml-auto font-mono text-[9.5px] text-mist/34">
              {archivedCount}
            </span>
          </button>
        )}

        {msgHits.length > 0 && (
          <>
            <div className="mb-1 mt-3 flex items-center gap-1.5 px-2">
              <span className="label text-[9.5px]">消息</span>
              <span className="ml-auto font-mono text-[9.5px] text-mist/48">
                {msgHits.length}
              </span>
            </div>
            <div className="space-y-[2px]">
              {msgHits.map((m) => {
                const agent =
                  m.author === "me"
                    ? null
                    : AGENT_MAP[m.author as keyof typeof AGENT_MAP];
                const c = m.author === "me" ? "#6fd8ff" : agent?.color ?? "#8fa9bd";
                const who = m.author === "me" ? "主人" : agent?.name ?? "?";
                const where =
                  m.conv === "group"
                    ? (groups[0]?.name ?? "群聊")
                    : AGENT_MAP[m.conv as keyof typeof AGENT_MAP]?.name ?? "";
                return (
                  <button
                    key={`${m.conv}-${m.id}`}
                    onClick={() => onJump?.(m.conv, m.id)}
                    className="flex w-full items-start gap-1.5 rounded-[7px] px-2 py-[5px] text-left transition-colors hover:bg-white/[0.045]"
                  >
                    <span
                      className="mt-[4px] h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ background: c }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1">
                        <span className="text-[10px]" style={{ color: c }}>
                          {who}
                        </span>
                        <span className="font-mono text-[9.5px] text-mist/48">{where}</span>
                        <span className="ml-auto tabular text-[9.5px] text-mist/44">
                          {m.time}
                        </span>
                      </span>
                      <span className="mt-[1px] block truncate text-[10px] text-mist/50">
                        {m.text}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {noHit && (
          <div className="px-2 py-7 text-center">
            <div className="mx-auto mb-2.5 grid h-9 w-9 place-items-center rounded-full border border-white/[0.07] bg-white/[0.02] text-mist/46">
              <IconSearch size={14} />
            </div>
            <div className="text-[10.5px] text-mist/45">没有匹配结果</div>
            <div className="mt-1 font-mono text-[10px] text-mist/44">
              角色和消息里都没有「{q}」
            </div>
            <button
              onClick={() => setQ("")}
              className="mt-2.5 rounded-[5px] border border-white/[0.09] px-2 py-[3px] text-[10px] text-ink/60 transition-colors hover:border-biolum/30 hover:text-biolum"
            >
              清除搜索
            </button>
          </div>
        )}

        <button className="mt-3 flex w-full items-center gap-2 rounded-[10px] border border-dashed border-white/[0.07] px-2.5 py-[7px] text-mist/55 transition-colors hover:border-biolum/25 hover:text-biolum/70"
          onClick={() => {
            if (onAddPersona) return onAddPersona();
            notify({
              title: "接入新的角色",
              desc: "AstrBot / DSH / Gemini / Claude",
              accent: "#8b6bff",
              icon: "log",
            });
          }}
        >
          <IconPlus size={13} />
          <span className="text-[11px]">接入新的角色</span>
        </button>
      </div>

      {/* ══ 左下角系统区 ══ */}
      <div className="shrink-0 border-t border-white/[0.06] px-3 pb-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="grid h-[30px] w-[30px] place-items-center rounded-full border border-white/12 bg-gradient-to-br from-white/14 to-white/[0.03]">
              <span className="text-[11px] font-semibold text-ink/90">主</span>
            </div>
            <span className="absolute -bottom-[1px] -right-[1px] h-[7px] w-[7px] rounded-full border-[1.5px] border-trench bg-biolum shadow-[0_0_6px_rgba(53,240,206,0.75)]" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[11.5px] text-ink/92">{OWNER.name}</div>
            <div className="mt-[1px] flex items-center gap-1">
              <span className="truncate font-mono text-[9.5px] text-mist/48">{OWNER.handle}</span>
            </div>
          </div>
          <button
            onClick={onOpenSettings}
            className="group/gear grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.09] bg-white/[0.03] text-mist/55 transition-all duration-150 hover:border-biolum/40 hover:bg-biolum/[0.09] hover:text-biolum active:scale-90"
            aria-label="设置"
            title="设置 · 解析引擎"
          >
            <IconSliders size={14} />
          </button>
        </div>

        <div className="mt-2.5 space-y-2">
          {/*
            ── 今日用量 ──

            分母 = 近 30 天最忙的一天。**不是编出来的上限。**

            没有分母的进度条只是装饰；用真实峰值做分母，
            这根条才有「今天用了多少」的意思。
          */}
          <Meter
            label="today"
            value={`${today.calls} 次 · ${today.estimated ? "≈" : ""}${fmtTokens(todayTokens)} tok`}
            pct={peak > 0 ? (todayTokens / peak) * 100 : 0}
            hint={
              today.calls === 0
                ? "今天还没跟谁说过话"
                : today.estimated
                  ? "含估算 · 中转站没返回用量"
                  : "供应商回报的真实用量"
            }
            color="#35f0ce"
          />
        </div>

        {/* 解析引擎：常驻显示 + 点击进设置 —— 降级不能被藏起来 */}
        <button
          onClick={onOpenEngine}
          className="mt-2 flex w-full items-center justify-between gap-1 rounded-[6px] border border-white/[0.07] bg-white/[0.02] px-1.5 py-[3px] text-[9.5px] transition-colors duration-150 hover:border-biolum/30 hover:bg-biolum/[0.05]"
        >
          <span className="flex items-center gap-1 font-mono text-mist/58">
            <IconSpark size={8} className="opacity-70" />
            解析引擎
          </span>
          <span className="flex items-center gap-1 font-mono text-biolum/75">
            {engineLabel}
            <IconChevron size={8} className="-mr-[2px] opacity-50" />
          </span>
        </button>

        <div className="mt-1.5 flex items-center justify-between border-t border-white/[0.045] pt-1.5">
          <span className="font-mono text-[9.5px] tracking-wider text-mist/46">
            v0.1.0 · local
          </span>
          <span className="flex items-center gap-1 font-mono text-[9.5px] text-mist/46">
            <span className="h-[3px] w-[3px] rounded-full bg-biolum/70 pulse-dot" />
            local only
          </span>
        </div>
      </div>
    </div>
  );
}