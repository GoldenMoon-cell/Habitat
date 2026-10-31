import { AnimatePresence, motion } from "motion/react";
import { ICONS, IconCheck, IconPlus, IconTail, IconX } from "./Icons";

export interface ToastItem {
  id: number;
  title: string;
  desc?: string;
  accent: string;
  icon?: string;
  /** 毫秒；用于底部进度条的时长 */
  ttl?: number;
}

const ICON_BY_KEY: Record<string, typeof IconTail> = {
  ...ICONS,
  arrow: IconCheck,
};

export default function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-5 top-12 z-50 flex w-[252px] flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON_BY_KEY[t.icon ?? ""] ?? IconTail;
          const ttl = t.ttl ?? 2800;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 26, scale: 0.94, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
              exit={{
                opacity: 0,
                x: 20,
                scale: 0.95,
                filter: "blur(3px)",
                transition: { duration: 0.18 },
              }}
              transition={{ type: "spring", stiffness: 480, damping: 34 }}
              className="pointer-events-auto w-full overflow-hidden rounded-[11px] border bg-[rgba(7,18,27,0.88)] backdrop-blur-xl"
              style={{
                borderColor: `${t.accent}38`,
                boxShadow: `inset 0 1px 0 rgba(200,245,255,0.07), 0 14px 34px -20px ${t.accent}, 0 10px 24px -18px rgba(0,0,0,0.9)`,
              }}
            >
              <div className="flex items-start gap-2 p-2.5">
                <span
                  className="mt-[1px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px]"
                  style={{ background: `${t.accent}18`, color: t.accent }}
                >
                  <Icon size={12} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] leading-[1.4] text-ink/92">{t.title}</div>
                  {t.desc && (
                    <div className="mt-[2px] truncate font-mono text-[9.5px] leading-[1.4] text-mist/56">
                      {t.desc}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onDismiss(t.id)}
                  className="-mr-1 -mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-[4px] text-mist/46 transition-colors hover:bg-white/[0.07] hover:text-ink/70"
                  aria-label="关闭"
                >
                  <IconX size={10} />
                </button>
              </div>

              {/* 自动消失倒计时 */}
              <motion.div
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: ttl / 1000, ease: "linear" }}
                className="h-[1.5px] w-full origin-left"
                style={{
                  background: `linear-gradient(90deg, ${t.accent}, ${t.accent}22)`,
                }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
