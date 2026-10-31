/**
 * 音效。
 *
 * ── 全部合成，零素材 ──
 *
 * 没有 mp3/ogg。所有声音现场用 Web Audio 算 —— 零体积、零加载、零版权。
 *
 * ── 频率纪律（第一版踩过的坑）──
 *
 * **第一版最低到 22Hz，听感是「耳膜被气压推」，不是声音。**
 *
 * 原因：20-40Hz 属于次低频。多数笔记本扬声器放不出来，
 * 放得出来的耳机上它就是一团压力，连续几秒会耳鸣。
 *
 * 现在的硬规则：
 *   · **最低 82Hz**（再低就只是压，不是听）
 *   · **主频带 200 - 2200Hz**（人耳最舒服的区间）
 *   · 「沉重」靠**混响尾巴和不协和音程**做，不靠往下压
 *
 * ── 神圣感从哪来 ──
 *
 * ① **升调** —— 音高一路往上 = 听觉上的「升起」
 * ② **和声叠加** —— 单音 → 五度 → 八度 → 三度，越来越饱满
 * ③ **混响** —— 干声是「机器」，有混响才是「殿堂」
 *
 * ── 浏览器限制 ──
 *
 * AudioContext 必须在用户手势之后才能出声 —— 除非 Electron 开了
 * `autoplay-policy=no-user-gesture-required`（已经在 main.cjs 里开了）。
 */

const MUTE_KEY = "3w:muted";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean) {
  try {
    if (m) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* 存不进就只在本次生效 */
  }
}

/* ───────────────── 积木 ───────────────── */

/** 一个带包络的振荡器。`dest` 不给就直接到 destination。 */
function tone(
  ac: AudioContext,
  opts: {
    freq: number;
    /** 终止频率 */
    to?: number;
    type?: OscillatorType;
    gain?: number;
    attack?: number;
    decay?: number;
    delay?: number;
    dest?: AudioNode;
  }
): void {
  const {
    freq,
    to,
    type = "sine",
    gain = 0.1,
    attack = 0.01,
    decay = 0.2,
    delay = 0,
    dest,
  } = opts;

  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + attack + decay);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);

  osc.connect(g).connect(dest ?? ac.destination);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.05);
}

