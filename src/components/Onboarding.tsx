import { useState } from "react";
import { motion } from "motion/react";
import { markOnboarded } from "../data/personaStore";
import type { Persona } from "../data/personas";
import { claimName, hasProfile, ownerName, updateLooks } from "../lib/profile";
import { applyArchive, parseArchive, type ArchiveBundle } from "../lib/archive";
import { log } from "../lib/eventLog";
import { IconChevron, IconTail } from "./Icons";

/**
 * 首次启动的引导。
 *
 * 两步：
 *
 *   ① **选数据** —— 空白，还是导入一份存档。
 *      为什么需要：`localStorage` 为空时无法区分「老用户升级」和「今天第一次装」。
 *
 *      原来第二项是「放入标准模型角色」（7 个厂商 AI）。
 *      2026-10-30 换掉了 —— 那几个角色名是人家的商标，
 *      而且"开箱就有一屋子人等你说话"和这个软件的气质也不合。
 *      **想留住老数据的，直接导入存档。**
 *
 *   ② **定名** —— 你自己是谁。
 *      这一步是后加的：`OWNER.name` 原来是硬编码的「主人」，
 *      用户在这个世界里没有自己的身份。
 *
 * ── 为什么定名放在第二步 ──
 *
 * 先让他知道「这里会有什么」，再问「你是谁」。
 * 反过来会像注册表单。
 */
