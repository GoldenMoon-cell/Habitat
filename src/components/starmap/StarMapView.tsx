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

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Engine, type SeaStats, type EngineStar, type EngineOptions } from "./Engine.js";
import "./starmap.css";
import { toStarDefs, summarize, collectForMap, shouldDissolve } from "../../lib/starMapData";
import { effectiveWeight, MEMORY_THRESHOLD, isConsolidated } from "../../lib/forgetting";
import type { Memory } from "../../lib/memoryNotes";
import { promoteMemory } from "../../lib/memoryNotes";

type Quality = "high" | "mid" | "low";


/**
 * 第 3 期：迁移。
 *
 * ── 为什么需要它 ──
 *
 * 一条记忆被想起够多次之后会固化（`isConsolidated`），衰减变慢，
 * 于是它的权重更高、位置更深 —— **这一步本来就是自动的**。
 * 但用户看不到：上次打开在中间，这次打开在底下，中间发生了什么没人知道。
 *
 * 所以要**演出来**：这次发现「它固化了」，就让它从原来的深度
 * 一路沉到新的深度，走 5 秒左右。
 *
 * ── 怎么做 ──
 *
 * `Engine.homeAt()` 每帧读 `s.def.at[1]` 当家的位置，
 * 所以只要插值改这个数，星就会跟着走 —— 不用动引擎。
 *
 * 起始位置用「上一次的 accessCount」重新算一遍权重得到，
 * 不是随便给个偏移。这样它沉下来的距离和「多想起了一次」
 * 是同一件事。
 */
const CONSOLIDATED_KEY = "3w:starmap-consolidated";

/** 时间轴最多能倒回多少天 —— 设计里说的「三个月」 */
const REWIND_DAYS = 90;

/**
 * 把星图挪到「days 天前」的那一刻。
 *
 * 这是第 4 期的核心，而它之所以可能，全因为
 * `effectiveWeight(m, now)` 是个**纯函数** ——
 * 传不同的 now 就得到不同时刻的权重，不需要任何新存储、
 * 不需要快照、不需要历史表。
 *
 * 每颗星改两个数：
 *   def.at[1]        位置（y = (0.5-w)*6.4，w 变了位置就变）
 *   timelineDepth    深度（引擎在回溯模式下令它作准，不再自己衰减）
 */
function applyRewind(eng: Engine, mems: Map<string, Memory>, days: number) {
  const t = Date.now() - days * 86400000;
  for (const star of eng.stars) {
    const m = mems.get(star.def.id);
    if (!m) continue;
    const w = effectiveWeight(m, t);
    star.def.at[1] = (0.5 - w) * 6.4;
    star.timelineDepth = w;
  }
}

/** 松手后：从当前回溯位置一路快放到现在。那 2.5 秒就是「她这三个月忘了多少」。 */
function playForward(
  eng: Engine,
  mems: Map<string, Memory>,
  from: number,
  onTick: (d: number) => void,
  raf: React.MutableRefObject<number>,
) {
  const t0 = performance.now();
  const DUR = 2500;
  cancelAnimationFrame(raf.current);
  const step = () => {
    const u = Math.min(1, (performance.now() - t0) / DUR);
    const e = 1 - Math.pow(1 - u, 3);
    const d = from * (1 - e);
    onTick(d);
    applyRewind(eng, mems, d);
    if (u < 1) raf.current = requestAnimationFrame(step);
    else {
      onTick(0);
      for (const s of eng.stars) s.timelineDepth = null;   // 交还给引擎
    }
  };
  raf.current = requestAnimationFrame(step);
}


function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(CONSOLIDATED_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(CONSOLIDATED_KEY, JSON.stringify(ids));
  } catch {
    /* 存不进去就算了 —— 下次当没见过，最多重演一次 */
  }
}

