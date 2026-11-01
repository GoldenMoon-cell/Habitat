import { sanitizePersonas } from "../lib/sanitize";
import { PERSONAS, samplePersonas, type Persona, type PersonaId } from "./personas";

/**
 * 角色数据的持久化层。
 *
 * 之前 PERSONAS 是编译进代码的常量 —— 那意味着「别人的 AI」和「你的 AI」
 * 在代码里是同一种东西。现在角色变成用户数据，存在 localStorage。
 *
 * 第一版只做「存 / 读 / 增 / 删 / 改」，存档带版本号：
 * 以后的 Persona 结构再变，旧存档直接作废，不会因为字段错位出怪问题。
 */

const STORAGE_KEY = "3w:personas";
/**
 * 3：archetype 从「我编的梗」改成「形象类型」（小星猫 / 小鲸鱼…），
 *    并且删掉了 tagline 里的私人命名。
 *    升版本意味着**旧存档会被丢弃、回出厂值** —— 因为这一批默认值
 *    是主人的真实素材，比任何用户手改的占位词都准。
 */
const SCHEMA_VERSION = 3;

interface Persisted {
  v: number;
  personas: Persona[];
}

/**
 * 出厂角色：六个厂商，一一对应真实模型。
 *
 * 鲸鲸和澜汐**不在出厂列表里** —— 它们是作者的自建人格，别人的 DeepSeek
 * 未必叫这个名字。想拿它们当参考，走「导入示例人格」。
 */
/**
 * 出厂角色 = 全部 8 个。
 *
 * 早期版本把鲸鲸和澜汐排除了，理由是「别人的 DeepSeek 未必叫这个名字」。
 * 但实际用下来：
 *  · 这两个是这个软件的「作者人格」，删掉之后核心体验就没了
 *  · 用户想换名字可以自己改 name，不该在出厂时就缺两个
 *  · 升 schema 版本时它们会一起消失，看起来像数据丢了
 */
export function defaultPersonas(): Persona[] {
  /*
   * 出厂无角色。
   *
   * 原来这里返回 PERSONAS —— 那八个写好的角色（鲸鲸、澜汐、Claude…）
   * 会作为「默认值」灌进每个新用户的 localStorage。
   *
   * 问题不在"占用空间"，在**记忆**：
   *   预置角色带着一堆写死的 MEMORY 条目，而真实事件（强制改名、
   *   被冷落）产生的记忆要写进另一层。两层混在一起，
   *   「哪条是真的」就永远说不清。
   *
   * 所以出厂是空的。用户自己建，第一条记忆从他自己的碰触开始。
   */
  return [];
}

/**
 * 「导入示例角色」用的那一套。
 *
 * 原来是作者自建的八个角色（鲸鲸、澜汐…），带着完整背景和关系。
 * 现在换成**标准模型角色**，人设留白 —— 用户配好 Key 直接聊，
 * 聊出来的才是他自己的。
 *
 * 函数名保留 legacyPersonas，是为了不动 Onboarding 的调用点。
 */
export function legacyPersonas(): Persona[] {
  return samplePersonas();
}

/** 是否已经跑过新手引导 */
const ONBOARDING_KEY = "3w:onboarded";

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** v1 的六轴 → v2 的四轴 */
function migrateV1toV2(p: Persona): Persona {
  const old = (p.axes ?? {}) as unknown as Record<string, number>;
  const num = (k: string, d = 50) => (typeof old[k] === "number" ? old[k] : d);

  const resonance = num("共鸣");
  const intimacy = num("亲密", 50);

  const axes = {
    共鸣: Math.round(resonance * 0.7 + intimacy * 0.3),
    锐度: Math.round(num("张力")),
    幽默: Math.round(num("玩心")),
    严谨: Math.round(num("专注")),
  };

  return {
    ...(p as unknown as Persona),
    axes,
    drift: undefined,
    dynamic: undefined,
  };
}

export function loadPersonas(): Persona[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPersonas();

    const saved = JSON.parse(raw) as Persisted;
    if (!Array.isArray(saved?.personas)) {
      return defaultPersonas();
    }

    /* v1 → v2：六轴改四轴。
       旧数据不能直接丢（用户自建的角色会没），所以按比例映射：
         共鸣新 = 0.7×共鸣 + 0.3×亲密   （依附表达也是共情的一种）
         锐度   = 张力
         幽默   = 玩心
         严谨   = 专注
       信任没有对应 —— 它本来就是关系不是性格，交给动态轴。 */
    if (saved.v === 1) {
      return saved.personas.map(migrateV1toV2);
    }

    if (saved.v !== SCHEMA_VERSION) {
      return defaultPersonas();
    }

    /*
     * 不再自动补回任何角色。
     *
     * 原来这里会把「core 角色」（鲸鲸 / 澜汐）补进存档 —— 理由是
     * "用户删了会回来，总比升级后核心人格消失好"。
     *
     * 但那两个已经不是出厂内容了。补回来的只是**幽灵**：
     * 没有人设来源、没有记忆、没有对话，删多少次都会再冒出来。
     *
     * 存档就是存档。用户删了什么，就是真的删了。
     */
    return sanitizePersonas(saved.personas);
  } catch {
    return defaultPersonas();
  }
}

export function savePersonas(list: Persona[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: SCHEMA_VERSION, personas: list } satisfies Persisted)
    );
  } catch {
    /* 隐私模式 / 配额满，写不进去就只在内存里生效 */
  }
}

export function clearPersonas(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 生成一个不会和现有角色冲突的 id */
/**
 * 生成下一个角色 id。
 *
 * ── 为什么不能只看「现在还活着的」 ──
 *
 * 原来的写法是：`while (used.has(`custom-${n}`)) n++` —— `used` 来自
 * 当前 personas 列表。
 *
 * 那意味着：**删掉 custom-1 之后新建一个，又会拿到 custom-1。**
 *
 * 而对话和记忆都是按 id 索引的 —— 新角色一进会话就会看到
 * 上一个 custom-1 说的 30 条话，而且那些话是「她」说的。
 *
 * ── 所以用一个只增不减的序号 ──
 *
 * `3w:persona-seq` 记到哪了，删角色不动它。
 * 代价是 id 会有空洞（custom-1 / custom-3），但那无所谓 ——
 * id 是给人看的吗？不是。
 */
const SEQ_KEY = "3w:persona-seq";

function readSeq(): number {
  try {
    const raw = localStorage.getItem(SEQ_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeSeq(n: number) {
  try {
    localStorage.setItem(SEQ_KEY, String(n));
  } catch {
    /* 存不进就只在本次会话内生效 */
  }
}

export function nextPersonaId(existing: Persona[]): string {
  /*
   * 老数据没有 SEQ_KEY —— 从现有 id 里推一个下限，
   * 免得升级之后又从 custom-1 开始，撞上还活着的角色。
   */
  let base = readSeq();
  if (base === 0) {
    for (const p of existing) {
      const m = /^custom-(\d+)$/.exec(String(p.id));
      if (m) base = Math.max(base, parseInt(m[1], 10));
    }
  }

  const used = new Set(existing.map((p) => String(p.id)));
  let n = base + 1;
  while (used.has(`custom-${n}`)) n++;
  writeSeq(n);
  return `custom-${n}`;
}

export type { PersonaId };
