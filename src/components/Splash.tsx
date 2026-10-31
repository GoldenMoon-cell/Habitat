import { motion } from "motion/react";

/**
 * 启动动画。
 *
 * 之前一打开就是摆好的四栏，没有任何「进入了某个地方」的感觉。
 * 这里给 1.2 秒：三条鲸影从水底浮上来 → 光晕炸开 → 淡出。
 *
 * 刻意做得短。启动动画超过 2 秒就从「仪式感」变成「拖慢你」。
 */
export default function Splash() {
  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center overflow-hidden"
      style={{ background: "#03070d" }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* 中心光晕 */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 420,
          height: 420,
          background:
            "radial-gradient(circle, rgba(53,240,206,0.16) 0%, rgba(78,140,255,0.06) 38%, transparent 68%)",
        }}
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1.35, 1], opacity: [0, 0.9, 0.5] }}
        transition={{ duration: 1.15, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* 三条鲸影：错开浮起，模拟深海里的三层深度 */}
      <div className="relative flex flex-col items-center">
        <div className="relative h-[74px] w-[120px]">
          {[
            { d: 0, x: -26, y: 6, s: 0.82, c: "#4e8cff", o: 0.55 },
            { d: 0.1, x: 0, y: 0, s: 1, c: "#35f0ce", o: 0.95 },
            { d: 0.2, x: 28, y: 8, s: 0.74, c: "#8b6bff", o: 0.5 },
          ].map((w, i) => (
            <motion.svg
              key={i}
              viewBox="0 0 64 40"
              className="absolute left-1/2 top-1/2"
              style={{
                width: 64 * w.s,
                height: 40 * w.s,
                marginLeft: -32 * w.s + w.x,
                marginTop: -20 * w.s + w.y,
                filter: `drop-shadow(0 0 10px ${w.c}${Math.round(w.o * 60).toString(16)})`,
              }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: w.o, y: 0 }}
              transition={{
                duration: 0.85,
                delay: 0.06 + w.d,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <path
                d="M4 22c8-9 20-12 28-7 7-8 19-9 28-3-6 2-9 6-9 10 0 3 2 6 6 8-9 4-21 2-28-5-8 6-19 5-25-3Z"
                fill={w.c}
              />
            </motion.svg>
          ))}
        </div>

        {/* 标题 */}
        <motion.div
          className="mt-3 flex items-baseline gap-2"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="text-[15px] tracking-[0.18em] text-ink/90">生境</span>
          <span className="font-mono text-[10.5px] tracking-[0.22em] text-biolum/55">
            HABITAT
          </span>
        </motion.div>

        <motion.div
          className="mt-1.5 font-mono text-[10px] tracking-[0.1em] text-mist/46"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.55 }}
        >
          Systemic Ecosystem for Agents
        </motion.div>

        {/* 底部一行状态 */}
        <motion.div
          className="mt-2 flex items-center gap-1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.8, 0.45] }}
          transition={{ duration: 1.1, delay: 0.45 }}
        >
          <motion.span
            className="h-[3px] w-[3px] rounded-full bg-biolum"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="font-mono text-[10px] tracking-[0.18em] text-mist/55">
            LOCAL STACK · 本地优先
          </span>
        </motion.div>
      </div>

      {/* 底部扫过的光带 */}
      <motion.div
        className="absolute left-0 right-0 h-[120px]"
        style={{
          background:
            "linear-gradient(180deg, transparent, rgba(53,240,206,0.05) 45%, transparent)",
        }}
        initial={{ y: "60vh", opacity: 0 }}
        animate={{ y: "-60vh", opacity: [0, 1, 0] }}
        transition={{ duration: 1.3, ease: "easeInOut" }}
      />
    </motion.div>
  );
}
