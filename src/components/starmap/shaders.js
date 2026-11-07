// ───────────────────────── common ─────────────────────────

const SNOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
    i.z+vec4(0.0,i1.z,i2.z,1.0))
    +i.y+vec4(0.0,i1.y,i2.y,1.0))
    +i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`

// 海洋雪：缓慢下沉，循环；横向漂移；边缘淡出。

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uDescent;
uniform float uTransit;
uniform float uPixelRatio;
uniform float uFocus;
uniform vec3  uMouse;
uniform float uMouseStrength;
uniform float uDim;          // 有记忆被打开时，整片海暗下去

// 从外面看时，把整片海收成一团不规则的余烬
float orbFade(vec3 p){
  float s = smoothstep(0.25, 0.9, uTransit);
  if (s <= 0.0) return 1.0;
  float r = length(p / vec3(6.5, 3.8, 3.0));
  r += snoise(p * 0.3 + vec3(0.0, uTime * 0.04, 0.0)) * 0.28;
  return mix(1.0, exp(-r * r * 1.8) * 1.15, s);
}

// 海洋雪的运动：缓慢下沉、循环、横向漂移
vec3 sink(vec3 base, vec4 r, vec3 box, out float edge){
  float fall = 0.03 + r.x * 0.07;
  float h = box.y;
  float y = mod(base.y + h * 0.5 - uTime * fall + uDescent * (0.7 + r.x * 0.6), h);
  edge = smoothstep(0.0, 0.1 * h, y) * smoothstep(h, 0.9 * h, y);
  vec3 p = base;
  p.y = y - h * 0.5;
  float t = uTime * (0.05 + r.y * 0.06);
  p.x += sin(t + r.z * 6.2831) * 0.25 + sin(t * 2.3 + r.w * 9.0) * 0.07;
  p.z += cos(t * 0.8 + r.w * 6.2831) * 0.2;
  return p;
}

// 景深：偏离焦平面的点变大、变淡，能量守恒
float dof(float depth, float baseSize, inout float alpha){
  float coc = abs(depth - uFocus) / depth;
  float size = min(baseSize * uFocus / depth + coc * 24.0, 70.0);
  alpha *= min(1.0, pow(2.4 / size, 1.4));
  return size;
}
`

// ───────────────────────── 宏观：海雪 ─────────────────────────
// 灰的、旧的、已经没人认得的东西。悬停时被星吸过去，炸开时被冲散。

export const snowVertex = /* glsl */ `
${SNOISE}
${COMMON}
uniform vec3  uBox;
uniform vec3  uBoxCenter;
uniform vec4  uAttract;      // xyz 被悬停的星，w 强度
uniform vec4  uShock;        // xyz 炸开的位置，w 已经过去的秒数（<0 表示没有）
attribute vec4 aRand;
attribute float aRand2;
varying vec3  vColor;
varying float vAlpha;

void main(){
  float edge;
  vec3 pos = sink(position, aRand, uBox, edge) + uBoxCenter;

  // 被星吸引：向它旋进
  vec3 toS = uAttract.xyz - pos;
  float dS = length(toS);
  float pull = uAttract.w * smoothstep(3.2, 0.3, dS) * (0.4 + aRand.y * 0.6);
  vec3 tang = normalize(cross(toS, vec3(0.0, 0.0, 1.0)) + 1e-4);
  pos += (normalize(toS) * min(dS - 0.25, 1.2) * 0.55 + tang * 0.35) * pull;

  // 炸开的冲击波：一圈向外推的壳
  float shockGlow = 0.0;
  if (uShock.w >= 0.0) {
    vec3 d = pos - uShock.xyz;
    float r = length(d);
    float front = uShock.w * 5.5;
    float shell = exp(-pow((r - front) * 1.6, 2.0)) * exp(-uShock.w * 0.9);
    pos += normalize(d + 1e-4) * shell * 0.9;
    shockGlow = shell;
  }

  // 鼠标
  vec3 dm = pos - uMouse;
  float infl = exp(-dot(dm.xy, dm.xy) * 1.2) * uMouseStrength * smoothstep(5.0, 0.0, abs(dm.z));
  pos.xy += normalize(dm.xy + 1e-4) * infl * 0.4;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;

  // 极少数仍会发出一点生物光
  float flash = pow(max(0.0, sin(uTime * (0.2 + aRand.w * 0.5) + aRand2 * 60.0)), 60.0) * step(0.9, aRand.y);

  vec3 col = mix(vec3(0.26, 0.31, 0.36), vec3(0.40, 0.75, 0.90), flash);
  col = mix(col, vec3(0.55, 0.85, 1.0), clamp(pull * 1.4 + shockGlow + infl * 0.6, 0.0, 1.0));

  float alpha = (0.07 + aRand.x * 0.12 + flash * 0.6) * edge;
  alpha += pull * 0.18 + shockGlow * 0.35 + infl * 0.2;
  alpha *= mix(1.0, 0.32, uDim);
  alpha *= smoothstep(0.6, 2.2, depth);
  float size = dof(depth, 1.1 + aRand.z * 1.8 + flash * 1.5, alpha);
  gl_PointSize = size * uPixelRatio;
  alpha *= orbFade(pos);

  vColor = col;
  vAlpha = alpha;
}
`

