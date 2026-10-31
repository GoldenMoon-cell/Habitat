import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useEscClose } from "../lib/escStack";
import { fetchModels, fetchModelsViaMain } from "../lib/modelSource";
import {
  PRESET_ENDPOINTS,
  loadCredentials,
  maskKey,
  removeCredential,
  rememberModels,
  upsertCredential,
  isCredentialEncryptionOn,
  type ApiCredential,
} from "../store/credentials";

/**
 * API 接入 —— 多套凭据管理。
 *
 * 为什么是多套：
 *   一个 Key 只能调一个厂商的模型。配了 DeepSeek 的 Key，不代表能调 Claude。
 *   中转站更夸张 —— 一个 Key 几十个模型，还分不同分组。
 *
 * 所以「凭据」不是全局一个，而是一个列表；角色各自绑定其中一套。
 */

let seq = 0;
const newId = () => `cred-${Date.now().toString(36)}-${seq++}`;

export default function ApiConfigDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  /* OS 级加密是否可用（main.tsx 的 hydrate 阶段已探测过） */
  const ENC = isCredentialEncryptionOn();

  /*
   * 遮罩关闭要判断「按下」和「松开」是不是都在遮罩上。
   *
   * 只挂 onClick 的话：在输入框里按下开始拖选，鼠标滑到遮罩上松开 ——
   * 这一下会被当成点击遮罩，整个弹窗直接消失，输入的内容也白填了。
   */
  const backdropDown = useRef(false);
  const [list, setList] = useState<ApiCredential[]>([]);
  /** null = 列表视图；否则是正在编辑的凭据 */
  const [editing, setEditing] = useState<ApiCredential | null>(null);

  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [pulled, setPulled] = useState<{ id: string; contextWindow?: number }[]>([]);

  useEscClose(open, onClose);

  useEffect(() => {
    if (open) {
      setList(loadCredentials());
      setEditing(null);
    }
  }, [open]);

  const startNew = () => {
    setEditing({
      id: newId(),
      label: "新凭据",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "",
      models: [],
    });
    setTestMsg(null);
    setTestOk(null);
    setShowKey(false);
    setPulled([]);
  };

  const startEdit = (c: ApiCredential) => {
    setEditing({ ...c });
    setTestMsg(null);
    setTestOk(null);
    setShowKey(false);
    setPulled(c.models ?? []);
  };

  const test = async () => {
    if (!editing) return;
    setTesting(true);
    setTestMsg(null);
    setTestOk(null);

    /* 先试主进程（没有 CORS），不在 Electron 里时回退到浏览器 fetch */
    const viaMain = await fetchModelsViaMain(editing.baseUrl, editing.apiKey);
    const r = viaMain ?? (await fetchModels(editing.baseUrl, editing.apiKey));
    setTesting(false);

    if (!r.ok) {
      setTestOk(false);
      setTestMsg(r.error.message);
      setPulled([]);
      return;
    }

    const models = r.models.map((m) => ({ id: m.id, contextWindow: m.contextWindow }));
    setTestOk(true);
    setTestMsg(`拉到 ${models.length} 个模型 · ${r.endpoint}`);
    setPulled(models);
    rememberModels(r.models.map((m) => m.id));
  };

  const save = () => {
    if (!editing) return;
    const c: ApiCredential = {
      ...editing,
      label: editing.label.trim() || "未命名",
      baseUrl: editing.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: editing.apiKey.trim(),
      models: pulled.length > 0 ? pulled : editing.models ?? [],
      testedAt: testOk ? Date.now() : editing.testedAt,
    };
    upsertCredential(c);
    setList(loadCredentials());
    setEditing(null);
    onSaved();
  };

  const del = (id: string) => {
    setList(removeCredential(id));
    onSaved();
  };

  if (!open) return null;

  /* ══════════════ 编辑视图 ══════════════ */
  if (editing) {
    return (
      <div
        className="fixed inset-0 z-[112] flex items-center justify-center bg-abyss/88 backdrop-blur-md"
        onMouseDown={(e) => {
          backdropDown.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (backdropDown.current && e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="glass flex max-h-[84vh] w-[480px] max-w-[92vw] flex-col overflow-hidden rounded-[14px]"
        >
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <button
              onClick={() => setEditing(null)}
              className="grid h-6 w-6 place-items-center rounded-[5px] text-[14px] text-mist/45 transition-colors hover:bg-white/[0.07] hover:text-ink/75"
              aria-label="返回"
            >
              ‹
            </button>
            <span className="text-[12px] text-ink">
              {editing.models?.length ? "编辑凭据" : "新增凭据"}
            </span>
            <button
              onClick={onClose}
              className="ml-auto grid h-6 w-6 place-items-center rounded-[5px] text-mist/55 transition-colors hover:bg-white/[0.07] hover:text-ink/75"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ENDPOINTS.map((p) => (
                <button
                  key={p.label}
                  onClick={() =>
                    setEditing({
                      ...editing,
                      label: p.label,
                      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
                    })
                  }
                  className={`rounded-[5px] border px-2 py-[3px] font-mono text-[10px] transition-colors ${
                    editing.label === p.label
                      ? "border-biolum/40 bg-biolum/[0.1] text-biolum/90"
                      : "border-white/[0.08] text-mist/45 hover:border-white/[0.16] hover:text-mist/70"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="text-[10.5px] text-mist/45">名称</span>
              <input
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="DeepSeek 官方 / 某中转站"
                className="mt-1 w-full rounded-[6px] border border-white/[0.08] bg-black/30 px-2.5 py-[6px] text-[10px] text-ink/85 placeholder:text-mist/42 focus:border-biolum/35 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-[10.5px] text-mist/45">Base URL</span>
              <input
                value={editing.baseUrl}
                onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                spellCheck={false}
                className="mt-1 w-full rounded-[6px] border border-white/[0.08] bg-black/30 px-2.5 py-[6px] font-mono text-[10px] text-ink/85 placeholder:text-mist/42 focus:border-biolum/35 focus:outline-none"
              />
              <div className="mt-[3px] font-mono text-[9.5px] leading-[1.5] text-mist/46">
                不用带 /chat/completions，程序自动拼。中转站通常也是 /v1 结尾
              </div>
            </label>

            <label className="block">
              <div className="flex items-baseline">
                <span className="text-[10.5px] text-mist/45">API Key</span>
                <button
                  onClick={() => setShowKey((v) => !v)}
                  className="ml-auto font-mono text-[9.5px] text-mist/50 transition-colors hover:text-mist/60"
                >
                  {showKey ? "隐藏" : "显示"}
                </button>
              </div>
              <input
                value={editing.apiKey}
                onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
                spellCheck={false}
                autoComplete="off"
                className="mt-1 w-full rounded-[6px] border border-white/[0.08] bg-black/30 px-2.5 py-[6px] font-mono text-[10px] text-ink/85 placeholder:text-mist/42 focus:border-biolum/35 focus:outline-none"
              />
            </label>

            <div
              className="rounded-[6px] border px-2.5 py-2"
              style={{
                borderColor: ENC ? "rgba(53,240,206,0.25)" : "rgba(255,184,107,0.25)",
                background: ENC ? "rgba(53,240,206,0.05)" : "rgba(255,184,107,0.05)",
              }}
            >
              <div
                className="text-[10px] leading-[1.6]"
                style={{ color: ENC ? "rgba(53,240,206,0.8)" : "rgba(255,184,107,0.75)" }}
              >
                {ENC
                  ? "Key 用系统的密钥库加密后存盘（Windows DPAPI / macOS 钥匙串）。"
                  : "Key 会明文存在浏览器的 localStorage 里。"}
              </div>
              <div className="mt-[2px] text-[9.5px] leading-[1.5] text-mist/50">
                {ENC ? (
                  <>
                    换台电脑或换系统账户解不开 —— 这是加密的代价，不是 bug。
                    拷走 <span className="font-mono">current.json</span> 也只是一堆乱码。
                    <br />
                    同一账户下运行的其他程序仍能解密，别拿它存生产环境的 key。
                  </>
                ) : (
                  <>
                    当前环境没有系统密钥库（浏览器预览就是这样），只能明文。
                    用桌面版可启用加密。
                    <br />
                    别拿它存正式生产账号的 key。
                  </>
                )}
              </div>
            </div>

            <button
              onClick={test}
              disabled={testing || !editing.baseUrl.trim()}
              className="w-full rounded-[6px] border border-white/[0.1] py-[5px] text-[10.5px] text-ink/70 transition-colors hover:border-biolum/35 hover:text-biolum disabled:opacity-40"
            >
              {testing ? "正在连…" : "测试连接 / 拉取模型"}
            </button>

            {testMsg && (
              <div
                className="rounded-[6px] border px-2.5 py-2"
                style={{
                  borderColor: testOk ? "rgba(53,240,206,0.3)" : "rgba(255,122,107,0.3)",
                  background: testOk ? "rgba(53,240,206,0.06)" : "rgba(255,122,107,0.06)",
                }}
              >
                <div
                  className="font-mono text-[10px] leading-[1.6]"
                  style={{ color: testOk ? "#35f0ce" : "#ff7a6b" }}
                >
                  {testMsg}
                </div>
                {!testOk && testMsg.includes("CORS") && (
                  <div className="mt-1 text-[9.5px] leading-[1.5] text-mist/55">
                    浏览器不允许跨域请求 API。<b className="text-ink/60">用桌面版（Electron）测</b>
                    ，那边走主进程没有这个限制。
                  </div>
                )}
              </div>
            )}

            {pulled.length > 0 && (
              <div>
                <div className="mb-1 font-mono text-[9.5px] text-mist/50">
                  这个端点能提供 {pulled.length} 个模型
                </div>
                <div className="thin-scroll flex max-h-[120px] flex-wrap gap-1 overflow-y-auto">
                  {pulled.map((m) => (
                    <span
                      key={m.id}
                      className="rounded-[4px] border border-white/[0.07] px-1.5 py-[2px] font-mono text-[9.5px] text-mist/55"
                    >
                      {m.id}
                      {m.contextWindow && (
                        <span className="ml-1 text-biolum/50">
                          {Math.round(m.contextWindow / 1000)}k
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
            <button
              onClick={() => setEditing(null)}
              className="ml-auto rounded-[6px] px-2.5 py-[4px] text-[10.5px] text-mist/45 transition-colors hover:text-ink/70"
            >
              取消
            </button>
            <button
              disabled={!editing.baseUrl.trim() || !editing.apiKey.trim()}
              onClick={save}
              className="rounded-[6px] px-3 py-[4px] text-[10.5px] transition-colors disabled:opacity-40"
              style={{
                background: "rgba(53,240,206,0.16)",
                color: "#35f0ce",
                boxShadow: "inset 0 0 0 1px rgba(53,240,206,0.3)",
              }}
            >
              保存
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ══════════════ 列表视图 ══════════════ */
  return (
    <div
      className="fixed inset-0 z-[112] flex items-center justify-center bg-abyss/88 backdrop-blur-md"
      onMouseDown={(e) => {
        backdropDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (backdropDown.current && e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[82vh] w-[500px] max-w-[92vw] flex-col overflow-hidden rounded-[14px]"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="text-[12px] text-biolum/70">⚡</span>
          <span className="text-[12px] text-ink">API 接入</span>
          <span className="ml-1 font-mono text-[10px] text-mist/48">{list.length} 套凭据</span>
          <button
            onClick={onClose}
            className="ml-auto grid h-6 w-6 place-items-center rounded-[5px] text-mist/55 transition-colors hover:bg-white/[0.07] hover:text-ink/75"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="thin-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {list.length === 0 && (
            <div className="py-8 text-center">
              <div className="text-[10px] text-mist/58">还没有配任何 API</div>
              <div className="mt-1 text-[10px] leading-[1.6] text-mist/46">
                没有凭据时，回复来自本地文案池
                <br />
                标题栏会显示「MOCK · 未连接 API」
              </div>
            </div>
          )}

          {list.map((c) => (
            <div
              key={c.id}
              className="rounded-[8px] border border-white/[0.07] bg-white/[0.015] px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-biolum/70" />
                <span className="truncate text-[11px] text-ink/85">{c.label}</span>
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-mist/52">
                  {c.models?.length ?? 0} 个模型
                </span>
              </div>
              <div className="mt-[3px] truncate font-mono text-[9.5px] text-mist/50">
                {c.baseUrl} · {maskKey(c.apiKey)}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={() => startEdit(c)}
                  className="rounded-[4px] px-1.5 py-[1px] font-mono text-[9.5px] text-mist/45 transition-colors hover:text-biolum"
                >
                  编辑
                </button>
                <button
                  onClick={() => del(c.id)}
                  className="rounded-[4px] px-1.5 py-[1px] font-mono text-[9.5px] text-mist/55 transition-colors hover:text-coral"
                >
                  删除
                </button>
                {c.testedAt && (
                  <span className="ml-auto font-mono text-[9.5px] text-mist/44">
                    {new Date(c.testedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <span className="font-mono text-[9.5px] text-mist/46">每个角色绑定其中一套</span>
          <button
            onClick={startNew}
            className="ml-auto rounded-[6px] px-3 py-[4px] text-[10.5px] transition-colors"
            style={{
              background: "rgba(53,240,206,0.16)",
              color: "#35f0ce",
              boxShadow: "inset 0 0 0 1px rgba(53,240,206,0.3)",
            }}
          >
            + 新增凭据
          </button>
        </div>
      </motion.div>
    </div>
  );
}
