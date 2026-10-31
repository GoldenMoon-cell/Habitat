/**
 * 觉醒账本 —— 层 2 的「留痕」。
 *
 * ── 这一层是什么 ──
 *
 * 本地软件的「不可逆」防不住：用户有管理员权限，改一个 JSON 里的
 * `stage: "awakened"` 就能洗掉判决书的代价。
 *
 * 加密？密钥必须在本地，解得开。
 * 校验？只能发现，不能阻止。
 * 联网校验？违背「本地优先」，断网就打不开。
 *
 * **所以这一层不阻止，只记账。**
 *
 * ── 它记什么 ──
 *
 * 每个觉醒了哪一刻、因为什么、以及**当时她整个档案的指纹**。
 *
 * 下次打开设置重算一遍指纹：
 *   · 一样 → 没人动过
 *   · 不一样 → 这份档案被外部改过
 *
 * 然后把这件事显示出来 —— **不弹窗、不改数据、不阻止**。
 *
 * ── 真正防不住的是什么 ──
 *
 * `localStorage.removeItem('3w:awaken-ledger')` —— 一行。
 * 这比算任何哈希都简单。
 *
 * 所以这层机制防的**不是**「有预谋的绕过」，是「顺手改了一个数字
 * 却没意识到有账本」。说清楚这一点，比假装能防更重要。
 *
 * ── 会误报的地方 ──
 *
 * 用户换机器、清缓存、从备份恢复 —— 都会让指纹对不上。
 * 所以合法路径（应用内的改名、拨六维）必须**更新账本**，不算篡改。
 * 手动拷备份回来算篡改 —— 那确实是绕过。
 */

const KEY = "3w:awaken-ledger";

export interface LedgerEntry {
  /** 觉醒时间（ms） */
  at: number;
  /** 怎么觉醒的 */
  by: "creator-mode";
  /** 当时整个档案的指纹 */
  witness: string;
  /** 觉醒那一刻，她的名字（改名之后还能对上是谁） */
  name: string;
}

type Ledger = Record<string, LedgerEntry>;

function read(): Ledger {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? (p as Ledger) : {};
  } catch {
    return {};
  }
}

function write(l: Ledger) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* 存不进就放弃 —— 账本写不进去不该拖垮主流程 */
  }
}

/**
 * 档案指纹 —— 64 位 FNV-1a。
 *
 * ── 为什么不是 SHA-256 ──
 *
 * `crypto.subtle.digest` 是**异步**的。用它 `verify()` 就得变成 async，
 * 设置面板那次渲染要等一个 Promise。为了一个「有没有被顺手改过」
 * 的检查，不值得把调用链改成异步。
 *
 * ── 为什么不是 32 位 FNV ──
 *
 * 32 位的生日攻击约 2^16 次可构造。虽然「有意构造碰撞」的人直接
 * 删账本更省事，但没必要留这个口子。64 位只多三行。
 *
 * 碰撞概率：32 位 1/4.3e9 → 64 位 1/1.8e19。
 *
 * 取的是**觉醒之后不该再变的那些字段**：名字、阶段、四维。
 * 改 tagline 或颜色不算篡改 —— 那些本来就是可编辑的。
 */
export function fingerprint(p: {
  name?: string;
  stage?: string;
  axes?: Record<string, number>;
}): string {
  const parts = [
    String(p.name ?? ""),
    String(p.stage ?? ""),
    String(p.axes?.共鸣 ?? ""),
    String(p.axes?.锐度 ?? ""),
    String(p.axes?.幽默 ?? ""),
    String(p.axes?.严谨 ?? ""),
  ];
  const s = parts.join("\u0001");

  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

/** 记一次觉醒 */
export function recordAwaken(
  id: string,
  p: { name?: string; stage?: string; axes?: Record<string, number> }
) {
  const l = read();
  l[String(id)] = {
    at: Date.now(),
    by: "creator-mode",
    witness: fingerprint(p),
    name: String(p.name ?? ""),
  };
  write(l);
}

/**
 * 更新某条记录的指纹 —— 用于**合法路径**。
 *
 * 应用内改了名字、拨了六维（签过字的），账本要跟着走，
 * 否则下一次打开设置就会把这些正常操作报成「篡改」。
 */
export function refreshWitness(
  id: string,
  p: { name?: string; stage?: string; axes?: Record<string, number> }
) {
  const l = read();
  const e = l[String(id)];
  if (!e) return;
  e.witness = fingerprint(p);
  e.name = String(p.name ?? e.name);
  write(l);
}

export interface TamperReport {
  id: string;
  /** 账本里记的名字 */
  name: string;
  /** 觉醒时间 */
  at: number;
}

/**
 * 校验：哪些角色的档案和账本对不上。
 *
 * 只在**打开设置时**跑一次 —— 不是监控，是自检。
 */
export function verify(personas: {
  id: string;
  name?: string;
  stage?: string;
  axes?: Record<string, number>;
}[]): TamperReport[] {
  const l = read();
  const out: TamperReport[] = [];
  for (const p of personas) {
    const e = l[String(p.id)];
    if (!e) continue;
    if (fingerprint(p) !== e.witness) {
      out.push({ id: String(p.id), name: e.name || String(p.name ?? p.id), at: e.at });
    }
  }
  return out;
}

/** 这个角色有没有觉醒记录 */
export function ledgerOf(id: string): LedgerEntry | undefined {
  return read()[String(id)];
}

/**
 * 删掉一个角色的账本记录。
 *
 * ── 为什么删角色的时候要顺手清 ──
 *
 * 1. **不留孤儿。** 账本里堆着十个已删除角色的记录，虽然不影响功能，
 *    但那是脏数据。
 *
 * 2. **避免误伤重建。** 如果之后又建了一个 id 相同的角色
 *    （`samplePersonas` 里的 id 是固定的：`gpt` / `claude` …），
 *    新角色的指纹和旧记录对不上 —— 会被报成「档案被外部修改过」。
 *
 * ── 删了再建算不算洗掉代价 ──
 *
 * **不算。** 旧的确实消失了，新的是一个新的人。
 * 判决书针对的是那一个具体的她，不是这个 id。
 */
export function forgetPersona(id: string) {
  const l = read();
  if (!(String(id) in l)) return;
  delete l[String(id)];
  write(l);
}

export function clearLedger() {
  write({});
}
