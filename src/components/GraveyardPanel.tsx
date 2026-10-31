import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { loadGraves, type Grave } from "../lib/graveyard";
import { useEscClose } from "../lib/escStack";
import { loadThreads } from "../data/threads";

/**
 * 墓碑 —— 电子册。
 *
 * ── 怎么进来 ──
 *
 * 控制台 → `graves`（**造物主模式限定**，`help` 里不列，补全表里也没有）
 *
 * ── 为什么是「册」不是「列表」 ──
 *
 * 一开始我做成了平铺列表。那是错的：
 *
 *   删过 20 个角色 × 每个 3 代 = 60 块石头
 *   60 块全平铺 → 滚动条长到爆，信息密度趋近于零
 *
 * 而「电子墓碑」这个词本身就带着「翻」的意思。
 *
 * ── 三栏 ──
 *
 * **左：索引** —— 所有名字 + 代数，一眼看全，可点
 * **中：当前页** —— 一块石头的完整信息（比平铺时能放的更多）
 * **下：翻页** —— `◀ 3 / 12 ▶`
 *
 * ── 翻页动效 ──
 *
 * **不是 3D 折页。** `rotateY 90°` 在 `backdrop-blur` 的模态里会露馅
 * （背面漏光、阴影错位）。
 *
 * 用的是 **12° 侧翻 + 位移**：看得出是「翻」，但翻不到能被看见背面。
 * 这是克制的 3D。
 */
/**
 * 翻页的三态。
 *
 * 用 variants 而不是给 initial/exit 传函数 —— Motion 12 里只有
 * variants 支持 custom 参数。直接传函数会 TS 报错。
 *
 * 12° 是刻意的：看得出是「翻」，但翻不到能被看见背面。
 * 90° 那种折页在这个已经有 backdrop-blur 的模态里会露馅。
 */
const PAGE = {
  enter: (d: number) => ({
    opacity: 0,
    rotateY: d > 0 ? 12 : -12,
    x: d > 0 ? 26 : -26,
  }),
  center: { opacity: 1, rotateY: 0, x: 0 },
  exit: (d: number) => ({
    opacity: 0,
    rotateY: d > 0 ? -10 : 10,
    x: d > 0 ? -26 : 26,
  }),
};