export const pointFragment = /* glsl */ `
varying vec3  vColor;
varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float s = smoothstep(0.5, 0.0, d);
  s = s * s * (0.6 + 0.4 * s);
  gl_FragColor = vec4(vColor * vAlpha * s, 1.0);
}
`

// ───────────────────────── 记忆星辰 ─────────────────────────
// 一颗星 = 一团被压紧的海雪。展开就是那句话；掉下去的部分，永远成为海雪。

export const starVertex = /* glsl */ `
${SNOISE}
${COMMON}
uniform vec3  uPos;          // 星的位置（返航时在飞）
uniform vec3  uVel;          // 星的速度，用来拖出彗尾
uniform vec3  uTextCenter;
uniform vec3  uTint;
uniform vec3  uSnowBox;
uniform vec3  uSnowCenter;
uniform float uForm;         // 0 = 星，1 = 句子
uniform float uDir;          // 1 = 正在炸开成字，0 = 正在坍缩回星
uniform float uHold;         // 按住的紧密程度
uniform float uHover;        // 悬停：星压缩成一个字
uniform float uFlash;
uniform float uCohesion;     // 牢固程度
uniform float uEngrave;      // 刻进去、永远不会掉的比例
uniform float uLightS;       // 别的星被打开时，这颗暗下去
uniform float uDepth;        // 记忆深度 0-1：展开后字的亮度和清晰度
uniform float uLayerAlpha;   // 分层可见度：< 0.1 时不渲染（避免 bloom）

attribute vec3  aText;
attribute vec3  aGlyph;
attribute vec4  aRand;
attribute float aHalo;
attribute float aSeed;       // 遗忘次序：越小越先掉
attribute float aLostAt;     // 掉落的时刻；很大 = 还没掉

varying vec3  vColor;
varying float vAlpha;

vec3 bez(vec3 a, vec3 b, vec3 c, float t){
  float u = 1.0 - t;
  return u * u * a + 2.0 * u * t * b + t * t * c;
}

void main(){
  // 分层剔除：当 uLayerAlpha < 0.1 时，把粒子移出视锥外
  if (uLayerAlpha < 0.1) {
    gl_Position = vec4(0.0, 0.0, -10.0, 1.0);  // 移到相机后面
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vAlpha = 0.0;
    return;
  }

  float coh = uCohesion;
  float engraved = step(1.0 - uEngrave, aSeed);
  float looseness = (1.0 - coh) * (1.0 - engraved);

  // ── 星：致密的核 + 一圈慢慢转的晕 ──
  vec3 lp = position;
  float ang = uTime * mix(0.05, 0.22 + aRand.x * 0.25, aHalo);
  float cs = cos(ang), sn = sin(ang);
  lp.xz = mat2(cs, -sn, sn, cs) * lp.xz;
  float beat = pow(sin(uTime * 1.15 + aRand.w * 0.4) * 0.5 + 0.5, 10.0);
  lp *= mix(1.0, 1.75, looseness * aHalo) * (1.0 + beat * 0.05);
  lp += vec3(snoise(position * 2.0 + uTime * 0.15), snoise(position * 2.0 - uTime * 0.13), 0.0) * looseness * 0.22;
  vec3 ball = uPos + lp;
  vec3 glyph = uPos + aGlyph;
  vec3 home = mix(ball, glyph, uHover * mix(1.0, 0.65, aHalo));
  // 彗尾：飞行时粒子按随机延迟落在后面
  home -= uVel * (0.04 + aRand.y * 0.26);

  // ── 句子 ──
  float loose = mix(mix(0.16, 0.035, coh), 0.0, uHold) * (1.0 - engraved);
  vec3 text = uTextCenter + aText + vec3(
    snoise(aText * 1.1 + vec3(uTime * 0.12, 0.0, 0.0)),
    snoise(aText * 1.1 + vec3(0.0, uTime * 0.12, 5.0)),
    snoise(aText * 1.1 + vec3(9.0, 0.0, uTime * 0.12)) * 0.5
  ) * loose;
  text.z += snoise(aText * 1.3 + vec3(0.0, 0.0, uTime * 0.1)) * 0.03;

  // ── 两条路径：炸开 / 坍缩 ──
  float st = aRand.x * 0.6 + aSeed * 0.4;
  float k = clamp((uForm - st * 0.3) / 0.7, 0.0, 1.0);
  vec3 pos;
  if (uDir > 0.5) {
    // 炸开成字：home → 爆炸控制点 → text
    float e = 1.0 - pow(1.0 - k, 3.0);
    vec3 burst = normalize(position + (aRand.yzw - 0.5) * 0.35 + 1e-4);
    vec3 ctrl = ball + burst * (1.3 + aRand.y * 2.4);
    pos = bez(home, ctrl, text, e);
  } else {
    // 坍缩回星：text → 噪声控制点 → home
    // 每个粒子用自己专属的噪声偏移，形成有机的汇聚而不是统一的旋涡
    float t_c = 1.0 - k;
    float e = t_c * t_c;    // ease-in：粒子慢慢松脱，最后猛地被吸进去
    vec3 noise = vec3(
      snoise(position * 1.8 + vec3(19.3, 0.0, 0.0)),
      snoise(position * 1.8 + vec3(0.0, 7.1, 0.0)),
      snoise(position * 1.8 + vec3(0.0, 0.0, 13.7))
    );
    // 控制点：往 home 方向偏移 35%，再加上随机横向偏移
    float spread = 0.6 + length(text - home) * 0.18;
    vec3 ctrl = mix(text, home, 0.35) + noise * spread;
    pos = bez(text, ctrl, home, e);
  }
  float formed = k;

  // ── 掉落：从字上剥下来，变灰，沉进海雪，再也不回来 ──
  float age = uTime - aLostAt;
  float lost = step(0.0, age);
  float ashK = 0.0;
  float snowEdge = 1.0;
  if (lost > 0.5) {
    vec3 p0 = uTextCenter + aText;
    float fall = 1.7 * (1.0 - exp(-age * 1.1)) + age * (0.03 + aRand.x * 0.05);
    float spread = 1.0 - exp(-age * 0.035);
    vec3 lpos = p0;
    lpos.x += (aRand.z - 0.5) * 15.0 * spread + snoise(vec3(aText.xy, age * 0.05)) * 0.6 * spread;
    lpos.z += (aRand.w - 0.5) * 9.0 * spread;
    float bottom = uSnowCenter.y - uSnowBox.y * 0.5;
    float y = mod(p0.y - fall + uDescent * (0.7 + aRand.x * 0.6) - bottom, uSnowBox.y);
    snowEdge = smoothstep(0.0, 0.1 * uSnowBox.y, y) * smoothstep(uSnowBox.y, 0.9 * uSnowBox.y, y);
    lpos.y = bottom + y;
    float t = uTime * (0.05 + aRand.y * 0.06);
    lpos.x += sin(t + aRand.z * 6.2831) * 0.25 * spread;
    pos = lpos;
    ashK = smoothstep(0.0, 2.4, age);
    formed = 0.0;
  }

  // 鼠标（只轻轻推开还在星里的部分）
  vec3 dm = pos - uMouse;
  float infl = exp(-dot(dm.xy, dm.xy) * 1.4) * uMouseStrength * (1.0 - formed) * (1.0 - lost);
  pos.xy += normalize(dm.xy + 1e-4) * infl * 0.18;

  // ── 颜色 ──
  float flick = clamp(1.0 + looseness * 0.9 * snoise(vec3(aRand.xy * 30.0, uTime * 1.6)), 0.15, 1.6);
  vec3 cStar = uTint * (1.0 + beat * 0.25);

  // depth 只影响颜色色温，不再大幅压低 alpha
  // depth=1（清晰）→ 偏暖白；depth=0（朦胧）→ 偏冷蓝
  // [改] 原本混 0.5 向白蓝 —— 展开的字看不出分类。降到 0.18
  vec3 cTextFull  = mix(uTint, vec3(0.88, 0.96, 1.0), 0.18);
  vec3 cTextFaded = mix(uTint * 0.55, vec3(0.42, 0.58, 0.78), 0.6);
  vec3 cText = mix(cTextFaded, cTextFull, uDepth);

  /*
   * [改] 字必须**能读**。
   *
   * 星可以靠加色叠加发亮，字不行 —— 字是 11000 个粒子拼出来的轮廓，
   * 每个粒子只出一次力。所以直接按 tint 上色的话，
   * 深蓝的「长期」（0.04,0.20,1.00）拼出来几乎看不见。
   *
   * 归一化到最大通道 = 0.95：色相留着，亮度拉满。
   */
  float tmx = max(max(cText.r, cText.g), cText.b);
  cText *= 0.95 / max(tmx, 0.001);

  vec3 cHeld = vec3(1.0, 0.93, 0.80);
  // [改] 原本 (1.0,0.84,0.58) 暖白 —— 和 tint 差太远，一混就灰
  vec3 cEngr = vec3(1.0, 0.90, 0.74);
  vec3 cAsh  = vec3(0.26, 0.30, 0.35);
  vec3 col = mix(cStar, mix(cText, cHeld, uHold), formed);
  // [改] 原本 engraved * 0.85 —— 固化的记忆会被拉向暖白，色相全丢。降到 0.28
  col = mix(col, mix(cEngr, uTint, 0.45), engraved * 0.28);
  col *= flick;

  // [改] 原本 0.15 / 0.08 —— 最亮的星叠加后 RGB 全到 255，色相被锁死。
  // 压到 0.105 / 0.062：峰值降下来，蓝/青的色相才留得住。
  float aBall = mix(0.105, 0.062, aHalo);
  float aStar = mix(aBall, 0.038, uHover);
  // alpha 主要由 mass（粒子数）决定，depth 只做轻微的 0.03 衰减
  // [改] 原本 0.10 / 0.15 —— 展开后偏暗。提到 0.16 / 0.22
  float aText_ = mix(0.16, 0.22, uHold) + engraved * 0.05 - (1.0 - uDepth) * 0.03;
  float alpha = mix(aStar, aText_, formed);
  alpha *= 1.0 + uFlash * 2.5 * (1.0 - formed * 0.6);
  alpha *= uLightS;

  if (lost > 0.5) {
    col = mix(cText * 1.3, cAsh, ashK);
    float aSnow = (0.07 + aRand.x * 0.12) * snowEdge * mix(1.0, 0.32, uDim);
    alpha = mix(0.22, aSnow, ashK);
  }
  alpha += infl * 0.2;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  float base = mix(1.25 + aRand.z * 1.0, 0.95 + aRand.z * 0.8, formed);
  if (lost > 0.5) base = mix(1.0, 1.1 + aRand.z * 1.8, ashK);
  float size = dof(depth, base, alpha);
  gl_PointSize = size * uPixelRatio;
  alpha *= orbFade(pos);

  vColor = col;
  vAlpha = alpha;
}
`

