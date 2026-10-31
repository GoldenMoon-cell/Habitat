import { useEffect, useState } from "react";
import { readProfile, updateLooks, type Profile } from "../lib/profile";
import {
  nativeVoices,
  onNativeVoices,
  preview,
  readTts,
  saveTts,
  type TtsConfig,
} from "../lib/tts";
import { playSettle } from "../lib/sound";
import { AnimatePresence, motion } from "motion/react";
import { IconTail } from "./Icons";
import { useEscClose } from "../lib/escStack";
import { notify } from "../lib/notify";
import ConfirmDialog from "./ConfirmDialog";
import type { ArchiveBundle } from "../lib/archive";
import { verify } from "../lib/awakenLedger";
import { loadPersonas } from "../data/personaStore";
import { CHANNELS, checkUpdate, openRelease, readChannel, saveChannel, type UpdateResult } from "../lib/update";
import { applyArchive, collectArchive, parseArchive } from "../lib/archive";

/**
 * 通用设置。
 *
 * 之前这个位置整块都是「解析引擎配置」——那是引擎面板的事，
 * 通用设置里不该有引擎卡片。现在这里只管：
 *   · 引擎（只读摘要 + 跳转到引擎面板）
 *   · 本地数据（清空 / 重置）
 *   · 关于
 *
 * 引擎细项全部在 EnginePanel（从第 2 栏底部「解析引擎」进入）。
 */

export interface DataStats {
  threads: number;
  threadsKB: number;
  personas: number;
  groups: number;
  engineLevel: number;
  engineName: string;
}