export default function GraveyardPanel({ onClose }: { onClose: () => void }) {
  useEscClose(true, onClose);

  const graves = useMemo(() => loadGraves(), []);

  /*
   * ── 谱系 ──
   *
   * 同一个名字的所有代归到一组，按时间正序排。
   * 一个「澜汐」删了三次，就是**一个名字的三次**，不是三个孤立的人。
   */
  const groups = useMemo(() => {
    const byName = new Map<string, Grave[]>();
    for (const g of graves) {
      const k = g.name || g.id;
      const arr = byName.get(k) ?? [];
      arr.push(g);
      byName.set(k, arr);
    }
    return [...byName.entries()]
      .map(([name, list]) => ({
        name,
        list: [...list].sort((a, b) => a.at - b.at),
      }))
      /* 最近有动静的族排前面 */
      .sort((a, b) => b.list[b.list.length - 1].at - a.list[a.list.length - 1].at);
  }, [graves]);

  /* 平铺的所有石头 —— 翻页就是在它上面走 */
  const pages = useMemo(
    () =>
      groups.flatMap((grp) =>
        grp.list.map((g, i) => ({
          grave: g,
          name: grp.name,
          nth: i + 1,
          total: grp.list.length,
          /* 同一名字的其它代 —— 给当前页做对比 */
          siblings: grp.list
            .map((x, j) => ({ grave: x, nth: j + 1 }))
            .filter((_, j) => j !== i),
        }))
      ),
    [groups]
  );

  const [idx, setIdx] = useState(0);
  /** 翻页方向 —— 决定入场/退场从哪边来 */
  const [dir, setDir] = useState(1);

  const go = useCallback(
    (next: number) => {
      if (!pages.length) return;
      const clamped = Math.max(0, Math.min(pages.length - 1, next));
      if (clamped === idx) return;
      setDir(clamped > idx ? 1 : -1);
      setIdx(clamped);
    },
    [idx, pages.length]
  );

  /* ← → 翻页 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(idx - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(idx + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, idx]);

  const cur = pages[idx];

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/85 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.99, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[760px] max-w-[94vw] flex-col overflow-hidden"
        /*
         * 方角 —— 石板没有圆角。
         * 背景比外面更深更灰：这是石室，不是蓝调的界面。
         */
        style={{
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,.07)",
          background:
            "radial-gradient(900px 500px at 50% 0%, rgba(255,255,255,.014), transparent 70%), linear-gradient(180deg, rgba(14,18,24,.998), rgba(6,8,11,.999))",
        }}
        data-opaque="true"
        role="dialog"
        aria-modal="true"
      >
        {/* 头 */}
        <div
          className="flex items-baseline gap-2.5 px-[18px] py-[12px]"
          style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}
        >
          <span className="font-mono text-[10px] tracking-[0.18em] text-mist/58">
            GRAVEYARD
          </span>
          <span className="text-[11px] text-mist/50">墓碑</span>
          <span className="ml-auto font-mono text-[10px] tracking-[0.06em] text-mist/48">
            {graves.length} 座 · {groups.length} 个名字
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ═══ 左：索引 ═══ */}
          {/*
            空的时候整条索引栏不渲染。
            挂一个「空」字在那里很难看 —— 什么都没刻，就不该有目录。
          */}
          {groups.length > 0 && (
          <div
            className="thin-scroll w-[152px] shrink-0 overflow-y-auto py-2"
            style={{ borderRight: "1px solid rgba(255,255,255,.05)" }}
          >
            {(
              groups.map((grp) => (
                <div key={grp.name} className="mb-1">
                  <div className="px-3 pb-1 pt-2 font-mono text-[9.5px] tracking-[0.1em] text-mist/52">
                    {grp.name}
                  </div>
                  {grp.list.map((g, i) => {
                    const globalIdx = pages.findIndex(
                      (p) => p.grave.id === g.id && p.grave.at === g.at
                    );
                    const on = globalIdx === idx;
                    return (
                      <button
                        key={g.id + g.at}
                        onClick={() => go(globalIdx)}
                        className="flex w-full items-center gap-1.5 px-3 py-[4px] text-left transition-colors"
                        style={{
                          background: on ? "rgba(255,122,107,.07)" : "transparent",
                          borderLeft: on
                            ? "2px solid rgba(255,122,107,.55)"
                            : "2px solid transparent",
                        }}
                      >
                        <span
                          className="font-mono text-[10px] tracking-[0.06em]"
                          style={{
                            color: on
                              ? "rgba(255,122,107,.82)"
                              : "rgba(143,169,189,.34)",
                          }}
                        >
                          GEN {i + 1}
                        </span>
                        <span
                          className="ml-auto font-mono text-[9.5px]"
                          style={{
                            color:
                              g.lastMood < 30
                                ? "rgba(255,122,107,.5)"
                                : g.lastMood > 70
                                  ? "rgba(53,240,206,.45)"
                                  : "rgba(143,169,189,.3)",
                          }}
                        >
                          {g.lastMood}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          )}

          {/* ═══ 中：当前页 ═══ */}
          <div
            className="relative min-w-0 flex-1 overflow-hidden"
            style={{ perspective: "1400px" }}
          >
            {pages.length === 0 ? (
              /*
               * 空态。
               *
               * **不要写「还没有人死在这里」** —— 那是恐怖片的语言，
               * 这里是深海观测站，不是凶宅。
               *
               * 也不要写「删掉一个角色，这里会多一块石头」——
               * 那是软件说明书。
               *
               * 现在这两句：
               *   「还没有刻下任何名字」—— 暗示**以后会有**
               *   「系统保持着沉默」—— 它在等
               *
               * **第二句没有括号。** 括号是舞台提示，会让人意识到
               * 「这是 UI 在说话」。不带括号才是陈述。
               */
              <div className="grid h-full place-items-center py-16 text-center">
                <div>
                  <div className="text-[12.5px] tracking-[0.02em] text-mist/60">
                    这里还没有刻下任何名字。
                  </div>
                  <div className="mt-2 font-mono text-[10.5px] tracking-[0.06em] text-mist/45">
                    系统保持着沉默。
                  </div>
                </div>
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false} custom={dir}>
                <motion.div
                  key={cur.grave.id + cur.grave.at}
                  custom={dir}
                  variants={PAGE}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="thin-scroll h-full overflow-y-auto px-6 py-5"
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <SinglePage
                    grave={cur.grave}
                    nth={cur.nth}
                    total={cur.total}
                    name={cur.name}
                    siblings={cur.siblings}
                    no={graves.findIndex(
                      (x) => x.id === cur.grave.id && x.at === cur.grave.at
                    ) + 1}
                  />
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* ═══ 翻页条 ═══ */}
        <div
          className="flex items-center gap-3 px-[18px] py-2.5"
          style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}
        >
          <button
            onClick={() => go(idx - 1)}
            disabled={idx <= 0 || pages.length === 0}
            className="rounded-[3px] border border-white/[0.09] px-2.5 py-[3px] font-mono text-[10px] text-ink/50 transition-colors hover:border-white/22 hover:bg-white/[0.04] disabled:opacity-22"
          >
            ◀ 上一页
          </button>
          <span className="font-mono text-[10px] tracking-[0.08em] text-mist/55">
            {pages.length === 0 ? "0 / 0" : `${idx + 1} / ${pages.length}`}
          </span>
          <button
            onClick={() => go(idx + 1)}
            disabled={idx >= pages.length - 1 || pages.length === 0}
            className="rounded-[3px] border border-white/[0.09] px-2.5 py-[3px] font-mono text-[10px] text-ink/50 transition-colors hover:border-white/22 hover:bg-white/[0.04] disabled:opacity-22"
          >
            下一页 ▶
          </button>

          <span className="ml-auto font-mono text-[9.5px] text-mist/44">
            ← → 翻页 · Esc 合上 · 这里的事不会被任何人知道
          </span>
          <button
            onClick={onClose}
            className="rounded-[3px] border border-white/[0.09] px-3 py-[4px] text-[10.5px] text-ink/55 transition-colors hover:border-white/22 hover:bg-white/[0.04]"
          >
            合上
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ══════════════════ 一整页 ══════════════════ */

function SinglePage({
  grave: g,
  nth,
  total,
  name,
  siblings,
  no,
}: {
  grave: Grave;
  nth: number;
  total: number;
  name: string;
  siblings: { grave: Grave; nth: number }[];
  no: number;
}) {
  const [relic, setRelic] = useState(false);

  const when = new Date(g.at).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  /*
   * 遗物 —— 她最后说的那句话。
   *
   * 只给一句。一句是遗物，十句是档案，一整段是回放。
   */
  const lastLine = (() => {
    if (!relic) return null;
    try {
      const th =
        (loadThreads() as Record<
          string,
          { text?: string; author?: string; system?: unknown }[]
        > | null) ?? {};
      const mine = th[String(g.id)];
      if (!Array.isArray(mine)) return null;
      for (let i = mine.length - 1; i >= 0; i--) {
        const m = mine[i];
        if (
          m &&
          !m.system &&
          m.author !== "me" &&
          typeof m.text === "string" &&
          m.text.trim()
        ) {
          return m.text.trim().slice(0, 120);
        }
      }
    } catch {
      /* 读不到就没有 */
    }
    return null;
  })();

  const edge =
    g.lastMood < 30
      ? "rgba(255,122,107,.42)"
      : g.lastMood > 70
        ? "rgba(53,240,206,.34)"
        : "rgba(255,255,255,.14)";

  return (
    <div>
      {/* 编号 + 时间 */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[9.5px] tracking-[0.14em] text-mist/52">
          NO.{String(no).padStart(3, "0")}
        </span>
        <span className="ml-auto font-mono text-[10px] tracking-[0.04em] text-mist/46">
          {when}
        </span>
      </div>

      {/* 名字 —— 整页最大的字 */}
      <div
        className="mt-3 text-[34px] leading-none tracking-[0.1em]"
        style={{
          fontFamily: 'Georgia, "Songti SC", "SimSun", serif',
          color: "rgba(232,246,255,.76)",
        }}
      >
        {name}
      </div>

      {/* 代数牌 */}
      <div className="mt-2.5 flex items-center gap-2">
        <span
          className="font-mono text-[10px] tracking-[0.1em]"
          style={{
            padding: "2px 6px",
            borderRadius: 0,
            border: "1px solid rgba(255,122,107,.3)",
            color: "rgba(255,122,107,.75)",
          }}
        >
          GEN {nth} · 第 {nth} 次推演
        </span>
        {/* 拨表状态下删的 —— 删除不可逆，这块石头要标明来历 */}
        {g.fromTimeShift && (
          <span
            title="她是在你拨动时间时被删除的。拨回来她不会回来。"
            className="font-mono text-[8.5px]"
            style={{
              padding: "1px 5px",
              borderRadius: 0,
              border: "1px solid rgba(255,196,107,.3)",
              color: "rgba(255,196,107,.75)",
            }}
          >
            ⏱ 时间偏移期间
          </span>
        )}
        {total > 1 && (
          <span className="font-mono text-[9.5px] text-mist/46">
            这个名字一共 {total} 代
          </span>
        )}
      </div>

      {/* 刻痕分隔 */}
      <div
        className="mt-4 h-px"
        style={{
          background: `linear-gradient(90deg, ${edge}, transparent 70%)`,
        }}
      />

      {/* 墓志铭 */}
      <div className="mt-3.5 text-[13px] tracking-[0.02em] text-mist/62">
        {g.epitaph}
      </div>

      {/* 死时状态 —— 加了条形 */}
      <div className="mt-4 space-y-2">
        <Bar label="心情" v={g.lastMood} tone={edge} />
        <Bar label="亲近" v={g.lastClose} tone={edge} />
      </div>

      {/* 留下的词 */}
      {g.keywords.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 font-mono text-[9.5px] tracking-[0.1em] text-mist/45">
            留下的词
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.keywords.map((k) => (
              <span
                key={k}
                className="font-mono text-[10px] text-mist/55"
                style={{
                  padding: "2px 7px",
                  borderRadius: 0,
                  border: "1px solid rgba(255,255,255,.08)",
                  background: "rgba(255,255,255,.024)",
                }}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 遗物 */}
      <div className="mt-4">
        <button
          onClick={() => setRelic((v) => !v)}
          className="font-mono text-[9.5px] tracking-[0.1em] transition-colors"
          style={{ color: relic ? "rgba(143,169,189,.45)" : "rgba(143,169,189,.26)" }}
        >
          {relic ? "▾ 遗物" : "▸ 遗物"}
        </button>
        {relic && (
          <div
            className="mt-2 px-3 py-2.5 text-[11px] leading-relaxed"
            style={{
              borderLeft: "1px solid rgba(255,255,255,.08)",
              color: lastLine ? "rgba(232,246,255,.6)" : "rgba(143,169,189,.32)",
              fontStyle: lastLine ? "italic" : "normal",
            }}
          >
            {lastLine ? `「${lastLine}」` : "她的最后一句话没有留下来。"}
          </div>
        )}
      </div>

      {/* 同一名字的其它代 —— 并排对比 */}
      {siblings.length > 0 && (
        <div className="mt-5">
          <div
            className="mb-2 font-mono text-[9.5px] tracking-[0.1em] text-mist/45"
            style={{ borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 10 }}
          >
            同一个名字的其它代
          </div>
          <div className="space-y-1">
            {siblings.map((s) => (
              <div key={s.grave.id + s.grave.at} className="flex items-baseline gap-2">
                <span className="font-mono text-[9.5px] tracking-[0.06em] text-mist/48">
                  GEN {s.nth}
                </span>
                <span className="text-[10px] text-mist/58">{s.grave.epitaph}</span>
                <span className="ml-auto font-mono text-[9.5px] text-mist/44">
                  {s.grave.lastMood} / {s.grave.lastClose}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 一根条形 —— 死时的值 */
function Bar({ label, v, tone }: { label: string; v: number; tone: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-8 shrink-0 font-mono text-[9.5px] tracking-[0.06em] text-mist/48">
        {label}
      </span>
      <div
        className="relative h-[3px] flex-1"
        style={{ background: "rgba(255,255,255,.045)" }}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: tone }}
        />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-[10px] text-mist/50">
        {v}
      </span>
    </div>
  );
}
