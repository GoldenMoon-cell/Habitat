// 把一句话刻成一团点。每个点同时带一个"遗忘次序"：越小越先被忘掉。

const FONT_STACK =
  '"Source Han Serif SC", "Noto Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", "FangSong", serif'

const CW = 1600
const CH = 400
const STEP = 2

let canvas = null
function getCtx() {
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = CW
    canvas.height = CH
  }
  return canvas.getContext('2d', { willReadFrequently: true })
}

// 2D value noise，让遗忘成片发生，而不是均匀稀疏
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi), b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x, y) {
  return vnoise(x, y) * 0.65 + vnoise(x * 2.7 + 13.1, y * 2.7 - 7.3) * 0.35
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param text  要刻下的字
 * @param count 粒子数量
 * @param opts.maxW / maxH 在世界坐标里允许的最大宽度 / 字高
 * @param opts.seed  决定这段记忆的遗忘形状（确定性；与尺寸无关）
 * @param opts.depth / curve 字的厚度、弧面
 */
export function sampleText(text, count, opts = {}) {
  const { maxW = 10, maxH = 1.45, seed: seedIndex = 0, depth = 0.06, curve = 0.006 } = opts
  const ctx = getCtx()
  ctx.clearRect(0, 0, CW, CH)

  let fontSize = 230
  ctx.font = `300 ${fontSize}px ${FONT_STACK}`
  const tracking = 0.12
  const measure = () => {
    let w = 0
    for (const ch of text) w += ctx.measureText(ch).width + fontSize * tracking
    return w - fontSize * tracking
  }
  let w = measure()
  const canvasMax = CW * 0.94
  if (w > canvasMax) {
    fontSize *= canvasMax / w
    ctx.font = `300 ${fontSize}px ${FONT_STACK}`
    w = measure()
  }

  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  let x = (CW - w) / 2
  for (const ch of text) {
    ctx.fillText(ch, x, CH / 2)
    x += ctx.measureText(ch).width + fontSize * tracking
  }

  const data = ctx.getImageData(0, 0, CW, CH).data
  const pts = []
  for (let y = 0; y < CH; y += STEP) {
    for (let x2 = 0; x2 < CW; x2 += STEP) {
      if (data[(y * CW + x2) * 4 + 3] > 110) pts.push(x2, y)
    }
  }

  const n = pts.length / 2
  const rand = mulberry32(0x9e3779b1 ^ (seedIndex * 7919 + 17))
  const scale = Math.min(maxW / w, maxH / fontSize)
  const jitter = STEP * scale * 0.7

  // 打乱后循环取，保证每个采样点都有粒子
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = order[i]; order[i] = order[j]; order[j] = t
  }

  const targets = new Float32Array(count * 3)
  const raw = new Float32Array(count)
  const nOff = seedIndex * 31.7
  for (let i = 0; i < count; i++) {
    const p = order[i % n]
    const px = pts[p * 2], py = pts[p * 2 + 1]
    const wx = (px - CW / 2) * scale + (rand() - 0.5) * jitter
    const wy = -(py - CH / 2) * scale + (rand() - 0.5) * jitter
    // 轻微弧面 + 厚度，让字不是一张纸
    const wz = (rand() - 0.5) * depth - wx * wx * curve
    targets[i * 3] = wx
    targets[i * 3 + 1] = wy
    targets[i * 3 + 2] = wz
    raw[i] = fbm(px / 150 + nOff, py / 150 - nOff) * 0.78 + rand() * 0.22
  }

  // 排名归一化：erosion = 0.3 精确对应忘掉 30% 的粒子
  const idx = Array.from({ length: count }, (_, i) => i)
  idx.sort((a, b) => raw[a] - raw[b])
  const seeds = new Float32Array(count)
  for (let r = 0; r < count; r++) seeds[idx[r]] = (r + 0.5) / count

  return { targets, seeds }
}
