import { motion } from "motion/react";
import type { BundlePreview, ImportMode } from "../lib/persist";
import { useEscClose } from "../lib/escStack";

/**
 * 导入数据前的预览对话框。
 *
 * 之前是「选文件 → 直接写 → 重载」，中间没有人问一句。
 * 导入一个三天前的备份，你现在改过的角色就被换掉了，而且看不到发生了什么。
 *
 * 所以这里只做一件事：**把文件里有什么、本地有什么，一起摆出来**。
 * 用户看清楚再决定要不要覆盖。
 */
export default function DataImportDialog({
  fileName,
  preview,
  onCancel,
  onImport,
}: {
  fileName: string;
  preview: BundlePreview;
  onCancel: () => void;
  onImport: (mode: ImportMode) => void;
}) {
  /* 挂在 Esc 栈顶：它比设置面板晚注册，所以 Esc 先关它，
     不会出现「设置关了、这个框还在」 */
  useEscClose(true, onCancel);

  const withContent = preview.entries.filter((e) => e.inFile);
  const emptyOnes = preview.entries.filter((e) => !e.inFile);

  /* 本地一项都不缺 —— 「只补缺失」会写入 0 项，直接不给这个按钮 */
  const canFill = preview.fresh > 0;
  /* 本地一项都没有 —— 「覆盖」和「补齐」结果完全一样，合并成一个 */
  const identical = preview.conflicts === 0;

  const when = (() => {
    const d = new Date(preview.exportedAt);
    if (Number.isNaN(d.getTime())) return preview.exportedAt;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  })();

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-abyss/88 backdrop-blur-md"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-[470px] max-w-[92vw] overflow-hidden rounded-[14px]"
        role="dialog"
        aria-modal="true"
      >
        {/* ── 头部 ── */}
        <div className="px-5 pb-3 pt-4">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full bg-biolum"
              style={{ boxShadow: "0 0 10px -1px #35f0ce" }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] leading-[1.5] text-ink">导入数据</div>
              <p className="mt-1 truncate font-mono text-[10px] text-mist/55">{fileName}</p>
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-2 font-mono text-[10px] text-mist/58">
            <span>来自 {when}</span>
            <span className="text-mist/42">·</span>
            <span>
              {withContent.length} 项有内容 · {preview.totalKB} KB
            </span>
          </div>
        </div>

        {/* ── 逐项对照 ── */}
        <div className="max-h-[240px] overflow-y-auto border-t border-white/[0.06] px-5 py-2">
          {withContent.map((e) => (
            <div key={e.key} className="flex items-center gap-2 py-[5px]">
              <span
                className="h-[4px] w-[4px] shrink-0 rounded-full"
                style={{ background: e.inLocal ? "#ffb86b" : "#35f0ce" }}
              />
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink/80">{e.label}</span>
              <span className="shrink-0 font-mono text-[9.5px] text-mist/50">
                {(e.bytes / 1024).toFixed(1)} KB
              </span>
              <span
                className="w-[62px] shrink-0 text-right font-mono text-[9.5px]"
                style={{ color: e.inLocal ? "#ffb86b" : "#35f0ce" }}
              >
                {e.inLocal ? "本地已有" : "本地没有"}
              </span>
            </div>
          ))}

          {emptyOnes.length > 0 && (
            <div className="mt-1.5 border-t border-white/[0.04] pt-1.5">
              <div className="font-mono text-[9.5px] text-mist/46">
                文件里是空的，不会被导入：
              </div>
              <div className="mt-[3px] font-mono text-[9.5px] leading-[1.7] text-mist/46">
                {emptyOnes.map((e) => e.label).join(" · ")}
              </div>
            </div>
          )}
        </div>

        {/* ── 后果说明 ── */}
        <div className="border-t border-white/[0.06] px-5 py-2.5">
          {identical ? (
            <p className="text-[10.5px] leading-[1.7] text-biolum/60">
              本地这些项都是空的，导入会直接补上，不会覆盖任何东西。
            </p>
          ) : (
            <p className="text-[10.5px] leading-[1.7] text-amber/70">
              有 <span className="font-mono">{preview.conflicts}</span> 项本地已有内容。
              <span className="text-mist/58">
                「覆盖」会替换掉它们；「只补缺失」只写本地空着的{" "}
                <span className="font-mono">{preview.fresh}</span> 项。
              </span>
            </p>
          )}
        </div>

        {/* ── 按钮 ── */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-[7px] px-3 py-[5px] text-[11px] text-mist/45 transition-colors hover:text-ink/70"
          >
            取消
          </button>

          {!identical && canFill && (
            <button
              onClick={() => onImport("fill")}
              className="ml-auto rounded-[7px] px-3.5 py-[6px] text-[11px] transition-all duration-150"
              style={{
                background: "#35f0ce1f",
                color: "#35f0ce",
                boxShadow: "inset 0 0 0 1px #35f0ce44",
              }}
            >
              只补缺失
            </button>
          )}

          <button
            autoFocus
            onClick={() => onImport(identical ? "fill" : "overwrite")}
            className={`rounded-[7px] px-3.5 py-[6px] text-[11px] transition-all duration-150 ${
              identical || canFill ? "" : "ml-auto"
            }`}
            style={
              identical
                ? {
                    background: "#35f0ce1f",
                    color: "#35f0ce",
                    boxShadow: "inset 0 0 0 1px #35f0ce44",
                  }
                : {
                    background: "#ff7a6b1f",
                    color: "#ff7a6b",
                    boxShadow: "inset 0 0 0 1px #ff7a6b44",
                  }
            }
          >
            {identical ? "导入" : "覆盖本地"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
