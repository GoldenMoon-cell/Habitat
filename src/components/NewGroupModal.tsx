import { useState } from "react";
import { useEscClose } from "../lib/escStack";
import { motion } from "motion/react";
import type { Persona, PersonaId } from "../data/personas";
import { IconChevron, IconTail } from "./Icons";

/**
 * 新建群聊：从已有角色里挑人。
 *
 * 不做「群成员管理」，只做「拉起来」。加人减人以后再说——
 * 现在能把两个自建角色拉进一个群，比做十个管理面板有用。
 */
export default function NewGroupModal({
  personas,
  onCreate,
  onCancel,
}: {
  personas: Persona[];
  onCreate: (name: string, members: PersonaId[]) => void;
  onCancel: () => void;
}) {
  useEscClose(true, onCancel);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };

  const ready = picked.size >= 1;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-abyss/90 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="glass flex max-h-[82vh] w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-[15px]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
          <IconTail size={14} className="text-biolum" />
          <span className="text-[12.5px] text-ink">新建群聊</span>
          <button
            onClick={onCancel}
            className="ml-auto -mr-1 grid h-6 w-6 place-items-center rounded-[5px] text-mist/55 transition-colors hover:bg-white/[0.07] hover:text-ink/75"
            aria-label="关闭"
            title="关闭（Esc）"
          >
            ✕
          </button>
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-[10px] text-mist/45">群名</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="比如：深夜值班室"
              maxLength={16}
              className="mt-1 w-full rounded-[8px] border border-white/[0.08] bg-black/30 px-2.5 py-[7px] text-[12px] text-ink outline-none transition-colors placeholder:text-mist/46 focus:border-biolum/40"
            />
          </label>

          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] text-mist/45">选成员</span>
              <span className="font-mono text-[10px] text-mist/50">
                已选 {picked.size}
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {personas.map((p) => {
                const on = picked.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className="flex w-full items-center gap-2.5 rounded-[8px] border px-2.5 py-[6px] text-left transition-all duration-150"
                    style={{
                      borderColor: on ? `${p.color}55` : "rgba(255,255,255,0.06)",
                      background: on ? `${p.color}0d` : "transparent",
                    }}
                  >
                    <span
                      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[10px]"
                      style={{ background: `${p.color}1f`, color: p.color }}
                    >
                      {p.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px]" style={{ color: on ? p.color : "#dbe9f4" }}>
                        {p.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-mist/50">
                        {p.model}
                      </span>
                    </span>
                    {on && (
                      <svg viewBox="0 0 12 12" className="h-[10px] w-[10px] shrink-0">
                        <path
                          d="M2 6.2 4.6 8.8 10 3.4"
                          fill="none"
                          stroke={p.color}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-[7px] px-2.5 py-[5px] text-[11px] text-mist/45 transition-colors hover:text-ink/70"
          >
            取消
          </button>
          <button
            onClick={() => onCreate(name.trim() || "新群聊", Array.from(picked) as PersonaId[])}
            disabled={!ready}
            className="ml-auto flex items-center gap-1 rounded-[7px] px-3.5 py-[6px] text-[11px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-30"
            style={{
              background: "rgba(53,240,206,0.16)",
              color: "#35f0ce",
              boxShadow: "inset 0 0 0 1px rgba(53,240,206,0.3)",
            }}
          >
            创建
            <IconChevron size={11} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