// ───────────────────────── background water ─────────────────────────

export const bgVertex = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

export const bgFragment = /* glsl */ `
${SNOISE}
uniform float uTime;
uniform float uAspect;
uniform vec2  uMouseNdc;
uniform float uMouseStrength;
uniform float uDim;
uniform float uTransit;
uniform vec2  uFocusNdc;     // 打开的那句话所在的屏幕位置
uniform float uScrollY;      // 0=海床, 1=海面（scrollY 归一化后）
varying vec2 vUv;
void main(){
  vec2 uv = vUv;

  // uScrollY: 1=海面(亮蓝), 0=海床(暗红棕)
  float depthFactor = clamp(uScrollY, 0.0, 1.0);

  // 海床底部：极暗，暖红棕沉积色
  vec3 floorBot = vec3(0.022, 0.007, 0.005);
  // 海床顶部（画面上方）：仍暗，但微微透出蓝灰
  vec3 floorTop = vec3(0.018, 0.014, 0.018);

  // 海面底部：深蓝
  vec3 surfBot  = vec3(0.004, 0.042, 0.110);
  // 海面顶部：降低亮度，避免过曝
  vec3 surfTop  = vec3(0.008, 0.070, 0.150);

  // 按深度混合底色和顶色
  vec3 botCol = mix(floorBot, surfBot, depthFactor);
  vec3 topCol = mix(floorTop, surfTop, depthFactor);
  // 垂直渐变：uv.y=0 是画面底部，uv.y=1 是顶部
  vec3 col = mix(botCol, topCol, pow(uv.y, 1.6));

  vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y);
  float ang = atan(p.x - 0.15, 1.6 - p.y);
  float rays = snoise(vec3(ang * 9.0, uTime * 0.035, 0.0)) * 0.5 + 0.5;
  rays *= snoise(vec3(ang * 23.0, uTime * 0.06, 4.0)) * 0.5 + 0.5;
  rays = pow(rays, 2.2) * smoothstep(0.15, 1.0, uv.y);
  // 光线在海面层更强
  float rayBright = mix(0.6, 1.8, smoothstep(0.6, 1.0, uScrollY));
  col += vec3(0.018, 0.058, 0.078) * rays * rayBright;

  float murk = snoise(vec3(p * 1.6, uTime * 0.02)) * 0.5 + 0.5;
  col *= 0.75 + murk * 0.5;

  // 海床沉积物：在画面底部加一层
  float sediment = smoothstep(0.3, 0.0, uScrollY) * smoothstep(0.0, 0.25, 1.0 - uv.y);
  col += vec3(0.004, 0.002, 0.001) * sediment;

  // 有记忆被打开时，海暗下去，只在那句话后面留一点光
  col *= mix(1.0, 0.4, uDim);
  vec2 f = vec2(uFocusNdc.x * 0.5 * uAspect, uFocusNdc.y * 0.5 + 0.5);
  vec2 q = vec2((uv.x - 0.5) * uAspect, uv.y);
  col += vec3(0.006, 0.016, 0.024) * exp(-dot(q - f, q - f) * 4.0) * uDim;

  vec2 m = vec2(uMouseNdc.x * 0.5 * uAspect, uMouseNdc.y * 0.5 + 0.5);
  float md = length(q - m);
  col += vec3(0.008, 0.040, 0.052) * exp(-md * md * 18.0) * uMouseStrength;

  // 进出：穿过水面的一层浅亮；外面是虚空
  float surface = exp(-pow((uTransit - 0.42) * 7.0, 2.0));
  col += vec3(0.020, 0.075, 0.100) * surface * smoothstep(0.0, 1.0, uv.y);
  col *= 1.0 - smoothstep(0.35, 0.75, uTransit);

  gl_FragColor = vec4(col, 1.0);
}
`