/** 一段低通过滤的噪声 —— 气流 / 摩擦 */
function noise(
  ac: AudioContext,
  opts: {
    dur: number;
    gain?: number;
    cutoff?: number;
    delay?: number;
    dest?: AudioNode;
    fade?: boolean;
  }
): void {
  const { dur, gain = 0.05, cutoff = 1200, delay = 0, dest, fade = true } = opts;
  const t0 = ac.currentTime + delay;
  const len = Math.floor(ac.sampleRate * dur);
  if (len <= 0) return;

  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * (fade ? 1 - i / len : 1);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;

  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;

  const g = ac.createGain();
  g.gain.value = gain;

  src.connect(lp).connect(g).connect(dest ?? ac.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

/**
 * 卷积混响。
 *
 * 脉冲响应用「噪声 × 指数衰减」现场生成 —— 不需要音频文件。
 * 这是把「机器」变成「空间」的那一步：同一个音，干声是蜂鸣器，
 * 过一遍混响就成了殿堂。
 */
function reverbBus(ac: AudioContext, seconds = 2.2, decay = 2.4, wet = 0.34): AudioNode {
  const rate = ac.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      /* 前 8% 留一点空隙，尾巴更自然 */
      const p = i / len;
      const env = p < 0.08 ? p / 0.08 : Math.pow(1 - p, decay);
      d[i] = (Math.random() * 2 - 1) * env;
    }
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;

  const dry = ac.createGain();
  dry.gain.value = 1;
  const wetGain = ac.createGain();
  wetGain.gain.value = wet;

  const input = ac.createGain();
  input.connect(dry).connect(ac.destination);
  input.connect(conv).connect(wetGain).connect(ac.destination);

  return input;
}

/* ───────────────── 具体的声音 ───────────────── */

/**
 * 根系生长 —— 启动动画第一段（0 - 3.2s）。
 *
 * ── 意象 ──
 *
 * **不是「根扎进土里」，是「破土而出」。**
 *
 * 第一版做成 22-38Hz 的低频，听感是耳膜被压 —— 那是「地下」的方向。
 * 这里反过来：从 C4 一路往上升到 G5，音高就是「升」。
 *
 * ── 结构 ──
 *
 *   0.0s  C4  262Hz   一个音，很轻
 *   0.4s  G4  392Hz   + 五度
 *   0.9s  C5  523Hz   + 八度
 *   1.4s  E5  659Hz   + 大三度
 *   2.0s  G5  784Hz   + 再一个五度
 *   2.55s C6 1046Hz   汇聚那一下
 *   3.2s  收尾
 *
 * 全正弦波（纯净），全部过混响（殿堂感）。
 */
export function playRoots(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;

  const bus = reverbBus(ac, 2.6, 2.0, 0.42);

  /*
   * 逐音递增的 gain —— 越高的音越响，这样「升上去」是真的在升。
   *
   * 第一版总和 0.305（-10.1 dBFS），比「tick」响 24 dB，
   * 听它之前耳朵调好了，之后点 tick 什么都听不见。
   * 现在 ×0.63 → 总和 0.193（-14.3 dBFS）。
   */
  const notes: [number, number, number][] = [
    [0.0, 262, 0.032], // C4
    [0.4, 392, 0.035], // G4
    [0.9, 523, 0.038], // C5
    [1.4, 659, 0.041], // E5
    [2.0, 784, 0.047], // G5
  ];

  for (const [at, freq, gain] of notes) {
    /* 主音 —— 长起音，像「浮上来」而不是「敲下去」 */
    tone(ac, {
      freq,
      type: "sine",
      gain,
      attack: 0.42,
      decay: 2.6,
      delay: at,
      dest: bus,
    });
    /*
     * 低八度陪音 —— 只给一点点厚度。
     *
     * 原来是 0.32，频谱上 131Hz 那条线比主音还宽，
     * 五个音各带一层低频，堆起来把「升上去」的明亮感全拽下去了。
     *
     * 0.14 足够听出「厚」，但不会闷。
     */
    tone(ac, {
      freq: freq / 2,
      type: "sine",
      gain: gain * 0.14,
      attack: 0.5,
      decay: 2.4,
      delay: at,
      dest: bus,
    });
  }

  /* 一层极轻的高频「空气」—— 让整体不至于太闷 */
  noise(ac, { dur: 3.2, gain: 0.012, cutoff: 4200, dest: bus });

  /*
   * 收尾：G5（784）的高八度，和它同时起、同时衰。
   *
   * 原来这里是一个独立的 C6（1046Hz），delay 2.55s —— 频谱上它是
   * 一条突然出现的平直横线，和前面那条连续上升的曲线不连。
   * 听起来像有人另按了一下琴键。
   *
   * 改成 G5 的高八度（1568Hz），起音和衰减都跟 G5 对齐 ——
   * 它是那个音的一部分，不是一个新事件。
   */
  tone(ac, {
    freq: 1568,
    type: "sine",
    gain: 0.02,
    attack: 0.42,
    decay: 2.6,
    delay: 2.0,
    dest: bus,
  });
}

/**
 * 启动完成 —— 3.2s 之后那一声。
 *
 * 第一版是 32→58Hz 的次低频，听不见只感到压。
 * 现在换成中高频的一个短和弦：C5 + G5 + C6，过混响。
 *
 * 作用是**给「长完了」这件事画一个句号**，不是再强调一次沉重。
 */
export function playBoot(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;

  const bus = reverbBus(ac, 2.4, 2.2, 0.36);

  for (const [freq, gain] of [
    [523, 0.07],
    [784, 0.045],
    [1046, 0.03],
  ] as [number, number][]) {
    tone(ac, { freq, type: "sine", gain, attack: 0.014, decay: 1.3, dest: bus });
  }
}

/**
 * 进入造物主 —— 降调，但不下到次低频。
 *
 * 第一版 220→90，90Hz 已经要开始「推」了。
 * 现在 330→165：**方向还是往下**（进造物主是「下去」），
 * 但全程在可听区间里。
 */
export function playEnterCreator(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;

  const bus = reverbBus(ac, 1.8, 2.6, 0.3);

  tone(ac, { freq: 330, to: 165, type: "sine", gain: 0.14, attack: 0.02, decay: 0.85, dest: bus });
  tone(ac, { freq: 331.5, to: 166, type: "sine", gain: 0.075, attack: 0.02, decay: 0.85, dest: bus });
  noise(ac, { dur: 0.85, gain: 0.035, cutoff: 900, dest: bus });
}

/** 回到推演 —— 升调，轻。 */
export function playLeaveCreator(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;

  const bus = reverbBus(ac, 1.4, 2.4, 0.26);

  tone(ac, { freq: 196, to: 392, type: "sine", gain: 0.11, attack: 0.015, decay: 0.5, dest: bus });
  tone(ac, { freq: 294, to: 588, type: "sine", gain: 0.05, attack: 0.015, decay: 0.42, delay: 0.06, dest: bus });
}

/**
 * 覆写 / 强制改名 —— 全软件最重的一个音。
 *
 * ── 第一版的问题 ──
 *
 * 主频 40Hz。那是次低频，听感是**耳膜被推**，连续 2.6 秒会耳鸣。
 *
 * ── 现在怎么做「重」而不靠压 ──
 *
 * ① **两个频率只差 0.7Hz** → 拍频 → 听起来「不干净」→ 像机器
 * ② **减五度**（82Hz + 123Hz）→ 听觉上就是不协和、不安
 * ③ **混响尾巴 3.4 秒** → 沉重感来自「它不肯结束」，不是来自低频
 * ④ **整体频率下滑 10%** → 像一台大机器停了下来
 *
 * 最低 82Hz —— 可听，但有底。
 */
export function playRumble(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;

  const bus = reverbBus(ac, 3.4, 1.8, 0.44);
  const t0 = ac.currentTime;

  /*
   * 拍频差从 0.7Hz 改成 6Hz。
   *
   * 0.7Hz 的差 → 每 1.43 秒一次完整的起伏 → 听起来像【呼吸】。
   * 从频谱上看得一清二楚：波形是五个大鼓包，不是持续的压迫。
   *
   * 6Hz 的差 → 每秒六次颤动 → 才是机器在转。
   */
  const voices: [number, OscillatorType, number][] = [
    [82, "sine", 0.34],
    [88, "sine", 0.2], // 差 6Hz，拍频像机器而不是呼吸
    [123, "sine", 0.16], // 减五度，不协和
    [164, "triangle", 0.07], // 一点金属味
  ];

  for (const [freq, type, gain] of voices) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.linearRampToValueAtTime(freq * 0.9, t0 + 2.8);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.22);
    g.gain.linearRampToValueAtTime(gain * 0.55, t0 + 2.4);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 3.3);

    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + 3.4);
  }

  /* 一层中频噪声 —— 气流 / 摩擦，不是低频轰鸣 */
  noise(ac, { dur: 3.0, gain: 0.03, cutoff: 700, dest: bus });
}

