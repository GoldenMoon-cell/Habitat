import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { sampleText, mulberry32 } from './textSampler.js'
import { Drone } from './audio.js'
import {
  snowVertex, starVertex, pointFragment,
  bgVertex, bgFragment, lensShader, grainShader,
} from './shaders.js'

const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 720
const STAR_COUNT = MOBILE ? 6500 : 11000   // 每颗星由多少粒海雪压成
const SNOW_COUNT = MOBILE ? 9000 : 18000
const BOKEH_COUNT = MOBILE ? 500 : 900
const CAM_Z = 12
const TEXT_Z = 1.6                         // 句子浮在星图前面一点
const NOT_LOST = 1e9

// 进入 / 离开
const FAR_Z = 95
const ENTER_DUR = 5.2
const EXIT_DUR = 3.8
const DESCENT = 26

// 一段记忆的一生
const OPEN_DUR = 1.9       // 炸开、重组成句
const NEGLECT = 9          // 打开了却不去握住它
const HOLD_RISE = 1 / 1.1  // 握紧需要的时间
const LINGER = 3.0         // 松开后，剩下的字停留多久
const COLLAPSE_DUR = 1.5   // 坍缩回星
const RETURN_DUR = 1.7     // 飞回原位
const COLLAPSE_FAST = 1.0  // 手动收起时
const RETURN_FAST = 1.2

export class Engine {
  /**
   * @param container DOM 容器
   * @param onStats   ~10Hz 的状态回调（给 HUD）
   * @param opts.phase   'outside'（默认）| 'inside'
   * @param opts.onFrame 每帧回调：被悬停的星在屏幕上的位置（给标签）
   */
  constructor(container, onStats, opts = {}) {
    this.container = container
    this.onStats = onStats
    this.onFrame = opts.onFrame
    this.drone = new Drone()

    this.phase = opts.phase === 'inside' ? 'inside' : 'outside'
    this.transit = this.phase === 'inside' ? 0 : 1
    this.tween = null
    this.prevLogZ = Math.log(this.phase === 'inside' ? CAM_Z : FAR_Z)
    this.zoomBlur = 0

    this.mode = 'idle'   // idle → opening → shown/holding → released → collapsing → returning → idle
    this.active = null
    this.modeT = 0
    this.pressed = false
    this.holdAmt = 0
    this.hovered = null
    this.dim = 0
    this.flash = 0
    this.closeQueued = false
    this.collapseDur = COLLAPSE_DUR
    this.returnDur = RETURN_DUR

    this.mouseNdc = new THREE.Vector2(0, 0)
    this.mousePx = new THREE.Vector2(-1e4, -1e4)
    this.mouseWorld = new THREE.Vector3()
    this.mouseStrength = 0
    this.mouseEnergy = 0
    this.textCenter = new THREE.Vector3(0, 0, TEXT_Z)
    this.tmp = new THREE.Vector3()
    this.hit = new THREE.Vector3()
    this.timer = new THREE.Timer()
    this.lastStats = 0
    this.disposed = false
    this.paused = false
    this.quality = 'high'

    // 垂直深度滚动
    this.scrollY = 0        // 当前深度偏移
    this.scrollVel = 0      // 惯性速度
    this.scrollTarget = 0   // 弹簧目标
    this.SCROLL_MIN = 0    // 进入时 scrollY=0 正好是海面（norm=0）
    this.SCROLL_MAX = 5.7  // 海床

    this.initRenderer()
    this.initScene()
    this.initPost()
    this.bind()
    this.resize()
    this.renderer.setAnimationLoop(() => this.tick())
  }

  // ───────── setup ─────────

