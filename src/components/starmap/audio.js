/**
 * 空壳 Drone —— 接口与沙盒版一致，但不出声。
 *
 * 为什么不用原实现：
 *   Habitat_App 已有自己的音效系统（src/lib/sound.ts）。
 *   两套同时响会打架，而且原版是给独立页面设计的常驻底噪，
 *   在 app 里作为面板出现时不该自己起一条 drone。
 *
 * 要接音效就走 app 的 sound.ts，不要在这里加。
 */
export class Drone {
  bloom() {}
  remember(_m) {}
  forget() {}
  dive(_d) {}
  surface(_d) {}
  setMuted(_m) {}
  dispose() {}
}