/** 极轻的「嗒」—— 按钮、开关、打对名字。 */
export function playTick(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  /*
   * 0.055 而不是 0.02。
   *
   * 这个是判决书里「打对名字」唯一的落地声 —— 0.02 是 -34 dBFS，
   * 比背景噪声还低，等于没有。
   */
  tone(ac, { freq: 2200, to: 1320, type: "square", gain: 0.055, attack: 0.002, decay: 0.055 });
}

/**
 * 发出消息。
 *
 * 第一版是「一口气」—— 一段噪声。听感像有人在吹麦克风，
 * 和「消息飞出去」这件事没关系。
 *
 * 现在是一个**极短的上行滑音**：880 → 1320，0.09 秒。
 * 上行 = 离开你、往外去。短 = 不占地方（你一晚上要发很多条）。
 */
export function playSend(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 880, to: 1320, type: "sine", gain: 0.03, attack: 0.004, decay: 0.085 });
  /* 一个高八度的陪音，让「嗖」更清脆一点 */
  tone(ac, { freq: 1760, to: 2640, type: "sine", gain: 0.012, attack: 0.003, decay: 0.06 });
}

/** 收到消息 —— 柔和的低 ping。 */
/**
 * 收到回复。
 *
 * `pitch` 是频率乘数 —— 群聊里按角色算一个**稳定的**偏移，
 * 这样同一个角色永远是同一个音高，用户能「听出是谁在说话」。
 *
 * 五档：0.92 / 0.96 / 1.00 / 1.04 / 1.08。
 * 每档差 4% —— 听得出区别，但不会像变声器。
 */
