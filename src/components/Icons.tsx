import type { JSX } from "react";

/**
 * 手绘图标集。统一 24 网格、1.6 描边、圆角端点。
 * 刻意不使用通用图标库：这套深海视觉需要统一的光学重量。
 */

type P = { className?: string; size?: number };

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

/**
 * 生境标记。
 *
 * 三层同心，外层留一道缺口：
 *   外环 = 环境边界（还在长，所以不闭合）
 *   内环 = 生态的内部结构
 *   实心点 = 被包在里面的那个生命
 *
 * 为什么不用任何具体生物：
 *   软件里住的不只有 DeepSeek。挂一条鲸鱼等于告诉别人
 *   「这是给鲸鱼做的，Claude 和 GPT 是客人」。这个符号不指任何住客。
 *
 * 24 网格 / 1.6 描边，和其余图标同一套光学重量。
 */
export const IconSessions = ({ className, size = 20 }: P) => (
  <svg {...base(size)} className={className}>
    <circle
      cx="12"
      cy="12"
      r="8.6"
      strokeDasharray="41 13"
      strokeDashoffset="9"
      opacity="0.5"
    />
    <circle cx="12" cy="12" r="4.2" opacity="0.72" />
    <circle cx="12" cy="12" r="1.55" fill="currentColor" stroke="none" />
  </svg>
);

export const IconTail = ({ className, size = 20 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 15c3.6 0 6.2-2.3 6.2-5.6 0-1.4-.5-2.4-.5-2.4s2.5 1.1 4.2 3.3c1.2 1.6 1.7 3.2 1.7 3.2S16.4 11 18.6 9.7c1.5-.9 2.6-.9 2.6-.9s-1.7 1.5-2.2 3.4c-.4 1.7.3 3.2.3 3.2s-2.1-.5-3.6.4C13.9 17 12.6 19 9.6 19 6.3 19 3 16.9 3 15Z" />
  </svg>
);

export const IconFish = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3.5 12c2.2-3.4 5-5.2 8.4-5.2 3.6 0 6.4 2.2 8.6 5.2-2.2 3-5 5.2-8.6 5.2-3.4 0-6.2-1.8-8.4-5.2Z" />
    <path d="M17.6 9.4 21 6.8v10.4l-3.4-2.6" />
    <circle cx="8.4" cy="11" r=".9" fill="currentColor" stroke="none" />
  </svg>
);

export const IconTerminal = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M7 9.8l2.6 2.2L7 14.2M12.4 14.6h4.2" />
  </svg>
);

export const IconCards = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.4" y="6.6" width="9.2" height="13" rx="2" transform="rotate(-9 3.4 6.6)" />
    <rect x="10.6" y="4.4" width="9.2" height="13" rx="2" />
    <path d="M15.2 8v5.6M13 10.8h4.4" />
  </svg>
);

export const IconSpeaker = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
    <path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
  </svg>
);

export const IconBroom = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 4.2 9.8 9M11.6 6.9l4.8 4.8M6.4 19.6c1.6-2.6 2.4-4.6 2.4-6.4l3.6 1.6c.6 1.4-.2 3.2-2 5.4-1.2 1.4-3 1.6-3.4.6-.2-.5-.3-.9-.6-1.2Z" />
  </svg>
);

export const IconSmile = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M8.6 14.2c.9 1.3 2 2 3.4 2s2.5-.7 3.4-2" />
    <path d="M9.2 9.8h.01M14.8 9.8h.01" strokeWidth={2.2} />
  </svg>
);

export const IconClip = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12.8 6.4 7.2 12a3.1 3.1 0 0 0 4.4 4.4l6.2-6.2a5 5 0 0 0-7-7l-6 6a7 7 0 0 0 9.9 9.9l3.6-3.6" />
  </svg>
);

export const IconMic = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9.2" y="3" width="5.6" height="10" rx="2.8" />
    <path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0M12 17.8V21" />
  </svg>
);

