/**
 * 记忆星图 —— 「沉积」
 *
 * 视觉来自 D:\Habitat_Visual_Sandbox（Opus 做的），
 * 这里只做三件事：
 *   ① 把 app 的真实记忆喂进去（toStarDefs）
 *   ② 包一层 React 生命周期（挂载 / 卸载 / 失焦暂停 / 画质档位）
 *   ③ 把 HUD 的口吻对齐到《生境》
 *
 * 引擎本身（Engine.js / shaders.js / textSampler.js）保持原样，
 * 只在 Engine.js 里加过 setPaused / setQuality 两个方法。
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Engine, type SeaStats, type EngineStar, type EngineOptions } from "./Engine.js";
import "./starmap.css";
import { toStarDefs, summarize, collectForMap, shouldDissolve } from "../../lib/starMapData";
import { effectiveWeight, MEMORY_THRESHOLD } from "../../lib/forgetting";
import type { Memory } from "../../lib/memoryNotes";
import { promoteMemory } from "../../lib/memoryNotes";

type Quality = "high" | "mid" | "low";

/*
 * 初始相位必须是 'outside'。
 *
 * 写成 'inside' 会让「进到场景里才点火」那个 effect
 * 在挂载第一帧就触发 —— 那时人还在闸门页，
 * 等真正下去时窗口已经关了，或者干脆一次都没演。
 */
const EMPTY: SeaStats = {
  phase: "outside", transit: 1, mode: "idle", clarity: 1, count: 0,
  engraved: 0, awake: 0, fading: 0, sunken: 0, lastTouched: null, scrollY: 0,
};

const HINTS: Record<string, [string, string]> = {
  idle:       ["靠近一颗星", "点击，打开它"],
  opening:    ["它在想起来", ""],
  shown:      ["按住，把它握紧", "ESC 收起 · 不碰它，它会自己散开"],
  holding:    ["握着", "松开，就会失去一些"],
  released:   ["有些已经掉下去了", "点击，让剩下的回去"],
  collapsing: ["回去了", ""],
  returning:  ["回去了", ""],
};



/**
 * 点开一颗星时，右下角浮出的详情。
 *
 * 第 2 期的内容：**那颗星的详情 + 衰减曲线**。
 * 之前点开只有粒子字，看不到「它是什么、还剩多少、在怎么掉」。
 *
 * 曲线不是画好看的 —— 它用的是和全软件同一个函数
 * `effectiveWeight(m, now)`，所以图上任何一点都能对上
 * HUD 的读数。传不同的 now 就是不同的时刻，
 * 这也正是第 4 期时间轴的算法基础。
 */
function StarDetail({ m, opened }: { m: Memory; opened: number }) {
  const now = Date.now();
  const t0 = m.at ?? now;
  const w0 = m.weight;
  const wNow = effectiveWeight(m, now);
  const permanent = m.reason === "milestone" || m.reason === "rename";

  /* 曲线：从写入那天，一直画到 30 天后 */
  const HORIZON = 30 * 864e5;
  const end = now + HORIZON;
  const N = 72;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const tt = t0 + ((end - t0) * i) / N;
    pts.push([tt, effectiveWeight(m, tt)]);
  }

  const W = 186, H = 36;
  const xOf = (tt: number) => ((tt - t0) / (end - t0)) * W;
  const yOf = (w: number) => H - Math.max(0, Math.min(1, w)) * H;
  const path = pts.map(([tt, w], i) => `${i ? "L" : "M"}${xOf(tt).toFixed(1)} ${yOf(w).toFixed(1)}`).join(" ");

  /* 「现在」那条竖线，和阈值那条横线 */
  const nowX = xOf(now);
  const thrY = yOf(MEMORY_THRESHOLD);

  const days = Math.max(0, (now - t0) / 864e5);
  const ago = opened > 0 ? Math.max(0, (now - opened) / 864e5) : null;

  return (
    <div className="detail">
      <p className="detail__text">{m.text}</p>

      <div className="detail__grid mono">
        <span className="detail__k">来源</span>
        <span className="detail__v">{m.source || "—"}</span>

        <span className="detail__k">分类</span>
        <span className="detail__v">{m.tag}</span>

        <span className="detail__k">写入</span>
        <span className="detail__v">{Math.round(days)} 天前</span>

        <span className="detail__k">权重</span>
        <span className="detail__v">
          {w0.toFixed(2)} → <b>{wNow.toFixed(2)}</b>
          {permanent && <em className="detail__badge">刻痕 · 不衰减</em>}
        </span>

        <span className="detail__k">被想起</span>
        <span className="detail__v">
          {m.accessCount ?? 0} 次
          {ago !== null && ` · ${ago < 1 ? "今天" : Math.round(ago) + " 天前"}`}
        </span>
      </div>

      <svg className="detail__curve" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* 阈值横线 —— 跌破它就算「沉入海床」 */}
        <line x1="0" y1={thrY} x2={W} y2={thrY} className="detail__thr" />
        {/* 现在之后的虚线：还没发生 */}
        <path
          d={pts.filter(([tt]) => tt >= now).map(([tt, w], i) =>
            `${i ? "L" : "M"}${xOf(tt).toFixed(1)} ${yOf(w).toFixed(1)}`).join(" ")}
          className="detail__future"
        />
        {/* 已经发生的：实线 */}
        <path
          d={pts.filter(([tt]) => tt <= now).map(([tt, w], i) =>
            `${i ? "L" : "M"}${xOf(tt).toFixed(1)} ${yOf(w).toFixed(1)}`).join(" ")}
          className="detail__past"
        />
        <line x1={nowX} y1="0" x2={nowX} y2={H} className="detail__now" />
        <text x={nowX + 3} y="7" className="detail__nowlabel">现在</text>
      </svg>
      {/*
        轴只标首尾。
        原来三个标签（过去 / 现在 / 未来）挤在 186px 里必然重叠 ——
        「现在」的位置又取决于写了多久（写 12 天、未来 30 天，
        就在 28.6% 处），没法靠 justify-between 摆。
        所以「现在」挪进图里贴竖线顶端，轴只留首尾两个。
      */}
      <div className="detail__axis mono">
        <span style={{ left: 0 }}>{Math.round(days)} 天前</span>
        <span style={{ right: 0 }}>+30 天</span>
      </div>
    </div>
  );
}

