/**
 * 故障态占位卡 —— 两种视觉语言，用来对比。
 *
 * 这两个组件**不进主流程**：只有 URL 带 ?sim= 参数时才被 App 临时换上。
 * 所以正常使用时一行都不会跑。
 *
 *   ?sim=console-a   第 1 栏 → A（深海柔和）
 *   ?sim=console-b   第 1 栏 → B（重工业硬核）
 *   ?sim=stage-b     聊天区 → B 的横向断层
 */

const CORAL = "#ff7a6b";
const RED = "#ff3b30";

/* ═══════════════════════════════════════════════════════════
   A · 深海柔和
   红底斜纹 + 圆形警示图标 + 可读的中文错误 + 重试按钮
   ═══════════════════════════════════════════════════════════ */

export function DeadPanelA({
  name = "事件流",
  error = "TypeError: cannot read properties of undefined",
  onRetry,
}: {
  name?: string;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 px-4 py-6 text-center"
      style={{
        background:
          "repeating-linear-gradient(45deg, rgba(255,122,107,0.035) 0 8px, transparent 8px 16px)",
        borderRight: "1px solid rgba(255,122,107,0.16)",
      }}
    >
      <div
        className="grid h-7 w-7 place-items-center rounded-full text-[13px]"
        style={{
          border: `1px solid ${CORAL}66`,
          background: "rgba(255,122,107,0.08)",
          color: CORAL,
        }}
      >
        !
      </div>
      <div className="text-[11px]" style={{ color: `${CORAL}eb` }}>
        {name}模块离线
      </div>
      <div className="max-w-[190px] font-mono text-[10px] leading-[1.7] text-mist/58 [word-break:break-word]">
        {error}
      </div>
      <button
        onClick={onRetry}
        className="mt-0.5 rounded-[6px] px-3 py-[4px] text-[10.5px] transition-colors"
        style={{
          border: `1px solid ${CORAL}4d`,
          background: "rgba(255,122,107,0.1)",
          color: `${CORAL}e6`,
        }}
      >
        重新挂载
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   B · 重工业硬核
   像素马赛克塌陷 + 巨大 ACCESS DENIED 印章 + 机读错误码
   ═══════════════════════════════════════════════════════════ */

export function DeadPanelB({
  code = "ERR 0x8000FFFF",
  stamp = "ACCESS DENIED",
  onRetry,
}: {
  code?: string;
  stamp?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ background: "#0d0f11", borderRight: "1px solid rgba(255,59,48,0.22)" }}
    >
      {/* 像素棋盘：9px 网格，三帧错位闪烁 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(255,59,48,0.14) 50%, transparent 50%), linear-gradient(rgba(255,59,48,0.10) 50%, transparent 50%)",
          backgroundSize: "9px 9px",
          mixBlendMode: "screen",
          animation: "mosaicFlick 0.32s steps(2) infinite",
        }}
      />

      {/* 顶部机读条 */}
      <div
        className="relative z-10 flex items-center gap-2 px-2.5 py-1.5 font-mono text-[9.5px] tracking-[0.14em]"
        style={{ borderBottom: "1px solid rgba(255,59,48,0.2)", color: "rgba(255,59,48,0.75)" }}
      >
        <span
          className="inline-block h-[4px] w-[4px] rounded-full"
          style={{ background: RED, boxShadow: `0 0 8px ${RED}`, animation: "mossBlink 1.1s steps(1) infinite" }}
        />
        RESCAN
        <span className="ml-auto opacity-60">{code}</span>
      </div>

      {/* 塌陷的假内容 */}
      <div className="relative z-10 flex-1 space-y-1.5 px-2.5 pt-2.5">
        {[85, 70, 92, 60, 78].map((w, i) => (
          <div
            key={i}
            className="h-[5px] rounded-[1px]"
            style={{
              width: `${w}%`,
              background: "rgba(200,210,220,0.055)",
              filter: "blur(0.5px)",
            }}
          />
        ))}
      </div>

      {/* 巨大印章 */}
      <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
        <span
          className="font-mono text-[13px] tracking-[0.28em]"
          style={{
            color: "rgba(255,59,48,0.85)",
            border: "2px solid rgba(255,59,48,0.55)",
            padding: "6px 12px 6px 15px",
            transform: "rotate(-7deg)",
            background: "rgba(8,9,10,0.5)",
            textShadow: `0 0 20px ${RED}8c`,
            animation: "stampSlam 0.34s cubic-bezier(0.2,0,0,1)",
          }}
        >
          {stamp}
        </span>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded-[3px] px-2 py-[3px] font-mono text-[9.5px] tracking-[0.14em] transition-colors"
          style={{
            border: "1px solid rgba(255,59,48,0.4)",
            color: "rgba(255,59,48,0.9)",
            background: "rgba(255,59,48,0.1)",
          }}
        >
          RETRY
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   B · 横向断层（用在聊天正文）
   同一段文字渲染两次，上半 / 下半用 clip-path 切开后错位
   ═══════════════════════════════════════════════════════════ */

export function TearTextB() {
  const top = "我注意到这句话里的分寸。澜汐在给自己划边界，不是因为被要求，";
  const bottom = "我注意到这句话里的分寸。澜汐在给自己";

  return (
    <div
      className="relative my-1 rounded-[4px] px-3 py-2.5"
      style={{ border: "1px solid rgba(255,59,48,0.24)", background: "rgba(13,15,17,0.8)" }}
    >
      <div
        className="font-mono text-[11.5px] leading-[1.9]"
        style={{ color: "rgba(200,210,220,0.72)", clipPath: "inset(0 0 52% 0)" }}
      >
        {top}
      </div>
      <div
        className="font-mono text-[11.5px] leading-[1.9]"
        style={{
          color: "rgba(200,210,220,0.32)",
          clipPath: "inset(48% 0 0 0)",
          transform: "translateX(11px)",
          marginTop: -21,
        }}
      >
        {bottom}
        <span
          className="mx-[2px] inline-block px-[3px] text-[10px] tracking-[0.1em]"
          style={{
            color: RED,
            background: "rgba(255,59,48,0.1)",
            animation: "hexBlink 0.9s steps(1) infinite",
          }}
        >
          0x8000FFFF
        </span>
        划边界，不是因为被要求，
      </div>

      <div
        className="mt-2 flex gap-3 font-mono text-[9.5px] tracking-[0.1em]"
        style={{ color: "rgba(61,67,72,1)" }}
      >
        <span>
          ADDR <span style={{ color: RED }}>0x7FF8A0C2</span>
        </span>
        <span>
          FRAME <span style={{ color: "#6b7378" }}>#2214</span>
        </span>
        <span>
          RECOVERY <span style={{ color: "#e8a33d" }}>PENDING</span>
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CrashProbe：渲染期主动抛错。
   用来验证 PanelBoundary 真的能拦住异常 —— 不是「替换成占位卡」
   那种假演示，是真的让 React 抛、由边界捕获。
   ═══════════════════════════════════════════════════════════ */

export function CrashProbe(): never {
  throw new Error("演示：模拟渲染期异常（?sim=crash）");
}