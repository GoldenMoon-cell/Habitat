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
import { toStarDefs, summarize, collectForMap } from "../../lib/starMapData";

type Quality = "high" | "mid" | "low";

const EMPTY: SeaStats = {
  phase: "inside", transit: 0, mode: "idle", clarity: 1, count: 0,
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

    // phase:'inside' → 直接进场景，不显示「进入」闸门
    const engine = new Engine(el, (s) => setStats(s), { phase: "inside", onFrame });
    engineRef.current = engine;

    const defs = toStarDefs(collectForMap(conv), Date.now());
    engine.loadMemories(defs);

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

      if (key) {
        if (e.code === "Escape") { e.preventDefault(); eng.back(); return; }
        if (e.code === "Space") { e.preventDefault(); eng.press(); }
        return;
      }
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

  const handleRescue = useCallback(() => {
    if (!rescue) return;
    engineRef.current?.rescueStar(rescue.idx);
    setRescue(null);
  }, [rescue]);

  /* ── HUD 数据 ── */
  const defs = toStarDefs(collectForMap(conv), Date.now());
  const summary = summarize(defs);
  const [h1, h2] = HINTS[stats.mode] ?? HINTS.idle;

  const SCROLL_MAX = 5.7;
  const norm = Math.max(0, Math.min(1, (stats.scrollY || 0) / SCROLL_MAX));
  const depth = Math.round(4280 * norm);
  const layer = norm >= 0.85 ? "海床" : norm >= 0.55 ? "深层" : norm >= 0.25 ? "中层" : "海面";

  return (
    <div className="starmap-root">
      <div className="app app--inside" style={{ position: "absolute", inset: 0 }}>
        <div ref={mountRef} className="stage" />
        <div ref={labelRef} className="star-label mono" />

        {rescue && (
          <div className="rescue">
            <p className="rescue__text">「{rescue.text}」正在消散</p>
            <button className="rescue__btn" onClick={handleRescue}>按住救回</button>
            <div className="rescue__bar">
              <div className="rescue__fill" style={{ width: `${Math.max(0, (1 - rescue.t / 5)) * 100}%` }} />
            </div>
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

          <div className="hud__ledger mono">
            <div className="ledger__row">
              <span className="ledger__label">刻于心里</span>
              <span className="ledger__val engraved">{summary.engraved}</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__label">随风飘荡</span>
              <span className="ledger__val fading">{summary.awake}</span>
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
