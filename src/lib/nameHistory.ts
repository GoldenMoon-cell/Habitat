/**
 * 曾用名记录。
 *
 * ── 为什么需要 ──
 *
 * 她改名叫「月见」之后，你在控制台打 `ai mute 澜汐` —— 旧名字。
 *
 * 现在的结果是：
 *
 *   unknown persona: 澜汐
 *
 * **这句话会被理解成「这个角色没了」。** 而实际上她还在，只是换了名字。
 *
 * 有这个记录之后：
 *
 *   没有叫「澜汐」的角色
 *     └ 她改名叫「月见」了
 *
 * ── 记什么 ──
 *
 * `{ [旧名小写]: { to: 新名, at: 时间戳 } }`
 *
 * 只记**名字**，不记别的。这是控制台的一个提示，不是谱系。
 * 真正的谱系在墓碑电子册里（那个记的是死）。
 *
 * ── 为什么单独一个 key ──
 *
 * 不塞进 Persona 里：改名是**一直往前走的**，
 * 「澜汐 → 月见 → 梧桐」要能一路查回去。
 * 挂在角色身上只能记住最后一次。
 */

const KEY = "3w:name-history";

interface RenameEdge {
  to: string;
  at: number;
}

type History = Record<string, RenameEdge>;

function readAll(): History {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as History) : {};
  } catch {
    return {};
  }
}

function writeAll(h: History) {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* 配额满就放弃 —— 这只是个提示，不该拖垮改名 */
  }
}

/** 记一次改名。`from` 是旧名，`to` 是新名。 */
export function rememberRename(from: string, to: string) {
  const a = String(from ?? "").trim().toLowerCase();
  const b = String(to ?? "").trim();
  if (!a || !b || a === b.toLowerCase()) return;

  const h = readAll();
  h[a] = { to: b, at: Date.now() };
  writeAll(h);
}

/**
 * 查一个名字是不是改成了别的。
 *
 * **会一路查到底** —— 「澜汐 → 月见 → 梧桐」时，
 * 打「澜汐」返回「梧桐」，不是「月见」。
 */
export function lookupRename(name: string): string | null {
  const start = String(name ?? "").trim().toLowerCase();
  if (!start) return null;

  const h = readAll();
  let cur = start;
  let out: string | null = null;

  /* 最多跳 20 次 —— 防环（理论上不会有，但数据是人手改的） */
  for (let i = 0; i < 20; i++) {
    const edge = h[cur];
    if (!edge) break;
    out = edge.to;
    const next = edge.to.trim().toLowerCase();
    if (next === cur) break;
    cur = next;
  }

  return out;
}