// ───────────────────────── post ─────────────────────────

export const lensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0016 },
    uDesat: { value: 0 },
    uZoomBlur: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uDesat;
    uniform float uZoomBlur;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      // 水的折射，极轻
      uv.x += sin(uv.y * 14.0 + uTime * 0.5) * 0.0007;
      uv.y += cos(uv.x * 11.0 + uTime * 0.4) * 0.0006;
      vec2 dir = uv - 0.5;
      float r2 = dot(dir, dir);
      vec2 off = dir * uAberration * (0.4 + r2 * 4.0);
      vec3 col;
      if (uZoomBlur > 0.001) {
        // 推拉时的径向拖影
        col = vec3(0.0);
        for (int i = 0; i < 12; i++) {
          float s = 1.0 - uZoomBlur * float(i) / 11.0;
          vec2 q = 0.5 + dir * s;
          col.r += texture2D(tDiffuse, q + off).r;
          col.g += texture2D(tDiffuse, q).g;
          col.b += texture2D(tDiffuse, q - off).b;
        }
        col /= 12.0;
      } else {
        col.r = texture2D(tDiffuse, uv + off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - off).b;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), uDesat);
      float vig = smoothstep(1.05, 0.25, length(dir * vec2(1.15, 1.0)));
      col *= mix(0.25, 1.0, vig);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export const grainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAmount: { value: 0.035 },
  },
  vertexShader: lensShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAmount;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float n = hash(vUv * 1024.0 + fract(uTime * 7.13) * 100.0) - 0.5;
      col += n * uAmount;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}
