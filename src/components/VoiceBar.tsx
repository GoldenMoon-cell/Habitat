import { useEffect, useRef, useState } from "react";
import type { VoiceClip } from "../data/mock";
import { IconPause, IconPlay } from "./Icons";

/**
 * 自定义语音条。
 * - 波形高度来自 peaks 数组（不是装饰）
 * - 播放有进度环 + 逐柱点亮 + 可拖拽的播放头
 * - 点击/拖动波形任意位置可跳转（纯前端推演，不接真实音频）
 */

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function VoiceBar({
  clip,
  color,
  align = "left",
}: {
  clip: VoiceClip;
  color: string;
  align?: "left" | "right";
}) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  const progRef = useRef(0);
  const rafRef = useRef(0);
  const baseRef = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const dur = Math.max(1, clip.seconds * 1000);
  const R = 15.5;
  const C = 2 * Math.PI * R;

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  };

  const loop = () => {
    const p = (performance.now() - baseRef.current) / dur;
    if (p >= 1) {
      progRef.current = 0;
      setProgress(0);
      setPlaying(false);
      return;
    }
    progRef.current = p;
    setProgress(p);
    rafRef.current = requestAnimationFrame(loop);
  };

  const play = () => {
    baseRef.current = performance.now() - progRef.current * dur;
    setPlaying(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  const seek = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(0.998, Math.max(0, (clientX - r.left) / r.width));
    progRef.current = p;
    setProgress(p);
    if (playing) baseRef.current = performance.now() - p * dur;
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const playedIdx = Math.floor(progress * clip.peaks.length);

  return (
    <div className="w-full select-none">
      <div className="flex items-center gap-2.5">
        {/* 播放按钮 + 进度环 */}
        <div className="relative h-9 w-9 shrink-0">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
            <circle cx="18" cy="18" r={R} fill="none" stroke={`${color}22`} strokeWidth="1.2" />
            <circle
              cx="18"
              cy="18"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              style={{ filter: `drop-shadow(0 0 3px ${color}88)`, transition: playing ? "none" : "stroke-dashoffset .2s" }}
            />
          </svg>
          <button
            onClick={() => (playing ? stop() : play())}
            className="absolute inset-[3.5px] grid place-items-center rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
            style={{
              background: `radial-gradient(circle at 34% 28%, ${color}30, rgba(4,12,20,0.55) 72%)`,
              color,
              boxShadow: playing ? `0 0 14px -3px ${color}99` : "none",
            }}
            aria-label={playing ? "暂停" : "播放语音"}
          >
            {playing ? <IconPause size={12} /> : <IconPlay size={12} />}
          </button>
        </div>

        {/* 波形轨道 */}
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            seek(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging) seek(e.clientX);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
          className="group relative flex h-[30px] flex-1 cursor-pointer items-center gap-[2px] py-1"
          role="slider"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="语音进度"
        >
          {clip.peaks.map((peak, i) => {
            const active = i <= playedIdx;
            return (
              <span
                key={i}
                className="flex-1 rounded-full transition-[background,box-shadow] duration-150"
                style={{
                  height: `${Math.max(3, peak * 24)}px`,
                  minWidth: 1.5,
                  background: active ? color : `${color}2e`,
                  boxShadow: active ? `0 0 4px ${color}55` : "none",
                }}
              />
            );
          })}

          {/* 播放头 */}
          <span
            className="pointer-events-none absolute -top-[1px] bottom-[-1px] w-px"
            style={{
              left: `${progress * 100}%`,
              background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
              opacity: progress > 0.005 ? 0.9 : 0,
              boxShadow: `0 0 6px ${color}`,
            }}
          />
        </div>

        <span
          className="tabular shrink-0 text-[10px] tabular-nums"
          style={{ color: playing ? color : `${color}b0` }}
        >
          {fmt(progress * clip.seconds)}
          <span className="opacity-40"> / {fmt(clip.seconds)}</span>
        </span>
      </div>

      <div
        className={`mt-1.5 max-w-[94%] text-[11.5px] leading-[1.55] text-mist/58 ${
          align === "right" ? "ml-auto text-right" : ""
        }`}
      >
        {clip.transcript}
      </div>
    </div>
  );
}
