/**
 * 你自己是谁。
 *
 * ── 为什么需要这个 ──
 *
 * `mock.ts` 里 `OWNER.name = "主人"` 是硬编码的。
 * 所有角色都管用户叫「主人」—— **用户在这个世界里没有自己的身份**。
 *
 * ── 为什么名字不可改 ──
 *
 * **① 名字是「你是谁」的最小单位。改了就换人了。**
 *
 * **② 更实际的理由：记忆里全是旧名字。**
 * 她记得「主人今天吃了泡面」—— 你把名字改成「阿澈」之后，
 * 那条记忆里的「主人」指谁？**指代不清。**
 *
 * **③ 和「强制改名」是同一套哲学：改名有代价。**
 *
 * 区别是：**角色的名字可以被你改，你的名字没人能改。**
 *
 * ── 形象和性格是选填的 ──
 *
 * 不强迫。可以留空，之后在对话里自然形成。
 * （「她眼里的你」那一栏是从记忆里摘的，不是这里填的。）
 */

const KEY = "3w:profile";

export interface Profile {
  /** 你的名字 —— **定下之后不可改** */
  name: string;
  /** 定名时间（真实时间戳） */
  at: number;
  /**
   * 选填的自我描述。
   *
   * 填了会进 prompt：`对方叫 X。他看起来……，说话的方式……`
   *
   * **留空也完全正常** —— 大部分人不填。
   */
  look?: string;
  trait?: string;
}

function read(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.name !== "string" || !p.name.trim()) return null;
    return {
      name: p.name,
      at: typeof p.at === "number" ? p.at : Date.now(),
      look: typeof p.look === "string" ? p.look : undefined,
      trait: typeof p.trait === "string" ? p.trait : undefined,
    };
  } catch {
    return null;
  }
}

function write(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** 读档案。没有就是 null —— 迁移期的老用户会拿到 null。 */
export function readProfile(): Profile | null {
  return read();
}

/**
 * 定名。
 *
 * **只有第一次有效** —— 已经定过就返回 false，不改。
 *
 * 那不是「防误触」，是「这个名字就只有一次机会」。
 */
export function claimName(name: string): boolean {
  const clean = name.trim().slice(0, 12);
  if (!clean) return false;
  if (read()) return false;
  write({ name: clean, at: Date.now() });
  return true;
}

/**
 * 补形象 / 性格。
 *
 * 名字动不了，这两个随时可以补 —— 也可以在对话里慢慢长出来。
 */
export function updateLooks(look?: string, trait?: string): boolean {
  const p = read();
  if (!p) return false;
  write({
    ...p,
    look: look?.trim() ? look.trim().slice(0, 40) : p.look,
    trait: trait?.trim() ? trait.trim().slice(0, 40) : p.trait,
  });
  return true;
}

/**
 * 她该怎么叫你。
 *
 * 没有档案时兜底「主人」—— 那是改名前的默认，
 * 老用户的记忆里全是这个词，不能突然断掉。
 */
export function ownerName(): string {
  return read()?.name ?? "主人";
}

/** 有没有定过名 */
export function hasProfile(): boolean {
  return read() !== null;
}