export function playReceive(pitch = 1): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  const bus = reverbBus(ac, 1.2, 2.6, 0.2);
  /* pitch 乘在频率上 —— 同一个角色永远同一个音高 */
  tone(ac, { freq: 660 * pitch, type: "sine", gain: 0.058, attack: 0.008, decay: 0.42, dest: bus });
  tone(ac, { freq: 990 * pitch, type: "sine", gain: 0.02, attack: 0.008, decay: 0.28, delay: 0.02, dest: bus });
}

/**
 * 切换会话。
 *
 * 第一版用了噪声 —— 听感像什么东西在地上拖。
 * 现在去掉噪声，只留一个**灵动的上滑**：698 → 1046，0.13 秒。
 *
 * 两个音前后错开 40ms，形成一点「跳」的感觉，
 * 不是「滑过去」，是「跳过去」。
 */
export function playSwitch(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  const bus = reverbBus(ac, 0.9, 3.0, 0.16);
  tone(ac, { freq: 698, to: 1046, type: "sine", gain: 0.032, attack: 0.004, decay: 0.11, dest: bus });
  tone(ac, { freq: 1046, to: 1568, type: "sine", gain: 0.016, attack: 0.003, decay: 0.09, delay: 0.04, dest: bus });
}

/* ─────────── 控制台：系统层的入口 ─────────── */

/**
 * 打开控制台。
 *
 * **不是「打开一个面板」，是「接通一条线路」。**
 *
 * 控制台是这个软件的系统层 —— 你在那里打命令，不是在那里看设置。
 * 所以声音要：
 *   · **低** —— 220Hz，往下去
 *   · **短** —— 0.1 秒，干脆
 *   · **无混响** —— 它是一台机器，不是一间屋子
 *   · 带一点**方波的电流感**（1320Hz，20ms）
 */
export function playConsoleOpen(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  /* 接通：一下低音 */
  tone(ac, { freq: 220, to: 200, type: "sine", gain: 0.055, attack: 0.004, decay: 0.09 });
  /* 电流：一小下高频方波 */
  tone(ac, { freq: 1320, type: "square", gain: 0.014, attack: 0.001, decay: 0.018 });
}

/**
 * 关闭控制台 —— **收线**。
 *
 * 一个快速下滑，440 → 200。像那根线被拔掉，
 * 剩下的只是它抽走的那个方向。
 */
export function playConsoleClose(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 440, to: 200, type: "sine", gain: 0.06, attack: 0.003, decay: 0.1 });
}

/* ─────────── 设置面板：一块有厚度的东西 ─────────── */

/**
 * 打开设置面板。
 *
 * **不是「接通」，是「拉开」。**
 *
 * 设置是一个抽屉 —— 从侧面抽出来，有面积、有厚度。
 * 所以声音要：
 *   · **中频** —— 380 → 560，往上扫
 *   · **有一点点混响** —— 它在空间里，不在电路里
 */
export function playPanelOpen(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  const bus = reverbBus(ac, 0.6, 3.0, 0.15);
  tone(ac, { freq: 380, to: 560, type: "triangle", gain: 0.055, attack: 0.008, decay: 0.14, dest: bus });
}

