import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { EmotionAxis } from "../data/mock";
import { axisBand, type AxisName } from "../data/personas";

const R = 44;
const CX = 80;
const CY = 78;
const N = 4;
const R_INNER = 30;   /* 中心呼吸点的半径 */

const pos = (i: number, radius: number) => {
  const rad = ((-90 + i * (360 / N)) * Math.PI) / 180;
  return [CX + Math.cos(rad) * radius, CY + Math.sin(rad) * radius] as const;
};

/**
 * 四轴生命体征仪。
 *
 *  内层（虚线） = 人设锚点 Base：写进人设文件的那个「他本来是什么人」
 *  外层（实线） = 当前值 Effective：锚点 + 相处累积的漂移
 *
 * 两层之间那段空隙，就是你和他相处留下的痕迹。
 *
 * 为什么只有四轴：原来六个轴里有四个的相关系数是 0.85~0.98（用 8 个默认角色
 * 算出来的），实际只有两个独立维度。与其让用户调三个假旋钮，不如给四个真的。
 *
 * 动态状态（心情 / 亲近 / 记忆活性）不画进来 —— 那些一小时能变三次，
 * 画进「性格画像」会让人以为性格在变。
 */
export default function EmotionRadar({
  axes,
  baseAxes,
  color,
  conv,
  mood = 60,
  doomed = false,
}: {
  axes: EmotionAxis[];
  /** 出厂基线。给了就画内层虚线，并让外层从它生长出来 */
  baseAxes?: EmotionAxis[];
  color: string;
  conv: string;
  /** 此刻心情 0-100，控制中心呼吸点的大小和节奏 */
  mood?: number;
  /**
   * 她被判了日子。
   *
   * **数值一点不变** —— 性格是常年的东西，判死刑不会让一个人变温柔。
   *
   * 变的只是「看起来还在不在」：填充变淡、外框加虚线。
   *
   * 她的形状还在，但在褪色。
   */
  doomed?: boolean;
}) {
  const startFrom = () =>
    baseAxes ? baseAxes.map((a) => a.value) : axes.map((a) => a.value * 0.55);

  const [disp, setDisp] = useState<number[]>(startFrom);
  const dispRef = useRef<number[]>(disp);
  const targetRef = useRef<number[]>(axes.map((a) => a.value));
  const rafRef = useRef(0);

  /* 换会话：从基线（或无基线时的低形态）重新生长 */
  useEffect(() => {
    const init = startFrom();
    dispRef.current = init;
    targetRef.current = axes.map((a) => a.value);
    setDisp(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv]);

  /* 目标值变化（注入人格 / 换基线）立即接管，不等下一轮扰动 */
  const sig = axes.map((a) => a.value).join(",");
  useEffect(() => {
    targetRef.current = axes.map((a) => a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  /* 逐帧缓动 */
  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const k = 1 - Math.pow(0.0025, dt / 1000);

      let moved = false;
      const next = dispRef.current.map((v, i) => {
        const t = targetRef.current[i] ?? v;
        const d = t - v;
        if (Math.abs(d) < 0.05) return t;
        moved = true;
        return v + d * k;
      });

      if (moved) {
        dispRef.current = next;
        setDisp(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /* 有基线时不再随机扰动 —— 注入态是"读数"，不是"呼吸" */
  const hasBase = !!baseAxes;
  useEffect(() => {
    if (hasBase) return;
    const id = window.setInterval(() => {
      targetRef.current = axes.map((a) => {
        const drift = (Math.random() - 0.5) * 15;
        return Math.max(16, Math.min(97, a.value + drift));
      });
    }, 2600);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes, conv, hasBase]);

  const rings = [0.25, 0.5, 0.75, 1];

  const poly = (vals: number[]) =>
    vals
      .map((v, i) => {
        const [x, y] = pos(i, (R * Math.max(5, v)) / 100);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const gridPts = (r: number) =>
    Array.from({ length: N }, (_, i) => {
      const [x, y] = pos(i, R * r);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

  const baseVals = baseAxes?.map((a) => a.value);

  return (
    <svg
      viewBox="0 0 160 168"
      className="mx-auto max-h-[196px] w-full"
      aria-label="情绪雷达图"
    >
      <defs>
        <radialGradient id="radar-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.46" />
          <stop offset="100%" stopColor={color} stopOpacity="0.08" />
        </radialGradient>
      </defs>

      {rings.map((r) => (
        <polygon
          key={r}
          points={gridPts(r)}
          fill="none"
          stroke="rgba(180,225,240,0.075)"
          strokeWidth="0.7"
        />
      ))}

      {axes.map((_, i) => {
        const [x, y] = pos(i, R);
        return (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke="rgba(180,225,240,0.07)"
            strokeWidth="0.7"
          />
        );
      })}

      {/* 出厂基线：虚线，永远不动 */}
      {baseVals && (
        <polygon
          points={poly(baseVals)}
          fill="rgba(230,242,251,0.03)"
          stroke="rgba(230,242,251,0.32)"
          strokeWidth="0.9"
          strokeDasharray="3 2.6"
          strokeLinejoin="round"
        />
      )}

      {/*
        生效值。

        **被判了日子的时候，只让「看起来还在不在」变。**
        数值一点不动 —— 性格是常年的东西。

        填充变淡 + 外框虚线 = 形状还在，但在褪色。
      */}
      <polygon
        points={poly(disp)}
        fill="url(#radar-fill)"
        stroke={color}
        strokeWidth="1.25"
        strokeOpacity={doomed ? 0.42 : 0.92}
        strokeDasharray={doomed ? "3 3" : undefined}
        strokeLinejoin="round"
        opacity={doomed ? 0.6 : 1}
      />

      {disp.map((v, i) => {
        const [x, y] = pos(i, (R * Math.max(5, v)) / 100);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="1.8"
            fill={color}
            style={{ filter: `drop-shadow(0 0 3px ${color})` }}
          />
        );
      })}

      {/* 轴端：基线 → 生效 的差值与连接线 */}
      {baseVals &&
        disp.map((v, i) => {
          const d = Math.round(v - (baseVals[i] ?? v));
          if (Math.abs(d) < 2) return null;
          const [bx, by] = pos(i, (R * Math.max(5, baseVals[i] ?? 0)) / 100);
          const [ex, ey] = pos(i, (R * Math.max(5, v)) / 100);
          const [lx, ly] = pos(i, R + 12);
          const c = Math.cos(((-90 + i * 60) * Math.PI) / 180);
          return (
            <g key={`d${i}`}>
              <line
                x1={bx}
                y1={by}
                x2={ex}
                y2={ey}
                stroke={d > 0 ? color : "#ff7a6b"}
                strokeWidth="0.8"
                strokeOpacity="0.5"
                strokeDasharray="1.5 1.5"
              />
              <text
                x={lx}
                y={ly - 11}
                textAnchor={c > 0.35 ? "start" : c < -0.35 ? "end" : "middle"}
                fontSize="6.5"
                fontFamily="var(--font-mono)"
                fill={d > 0 ? color : "#ff7a6b"}
                fillOpacity="0.95"
              >
                {d > 0 ? `+${d}` : d}
              </text>
            </g>
          );
        })}

      {axes.map((a, i) => {
        const [x, y] = pos(i, R + 15);
        const c = Math.cos(((-90 + i * 60) * Math.PI) / 180);
        const anchor = c > 0.35 ? "start" : c < -0.35 ? "end" : "middle";
        return (
          <g key={a.label}>
            <text
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize="7.5"
              fill="rgba(143,169,189,0.62)"
              fontFamily="var(--font-sans)"
            >
              {a.label}
            </text>
            <text
              x={x}
              y={y + 9}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize="7"
              fill={color}
              fillOpacity="0.8"
              fontFamily="var(--font-mono)"
            >
              {(() => {
                const v = Math.round(disp[i] ?? 0);
                /* 档位词比裸数字好读：「亲近 63」一眼懂，「63」要猜 */
                const band = axisBand(a.label as AxisName, v);
                return band ? `${band} ${v}` : v;
              })()}
            </text>
          </g>
        );
      })}

      {/* 中心呼吸点 —— 大小随心情，节奏也随心情。
          心情高：点大、跳得快；心情低：点小、跳得慢。
          这是「她此刻怎么样」唯一的动态可视化。 */}
      {(() => {
        const base = 1.2 + (mood / 100) * 2.4;          // 1.2 ~ 3.6
        const dur = 4.2 - (mood / 100) * 2.2;            // 4.2s（低落）~ 2.0s（雀跃）
        const breath = mood > 66 ? 1.5 : mood > 33 ? 1.2 : 0.9;
        return (
          <>
            {/* 外晕：心情越高越亮 */}
            <motion.circle
              cx={CX}
              cy={CY}
              fill={color}
              animate={{ r: [base * 2.2, base * 3.0, base * 2.2], opacity: [0.05, 0.12, 0.05] }}
              transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
            />
            {/* 主体 */}
            <motion.circle
              cx={CX}
              cy={CY}
              fill={color}
              animate={{ r: [base, base * breath, base], opacity: [0.75, 1, 0.75] }}
              transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
            />
          </>
        );
      })()}
    </svg>
  );
}