export const IconSend = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.2 11.6 20 4.4l-3.4 15.4-4.6-5.4-2.8 3.2-.6-4.2Z" />
  </svg>
);

export const IconSearch = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="10.8" cy="10.8" r="6.4" />
    <path d="M15.6 15.6 20.4 20.4" />
  </svg>
);

export const IconPin = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14.4 3.6 20.4 9.6l-2.6 1.4-4.6 4.6-1.4 2.6-6-6 2.6-1.4L13 6.2l1.4-2.6Z" />
    <path d="M9.4 14.6 4 20" />
  </svg>
);

export const IconSliders = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="10" cy="16" r="2" />
  </svg>
);

export const IconChip = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2" />
    <path d="M9.6 3.4v2.2M14.4 3.4v2.2M9.6 18.4v2.2M14.4 18.4v2.2M3.4 9.6h2.2M3.4 14.4h2.2M18.4 9.6h2.2M18.4 14.4h2.2" />
  </svg>
);

export const IconWave = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12c1.4 0 2.4-3.4 3.8-3.4S8.6 15 10 15s2-8 3.4-8 2.2 10 3.6 10 2-5 4-5" />
  </svg>
);

export const IconPlay = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8.4 5.6 18 12l-9.6 6.4V5.6Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="7.6" y="6" width="3" height="12" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.4" y="6" width="3" height="12" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconChevron = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconPlus = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconFile = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M13.4 3.4H7a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.6-5.6Z" />
    <path d="M13.2 3.6V9H19" />
  </svg>
);

export const IconArrow = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h13M12.5 6l6 6-6 6" />
  </svg>
);

export const IconMoon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 14.4A8.2 8.2 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z" />
  </svg>
);

export const IconCheck = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.6 12.6l4.8 4.8L19.4 7" />
  </svg>
);

export const IconX = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" />
  </svg>
);

export const IconSpark = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.6l1.7 4.9 4.9 1.7-4.9 1.7L12 16.8l-1.7-4.9L5.4 10.2l4.9-1.7Z" />
    <path d="M18.4 16.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z" />
  </svg>
);

export const ICONS: Record<string, (p: P) => JSX.Element> = {
  fish: IconFish,
  log: IconTerminal,
  cards: IconCards,
  speaker: IconSpeaker,
  broom: IconBroom,
};

/** 复制：两片叠起来的纸 */
export const IconCopy = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2.2" />
    <path d="M15 5.6A1.6 1.6 0 0 0 13.4 4H5.6A1.6 1.6 0 0 0 4 5.6v7.8A1.6 1.6 0 0 0 5.6 15" />
  </svg>
);

/** 引用：一段被括起来的引文 */
export const IconQuote = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 6.5H5.2A1.2 1.2 0 0 0 4 7.7v4.3a1.2 1.2 0 0 0 1.2 1.2h3.1V15c0 1.6-1.1 2.4-2.6 2.6" />
    <path d="M19.5 6.5h-4.3A1.2 1.2 0 0 0 14 7.7v4.3a1.2 1.2 0 0 0 1.2 1.2h3.1V15c0 1.6-1.1 2.4-2.6 2.6" />
  </svg>
);

/** 编辑：一支斜放的笔 */
export const IconPencil = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4.2L19 9.2a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8V20Z" />
    <path d="M14.2 6.6 17.4 9.8" />
  </svg>
);

/** 撤回：一个回头箭头 */
export const IconUndo = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9.5h9.5a5.5 5.5 0 0 1 0 11H9" />
    <path d="M7.5 5.5 4 9.5l3.5 4" />
  </svg>
);

/** 删除：垃圾桶 */
export const IconTrash = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6.5h16" />
    <path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.2 6.5 7 19.2A1.6 1.6 0 0 0 8.6 20.6h6.8a1.6 1.6 0 0 0 1.6-1.4l.8-12.7" />
    <path d="M10.2 10.5v6M13.8 10.5v6" />
  </svg>
);
