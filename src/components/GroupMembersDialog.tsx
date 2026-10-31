import { useEffect, useState } from "react";
import { useAnchorPopover, chatBoundary } from "../lib/useAnchorPopover";
import { motion } from "motion/react";
import type { Persona, PersonaId } from "../data/personas";
import type { ConvId } from "../data/mock";
import { useEscClose } from "../lib/escStack";

/**
 * 群成员管理。
 *
 * 之前群创建完就不能改人了 —— 想拉个人进来只能删群重建，
 * 而删群会把聊天记录一起丢掉。这不对。
 *
 * 至少保留一个成员：空群没有任何意义，也不该允许。
 */

export default function GroupMembersDialog({
  open,
  onClose,
  groupName,
  groupId,
  personas,
  members,
  onSave,
  onRename,
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  groupName: string;
  groupId: ConvId;
  personas: Persona[];
  members: PersonaId[];
  onSave: (id: ConvId, members: PersonaId[]) => void;
  /** 改群名。以前 store 里有 rename，但没有任何入口能调到它 */
  onRename?: (id: ConvId, name: string) => void;
  /** 触发按钮的位置 —— 气泡贴着它展开 */
  anchor?: DOMRect | null;
}) {
  const [selected, setSelected] = useState<string[]>(members.map(String));
  /** 刚才动了谁 —— 底下那行用它替代「有未保存的修改」 */
  const [lastAction, setLastAction] = useState("");
  const [nameDraft, setNameDraft] = useState(groupName);
  useEscClose(open, onClose);

  /*
   * 气泡尺寸。
   *
   * 之前是抽屉（撑满高度），但四栏布局里抽屉会把聊天区压掉一半 ——
   * 那是**持续**的挤压，而气泡只是**暂时**盖住一块。满负荷界面里后者代价更小。
   *
   * 高度按 460 算：8 个角色约 6 个可见，剩下滚动。这个交换比「一直窄着」划算。
   */
  const PANEL_W = 340;
  const PANEL_H = 460;
  const pos = useAnchorPopover(open, anchor, PANEL_W, PANEL_H, chatBoundary());

  useEffect(() => {
    if (open) {
      setSelected(members.map(String));
      setNameDraft(groupName);
    }
  }, [open, members, groupName]);

  /** 失焦或回车时落盘；空名不接受（群总得有个名字） */
  const commitName = () => {
    const v = nameDraft.trim();
    if (!v) {
      setNameDraft(groupName);
      return;
    }
    if (v !== groupName) onRename?.(groupId, v);
  };

  /*
   * 勾选**立刻生效**，不等「保存」。
   *
   * 原来这里是「改 selected → 点保存 → 一次性提交」。对八个成员来说，
   * 多一个「保存」按钮等于多一次决策：用户勾完还要判断"我是不是忘了按"。
   *
   * 而增删群成员是可逆的（再勾回来就行），没有不可逆副作用 ——
   * 满足「即时生效」的前提条件。
   *
   * 注意：如果以后这个面板加上「解散群聊」之类的操作，那种必须回到
   * 「明确确认」模式，不能一键即时生效。
   */
  const toggle = (id: string) => {
    if (selected.includes(id) && selected.length <= 1) return; /* 至少留一个人 */
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setSelected(next);
    onSave(groupId, next as PersonaId[]);
    /* 记一下刚刚动了谁，底下那行状态要用 */
    setLastAction(
      selected.includes(id)
        ? `已移出 ${personas.find((p) => String(p.id) === id)?.name ?? id}`
        : `已加入 ${personas.find((p) => String(p.id) === id)?.name ?? id}`
    );
  };

  /* changed 不再需要 —— 没有「保存」了，改了就生效 */

  /*
   * 抽屉。
   *
   * 从聊天区右侧滑出、撑满高度，聊天内容整体向左让位 —— 一点不遮挡。
   *
   * 为什么群设置用抽屉而不是 popover：
   *   内容是 8 个角色 + 群名 + 保存/取消。popover 装不下要滚动，
   *   勾选时看不到「我现在选了几个」。抽屉撑满高度，一屏全见。
   */
  return (
    <>
      {/*
       * 透明点击层。
       *
       * 它同时解决两件事：
       *   ① 点面板外面 → 关闭
       *   ② 再点一次触发按钮 → 由于这一层在最上面（z-99），
       *      点按钮位置时命中的是遮罩，于是触发 onClose —— 天然就是 toggle
       *
       * 所以面板里不需要 ✕，也不需要「关闭」按钮：想关掉有两条路，
       * 都比去找一个小叉子快。
       *
       * 注意：这只适用于**气泡**。弹窗（Modal）是阻断式的，
       * 必须留明确的确认/取消按钮 —— 因为它的背景是"被冻结"的，
       * 点外面关闭会让人以为操作被取消了。
       */}
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <motion.div
      /*
       * 动效：全息投影，不是「滑出来」。
       *
       * scale 从 0.94 起 —— 从触发点方向弹开，像投影在空气里展开。
       * clipPath 从顶边往下刷 —— 扫描线效果，比单纯的淡入更像「正在生成」。
       */
      initial={{ opacity: 0, scale: 0.94, clipPath: "inset(0 0 100% 0)" }}
      animate={{ opacity: 1, scale: 1, clipPath: "inset(0 0 0% 0)" }}
      exit={{
        opacity: 0,
        scale: 0.97,
        clipPath: "inset(0 0 100% 0)",
        transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
      }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: "fixed", top: pos.top, left: pos.left, width: PANEL_W, transformOrigin: "top right" }}
      className="glass z-[100] flex flex-col overflow-hidden rounded-[13px] border border-biolum/25 shadow-[0_20px_56px_-14px_rgba(0,0,0,.9)]"
      data-opaque="true"
    >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="text-[12px] text-biolum/70">◉</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-ink">群设置</div>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  /* 只撤销这次改名，别把整个弹窗关掉 */
                  e.stopPropagation();
                  setNameDraft(groupName);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              title="点一下就能改群名"
              maxLength={20}
              className="mt-[1px] w-full min-w-0 truncate rounded-[4px] border border-transparent bg-transparent px-1 py-[1px] text-[10px] text-mist/45 transition-colors hover:border-white/10 hover:text-mist/70 focus:border-biolum/35 focus:text-ink/85 focus:outline-none"
            />
          </div>
          <span className="ml-auto font-mono text-[10px] text-mist/50">
            {selected.length} / {personas.length}
          </span>
        </div>

        <div className="thin-scroll min-h-0 flex-1 space-y-[3px] overflow-y-auto px-3 py-2.5">
          {personas.map((p) => {
            const on = selected.includes(String(p.id));
            return (
              <button
                key={p.id}
                onClick={() => toggle(String(p.id))}
                className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-left transition-colors hover:bg-white/[0.035]"
                style={{ background: on ? `${p.color}0d` : undefined }}
              >
                <span
                  className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[10px] font-semibold${on ? " breath-ring" : ""}`}
                  style={{
                    background: `linear-gradient(150deg, ${p.color}33, rgba(4,12,20,0.92))`,
                    boxShadow: `0 0 0 1px ${p.color}4d`,
                    color: p.color,
                    ["--ring" as string]: `${p.color}55`,
                  }}
                >
                  {p.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-ink/80">{p.name}</span>
                  <span className="block truncate text-[10px] text-mist/50">
                    {p.model || p.tagline}
                  </span>
                </span>
                <span
                  className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[3px] border transition-colors"
                  style={{
                    borderColor: on ? `${p.color}66` : "rgba(255,255,255,0.1)",
                    background: on ? `${p.color}22` : "transparent",
                  }}
                >
                  {on && <span className="text-[10px]" style={{ color: p.color }}>✓</span>}
                </span>
              </button>
            );
          })}
        </div>

        {/* 底部只有一行状态 —— 没有「取消/保存」，因为勾选已经生效了 */}
        <div className="flex items-center border-t border-white/[0.06] px-4 py-2.5">
          <span
            className="flex items-center gap-1.5 font-mono text-[9.5px]"
            style={{ color: selected.length <= 1 ? "#ffc46b" : "rgba(53,240,206,.65)" }}
          >
            <span
              className="inline-block h-[4px] w-[4px] rounded-full"
              style={{
                background: selected.length <= 1 ? "#ffc46b" : "#35f0ce",
                boxShadow: `0 0 6px ${selected.length <= 1 ? "#ffc46b" : "#35f0ce"}`,
              }}
            />
            {selected.length <= 1
              ? "至少要留一个人"
              : lastAction
                ? `${lastAction} · 当前 ${selected.length} 人`
                : `即时生效 · 当前 ${selected.length} 人`}
          </span>
        </div>
      </motion.div>
    </>
  );
}