/*
 * 「正在散开」那一条的文案。
 *
 * 原来写的是「正在消散 / 按住救回」——
 * **「救回」承诺了做不到的事**：rescueStar 不恢复 mass，
 * promoteMemory 也只 +0.15。掉的粒子不会回来。
 *
 * 改成「留住」：它只承诺「还在」，不承诺「回来」。
 * 而且「按住」这个动作和「留住」本来就是一件事 ——
 * 你按住它就在，松手它就继续走。
 */
const FADING_COPY = {
  title: (text: string) => `「${text}」正在散开`,
  action: "按住，留住它",
  note: "留住的只是还剩下的",
  hint: ["它在散", "按住能多留一会儿 · 掉了的回不来"] as [string, string],
}

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export interface StarMapProps {
  /** 看哪个会话的记忆 */
  conv: string;
  onClose: () => void;
}

export default function StarMapView({ conv, onClose }: StarMapProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const labelTxt = useRef("");
  const [stats, setStats] = useState<SeaStats>(EMPTY);
  const [quality, setQuality] = useState<Quality>("high");
  /** 挂载时算好「谁该散」，等进到场景里再点火 */
  /** id → 原始 Memory。引擎只吃 StarDef（渲染用），
   *  但详情面板要 source / tag / accessCount / 时间 —— 那些 StarDef 没保留。 */
  const memsRef = useRef<Map<string, Memory>>(new Map());
  const dissolveQueue = useRef<number[]>([]);
  const dissolveFired = useRef(false);
  /** 这颗星是什么时候被点开的（算「上次想起距今」用） */
  const openedAt = useRef(0);

  /* ── 挂载引擎 ── */
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const onFrame: EngineOptions["onFrame"] = (f) => {
      const lab = labelRef.current;
      if (!lab) return;
      if (!f) { lab.style.opacity = "0"; return; }
      const firm = f.cohesion > 0.75 ? "牢固" : f.cohesion > 0.45 ? "平稳" : f.cohesion > 0.25 ? "松动" : "将散";
      const txt = `${String(f.i + 1).padStart(2, "0")} · ${Math.round(f.mass * 100)}% · ${firm}${f.engrave > 0.2 ? " · 刻痕" : ""}`;
      if (txt !== labelTxt.current) { labelTxt.current = txt; lab.textContent = txt; }
      lab.style.opacity = String(Math.min(1, f.alpha * 1.4));
      lab.style.transform = `translate(${f.x + 26}px, ${f.y - 34}px)`;
    };

    /*
     * phase:'outside' → 先停在水面外，等用户点「进入」再下潜。
     *
     * 这段下潜是 5.2 秒（Engine 的 ENTER_DUR），不是过场动画 ——
     * 它把「进入记忆」这件事演出来：光柱从头顶压下来，海雪扑到脸上。
     * 直接跳进 inside 就少了这个仪式。
     */
    const engine = new Engine(el, (s) => setStats(s), { phase: "outside", onFrame });
    engineRef.current = engine;
    /* dev 下暴露实例，方便在控制台核对星的位置和状态 */
    if (import.meta.env.DEV) {
      (window as unknown as { __starmap?: Engine }).__starmap = engine;
    }

    const now = Date.now();
    const mems = collectForMap(conv);
    memsRef.current = new Map(mems.map((m) => [m.id, m]));
    const defs = toStarDefs(mems, now);
    engine.loadMemories(defs);

    /*
     * 谁该演「正在散开」—— 这里只**记下来**，不立刻启动。
     *
     * 判据在 shouldDissolve 里：权重已经跌破 0.2 **而且** 30 天没被想起。
     * 两条都满足，演的才是「已经在发生的事」——
     * 只看权重的话，一条 0.19 的记忆本来还能活几天，
     * 打开星图反而把它按死了。
     *
     * 为什么不在挂载时启动：
     * 散开的窗口只有 5 秒，而用户要先在闸门页点「进入」，
     * 再下潜 5.2 秒。挂载就启动的话，等他落到海底，窗口早关了
     * —— 他会看到一个「已经死了」的画面，从头到尾没参与。
     * 所以等真正进到场景里（phase === 'inside'）再启动。
     */
    dissolveQueue.current = defs
      .map((d, i) => {
        const m = mems.find((x) => x.id === d.id);
        return m && shouldDissolve(m, now) ? i : -1;
      })
      .filter((i) => i >= 0);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [conv]);

  /* ── 输入 ── */
  useEffect(() => {
    const isBtn = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest("button, .hud");

    const down = (e: PointerEvent | KeyboardEvent) => {
      if (isBtn(e.target)) return;
      const eng = engineRef.current;
      if (!eng) return;
      const key = e instanceof KeyboardEvent;
      if (key && e.repeat) return;

      /* 还没进去 —— 任何一下都算「进入」（和沙盒原版一致） */
      if (eng.phase === "outside" || eng.phase === "leaving") {
        if (key && e.code !== "Enter" && e.code !== "Space") return;
        if (key) e.preventDefault();
        void eng.enter();
        return;
      }

      if (key) {
        if (e.code === "Escape") { e.preventDefault(); eng.back(); return; }
        if (e.code === "Space") { e.preventDefault(); eng.press(); }
        return;
      }
      /*
       * 记下点开的时刻 —— 详情面板里的「上次想起距今」用它。
       * 放在 press 之前：press 之后引擎可能立刻进 shown，
       * 那一次重渲就会读这个值。
       */
      if (eng.mode === "idle" || eng.mode === "returning") openedAt.current = Date.now();
      eng.press((e as PointerEvent).clientX, (e as PointerEvent).clientY);
    };

    const up = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.code !== "Space") return;
      engineRef.current?.release();
    };

    const evs: [string, EventListener][] = [
      ["pointerdown", down as EventListener],
      ["pointerup", up as EventListener],
      ["pointercancel", up as EventListener],
      ["keydown", down as EventListener],
      ["keyup", up as EventListener],
      ["blur", up as EventListener],
    ];
    for (const [n, f] of evs) window.addEventListener(n, f);
    return () => { for (const [n, f] of evs) window.removeEventListener(n, f); };
  }, []);

  /* ── 失焦暂停：面板开着但人在别处时不该一直烧 GPU ── */
  useEffect(() => {
    const onVis = () => engineRef.current?.setPaused?.(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", () => engineRef.current?.setPaused?.(true));
    window.addEventListener("focus", () => engineRef.current?.setPaused?.(false));
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /* ── 真正进到场景里，才让该散的那条开始散 ── */
  useEffect(() => {
    if (stats.phase !== "inside" || dissolveFired.current) return;
    dissolveFired.current = true;
    const eng = engineRef.current;
    if (!eng) return;
    for (const i of dissolveQueue.current) eng.startForgetting(i);
  }, [stats.phase]);

  /* ── 画质切换 ── */
  useEffect(() => {
    engineRef.current?.setQuality?.(quality);
  }, [quality]);

  /* ── 正在消散的那颗（可救回） ── */
  const [rescue, setRescue] = useState<{ idx: number; text: string; t: number } | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const eng = engineRef.current;
      if (!eng) return;
      const f = eng.stars.find((x: EngineStar) => x.forgetting && x.rescuable);
      setRescue(f ? { idx: eng.stars.indexOf(f), text: f.def.text, t: f.forgettingT } : null);
    }, 160);
    return () => window.clearInterval(id);
  }, []);

  /**
   * 留住一条正在散开的记忆。
   *
   * 两步缺一不可：
   *   ① engine.rescueStar —— 视觉上把粒子拉回来（只托 depth，不恢复 mass）
   *   ② promoteMemory     —— 权重 +0.15 写回 localStorage
   *
   * 只做 ① 的话是空手势：下次打开星图，toStarDefs 会用 effectiveWeight
   * 重新算一遍，引擎里托起来的那点深度直接被覆盖。
   *
   * 用 promoteMemory 而不是 recallMemory ——
   * 后者直接把权重设成 0.5，会把原有的高低抹平。
   */
  const handleRescue = useCallback(() => {
    if (!rescue) return;
    const eng = engineRef.current;
    const id = eng?.stars[rescue.idx]?.def?.id;
    eng?.rescueStar(rescue.idx);
    if (id) promoteMemory(id);
    setRescue(null);
  }, [rescue]);

  /* ── HUD 数据 ── */
  const defs = toStarDefs(collectForMap(conv), Date.now());
  const summary = summarize(defs);
  const [h1, h2] = rescue ? FADING_COPY.hint : HINTS[stats.mode] ?? HINTS.idle;

  /*
   * 当前打开的那颗星对应的原始记忆。
   *
   * 引擎的 active 只有 StarDef（渲染用），没有 source / tag / 时间。
   * 所以按 id 回 memsRef 里取。stats.mode 变化时组件会重渲，
   * 这里跟着读到最新的 active。
   */
  const activeId = engineRef.current?.active?.def?.id;
  const detailMem = activeId ? memsRef.current.get(activeId) : undefined;

  const SCROLL_MAX = 5.7;
  const norm = Math.max(0, Math.min(1, (stats.scrollY || 0) / SCROLL_MAX));
  const depth = Math.round(4280 * norm);
  const layer = norm >= 0.85 ? "海床" : norm >= 0.55 ? "深层" : norm >= 0.25 ? "中层" : "海面";

  return (
    <div className="starmap-root">
      <div
        className={`app app--${stats.phase}`}
        style={{ position: "absolute", inset: 0 }}
      >
        <div ref={mountRef} className="stage" />
        <div ref={labelRef} className="star-label mono" />

        {rescue && (
          <div className="rescue">
            <p className="rescue__text">{FADING_COPY.title(rescue.text)}</p>
            <button className="rescue__btn" onClick={handleRescue}>{FADING_COPY.action}</button>
            <p className="rescue__note">{FADING_COPY.note}</p>
            <div className="rescue__bar">
              <div className="rescue__fill" style={{ width: `${Math.max(0, (1 - rescue.t / 5)) * 100}%` }} />
            </div>
          </div>
        )}

        {/* 闸门 —— 停在水面外，点一下才下潜 */}
        {stats.phase !== "inside" && (
          <div className="gate">
            <h1>沉积</h1>
            <p className="gate__sub">SEDIMENT</p>
            <p className="gate__cta">进入</p>
            <p className="gate__fine mono">
              {stats.phase === "entering" ? "正在下潜…" : "点击，或按 ENTER"}
            </p>
          </div>
        )}

        <div className="hud">
          <header className="hud__title">
            <h1>沉积</h1>
            <p>SEDIMENT — 所有落下的，都不会再浮上来</p>
          </header>

          <div className="hud__depth">
            <span className="mono">−{depth.toLocaleString("en-US")} m</span>
            <span className="depth-layer">{layer}</span>
            <button
              className="mono"
              onClick={() =>
                setQuality((q) => (q === "high" ? "mid" : q === "mid" ? "low" : "high"))
              }
              title="画质：high / mid / low"
            >
              画质 {quality}
            </button>
            <button onClick={onClose} className="hud__leave">
              收起 <span className="mono">ESC</span>
            </button>
          </div>

          <div className="hud__hint" key={stats.mode}>
            <p>{h1}</p>
            {h2 && <p className="hud__fine">{h2}</p>}
          </div>

          {/*
            第 2 期：点开一颗星时，右下角浮出它的详情和衰减曲线。
            只在「已经打开」的三种状态下出现 ——
            returning / collapsing 时字已经在飞回去了，再挂面板会打架。
          */}
          {detailMem && (stats.mode === "shown" || stats.mode === "holding" || stats.mode === "released") && (
            <StarDetail m={detailMem} opened={openedAt.current} />
          )}

          <div className="hud__ledger mono">
            <div className="ledger__row">
              <span className="ledger__label">刻于心里</span>
              <span className="ledger__val engraved">{summary.engraved}</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__label">随风飘荡</span>
              <span className="ledger__val fading">{summary.drifting}</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__label">沉入海床</span>
              <span className="ledger__val sunken">{summary.sunken}</span>
            </div>
            {stats.lastTouched && (
              <div className="ledger__last">
                {timeAgo(stats.lastTouched.ago)} 想起了「{stats.lastTouched.text}」
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