export default function SettingsPanel({
  open,
  onClose,
  stats,
  onOpenEngine,
  onOpenApi,
  apiStatus,
  onClearThreads,
  onResetPersonas,
  onClearGroups,
  onResetAll,
  onWipeAll,
  onExportData,
  onImportData,
  onRevealData,
  dataDirPath,
  appName = "生境",
  onChangeAppName,
}: {
  open: boolean;
  onClose: () => void;
  stats: DataStats;
  onOpenEngine: () => void;
  onOpenApi: () => void;
  /** 已配置的 API，没有就是 null */
  apiStatus: { label: string; baseUrl: string; masked: string } | null;
  onClearThreads: () => void;
  onResetPersonas: () => void;
  onClearGroups: () => void;
  onResetAll: () => void;
  /** 删档 —— 连名字一起清，之后重走引导 */
  onWipeAll: () => void;
  /** 导出全部数据到 JSON */
  onExportData: () => void;
  /** 选文件导入 */
  onImportData: () => void;
  /** 打开数据目录（仅 Electron） */
  onRevealData?: () => void;
  /** 本地文件留底的路径（仅 Electron 有值） */
  dataDirPath?: string | null;
  /** 应用显示名 */
  appName?: string;
  onChangeAppName?: (v: string) => void;
}) {
  const [showAbout, setShowAbout] = useState(false);

  /*
   * 检查更新。
   *
   * 三个状态：通道、正在查、上一次结果。
   * 结果留着不清 —— 用户可能想再点一次链接。
   */
  const [channel, setChannel] = useState<"stable" | "beta">(() => readChannel());
  const [checking, setChecking] = useState(false);
  const [updateRes, setUpdateRes] = useState<UpdateResult | null>(null);
  /**
   * 数据文件夹的真实路径。
   *
   * 启动时问一次主进程 —— 用户想看自己的数据在哪，
   * 不能让他去翻 %APPDATA%。
   */
  const [dataDir, setDataDir] = useState("");
  /* 语音 —— 用户自己配服务商，软件不内置 */
  const [tts, setTts] = useState<TtsConfig>(() => readTts());
  const [ttsUrlDraft, setTtsUrlDraft] = useState("");
  const [ttsKeyDraft, setTtsKeyDraft] = useState("");
  const [ttsModelDraft, setTtsModelDraft] = useState("");
  const [ttsVoiceDraft, setTtsVoiceDraft] = useState("");
  const [ttsTrying, setTtsTrying] = useState(false);
  /* 系统音色列表 —— 要等 voiceschanged */
  const [nativeList, setNativeList] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsResult, setTtsResult] = useState<string | null>(null);
  /* 你自己 —— 名字只读，形象和性格可补 */
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lookDraft, setLookDraft] = useState("");
  const [traitDraft, setTraitDraft] = useState("");
  /** 待确认的导入包 —— 选中文件后先给用户看清里面是什么，再决定导不导 */
  const [pendingImport, setPendingImport] = useState<{
    bundle: ArchiveBundle;
    filePath: string;
    lines: string[];
  } | null>(null);
  /* 输入框用草稿，失焦才落盘 —— 每敲一个字就写 localStorage 会把历史记录刷爆 */
  const [nameDraft, setNameDraft] = useState(appName);
  useEffect(() => {
    setNameDraft(appName);
  }, [appName]);
  useEscClose(open, onClose);

  /* 系统音色列表就绪 */
  useEffect(() => onNativeVoices(() => setNativeList(nativeVoices())), []);

  /* 面板打开时同步语音配置 */
  useEffect(() => {
    if (!open) return;
    const c = readTts();
    setTts(c);
    setTtsUrlDraft(c.baseUrl);
    setTtsKeyDraft(c.apiKey);
    setTtsModelDraft(c.model);
    setTtsVoiceDraft(c.voice ?? "");
  }, [open]);

  /* 面板打开时同步档案 */
  useEffect(() => {
    if (!open) return;
    const p = readProfile();
    setProfile(p);
    setLookDraft(p?.look ?? "");
    setTraitDraft(p?.trait ?? "");
  }, [open]);

  /* 面板打开时问一次路径 */
  useEffect(() => {
    if (!open) return;
    void window.desktop?.dataDir?.().then((d) => {
      if (typeof d === "string" && d) setDataDir(d);
    });
  }, [open]);

  return (
    <>
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-abyss/80 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.995 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="glass relative flex max-h-[80vh] w-full max-w-[500px] flex-col overflow-hidden rounded-[16px]"
          >
            {/* 标题 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
              <span className="text-[12px] text-biolum/70">⚙</span>
              <span className="text-[13px] text-ink">设置</span>
              <button
                onClick={onClose}
                className="ml-auto grid h-7 w-7 place-items-center rounded-md text-mist/58 transition-colors hover:bg-white/[0.07] hover:text-ink/80"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {/* ── API 接入 ── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label">API 接入</span>
                  <span className="font-mono text-[9.5px] text-mist/50">模型从哪来</span>
                </div>
                <button
                  onClick={onOpenApi}
                  className="flex w-full items-center justify-between rounded-[6px] border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-biolum/30 hover:bg-biolum/[0.05]"
                >
                  <div className="min-w-0">
                    {apiStatus ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="h-[4px] w-[4px] shrink-0 rounded-full bg-biolum/80" />
                          <span className="truncate font-mono text-[10px] text-ink/80">
                            {apiStatus.label}
                          </span>
                        </div>
                        <div className="mt-[2px] truncate font-mono text-[9.5px] text-mist/52">
                          {apiStatus.baseUrl} · {apiStatus.masked}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="h-[4px] w-[4px] shrink-0 rounded-full bg-amber/70" />
                          <span className="font-mono text-[10px] text-amber/80">未配置</span>
                        </div>
                        <div className="mt-[2px] text-[9.5px] text-mist/52">
                          现在回复是 mock 的，填了 Key 才会真的调模型
                        </div>
                      </>
                    )}
                  </div>
                  <span className="shrink-0 text-mist/50">›</span>
                </button>
              </div>

              {/* ── 引擎（摘要 + 跳转）── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label">解析引擎</span>
                  <span className="font-mono text-[9.5px] text-mist/50">人格 → 六维 Δ</span>
                </div>
                <button
                  onClick={onOpenEngine}
                  className="flex w-full items-center justify-between rounded-[6px] border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-biolum/30 hover:bg-biolum/[0.05]"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-ink/80">
                      L{stats.engineLevel} · {stats.engineName}
                    </div>
                    <div className="mt-[2px] text-[10px] text-mist/52">多级降级 · 点击修改</div>
                  </div>
                  <span className="shrink-0 text-mist/50">›</span>
                </button>
              </div>

              {/*
                ── 你自己 ──

                名字**不提供修改入口**。

                那不是漏了 —— 是「这个名字只有一次机会」。
                改了之后，她记得的每一件事都会指向一个不存在的人。

                形象和性格随时可以补，因为那不影响指代。
              */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label">你自己</span>
                  <span className="font-mono text-[9.5px] text-mist/40">
                    {profile ? "已定名" : "还没定名"}
                  </span>
                </div>

                <div className="rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] tracking-[0.02em] text-ink/90">
                      {profile?.name ?? "主人"}
                    </span>
                    <span className="font-mono text-[9px] tracking-[0.1em] text-mist/32">
                      不可改
                    </span>
                  </div>
                  {profile && (
                    <div className="mt-1 font-mono text-[9px] text-mist/30">
                      定于{" "}
                      {new Date(profile.at).toLocaleDateString("zh-CN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </div>
                  )}

                  <div className="mt-2 space-y-1.5">
                    <input
                      value={lookDraft}
                      onChange={(e) => setLookDraft(e.target.value.slice(0, 40))}
                      onBlur={() => {
                        if (lookDraft !== (profile?.look ?? "")) {
                          updateLooks(lookDraft, undefined);
                          setProfile(readProfile());
                        }
                      }}
                      placeholder="看起来……（选填）"
                      className="w-full rounded-[5px] border border-white/[0.05] bg-white/[0.012] px-2 py-[5px] text-[10.5px] text-ink/80 outline-none transition-colors placeholder:text-mist/22 focus:border-biolum/25"
                    />
                    <input
                      value={traitDraft}
                      onChange={(e) => setTraitDraft(e.target.value.slice(0, 40))}
                      onBlur={() => {
                        if (traitDraft !== (profile?.trait ?? "")) {
                          updateLooks(undefined, traitDraft);
                          setProfile(readProfile());
                        }
                      }}
                      placeholder="说话的方式……（选填）"
                      className="w-full rounded-[5px] border border-white/[0.05] bg-white/[0.012] px-2 py-[5px] text-[10.5px] text-ink/80 outline-none transition-colors placeholder:text-mist/22 focus:border-biolum/25"
                    />
                  </div>
                  <div className="mt-1.5 font-mono text-[9px] leading-relaxed text-mist/26">
                    这两条会进她的人格提示。留空也行 —— 印象会从对话里长出来。
                  </div>
                </div>
              </div>

              {/*
                ── 语音 ──

                三档，从「谁都能用」到「要好听的」：

                  ① 系统自带 —— 零配置、免费、离线。声音机械，但立刻能听。
                  ② OpenAI 兼容 —— 要一个支持 TTS 的地址 + Key。
                  ③ 大厂原生 —— 还没做。

                **① 才是"所有人都能用"的那一档。** ②③ 是给愿意折腾的人。
              */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label">语音</span>
                  <span className="font-mono text-[9px] text-mist/32">
                    {tts.mode === "off"
                      ? "关闭"
                      : tts.mode === "native"
                        ? "系统语音"
                        : "云端"}
                  </span>
                </div>

                {/* ── 三档选择 ── */}
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { k: "off", label: "关", hint: "不出声" },
                      { k: "native", label: "系统", hint: "零配置" },
                      { k: "cloud", label: "云端", hint: "要 Key" },
                    ] as const
                  ).map((x) => (
                    <button
                      key={x.k}
                      onClick={() => {
                        const next = saveTts({ mode: x.k });
                        setTts(next);
                        setTtsResult(null);
                      }}
                      className={`rounded-[5px] border px-2 py-[6px] text-center transition-colors ${
                        tts.mode === x.k
                          ? "border-biolum/35 bg-biolum/[0.08]"
                          : "border-white/[0.06] bg-white/[0.012] hover:border-white/[0.14]"
                      }`}
                    >
                      <div
                        className={`text-[10.5px] ${
                          tts.mode === x.k ? "text-biolum/90" : "text-ink/55"
                        }`}
                      >
                        {x.label}
                      </div>
                      <div className="mt-0.5 font-mono text-[8.5px] text-mist/28">
                        {x.hint}
                      </div>
                    </button>
                  ))}
                </div>

                {/* ── ① 系统语音 ── */}
                {tts.mode === "native" && (
                  <div className="rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="font-mono text-[9px] tracking-[0.06em] text-mist/35">
                        音色（系统）
                      </span>
                      <span className="font-mono text-[8.5px] text-mist/24">
                        {nativeList.length} 个可用
                      </span>
                    </div>
                    <select
                      value={tts.nativeVoice ?? ""}
                      onChange={(e) => {
                        setTts(saveTts({ nativeVoice: e.target.value }));
                      }}
                      className="w-full rounded-[5px] border border-white/[0.06] bg-[#0b1219] px-2 py-[5px] text-[10px] text-ink/80 outline-none focus:border-biolum/25"
                    >
                      <option value="">（系统默认）</option>
                      {nativeList.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name}
                          {v.lang ? ` · ${v.lang}` : ""}
                        </option>
                      ))}
                    </select>

                    <div className="mt-2 mb-1 font-mono text-[9px] tracking-[0.06em] text-mist/35">
                      语速 {(tts.rate ?? 1).toFixed(1)}×
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={tts.rate ?? 1}
                      onChange={(e) =>
                        setTts(saveTts({ rate: Number(e.target.value) }))
                      }
                      className="w-full accent-biolum"
                    />

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={async () => {
                          setTtsTrying(true);
                          const r = await preview("你好，我在。");
                          setTtsTrying(false);
                          setTtsResult(r.ok ? "听到了吗" : r.error ?? "失败");
                        }}
                        disabled={ttsTrying}
                        className="rounded-[4px] border border-biolum/25 px-2 py-[3px] text-[10px] text-biolum/80 transition-colors hover:bg-biolum/[0.08] disabled:opacity-40"
                      >
                        {ttsTrying ? "……" : "试听"}
                      </button>
                      {ttsResult && (
                        <span className="font-mono text-[9px] text-mist/45">
                          {ttsResult}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 font-mono text-[9px] leading-relaxed text-mist/26">
                      用操作系统自带的语音引擎。免费、离线、不用 Key。
                      <br />
                      声音比较机械 —— 想要好听就换「云端」。
                    </div>
                  </div>
                )}

                {/* ── ② 云端 ── */}
                {tts.mode === "cloud" && (
                  <div className="rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <div className="mb-1 font-mono text-[9px] tracking-[0.06em] text-mist/35">
                      Base URL
                    </div>
                    <input
                      value={ttsUrlDraft}
                      onChange={(e) => setTtsUrlDraft(e.target.value)}
                      onBlur={() => {
                        if (ttsUrlDraft !== tts.baseUrl) {
                          setTts(saveTts({ baseUrl: ttsUrlDraft.trim() }));
                        }
                      }}
                      placeholder="https://api.openai.com/v1"
                      className="w-full rounded-[5px] border border-white/[0.06] bg-white/[0.012] px-2 py-[5px] font-mono text-[10px] text-ink/80 outline-none transition-colors placeholder:text-mist/22 focus:border-biolum/25"
                    />

                    <div className="mb-1 mt-2 font-mono text-[9px] tracking-[0.06em] text-mist/35">
                      API Key
                    </div>
                    <input
                      type="password"
                      value={ttsKeyDraft}
                      onChange={(e) => setTtsKeyDraft(e.target.value)}
                      onBlur={() => {
                        if (ttsKeyDraft !== tts.apiKey) {
                          setTts(saveTts({ apiKey: ttsKeyDraft.trim() }));
                        }
                      }}
                      placeholder="sk-..."
                      className="w-full rounded-[5px] border border-white/[0.06] bg-white/[0.012] px-2 py-[5px] font-mono text-[10px] text-ink/80 outline-none transition-colors placeholder:text-mist/22 focus:border-biolum/25"
                    />

                    <div className="mt-2 flex gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 font-mono text-[9px] tracking-[0.06em] text-mist/35">
                          模型名
                        </div>
                        <input
                          value={ttsModelDraft}
                          onChange={(e) => setTtsModelDraft(e.target.value)}
                          onBlur={() => {
                            if (ttsModelDraft !== tts.model) {
                              setTts(saveTts({ model: ttsModelDraft.trim() || "tts-1" }));
                            }
                          }}
                          placeholder="tts-1"
                          className="w-full rounded-[5px] border border-white/[0.06] bg-white/[0.012] px-2 py-[5px] font-mono text-[10px] text-ink/80 outline-none transition-colors placeholder:text-mist/22 focus:border-biolum/25"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 font-mono text-[9px] tracking-[0.06em] text-mist/35">
                          默认音色
                        </div>
                        <input
                          value={ttsVoiceDraft}
                          onChange={(e) => setTtsVoiceDraft(e.target.value)}
                          onBlur={() => {
                            if (ttsVoiceDraft !== (tts.voice ?? "")) {
                              setTts(saveTts({ voice: ttsVoiceDraft.trim() || "alloy" }));
                            }
                          }}
                          placeholder="alloy"
                          className="w-full rounded-[5px] border border-white/[0.06] bg-white/[0.012] px-2 py-[5px] font-mono text-[10px] text-ink/80 outline-none transition-colors placeholder:text-mist/22 focus:border-biolum/25"
                        />
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={async () => {
                          setTtsTrying(true);
                          const r = await preview("你好，我在。");
                          setTtsTrying(false);
                          setTtsResult(r.ok ? "听到了吗" : r.error ?? "失败");
                        }}
                        disabled={ttsTrying}
                        className="rounded-[4px] border border-biolum/25 px-2 py-[3px] text-[10px] text-biolum/80 transition-colors hover:bg-biolum/[0.08] disabled:opacity-40"
                      >
                        {ttsTrying ? "正在合成…" : "试听"}
                      </button>
                      {ttsResult && (
                        <span className="font-mono text-[9px] text-mist/45">
                          {ttsResult}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 font-mono text-[9px] leading-relaxed text-mist/26">
                      兼容 OpenAI <span className="text-mist/40">/v1/audio/speech</span>{" "}
                      的服务都能用 —— 官方、中转站、自建网关（new-api 之类）。
                      <br />
                      <span className="text-mist/34">
                        Base URL 填到 <span className="text-mist/50">/v1</span> 就行；也可以直接填完整路径（以{" "}
                        <span className="text-mist/50">/audio/speech</span> 结尾）—— 那样就原样使用，不再拼接。
                      </span>
                      <br />
                      角色自己的音色在「人格」里填 —— 空着就用上面这个默认值。
                    </div>
                  </div>
                )}

                {tts.mode === "off" && (
                  <div className="rounded-[7px] border border-white/[0.05] bg-white/[0.012] px-3 py-2 font-mono text-[9px] leading-relaxed text-mist/28">
                    不出声。消息照常，只是没有语音和提示音之外的声音。
                    <br />
                    <span className="text-mist/22">
                      选「系统」零配置就能听 —— 不需要任何 Key。
                    </span>
                  </div>
                )}
              </div>

              {/* ── 本地数据 ── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label">本地数据</span>
                  <span className="font-mono text-[9.5px] text-mist/50">全部存在这台机器上</span>
                </div>

                {/*
                  ── 数据在哪 ──

                  用户不知道自己的数据存在哪，想手动备份都找不到。

                  三处：
                    localStorage          主
                    current.json          文件留底
                    backup-YYYY-MM-DD     每天一份

                  给一个能点开的路径。
                */}
                <div className="mb-2 rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9.5px] tracking-[0.06em] text-mist/50">
                      数据文件夹
                    </span>
                    <button
                      onClick={() => void window.desktop?.revealData?.()}
                      className="ml-auto rounded-[3px] border border-white/[0.1] px-2 py-[2px] text-[10px] text-ink/60 transition-colors hover:border-white/25 hover:bg-white/[0.05]"
                    >
                      打开
                    </button>
                  </div>
                  <div className="mt-1 break-all font-mono text-[9.5px] leading-relaxed text-mist/40">
                    {dataDir || "%APPDATA%\\habitat\\data"}
                  </div>
                  <div className="mt-1.5 font-mono text-[9px] text-mist/30">
                    current.json · 文件留底 · backup-*.json 每天一份
                  </div>
                </div>

                {/*
                  ── 档案完整性 ──

                  层 2：不阻止，只留痕。

                  觉醒时记一份档案指纹。启动时重算一遍，对不上就是
                  「这份档案被外部改过」。

                  不弹窗、不改数据 —— 只是在这里写一行字。
                  用户自己知道自己在做什么。
                */}
                {(() => {
                  const ps = loadPersonas();
                  const awake = ps.filter((p) => p.stage === "awakened");
                  const tampered = verify(ps);
                  if (awake.length === 0) return null;
                  return (
                    <div className="mb-2 mt-1.5 rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                      <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-mist/58">
                        <span>档案完整性</span>
                        <span className="ml-auto">
                          {awake.length} 个已觉醒
                        </span>
                      </div>
                      {tampered.length === 0 ? (
                        <div className="mt-1 text-[10px] text-mist/45">
                          全部纪要与账本相符。
                        </div>
                      ) : (
                        <div className="mt-1 space-y-0.5">
                          {tampered.map((x) => (
                            <div key={x.id} className="text-[10px] text-amber/70">
                              <b className="text-amber/90">{x.name}</b> 的档案在{" "}
                              {new Date(x.at).toLocaleString("zh-CN", {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              觉醒后，被外部修改过。
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── 导出 / 导入 ──
                    人格、情绪、记忆都在 localStorage 里，换机器就没有了。
                    这里给一个可携带的 .json，导出的东西能搬到另一台机器上。
                    凭据不导出（加密的、跟机器绑定，导出去也解不开）。 */}
                <div className="mb-1 mt-1 flex gap-1.5">
                  <button
                    onClick={async () => {
                      const bundle = collectArchive("full");
                      const r = await window.desktop?.exportData({ scope: "full", bundle });
                      if (r?.ok) {
                        playSettle();
                        notify({
                          title: "已导出全部数据",
                          desc: `${bundle.data.personas.length} 个角色 · ${((r.bytes ?? 0) / 1024).toFixed(0)} KB`,
                          accent: "#35f0ce",
                          icon: "log",
                        });
                      } else if (r && !r.canceled) {
                        notify({ title: "导出失败", desc: r.error, accent: "#ff7a6b" });
                      }
                    }}
                    className="flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-biolum/30 bg-biolum/[0.07] text-[10.5px] text-biolum transition-colors hover:bg-biolum/[0.13]"
                  >
                    ↑ 导出全部
                  </button>
                  <button
                    onClick={async () => {
                      const bundle = collectArchive("personas");
                      const r = await window.desktop?.exportData({ scope: "personas", bundle });
                      if (r?.ok) {
                        playSettle();
                        notify({
                          title: "已导出角色档案",
                          desc: `${bundle.data.personas.length} 个角色 · 不含对话记录`,
                          accent: "#35f0ce",
                          icon: "log",
                        });
                      } else if (r && !r.canceled) {
                        notify({ title: "导出失败", desc: r.error, accent: "#ff7a6b" });
                      }
                    }}
                    className="flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-white/[0.12] text-[10.5px] text-ink/65 transition-colors hover:border-white/25 hover:bg-white/[0.04]"
                  >
                    ↑ 只导角色
                  </button>
                  <button
                    onClick={async () => {
                      const r = await window.desktop?.importData();
                      if (!r) {
                        notify({ title: "导入不可用", desc: "请在桌面端使用", accent: "#ffc46b" });
                        return;
                      }
                      if (!r.ok) {
                        if (!r.canceled) notify({ title: "读取失败", desc: r.error, accent: "#ff7a6b" });
                        return;
                      }
                      const parsed = parseArchive(r.raw ?? "");
                      if (!parsed.ok || !parsed.bundle) {
                        notify({ title: "文件格式不对", desc: parsed.error, accent: "#ff7a6b" });
                        return;
                      }
                      const s = parsed.summary!;
                      /* 先不导 —— 把摘要攒成几行，弹窗让用户确认 */
                      const names = parsed.bundle.data.personas
                        .slice(0, 6)
                        .map((p) => p.name)
                        .join("、");
                      const more =
                        parsed.bundle.data.personas.length > 6
                          ? ` 等 ${parsed.bundle.data.personas.length} 个`
                          : "";
                      setPendingImport({
                        bundle: parsed.bundle,
                        filePath: r.filePath ?? "",
                        lines: [
                          `角色：${s.personas} 个（${names}${more}）`,
                          `对话：${s.threads} 条`,
                          s.groups ? `群聊：${s.groups} 个` : "",
                          `导出于：${String(s.exportedAt).slice(0, 19).replace("T", " ")}`,
                          "",
                          "导入会合并数据，按 id 去重。",
                          "注意：已经觉醒的角色，导入她的档案也无法抹去她受过的伤。",
                        ].filter(Boolean),
                      });
                    }}
                    className="flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-white/[0.12] text-[10.5px] text-ink/65 transition-colors hover:border-white/25 hover:bg-white/[0.04]"
                  >
                    ↓ 导入
                  </button>
                </div>

                <div className="space-y-1.5">
                  <Row
                    title="对话记录"
                    sub={`${stats.threads} 条 · ${stats.threadsKB} KB`}
                    action="清空"
                    onClick={onClearThreads}
                  />
                  <Row
                    title="角色档案"
                    sub={`${stats.personas} 个`}
                    action="重置"
                    onClick={onResetPersonas}
                  />
                  <Row
                    title="群聊"
                    sub={`${stats.groups} 个`}
                    action="清空"
                    onClick={onClearGroups}
                  />
                </div>

                <button
                  onClick={onResetAll}
                  className="mt-2 flex min-h-[32px] w-full items-center justify-center rounded-[6px] border border-coral/30 bg-coral/[0.07] px-2 py-[5px] font-mono text-[10px] text-coral/70 transition-colors hover:border-coral/45 hover:bg-coral/[0.1] hover:text-coral/90"
                >
                  全部重置（对话 + 角色 + 群聊 + 引导状态）
                </button>

                <div className="mt-[6px] text-[10px] leading-[1.6] text-mist/50">
                  重置后无法恢复。角色档案和对话都不在云端，没有备份。
                </div>

                {/*
                  ── 删档 ──
 
                  比「全部重置」重一档：连「你是谁」一起清掉。
 
                  为什么需要它：名字定下就改不了，而「全部重置」不清档案。
                  如果第一次打错了字，现在没有任何出路 —— 删档是唯一那条，
                  而且代价很大。
                */}
                <button
                  onClick={onWipeAll}
                  className="mt-3 flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[7px] border border-coral/20 px-3 font-mono text-[10.5px] text-coral/70 transition-colors hover:border-coral/45 hover:bg-coral/[0.06] hover:text-coral"
                >
                  删档
                </button>
                <div className="mt-[6px] text-[10px] leading-[1.6] text-mist/34">
                  她会忘记你是谁。之后重新开始 —— 那个陌生人不再是你。
                </div>
              </div>

              {/* ── 名字 ── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label">名字</span>
                  <span className="font-mono text-[9.5px] text-mist/50">只改显示，不动数据</span>
                </div>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    if (nameDraft.trim() !== appName) onChangeAppName?.(nameDraft);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="生境"
                  maxLength={24}
                  className="w-full rounded-[6px] border border-white/[0.08] bg-black/30 px-2.5 py-[6px] text-[11px] text-ink/85 placeholder:text-mist/46 focus:border-biolum/35 focus:outline-none"
                />
                <div className="mt-[3px] text-[9.5px] leading-[1.5] text-mist/46">
                  改的是窗口标题和左上角。数据目录、打包标识都不变 —— 不然已有的记录会找不回来。
                </div>
              </div>

              {/* ── 关于 / 更新 ── */}
              <div>
                <div className="mb-1.5">
                  <span className="label">关于</span>
                </div>
                <button
                  onClick={() => setShowAbout((v) => !v)}
                  className="flex w-full items-center justify-between rounded-[6px] border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-white/[0.14]"
                >
                  <span className="font-mono text-[10.5px] text-ink/70">
                    HABITAT · v0.1.0
                  </span>
                  <span className="text-[10px] text-mist/50">{showAbout ? "收起" : "展开"}</span>
                </button>
                {showAbout && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-1.5 overflow-hidden rounded-[6px] border border-white/[0.05] bg-black/20 px-3 py-2"
                  >
                    <div className="space-y-1.5 font-mono text-[10px] leading-[1.75] text-mist/58">
                      <div>数据只存在本机，不上传</div>
                      <div>对话 200 条/会话上限，超出丢弃最旧的</div>
                      <div>开源 · AGPL-3.0</div>
                      {/*
                       * 商标免责。
                       *
                       * 出厂角色用过 DeepSeek / Claude / ChatGPT 这些名字 ——
                       * 那是各家的注册商标。用来说明「这个角色连的是谁的模型」
                       * 属于指示性使用，但摆在自己产品里还是该说清楚：
                       * **我们不是他们，他们也不为这个软件负责。**
                       */}
                      <div className="pt-1 text-mist/40">
                        角色名来自其连接的模型，与各厂商无关，非官方产品
                      </div>
                    </div>

                    {/* ── 检查更新 ── */}
                    <div className="mt-3 border-t border-white/[0.06] pt-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-mist/58">检查更新</span>
                        <span className="font-mono text-[9.5px] text-mist/40">
                          {updateRes?.current ?? "—"}
                        </span>
                      </div>

                      <div className="mb-2 grid grid-cols-2 gap-1">
                        {CHANNELS.map((c) => (
                          <button
                            key={c.key}
                            onClick={() => {
                              setChannel(c.key);
                              saveChannel(c.key);
                              setUpdateRes(null);
                            }}
                            title={c.hint}
                            className={`rounded-[5px] border px-2 py-1.5 text-[10px] transition-colors ${
                              channel === c.key
                                ? "border-biolum/40 bg-biolum/[0.08] text-biolum"
                                : "border-white/[0.08] text-mist/50 hover:border-white/[0.16]"
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                      <div className="mb-2 font-mono text-[9px] leading-[1.6] text-mist/30">
                        {CHANNELS.find((c) => c.key === channel)?.hint}
                      </div>

                      <button
                        disabled={checking}
                        onClick={async () => {
                          setChecking(true);
                          try {
                            setUpdateRes(await checkUpdate(channel));
                          } finally {
                            setChecking(false);
                          }
                        }}
                        className="w-full rounded-[5px] border border-white/[0.1] px-2 py-1.5 text-[10px] text-mist/70 transition-colors hover:border-biolum/40 hover:text-biolum disabled:opacity-40"
                      >
                        {checking ? "查…" : "检查"}
                      </button>

                      {updateRes && (
                        <div className="mt-2 font-mono text-[9.5px] leading-[1.7]">
                          {!updateRes.ok ? (
                            <div className="text-mist/40">{updateRes.reason}</div>
                          ) : updateRes.isNewer ? (
                            <div className="space-y-1">
                              <div className="text-biolum/80">
                                有新版本 {updateRes.latest}
                                {updateRes.prerelease ? " · 测试版" : ""}
                              </div>
                              <button
                                onClick={() => openRelease(updateRes.url ?? "")}
                                className="text-mist/60 underline decoration-white/20 underline-offset-2 hover:text-biolum"
                              >
                                去下载
                              </button>
                            </div>
                          ) : (
                            <div className="text-mist/40">已经是最新的（{updateRes.latest}）</div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            {/* 底部 */}
            <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-5 py-3">
              <IconTail size={12} className="text-biolum/50" />
              <span className="text-[10.5px] text-mist/58">数据不出本机</span>
              <button
                onClick={onClose}
                className="ml-auto rounded-[6px] border border-white/[0.1] px-3 py-[4px] text-[10.5px] text-ink/75 transition-colors hover:border-biolum/30 hover:text-biolum"
              >
                完成
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
      {/* 导入前预览 —— 选完文件不直接落库，先让用户看清里面是什么 */}
      {pendingImport && (
        <ConfirmDialog
          title={`导入 ${pendingImport.bundle.data.personas.length} 个角色？`}
          desc={pendingImport.lines.join("\n")}
          confirmText="确认导入"
          onCancel={() => setPendingImport(null)}
          onOk={() => {
            const res = applyArchive(pendingImport.bundle);
            setPendingImport(null);
            notify({
              title: "导入完成",
              desc: `新增 ${res.added} 个角色 · 更新 ${res.updated} 个 · 新增 ${res.messages} 条对话${res.groups ? ` · ${res.groups} 个群` : ""}。刷新后生效`,
              accent: "#35f0ce",
              icon: "log",
            });
            setTimeout(() => window.location.reload(), 1400);
          }}
        />
      )}
    </>
  );
}

function Row({
  title,
  sub,
  action,
  onClick,
}: {
  title: string;
  sub: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-[5px] border border-white/[0.05] px-2 py-1.5">
      <div className="min-w-0">
        <div className="font-mono text-[10px] text-ink/70">{title}</div>
        <div className="mt-[1px] font-mono text-[9.5px] text-mist/50">{sub}</div>
      </div>
      <button
        onClick={onClick}
        className="shrink-0 rounded-[4px] border border-white/[0.09] px-2 py-[3px] font-mono text-[10px] text-mist/55 transition-colors hover:border-coral/35 hover:text-coral/85"
      >
        {action}
      </button>
    </div>
  );
}