/** 关闭设置面板 —— 收回去。 */
export function playPanelClose(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  const bus = reverbBus(ac, 0.6, 3.0, 0.15);
  tone(ac, { freq: 560, to: 380, type: "triangle", gain: 0.05, attack: 0.006, decay: 0.12, dest: bus });
}

/* ─────────── 存在与消失 ─────────── */

/**
 * 她第一次存在。
 *
 * **两个音：一个落地，一个点亮。**
 *
 * 330（落地）→ 495（纯五度，点亮），延迟 60ms 再叠一个 660。
 *
 * **故意不加太多混响** —— 混响是「空间里有东西」，
 * 而她是新的，这个空间对她来说还没有回声。
 */
export function playBirth(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 330, to: 495, type: "triangle", gain: 0.05, attack: 0.01, decay: 0.28 });
  tone(ac, { freq: 660, type: "sine", gain: 0.026, attack: 0.008, decay: 0.32, delay: 0.06 });
}

/**
 * 她不存在了。
 *
 * **一个下沉的短音 + 一点噪声。**
 *
 * 330 → 165（还在可听区，不是次低频），噪声模拟「灰尘落下来」。
 *
 * 不做成「警报」—— 删除是用户自己做的决定，
 * 软件不该对这一下表示震惊。
 */
export function playDelete(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 330, to: 165, type: "sine", gain: 0.055, attack: 0.006, decay: 0.34 });
  noise(ac, { dur: 0.22, gain: 0.012, cutoff: 1200, delay: 0.04 });
}

/**
 * 东西落进抽屉了（导入 / 导出完成）。
 *
 * **四个递减的短音** —— 1046 / 880 / 740 / 622，每个 60ms，间隔 70ms。
 *
 * 不是「成功」的音（那种通常是上扬），是「一个个放好了」的音。
 */
export function playSettle(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  const seq = [1046, 880, 740, 622];
  seq.forEach((hz, i) => {
    tone(ac, {
      freq: hz,
      type: "triangle",
      gain: 0.032 - i * 0.004,
      attack: 0.004,
      decay: 0.09,
      delay: i * 0.07,
    });
  });
}

/**
 * 档位切换（引擎 L1 ↔ L2）。
 *
 * **一个继电器声**：880 + 1320 同时，15ms，就这么短。
 *
 * 不是「过渡」，是「切换」—— 咔一下就完了。
 */
export function playShift(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 880, type: "square", gain: 0.046, attack: 0.001, decay: 0.02 });
  tone(ac, { freq: 1320, type: "square", gain: 0.028, attack: 0.001, decay: 0.015 });
}

/**
 * 按住说话 —— 开始了。
 *
 * **一个低频的「噗」**：200Hz + 一点噪声，60ms。
 *
 * 有气压感，但不到次低频。像把嘴凑近麦克风那一下。
 */
export function playHold(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 200, to: 180, type: "sine", gain: 0.06, attack: 0.004, decay: 0.07 });
  noise(ac, { dur: 0.04, gain: 0.01, cutoff: 900 });
}

/**
 * 松开 —— 录完了。
 *
 * **一个高频的「嗒」**：1200Hz，40ms。
 *
 * 和 hold 完全相反 —— 一个往下闷，一个往上脆。
 */
export function playRelease(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 1200, type: "triangle", gain: 0.052, attack: 0.001, decay: 0.05 });
}

/**
 * 时候到了。
 *
 * 预定死亡的专用音 —— **比 `playDelete` 轻得多**。
 *
 * `playDelete` 是「你按的」：330→165，下沉，短促。
 * 这个是「时候到了」：往上走，慢，像一口长气松开。
 *
 * 523 → 392（五度下行但很轻），加一个很淡的 1046 泛音。
 * **不是告别，是松开。**
 */