  initRenderer() {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }))
    r.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2))
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.setClearColor(0x010205, 1)
    this.container.appendChild(r.domElement)
  }

  initScene() {
    this.scene = new THREE.Scene()
    const w = this.container.clientWidth || innerWidth
    const h = this.container.clientHeight || innerHeight
    this.camera = new THREE.PerspectiveCamera(45, w / h || 16 / 9, 0.1, 200)
    this.camera.position.set(0, 0, this.phase === 'inside' ? CAM_Z : FAR_Z)

    this.uniforms = {
      uTime: { value: 0 },
      uDescent: { value: 0 },
      uTransit: { value: this.transit },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uFocus: { value: CAM_Z },
      uMouse: { value: this.mouseWorld },
      uMouseStrength: { value: 0 },
      uDim: { value: 0 },
    }
    this.attract = new THREE.Vector4(0, 0, 0, 0)
    this.shock = new THREE.Vector4(0, 0, 0, -1)
    this.snowBox = new THREE.Vector3(21, 12, 10)
    this.snowCenter = new THREE.Vector3(0, 0, -1)

    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: bgVertex,
      fragmentShader: bgFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: this.uniforms.uTime,
        uMouseStrength: this.uniforms.uMouseStrength,
        uDim: this.uniforms.uDim,
        uTransit: this.uniforms.uTransit,
        uAspect: { value: 1 },
        uMouseNdc: { value: this.mouseNdc },
        uFocusNdc: { value: new THREE.Vector2(0, 0) },
        uScrollY: { value: 0 },
      },
    })
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat)
    bg.frustumCulled = false
    bg.renderOrder = -10
    this.scene.add(bg)

    this.snow = this.makeSnow(SNOW_COUNT, this.snowBox, this.snowCenter, 4242)
    this.bokeh = this.makeSnow(BOKEH_COUNT, new THREE.Vector3(14, 9, 6), new THREE.Vector3(0, 0, 7), 777)
    this.scene.add(this.snow, this.bokeh)

    this.layout()
    this.lastTextW = this.textW()
    // 星星先用空数组占位，init() 异步填充
    this.stars = []
    this._memoriesDefs = []
  }

  /** 外部调用：传入记忆定义数组后真正初始化星图 */
  loadMemories(defs) {
    // 清除旧星
    for (const s of this.stars) {
      this.scene.remove(s.points)
      s.geo.dispose()
      s.mat.dispose()
    }
    this._memoriesDefs = defs
    this.stars = defs.map((m, i) => this.makeStar(m, i))
    for (const s of this.stars) this.scene.add(s.points)
  }

  makeSnow(n, box, center, seed) {
    const rand = mulberry32(seed)
    const geo = new THREE.BufferGeometry()
    const p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      p[i * 3] = (rand() - 0.5) * box.x
      p[i * 3 + 1] = (rand() - 0.5) * box.y
      p[i * 3 + 2] = (rand() - 0.5) * box.z
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const r4 = new Float32Array(n * 4).map(() => rand())
    const r1 = new Float32Array(n).map(() => rand())
    geo.setAttribute('aRand', new THREE.BufferAttribute(r4, 4))
    geo.setAttribute('aRand2', new THREE.BufferAttribute(r1, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: snowVertex,
      fragmentShader: pointFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...this.uniforms,
        uBox: { value: box },
        uBoxCenter: { value: center },
        uAttract: { value: this.attract },
        uShock: { value: this.shock },
      },
    })
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false
    return pts
  }

  // 星图按 16:9 设计；窄屏时横向收拢、纵向拉开
  layout() {
    const a = this.camera.aspect
    this.sx = Math.min(1, a / 1.78)
    this.sy = a < 1 ? Math.min(1.6, 1.78 / a / 1.6) : 1
  }

  // 句子所在平面的可见宽度
  /**
   * 粒子字最宽能占多少（世界单位）。
   *
   * [改回来了] 曾经为了给详情面板让位收到 0.60，后来撤销。
   *
   * 理由是顺序错了：粒子字是这个场景的主角，面板是附属。
   * 为了不让面板压字而把字缩小 30%，是因小失大 ——
   * 该动的是面板。
   *
   * 现在面板挪到了右上（见 starmap.css 的 .detail），
   * 在字的上方，不占字的横向范围。
   */
  textW() {
    const d = CAM_Z - TEXT_Z
    const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(45 / 2))
    return Math.min(h * this.camera.aspect * 0.86, 9.5)
  }

  makeStar(m, i) {
    const n = STAR_COUNT
    const rand = mulberry32(9001 + i * 131)
    const geo = new THREE.BufferGeometry()

    // 星：80% 高斯核 + 20% 一圈倾斜的晕
    const local = new Float32Array(n * 3)
    const halo = new Float32Array(n)
    const r4 = new Float32Array(n * 4)
    const tilt = 0.5 + rand() * 0.6
    for (let k = 0; k < n; k++) {
      for (let c = 0; c < 4; c++) r4[k * 4 + c] = rand()
      if (rand() < 0.8) {
        const g = () => (rand() + rand() + rand() - 1.5) * 0.11
        local[k * 3] = g(); local[k * 3 + 1] = g(); local[k * 3 + 2] = g()
      } else {
        halo[k] = 1
        const a = rand() * Math.PI * 2
        const r = 0.22 + Math.pow(rand(), 1.5) * 0.4
        const y = (rand() - 0.5) * 0.06
        local[k * 3] = Math.cos(a) * r
        local[k * 3 + 1] = y * Math.cos(tilt) + Math.sin(a) * r * Math.sin(tilt) * 0.35
        local[k * 3 + 2] = Math.sin(a) * r * Math.cos(tilt)
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(local, 3))
    geo.setAttribute('aRand', new THREE.BufferAttribute(r4, 4))
    geo.setAttribute('aHalo', new THREE.BufferAttribute(halo, 1))

    const portrait = this.camera.aspect < 1
    const sent = sampleText(m.text, n, { maxW: this.lastTextW, maxH: portrait ? 0.9 : 1.15, seed: i })
    const glyph = sampleText(m.kernel, n, { maxW: 0.9, maxH: 0.62, seed: i + 100, depth: 0.02, curve: 0 })
    const textAttr = new THREE.BufferAttribute(sent.targets, 3)
    geo.setAttribute('aText', textAttr)
    geo.setAttribute('aGlyph', new THREE.BufferAttribute(glyph.targets, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sent.seeds, 1))

    // 已经忘掉的部分：早就混进海雪里了
    const lostThresh = 1 - m.mass
    const lostAt = new Float32Array(n).fill(NOT_LOST)
    for (let k = 0; k < n; k++) {
      if (sent.seeds[k] < lostThresh) lostAt[k] = -20 - rand() * 600
    }
    const lostAttr = new THREE.BufferAttribute(lostAt, 1)
    lostAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aLostAt', lostAttr)

    const pos = new THREE.Vector3()
    const vel = new THREE.Vector3()
    const mat = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: pointFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...this.uniforms,
        uPos: { value: pos },
        uVel: { value: vel },
        uTextCenter: { value: this.textCenter },
        uTint: { value: new THREE.Vector3(...m.tint) },
        uSnowBox: { value: this.snowBox },
        uSnowCenter: { value: this.snowCenter },
        uForm: { value: 0 },
        uDir: { value: 1 },
        uHold: { value: 0 },
        uHover: { value: 0 },
        uFlash: { value: 0 },
        uCohesion: { value: m.cohesion },
        uEngrave: { value: m.engrave },
        uLightS: { value: 1 },
        uDepth: { value: 1 },    // 记忆深度：影响展开后字的亮度和清晰度
        uLayerAlpha: { value: 1 }, // 分层可见度：< 0.1 时 vertex shader 剔除粒子
      },
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false

    const s = {
      i, def: m, points, mat, u: mat.uniforms, geo, textAttr, lostAttr,
      seeds: sent.seeds, lostThresh,
      mass: m.mass, cohesion: m.cohesion,
      pos, vel, home: new THREE.Vector3(), from: new THREE.Vector3(),
      hover: 0, light: 1, phaseOff: rand() * 100,
      // 动态记忆：深度、上次召回时间、遗忘速度
      depth: 0.3 + rand() * 0.7,  // 初始深度 0.3-1.0，各不相同
      lastRecall: Date.now(),
      decayRate: 0.00008 + rand() * 0.00022,  // 每秒衰减极少；depth=0.7 的记忆约需 1-2 小时才完全淡去
    }
    this.homeAt(s, 0, s.home)
    pos.copy(s.home)
    return s
  }

  homeAt(s, t, out) {
    const [x, origY, z] = s.def.at
    const o = s.phaseOff

    // 星团位置不跟随滚动，保持原始布局
    return out.set(
      x * this.sx + Math.sin(t * 0.11 + o) * 0.12,
      origY * this.sy + Math.sin(t * 0.09 + o * 1.7) * 0.15,
      z + Math.sin(t * 0.07 + o * 0.6) * 0.1,
    )
  }

  initPost() {
    const c = (this.composer = new EffectComposer(this.renderer))
    c.addPass(new RenderPass(this.scene, this.camera))
    // [改] 原本 (256,0.95,0.7,0.08) —— 阈值太低，几乎全部发光，光晕白得盖住底色
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.72, 0.62, 0.32)
    c.addPass(this.bloom)
    this.lens = new ShaderPass(lensShader)
    c.addPass(this.lens)
    c.addPass(new OutputPass())
    this.grain = new ShaderPass(grainShader)
    c.addPass(this.grain)
  }

  // ───────── input ─────────

  bind() {
    this.onMove = (e) => this.setPointer(e.clientX, e.clientY)
    this.onResize = () => this.resize()
    addEventListener('pointermove', this.onMove)
    addEventListener('resize', this.onResize)

    // 滚轮控制垂直深度
    this.onWheel = (e) => {
      if (this.phase !== 'inside' || this.mode !== 'idle') return
      e.preventDefault()
      this.scrollVel += e.deltaY * 0.008
    }
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false })

    // 触摸竖向拖动
    let touchStartY = 0
    this.onTouchStart = (e) => { touchStartY = e.touches[0].clientY }
    this.onTouchMove = (e) => {
      if (this.phase !== 'inside' || this.mode !== 'idle') return
      const dy = e.touches[0].clientY - touchStartY
      touchStartY = e.touches[0].clientY
      this.scrollVel += dy * 0.015
    }
    this.renderer.domElement.addEventListener('touchstart', this.onTouchStart, { passive: true })
    this.renderer.domElement.addEventListener('touchmove', this.onTouchMove, { passive: true })
  }

  setPointer(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect()
    const x = ((cx - r.left) / r.width) * 2 - 1
    const y = -((cy - r.top) / r.height) * 2 + 1
    this.mouseEnergy = Math.min(1.5, this.mouseEnergy + Math.hypot(x - this.mouseNdc.x, y - this.mouseNdc.y) * 6)
    this.mouseNdc.set(x, y)
    this.mousePx.set(cx - r.left, cy - r.top)
  }

  /** 按下：在星上就打开它；句子已经在眼前时就是"握住" */
  press(cx, cy) {
    if (this.phase !== 'inside') return
    if (cx !== undefined) this.setPointer(cx, cy)
    // 剩下的字还停在眼前：点一下就让它马上回去
    if (this.mode === 'released') return this.collapseNow()
    this.pressed = true
    if (this.mode === 'idle') {
      const s = this.pick(MOBILE ? 60 : 0)
      if (s) this.open(s)
      else this.pressed = false
    }
  }

  release() {
    this.pressed = false
  }

  /**
   * 后退一层：打开的记忆先收起回星；已经在星图上了才离开这片海。
   * 返回 true 表示这次是"收起"，false 表示交给 exit()。
   */
  back() {
    switch (this.mode) {
      case 'opening':
        // 还在成形：等它成形的那一刻立刻收起，避免路径突变
        this.closeQueued = true
        return true
      case 'shown':
      case 'holding':
        this.pressed = false
        this.dissolve(this.active, this.mode === 'shown')
        this.collapseNow()
        return true
      case 'released':
        this.collapseNow()
        return true
      case 'collapsing':
      case 'returning':
        return true // 已经在回去的路上
      default:
        if (this.phase === 'inside' || this.phase === 'entering') this.exit()
        return false
    }
  }

  // 弹簧物理：把星拉回 retTarget，返回是否稳定
  _springStep(s, dt) {
    const SPRING = 18, DAMP = 7.2
    if (!s.retTarget) s.retTarget = new THREE.Vector3()
    const t = this.timer.getElapsed()
    this.homeAt(s, t, s.retTarget)
    const toHome = new THREE.Vector3().subVectors(s.retTarget, s.pos)
    const dist = toHome.length()
    s.vel.addScaledVector(toHome, SPRING * dt)
    s.vel.multiplyScalar(Math.exp(-DAMP * dt))
    s.pos.addScaledVector(s.vel, dt)
    return dist < 0.07 && s.vel.length() < 0.14
  }

  // 跳过停留，马上坍缩回星（手动收起比自然归位快）
  collapseNow(fast = true) {
    const s = this.active
    if (!s) return
    // 正在排队掉落的粒子立刻开始掉，不再跟着回星
    const now = this.timer.getElapsed()
    const arr = s.lostAttr.array
    let dirty = false
    for (let k = 0; k < arr.length; k++) {
      if (arr[k] < NOT_LOST && arr[k] > now) { arr[k] = now; dirty = true }
    }
    if (dirty) s.lostAttr.needsUpdate = true
    this.closeQueued = false
    this.collapseDur = fast ? COLLAPSE_FAST : COLLAPSE_DUR
    this.returnDur = fast ? RETURN_FAST : RETURN_DUR
    s.u.uDir.value = 0
    s.pos.copy(this.textCenter)
    // 立刻起飞，不等坍缩结束——凝聚和飞行同时发生
    const t0 = this.timer.getElapsed()
    if (!s.retTarget) s.retTarget = new THREE.Vector3()
    this.homeAt(s, t0, s.retTarget)
    const launchDir = new THREE.Vector3().subVectors(s.retTarget, this.textCenter).normalize()
    const perp = new THREE.Vector3((Math.random() - 0.5) * 0.7, Math.random() * 0.4 + 0.15, (Math.random() - 0.5) * 0.4).normalize()
    s.vel.copy(launchDir).lerp(perp, 0.26).normalize().multiplyScalar(3.0 + Math.random() * 2.5)
    this.setMode('collapsing')
  }

  open(s) {
    this.active = s
    this.hovered = null
    this.closeQueued = false
    s.from.copy(s.pos)
    s.u.uDir.value = 1
    s.u.uForm.value = 0
    this.flash = 1
    this.shock.set(s.pos.x, s.pos.y, s.pos.z, 0)

    // 铭记：每次召回记忆，深度增加，遗忘重置
    s.depth = Math.min(1, s.depth + 0.25)  // 深度+0.25，上限1.0
    s.lastRecall = Date.now()

    this.setMode('opening')
    this.drone.bloom()
    this.drone.remember(s.mass)
  }

  /**
   * 松开（或冷落）之后：一部分粒子从字上剥落，永远掉进海雪。
   * 握得越久、越牢固，掉得越少；刻进去的部分永远不会掉。
   */
  dissolve(s, neglected) {
    const base = neglected ? 0.2 : 0.11
    const frac = base * (1 - 0.6 * this.holdAmt) * (1.15 - s.cohesion * 0.6)
    const cap = 1 - s.def.engrave
    const next = Math.min(cap, s.lostThresh + (1 - s.lostThresh) * frac)
    const now = this.timer.getElapsed()
    const span = Math.max(1e-6, next - s.lostThresh)
    const arr = s.lostAttr.array
    for (let k = 0; k < arr.length; k++) {
      const sd = s.seeds[k]
      if (sd >= s.lostThresh && sd < next) arr[k] = now + ((sd - s.lostThresh) / span) * 0.9 + Math.random() * 0.25
    }
    s.lostAttr.needsUpdate = true
    s.lostThresh = next
    s.mass = 1 - next
    // 回想让它更牢；冷落让它松动
    s.cohesion = Math.min(1, Math.max(0.05, s.cohesion + (neglected ? -0.12 : 0.1 * this.holdAmt - 0.02)))
    s.u.uCohesion.value = s.cohesion
    this.drone.forget()
  }

  // ───────── 进入 / 离开 ─────────

  enter() {
    if (this.phase === 'inside') return Promise.resolve(true)
    this.drone.dive(ENTER_DUR)
    return this.transitTo(0, ENTER_DUR, 'entering', 'inside')
  }

  exit() {
    if (this.phase === 'outside') return Promise.resolve(true)
    this.pressed = false
    if (this.mode === 'shown' || this.mode === 'holding') {
      this.dissolve(this.active, true)
      this.collapseNow()
    } else if (this.mode === 'released') {
      this.collapseNow()
    } else if (this.mode === 'opening') {
      this.closeQueued = true
    }
    this.drone.surface(EXIT_DUR)
    return this.transitTo(1, EXIT_DUR, 'leaving', 'outside')
  }

  transitTo(to, dur, during, after) {
    this.tween?.resolve(false)
    const dist = Math.abs(to - this.transit)
    return new Promise((resolve) => {
      this.tween = { from: this.transit, to, t0: this.timer.getElapsed(), dur: Math.max(0.3, dur * dist), after, resolve }
      this.setPhase(during)
    })
  }

  setPhase(p) {
    if (this.phase === p) return
    this.phase = p
    this.emitStats(true)
  }

  setMode(m) {
    this.mode = m
    this.modeT = 0
    this.emitStats(true)
  }

  setMuted(m) {
    this.drone.setMuted(m)
  }

  // ───────── frame ─────────

  tick() {
    this.timer.update(this.manualTime)
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const t = this.timer.getElapsed()
    this.uniforms.uTime.value = t

    this.updateTransit(t)
    this.updateMemory(dt, t)
    this.updateStars(dt, t)
    this.updatePointer(dt)
    this.updateCamera(dt, t)
    this.updatePost(dt, t)

    this.composer.render()
    this.emitFrame()
    this.emitStats()
  }

  updateTransit(t) {
    const tw = this.tween
    if (tw) {
      const k = Math.min(1, (t - tw.t0) / tw.dur)
      this.transit = tw.from + (tw.to - tw.from) * k
      if (k >= 1) {
        this.tween = null
        this.setPhase(tw.after)
        tw.resolve(true)
      }
    }
    this.uniforms.uTransit.value = this.transit
    this.uniforms.uDescent.value = DESCENT * smootherstep(1 - this.transit)
  }

  // 一段记忆的一生
  updateMemory(dt, t) {
    const s = this.active
    this.modeT += dt
    const T = this.modeT
    if (!s) return
    const u = s.u

    switch (this.mode) {
      case 'opening':
        u.uForm.value = Math.min(1, T / OPEN_DUR)
        if (T >= OPEN_DUR) {
          if (this.closeQueued) {
            this.dissolve(s, true)
            this.collapseNow()
          } else this.setMode(this.pressed ? 'holding' : 'shown')
        }
        break
      case 'shown':
        if (this.pressed) this.setMode('holding')
        else if (T > NEGLECT) {
          this.dissolve(s, true)
          this.setMode('released')
        }
        break
      case 'holding':
        if (!this.pressed) {
          this.dissolve(s, false)
          this.setMode('released')
        }
        break
      case 'released':
        // 剩下的字松开、发抖，停留 3 秒
        if (T >= LINGER) this.collapseNow(false)
        break
      case 'collapsing':
        u.uForm.value = Math.max(0, 1 - T / this.collapseDur)
        // 粒子凝聚的同时，球已经在飞了——共用同一套弹簧
        this._springStep(s, dt)
        if (T >= this.collapseDur) this.setMode('returning')
        break
      case 'returning': {
        const settled = this._springStep(s, dt)
        if (settled || T > 3.5) {
          s.pos.copy(s.retTarget)
          s.vel.set(0, 0, 0)
          s.flash = 0.5
          this.active = null
          this.setMode('idle')
        }
        break
      }
    }

    const holdTarget = this.mode === 'holding' ? 1 : 0
    const rate = this.mode === 'holding' ? HOLD_RISE : 0.6
    this.holdAmt += Math.sign(holdTarget - this.holdAmt) * Math.min(Math.abs(holdTarget - this.holdAmt), dt * rate)
    u.uHold.value = smoothstep(0, 1, this.holdAmt)
  }

  updateStars(dt, t) {
    const open = ['opening', 'shown', 'holding', 'released'].includes(this.mode)
    this.dim += ((open ? 1 : 0) - this.dim) * Math.min(1, dt * (open ? 2.2 : 0.9))
    this.uniforms.uDim.value = this.dim
    this.flash *= Math.exp(-dt * 2.6)

    if (this.mode === 'idle' && this.phase === 'inside') this.hovered = this.pick(0)
    else if (this.mode !== 'idle') this.hovered = null

    // scrollY: 0(海面) → 5.7(海床)，背景颜色随深度变化
    // 不在此处做分层过滤——所有星始终可见

    for (const s of this.stars) {
      const isActive = s === this.active

      // 遗忘动画：5 秒窗口内可救回，之后彻底剥落
      if (s.forgetting) {
        s.forgettingT = (s.forgettingT || 0) + dt
        const fT = s.forgettingT
        // 前 5 秒：粒子逐渐掉落，但可以点击救回
        if (fT < 5) {
          s.depth = Math.max(0.01, s.depth - 0.006 * dt)
          s.mass  = Math.max(0.01, s.mass  - 0.04  * dt)
        } else {
          // 5 秒到 7 秒：快速消散，不可挽回
          s.rescuable = false
          s.depth = Math.max(0, s.depth - 0.15 * dt)
          s.mass  = Math.max(0, s.mass  - 0.25 * dt)
          if (s.mass <= 0 && s.depth <= 0) {
            s.forgetting = false
            s.dead = true
            // TODO：彻底移除这颗星，或留作幽灵
          }
        }

        /*
         * [改] 让粒子**真的掉下来**。
         *
         * 原来这里只改 s.mass / s.depth 两个数字 ——
         * 而画面上的粒子剥落是由 aLostAt 这个顶点属性驱动的，
         * 它只在 makeStar（建几何时）和 dissolve（松开记忆）里写。
         * 于是散开的时候：数字在掉，肉眼什么都看不见，
         * 直到某一帧整颗凭空消失。实测截图：mass 0.96 → 0.38，画面无差别。
         *
         * 这里把 mass 反推成 lostThresh，用和 dissolve 同一套写法
         * 逐粒子打上「掉落的时刻」。刻进去的部分（engrave）永远不掉。
         */
        const cap = 1 - s.def.engrave
        const next = Math.min(cap, 1 - s.mass)
        if (next > s.lostThresh + 1e-6) {
          const now = this.timer.getElapsed()
          const span = Math.max(1e-6, next - s.lostThresh)
          const arr = s.lostAttr.array
          for (let k = 0; k < arr.length; k++) {
            const sd = s.seeds[k]
            if (sd >= s.lostThresh && sd < next) {
              // 散开比松开更急：0.35 秒的错峰，不是 0.9
              arr[k] = now + ((sd - s.lostThresh) / span) * 0.35 + Math.random() * 0.12
            }
          }
          s.lostAttr.needsUpdate = true
          s.lostThresh = next
        }
      }

      // 压抑：锁死 depth
      if (s.suppressed) s.depth = 0.05

      // 时间流逝 → 遗忘：depth 缓慢降低（不影响压抑和已遗忘的星）
      if (!isActive && !s.forgetting && !s.suppressed && !s.dead) {
        s.depth = Math.max(0, s.depth - s.decayRate * dt)
      }

      // 所有星始终可见，不做分层过滤
      s.layerAlpha = 1

      if (!isActive || this.mode === 'opening' || this.mode === 'shown' || this.mode === 'holding' || this.mode === 'released') {
        this.homeAt(s, t, s.home)
        if (!isActive || this.mode === 'opening') s.pos.copy(s.home)
      }
      if (!(isActive && (this.mode === 'returning' || this.mode === 'collapsing'))) s.vel.multiplyScalar(Math.exp(-dt * 3))
      const hv = s === this.hovered ? 1 : 0
      s.hover += (hv - s.hover) * Math.min(1, dt * (hv ? 3.5 : 2.5))
      const depthLight = 0.2 + s.depth * 0.8
      const lt = this.active && !isActive ? 0.3 * depthLight : depthLight
      s.light += (lt - s.light) * Math.min(1, dt * 2)
      s.flash = (s.flash || 0) * Math.exp(-dt * 2)

      const u = s.u
      u.uHover.value = smoothstep(0, 1, s.hover)
      // 被打开的星强制最大亮度，不受 depth/layerAlpha 影响
      u.uLightS.value = isActive ? 1 : s.light * s.layerAlpha
      u.uDepth.value = s.depth          // 实时推送 depth 给 shader
      u.uFlash.value = isActive ? this.flash : s.flash
      u.uLayerAlpha.value = s.layerAlpha  // 传递给 vertex shader 用于剔除
    }

    // 被悬停的星把周围的海雪吸过去
    const h = this.hovered
    const want = h ? 1 : 0
    if (h) {
      if (this.attract.w < 0.02) this.attract.set(h.pos.x, h.pos.y, h.pos.z, this.attract.w)
      else {
        const k = Math.min(1, dt * 6)
        this.attract.x += (h.pos.x - this.attract.x) * k
        this.attract.y += (h.pos.y - this.attract.y) * k
        this.attract.z += (h.pos.z - this.attract.z) * k
      }
    }
    this.attract.w += (want - this.attract.w) * Math.min(1, dt * (want ? 1.6 : 1.2))

    if (this.shock.w >= 0) {
      this.shock.w += dt
      if (this.shock.w > 6) this.shock.w = -1
    }

    // 背景在那句话后面留一点光
    this.tmp.copy(this.textCenter).project(this.camera)
    this.bgMat.uniforms.uFocusNdc.value.set(this.tmp.x, this.tmp.y)
  }

  /** 屏幕空间里离鼠标最近的星；当前悬停的那颗有一点"黏性" */
  pick(extra = 0) {
    const r = this.renderer.domElement
    const W = r.clientWidth, H = r.clientHeight
    let best = null, bestD = Infinity
    for (const s of this.stars) {

      this.tmp.copy(s.pos).project(this.camera)
      if (this.tmp.z > 1) continue
      const x = (this.tmp.x * 0.5 + 0.5) * W
      const y = (-this.tmp.y * 0.5 + 0.5) * H
      const d = Math.hypot(x - this.mousePx.x, y - this.mousePx.y)
      const radius = (34 + s.mass * 22) * (s === this.hovered ? 1.5 : 1) + extra
      if (d < radius && d < bestD) {
        best = s
        bestD = d
      }
    }
    return best
  }

  updatePointer(dt) {
    const u = this.uniforms
    const inside = 1 - this.transit
    this.mouseEnergy *= Math.exp(-dt * 1.4)
    this.mouseStrength += (Math.min(1, this.mouseEnergy) - this.mouseStrength) * Math.min(1, dt * 4)
    u.uMouseStrength.value = this.mouseStrength * inside * inside * (1 - this.dim * 0.7)

    const cam = this.camera
    this.hit.set(this.mouseNdc.x, this.mouseNdc.y, 0.5).unproject(cam).sub(cam.position).normalize()
    if (Math.abs(this.hit.z) > 1e-4) {
      const k = -cam.position.z / this.hit.z
      this.tmp.copy(cam.position).addScaledVector(this.hit, k)
      this.mouseWorld.lerp(this.tmp, Math.min(1, dt * 6))
    }
  }

  updateCamera(dt, t) {
    const cam = this.camera
    const tr = this.transit
    const inside = 1 - tr
    const calm = 1 - this.dim * 0.8

    // 垂直深度滚动：惯性 + 边界弹簧
    this.scrollVel *= Math.exp(-dt * 3.5)
    if (this.scrollY < this.SCROLL_MIN) this.scrollVel += (this.SCROLL_MIN - this.scrollY) * 8 * dt
    if (this.scrollY > this.SCROLL_MAX) this.scrollVel += (this.SCROLL_MAX - this.scrollY) * 8 * dt
    this.scrollY += this.scrollVel * dt

    const tx = (this.mouseNdc.x * 0.55 * inside * calm) + Math.sin(t * 0.07) * 0.3
    const ty = (this.mouseNdc.y * 0.3 * inside * calm) + Math.sin(t * 0.05 + 1.3) * 0.18 + this.scrollY
    const tz = CAM_Z - this.dim * 0.7 - this.holdAmt * 0.35
    this.rest ??= new THREE.Vector3(0, 0, CAM_Z)
    this.rest.x += (tx - this.rest.x) * Math.min(1, dt * 0.8)
    this.rest.y += (ty - this.rest.y) * Math.min(1, dt * 0.8)
    this.rest.z += (tz - this.rest.z) * Math.min(1, dt * 0.8)

    // 进出：方向从正前方混向斜上方，距离在对数空间插值
    const e = easeInOutCubic(tr)
    const restLen = this.rest.length()
    this.dirOut ??= new THREE.Vector3(Math.sin(0.12), Math.sin(0.38), Math.cos(0.12)).normalize()
    const dist = Math.exp(Math.log(restLen) + (Math.log(FAR_Z) - Math.log(restLen)) * e)
    cam.position.copy(this.rest).divideScalar(restLen).lerp(this.dirOut, e).normalize().multiplyScalar(dist)
    cam.lookAt(0, 0, 0)
    const fov = 45 + Math.sin(Math.PI * tr) * 14
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }

    // 焦点：平时在星图上，打开记忆时拉到那句话上
    const toText = cam.position.distanceTo(this.textCenter)
    this.uniforms.uFocus.value = cam.position.length() + (toText - cam.position.length()) * this.dim

    const logZ = Math.log(dist)
    const zv = dt > 0 ? Math.abs(logZ - this.prevLogZ) / dt : 0
    this.prevLogZ = logZ
    this.zoomBlur += (Math.min(0.09, zv * 0.045) - this.zoomBlur) * Math.min(1, dt * 10)
  }

  updatePost(dt, t) {
    const L = this.lens.uniforms
    L.uTime.value = t
    L.uDesat.value = this.dim * 0.35
    L.uAberration.value = 0.0012 + this.holdAmt * 0.0012 + this.flash * 0.004 + this.zoomBlur * 0.03
    L.uZoomBlur.value = this.zoomBlur
    this.grain.uniforms.uTime.value = t
    this.bloom.strength = 0.8 + this.holdAmt * 0.35 + this.flash * 0.9 + this.transit * 0.6

    // 更新背景的 scrollY uniform（归一化到 0-1）
    // scrollY: 0(海面) → 5.7(海床)
    // uScrollY: 1(海面亮蓝) → 0(海床暗红)
    const scrollNorm = Math.max(0, Math.min(1, 1 - this.scrollY / this.SCROLL_MAX))
    this.bgMat.uniforms.uScrollY.value = scrollNorm
  }

  // 给 HUD 标签：被悬停的星在屏幕上的位置
  emitFrame() {
    if (!this.onFrame) return
    let s = null
    for (const x of this.stars) if (x.hover > 0.02 && (!s || x.hover > s.hover)) s = x
    if (!s || this.phase !== 'inside') return this.onFrame(null)
    const r = this.renderer.domElement
    this.tmp.copy(s.pos).project(this.camera)
    this.onFrame({
      i: s.i,
      x: (this.tmp.x * 0.5 + 0.5) * r.clientWidth,
      y: (-this.tmp.y * 0.5 + 0.5) * r.clientHeight,
      alpha: s.hover,
      mass: s.mass,
      cohesion: s.cohesion,
      engrave: s.def.engrave,
    })
  }

  emitStats(force = false) {
    const t = this.timer.getElapsed()
    if (!force && t - this.lastStats < 0.1) return
    this.lastStats = t
    const stars = this.stars
    if (!stars.length) {
      this.onStats?.({ phase: this.phase, transit: this.transit, mode: this.mode, clarity: 1, count: 0 })
      return
    }
    const clarity = stars.reduce((a, s) => a + s.mass, 0) / stars.length
    // 按深度分组：刻于心、随风飘荡、沉入海床
    const engraved = stars.filter(s => s.def.engrave > 0.2 || s.cohesion > 0.8).length
    const awake    = stars.filter(s => s.depth >= 0.6).length
    const fading   = stars.filter(s => s.depth >= 0.2 && s.depth < 0.6).length
    const sunken   = stars.filter(s => s.depth < 0.2).length
    // 最近一次被想起的记忆
    let lastTouched = null
    let lastTime = 0
    stars.forEach(s => { if (s.lastRecall > lastTime) { lastTime = s.lastRecall; lastTouched = s } })
    this.onStats?.({
      phase: this.phase,
      transit: this.transit,
      mode: this.mode,
      clarity,
      count: stars.length,
      engraved, awake, fading, sunken,
      lastTouched: lastTouched ? { text: lastTouched.def.text, ago: Date.now() - lastTime } : null,
      scrollY: this.scrollY,
    })
  }

  resize() {
    const w = this.container.clientWidth || innerWidth
    const h = this.container.clientHeight || innerHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
    this.bgMat.uniforms.uAspect.value = w / h
    this.layout()

    // 句子宽度随视口变化：重新采样（遗忘次序是确定性的，不会因此改变）
    const tw = this.textW()
    if (Math.abs(tw - this.lastTextW) > 0.25) {
      this.lastTextW = tw
      const portrait = this.camera.aspect < 1
      for (const s of this.stars) {
        const f = sampleText(s.def.text, STAR_COUNT, { maxW: tw, maxH: portrait ? 0.9 : 1.15, seed: s.i })
        s.textAttr.array.set(f.targets)
        s.textAttr.needsUpdate = true
      }
    }
  }

  /**
   * 暂停 / 恢复渲染循环。
   *
   * 为什么需要：这是 app 里的一个面板，用户可能开着它切走。
   * 一直画 = 一直烧 GPU。窗口失焦时必须停。
   */
  setPaused(p) {
    if (this.paused === p) return
    this.paused = p
    if (p) {
      this.renderer.setAnimationLoop(null)
    } else if (!this.disposed) {
      this.timer.reset?.()
      this.renderer.setAnimationLoop(() => this.tick())
    }
  }

  /**
   * 画质档位。
   *
   * 真正贵的只有两块：UnrealBloom（多级下采样 + 模糊）和 pixelRatio（像素数平方）。
   * 所以低档就是关 bloom + pixelRatio 降到 1 —— 实测这两条能省一半以上。
   *
   * 粒子数（STAR_COUNT / SNOW_COUNT）是模块常量，改不了；
   * 要动态降就得重建几何，那不值得。
   */
  setQuality(q) {
    this.quality = q
    const dpr = Math.min(devicePixelRatio || 1, q === 'low' ? 1 : q === 'mid' ? 1.5 : 2)
    this.renderer.setPixelRatio(dpr)
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(innerWidth, innerHeight)

    if (this.bloom) this.bloom.enabled = q !== 'low'
    if (this.lens) this.lens.enabled = q === 'high'
    if (this.grain) this.grain.enabled = q === 'high'

    this.resize()
  }

  dispose() {
    this.disposed = true
    this.tween?.resolve(false)
    this.tween = null
    this.renderer.setAnimationLoop(null)
    removeEventListener('pointermove', this.onMove)
    removeEventListener('resize', this.onResize)
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('touchstart', this.onTouchStart)
    this.renderer.domElement.removeEventListener('touchmove', this.onTouchMove)
    this.drone.dispose()
    this.timer.dispose?.()
    this.scene.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ───────── 遗忘机制 ─────────

  /**
   * 开始遗忘动画：粒子在 5 秒内剥落，期间可被救回
   * 对应 Habitat_App 的 effectiveWeight < MEMORY_THRESHOLD
   */
  startForgetting(starIdx) {
    const s = this.stars[starIdx]
    if (!s || s.forgetting) return
    s.forgetting = true
    s.forgettingT = 0
    s.rescuable = true
    console.log(`[Engine] 记忆开始消散：${s.def.text}`)
  }

  /**
   * 救回正在消散的记忆（5秒窗口内）
   * 物理上的挽留：粒子不再增加，但能勉强拼回来
   */
  rescueStar(starIdx) {
    const s = this.stars[starIdx]
    if (!s || !s.forgetting || !s.rescuable) return false
    s.forgetting = false
    s.rescuable = false
    s.forgettingT = 0
    s.depth = Math.max(s.depth, 0.25)
    console.log(`[Engine] 记忆被救回：${s.def.text}`)
    return true
  }

  /**
   * 主动遗忘：强制坍缩 + 带径向拖影的消散
   * 对应 forgetMemory
   */
  forceForget(starIdx) {
    const s = this.stars[starIdx]
    if (!s) return
    s.forgetting = true
    s.forgettingT = 4.5  // 跳过大部分窗口，快速消散
    s.rescuable = false
    s.depth = 0
  }

  /**
   * 压抑：不消失，沉到底部，只保留幽灵轮廓
   * 对应 suppressMemory
   */
  suppressStar(starIdx) {
    const s = this.stars[starIdx]
    if (!s) return
    s.suppressed = true
    s.depth = 0.05
  }

  /**
   * 潜意识闪回：一颗幽灵星从底部短暂浮现
   * 对应 residueHit
   */
  residueFlash(memoryDef) {
    // 找到对应的星，或创建临时幽灵
    const s = this.stars.find(x => x.def.text === memoryDef.text)
    if (s) {
      // 已有的星：短暂闪光
      s.flash = (s.flash || 0) + 1.8
      s.depth = Math.min(1, s.depth + 0.15)
    }
    // 完全消失的记忆的幽灵闪回：暂时用一个临时星（TODO：幽灵粒子系统）
    console.log(`[Engine] 潜意识闪回：${memoryDef.text}`)
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function smootherstep(x) {
  const t = Math.min(1, Math.max(0, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
