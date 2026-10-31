import { useEffect, useMemo, useRef } from "react";

/**
 * 区块崩溃形态。
 *
 * 12 种 kind，每种对应一个有语义的「坏法」：
 *   状态标签（SEALED / INPUT LOCKED / SEGFAULT…）是固定枚举，
 *   但涉及用户数据的地方（角色名 / 群名 / 命令 / 消息）必须用真实值。
 *
 * 这些组件只在 BlockBoundary 捕获到异常时渲染，正常路径一行都不跑。
 */

export type CrashKind =
  | "ident"
  | "api"
  | "freeze"
  | "tomb"
  | "lost"
  | "void"
  | "inputlock"
  | "sealed"
  | "strike"
  | "radar"
  | "sparkline"
  | "tear";

export interface CrashData {
  /** CORE：真实的角色名 */
  names?: string[];
  /** GROUPS：真实的群名 */
  groupName?: string;
  /** QUICK COMMANDS：真实的命令 */
  commands?: { label: string; value: string }[];
  /** MESSAGES：真实的消息文本 */
  messages?: string[];
  /** API LINKS：真实的接口名 */
  endpoints?: string[];
}

/* ═══════════════════════════════════════════════════════════
   canvas：45° 警示斜纹，整体向右平移
   CSS 的 repeating-linear-gradient 是无缝周期图案，
   任何整数周期位移后与自身完全重合 —— 肉眼看不出移动。
   canvas 逐条画线、左右动态补线，所以能无限平移。
   ═══════════════════════════════════════════════════════════ */

function useStripe(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const cv = document.createElement("canvas");
    cv.className = "cb-stripe";
    el.insertBefore(cv, el.firstChild);
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const GAP = 12.73;
    const SPEED = 0.72;
    let raf = 0;

    const draw = (now: number) => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w && h) {
        const dpr = window.devicePixelRatio || 1;
        const pw = Math.round(w * dpr);
        const ph = Math.round(h * dpr);
        if (cv.width !== pw || cv.height !== ph) {
          cv.width = pw;
          cv.height = ph;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(255,122,107,0.058)";
        ctx.lineWidth = 3;
        const off = ((now * SPEED) / 16.67) % GAP;
        for (let x = -h + off - GAP; x < w + h; x += GAP) {
          ctx.beginPath();
          ctx.moveTo(x, h);
          ctx.lineTo(x + h, 0);
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      cv.remove();
    };
  }, [ref]);
}

/* ═══════════════════════════════════════════════════════════
   ECG：心动周期 → 室颤 → 一条直线
   ═══════════════════════════════════════════════════════════ */

function EcgCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let phase = 0;
    let deadProg = 0;

    const wave = (p: number) => {
      if (p < 0.1) return -0.1 * Math.sin((p / 0.1) * Math.PI);
      if (p < 0.15) return 0;
      if (p < 0.18) return 0.12 * Math.sin(((p - 0.15) / 0.03) * Math.PI);
      if (p < 0.23) return -1.0 * Math.sin(((p - 0.18) / 0.05) * Math.PI);
      if (p < 0.27) return 0.4 * Math.sin(((p - 0.23) / 0.04) * Math.PI);
      if (p < 0.4) return 0;
      if (p < 0.58) return 0.28 * Math.sin(((p - 0.4) / 0.18) * Math.PI);
      return 0;
    };

    const draw = () => {
      const rect = cv.parentElement?.getBoundingClientRect();
      const w = Math.round(rect?.width ?? 0);
      const h = Math.round(rect?.height ?? 0);

      if (w && h) {
        const dpr = window.devicePixelRatio || 1;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const mid = h / 2;
        const amp = h * 0.34;

        phase += 0.0032;
        deadProg = Math.min(1, deadProg + 0.011);

        const jitter =
          deadProg > 0.15 && deadProg < 0.55
            ? (Math.random() - 0.5) * 0.55 * (1 - Math.abs(deadProg - 0.35) / 0.2)
            : 0;

        ctx.beginPath();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = `rgba(255,122,107,${0.35 + 0.5 * deadProg})`;

        for (let x = 0; x <= w; x += 1.5) {
          const p = ((x / w) / 0.85 + phase) % 1;
          let v = wave(p) * (1 - deadProg * 0.94) + jitter;
          if (deadProg >= 1) v = (Math.random() - 0.5) * 0.04;
          const y = mid - v * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        if (deadProg >= 1) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,122,107,0.75)";
          ctx.lineWidth = 1.4;
          ctx.moveTo(0, mid);
          ctx.lineTo(w, mid);
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="cb-ecg" />;
}

/* ═══════════════════════════════════════════════════════════
   工具：腐蚀文本 —— 把一部分字符换成实心块
   用 █ 而不是 ?，因为 █ 说的是「原本有字，坏了」，
   ? 说的是「我不知道这里有什么」。
   ═══════════════════════════════════════════════════════════ */

function corrode(s: string, ratio = 0.45): string {
  const chars = Array.from(s);
  const target = Math.max(1, Math.round(chars.length * ratio));
  let done = 0;
  const used = new Set<number>();
  for (let guard = 0; guard < target * 6 && done < target; guard++) {
    const i = Math.floor(Math.random() * chars.length);
    if (used.has(i) || chars[i] === " " || chars[i] === "█") continue;
    used.add(i);
    chars[i] = "█";
    done++;
  }
  return chars.join("");
}

const HEX = ["0x8000FFFF", "ERR_CTX", "0xDEADBEEF", "NULL_REF"];

function corruptInline(s: string, pos: number): React.ReactNode {
  const i = Math.max(2, Math.min(s.length - 4, Math.floor(s.length * pos)));
  const hex = HEX[Math.floor(Math.random() * HEX.length)];
  return (
    <>
      {s.slice(0, i)}
      <span className="cb-hex">{hex}</span>
      {s.slice(i + 3)}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════ */

export default function CrashBlock({
  kind,
  name,
  data = {},
  onRetry,
}: {
  kind: CrashKind;
  name: string;
  data?: CrashData;
  onRetry?: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);

  /* 除 sparkline（自带 ECG 画布）外都用警示斜纹 */
  useStripe(kind === "sparkline" ? { current: null } : host);

  /* 腐蚀结果要稳定，否则每次 render 都在变 */
  const corruptedNames = useMemo(
    () => (data.names ?? []).map((n) => corrode(n, 0.5)),
    [data.names]
  );
  const corruptedGroup = useMemo(
    () => (data.groupName ? corrode(data.groupName, 0.35) : "GROUP"),
    [data.groupName]
  );
  const tearPairs = useMemo(
    () =>
      (data.messages ?? []).slice(0, 2).map((m, i) => ({
        up: m,
        dn: corruptInline(m, 0.35 + i * 0.15),
      })),
    [data.messages]
  );

  const retry = onRetry ? (
    <span className="cb-retry" onClick={onRetry}>
      重试
    </span>
  ) : null;

  const body = (() => {
    switch (kind) {
      case "ident":
        return (
          <div className="cb cb-ident" ref={host}>
            <div className="cb-corrupt">
              {name.replace(/[AEIOaeio]/g, (c) =>
                ({ a: "4", e: "3", i: "1", o: "0", A: "4", E: "3", I: "1", O: "0" } as Record<string, string>)[c] ?? c
              )}
            </div>
            <div className="cb-sub">IDENTITY CORRUPT · {retry}</div>
          </div>
        );

      case "api":
        return (
          <div className="cb cb-api" ref={host}>
            {(data.endpoints ?? ["dsH", "astrbot", "google", "anthropic"]).slice(0, 4).map((e, i, arr) => (
              <div className="cb-ar" key={e + i}>
                <span className="cb-nm">{e}</span>
                <span className="cb-st">— —</span>
                {i === arr.length - 1 && retry}
              </div>
            ))}
          </div>
        );

      case "freeze":
        return (
          <div className="cb cb-freeze" ref={host}>
            <div className="cb-noise">░▒░ ▓░ ░▒░ ▒░ ░ ░▒ ▓░▒ ░ ░▒░ ▒░ ░ ░▒░ ▓░ ░▒░</div>
            <div className="cb-noise">░ ░▒░ ▓░ ░▒░ ░ ░▒░ ▓░ ░ ░▒ ▒░ ░▒░ ▓░ ░▒░ ░ ░▒░ ▓░</div>
            <div className="cb-halt">
              <span className="cb-cur" />
              SEGFAULT · {retry}
            </div>
          </div>
        );

      case "tomb":
        return (
          <div className="cb cb-tomb" ref={host}>
            <div className="cb-box">✕ {corruptedGroup} [ EMPTY ]</div>
            {retry}
          </div>
        );

      case "lost":
        return (
          <div className="cb cb-lost" ref={host}>
            {(corruptedNames.length ? corruptedNames : ["█████", "███", "████"]).map((n, i, arr) => (
              <div className="cb-lr" key={i}>
                <span className="cb-av">×</span>
                <span className="cb-q">{n}</span>
                {i === arr.length - 1 && <span style={{ marginLeft: "auto" }}>{retry}</span>}
              </div>
            ))}
          </div>
        );

      case "void":
        return (
          <div className="cb cb-void" ref={host}>
            <div className="cb-bar" />
            <div className="cb-tag">SESSION VOID · {retry}</div>
          </div>
        );

      case "inputlock":
        return (
          <div className="cb cb-inputlock" ref={host}>
            <span className="cb-lock">▧</span>INPUT LOCKED
            <span style={{ marginLeft: "auto" }}>{retry}</span>
          </div>
        );

      case "sealed":
        return (
          <div className="cb cb-sealed" ref={host}>
            <div className="cb-cd">[ SEALED ]</div>
            <div className="cb-cd">[ SEALED ]</div>
            <div className="cb-cd">[ SEALED ]</div>
          </div>
        );

      case "strike": {
        const cmds = data.commands?.length ? data.commands : [{ label: "NO COMMANDS", value: "" }];
        return (
          <div className="cb cb-strike" ref={host}>
            {cmds.map((c, i) => (
              <div className="cb-sr" key={c.label + i}>
                <span>{c.label}</span>
                <span className="cb-v">{c.value}</span>
                {i === cmds.length - 1 && <span style={{ marginLeft: 6 }}>{retry}</span>}
              </div>
            ))}
          </div>
        );
      }

      case "radar":
        return (
          <div className="cb cb-radar" ref={host}>
            <svg className="cb-poly" viewBox="0 0 100 100">
              <polygon points="50,10 85,33 78,75 50,92 22,75 15,33" />
            </svg>
            <div className="cb-flat" />
            <div className="cb-axes">
              <span className="a1">共鸣 0</span>
              <span className="a2">张力 0</span>
              <span className="a3">玩心 0</span>
              <span className="a4">信任 0</span>
              <span className="a5">专注 0</span>
              <span className="a6">亲密 0</span>
            </div>
          </div>
        );

      case "sparkline":
        return (
          <div className="cb cb-spark">
            <EcgCanvas />
            <div className="cb-lbl">
              <span className="cb-d" />
              METRIC STREAM LOST
              <span style={{ marginLeft: "auto" }}>{retry}</span>
            </div>
          </div>
        );

      case "tear":
        return (
          <div className="cb cb-tear" ref={host}>
            {(tearPairs.length ? tearPairs : [{ up: "（没有可显示的消息）", dn: null }]).map((p, i) => (
              <div className="cb-seg" key={i}>
                <div className="cb-up">{p.up}</div>
                {p.dn && <div className="cb-dn">{p.dn}</div>}
              </div>
            ))}
            <div className="cb-meta">
              <span>
                ADDR <b>0x7FF8A0C2</b>
              </span>
              <span>
                FRAME <b>#2214</b>
              </span>
              <span style={{ marginLeft: "auto" }}>{retry}</span>
            </div>
          </div>
        );
    }
  })();

  return body;
}
