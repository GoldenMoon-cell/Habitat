import { useEffect, useState } from "react";
import { playShift } from "../lib/sound";
import { AnimatePresence, motion } from "motion/react";
import { useEscClose } from "../lib/escStack";
import { loadCredentials, maskKey } from "../store/credentials";
import {
  DIMENSION_NOTE,
  ENGINES,
  ENGINE_MAP,
  PROVIDERS,
  STATUS_META,
  resolveChain,
  statusOf,
  type CloudProvider,
  type EngineConfig,
  type EngineLevel,
} from "../data/engines";
import { IconCheck, IconChevron, IconSpark, IconTail, IconX } from "./Icons";

const ACCENT = "#35f0ce";

/* ── 状态灯 ───────────────────────────────────────────────── */

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative flex h-[6px] w-[6px] shrink-0">
      {pulse && (
        <motion.span
          animate={{ scale: [1, 2.2], opacity: [0.45, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
          className="absolute inset-0 rounded-full"
          style={{ background: color }}
        />
      )}
      <span
        className="relative h-full w-full rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
    </span>
  );
}

/* ── 小号 pill 选择 ──────────────────────────────────────── */

function Pills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => {
          /* 继电器声：咔一下就完了 */
          if (o.id !== value) playShift();
          onChange(o.id);
        }}
          className="rounded-[5px] border px-2 py-[3px] text-[10.5px] transition-all duration-150"
          style={{
            borderColor: value === o.id ? `${ACCENT}55` : "rgba(255,255,255,0.08)",
            background: value === o.id ? `${ACCENT}18` : "rgba(255,255,255,0.03)",
            color: value === o.id ? ACCENT : "rgba(230,242,251,0.6)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── 面板 ─────────────────────────────────────────────────── */

export default function EnginePanel({
  open,
  onClose,
  config,
  onChange,
  onOpenApi,
}: {
  open: boolean;
  onClose: () => void;
  config: EngineConfig;
  /** 用函数式更新 —— mock 下载进度每秒改 8 次，闭包里的旧 config 会把它写回原点 */
  onChange: (updater: EngineConfig | ((prev: EngineConfig) => EngineConfig)) => void;
  /** L2 没配凭据时，把用户送去「API 接入」 */
  onOpenApi?: () => void;
}) {
  const [selected, setSelected] = useState<EngineLevel>(config.active);
  /** 模型下拉是否展开（原生 select 的下拉列表是系统浅色样式，在深色面板里非常突兀） */
  const [modelOpen, setModelOpen] = useState(false);
  useEscClose(open, onClose);

  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("[data-model-select]")) setModelOpen(false);
    };
    const id = window.setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [modelOpen]);
  const [keyDraft, setKeyDraft] = useState("");
  const [testing, setTesting] = useState(false);

  /* Esc 关闭 —— 模态面板必须能用键盘退出来 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** 「API 接入」里真有 apiKey 的凭据 —— L2 用的就是这一份，不再单独维护 */
  const cloudCreds = loadCredentials().filter((c) => !!c.apiKey);

  /** 实际会生效的那一级（可能因为未配置而降级） */
  const eff = resolveChain(config);

  const patch = (p: Partial<EngineConfig> | ((prev: EngineConfig) => Partial<EngineConfig>)) =>
    onChange((prev) => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) }));

  const select = (level: EngineLevel) => {
    setSelected(level);
    patch({ active: level });
  };

  /* mock：保存 key 只生成掩码，不碰明文 */
  const saveKey = () => {
    const v = keyDraft.trim();
    if (!v) return;
    const tail = v.slice(-4).padStart(4, "•");
    patch((prev) => ({
      level2: { ...prev.level2, keySet: true, keyMask: `sk-••••${tail}` },
    }));
    setKeyDraft("");
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0"
            style={{ background: "rgba(2,6,11,0.72)", backdropFilter: "blur(10px)" }}
          />

          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            className="glass relative flex max-h-[86vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[16px]"
          >
            {/* 头部 */}
            <div className="shrink-0 border-b border-white/[0.06] px-5 pb-3.5 pt-4">
              <div className="flex items-start gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-[9px] border border-biolum/25 bg-biolum/[0.08] text-biolum">
                  <IconSpark size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-semibold text-white">解析引擎</h2>
                  <p className="mt-[1px] text-[10.5px] text-mist/45">
                    人格文件 → 六维 Δ 的提取方式。两级降级，按你的偏好选。
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="grid h-7 w-7 place-items-center rounded-md text-mist/58 transition-colors hover:bg-white/[0.07] hover:text-ink/80"
                  aria-label="关闭"
                >
                  <IconX size={14} />
                </button>
              </div>
            </div>

            {/* 内容 */}
            <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {/* 取舍说明 */}
              <div className="rounded-lg border border-amber/20 bg-amber/[0.05] px-3 py-2">
                <div className="flex items-start gap-2">
                  <span className="mt-[3px] h-[3px] w-[3px] shrink-0 rounded-full bg-amber" />
                  <p className="text-[10px] leading-[1.6] text-amber/75">{DIMENSION_NOTE}</p>
                </div>
              </div>

              {/* 降级链 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label">fallback chain</span>
                  <span className="font-mono text-[9.5px] text-mist/50">
                    {config.autoFallback ? "失败自动降级" : "失败即中止"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {[config.active, ...config.chain.filter((l) => l !== config.active)].map(
                    (lv, i, arr) => {
                      const st = statusOf(lv, config);
                      const meta = STATUS_META[st];
                      const isEffective =
                        arr.slice(0, i).every((p) => statusOf(p, config) !== "ready") &&
                        st === "ready";
                      return (
                        <div key={lv} className="flex items-center gap-1">
                          <div
                            className="flex items-center gap-1 rounded-[5px] border px-1.5 py-[3px]"
                            style={{
                              borderColor: isEffective ? `${ACCENT}66` : "rgba(255,255,255,0.07)",
                              background: isEffective ? `${ACCENT}14` : "transparent",
                            }}
                          >
                            <StatusDot color={meta.color} pulse={isEffective} />
                            <span
                              className="font-mono text-[10px]"
                              style={{ color: isEffective ? ACCENT : "rgba(143,169,189,0.5)" }}
                            >
                              L{lv}
                            </span>
                          </div>
                          {i < arr.length - 1 && (
                            <IconChevron size={8} className="text-mist/42" />
                          )}
                        </div>
                      );
                    }
                  )}
                </div>
              </div>

              {/* 引擎卡 */}
              <div className="space-y-2">
                {ENGINES.map((e, idx) => {
                  const st = statusOf(e.level, config);
                  const meta = STATUS_META[st];
                  const isSel = selected === e.level;
                  return (
                    <motion.div
                      key={e.level}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.32,
                        delay: 0.04 * idx,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="overflow-hidden rounded-[10px] border transition-colors duration-200"
                      style={{
                        borderColor: isSel ? `${ACCENT}3d` : "rgba(255,255,255,0.06)",
                        background: isSel ? `${ACCENT}08` : "rgba(255,255,255,0.015)",
                      }}
                    >
                      <button
                        onClick={() => select(e.level)}
                        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                      >
                        <span
                          className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] font-mono text-[10px]"
                          style={{
                            background: isSel ? `${ACCENT}22` : "rgba(255,255,255,0.05)",
                            color: isSel ? ACCENT : "rgba(143,169,189,0.55)",
                          }}
                        >
                          {e.level}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="text-[11.5px]"
                              style={{ color: isSel ? "#fff" : "rgba(230,242,251,0.85)" }}
                            >
                              {e.name}
                            </span>
                            <span className="rounded-[3px] border border-white/10 px-1 py-[0.5px] font-mono text-[9.5px] text-mist/45">
                              {e.tag}
                            </span>
                          </div>
                          <p className="mt-[2px] text-[10px] leading-[1.5] text-mist/45">
                            {e.desc}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[9.5px] text-mist/50">
                            <span>精度 {e.scores.precision}</span>
                            <span>·</span>
                            <span>隐私 {e.scores.privacy}</span>
                            <span>·</span>
                            <span>{e.scores.latency}</span>
                            <span>·</span>
                            <span>{e.scores.footprint}</span>
                          </div>
                        </div>

                        <span className="mt-[2px] flex shrink-0 items-center gap-1">
                          <StatusDot color={meta.color} />
                          <span className="text-[10px]" style={{ color: meta.color }}>
                            {meta.label}
                          </span>
                        </span>
                      </button>

                      {/* 选中后展开的配置 */}
                      <AnimatePresence initial={false}>
                        {isSel && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-white/[0.055] px-3 py-2.5">
                              {/* 代价 */}
                              <div className="mb-2 flex items-start gap-1.5">
                                <span className="mt-[3px] h-[3px] w-[3px] shrink-0 rounded-full bg-coral/70" />
                                <p className="text-[10px] leading-[1.55] text-coral/65">
                                  {e.caveat}
                                </p>
                              </div>

                              {/* ── L1 ── */}
                              {e.level === 1 && (
                                <div className="rounded-[6px] border border-white/[0.06] bg-black/20 px-2.5 py-2">
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono text-[10px] text-mist/45">
                                      15 条 Gold Set 规则 · 已加载
                                    </span>
                                    <span className="flex items-center gap-1 text-[10px] text-biolum/70">
                                      <IconCheck size={9} />
                                      就绪
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[10px] leading-[1.5] text-mist/48">
                                    如需更高精度，请接入 L2。
                                  </p>
                                </div>
                              )}

                              {/* ── L2 ── */}
                              {e.level === 2 && (
                                <div className="space-y-2">
                                  {cloudCreds.length === 0 ? (
                                    /* 没配凭据 —— 指路，不让人在这儿再填一遍 */
                                    <div className="rounded-[6px] border border-amber/25 bg-amber/[0.05] px-2.5 py-2">
                                      <div className="text-[10px] leading-[1.6] text-amber/80">
                                        还没有可用的 API 凭据
                                      </div>
                                      <div className="mt-[3px] text-[9.5px] leading-[1.5] text-mist/50">
                                        L2 直接用「设置 → API 接入」里的凭据，
                                        <span className="text-mist/50">不用在这里再填一遍</span>。
                                      </div>
                                      <button
                                        onClick={() => {
                                          onClose();
                                          onOpenApi?.();
                                        }}
                                        className="mt-2 rounded-[5px] border border-biolum/30 bg-biolum/[0.08] px-2 py-[3px] font-mono text-[10px] text-biolum transition-colors hover:bg-biolum/[0.14]"
                                      >
                                        去配置 API →
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      {/* 用哪套凭据 */}
                                      <div>
                                        <div className="mb-1 font-mono text-[9.5px] text-mist/55">
                                          凭据
                                        </div>
                                        <div className="space-y-[3px]">
                                          {cloudCreds.map((c) => {
                                            const picked = config.level2.credentialId === c.id;
                                            return (
                                              <button
                                                key={c.id}
                                                onClick={() =>
                                                  patch((prev) => ({
                                                    level2: {
                                                      ...prev.level2,
                                                      credentialId: c.id,
                                                      /* 换凭据时模型跟着换，不然会指向一个这套凭据没有的模型 */
                                                      modelId: c.models?.[0]?.id,
                                                    },
                                                  }))
                                                }
                                                className="flex w-full items-center gap-1.5 rounded-[5px] border px-2 py-1.5 text-left transition-colors"
                                                style={{
                                                  borderColor: picked ? "rgba(53,240,206,0.3)" : "rgba(255,255,255,0.06)",
                                                  background: picked ? "rgba(53,240,206,0.06)" : "transparent",
                                                }}
                                              >
                                                <span
                                                  className="h-[4px] w-[4px] shrink-0 rounded-full"
                                                  style={{ background: picked ? "#35f0ce" : "rgba(143,169,189,0.35)" }}
                                                />
                                                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink/70">
                                                  {c.label}
                                                </span>
                                                <span className="shrink-0 font-mono text-[9.5px] text-mist/46">
                                                  {maskKey(c.apiKey)}
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>

                                      {/* 用哪个模型 */}
                                      <div>
                                        <div className="mb-1 font-mono text-[9.5px] text-mist/55">
                                          模型
                                        </div>
                                        {(() => {
                                          const models =
                                            cloudCreds.find((c) => c.id === config.level2.credentialId)?.models ?? [];
                                          const current = config.level2.modelId ?? models[0]?.id ?? "";
                                          return (
                                            <div className="relative" data-model-select>
                                              <button
                                                onClick={() => setModelOpen((v) => !v)}
                                                className="flex w-full items-center justify-between rounded-[5px] border px-2 py-[5px] font-mono text-[10px] transition-colors"
                                                style={{
                                                  borderColor: modelOpen
                                                    ? "rgba(53,240,206,0.35)"
                                                    : "rgba(255,255,255,0.08)",
                                                  background: "rgba(0,0,0,0.3)",
                                                  color: "rgba(230,245,255,0.85)",
                                                }}
                                              >
                                                <span className="truncate">{current || "（这套凭据还没有模型）"}</span>
                                                <IconChevron
                                                  size={9}
                                                  className={`ml-1 shrink-0 text-mist/58 transition-transform ${
                                                    modelOpen ? "rotate-180" : ""
                                                  }`}
                                                />
                                              </button>

                                              {modelOpen && models.length > 0 && (
                                                <div
                                                  className="thin-scroll absolute left-0 right-0 top-full z-20 mt-1 max-h-[180px] overflow-y-auto rounded-[6px] border border-white/[0.1] py-1"
                                                  style={{
                                                    background: "rgba(8,20,28,0.98)",
                                                    boxShadow: "0 12px 32px -8px rgba(0,0,0,0.85)",
                                                  }}
                                                >
                                                  {models.map((m) => {
                                                    const picked = m.id === current;
                                                    return (
                                                      <button
                                                        key={m.id}
                                                        onClick={() => {
                                                          patch((prev) => ({
                                                            level2: { ...prev.level2, modelId: m.id },
                                                          }));
                                                          setModelOpen(false);
                                                        }}
                                                        className="flex w-full items-center gap-1.5 px-2 py-[4px] text-left font-mono text-[10px] transition-colors hover:bg-white/[0.06]"
                                                        style={{
                                                          color: picked
                                                            ? "#35f0ce"
                                                            : "rgba(200,225,240,0.7)",
                                                        }}
                                                      >
                                                        <span
                                                          className="h-[3px] w-[3px] shrink-0 rounded-full"
                                                          style={{
                                                            background: picked ? "#35f0ce" : "transparent",
                                                          }}
                                                        />
                                                        <span className="truncate">{m.id}</span>
                                                      </button>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        <p className="mt-[3px] text-[9.5px] leading-[1.5] text-mist/46">
                                          人格文本会发到这台机器以外。prompt 里写了私事就别选这条。
                                        </p>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}

                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>

              {/* 自动降级 */}
              <div className="flex items-center justify-between rounded-[8px] border border-white/[0.06] px-3 py-2">
                <div>
                  <div className="text-[10.5px] text-ink/75">失败时自动降级</div>
                  <div className="mt-[1px] text-[10px] text-mist/55">
                    主引擎超时或报错时，按链路落到下一个可用引擎
                  </div>
                </div>
                <button
                  onClick={() => patch((prev) => ({ autoFallback: !prev.autoFallback }))}
                  role="switch"
                  aria-checked={config.autoFallback}
                  aria-label="切换自动降级"
                  className="relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-200"
                  style={{
                    background: config.autoFallback
                      ? "rgba(53,240,206,0.26)"
                      : "rgba(255,255,255,0.07)",
                    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.45)",
                  }}
                >
                  <motion.span
                    animate={{ x: config.autoFallback ? 16 : 2 }}
                    transition={{ type: "spring", stiffness: 520, damping: 32 }}
                    className="absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full"
                    style={{
                      background: config.autoFallback ? ACCENT : "#6f8598",
                      boxShadow:
                        "0 1px 3px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(0,0,0,0.15)",
                    }}
                  />
                </button>
              </div>
            </div>

            {/* 底部：显示的是"实际生效"而不是"你选了哪个" —— 降级必须可见 */}
            <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-5 py-3">
              <IconTail size={12} className="text-biolum/50" />
              <span className="text-[10.5px] text-mist/58">当前生效</span>
              <span className="font-mono text-[10px] text-biolum/85">
                L{eff.effective} · {ENGINE_MAP[eff.effective].name}
              </span>
              {eff.effective !== config.active && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="rounded-[3px] border border-amber/30 bg-amber/[0.08] px-1.5 py-[1px] font-mono text-[9.5px] text-amber/85"
                >
                  L{config.active} 待配置 · 已降级
                </motion.span>
              )}
              <span className="ml-auto font-mono text-[9.5px] text-mist/46">
                第一阶段 · 全部为 mock
              </span>
              <button
                onClick={onClose}
                className="rounded-[6px] border border-white/[0.1] px-3 py-[4px] text-[10.5px] text-ink/75 transition-colors hover:border-biolum/30 hover:text-biolum"
              >
                完成
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