/**
 * 让一颗星从 fromY 平滑走到 toY。
 *
 * 用 ease-out（先快后慢）：它已经「落定」了，减速比加速合理。
 * 时长 5 秒 —— 短了像瞬移，长了会让用户以为卡住。
 */
function sinkStar(star: EngineStar, fromY: number, toY: number, sy: number, ms = 5000, delay = 0) {
  star.def.at[1] = fromY;
  let prev = fromY;
  let last = performance.now();
  const t0 = performance.now() + delay;

  const step = () => {
    const nowT = performance.now();
    const u = (nowT - t0) / ms;

    if (u >= 1) {
      star.def.at[1] = toY;
      star.vel.set(0, 0, 0);
      return;
    }
    if (u <= 0) {
      last = nowT;
      requestAnimationFrame(step);
      return;
    }

    const e = 1 - Math.pow(1 - u, 3);
    const y = fromY + (toY - fromY) * e;
    star.def.at[1] = y;

    /*
     * ── 尾迹 ──
     *
     * shader 里早就有这个机制：
     *   uniform vec3 uVel;    // 星的速度，用来拖出彗尾
     *   home -= uVel * (0.04 + aRand.y * 0.26);
     *
     * 每个粒子沿速度方向往后让一点，错峰随机 → 看起来就是彗尾。
     *
     * 但它一直是 0：因为 home 是每帧直接 copy 过去的，
     * 星在「瞬移」，没有速度。所以彗尾从来没出现过。
     *
     * 这里把每帧的位移写进 vel，尾迹自己就出来了。
     * 乘 sy 是因为 at[1] 是布局单位，而 home 用的是世界单位。
     */
    /*
     * 尾迹长度要按**世界单位**想，不能按「每帧位移」想。
     *
     * 第一版写的是 `dy * 0.55`（dy 是每帧位移，约 0.0016）——
     * shader 乘完 0.04~0.30 只剩 0.0005 个世界单位，
     * 而星本身的直径约 0.1。**小了两百倍，等于没有。**
     *
     * 反推：shader 里尾巴长度 ≈ uVel.y * 0.3（取那个乘数的中值）。
     * 想要尾巴约 0.35 个世界单位（≈ 三个星径），uVel.y 就要 ≈ 1.2。
     *
     * 用「速度」而不是「位移」来算，这样帧率变化不影响尾长：
     *   vy = dy / dt  （世界单位/秒）
     *   再乘一个经验系数把量级抬到 1 附近
     */
    const dt = Math.max(0.001, (nowT - last) / 1000);
    const vy = ((y - prev) * sy) / dt;
    star.vel.y = vy * 2.4;
    prev = y;
    last = nowT;

    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}


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
    <div className="detail mono">
      {/*
        横向平铺在粒子字下面，当那句话的「脚注」。
        原来是一张竖卡片挂在角落 —— 既占了字的横向范围，
        又像另一个 app 的面板。

        **这里不放原文**：上面那行粒子字就是原文。
        再抄一遍是噪音。脚注只回答「这条记忆现在什么状态」。
      */}
      <span className="detail__item">
        <i>来源</i>
        {m.source || "—"}
      </span>
      <span className="detail__item">
        <i>分类</i>
        {m.tag}
      </span>
      <span className="detail__item">
        <i>写入</i>
        {Math.round(days)} 天前
      </span>
      <span className="detail__item">
        <i>权重</i>
        {w0.toFixed(2)} → <b>{wNow.toFixed(2)}</b>
        {permanent && <em className="detail__badge">刻痕</em>}
      </span>
      <span className="detail__item">
        <i>被想起</i>
        {m.accessCount ?? 0} 次
        {ago !== null && ` · ${ago < 1 ? "今天" : Math.round(ago) + " 天前"}`}
      </span>

      <svg className="detail__curve" width={132} height={26} viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none">
        {/* 阈值横线 —— 跌破它就从「中层」浮到「海面」 */}
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
      </svg>
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
  /**
   * 左侧那一列 —— 有几颗大脑。
   *
   * 星图本来就是「一个角色的记忆」，但只从一个入口进来
   * 就永远只能看一个人。列在这里，换一片星域不用退出。
   */
  personas?: { id: string; name: string; color: string }[];
  /**
   * 换人。
   *
   * **这会同时改主界面的 conv** —— 关掉星图之后落在你刚才看的那个人那里。
   * 理由是：你刚盯着她的记忆看了半天，ESC 之后却回到另一个人那里会很愣。
   * 而且整个 app 只有一份 conv，不跟反而要维护两份。
   */
  onSwitchConv?: (id: string) => void;
  onClose: () => void;
}