export function playFade(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  const bus = reverbBus(ac, 2.8, 1.6, 0.4);
  /* 主音：往下落一点点，但很轻 */
  tone(ac, { freq: 523, to: 392, type: "sine", gain: 0.032, attack: 0.08, decay: 1.6, dest: bus });
  /* 泛音：像余温 */
  tone(ac, { freq: 1046, type: "sine", gain: 0.012, attack: 0.15, decay: 1.2, delay: 0.1, dest: bus });
}

/** 打开面板 —— 通用款（给没有明确语义的面板用）。 */
export function playOpen(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 420, to: 640, type: "sine", gain: 0.032, attack: 0.008, decay: 0.15 });
}

/** 关闭面板 —— 向下滑。 */
export function playClose(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 640, to: 420, type: "sine", gain: 0.03, attack: 0.006, decay: 0.13 });
}

/**
 * **操作被拒** —— 轻、短、清脆。两声几乎一样的低音。
 *
 * 用在这些地方：
 *   · 控制台打了不存在的命令
 *   · 判决书里名字打错（但其实这里不响 —— 那个是"安静地灰着"）
 *   · 群聊里 @ 了不在群里的人
 *   · 输入为空就按发送
 *
 * 它不是"出事了"，是"这个不行"。**不该吓人。**
 */
export function playDeny(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  tone(ac, { freq: 330, type: "triangle", gain: 0.026, attack: 0.004, decay: 0.09 });
  tone(ac, { freq: 294, type: "triangle", gain: 0.022, attack: 0.004, decay: 0.11, delay: 0.09 });
}

/**
 * **系统故障** —— 真的出事了。
 *
 * ── 第一版的问题 ──
 *
 * 原来的实现是「两个下行的音，比 playDeny 更低沉」。
 * 听感上它只是**「大一号的操作被拒」**，一点都不紧急。
 *
 * ── 警报的语法不是「响」，是「重复」 ──
 *
 * 火警不是一声巨响，是反复的鸣叫。所以：
 *
 *   ① **三声急促的 1320Hz**（间隔 90ms）—— 这是"报告"的节奏
 *   ② **1320 和 1245Hz 同时响**（差 75Hz ≈ 半音）→ 拍频 → 刺耳
 *   ③ **150Hz 的底一直压着** → 不给你松懈的间隙
 *   ④ **square 波** → 硬、穿透、不像人声
 *
 * 总长 0.55 秒。**它是在催你，不是在通知你。**
 */
export function playError(): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;

  /* 三声急促 —— 警报的语法 */
  /*
   * 三声急促。间隔 85ms —— 比原来快一点，更像警报的「嘀嘀嘀」。
   */
  for (let i = 0; i < 3; i++) {
    const at = i * 0.085;
    /*
     * triangle 而不是 square。
     *
     * square 的频谱是奇次谐波的天梯 —— 图上 928 / 489 / 258 / 136Hz
     * 那排平行横线就是它。听起来是【刺】，不是【急】。
     *
     * triangle 的谐波按平方衰减，干净得多，但依然有棱角。
     */
    tone(ac, { freq: 1320, type: "triangle", gain: 0.042, attack: 0.003, decay: 0.055, delay: at });
    /* 接近半音的第二个频率 → 拍频 → 不安 */
    tone(ac, { freq: 1245, type: "triangle", gain: 0.042, attack: 0.003, decay: 0.055, delay: at });
  }

  /*
   * 末尾一声长的下沉 —— 把「后面 0.65 秒是空的」填掉。
   *
   * 原来只响三下就静音了，听起来像敲门三声然后没事了。
   * 这一声是「它没有结束，它在往下掉」。
   */
  tone(ac, {
    freq: 880,
    to: 440,
    type: "sine",
    gain: 0.035,
    attack: 0.01,
    decay: 1.0,
    delay: 0.26,
  });

  /*
   * 底：120Hz 的 sine（不是 sawtooth）。
   *
   * sawtooth 天生带全部整数谐波 —— 频谱上是 100-700Hz 一整排横线，
   * 听起来是「脏的嗡嗡」。sine 才是「沉」。
   */
  tone(ac, { freq: 120, to: 108, type: "sine", gain: 0.05, attack: 0.02, decay: 1.05 });
}