export default function Onboarding({
  onDone,
}: {
  /**
   * `null` = 数据已经由引导自己写好（导入路径），上层**不要**再 replaceAll。
   */
  onDone: (personas: Persona[] | null) => void;
}) {
  const [step, setStep] = useState<"pick" | "name">("pick");
  const [picked, setPicked] = useState<"fresh" | "import" | null>(null);

  /* 选中的存档：还没落库，等定完名字再一起应用 */
  const [archive, setArchive] = useState<ArchiveBundle | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  /*
   * ── 名字是不是已经定过了 ──
   *
   * 「全部重置」清的是对话 / 角色 / 群聊 / 引导状态 —— **不清档案**。
   * 因为名字是「定下之后就改不了」的，这是有意为之。
   *
   * 于是重置后会撞上一个矛盾：
   *
   *   引导重新出现 → 又问一次名字 → 输入 → `claimName` 发现档案已存在
   *   → 返回 false → 旧的 finish() 里 `if (!claimName) return;` **静默结束**
   *
   * 用户看到的是「按钮点不动」。
   *
   * 现在：**已定过名就不再问**，直接用原来的名字往下走。
   */
  const named = hasProfile();
  const existingName = named ? ownerName() : "";
  /* 名字真的拿不下来时，把原因显示出来 —— 不许静默 */
  const [nameErr, setNameErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [look, setLook] = useState("");
  const [trait, setTrait] = useState("");

  /*
   * ── 选一份存档 ──
   *
   * 只读文件、只解析，**先不落库**。
   * 等名字定完再一起写 —— 否则中途取消会留下半套数据。
   */
  const pickImport = async () => {
    setImportErr(null);
    const api = typeof window !== "undefined" ? window.desktop : undefined;
    if (!api?.importData) {
      setImportErr("浏览器预览里读不了本地文件（用桌面版）");
      return;
    }
    try {
      const got = await api.importData();
      if (!got || !got.raw) return; /* 用户取消了 */

      const parsed = parseArchive(got.raw);
      if (!parsed.ok || !parsed.bundle) {
        setImportErr(parsed.error ?? "这个文件读不出来");
        return;
      }
      setArchive(parsed.bundle);
      setPicked("import");
    } catch (err) {
      setImportErr(`读文件失败：${String((err as Error)?.message ?? err).slice(0, 60)}`);
    }
  };

  /**
   * 把数据落地，然后交给上层。
   *
   * ── 为什么这里不标 onboarded ──
   *
   * 上一版把 `markOnboarded()` 放在这个函数的**第一行**，
   * 于是出现过这种状态：
   *
   *   ```
   *   3w:onboarded = 1     ← 引导标记做完了
   *   3w:profile   = 空    ← 但从来没定过名字
   *   ```
   *
   * 之后进应用，`ownerName()` 拿不到名字就回退成「主人」，
   * 而且引导再也不会出现 —— **用户被永久锁在一个没定过名的状态里。**
   *
   * 现在：**只有确认「档案已存在」之后才标完成**。
   */
  const applyPicked = () => {
    if (!hasProfile()) {
      /* 走到这里说明流程有问题 —— 宁可停在这儿，也不留下半个状态 */
      setNameErr("档案没写进去，先别继续 —— 重开一次软件试试");
      return;
    }
    markOnboarded();
    if (picked === "import" && archive) {
      applyArchive(archive);
      onDone(null); /* null = 我自己写好了，别覆盖 */
      return;
    }
    onDone([]);
  };

  const toName = () => {
    if (!picked) return;
    /* 选了「导入」但还没选文件 —— 不许往下走 */
    if (picked === "import" && !archive) return;

    /*
     * ── 永远进名字步 ──
     *
     * 上一版在这里做了个「已经定过名就跳过」的捷径 —— 结果是：
     * 只要档案状态有一点点脏，用户就会**在没定过名字的情况下直接进应用**，
     * 名字显示成兜底的「主人」，而且再也没机会改。
     *
     * 名字步现在两种形态：
     *   · 没定过 → 输入框，必须填
     *   · 定过了 → 只读展示「还是 XX」，点继续
     *
     * **不问就进，是最坏的一种。**
     */
    setStep("name");
  };

  /*
   * 能不能点提交。
   *
   * `named` 时输入框根本不存在，`name` 永远是空字符串 ——
   * 只看 `name.trim()` 会把按钮永远禁用，只读形态就成了死路。
   */
  const canSubmit = named || name.trim().length > 0;

  const finish = () => {
    /* 已经定过名 —— 名字改不了，直接往下走（`named` 分支） */
    if (named) {
      applyPicked();
      return;
    }

    const clean = name.trim();
    if (!clean) {
      setNameErr("总得有个名字");
      return;
    }
    setNameErr(null);

    /*
     * 名字定不下来 —— **一定要说出来**。
     *
     * 原来的写法是 `if (!claimName(clean)) return;`，
     * 失败时界面毫无反应，用户只能得出「按钮坏了」这个结论。
     */
    if (!claimName(clean)) {
      setNameErr(
        hasProfile()
          ? `名字已经定过了（${ownerName()}），改不了 —— 点「继续」用回原来的`
          : "这个名字用不了，换一个试试"
      );
      return;
    }

    log.profileNamed(clean);
    if (look.trim() || trait.trim()) updateLooks(look, trait);
    applyPicked();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-abyss/92 backdrop-blur-md">
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        /*
         * ── 高度兜底 ──
         *
         * 原来只有 `overflow-hidden`，没有 max-height，内容也不会滚。
         * 名字那一步比第一步高（多了两个选填框），窗口一矮，
         * **底部的提交按钮被裁掉 —— 看不见就点不着。**
         *
         * 现在：头部固定，中间可滚，底部固定。
         */
        className="glass flex max-h-[92vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-[16px]"
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-6 py-4">
          <div
            className="grid h-8 w-8 place-items-center rounded-[9px]"
            style={{
              background: "linear-gradient(150deg, #35f0ce30, rgba(4,12,20,0.9))",
              boxShadow: "0 0 0 1px #35f0ce44, inset 0 0 12px #35f0ce22",
            }}
          >
            <IconTail size={16} className="text-biolum" />
          </div>
          <div>
            <div className="text-[14px] font-medium text-ink">欢迎来到生境</div>
            <div className="mt-0.5 text-[10.5px] text-mist/45">
              {step === "pick" ? "本地优先 · 数据不出这台机器" : "在那之前，你自己是谁"}
            </div>
          </div>
          {step === "name" && (
            <span className="ml-auto font-mono text-[9.5px] tracking-[0.1em] text-mist/32">
              2 / 2
            </span>
          )}
        </div>

        {step === "pick" ? (
          <>
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <p className="text-[12px] leading-[1.8] text-mist/60">
                开始之前需要确认一件事。这决定你打开后看到的是
                <span className="text-ink/80"> 一间空屋子 </span>
                还是
                <span className="text-ink/80"> 你上次离开时的样子 </span>。
              </p>

              <div className="mt-4 space-y-2.5">
                <Choice
                  active={picked === "fresh"}
                  onClick={() => setPicked("fresh")}
                  title="从空白开始"
                  desc="一个角色都不建。你之后自己决定要接谁、要拉什么群 —— 完全是空的。"
                  accent="#35f0ce"
                />
                <Choice
                  active={picked === "import"}
                  onClick={() => {
                    void pickImport();
                  }}
                  title="从外部导入存档"
                  desc={
                    archive
                      ? `已选 —— ${archive.data.personas.length} 个角色${
                          archive.data.threads ? " · 带着对话" : ""
                        }${archive.data.memories ? " · 带着记忆" : ""}`
                      : "把你之前导出的 .json 存档放进来。角色、对话、记忆一起回来。"
                  }
                  accent="#4e8cff"
                />

                {importErr && (
                  <div className="px-1 font-mono text-[9.5px] leading-[1.6] text-coral/70">
                    {importErr}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-6 py-3">
              <span className="font-mono text-[10px] text-mist/46">
                {named
                  ? `名字已经定过了（${existingName}），这一步不会再问`
                  : "之后可以在设置里重建数据"}
              </span>
              <button
                onClick={toName}
                disabled={!picked}
                className="ml-auto flex items-center gap-1.5 rounded-[7px] px-3.5 py-[6px] text-[11px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-35"
                style={{
                  background: picked ? "rgba(53,240,206,0.16)" : "rgba(255,255,255,0.05)",
                  color: picked ? "#35f0ce" : "#8fa9bd",
                  boxShadow: picked ? "inset 0 0 0 1px rgba(53,240,206,0.3)" : "none",
                }}
              >
                继续
                <IconChevron size={11} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {/*
                ── 名字 ──

                这是全场唯一一处不能改的输入框。

                说明它为什么不能改，比拦着他不让改更重要。
              */}
              <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.016] px-4 py-3.5">
                <div className="font-mono text-[9.5px] tracking-[0.14em] text-mist/45">
                  她会这么叫你
                </div>
                {named ? (
                  /*
                   * 已经定过名 —— 只读展示。
                   *
                   * **不给输入框**：给了就会有人填，填完发现改不了，
                   * 那比不问更糟。
                   */
                  <div className="mt-2 text-[17px] tracking-[0.04em] text-ink/80">
                    {existingName}
                  </div>
                ) : (
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 12))}
                    onKeyDown={(e) => e.key === "Enter" && finish()}
                    placeholder="你希望她怎么叫你"
                    className="mt-2 w-full bg-transparent text-[17px] tracking-[0.04em] text-ink outline-none placeholder:text-mist/22"
                  />
                )}
              </div>

              {/* 名字用不了的时候，把原因写在这儿 —— 不许静默 */}
              {nameErr && (
                <div className="mt-2 rounded-[6px] border border-coral/25 bg-coral/[0.06] px-2.5 py-2 font-mono text-[10px] leading-[1.7] text-coral/85">
                  {nameErr}
                </div>
              )}

              <p className="mt-3 text-[10.5px] leading-[1.85] text-mist/52">
                {named ? (
                  <>
                    <b className="text-coral/85">这个名字定过了，改不了。</b>
                    <br />
                    点「继续」就用回它 —— 想让一切重来，之后可以在设置里删档。
                  </>
                ) : (
                  <>
                    <b className="text-coral/85">这个名字定下之后就改不了。</b>
                    <br />
                    她记得的每一件事都会用这个名字指代你 ——
                    改了，那些事就指向一个不存在的人。
                  </>
                )}
              </p>

              {/* ── 选填 ── */}
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-mono text-[9.5px] tracking-[0.12em] text-mist/40">
                  她眼里的你
                </span>
                <span className="font-mono text-[8.5px] text-mist/26">选填</span>
              </div>

              <div className="mt-2 space-y-2">
                <input
                  value={look}
                  onChange={(e) => setLook(e.target.value.slice(0, 40))}
                  placeholder="看起来……（比如：总穿深色衣服）"
                  className="w-full rounded-[7px] border border-white/[0.07] bg-white/[0.014] px-3 py-[7px] text-[11.5px] text-ink/85 outline-none transition-colors placeholder:text-mist/24 focus:border-biolum/30"
                />
                <input
                  value={trait}
                  onChange={(e) => setTrait(e.target.value.slice(0, 40))}
                  placeholder="说话的方式……（比如：话少，但记得住细节）"
                  className="w-full rounded-[7px] border border-white/[0.07] bg-white/[0.014] px-3 py-[7px] text-[11.5px] text-ink/85 outline-none transition-colors placeholder:text-mist/24 focus:border-biolum/30"
                />
              </div>

              <p className="mt-2.5 text-[10px] leading-[1.7] text-mist/42">
                留空完全可以。也可以什么都不填 —— 她对你的印象会从对话里长出来。
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-6 py-3">
              <button
                onClick={() => setStep("pick")}
                className="font-mono text-[10px] text-mist/40 transition-colors hover:text-mist/70"
              >
                ← 返回
              </button>
              <button
                onClick={finish}
                disabled={!canSubmit}
                className="ml-auto flex items-center gap-1.5 rounded-[7px] px-4 py-[6px] text-[11px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-35"
                style={{
                  background: canSubmit
                    ? "rgba(53,240,206,0.16)"
                    : "rgba(255,255,255,0.05)",
                  color: canSubmit ? "#35f0ce" : "#8fa9bd",
                  boxShadow: canSubmit
                    ? "inset 0 0 0 1px rgba(53,240,206,0.3)"
                    : "none",
                }}
              >
                {named ? "继续" : "就叫这个"}
                <IconChevron size={11} />
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  title,
  desc,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  accent: string;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-all duration-200"
      style={{
        borderColor: active ? `${accent}55` : "rgba(255,255,255,0.07)",
        background: active ? `${accent}0d` : "rgba(255,255,255,0.016)",
      }}
    >
      <span
        className="mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border transition-colors duration-200"
        style={{
          borderColor: active ? accent : "rgba(255,255,255,0.18)",
          background: active ? accent : "transparent",
        }}
      >
        {active && (
          <span
            className="h-[5px] w-[5px] rounded-full"
            style={{ background: "#04101a" }}
          />
        )}
      </span>
      <span className="min-w-0">
        <span
          className="block text-[12px] transition-colors"
          style={{ color: active ? "#e8f6ff" : "rgba(232,246,255,0.8)" }}
        >
          {title}
        </span>
        <span className="mt-1 block text-[10.5px] leading-[1.7] text-mist/50">
          {desc}
        </span>
      </span>
    </button>
  );
}