export default function StarMapView({ conv, personas, onSwitchConv, onClose }: StarMapProps) {
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
  /** 迁移只演一次（每次打开算一次） */
  const migrationFired = useRef(false);

  /* ── 第 4 期：时间轴 ── */
  /** 往回看了几天。0 = 现在，90 = 三个月前。 */
  /** 换角色时的淡出（换一片星域，不是闪一下） */
  const [swapping, setSwapping] = useState(false);
  const [rewind, setRewind] = useState(0);
  /** 拖动中（松手后会自动快放回现在） */
  const [scrubbing, setScrubbing] = useState(false);
  const rewindRef = useRef(0);
  /** 拖动结束后往回放的动画句柄 */
  const rewindRaf = useRef(0);
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

    /*
     * 记忆**不在这里加载** —— 挪到下面那个 [conv] 的 effect 里。
     *
     * 原来建引擎和加载记忆写在同一个 effect，依赖是 [conv]。
     * 于是在星图里换角色（onSwitchConv 改 conv）会把**整个 Engine 重建**，
     * 新引擎的 phase 从 'outside' 开始 —— 画面直接退回闸门页，
     * 用户看到「沉积 / 进入」，刚才还在水里。
     *
     * 拆开：这个 effect 只建引擎（[] 依赖，只跑一次），
     * 换角色只换数据，不换引擎。
     */

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  /*
   * ── 加载 / 换角色 ──
   *
   * 挂载跑一次，之后每次 conv 变都跑一次。
   * 只换星，不碰引擎 —— 换角色时人还站在水里，只是面前那片记忆换了。
   */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

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

    /*
     * 换角色时，新的 DissolveQueue 要能在「已经在场景里」的情况下立刻生效 ——
     * 否则新那片星域里该散的那条要等到下次进出才演。
     */
    if (engine.phase === "inside") {
      dissolveFired.current = false;
      setStats((s) => ({ ...s, phase: "inside" }));
    }
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

  /* 卸载时停掉回放动画 */
  useEffect(() => () => cancelAnimationFrame(rewindRaf.current), []);

  /* ── 真正进到场景里，才让该散的那条开始散 ── */
  useEffect(() => {
    if (stats.phase !== "inside" || dissolveFired.current) return;
    dissolveFired.current = true;
    const eng = engineRef.current;
    if (!eng) return;
    for (const i of dissolveQueue.current) eng.startForgetting(i);
  }, [stats.phase]);

  /*
   * ── 第 3 期：迁移 ──
   *
   * 等真正进到场景里再演（和「正在散开」同一个道理：
   * 挂载时人还在闸门页，演了也看不到）。
   *
   * 只演「这次才发现已固化」的那些 —— 靠 localStorage 记上次见过谁。
   * 不然每次打开都重演一遍，第二次就变成噪音了。
   */
  useEffect(() => {
    if (stats.phase !== "inside") return;
    const eng = engineRef.current;
    if (!eng || migrationFired.current) return;
    migrationFired.current = true;

    const mems = memsRef.current;
    const seen = readSeen();
    const nowConsolidated: string[] = [];
    const fresh: { star: EngineStar; fromY: number; toY: number }[] = [];
    const now = Date.now();

    for (const star of eng.stars) {
      const m = mems.get(star.def.id);
      if (!m) continue;
      if (!isConsolidated(m)) continue;
      nowConsolidated.push(m.id);
      if (seen.has(m.id)) continue;      // 上次就见过，不重演
      /* 刻痕（milestone / rename）永不衰减，effectiveWeight 直接返回原值 ——
         它没有「固化前」的位置，不该演迁移。 */
      if (m.reason === "milestone" || m.reason === "rename") continue;

      /*
       * 「原来在哪」= **假如它还没固化**。
       *
       * 第一版写的是「accessCount 减一」，那是错的：
       * 固化的记忆衰减本来就慢（B_CONSOLIDATED 很小），
       * accessCount 少一次对权重几乎没影响 ——
       * 算出来的起点和终点几乎重合，于是全被下面的阈值滤掉，
       * 一次都没演过。
       *
       * 真正让位置跳变的是 `consolidated` 这个布尔本身：
       *   base = isConsolidated ? B_CONSOLIDATED : B[tag]
       * 从 B[tag] 换到 B_CONSOLIDATED，衰减速率整个降一档，
       * 权重跟着上去，位置跟着沉下来。
       *
       * 所以起点用 `{ ...m, consolidated: false }` 算。
       */
      const before = { ...m, consolidated: false };
      const y0 = (0.5 - effectiveWeight(before, now)) * 6.4;
      const y1 = star.def.at[1];
      if (Math.abs(y1 - y0) < 0.02) continue;   // 几乎没动，不值得演
      fresh.push({ star, fromY: y0, toY: y1 });
    }

    /* 错峰：一起沉会像整片塌下来 */
    fresh.slice(0, 6).forEach((f, i) => {
      sinkStar(f.star, f.fromY, f.toY, eng.sy ?? 1, 5000, i * 420);
    });

    writeSeen(nowConsolidated);
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
  /*
   * 拖动时间轴时，三档计数必须按**那一刻**重算。
   *
   * 否则画面在变、数字不动 —— 星都浮上去了，
   * 右下角还写着「清晰如昨 2」。数字和画面对不上，
   * 比不给数字更糟。
   *
   * 判据和 summarize 保持一致（mass < 0.2 / >= 0.6 / 其余），
   * 可见性也用 visibleOnMap 那条 0.002 的地板。
   */
  const liveSummary = useMemo(() => {
    if (rewind < 0.5) return summary;
    const tt = Date.now() - rewind * 86400000;
    let deep = 0, middle = 0, surface = 0;
    for (const m of memsRef.current.values()) {
      if (m.forgotten || m.suppressed) continue;
      const w = effectiveWeight(m, tt);
      if (w <= 0.002) continue;
      if (w < MEMORY_THRESHOLD) surface++;
      else if (w >= 0.6) deep++;
      else middle++;
    }
    return { total: deep + middle + surface, deep, middle, surface };
  }, [rewind, summary]);

  const activeId = engineRef.current?.active?.def?.id;
  const detailMem = activeId ? memsRef.current.get(activeId) : undefined;

  const SCROLL_MAX = 5.7;
  const norm = Math.max(0, Math.min(1, (stats.scrollY || 0) / SCROLL_MAX));
  const depth = Math.round(4280 * norm);
  /*
   * 三层：海面 / 中层 / 深层。
   *
   * 没有「海床」。原来最深那档叫海床 —— 但那暗示了一个「沉淀下来就不动」的
   * 地板，而这张图上没有那样的东西：固化的是**沉得深**，不是落在某个平面上。
   * 深海没有底，只有更深。
   */
  const layer = norm >= 0.62 ? "深层" : norm >= 0.28 ? "中层" : "海面";

  return (
    <div className={"starmap-root" + (swapping ? " is-swapping" : "")}>
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

          {/*
            ── 左侧：换一片星域 ──

            设计里写「conv = 哪颗大脑，切换角色 = 换一片星域」。
            原来只能关掉星图、切角色、再按 Ctrl+M 进来 —— 三步，中间还得退出。

            这里换人就调 onSwitchConv，主界面的 conv 跟着变，
            而本组件的加载 effect 依赖 [conv]，会自动重载。
            换的时候做一次短促的淡出淡入，读作「换了一片水」而不是「闪了一下」。
          */}
          {personas && personas.length > 1 && (
            <ul className="hud__brains">
              {personas.map((p) => {
                const here = String(p.id) === conv;
                return (
                  <li key={String(p.id)}>
                    <button
                      className={"brain" + (here ? " is-here" : "")}
                      style={{ ["--c" as string]: p.color }}
                      onClick={() => {
                        if (here || !onSwitchConv) return;
                        setSwapping(true);
                        /*
                         * 180ms 淡出 → 换 conv → 换完 effect 会重载 → 420ms 淡入。
                         * 用 setTimeout 而不是 transitionend：淡出可能被中断，
                         * transitionend 不一定来。
                         */
                        window.setTimeout(() => {
                          onSwitchConv(String(p.id));
                          window.setTimeout(() => setSwapping(false), 60);
                        }, 180);
                      }}
                    >
                      <span className="brain__dot" />
                      <span className="brain__name">{p.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

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

          {/*
            ── 深度条 ──
            尺子，不是缩略图。

            挂两个东西：
              · 相机现在在哪（游标）
              · 三段的分界（将要浮起 / 渐渐褪色 / 清晰如昨）

            不挂每颗星的点 —— 星的位置本身已经在说相对深度了，
            再画一排点就是第二张更小的同一张图，而且会互相压住。

            刻度位置不是随手定的：y = (0.5 - w) * 6.4，
            而 norm = scrollY / 5.7 正好等于 w ——
            所以条的 0/0.2/0.6/1 就是四档权重的边界。
          */}
          <div className="depthbar" aria-hidden>
            <span className="depthbar__band b-surface" style={{ top: 0, height: "20%" }} />
            <span className="depthbar__band b-mid" style={{ top: "20%", height: "40%" }} />
            <span className="depthbar__band b-deep" style={{ top: "60%", height: "40%" }} />
            <span className="depthbar__cursor" style={{ top: `${norm * 100}%` }} />

            {/*
              文字刻度：各段的中点。
              条在最右边，到边缘只剩 26px ——
              所以标签贴在条的**左侧**，右对齐过去。
              颜色跟着段走：越深越实（和星一样）。
            */}
            <span className="depthbar__label l-surface" style={{ top: "10%" }}>将要浮起</span>
            <span className="depthbar__label l-mid" style={{ top: "40%" }}>渐渐褪色</span>
            <span className="depthbar__label l-deep" style={{ top: "80%" }}>清晰如昨</span>
          </div>

          {/*
            空星域。
            现在一个人没记忆就是空海（不再拿别人的记忆兜底），
            所以给一行字 —— 否则一片黑水和「加载失败」长得一样。
            只在真正进到水里之后才显示，闸门页不需要。
          */}
          {stats.phase === "inside" && stats.mode === "idle" && summary.total === 0 && (
            <p className="starmap-empty">她还没记住什么。</p>
          )}


          {/*
            空星域时不要给「靠近一颗星 / 点击，打开它」——
            一颗星都没有，那句话是错的。
            中间那行「她还没记住什么」已经把话说完了。
          */}
          {summary.total > 0 && (
            <div className="hud__hint" key={stats.mode}>
              <p>{h1}</p>
              {h2 && <p className="hud__fine">{h2}</p>}
            </div>
          )}

          {/*
            第 2 期：点开一颗星时，右下角浮出它的详情和衰减曲线。
            只在「已经打开」的三种状态下出现 ——
            returning / collapsing 时字已经在飞回去了，再挂面板会打架。
          */}
          {detailMem && (stats.mode === "shown" || stats.mode === "holding" || stats.mode === "released") && (
            <StarDetail m={detailMem} opened={openedAt.current} />
          )}

          {/*
            ── 第 4 期：时间轴 ──
            拖回去看「三个月前」，松手自动快放到现在。

            为什么这条能成立：effectiveWeight(m, now) 是纯函数，
            传不同的 now 就是不同时刻。不需要任何新存储。
          */}
          {stats.phase === "inside" && (
            <div className={`timeline${scrubbing ? " is-scrubbing" : ""}`}>
              <span className="timeline__end mono">{REWIND_DAYS} 天前</span>
              <div
                className="timeline__track"
                onPointerDown={(e) => {
                  const eng = engineRef.current;
                  if (!eng) return;
                  const el = e.currentTarget;
                  el.setPointerCapture(e.pointerId);
                  setScrubbing(true);
                  cancelAnimationFrame(rewindRaf.current);
                  const apply = (clientX: number) => {
                    const r = el.getBoundingClientRect();
                    const u = Math.min(1, Math.max(0, 1 - (clientX - r.left) / r.width));
                    const d = u * REWIND_DAYS;
                    rewindRef.current = d;
                    setRewind(d);
                    applyRewind(eng, memsRef.current, d);
                  };
                  apply(e.clientX);
                  const move = (ev: PointerEvent) => apply(ev.clientX);
                  const up = () => {
                    el.removeEventListener("pointermove", move);
                    el.removeEventListener("pointerup", up);
                    el.removeEventListener("pointercancel", up);
                    setScrubbing(false);
                    playForward(eng, memsRef.current, rewindRef.current, (d) => {
                      rewindRef.current = d;
                      setRewind(d);
                    }, rewindRaf);
                  };
                  el.addEventListener("pointermove", move);
                  el.addEventListener("pointerup", up);
                  el.addEventListener("pointercancel", up);
                }}
              >
                <span className="timeline__fill" style={{ width: `${(rewind / REWIND_DAYS) * 100}%` }} />
                <span className="timeline__knob" style={{ left: `${(rewind / REWIND_DAYS) * 100}%` }} />
                {/*
                  当前值跟着游标浮在上面。
                  原来写的是「左右两端都显示值」，拖到最左边时
                  两边都成了「90 天前」，读起来像 bug。
                  现在两端固定（起点 / 终点），值只出现在游标处。
                */}
                {rewind > 0.5 && (
                  <span
                    className="timeline__value mono"
                    style={{ left: `${(rewind / REWIND_DAYS) * 100}%` }}
                  >
                    {Math.round(rewind)} 天前
                  </span>
                )}
              </div>
              <span className="timeline__end mono">现在</span>
            </div>
          )}

          <div className="hud__ledger mono">
            {/*
              三档 = 三个层，按 mass 分。
              因为 y = (0.5 - w) * 6.4，**mass 就是深度** ——
              数出来的就是画面上三段里各有几颗，抬头能对上。

              三个词各带一个维度，而且都在水的语言里：
                清晰如昨  时间（像昨天）
                渐渐褪色  过程（正在褪）
                将要浮起  方向（往上，还没到水面）
              画面和文字说的是同一件事的不同时态。

              固化不再是单独一档 —— 它是星身上的髓鞘光环，本来就看得见。
            */}
            {/*
              顺序必须和右边深度条一致：上 → 下 = 浅 → 深。
              原来这里是「清晰如昨」打头，而条子上是「将要浮起」在顶 ——
              同一个界面里两套方向，看的人会下意识对错位置。
            */}
            <div className="ledger__row">
              <span className="ledger__label">将要浮起</span>
              <span className="ledger__val sunken">{liveSummary.surface}</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__label">渐渐褪色</span>
              <span className="ledger__val fading">{liveSummary.middle}</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__label">清晰如昨</span>
              <span className="ledger__val engraved">{liveSummary.deep}</span>
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
